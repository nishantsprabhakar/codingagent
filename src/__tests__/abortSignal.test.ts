/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Regression coverage for the abortCurrentTurn() / stop-button plumbing: a user-initiated abort must
 * reject immediately as an AbortError and must never be silently retried the way a transient network
 * error is — see openaiCompatible.ts's catch block, patched alongside kilo.ts/groq.ts/openrouter.ts.
 * Uses the "custom" provider against a real local HTTP server (never mocked) that intentionally never
 * responds, so the only way the call can resolve is via the abort itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "http";
import { chatCompletion } from "../providers/custom";

function startHangingServer(): Promise<{ url: string; requestCount: () => number; close: () => Promise<void> }> {
  let requestCount = 0;
  const server = http.createServer((_req, _res) => {
    requestCount++;
    // Deliberately never responds -- the only way the client's request settles is via its own abort.
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/v1/chat/completions`,
        requestCount: () => requestCount,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test("abort: a signal aborted mid-request rejects with AbortError and is never retried", async () => {
  const { url, requestCount, close } = await startHangingServer();
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);

    await assert.rejects(
      chatCompletion([{ role: "user", content: "hi" }], [], "some-model", "", url, 5, undefined, undefined, controller.signal),
      (err: any) => err?.name === "AbortError"
    );

    assert.equal(requestCount(), 1, "an aborted request must not be retried as if it were a transient failure");
  } finally {
    await close();
  }
});
