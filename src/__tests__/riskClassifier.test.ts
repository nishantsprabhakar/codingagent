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
