/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Exercises kilo.ts's retry loop against a stubbed global.fetch -- no existing test mocked fetch
 * or a provider's retry loop before this. Deliberately not hammering the real, shared, free kilo
 * endpoint to produce a live 429; this is a deterministic, repeatable way to prove the same thing.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chatCompletion } from "../providers/kilo";
import type { RetryNotice } from "../types";

const realFetch = global.fetch;

after(() => {
  global.fetch = realFetch;
});

function sseBody(content: string): string {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
}

test("kilo.chatCompletion: retries once on a 429 (with Retry-After: 0, for a fast deterministic test), firing onRetry, then succeeds", async () => {
  let callCount = 0;
  global.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response("", { status: 429, headers: { "retry-after": "0" } });
    }
    return new Response(sseBody("hello from kilo"), { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;

  const retryNotices: RetryNotice[] = [];
  const result = await chatCompletion(
    [{ role: "user", content: "hi" }],
    [],
    "kilo-auto/free",
    5,
    undefined,
    undefined,
    undefined,
    (info) => retryNotices.push(info)
  );

  assert.equal(callCount, 2);
  assert.equal(result.content, "hello from kilo");
  assert.equal(retryNotices.length, 1);
  assert.equal(retryNotices[0].provider, "kilo");
  assert.equal(retryNotices[0].status, 429);
  assert.equal(retryNotices[0].attempt, 1);
  assert.equal(retryNotices[0].maxRetries, 5);
  assert.equal(retryNotices[0].waitMs, 0);
});

