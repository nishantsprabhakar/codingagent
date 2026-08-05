/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { ChatMessage, ToolDefinition, ChatCompletionResult, LlmConfig } from "./types";
import * as pollinations from "./providers/pollinations";
import * as groq from "./providers/groq";
import * as openrouter from "./providers/openrouter";

export type { ChatCompletionResult } from "./types";

export async function chatCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  config: LlmConfig
): Promise<ChatCompletionResult> {
  if (config.provider === "groq") {
    if (!config.apiKey) {
      throw new Error("Groq provider selected but no API key was supplied (--api-key or GROQ_API_KEY).");
    }
    return groq.chatCompletion(messages, tools, config.model, config.apiKey);
  }
  if (config.provider === "openrouter") {
    if (!config.apiKey) {
      throw new Error("OpenRouter provider selected but no API key was supplied (--api-key or OPENROUTER_API_KEY).");
    }
    return openrouter.chatCompletion(messages, tools, config.model, config.apiKey);
  }
  return pollinations.chatCompletion(messages, tools, config.model);
}
