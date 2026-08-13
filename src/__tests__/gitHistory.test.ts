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
import { getRecentActivity, _resetGitHistoryCacheForTesting } from "../gitHistory";

function initRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-githist-test-"));
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email test@wrexlyn.local", { cwd: dir });
  execSync("git config user.name Wrexlyn Test", { cwd: dir });
  return dir;
}

function commitFile(root: string, relPath: string, content: string, message: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  execSync("git add -A", { cwd: root });
  execSync(`git commit -q -m "${message}"`, { cwd: root });
}

test("getRecentActivity: null for a non-git directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-nogit-test-"));
  assert.equal(getRecentActivity(dir), null);
});

test("getRecentActivity: files come back most-recently-committed first, deduped", () => {
  _resetGitHistoryCacheForTesting();
  const root = initRepo();
  commitFile(root, "a.txt", "a", "add a");
  commitFile(root, "b.txt", "b", "add b");
  commitFile(root, "a.txt", "a2", "modify a"); // a.txt should sort back to most-recent

  const activity = getRecentActivity(root);
  assert.ok(activity);
  assert.equal(activity!.files[0], "a.txt");
  assert.ok(activity!.files.includes("b.txt"));
  // deduped -- a.txt appears in two commits but only once in the result
  assert.equal(activity!.files.filter((f) => f === "a.txt").length, 1);
});

test("getRecentActivity: memoizes within the TTL until explicitly reset", () => {
  _resetGitHistoryCacheForTesting();
  const root = initRepo();
  commitFile(root, "a.txt", "a", "add a");
  const first = getRecentActivity(root);
  assert.ok(first);
  assert.ok(!first!.files.includes("b.txt"));

  commitFile(root, "b.txt", "b", "add b"); // new commit made after the first call above
  const second = getRecentActivity(root);
  assert.deepEqual(second, first, "still within the TTL -- must return the memoized result, not re-query git");

  _resetGitHistoryCacheForTesting();
  const third = getRecentActivity(root);
  assert.ok(third!.files.includes("b.txt"), "after an explicit reset, the new commit must be visible");
});
