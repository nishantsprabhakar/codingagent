/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
export interface ModelSummary {
  id: string;
  name: string;
  free: boolean;
  contextLength: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { models: ModelSummary[]; fetchedAt: number } | null = null;

/**
 * OpenRouter's public model list (no auth needed), filtered to models that
 * actually support tool/function calling — this agent can't function
 * without that, and most of OpenRouter's 300+ models don't support it. Free
 * models are sorted first. Cached briefly since this list rarely changes
 * minute-to-minute and the modal may be opened repeatedly.
 */
export async function listOpenRouterModels(): Promise<ModelSummary[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.models;

  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`OpenRouter model list request failed: ${res.status}`);
  const data: any = await res.json();

  const models: ModelSummary[] = (data.data ?? [])
    .filter((m: any) => Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools"))
    .map((m: any) => ({
      id: m.id,
      name: m.name ?? m.id,
      free: m.pricing?.prompt === "0" && m.pricing?.completion === "0",
      contextLength: m.context_length ?? 0,
    }))
    .sort((a: ModelSummary, b: ModelSummary) => {
      if (a.free !== b.free) return a.free ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  cache = { models, fetchedAt: Date.now() };
  return models;
}

/** Groq's lineup is small and stable enough to hardcode rather than hit their (auth-required) models endpoint. */
export const GROQ_MODELS: ModelSummary[] = [
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile", free: true, contextLength: 131072 },
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", free: true, contextLength: 131072 },
  { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", free: true, contextLength: 131072 },
  { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", free: true, contextLength: 131072 },
];
