/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * An independent, per-step quality gate. Build/test/lint verification (see
 * verification.ts) only catches mechanical breakage — it says nothing about
 * whether a step actually did what the user asked. This asks the model
 * itself to review its own last step from a fresh, skeptical angle, which is
 * cheap insurance against weaker/free models that don't reliably self-check
 * without being asked directly: one extra plain completion, no tools, so it
 * works even on providers/models whose tool-calling is unreliable.
 */
import { chatCompletion } from "./llm";
import { withTimeout } from "./timeout";
import type { ChatMessage, LlmConfig } from "./types";

const MAX_CRITIQUE_INPUT_CHARS = 4_000;
const CRITIC_TIMEOUT_MS = 25_000;

export interface CritiqueResult {
  pass: boolean;
  reason: string;
}

const CRITIC_SYSTEM_PROMPT =
  "You are a strict, independent reviewer checking one step of an AI coding agent's work. You did not do the " +
  "work yourself and have no stake in it looking good — judge only from the evidence given. Reply with exactly " +
  "one line: either the word PASS, or FAIL: <short, specific reason>. Do not soften an obvious problem to be " +
  "polite, and do not invent a problem that isn't actually supported by the evidence shown.";

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\n... (truncated)" : text;
}

/**
 * Reviews one round of mutating actions against the turn's overall intent.
 * Never throws — a broken or unreachable critic should never block the
 * agent's actual work, so callers get pass:true with an explanatory reason
 * on any failure to get a usable verdict.
 */
export async function critiqueStep(llmConfig: LlmConfig, intent: string, stepSummary: string): Promise<CritiqueResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: CRITIC_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `Overall task: ${truncate(intent, 500)}`,
        "",
        "Step just taken (tool calls and their results):",
        truncate(stepSummary, MAX_CRITIQUE_INPUT_CHARS),
        "",
        "Did this step correctly and completely do what it needed to, with no obvious mistakes? Reply PASS or FAIL: <reason>.",
      ].join("\n"),
    },
  ];

  let text: string;
  try {
    const result = await withTimeout(chatCompletion(messages, [], llmConfig), CRITIC_TIMEOUT_MS, "critic call");
    text = (result.content ?? "").trim();
  } catch (err: any) {
    return { pass: true, reason: `critic unavailable (${err.message ?? err}) — skipped` };
  }

  if (/^pass\b/i.test(text)) return { pass: true, reason: "" };
  if (/^fail\b/i.test(text)) {
    const reason = text.replace(/^fail:?\s*/i, "").trim();
    return { pass: false, reason: reason || "no reason given" };
  }
  // Malformed/ambiguous reply — fail open rather than blocking progress on a confused critic.
  return { pass: true, reason: `critic gave an unparseable reply (${truncate(text, 200)}) — skipped` };
}
