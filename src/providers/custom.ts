/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * User-configured OpenAI-compatible endpoint — any API not built into Wrexlyn, or a locally-running model server
 * (Ollama, LM Studio, llama.cpp server, vLLM, text-generation-webui, ...) that exposes the same chat-completions
 * shape. Unlike the other provider files, baseUrl isn't known until the user sets it in Settings, so this can't
 * be a fixed `createOpenAiCompatibleProvider(config)` closure — it takes baseUrl per call instead.
 */
import type { ChatMessage, ToolDefinition, ChatCompletionResult, RetryNotice } from "../types";
import { runOpenAiCompatibleChatCompletion } from "./openaiCompatible";

export function chatCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model: string,
  apiKey: string,
  baseUrl: string,
  maxRetries = 5,
  onDelta?: (chunk: string) => void,
  temperature?: number,
  signal?: AbortSignal,
  onRetry?: (info: RetryNotice) => void
): Promise<ChatCompletionResult> {
  return runOpenAiCompatibleChatCompletion(
    { baseUrl, label: "Custom provider", apiKeyEnvHint: "the Base URL/API key set in Settings > API Keys > Custom / Local Model" },
    messages,
    tools,
    model,
    apiKey,
    maxRetries,
    onDelta,
    temperature,
    signal,
    onRetry
  );
}
