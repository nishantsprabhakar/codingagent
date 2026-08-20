/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Regression coverage for the bug this session's 429 fix was built around: a provider's own
 * 429/5xx backoff sleep happens before any stream chunk arrives, so nothing resets
 * withIdleTimeout's deadline during that wait unless the retry callback explicitly calls
 * heartbeat() too. Without that, a legitimate, bounded backoff can itself trip the idle timeout
 * and abort the whole turn -- these tests pin the exact mechanism, using a short idleMs instead
 * of the real 90s constant so the suite stays fast.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { withIdleTimeout } from "../timeout";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("withIdleTimeout: a heartbeat during a long wait prevents the idle timeout from firing", async () => {
  const result = await withIdleTimeout(
    async (heartbeat) => {
      // Two 60ms waits with a heartbeat between them -- each individual gap is under the 100ms
      // idle deadline, so the call should complete even though the total elapsed time (120ms)
      // exceeds it.
      await sleep(60);
      heartbeat();
      await sleep(60);
      return "done";
    },
    100,
    "test call"
  );
  assert.equal(result, "done");
});

test("withIdleTimeout: the same total wait with NO intervening heartbeat does time out", async () => {
  await assert.rejects(
    () =>
      withIdleTimeout(
        async () => {
          await sleep(120); // one continuous gap, never reset -- must exceed the 100ms deadline
          return "done";
        },
        100,
        "test call"
      ),
    /test call went silent for 100ms/
  );
});

test("withIdleTimeout: this is exactly the failure mode a provider's own retry backoff can trigger without an onRetry->heartbeat wire-up", async () => {
  // Simulates two consecutive 429 backoff sleeps (as agent.ts's onRetry callback is meant to
  // guard against) -- without calling heartbeat before each one, the idle watchdog kills the
  // call partway through the *first* backoff, well before a real response ever streams back.
  await assert.rejects(
    () =>
      withIdleTimeout(
        async () => {
          await sleep(60); // "backoff #1" -- no heartbeat call, unlike the real onRetry wiring
          await sleep(60); // "backoff #2"
          return { content: "real response, arrived too late" };
        },
        100,
        "model call"
      ),
    /model call went silent for 100ms/
  );
});
