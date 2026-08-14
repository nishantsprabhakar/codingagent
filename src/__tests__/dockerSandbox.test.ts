/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * These tests are tolerant of whether Docker is actually installed/running in the environment
 * they execute in (it usually won't be, in CI) — see each test's comment for how it handles that.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isDockerAvailable, runInDockerSandbox, _resetDockerAvailabilityCacheForTesting, DEFAULT_SANDBOX_IMAGE } from "../dockerSandbox";
import { runOne, type ShellRequest } from "../shellService";

test("isDockerAvailable: resolves to a boolean without throwing, regardless of whether Docker is installed here", async () => {
  _resetDockerAvailabilityCacheForTesting();
  const available = await isDockerAvailable();
  assert.equal(typeof available, "boolean");
});

test("isDockerAvailable: caches its result across calls within the process", async () => {
  _resetDockerAvailabilityCacheForTesting();
  const first = await isDockerAvailable();
  const second = await isDockerAvailable();
  assert.equal(first, second);
});

test("runInDockerSandbox: runs a real command in a container and returns its output", async (t) => {
  _resetDockerAvailabilityCacheForTesting();
  if (!(await isDockerAvailable())) {
    t.skip("Docker is not available in this environment");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-dockersandbox-test-"));
  fs.writeFileSync(path.join(dir, "marker.txt"), "hello from host");

  const result = await runInDockerSandbox("cat marker.txt", dir, 30_000, DEFAULT_SANDBOX_IMAGE);
  assert.equal(result.ok, true);
  assert.ok(result.output.includes("hello from host"));
});

test("runInDockerSandbox: a failing command inside the container reports failure, not a thrown error", async (t) => {
  _resetDockerAvailabilityCacheForTesting();
  if (!(await isDockerAvailable())) {
    t.skip("Docker is not available in this environment");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-dockersandbox-test-"));
  const result = await runInDockerSandbox("exit 7", dir, 30_000, DEFAULT_SANDBOX_IMAGE);
  assert.equal(result.ok, false);
  assert.ok(result.output.includes("exited with code"));
});

// Fully environment-forced "Docker unreachable" case: stripping PATH means the `docker` binary
// itself can't be found, which is indistinguishable from Docker not being installed at all —
// exactly the fallback path runOne() must handle gracefully instead of failing the whole command.
test("runOne: falls back to host execution with a visible warning when sandbox is requested but Docker is unreachable", async () => {
  const realPath = process.env.PATH;
  process.env.PATH = "";
  _resetDockerAvailabilityCacheForTesting();
  try {
    const req: ShellRequest = {
      id: "test-1",
      command: process.platform === "win32" ? "echo fallback-ran" : "echo fallback-ran",
      cwd: process.cwd(),
      sandbox: true,
    };
    const response = await runOne(req);
    assert.equal(response.ok, true);
    assert.ok(response.output.includes("--sandbox was requested but Docker is unreachable"), response.output);
    assert.ok(response.output.includes("fallback-ran"));
  } finally {
    process.env.PATH = realPath;
    _resetDockerAvailabilityCacheForTesting();
  }
});

test("runOne: sandbox not requested runs directly on host with no warning", async () => {
  const req: ShellRequest = { id: "test-2", command: "echo plain-host-run", cwd: process.cwd() };
  const response = await runOne(req);
  assert.equal(response.ok, true);
  assert.ok(response.output.includes("plain-host-run"));
  assert.ok(!response.output.includes("Docker"));
});
