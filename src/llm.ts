/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { ChatMessage, ToolDefinition, ChatCompletionResult, LlmConfig, LlmProvider } from "./types";
import * as pollinations from "./providers/pollinations";
import * as groq from "./providers/groq";
import * as openrouter from "./providers/openrouter";
import * as gemini from "./providers/gemini";
import * as cerebras from "./providers/cerebras";
import * as mistral from "./providers/mistral";

export type { ChatCompletionResult } from "./types";

/** Called with each chunk of assistant text as the model streams its response. */
export type OnDelta = (chunk: string) => void;

/** Every provider except pollinations needs a key — same shape, so route them through one table instead of a growing if-chain. */
const KEYED_PROVIDERS: Record<
  Exclude<LlmProvider, "pollinations">,
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
  onDelta?: OnDelta
): Promise<ChatCompletionResult> {
  if (config.provider === "pollinations") {
    return pollinations.chatCompletion(messages, tools, config.model, undefined, onDelta);
  }

  const entry = KEYED_PROVIDERS[config.provider];
  if (!config.apiKey) {
    throw new Error(`${config.provider} provider selected but no API key was supplied (--api-key or ${entry.envHint}).`);
  }
  return entry.chatCompletion(messages, tools, config.model, config.apiKey, undefined, onDelta);
}
