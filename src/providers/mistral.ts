/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Mistral La Plateforme — free "Experiment" tier (no credit card, phone
 * verification required) at https://console.mistral.ai. OpenAI-compatible.
 */
import { createOpenAiCompatibleProvider } from "./openaiCompatible";

export const chatCompletion = createOpenAiCompatibleProvider({
  baseUrl: "https://api.mistral.ai/v1/chat/completions",
  label: "Mistral",
  apiKeyEnvHint: "MISTRAL_API_KEY",
});
