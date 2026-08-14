/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Best-of-N orchestration (Phase 10): runs the same task N ways in parallel, each in its own
 * isolated git worktree with a full, independent `Agent` instance, then lets the caller merge one
 * attempt's changes back into the real project. See docs/architecture/2026-08-phase10-parallel-agents.md
 * for the full design, including two issues an adversarial review caught before implementation: the
 * merge-back call needs its arguments in the OPPOSITE order from a naive rollback-shaped call (see
 * mergeParallelRunAttempt's comment), and a dirty main root must be refused upfront (a clean-tree
 * precondition), not just assumed.
 */
import { Agent } from "./agent";
import { PermissionManager, type ConfirmFn } from "./permissions";
import { isGitRepo, captureTree, restoreTree, countChangedPaths } from "./gitCheckpoint";
import { gitStatusPorcelain } from "./workspaceSnapshot";
import { createWorktree, linkSharedDependencies, removeWorktree, sweepOrphanedWorktrees, generateRunId } from "./worktree";
import type { Reporter, LlmConfig, TransactionOutcome } from "./types";
import type { ServerMessage } from "./web/protocol";

export const PARALLEL_RUN_MIN_N = 2;
export const PARALLEL_RUN_MAX_N = 4;
export const PARALLEL_RUN_DEFAULT_N = 3;

/** A short, distinct nudge per attempt -- a cheap diversity aid in the same spirit as convergence.ts's
 * existing pass-A/pass-B framing, but not sharing its code (that module has no tool-calling/working-
 * directory concept at all, so nothing there is reusable here). */
const STEERING_NOTES = [
  "prioritize the simplest possible fix",
  "consider a more thorough approach, even if it takes more steps",
  "optimize for readability and long-term maintainability",
  "focus on robustness and edge cases the obvious fix might miss",
];

/** Spread across attempts so N runs don't converge to near-identical output at the app's normal fixed
 * low temperature (0.15) -- confirmed via review that this would otherwise undercut Best-of-N's value. */
const TEMPERATURES = [0.15, 0.4, 0.65, 0.9];

/** Reuses the exact same discriminated union already used for the main chat's WS messages -- every
 * per-attempt agent-loop event (tool calls, streamed text, verification, transaction summaries) is
 * already shaped this way, so nothing new is needed to describe "what happened," only who it happened
 * to (the attempt index). */
export type ParallelAttemptEvent = ServerMessage;

export interface ParallelAttemptResult {
  attemptId: string;
  index: number;
  steeringNote: string;
  status: "running" | "done" | "error";
  outcome?: TransactionOutcome;
  confidence?: number;
  changedFileCount?: number;
  finalTreeSha?: string;
  errorMessage?: string;
}

/** Captures the latest transaction_summary event into the attempt's own result, then forwards every
 * event (untouched) to the caller's onEvent -- so a live UI can render each attempt's stream, and the
 * orchestration code always has the latest outcome/confidence without re-parsing anything from disk. */
class TaggedReporter implements Reporter {
  constructor(private index: number, private result: ParallelAttemptResult, private onEvent: (index: number, event: ParallelAttemptEvent) => void) {}
  private emit(event: ParallelAttemptEvent): void {
    this.onEvent(this.index, event);
  }
  toolCall(id: string, name: string, label: string, args: unknown, risk: any): void {
    this.emit({ type: "tool_call", id, name, label, args, risk });
  }
  toolResult(id: string, output: string, ok: boolean): void {
    this.emit({ type: "tool_result", id, output, ok });
  }
  error(text: string): void {
    this.emit({ type: "error", text });
  }
  thinking(isThinking: boolean): void {
    this.emit({ type: "thinking", value: isThinking });
  }
  tasks(tasks: any): void {
    this.emit({ type: "tasks", tasks });
  }
  history(items: any): void {
    this.emit({ type: "history", items });
  }
  files(files: string[]): void {
    this.emit({ type: "files", files });
  }
  assistantDelta(chunk: string): void {
    this.emit({ type: "assistant_delta", chunk });
  }
  assistantDeltaEnd(fullText: string, isFinal: boolean): void {
    this.emit({ type: "assistant_delta_end", text: fullText, final: isFinal });
  }
  verification(result: any): void {
    this.emit({ type: "verification_result", result });
  }
  critique(pass: boolean, reason: string): void {
    this.emit({ type: "critique_result", pass, reason });
  }
  transactionSummary(transactionId: string, confidence: number, outcome: TransactionOutcome, rollbackAvailable: boolean): void {
    this.result.outcome = outcome;
    this.result.confidence = confidence;
    this.emit({ type: "transaction_summary", transactionId, confidence, outcome, rollbackAvailable });
  }
}

