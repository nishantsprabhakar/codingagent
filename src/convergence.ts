/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * The Nishant Convergence Protocol (NCP).
 *
 * Honest framing first: this does not make a small free model as smart as a frontier one — no
 * runtime layer can manufacture reasoning ability the underlying weights don't have. What it does
 * is close the *reliability gap* on the specific, narrow moment where a weak model is most likely
 * to be flailing: a repair round that has already failed once. A single generic "try again, fix the
 * root cause" retry is exactly the kind of self-correction weak/free models are worst at — they tend
 * to either repeat the same near-miss or thrash to something unrelated. NCP replaces that generic
 * retry with two independently-framed root-cause diagnoses, adjudicated against each other by a
 * dedicated comparative call (pairwise judgment is measurably more reliable for LLM judges than
 * asking either to self-score), and hands the model the winning diagnosis as its next instruction
 * instead of a blind retry.
 *
 * Deliberately adaptive, not blanket: the ensemble only engages once `agent.ts` has already seen one
 * plain repair attempt fail (see the `repairAttempts >= 2` call site) — most repairs succeed on the
 * first try, and paying three extra model calls on every turn would be a pure cost/latency regression
 * for the common case, directly working against the 429-rate-limit efficiency work done elsewhere in
 * this codebase. NCP spends its extra compute only once a turn has already proven itself stuck.
 */
import { chatCompletion } from "./llm";
import { withTimeout } from "./timeout";
import type { ChatMessage, LlmConfig } from "./types";

const DIAGNOSIS_TIMEOUT_MS = 25_000;
const ADJUDICATION_TIMEOUT_MS = 20_000;
const MAX_LESSON_CONTEXT = 5;

export type AdjudicationMargin = "clear" | "close" | "n/a";

export interface AdjudicationVerdict {
  winner: "A" | "B" | "tie";
  margin: "clear" | "close";
  reason: string;
}

export interface ConvergenceResult {
  /** False if the ensemble never ran (both diagnosis calls failed) or was skipped by the caller. */
  invoked: boolean;
  /** The winning diagnosis text to fold into the next repair instruction; "" if invoked is false. */
  diagnosis: string;
  margin: AdjudicationMargin;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\n... (truncated)" : text;
}

/**
 * Ranks learned lessons (see ProjectMemory.learnedLessons) by relevance to the current failure
 * context using keyword overlap plus a recency tiebreak — no embedding store exists in this
 * codebase, and a project's lesson list is short enough (capped at 20) that this is a proportionate
 * amount of machinery, not a corner cut. Surfaces "table headers must match row length" ahead of an
 * unrelated lesson about placeholder text when the failure is actually about a table.
 */
/** Strips a trailing "s"/"es" so "rows"/"row" and "columns"/"column" overlap — not real stemming, just enough to stop plural/singular mismatches from hiding an otherwise-exact match. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

export function selectRelevantLessons(lessons: string[], context: string, k = MAX_LESSON_CONTEXT): string[] {
  if (!lessons.length) return [];
  const contextWords = new Set((context.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stem));
  const scored = lessons.map((lesson, idx) => {
    const lessonWords = (lesson.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stem);
    const overlap = lessonWords.filter((w) => contextWords.has(w)).length;
    const recency = idx / lessons.length; // learnedLessons is append-order; later = more recently learned
    return { lesson, score: overlap * 2 + recency };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.lesson);
}

/** A quality-check (or verification) failure line already promoted to a lesson recurring verbatim is real signal the lesson wasn't actually applied — not just noise. */
export function hasRecurredKnownFailure(failureLines: string[], learnedLessons: string[]): boolean {
  if (!learnedLessons.length || !failureLines.length) return false;
  const lessonSet = new Set(learnedLessons);
  return failureLines.some((line) => lessonSet.has(line));
}

const DIAGNOSIS_SYSTEM_PROMPT =
  "You are a sharp, independent debugging analyst reviewing a failed automatic fix attempt inside an AI coding " +
  "agent. You did not write the code and have no stake in defending it. State the single most likely root " +
  "cause and the smallest concrete change that would fix it. Three sentences maximum. No filler, no restating " +
  "the error message verbatim, no hedging with 'it could be several things.'";

async function generateDiagnosis(
  llmConfig: LlmConfig,
  intent: string,
  failureSummary: string,
  lessons: string[],
  framing: string
): Promise<string> {
  const lessonBlock = lessons.length
    ? `\nFailure patterns already learned on this project — a correct diagnosis should not repeat one of these:\n${lessons
        .map((l) => `- ${l}`)
        .join("\n")}\n`
    : "";
  const messages: ChatMessage[] = [
    { role: "system", content: DIAGNOSIS_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `Task: ${truncate(intent, 400)}`,
        `Failure evidence:\n${truncate(failureSummary, 3000)}`,
        lessonBlock,
        framing,
        "What is the root cause, and what's the smallest fix?",
      ].join("\n"),
    },
  ];
  const result = await withTimeout(chatCompletion(messages, [], llmConfig), DIAGNOSIS_TIMEOUT_MS, "NCP diagnosis call");
  return (result.content ?? "").trim();
}

