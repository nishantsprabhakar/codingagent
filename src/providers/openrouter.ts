/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { ChatMessage, ToolDefinition, ChatCompletionResult } from "../types";
import { consumeSseStream } from "./sseStream";
import { computeRetryDelayMs } from "./retryPolicy";

const BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function chatCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model: string,
  apiKey: string,
  maxRetries = 5,
  onDelta?: (chunk: string) => void
): Promise<ChatCompletionResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools: tools.length ? tools : undefined,
          tool_choice: tools.length ? "auto" : undefined,
          temperature: 0.15,
          max_tokens: 8000,
          stream: true,
        }),
      });

      if (res.status === 401 || res.status === 403) {
        throwFatal(
          "OpenRouter rejected the API key (401/403). Check that OPENROUTER_API_KEY / --api-key is correct and active."
        );
      }

      if (res.status === 402) {
        throwFatal(
          "OpenRouter returned 402 Payment Required — this model needs account credits. Switch to a ':free' model " +
            "with --model, or add credits at https://openrouter.ai/settings/credits."
        );
      }

      if (res.status === 404) {
        throwFatal(
          `OpenRouter returned 404 for model "${model}" — it may have been renamed or removed. Check current free ` +
            `models at https://openrouter.ai/models?max_price=0 and pass the exact id with --model.`
        );
      }

      if (res.status === 429 || res.status >= 500) {
        const waitMs = computeRetryDelayMs(res.status, res.headers.get("retry-after"), attempt);
        lastError =
          res.status === 429
            ? new Error(
                `OpenRouter rate-limited this request (429) for "${model}". This is OpenRouter's own free-tier ` +
                  "quota for that specific model (shared across all anonymous/free users, not tracked by this " +
                  "app), not a local setting that needs resetting — it clears on OpenRouter's own schedule, " +
                  "typically daily. If it keeps happening, switch to a different free model or provider from the " +
                  "model picker."
              )
            : new Error(`OpenRouter API returned ${res.status}`);
        await sleep(waitMs);
        continue;
      }

      if (res.status === 400) {
        const text = await res.text().catch(() => "");
        throwFatal(
          `OpenRouter rejected this request (400). This can happen after switching models/providers mid-conversation, ` +
            `which can leave tool-call metadata in the history that the new model's provider doesn't recognize — try ` +
            `switching back to the provider you started this conversation with, or start a new session. ` +
            `Raw error: ${text.slice(0, 500)}`
        );
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throwFatal(`OpenRouter API error ${res.status}: ${text.slice(0, 800)}`);
      }

      const { content, toolCalls, finishReason } = await consumeSseStream(res, onDelta);

      if (finishReason === "length") {
        console.error("[coding-agent] warning: response was truncated by the token limit (finish_reason=length)");
      }

      return { content, toolCalls };
    } catch (err: any) {
      lastError = err;
      if (err.fatal) throw err;
      if (attempt < maxRetries) {
        await sleep(Math.min(1500 * 2 ** attempt, 15000));
      }
    }
  }

  throw lastError ?? new Error("OpenRouter API request failed");
}

/** Throws an error marked non-retryable — e.g. a rejected key that a backoff loop can't fix. */
function throwFatal(message: string): never {
  const err: any = new Error(message);
  err.fatal = true;
  throw err;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
