#!/usr/bin/env node
/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * A small, Node-requirable mirror of the URLs/fallback models declared in docs/providers.js's
 * `PROVIDER_META`, for check-demo-providers.js to check against. Kept separate rather than parsing
 * the real browser file directly — `docs/providers.js` is written as browser script (no module
 * exports, DOM-adjacent helper functions) and isn't safely `require()`-able from Node. This is a
 * deliberate, minimal duplication: if you change a provider's `modelsUrl`/`fallbackModel` in
 * docs/providers.js, update the matching entry here in the same commit, or this check silently
 * stops meaning anything.
 */
module.exports = {
  groq: { modelsUrl: "https://api.groq.com/openai/v1/models" },
  openrouter: { modelsUrl: "https://openrouter.ai/api/v1/models", fallbackModel: "openai/gpt-oss-20b:free" },
  gemini: { modelsUrl: "https://generativelanguage.googleapis.com/v1beta/openai/models" },
  cerebras: { modelsUrl: "https://api.cerebras.ai/v1/models" },
  mistral: { modelsUrl: "https://api.mistral.ai/v1/models" },
};
