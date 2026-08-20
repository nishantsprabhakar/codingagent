/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { ChatMessage, ToolDefinition, ChatCompletionResult, LlmConfig, LlmProvider, RetryNotice } from "./types";
import * as kilo from "./providers/kilo";
import * as groq from "./providers/groq";
import * as openrouter from "./providers/openrouter";
import * as gemini from "./providers/gemini";
import * as cerebras from "./providers/cerebras";
import * as mistral from "./providers/mistral";
import * as custom from "./providers/custom";

export type { ChatCompletionResult } from "./types";

/** Called with each chunk of assistant text as the model streams its response. */
export type OnDelta = (chunk: string) => void;

/**
 * A conversation can span a provider switch mid-session (the model picker allows this without
 * starting a new session). Two things go wrong if a raw tool_calls message from one provider's
 * turn is replayed verbatim to a different provider on the next turn:
 *
 * 1. Gemini's "thinking" models attach an opaque `extra_content.google.thought_signature` to
 *    their own tool calls (see `ToolCallRequest.extra`'s comment). Echoing that field to a
 *    different provider (e.g. Cohere via OpenRouter) sends it a field it doesn't recognize —
 *    this is the likely cause of "invalid tool call ... arguments must be a stringified JSON
 *    object"-style 400s from non-Gemini providers after switching away from Gemini.
 * 2. A tool call whose `arguments` never resolved to valid JSON (a rare streaming edge case)
 *    reaches the API as malformed input instead of being caught before the request goes out.
 *
 * Both are repaired here, once, right before dispatch — not by mutating the stored conversation
 * (a later switch back to Gemini still needs its own original thought_signature intact).
 */
function sanitizeMessagesForProvider(messages: ChatMessage[], provider: LlmProvider): ChatMessage[] {
  return messages.map((m) => {
    if (!m.tool_calls || m.tool_calls.length === 0) return m;
    return {
      ...m,
      tool_calls: m.tool_calls.map((tc) => {
        let args = tc.function.arguments;
        if (typeof args !== "string" || !args.trim()) {
          args = "{}";
        } else {
          try {
            JSON.parse(args);
          } catch {
            args = "{}";
          }
        }
        const sanitized = { id: tc.id, type: tc.type, function: { name: tc.function.name, arguments: args } };
        return provider === "gemini" && tc.extra_content
          ? { ...sanitized, extra_content: tc.extra_content }
          : sanitized;
      }),
    };
  });
}

/** Providers with a fixed baseUrl and a required key — same shape, so route them through one table instead of a
 *  growing if-chain. "custom" is handled separately below: its baseUrl is only known at runtime, and its key is
 *  optional (many local model servers need none), so it doesn't fit this table's contract. */
const KEYED_PROVIDERS: Record<
  Exclude<LlmProvider, "kilo" | "custom">,
  { chatCompletion: typeof groq.chatCompletion; envHint: string }
> = {
  groq: { chatCompletion: groq.chatCompletion, envHint: "GROQ_API_KEY" },
  openrouter: { chatCompletion: openrouter.chatCompletion, envHint: "OPENROUTER_API_KEY" },
  gemini: { chatCompletion: gemini.chatCompletion, envHint: "GEMINI_API_KEY" },
  cerebras: { chatCompletion: cerebras.chatCompletion, envHint: "CEREBRAS_API_KEY" },
  mistral: { chatCompletion: mistral.chatCompletion, envHint: "MISTRAL_API_KEY" },
};

export async function chatCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  config: LlmConfig,
  onDelta?: OnDelta,
  signal?: AbortSignal,
  onRetry?: (info: RetryNotice) => void
): Promise<ChatCompletionResult> {
  const safeMessages = sanitizeMessagesForProvider(messages, config.provider);

  if (config.provider === "kilo") {
    return kilo.chatCompletion(safeMessages, tools, config.model, undefined, onDelta, config.temperature, signal, onRetry);
  }

  if (config.provider === "custom") {
    if (!config.baseUrl) {
      throw new Error(`custom provider selected but no base URL was configured (--base-url, or Settings > API Keys > Custom / Local Model).`);
    }
    return custom.chatCompletion(safeMessages, tools, config.model, config.apiKey ?? "", config.baseUrl, undefined, onDelta, config.temperature, signal, onRetry);
  }

  const entry = KEYED_PROVIDERS[config.provider];
  if (!config.apiKey) {
    throw new Error(`${config.provider} provider selected but no API key was supplied (--api-key or ${entry.envHint}).`);
  }
  return entry.chatCompletion(safeMessages, tools, config.model, config.apiKey, undefined, onDelta, config.temperature, signal, onRetry);
}
