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
import { isGitRepo, captureTree, restoreTree } from "../gitCheckpoint";

function initRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-gitckpt-test-"));
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email test@wrexlyn.local", { cwd: dir });
  execSync("git config user.name Wrexlyn Test", { cwd: dir });
  return dir;
}

function write(root: string, relPath: string, content: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

test("isGitRepo: true at toplevel", () => {
  const root = initRepo();
  assert.equal(isGitRepo(root), true);
});

test("isGitRepo: false for a plain non-git directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-nogit-test-"));
  assert.equal(isGitRepo(dir), false);
});

test("isGitRepo: false when root is nested inside a bigger repo", () => {
  const root = initRepo();
  const nested = path.join(root, "subdir");
  fs.mkdirSync(nested);
  assert.equal(isGitRepo(nested), false);
});

test("captureTree: stable across a no-op, changes across create/modify/delete", () => {
  const root = initRepo();
  write(root, "a.txt", "hello");

  const t1 = captureTree(root);
  const t2 = captureTree(root);
  assert.equal(t1, t2, "capturing twice with no changes must produce the identical tree SHA");

  write(root, "b.txt", "new file");
  const t3 = captureTree(root);
  assert.notEqual(t1, t3);
});

test("captureTree: excludes a .gitignore'd file", () => {
  const root = initRepo();
  write(root, ".gitignore", "ignored.txt\n");
  write(root, "ignored.txt", "should never be captured");
  const tree = captureTree(root)!;
  const lsTree = execSync(`git ls-tree -r ${tree}`, { cwd: root }).toString("utf-8");
  assert.ok(!lsTree.includes("ignored.txt"));
});

test("restoreTree: create+modify+delete in one action, restore removes the created file and brings back the rest", () => {
  const root = initRepo();
  write(root, "keep-modified.txt", "original content");
  write(root, "to-delete.txt", "will be deleted");

  const beforeTree = captureTree(root)!;

  // Simulate a shell command's effects: modify one file, delete another, create a third.
  write(root, "keep-modified.txt", "modified content");
  fs.rmSync(path.join(root, "to-delete.txt"));
  write(root, "created.txt", "brand new");

  const afterTree = captureTree(root)!;

  const result = restoreTree(root, beforeTree, afterTree);
  assert.equal(result.ok, true);
  assert.equal(result.conflict, false);
  assert.equal(fs.existsSync(path.join(root, "created.txt")), false, "the created file must be removed on rollback");
  assert.equal(fs.readFileSync(path.join(root, "keep-modified.txt"), "utf-8"), "original content");
  assert.equal(fs.readFileSync(path.join(root, "to-delete.txt"), "utf-8"), "will be deleted");
});

test("restoreTree: never rewrites a file the action didn't touch (regression — checkout must be scoped to the diff, not the whole tree)", () => {
  const root = initRepo();
  write(root, "changed.txt", "before");
  write(root, "untouched.txt", "never touched by the action");

  const beforeTree = captureTree(root)!;
  write(root, "changed.txt", "after");
  const afterTree = captureTree(root)!;

  const untouchedPath = path.join(root, "untouched.txt");
  const mtimeBefore = fs.statSync(untouchedPath).mtimeMs;

  const result = restoreTree(root, beforeTree, afterTree);

  assert.equal(result.ok, true);
  assert.deepEqual(result.restoredPaths, ["changed.txt"], "only the file the diff says changed should be checked out");
  assert.equal(fs.statSync(untouchedPath).mtimeMs, mtimeBefore, "an unrelated file's mtime must never change — checkout-index must be scoped to the diff, not -a (the whole tree)");
});

test("restoreTree: aborts entirely if the workspace changed after the action finished", () => {
  const root = initRepo();
  write(root, "a.txt", "original");
  const beforeTree = captureTree(root)!;

  write(root, "a.txt", "modified by the shell command");
  const afterTree = captureTree(root)!;

  write(root, "a.txt", "someone else's edit"); // happens after the action finished

  const result = restoreTree(root, beforeTree, afterTree);
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf-8"), "someone else's edit", "nothing should be touched on conflict");
});

test("restoreTree: a rename decomposes into delete-old + create-new with no special handling", () => {
  const root = initRepo();
  write(root, "old-name.txt", "renamed content");
  const beforeTree = captureTree(root)!;

  fs.renameSync(path.join(root, "old-name.txt"), path.join(root, "new-name.txt"));
  const afterTree = captureTree(root)!;

  const result = restoreTree(root, beforeTree, afterTree);
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(root, "old-name.txt")), true, "old path restored from beforeTree");
  assert.equal(fs.readFileSync(path.join(root, "old-name.txt"), "utf-8"), "renamed content");
  assert.equal(fs.existsSync(path.join(root, "new-name.txt")), false, "new path removed as a created-since-before path");
});

test("restoreTree: executable bit round-trips via tree restore", { skip: process.platform === "win32" }, () => {
  const root = initRepo();
  write(root, "script.sh", "#!/bin/sh\necho hi");
  fs.chmodSync(path.join(root, "script.sh"), 0o644);
  const beforeTree = captureTree(root)!;

  fs.chmodSync(path.join(root, "script.sh"), 0o755);
  const afterTree = captureTree(root)!;

  restoreTree(root, beforeTree, afterTree);
  assert.equal(fs.statSync(path.join(root, "script.sh")).mode & 0o777, 0o644);
});

// Regression test for a real bug: checkoutPaths used to build one shell-quoted string of all
// restore paths and hand it to execSync, which invokes a real shell (cmd.exe on Windows). cmd.exe
// expands %VAR% sequences even inside double-quoted arguments, so a path legitimately containing a
// literal "%...%" (valid on NTFS) would be silently rewritten before git ever saw it, failing that
// file's restore and aborting the whole rollback. Fixed by passing paths as real argv entries
// (execFileSync, no shell involved) instead of a shell-parsed string.
test("restoreTree: a filename containing a literal %VAR%-style token restores correctly (regression)", () => {
  const root = initRepo();
  const trickyName = "file-%NOT_A_REAL_VAR%-name.txt";
  write(root, trickyName, "original content");
  const beforeTree = captureTree(root)!;

  fs.writeFileSync(path.join(root, trickyName), "modified content");
  const afterTree = captureTree(root)!;

  const result = restoreTree(root, beforeTree, afterTree);
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(path.join(root, trickyName), "utf-8"), "original content");
});

test("non-git fallback: captureTree/isGitRepo never throw on a plain directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-nogit2-test-"));
  assert.equal(isGitRepo(dir), false);
  assert.equal(captureTree(dir), null);
});
