/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createWorktree, linkSharedDependencies, removeWorktree, sweepOrphanedWorktrees, generateRunId } from "../worktree";

function initRepoWithCommit(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-worktree-test-"));
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email test@wrexlyn.local", { cwd: dir });
  execSync("git config user.name Wrexlyn Test", { cwd: dir });
  fs.writeFileSync(path.join(dir, "a.txt"), "hello");
  execSync("git add -A", { cwd: dir });
  execSync('git commit -q -m "initial"', { cwd: dir });
  return dir;
}

test("createWorktree: creates a detached-HEAD checkout at the returned path", () => {
  const root = initRepoWithCommit();
  const runId = generateRunId();
  const worktreePath = createWorktree(root, runId, 0);

  assert.ok(worktreePath);
  assert.equal(fs.existsSync(worktreePath!), true);
  assert.equal(fs.readFileSync(path.join(worktreePath!, "a.txt"), "utf-8"), "hello");

  removeWorktree(root, worktreePath!);
});

test("createWorktree: a fresh worktree is unaffected by uncommitted changes in the main root", () => {
  const root = initRepoWithCommit();
  fs.writeFileSync(path.join(root, "a.txt"), "dirty-uncommitted-edit"); // dirty the main root
  fs.writeFileSync(path.join(root, "untracked.txt"), "should not appear in the worktree");

  const runId = generateRunId();
  const worktreePath = createWorktree(root, runId, 0);
  assert.ok(worktreePath);
  assert.equal(fs.readFileSync(path.join(worktreePath!, "a.txt"), "utf-8"), "hello", "worktree must reflect last-committed content, not the dirty main root");
  assert.equal(fs.existsSync(path.join(worktreePath!, "untracked.txt")), false);

  removeWorktree(root, worktreePath!);
});

test("linkSharedDependencies: links an existing dependency dir, skips a missing one", () => {
  const root = initRepoWithCommit();
  fs.mkdirSync(path.join(root, "node_modules", "some-pkg"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "some-pkg", "index.js"), "module.exports = 1;");
  // .venv deliberately not created -- linkSharedDependencies must skip it without throwing.

  const runId = generateRunId();
  const worktreePath = createWorktree(root, runId, 0)!;
  linkSharedDependencies(root, worktreePath);

  assert.equal(fs.existsSync(path.join(worktreePath, "node_modules", "some-pkg", "index.js")), true);
  assert.equal(fs.existsSync(path.join(worktreePath, ".venv")), false);

  removeWorktree(root, worktreePath);
});

test("removeWorktree: actually removes the worktree registration and its directory", () => {
  const root = initRepoWithCommit();
  const runId = generateRunId();
  const worktreePath = createWorktree(root, runId, 0)!;
  assert.equal(fs.existsSync(worktreePath), true);

  const removed = removeWorktree(root, worktreePath);
  assert.equal(removed, true);
  assert.equal(fs.existsSync(worktreePath), false);

  const listing = execSync("git worktree list", { cwd: root }).toString("utf-8");
  assert.ok(!listing.includes(worktreePath));
});

test("removeWorktree: returns false for a path that was never a worktree", () => {
  const root = initRepoWithCommit();
  assert.equal(removeWorktree(root, path.join(os.tmpdir(), "not-a-real-worktree-xyz")), false);
});

test("sweepOrphanedWorktrees: removes only worktrees matching this module's own naming convention", () => {
  const root = initRepoWithCommit();
  const runId = generateRunId();
  const ours = createWorktree(root, runId, 0)!;
  // git reports paths with forward slashes and in canonical (long-form) casing, while os.tmpdir()
  // can return a backslash, 8.3-short-form path on Windows (the same class of mismatch isGitRepo()
  // already has to handle) -- normalize both sides before comparing, rather than a fragile raw
  // string match. path.basename() itself (used by the production sweepOrphanedWorktrees) already
  // handles forward slashes fine on Windows -- confirmed directly -- so this is a test-only concern.
  const oursCanonical = fs.realpathSync.native(ours).replace(/\\/g, "/");

  // Simulate a leftover from a crashed prior run -- still registered, never cleaned up.
  const listingBefore = execSync("git worktree list", { cwd: root }).toString("utf-8");
  assert.ok(listingBefore.includes(oursCanonical));

  const removed = sweepOrphanedWorktrees(root);
  // removed[] is parsed directly from git's own (already-canonical, forward-slash) `worktree list`
  // output, same as oursCanonical -- no further realpath needed (and can't be: the directory is
  // gone by now).
  assert.deepEqual(removed, [oursCanonical]);
  assert.equal(fs.existsSync(ours), false);

  const listingAfter = execSync("git worktree list", { cwd: root }).toString("utf-8");
  assert.ok(!listingAfter.includes(oursCanonical));
});

test("sweepOrphanedWorktrees: never touches a worktree it didn't create (foreign naming)", () => {
  const root = initRepoWithCommit();
  const foreignPath = fs.mkdtempSync(path.join(os.tmpdir(), "some-other-tool-worktree-"));
  fs.rmSync(foreignPath, { recursive: true, force: true }); // git worktree add wants to create the dir itself
  execSync(`git worktree add --detach "${foreignPath}" HEAD`, { cwd: root });

  const removed = sweepOrphanedWorktrees(root);
  assert.deepEqual(removed, []);
  assert.equal(fs.existsSync(foreignPath), true);

  execSync(`git worktree remove --force "${foreignPath}"`, { cwd: root }); // clean up after the test
});
