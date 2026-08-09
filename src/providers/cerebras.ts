/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Cerebras Cloud — free tier (1M tokens/day, no credit card) at
 * https://cloud.cerebras.ai. OpenAI-compatible.
 */
import { createOpenAiCompatibleProvider } from "./openaiCompatible";

export const chatCompletion = createOpenAiCompatibleProvider({
  baseUrl: "https://api.cerebras.ai/v1/chat/completions",
  label: "Cerebras",
  apiKeyEnvHint: "CEREBRAS_API_KEY",
});
