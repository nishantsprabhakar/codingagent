/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { TransactionOutcome } from "../types";

export interface EvalTask {
  id: string;
  title: string;
  prompt: string;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  /** Absolute path to this task's evals/tasks/<id>/repo/ starter directory. */
  repoDir: string;
}

/**
 * One (task, repeat) attempt. Two independent pass signals are recorded, never conflated (see
 * docs/architecture/2026-08-phase13-eval-harness.md for why `outcome === "verified"` alone is not a
 * trustworthy ground-truth signal — the critic can flip a genuine deterministic pass):
 * - `outcome`/`confidence`: the realistic, user-facing six-state signal, present only when the turn
 *   actually produced a transaction summary (see `status` below for when it doesn't).
 * - `deterministicTestPassed`: read directly from the persisted transaction's own
 *   `contract.checks` (source: "deterministic") — the ground-truth "did the fixture's test pass"
 *   signal, independent of critic noise. `null` when no deterministic check ran at all (e.g. the
 *   model made no code-touching change).
 */
export interface EvalRunResult {
  taskId: string;
  repeat: number;
  /** "error" means an infra-level failure (EvalReporter.error fired, or the harness itself hit an
   *  exception) -- distinct from a genuine "the model made no changes" no-op, which is "done" with
   *  outcome "no_changes" and deterministicTestPassed null. */
  status: "done" | "error";
  outcome: TransactionOutcome;
  confidence: number;
  deterministicTestPassed: boolean | null;
  errorMessage?: string;
  durationMs: number;
}

export interface EvalTaskSummary {
  taskId: string;
  title: string;
  difficulty: EvalTask["difficulty"];
  repeats: number;
  /** How many repeats had deterministicTestPassed === true. */
  passCount: number;
  /** How many repeats reached outcome === "verified". */
  verifiedCount: number;
  /** True only if every repeat agreed on PASS (all true or all false) -- a property of the task. */
  reproducible: boolean;
  runs: EvalRunResult[];
}

export interface EvalReport {
  generatedAt: number;
  provider: string;
  model: string;
  repeats: number;
  taskCount: number;
  totalRuns: number;
  /** Ground-truth signal: fraction of ALL runs where the fixture's own test passed. This is the
   *  primary "required-check pass rate" metric the backlog asked for. */
  deterministicPassRate: number;
  /** Realistic signal: fraction of ALL runs that reached outcome === "verified". Reported alongside
   *  the ground-truth rate, not instead of it -- the gap between the two is itself meaningful. */
  verifiedRate: number;
  /** Fraction of TASKS whose repeats unanimously agreed on pass/fail. */
  reproducibilityRate: number;
  tasks: EvalTaskSummary[];
}
