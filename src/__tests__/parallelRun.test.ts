/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Exercises the two issues an adversarial review caught before implementation: the merge-back call's
 * argument order (a naive "forward" reading can never succeed -- see mergeParallelRunAttempt's own
 * comment), and the dirty-main-root precondition (skipping it would silently lose in-progress work at
 * merge time). Does not exercise the full N-attempt LLM fan-out (startParallelRun's per-attempt Agent
 * loop) -- that requires a real network/LLM call and isn't appropriate for a unit test; the precondition
 * checks it runs BEFORE any of that are still fully covered here since they execute first and throw.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { captureTree } from "../gitCheckpoint";
import { mergeParallelRunAttempt, startParallelRun, type ParallelRunState } from "../parallelRun";

function initRepoWithCommit(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-parallelrun-test-"));
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email test@wrexlyn.local", { cwd: dir });
  execSync("git config user.name Wrexlyn Test", { cwd: dir });
  fs.writeFileSync(path.join(dir, "a.txt"), "original a");
  fs.writeFileSync(path.join(dir, "b.txt"), "original b");
  execSync("git add -A", { cwd: dir });
  execSync('git commit -q -m "initial"', { cwd: dir });
  return dir;
}

function fakeRunState(root: string, initialTreeSha: string, finalTreeSha: string | undefined): ParallelRunState {
  return {
    runId: "test-run",
    root,
    initialTreeSha,
    attempts: [
      {
        index: 0,
        worktreePath: root, // unused by mergeParallelRunAttempt itself
        agent: null as any,
        result: { attemptId: "test-run-0", index: 0, steeringNote: "note", status: "done", finalTreeSha },
        settled: Promise.resolve(),
      },
    ],
  };
}

test("mergeParallelRunAttempt: correctly applies an edit + delete + add to the main root", () => {
  const root = initRepoWithCommit();
  const initialTreeSha = captureTree(root)!;

  // Simulate a worktree attempt's changes by mutating a SEPARATE checkout of the same objects --
  // simplest reliable way to produce a second, independently-computed tree SHA in the same repo
  // without needing a real `git worktree add` here (already covered by worktree.test.ts).
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-parallelrun-attempt-"));
  execSync(`git worktree add --detach "${worktree}" HEAD`, { cwd: root });
  fs.writeFileSync(path.join(worktree, "a.txt"), "edited a"); // edit
  fs.rmSync(path.join(worktree, "b.txt")); // delete
  fs.writeFileSync(path.join(worktree, "c.txt"), "new c"); // add
  const winnerTreeSha = captureTree(worktree)!;

  const state = fakeRunState(root, initialTreeSha, winnerTreeSha);
  const result = mergeParallelRunAttempt(state, 0);

  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.treeSnapshot, { beforeTree: initialTreeSha, afterTree: winnerTreeSha });

  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf-8"), "edited a");
  assert.equal(fs.existsSync(path.join(root, "b.txt")), false);
  assert.equal(fs.readFileSync(path.join(root, "c.txt"), "utf-8"), "new c");
  assert.equal(captureTree(root), winnerTreeSha, "main root's tree must match the winning attempt's tree byte-for-byte");

  execSync(`git worktree remove --force "${worktree}"`, { cwd: root });
});

test("mergeParallelRunAttempt: refuses (rather than clobbers) if the main root changed since the run started", () => {
  const root = initRepoWithCommit();
  const initialTreeSha = captureTree(root)!;

  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-parallelrun-attempt2-"));
  execSync(`git worktree add --detach "${worktree}" HEAD`, { cwd: root });
  fs.writeFileSync(path.join(worktree, "a.txt"), "attempt's edit");
  const winnerTreeSha = captureTree(worktree)!;

  // The user edits the main root themselves while the (simulated) N attempts were running.
  fs.writeFileSync(path.join(root, "a.txt"), "the user's own concurrent edit");

  const state = fakeRunState(root, initialTreeSha, winnerTreeSha);
  const result = mergeParallelRunAttempt(state, 0);

  assert.equal(result.ok, false);
  assert.ok(result.reason);
  // The user's own edit must survive untouched -- refusing, not silently overwriting it.
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf-8"), "the user's own concurrent edit");

  execSync(`git worktree remove --force "${worktree}"`, { cwd: root });
});

test("mergeParallelRunAttempt: fails cleanly when the attempt hasn't finished (no finalTreeSha yet)", () => {
  const root = initRepoWithCommit();
  const initialTreeSha = captureTree(root)!;
  const state = fakeRunState(root, initialTreeSha, undefined);

  const result = mergeParallelRunAttempt(state, 0);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /hasn't finished/);
});

test("startParallelRun: refuses when the main root is not a git repository", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-parallelrun-nogit-"));
  await assert.rejects(
    startParallelRun({ root: dir, task: "do something", n: 2, llmConfig: { provider: "pollinations", model: "openai" }, onEvent: () => {} }),
    /git repository/
  );
});

test("startParallelRun: refuses when the main root has uncommitted changes", async () => {
  const root = initRepoWithCommit();
  fs.writeFileSync(path.join(root, "a.txt"), "dirty, uncommitted");

  await assert.rejects(
    startParallelRun({ root, task: "do something", n: 2, llmConfig: { provider: "pollinations", model: "openai" }, onEvent: () => {} }),
    /[Cc]ommit or stash/
  );
});