const ADJUDICATION_SYSTEM_PROMPT =
  "You are adjudicating between two independent root-cause diagnoses of the same failure, produced by two " +
  "separate analysis passes that were deliberately framed differently so they wouldn't converge on the same " +
  "blind spot. Comparative judgment between two concrete options is more reliable than scoring either in " +
  "isolation, which is why you're being asked this way. Reply with exactly one line in the form: " +
  "WINNER: A|B|TIE, MARGIN: CLEAR|CLOSE, REASON: <one short sentence>.";

async function adjudicate(llmConfig: LlmConfig, a: string, b: string): Promise<AdjudicationVerdict> {
  const messages: ChatMessage[] = [
    { role: "system", content: ADJUDICATION_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Diagnosis A:\n${truncate(a, 1500)}\n\nDiagnosis B:\n${truncate(
        b,
        1500
      )}\n\nWhich is more likely correct and specific enough to act on directly?`,
    },
  ];
  try {
    const result = await withTimeout(chatCompletion(messages, [], llmConfig), ADJUDICATION_TIMEOUT_MS, "NCP adjudication call");
    const text = (result.content ?? "").trim();
    const winnerM = text.match(/WINNER:\s*(A|B|TIE)/i);
    const marginM = text.match(/MARGIN:\s*(CLEAR|CLOSE)/i);
    const reasonM = text.match(/REASON:\s*(.+)$/is);
    const winner = (winnerM?.[1]?.toUpperCase() ?? "TIE") as "A" | "B" | "TIE";
    return {
      winner: winner === "TIE" ? "tie" : winner,
      margin: marginM?.[1]?.toUpperCase() === "CLEAR" ? "clear" : "close",
      reason: reasonM?.[1]?.trim() ?? text.slice(0, 200),
    };
  } catch (err: any) {
    return { winner: "tie", margin: "close", reason: `adjudication unavailable (${err.message ?? err})` };
  }
}

/**
 * Runs the divergent-diagnosis-and-adjudication ensemble described at the top of this file.
 * Never throws — any failure (both diagnoses empty, a timeout, a malformed adjudication reply)
 * degrades to `invoked: false` so the caller falls back to its existing generic repair message,
 * the same fail-open contract critiqueStep uses.
 */
export async function runDivergentRepairEnsemble(
  llmConfig: LlmConfig,
  intent: string,
  failureSummary: string,
  learnedLessons: string[]
): Promise<ConvergenceResult> {
  try {
    const relevantLessons = selectRelevantLessons(learnedLessons, `${intent} ${failureSummary}`);
    const [a, b] = await Promise.all([
      generateDiagnosis(
        llmConfig,
        intent,
        failureSummary,
        relevantLessons,
        "(Analysis pass A: start from the most obvious, most direct cause.)"
      ),
      generateDiagnosis(
        llmConfig,
        intent,
        failureSummary,
        relevantLessons,
        "(Analysis pass B: before settling on the obvious cause, consider a less obvious one — a side effect, " +
          "an ordering issue, a stale assumption from earlier in the conversation.)"
      ),
    ]);

    if (!a && !b) return { invoked: false, diagnosis: "", margin: "n/a" };
    if (!a) return { invoked: true, diagnosis: b, margin: "n/a" };
    if (!b) return { invoked: true, diagnosis: a, margin: "n/a" };

    const verdict = await adjudicate(llmConfig, a, b);
    const winningText = verdict.winner === "B" ? b : a; // a tie keeps the "obvious cause" pass, a reasonable default rather than an arbitrary one
    return { invoked: true, diagnosis: winningText, margin: verdict.margin };
  } catch {
    return { invoked: false, diagnosis: "", margin: "n/a" };
  }
}

export interface ConvergenceScoreInput {
  /** The outcome-based score finalizeTransaction() would have produced before any NCP adjustment. */
  outcomeBase: number;
  repairRoundsUsed: number;
  ncpInvoked: boolean;
  ncpMargin: AdjudicationMargin;
  /** A quality/verification failure recurred verbatim despite an existing learned lesson for it. */
  recurredKnownFailure: boolean;
}

/**
 * The formalized confidence adjustment NCP contributes on top of the existing outcome-based score:
 * a small, bounded penalty per repair round actually consumed (fewer rounds spent = more confidence
 * in the result), a bonus when the ensemble produced a *clear* adjudicated winner (real signal the
 * fix was well-diagnosed rather than a coin flip), and a real penalty when a failure recurred despite
 * an existing lesson for it (evidence the lesson wasn't actually applied, which is worse than never
 * having caught it at all). On the common case — zero repair rounds, NCP never invoked — this returns
 * `outcomeBase` completely unchanged, so it's a strict refinement of the existing ladder, not a
 * replacement for it.
 */
export function computeConvergenceScore(input: ConvergenceScoreInput): number {
  let score = input.outcomeBase;
  score -= 6 * input.repairRoundsUsed;
  if (input.ncpInvoked && input.ncpMargin === "clear") score += 8;
  if (input.recurredKnownFailure) score -= 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}
