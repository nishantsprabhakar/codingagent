/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * A real end-to-end smoke test of runOne() against the actual Agent/PermissionManager machinery --
 * not mocked -- but network-free: a local HTTP server that answers every request with 401 hits
 * openaiCompatible.ts's fatal-error path (see src/providers/openaiCompatible.ts's throwFatal on
 * 401/403), which skips its retry/backoff loop entirely. An unreachable port was tried first and
 * measured at ~38s (5 retries with exponential backoff) before this fixed-fast alternative replaced it.
 * This proves the harness's real plumbing -- scratch dir creation/cleanup, the isGitRepo guard,
 * HOME/usage-dir isolation, agent.dispose() -- without ever calling a real LLM provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import type { AddressInfo } from "net";
import { runOne, isolateEvalEnvironment } from "../eval/runner";
import type { EvalTask } from "../eval/types";

// Captured at module load, before any test (or the isolation runOne() triggers as a side effect)
// has had a chance to redirect HOME/USERPROFILE -- a live os.homedir() call from inside a later
// test would otherwise observe the already-isolated scratch home instead of the real one.
const realHomeAtLoad = os.homedir();

function mkFixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-eval-smoke-fixture-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "smoke", private: true, scripts: { test: "node test.js" } }));
  fs.writeFileSync(path.join(dir, "test.js"), "process.exit(0);\n");
  return dir;
}

function startRejectingServer(): Promise<{ url: string; close: () => Promise<void>; requestCount: () => number }> {
  let requestCount = 0;
  const server = http.createServer((_req, res) => {
    requestCount++;
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "invalid api key" } }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}/v1/chat/completions`,
        close: () => new Promise((r) => server.close(() => r())),
        requestCount: () => requestCount,
      });
    });
  });
}

function tmpFilesMatching(prefix: string): string[] {
  return fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(prefix));
}

test("runOne: a fast-failing provider is captured as an error result, not a thrown exception", async (t) => {
  const repoDir = mkFixtureRepo();
  const server = await startRejectingServer();
  t.after(() => server.close());

  const task: EvalTask = { id: "smoke", title: "Smoke", prompt: "do something", difficulty: "easy", tags: [], repoDir };
  const before = tmpFilesMatching("wrexlyn-eval-run-");

  const started = Date.now();
  const result = await runOne(task, 1, { provider: "custom", model: "x", apiKey: "x", baseUrl: server.url });
  const elapsedMs = Date.now() - started;

  assert.equal(result.taskId, "smoke");
  assert.equal(result.repeat, 1);
  assert.equal(result.status, "error");
  assert.equal(result.deterministicTestPassed, null);
  assert.match(result.errorMessage ?? "", /401/);
  // The 401 path is fatal and skips openaiCompatible.ts's retry loop -- this must resolve in well
  // under the ~38s an unreachable-port/retry scenario takes, or the "fast" premise of this test broke.
  assert.ok(elapsedMs < 15_000, `expected a fast fatal failure, took ${elapsedMs}ms`);
  // Exactly one HTTP call was made -- confirms no retry happened for a 401.
  assert.equal(server.requestCount(), 1);

  // The scratch working directory runOne created must be cleaned up afterward, and the original
  // fixture repo must be untouched (runOne copies it rather than operating on it directly).
  const after = tmpFilesMatching("wrexlyn-eval-run-");
  assert.deepEqual(after, before);
  assert.ok(fs.existsSync(path.join(repoDir, "test.js")));
});

test("isolateEvalEnvironment: redirects HOME/USERPROFILE away from the real user profile", () => {
  isolateEvalEnvironment();
  assert.notEqual(process.env.USERPROFILE, realHomeAtLoad);
  assert.notEqual(process.env.HOME, realHomeAtLoad);
  assert.ok(process.env.WREXLYN_USAGE_DIR, "must set an explicit usage-export override");
  // Idempotent -- calling it again (as every runOne() call does) must not re-roll to a new scratch home.
  const first = process.env.USERPROFILE;
  isolateEvalEnvironment();
  assert.equal(process.env.USERPROFILE, first);
});
