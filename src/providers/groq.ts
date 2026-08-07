/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { ChatMessage, ToolDefinition, ChatCompletionResult } from "../types";
import { consumeSseStream } from "./sseStream";

const BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

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
        throwFatal("Groq rejected the API key (401/403). Check that GROQ_API_KEY / --api-key is correct and active.");
      }

      if (res.status === 429 || res.status >= 500) {
        const waitMs = Math.min(2000 * 2 ** attempt, 20000);
        lastError = new Error(`Groq API returned ${res.status}`);
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throwFatal(`Groq API error ${res.status}: ${text.slice(0, 800)}`);
      }

      // Once the stream starts, its content may already be visible to the user via
      // onDelta — retrying from here would re-emit/duplicate that, so a failure past
      // this point surfaces as a real error instead of being silently retried.
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

  throw lastError ?? new Error("Groq API request failed");
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