interface AttemptState {
  index: number;
  worktreePath: string;
  agent: Agent;
  result: ParallelAttemptResult;
  /** Resolves once the attempt's handleUserMessage call has settled (success or failure) AND its
   * post-run bookkeeping (final tree capture, Agent disposal) is done. Never force-settled early --
   * there is no cancellation primitive anywhere in this codebase, so cleanup always waits for this. */
  settled: Promise<void>;
}

export interface ParallelRunState {
  runId: string;
  root: string;
  initialTreeSha: string;
  attempts: AttemptState[];
}

export interface StartParallelRunOptions {
  root: string;
  task: string;
  n: number;
  llmConfig: LlmConfig;
  onEvent: (attemptIndex: number, event: ParallelAttemptEvent) => void;
}

/**
 * Starts N isolated attempts and returns immediately once they're all launched (does not wait for
 * any of them to finish) -- callers decide how long to wait for results via `attempts[i].settled`.
 * Throws with a clear, user-facing message if the precondition (clean git repo) isn't met.
 */
export async function startParallelRun(opts: StartParallelRunOptions): Promise<ParallelRunState> {
  const { root, task, llmConfig, onEvent } = opts;
  const n = Math.max(PARALLEL_RUN_MIN_N, Math.min(PARALLEL_RUN_MAX_N, opts.n || PARALLEL_RUN_DEFAULT_N));

  if (!isGitRepo(root)) {
    throw new Error("Best-of-N requires this project to be a git repository (needed for isolated worktrees).");
  }
  const status = gitStatusPorcelain(root);
  if (status === null) {
    throw new Error("Could not read git status for this project.");
  }
  if (status !== "") {
    throw new Error(
      "Commit or stash your changes before running Best-of-N -- every attempt starts from a clean HEAD, so " +
        "uncommitted changes in the main project would be silently lost when a result is merged back."
    );
  }

  sweepOrphanedWorktrees(root); // closes any leftovers from a crashed/killed prior run before starting a new one

  const initialTreeSha = captureTree(root);
  if (!initialTreeSha) throw new Error("Could not capture the current workspace state.");

  const runId = generateRunId();
  const attempts: AttemptState[] = [];

  // If a later attempt fails to launch, clean up whatever worktrees earlier attempts in this same
  // batch already created -- rather than leaking them until the next Best-of-N invocation's sweep
  // (sweepOrphanedWorktrees still catches them eventually, but not launching this run at all is a
  // better time to clean up than "whenever the user tries again").
  try {
    for (let index = 0; index < n; index++) {
      const worktreePath = createWorktree(root, runId, index);
      if (!worktreePath) throw new Error(`Failed to create an isolated worktree for attempt ${index + 1}.`);
      linkSharedDependencies(root, worktreePath);

      const steeringNote = STEERING_NOTES[index % STEERING_NOTES.length];
      const temperature = TEMPERATURES[index % TEMPERATURES.length];
      const result: ParallelAttemptResult = { attemptId: `${runId}-${index}`, index, steeringNote, status: "running" };
      const reporter = new TaggedReporter(index, result, onEvent);
      // yolo=true: every action inside this disposable, isolated worktree auto-approves, including
      // high-risk ones -- an explicit, user-approved tradeoff (see the architecture doc), since nothing
      // reaches the real project without an explicit merge review afterward. confirmFn is unreachable
      // under yolo but still required by the constructor's type.
      const confirmFn: ConfirmFn = async () => "once";
      const permissions = new PermissionManager(true, confirmFn);
      const agent = new Agent(worktreePath, { ...llmConfig, temperature }, permissions, reporter);

      const settled = agent
        .handleUserMessage(`${task}\n\n(For this attempt: ${steeringNote}.)`)
        .then(() => {
          result.status = "done";
        })
        .catch((err: any) => {
          result.status = "error";
          result.errorMessage = err.message ?? String(err);
        })
        .then(async () => {
          const finalTreeSha = captureTree(worktreePath);
          result.finalTreeSha = finalTreeSha ?? undefined;
          if (finalTreeSha) {
            result.changedFileCount = countChangedPaths(worktreePath, initialTreeSha, finalTreeSha) ?? undefined;
          }
          await agent.dispose();
        });

      attempts.push({ index, worktreePath, agent, result, settled });
    }
  } catch (err) {
    for (const attempt of attempts) removeWorktree(root, attempt.worktreePath);
    throw err;
  }

  return { runId, root, initialTreeSha, attempts };
}

