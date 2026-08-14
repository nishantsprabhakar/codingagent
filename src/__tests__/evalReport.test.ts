/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../eval/runner";
import type { EvalTask, EvalRunResult } from "../eval/types";

function task(id: string, difficulty: EvalTask["difficulty"] = "easy"): EvalTask {
  return { id, title: `Task ${id}`, prompt: "do it", difficulty, tags: [], repoDir: `/fixtures/${id}` };
}

function run(taskId: string, repeat: number, passed: boolean, verified: boolean): EvalRunResult {
  return {
    taskId,
    repeat,
    status: "done",
    outcome: verified ? "verified" : "partially_verified",
    confidence: verified ? 90 : 50,
    deterministicTestPassed: passed,
    durationMs: 100,
  };
}

test("buildReport: no runs at all produces zeroed rates, not NaN/divide-by-zero", () => {
  const report = buildReport([task("a")], [], "kilo", "kilo-auto/free", 3);
  assert.equal(report.totalRuns, 0);
  assert.equal(report.taskCount, 0);
  assert.equal(report.deterministicPassRate, 0);
  assert.equal(report.verifiedRate, 0);
  assert.equal(report.reproducibilityRate, 0);
  assert.deepEqual(report.tasks, []);
});

test("buildReport: a task with zero runs is excluded from the summary, not shown as 0/0", () => {
  const results = [run("a", 1, true, true)];
  const report = buildReport([task("a"), task("b")], results, "kilo", "kilo-auto/free", 1);
  assert.equal(report.taskCount, 1);
  assert.equal(report.tasks[0].taskId, "a");
});

test("buildReport: aggregates deterministic-pass rate and verified rate as fractions of total runs", () => {
  const results = [
    run("a", 1, true, true),
    run("a", 2, true, false), // test passed, but outcome got knocked down (e.g. by critic noise)
    run("a", 3, false, false),
  ];
  const report = buildReport([task("a")], results, "kilo", "kilo-auto/free", 3);
  assert.equal(report.totalRuns, 3);
  assert.equal(report.deterministicPassRate, 2 / 3);
  assert.equal(report.verifiedRate, 1 / 3);
  assert.equal(report.tasks[0].passCount, 2);
  assert.equal(report.tasks[0].verifiedCount, 1);
});

test("buildReport: a task is reproducible when every repeat agrees, whether unanimous pass or unanimous fail", () => {
  const allPass = [run("a", 1, true, true), run("a", 2, true, true), run("a", 3, true, true)];
  const allFail = [run("b", 1, false, false), run("b", 2, false, false), run("b", 3, false, false)];
  const split = [run("c", 1, true, true), run("c", 2, false, false), run("c", 3, true, true)];

  const report = buildReport([task("a"), task("b"), task("c")], [...allPass, ...allFail, ...split], "kilo", "kilo-auto/free", 3);

  const byId = Object.fromEntries(report.tasks.map((t) => [t.taskId, t]));
  assert.equal(byId["a"].reproducible, true);
  assert.equal(byId["b"].reproducible, true);
  assert.equal(byId["c"].reproducible, false);
});

test("buildReport: reproducibility rate is a fraction of TASKS, not of runs", () => {
  // Two tasks, one reproducible (3 runs) and one not (3 runs) -- if this were computed over
  // runs instead of tasks, an uneven repeat count per task would skew the rate incorrectly.
  const reproducible = [run("a", 1, true, true), run("a", 2, true, true), run("a", 3, true, true)];
  const flaky = [run("b", 1, true, true), run("b", 2, false, false), run("b", 3, true, true)];
  const report = buildReport([task("a"), task("b")], [...reproducible, ...flaky], "kilo", "kilo-auto/free", 3);
  assert.equal(report.reproducibilityRate, 0.5);
});

test("buildReport: an error-status run counts as a deterministic-test failure, not silently excluded", () => {
  const results: EvalRunResult[] = [
    run("a", 1, true, true),
    { taskId: "a", repeat: 2, status: "error", outcome: "no_changes", confidence: 100, deterministicTestPassed: null, errorMessage: "boom", durationMs: 50 },
  ];
  const report = buildReport([task("a")], results, "kilo", "kilo-auto/free", 2);
  assert.equal(report.tasks[0].repeats, 2);
  assert.equal(report.tasks[0].passCount, 1);
  assert.equal(report.deterministicPassRate, 0.5);
});
