/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyShellCommand, isReadOnlyIshShellCommand } from "../riskClassifier";

test("classifyShellCommand: matches a high-risk pattern", () => {
  assert.equal(classifyShellCommand("rm -rf node_modules"), "high");
  assert.equal(classifyShellCommand("git reset --hard HEAD~1"), "high");
});

test("classifyShellCommand: falls back to medium for anything else", () => {
  assert.equal(classifyShellCommand("npm install"), "medium");
  assert.equal(classifyShellCommand("echo hello"), "medium");
});

test("isReadOnlyIshShellCommand: true for plain inspection commands", () => {
  assert.equal(isReadOnlyIshShellCommand("ls -la"), true);
  assert.equal(isReadOnlyIshShellCommand("git status"), true);
  assert.equal(isReadOnlyIshShellCommand("cat package.json"), true);
  assert.equal(isReadOnlyIshShellCommand("echo hello"), true);
});

test("isReadOnlyIshShellCommand: false for a mutating command with no matching prefix", () => {
  assert.equal(isReadOnlyIshShellCommand("rm -rf build"), false);
  assert.equal(isReadOnlyIshShellCommand("npm run build"), false);
});

test("isReadOnlyIshShellCommand: an output redirect is never read-only, regardless of the leading command (regression)", () => {
  // A leading "echo"/"cat"/etc. keyword match must not override an actual write via redirect —
  // this is exactly the gate that decides whether a shell command gets a rollback checkpoint.
  assert.equal(isReadOnlyIshShellCommand("echo new > file.txt"), false);
  assert.equal(isReadOnlyIshShellCommand("echo a > a.txt && echo b > b.txt && del c.txt"), false);
  assert.equal(isReadOnlyIshShellCommand("cat file.txt > copy.txt"), false);
  assert.equal(isReadOnlyIshShellCommand("npm test 2>&1"), false);
});

// Regression test for a real bug: the regex only anchored at the start, so a whitelisted read-only
// prefix chained with an arbitrary second command (e.g. via &&) still matched as "read-only-ish" --
// which skips BOTH the pre-execution git checkpoint (shouldCheckpointTree) and post-hoc
// verification/critic review (shouldVerify) in agent.ts, since both gate on this function.
test("isReadOnlyIshShellCommand: false when a whitelisted read-only prefix is chained with another command", () => {
  assert.equal(isReadOnlyIshShellCommand("git status && rm -rf ."), false);
  assert.equal(isReadOnlyIshShellCommand("echo hi; rm -rf important"), false);
  assert.equal(isReadOnlyIshShellCommand("git log | xargs rm"), false);
  assert.equal(isReadOnlyIshShellCommand("git status || rm -rf ."), false);
  assert.equal(isReadOnlyIshShellCommand("ls & rm -rf ."), false);
  assert.equal(isReadOnlyIshShellCommand("cat $(malicious_command)"), false);
  assert.equal(isReadOnlyIshShellCommand("echo `malicious_command`"), false);
});

// Regression tests for high-risk patterns that missed realistic command-line variants.
test("classifyShellCommand: rd/rmdir recursive delete, regardless of flag order (regression)", () => {
  assert.equal(classifyShellCommand("rd /s /q build"), "high");
  assert.equal(classifyShellCommand("rmdir /q /s build"), "high");
  assert.equal(classifyShellCommand("rmdir /s build"), "high");
});

test("classifyShellCommand: erase (cmd.exe's del synonym) with destructive flags (regression)", () => {
  assert.equal(classifyShellCommand("erase /f /s /q important.txt"), "high");
  assert.equal(classifyShellCommand("erase /s /q important.txt"), "high");
});

test("classifyShellCommand: format, regardless of whether the drive letter comes before or after other flags (regression)", () => {
  assert.equal(classifyShellCommand("format /fs:ntfs /q c:"), "high");
  assert.equal(classifyShellCommand("format /q c:"), "high");
  assert.equal(classifyShellCommand("format c:"), "high");
});

test("classifyShellCommand: format does not false-positive on an unrelated command with no drive argument", () => {
  assert.equal(classifyShellCommand("npm run format"), "medium");
});
