/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { ChatMessage, ToolDefinition, ChatCompletionResult } from "../types";
import { consumeSseStream } from "./sseStream";

const BASE_URL = "https://text.pollinations.ai/openai";

/**
 * Anonymous Pollinations access is rate-limited (~1 req/15s) and occasionally
 * flaky, so retry with backoff on 429/5xx before giving up. It has also been
 * observed to truncate or return an empty message on longer replies without
 * an explicit max_tokens, and to sometimes put output in `reasoning` instead
 * of `content` — both are worked around below.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model: string,
  maxRetries = 5,
  onDelta?: (chunk: string) => void
): Promise<ChatCompletionResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

      if (res.status === 429 || res.status >= 500) {
        const waitMs = Math.min(2000 * 2 ** attempt, 20000);
        lastError = new Error(`Pollinations API returned ${res.status}`);
        await sleep(waitMs);
        continue;
      }

      if (res.status === 402) {
        // Observed 2026-07-30: Pollinations now requires a funded/paid account
        // specifically for tool/function-calling requests (plain chat without
        // tools still works anonymously). This agent can't function without
        // tool calls, and retrying won't help — it's a policy block, not a
        // transient error.
        throwFatal(
          "Pollinations now requires a paid account for tool-calling requests, which this agent relies on for " +
            "every action. Anonymous access no longer covers this. Switch providers instead: run 'Change Model " +
            "Key.bat', or pass --provider groq --api-key <key> (free key, no credit card, at " +
            "https://console.groq.com/keys)."
        );
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throwFatal(`Pollinations API error ${res.status}: ${text.slice(0, 800)}`);
      }

      const { content, reasoning, toolCalls, finishReason } = await consumeSseStream(res, onDelta);
      const rawContent = content?.trim() ? content : reasoning?.trim() ? reasoning : null;

      if (finishReason === "length") {
        console.error("[coding-agent] warning: response was truncated by the token limit (finish_reason=length)");
      }

      if (!rawContent && toolCalls.length === 0 && attempt < maxRetries) {
        lastError = new Error("Pollinations returned an empty response");
        await sleep(Math.min(1000 * 2 ** attempt, 10000));
        continue;
      }

      return { content: rawContent, toolCalls };
    } catch (err: any) {
      lastError = err;
      if (err.fatal) throw err;
      if (attempt < maxRetries) {
        await sleep(Math.min(1500 * 2 ** attempt, 15000));
      }
    }
  }

  throw lastError ?? new Error("Pollinations API request failed");
}

/** Throws an error marked non-retryable — e.g. a policy rejection (402) that a backoff loop can't fix. */
function throwFatal(message: string): never {
  const err: any = new Error(message);
  err.fatal = true;
  throw err;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
