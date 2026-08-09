/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Machine-wide API key storage for providers that need one (Groq,
 * OpenRouter — Pollinations needs none). Lets the web UI's Settings modal
 * set a key once instead of requiring --api-key or an env var on every
 * launch. Stored in plain JSON like preferences.ts/globalSettings.ts — this
 * is local-machine convenience storage, not a secrets vault; never log a
 * raw key or send one anywhere but the provider's own API.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type ApiKeyProvider = "groq" | "openrouter" | "gemini" | "cerebras" | "mistral";

/** Every provider that needs a stored key — single source of truth for iterating "all key-based providers". */
export const API_KEY_PROVIDERS: readonly ApiKeyProvider[] = ["groq", "openrouter", "gemini", "cerebras", "mistral"];

interface StoredApiKeys {
  groq?: string;
  openrouter?: string;
  gemini?: string;
  cerebras?: string;
  mistral?: string;
}

function storePath(): string {
  return path.join(os.homedir(), ".coding-agent", "api-keys.json");
}

function load(): StoredApiKeys {
  try {
    const filePath = storePath();
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function save(keys: StoredApiKeys): void {
  try {
    const filePath = storePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(keys, null, 2), "utf-8");
  } catch {
    // best-effort — a save failure just means the user has to re-enter it next time
  }
}

/** The stored key for a provider, or null if none is set. Never throws. */
export function loadApiKey(provider: ApiKeyProvider): string | null {
  return load()[provider] ?? null;
}

export function saveApiKey(provider: ApiKeyProvider, apiKey: string): void {
  const keys = load();
  keys[provider] = apiKey;
  save(keys);
}

export function clearApiKey(provider: ApiKeyProvider): void {
  const keys = load();
  delete keys[provider];
  save(keys);
}

/** Never send a raw stored key to the client — only whether one is set, and a masked hint. */
export function maskApiKey(apiKey: string): string {
  const tail = apiKey.slice(-4);
  return apiKey.length <= 4 ? "•".repeat(apiKey.length) : `${"•".repeat(8)}${tail}`;
}
