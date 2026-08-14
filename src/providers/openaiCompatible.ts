/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Groq, OpenRouter, Gemini, Cerebras, and Mistral all speak the same
 * OpenAI-compatible chat-completions shape — same request body, same SSE
 * stream format — differing only in base URL and how they reject a bad key.
 * This factory is that shared client; each provider file is just its config.
 */
import type { ChatMessage, ToolDefinition, ChatCompletionResult } from "../types";
import { consumeSseStream } from "./sseStream";
import { computeRetryDelayMs } from "./retryPolicy";

export interface OpenAiCompatibleConfig {
  /** Full chat-completions endpoint URL. */
  baseUrl: string;
  /** Display name used in error messages, e.g. "Gemini". */
  label: string;
  /** Env var name mentioned in the "bad key" error, e.g. "GEMINI_API_KEY". */
  apiKeyEnvHint: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Throws an error marked non-retryable — e.g. a rejected key that a backoff loop can't fix. */
function throwFatal(message: string): never {
  const err: any = new Error(message);
  err.fatal = true;
  throw err;
}

export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig) {
  return (
    messages: ChatMessage[],
    tools: ToolDefinition[],
    model: string,
    apiKey: string,
    maxRetries = 5,
    onDelta?: (chunk: string) => void,
    temperature?: number
  ): Promise<ChatCompletionResult> =>
    runOpenAiCompatibleChatCompletion(config, messages, tools, model, apiKey, maxRetries, onDelta, temperature);
}

/**
 * The actual request/retry/SSE-consumption logic, taking `config` per call instead of captured at creation time —
 * lets the "custom" provider (src/providers/custom.ts) reuse it with a user-configured, only-known-at-runtime
 * baseUrl. `createOpenAiCompatibleProvider` above is just a thin closure over this for the fixed-baseUrl providers.
 */
export async function runOpenAiCompatibleChatCompletion(
  config: OpenAiCompatibleConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model: string,
  apiKey: string,
  maxRetries = 5,
  onDelta?: (chunk: string) => void,
  temperature?: number
): Promise<ChatCompletionResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(config.baseUrl, {
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
          temperature: temperature ?? 0.15,
          max_tokens: 8000,
          stream: true,
          // Opt-in flag for the OpenAI-compatible streaming shape: without it, most providers never send
          // the token-usage chunk at all. A provider that doesn't recognize this field just ignores it.
          stream_options: { include_usage: true },
        }),
      });

      if (res.status === 401 || res.status === 403) {
        throwFatal(
          `${config.label} rejected the API key (401/403). Check that ${config.apiKeyEnvHint} / --api-key is correct and active.`
        );
      }

      if (res.status === 404) {
        throwFatal(
          `${config.label} returned 404 for model "${model}" — it may be misspelled, renamed, or not available on ` +
            `your account. Check ${config.label}'s current model list and pass the exact id with --model.`
        );
      }

      if (res.status === 429 || res.status >= 500) {
        const waitMs = computeRetryDelayMs(res.status, res.headers.get("retry-after"), attempt);
        lastError = new Error(`${config.label} API returned ${res.status}`);
        await sleep(waitMs);
        continue;
      }

      if (res.status === 400) {
        const text = await res.text().catch(() => "");
        throwFatal(
          `${config.label} rejected this request (400). This can happen after switching models/providers ` +
            `mid-conversation, which can leave tool-call metadata in the history that ${config.label} doesn't ` +
            `recognize — try switching back to the provider you started this conversation with, or start a new ` +
            `session. Raw error: ${text.slice(0, 500)}`
        );
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throwFatal(`${config.label} API error ${res.status}: ${text.slice(0, 800)}`);
      }

      // Once the stream starts, its content may already be visible to the user via
      // onDelta — retrying from here would re-emit/duplicate that, so a failure past
      // this point surfaces as a real error instead of being silently retried.
      const { content, toolCalls, finishReason, usage } = await consumeSseStream(res, onDelta);

      if (finishReason === "length") {
        console.error(`[coding-agent] warning: response was truncated by the token limit (finish_reason=length)`);
      }

      return { content, toolCalls, usage };
    } catch (err: any) {
      lastError = err;
      if (err.fatal) throw err;
      if (attempt < maxRetries) {
        await sleep(Math.min(1500 * 2 ** attempt, 15000));
      }
    }
  }

  throw lastError ?? new Error(`${config.label} API request failed`);
}
