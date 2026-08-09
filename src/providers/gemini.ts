/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Google Gemini via its OpenAI-compatible endpoint (still labeled "beta" by
 * Google, but it accepts the standard chat-completions shape including
 * tools/streaming). Free key with no credit card at https://aistudio.google.com/apikey.
 */
import { createOpenAiCompatibleProvider } from "./openaiCompatible";

export const chatCompletion = createOpenAiCompatibleProvider({
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  label: "Gemini",
  apiKeyEnvHint: "GEMINI_API_KEY",
});