export interface MergeAttemptResult {
  ok: boolean;
  reason?: string;
  /** Present on success -- the natural (pre-state, post-state) pair for recording this merge as a
   * normal, reversible transaction in the main Agent's own log. NOT the argument order the merge
   * call itself used internally (see the comment on that call below). */
  treeSnapshot?: { beforeTree: string; afterTree: string };
}

/**
 * Merges one attempt's final state into the real project. `restoreTree(root, beforeTree, afterTree)`
 * is rollback-shaped: it requires the workspace's CURRENT tree to equal `afterTree`, then moves it TO
 * `beforeTree`. An adversarial review proved (by reproducing this against a real repo) that the naive
 * "forward" call -- `restoreTree(root, initialTreeSha, winnerTreeSha)` -- can never succeed, because
 * the guard checks current === winnerTreeSha (the second arg), which is false (the main root was never
 * touched, so it's still at initialTreeSha). The correct call treats the winner's tree as the "target"
 * (beforeTree) and the actual current state as the "assumed current" (afterTree) -- i.e. the arguments
 * are swapped from what a naive reading suggests:
 */
export function mergeParallelRunAttempt(state: ParallelRunState, attemptIndex: number): MergeAttemptResult {
  const attempt = state.attempts.find((a) => a.index === attemptIndex);
  if (!attempt) return { ok: false, reason: `No attempt with index ${attemptIndex}.` };
  if (!attempt.result.finalTreeSha) return { ok: false, reason: "That attempt hasn't finished yet." };

  const result = restoreTree(state.root, attempt.result.finalTreeSha, state.initialTreeSha);
  if (!result.ok) {
    return { ok: false, reason: result.reason ?? "Merge failed." };
  }
  // Recorded in the NATURAL (pre-state, post-state) convention for the transaction log -- this is
  // what Agent.rollbackTransaction's existing generic code expects and calls restoreTree(root,
  // beforeTree, afterTree) with directly, unchanged, to undo the merge later if the user asks.
  return { ok: true, treeSnapshot: { beforeTree: state.initialTreeSha, afterTree: attempt.result.finalTreeSha } };
}

/**
 * Waits for every attempt to actually settle (never force-kills mid-flight -- there is no
 * cancellation primitive anywhere in this codebase) before removing its worktree. A cleanup failure
 * is surfaced via `onOrphan`, never swallowed silently.
 */
export async function cleanupParallelRun(state: ParallelRunState, onOrphan?: (worktreePath: string) => void): Promise<void> {
  await Promise.all(state.attempts.map((a) => a.settled.catch(() => {})));
  for (const attempt of state.attempts) {
    if (!removeWorktree(state.root, attempt.worktreePath)) onOrphan?.(attempt.worktreePath);
  }
}
