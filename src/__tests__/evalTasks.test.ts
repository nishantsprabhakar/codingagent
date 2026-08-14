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
import { discoverTasks } from "../eval/tasks";

function mkTasksDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-eval-tasks-test-"));
}

function writeTask(tasksDir: string, id: string, task: object, withRepo = true): void {
  const dir = path.join(tasksDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "task.json"), JSON.stringify(task), "utf-8");
  if (withRepo) {
    const repoDir = path.join(dir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: id, scripts: { test: "node test.js" } }));
  }
}

test("discoverTasks: nonexistent directory returns empty array, not a throw", () => {
  const tasksDir = path.join(os.tmpdir(), "wrexlyn-eval-tasks-does-not-exist-" + Date.now());
  assert.deepEqual(discoverTasks(tasksDir), []);
});

test("discoverTasks: reads a well-formed fixture and fills in defaults", () => {
  const tasksDir = mkTasksDir();
  writeTask(tasksDir, "01-example", { id: "01-example", title: "Example", prompt: "Do the thing", difficulty: "easy" });

  const tasks = discoverTasks(tasksDir);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "01-example");
  assert.equal(tasks[0].title, "Example");
  assert.equal(tasks[0].prompt, "Do the thing");
  assert.equal(tasks[0].difficulty, "easy");
  assert.deepEqual(tasks[0].tags, []); // missing "tags" defaults to an empty array, not a throw
  assert.equal(tasks[0].repoDir, path.join(tasksDir, "01-example", "repo"));
});

test("discoverTasks: sorts by task id, not directory-listing order", () => {
  const tasksDir = mkTasksDir();
  writeTask(tasksDir, "03-third", { id: "03-third", title: "Third", prompt: "p", difficulty: "hard" });
  writeTask(tasksDir, "01-first", { id: "01-first", title: "First", prompt: "p", difficulty: "easy" });
  writeTask(tasksDir, "02-second", { id: "02-second", title: "Second", prompt: "p", difficulty: "medium" });

  const tasks = discoverTasks(tasksDir);
  assert.deepEqual(tasks.map((t) => t.id), ["01-first", "02-second", "03-third"]);
});

test("discoverTasks: ignores stray non-directory entries in the tasks dir", () => {
  const tasksDir = mkTasksDir();
  writeTask(tasksDir, "01-example", { id: "01-example", title: "Example", prompt: "p", difficulty: "easy" });
  fs.writeFileSync(path.join(tasksDir, "README.md"), "not a task");

  const tasks = discoverTasks(tasksDir);
  assert.equal(tasks.length, 1);
});

test("discoverTasks: throws when a task is missing task.json", () => {
  const tasksDir = mkTasksDir();
  fs.mkdirSync(path.join(tasksDir, "broken", "repo"), { recursive: true });
  assert.throws(() => discoverTasks(tasksDir), /missing task\.json/);
});

test("discoverTasks: throws when a task is missing its repo/ directory", () => {
  const tasksDir = mkTasksDir();
  writeTask(tasksDir, "broken", { id: "broken", title: "Broken", prompt: "p", difficulty: "easy" }, false);
  assert.throws(() => discoverTasks(tasksDir), /missing its repo\/ directory/);
});

test("discoverTasks: throws when task.json is missing a required field", () => {
  const tasksDir = mkTasksDir();
  writeTask(tasksDir, "broken", { id: "broken", title: "Broken", difficulty: "easy" }); // no "prompt"
  assert.throws(() => discoverTasks(tasksDir), /missing a required field/);
});
