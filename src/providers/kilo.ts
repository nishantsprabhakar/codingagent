/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Zero-key default provider. Replaces Pollinations (src/providers/pollinations.ts, removed
 * 2026-08-14): Pollinations dropped anonymous tool-calling entirely, returning a 402 Payment
 * Required for any request that includes `tools` — confirmed live, not from stale docs — so it can
 * no longer back an agent that can't function without tool calls. Kilo's gateway (https://kilo.ai)
 * routes anonymous requests to a rotating set of free upstream models with no signup and no key;
 * `kilo-auto/free` auto-picks "the best available free model" per session, confirmed live to return
 * real OpenAI-shaped streamed tool_calls with no Authorization header at all. Anonymous access is
 * capped at 200 requests/hour per IP (per Kilo's docs) — no key means no way to raise that.
 */
import type { ChatMessage, ToolDefinition, ChatCompletionResult } from "../types";
import { consumeSseStream } from "./sseStream";
import { computeRetryDelayMs } from "./retryPolicy";

const BASE_URL = "https://api.kilo.ai/api/gateway/chat/completions";

export async function chatCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model: string,
  maxRetries = 5,
  onDelta?: (chunk: string) => void,
  temperature?: number,
  signal?: AbortSignal
): Promise<ChatCompletionResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          model,
          messages,
          tools: tools.length ? tools : undefined,
          tool_choice: tools.length ? "auto" : undefined,
          temperature: temperature ?? 0.15,
          max_tokens: 8000,
          stream: true,
          stream_options: { include_usage: true },
        }),
      });

      if (res.status === 429 || res.status >= 500) {
        const waitMs = computeRetryDelayMs(res.status, res.headers.get("retry-after"), attempt);
        lastError = new Error(`Kilo API returned ${res.status}`);
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throwFatal(`Kilo API error ${res.status}: ${text.slice(0, 800)}`);
      }

      const { content, reasoning, toolCalls, finishReason, usage } = await consumeSseStream(res, onDelta);
      const rawContent = content?.trim() ? content : reasoning?.trim() ? reasoning : null;

      if (finishReason === "length") {
        console.error("[coding-agent] warning: response was truncated by the token limit (finish_reason=length)");
      }

      if (!rawContent && toolCalls.length === 0 && attempt < maxRetries) {
        lastError = new Error("Kilo returned an empty response");
        await sleep(Math.min(1000 * 2 ** attempt, 10000));
        continue;
      }

      return { content: rawContent, toolCalls, usage };
    } catch (err: any) {
      lastError = err;
      if (err.fatal || err?.name === "AbortError") throw err;
      if (attempt < maxRetries) {
        await sleep(Math.min(1500 * 2 ** attempt, 15000));
      }
    }
  }

  throw lastError ?? new Error("Kilo API request failed");
}

/** Throws an error marked non-retryable — a genuine policy rejection that a backoff loop can't fix. */
function throwFatal(message: string): never {
  const err: any = new Error(message);
  err.fatal = true;
  throw err;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
