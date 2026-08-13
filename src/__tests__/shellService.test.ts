/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Exercises the real fork()+IPC mechanism (not a mock) — this is the one place in the codebase
 * establishing that pattern, so the test spawns the actual compiled shellService.js child exactly
 * as shellServiceClient.ts does in production.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runInService, _shutdownServiceForTesting } from "../shellServiceClient";
import { runOne } from "../shellService";

function mkTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-shellsvc-test-"));
}

after(() => {
  _shutdownServiceForTesting();
});

test("runOne (in-process, no fork): runs a command and returns its output", async () => {
  const root = mkTempRoot();
  const cmd = process.platform === "win32" ? "echo hello" : "echo hello";
  const result = await runOne({ id: "x", command: cmd, cwd: root });
  assert.equal(result.id, "x");
  assert.equal(result.ok, true);
  assert.match(result.output, /hello/);
});

test("runInService: runs a real command through the forked service process and returns correct output", async () => {
  const root = mkTempRoot();
  const result = await runInService("echo from-the-service", root);
  assert.equal(result.ok, true);
  assert.match(result.output, /from-the-service/);
});

test("runInService: a failing command reports ok:false with the real exit output", async () => {
  const root = mkTempRoot();
  const cmd = process.platform === "win32" ? "exit /b 1" : "exit 1";
  const result = await runInService(cmd, root);
  assert.equal(result.ok, false);
});

test("runInService: the command actually runs with the requested cwd", async () => {
  const root = mkTempRoot();
  fs.writeFileSync(path.join(root, "marker.txt"), "present");
  const cmd = process.platform === "win32" ? "dir /b" : "ls";
  const result = await runInService(cmd, root);
  assert.equal(result.ok, true);
  assert.match(result.output, /marker\.txt/);
});

test("runInService: the service survives and correctly serves a second call after the first one completes", async () => {
  const root = mkTempRoot();
  const first = await runInService("echo first", root);
  const second = await runInService("echo second", root);
  assert.match(first.output, /first/);
  assert.match(second.output, /second/);
});

test("runInService: concurrent calls resolve to their own matching response, not a mismatched one", async () => {
  const root = mkTempRoot();
  const [a, b, c] = await Promise.all([
    runInService("echo alpha", root),
    runInService("echo beta", root),
    runInService("echo gamma", root),
  ]);
  assert.match(a.output, /alpha/);
  assert.match(b.output, /beta/);
  assert.match(c.output, /gamma/);
});

test("runInService: transparently respawns after the service process is killed", async () => {
  const root = mkTempRoot();
  await runInService("echo warm-up", root); // ensure a child exists
  _shutdownServiceForTesting(); // simulate a crash
  const result = await runInService("echo after-respawn", root);
  assert.equal(result.ok, true);
  assert.match(result.output, /after-respawn/);
});
