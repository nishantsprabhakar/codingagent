/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { detectProjectMemory, refreshMissingCommands, loadProjectMemory } from "../projectMemory";

function makeTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-projectmemory-test-"));
}

function writePackageJson(root: string, scripts: Record<string, string>): void {
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", scripts }, null, 2), "utf-8");
}

test("detectProjectMemory: seeds testCommand/buildCommand/lintCommand from package.json on first run", () => {
  const root = makeTempProject();
  writePackageJson(root, { test: "node --test", build: "tsc", lint: "eslint ." });
  fs.writeFileSync(path.join(root, "package-lock.json"), "{}", "utf-8");

  const memory = detectProjectMemory(root);
  assert.equal(memory.testCommand, "npm test");
  assert.equal(memory.buildCommand, "npm run build");
  assert.equal(memory.lintCommand, "npm run lint");
});

test("refreshMissingCommands: no-op (no disk write) when all three commands are already known", () => {
  const root = makeTempProject();
  const before = { testCommand: "npm test", buildCommand: "npm run build", lintCommand: "npm run lint" };

  const after = refreshMissingCommands(root, before);
  assert.deepEqual(after, before);
  // No memory.json should have been written — nothing was missing, so no scan/save happened.
  assert.equal(fs.existsSync(path.join(root, ".coding-agent", "memory.json")), false);
});

test("refreshMissingCommands: picks up a test script added to package.json AFTER the project was already known (the actual bug)", () => {
  const root = makeTempProject();
  // Project opened with no test script yet — matches detectProjectMemory's real first-run behavior.
  writePackageJson(root, { build: "tsc" });
  const initial = detectProjectMemory(root);
  assert.equal(initial.testCommand, undefined);
  assert.equal(initial.buildCommand, "npm run build");

  // The model adds a test script mid-session via a file edit (not by running a shell command
  // containing "test" — the scenario the old code silently missed for the rest of the project's life).
  writePackageJson(root, { build: "tsc", test: "node --test" });

  const refreshed = refreshMissingCommands(root, initial);
  assert.equal(refreshed.testCommand, "npm test", "a newly-added test script must be discovered, not silently missed forever");
  assert.equal(refreshed.buildCommand, "npm run build", "an already-known command must not be disturbed");
});

test("refreshMissingCommands: persists the discovered command so it survives a later loadProjectMemory (not just the in-memory return value)", () => {
  const root = makeTempProject();
  writePackageJson(root, {});
  const initial = detectProjectMemory(root);
  assert.equal(initial.testCommand, undefined);

  writePackageJson(root, { test: "vitest" });
  refreshMissingCommands(root, initial);

  const reloaded = loadProjectMemory(root);
  assert.equal(reloaded.testCommand, "npm test");
});

test("refreshMissingCommands: does not clobber unrelated existing fields (learnedLessons, preferences)", () => {
  const root = makeTempProject();
  writePackageJson(root, { test: "jest" });
  const memory = {
    buildCommand: "npm run build",
    lintCommand: "npm run lint",
    learnedLessons: ["never do X"],
    preferences: ["always use tabs"],
  };

  const refreshed = refreshMissingCommands(root, memory);
  assert.equal(refreshed.testCommand, "npm test");
  assert.deepEqual(refreshed.learnedLessons, ["never do X"]);
  assert.deepEqual(refreshed.preferences, ["always use tabs"]);
});
