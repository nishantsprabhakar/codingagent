/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeRetryExhausted, createMinIntervalGate, computeRetryDelayMs } from "../providers/retryPolicy";

test("describeRetryExhausted: a 429 message is self-explanatory and actionable", () => {
  const msg = describeRetryExhausted("kilo", "kilo-auto/free", 429);
  assert.match(msg, /kilo rate-limited this request \(429\)/);
  assert.match(msg, /kilo-auto\/free/);
  assert.match(msg, /clears on the provider's own schedule/);
  assert.match(msg, /switch to a different free model or provider/);
});

test("describeRetryExhausted: a 5xx message is shorter and doesn't claim a rate limit", () => {
  const msg = describeRetryExhausted("Groq", "llama-3.1-70b", 503);
  assert.match(msg, /Groq API returned 503/);
  assert.doesNotMatch(msg, /rate-limited/);
});

test("describeRetryExhausted: works with an empty model name", () => {
  const msg = describeRetryExhausted("OpenRouter", "", 429);
  assert.match(msg, /OpenRouter rate-limited this request \(429\)\./);
});

test("createMinIntervalGate: concurrent acquire() calls resolve serialized with the minimum spacing", async () => {
  const gate = createMinIntervalGate(50);
  const start = Date.now();
  const arrivals: number[] = [];

  await Promise.all(
    [0, 1, 2, 3].map(() =>
      gate().then(() => {
        arrivals.push(Date.now() - start);
      })
    )
  );

  assert.equal(arrivals.length, 4);
  arrivals.sort((a, b) => a - b);
  // Each successive arrival should be at least ~minIntervalMs after the previous one (a little
  // slack for real timer jitter -- this asserts real serialization, not fake-timer bookkeeping).
  for (let i = 1; i < arrivals.length; i++) {
    assert.ok(arrivals[i] - arrivals[i - 1] >= 40, `expected >=40ms spacing, got ${arrivals[i] - arrivals[i - 1]}ms`);
  }
});

test("createMinIntervalGate: a lone acquire() resolves immediately, no artificial delay", async () => {
  const gate = createMinIntervalGate(500);
  const start = Date.now();
  await gate();
  assert.ok(Date.now() - start < 100);
});

test("computeRetryDelayMs: honors a numeric Retry-After header over the jittered fallback", () => {
  const delay = computeRetryDelayMs(429, "5", 0);
  assert.equal(delay, 5000);
});

test("computeRetryDelayMs: caps a Retry-After header at 90s", () => {
  const delay = computeRetryDelayMs(429, "9999", 0);
  assert.equal(delay, 90_000);
});
