/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * groq.ts/openrouter.ts/openaiCompatible.ts's retry wiring against a stubbed global.fetch --
 * none of these three have a pacing gate (unlike kilo.ts, see kiloProvider.test.ts), so these
 * stay fast regardless of how many retries a test exercises. Uses "retry-after: 0" throughout so
 * every retry sleep is 0ms and this file runs near-instantly.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chatCompletion as groqChatCompletion } from "../providers/groq";
import { chatCompletion as openrouterChatCompletion } from "../providers/openrouter";
import { runOpenAiCompatibleChatCompletion } from "../providers/openaiCompatible";
import type { RetryNotice } from "../types";

const realFetch = global.fetch;

after(() => {
  global.fetch = realFetch;
});

function alwaysRateLimited(): void {
  global.fetch = (async () => new Response("", { status: 429, headers: { "retry-after": "0" } })) as typeof fetch;
}

test("groq.chatCompletion: exhausting retries throws the shared, self-explanatory 429 message and fires onRetry each attempt", async () => {
  alwaysRateLimited();
  const notices: RetryNotice[] = [];

  await assert.rejects(
    () =>
      groqChatCompletion(
        [{ role: "user", content: "hi" }],
        [],
        "llama-3.1-70b",
        "fake-key",
        2,
        undefined,
        undefined,
        undefined,
        (info) => notices.push(info)
      ),
    /Groq rate-limited this request \(429\) for "llama-3\.1-70b"/
  );
  assert.equal(notices.length, 3); // maxRetries=2 -> attempts 0,1,2
  assert.deepEqual(notices.map((n) => n.provider), ["Groq", "Groq", "Groq"]);
  assert.deepEqual(notices.map((n) => n.attempt), [1, 2, 3]);
});

test("openrouter.chatCompletion: exhausting retries throws the shared 429 message with the model name", async () => {
  alwaysRateLimited();
  await assert.rejects(
    () => openrouterChatCompletion([{ role: "user", content: "hi" }], [], "some/free-model", "fake-key", 1),
    /OpenRouter rate-limited this request \(429\) for "some\/free-model"/
  );
});

test("openaiCompatible: exhausting retries throws with the given provider label, not a hardcoded one", async () => {
  alwaysRateLimited();
  await assert.rejects(
    () =>
      runOpenAiCompatibleChatCompletion(
        { baseUrl: "https://example.invalid/chat", label: "Cerebras", apiKeyEnvHint: "CEREBRAS_API_KEY" },
        [{ role: "user", content: "hi" }],
        [],
        "some-model",
        "fake-key",
        1
      ),
    /Cerebras rate-limited this request \(429\) for "some-model"/
  );
});

test("groq.chatCompletion: a 5xx gets the shorter transient-failure message, not the rate-limit framing", async () => {
  global.fetch = (async () => new Response("", { status: 503 })) as typeof fetch;
  await assert.rejects(
    () => groqChatCompletion([{ role: "user", content: "hi" }], [], "llama-3.1-70b", "fake-key", 0),
    (err: Error) => {
      assert.match(err.message, /Groq API returned 503/);
      assert.doesNotMatch(err.message, /rate-limited/);
      return true;
    }
  );
});
