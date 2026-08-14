/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Phase 13 evaluation harness. See docs/architecture/2026-08-phase13-eval-harness.md for the design
 * and the real issues an adversarial review caught before this was written (each referenced by
 * number in the comments below).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Agent } from "../agent";
import { PermissionManager, type ConfirmFn } from "../permissions";
import { isGitRepo } from "../gitCheckpoint";
import { loadTransaction } from "../transactionLog";
import { createSessionId } from "../session";
import { EvalReporter, freshCapturedResult } from "./reporter";
import type { EvalTask, EvalRunResult, EvalTaskSummary, EvalReport } from "./types";
import type { LlmConfig } from "../types";

let isolated = false;

/**
 * Fix #5: redirects the usage-export destination and the whole process's notion of "home" to
 * isolated scratch paths, exactly once, before any Agent is ever constructed. This keeps eval runs
 * out of the real, cross-project usage ledger (whose derived Excel export can live inside a real
 * OneDrive sync folder) and out of the real global-instructions file -- and, as a deliberate side
 * effect, means the OS-backed secret store is unreachable during eval runs, so a run must explicitly
 * declare its own provider/model/key (or use the free default) rather than silently inheriting
 * whatever the interactive session has stored. Idempotent -- safe to call more than once.
 */
export function isolateEvalEnvironment(): void {
  if (isolated) return;
  isolated = true;
  const scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-eval-home-"));
  process.env.USERPROFILE = scratchHome;
  process.env.HOME = scratchHome;
  process.env.WREXLYN_USAGE_DIR = path.join(scratchHome, "usage-export");
}

function copyFixture(repoDir: string): string {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-eval-run-")); // fix #4: fresh random path every call
  fs.cpSync(repoDir, scratchDir, { recursive: true });
  return scratchDir;
}

const stubConfirmFn: ConfirmFn = async () => "once"; // unreachable under yolo=true; required by the constructor's type

export async function runOne(task: EvalTask, repeat: number, llmConfig: LlmConfig): Promise<EvalRunResult> {
  isolateEvalEnvironment();
  const started = Date.now();
  const scratchDir = copyFixture(task.repoDir);
  const sessionId = createSessionId();
  const captured = freshCapturedResult(); // fix #2: never left undefined

  // fix #3: a scratch dir accidentally placed under this project's own tree would silently activate
  // whole-tree git checkpointing against THIS repo's real .git -- hard guard, not just a naming
  // convention (os.tmpdir() should already guarantee this is never a git repo).
  if (isGitRepo(scratchDir)) {
    fs.rmSync(scratchDir, { recursive: true, force: true });
    throw new Error(`Refusing to run "${task.id}": scratch directory ${scratchDir} unexpectedly registers as a git repo.`);
  }

  let agent: Agent | null = null;
  try {
    const reporter = new EvalReporter(captured);
    const permissions = new PermissionManager(true, stubConfirmFn); // yolo=true: disposable scratch dir, nothing real at stake
    agent = new Agent(scratchDir, llmConfig, permissions, reporter, sessionId);
    await agent.handleUserMessage(task.prompt);

    let deterministicTestPassed: boolean | null = null;
    if (captured.transactionId) {
      const tx = loadTransaction(scratchDir, sessionId, captured.transactionId); // fix #1: ground truth, not the outcome enum
      const testCheck = tx?.contract.checks.find((c) => c.source === "deterministic" && /^test/i.test(c.name));
      if (testCheck) deterministicTestPassed = testCheck.ok;
    }

    return {
      taskId: task.id,
      repeat,
      status: captured.errorMessage ? "error" : "done",
      outcome: captured.outcome,
      confidence: captured.confidence,
      deterministicTestPassed,
      errorMessage: captured.errorMessage ?? undefined,
      durationMs: Date.now() - started,
    };
  } catch (err: any) {
    return {
      taskId: task.id,
      repeat,
      status: "error",
      outcome: captured.outcome,
      confidence: captured.confidence,
      deterministicTestPassed: null,
      errorMessage: err.message ?? String(err),
      durationMs: Date.now() - started,
    };
  } finally {
    if (agent) await agent.dispose().catch(() => {}); // fix #6
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

export interface RunAllOptions {
  repeats: number;
  filter?: string;
  onProgress?: (message: string) => void;
}

export async function runAll(tasks: EvalTask[], llmConfig: LlmConfig, opts: RunAllOptions): Promise<EvalRunResult[]> {
  const selected = opts.filter ? tasks.filter((t) => t.id.includes(opts.filter!) || t.title.includes(opts.filter!)) : tasks;
  const results: EvalRunResult[] = [];
  for (const task of selected) {
    for (let repeat = 1; repeat <= opts.repeats; repeat++) {
      opts.onProgress?.(`[${task.id}] attempt ${repeat}/${opts.repeats}...`);
      const result = await runOne(task, repeat, llmConfig); // sequential by design -- see architecture doc
      results.push(result);
      opts.onProgress?.(`[${task.id}] attempt ${repeat}/${opts.repeats}: ${result.status === "error" ? `error (${result.errorMessage})` : result.outcome} (test ${result.deterministicTestPassed === null ? "n/a" : result.deterministicTestPassed ? "pass" : "fail"})`);
    }
  }
  return results;
}

export function buildReport(tasks: EvalTask[], results: EvalRunResult[], provider: string, model: string, repeats: number): EvalReport {
  const byTask = new Map<string, EvalRunResult[]>();
  for (const r of results) {
    if (!byTask.has(r.taskId)) byTask.set(r.taskId, []);
    byTask.get(r.taskId)!.push(r);
  }

  const taskSummaries: EvalTaskSummary[] = [];
  for (const task of tasks) {
    const runs = byTask.get(task.id) ?? [];
    if (!runs.length) continue;
    const passFlags = runs.map((r) => r.deterministicTestPassed === true);
    taskSummaries.push({
      taskId: task.id,
      title: task.title,
      difficulty: task.difficulty,
      repeats: runs.length,
      passCount: passFlags.filter(Boolean).length,
      verifiedCount: runs.filter((r) => r.outcome === "verified").length,
      reproducible: passFlags.every((p) => p === passFlags[0]),
      runs,
    });
  }

  const totalRuns = results.length;
  const deterministicPasses = results.filter((r) => r.deterministicTestPassed === true).length;
  const verifiedRuns = results.filter((r) => r.outcome === "verified").length;
  const reproducibleTasks = taskSummaries.filter((t) => t.reproducible).length;

  return {
    generatedAt: Date.now(),
    provider,
    model,
    repeats,
    taskCount: taskSummaries.length,
    totalRuns,
    deterministicPassRate: totalRuns ? deterministicPasses / totalRuns : 0,
    verifiedRate: totalRuns ? verifiedRuns / totalRuns : 0,
    reproducibilityRate: taskSummaries.length ? reproducibleTasks / taskSummaries.length : 0,
    tasks: taskSummaries,
  };
}
