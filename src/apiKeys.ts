/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Machine-wide API key storage for providers that need one (Groq,
 * OpenRouter, etc. — Kilo needs none). Lets the web UI's Settings
 * modal set a key once instead of requiring --api-key or an env var on
 * every launch.
 *
 * Backed by secretStore.ts: OS-backed secure storage (Windows DPAPI, macOS
 * Keychain, Linux Secret Service) when available, falling back to the
 * plaintext JSON file this project always used otherwise — see
 * secretStore.ts's header comment for the full rationale and the specific
 * trade-offs of each backend. Never log a raw key or send one anywhere but
 * the provider's own API.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getSecretStore } from "./secretStore";

export type ApiKeyProvider = "groq" | "openrouter" | "gemini" | "cerebras" | "mistral" | "custom";

/** Every provider that needs a stored key — single source of truth for iterating "all key-based providers".
 *  "custom" is here too even though its key is optional (many local model servers need none) — it still
 *  goes through the same secure-storage path when one is supplied. */
export const API_KEY_PROVIDERS: readonly ApiKeyProvider[] = ["groq", "openrouter", "gemini", "cerebras", "mistral", "custom"];

let baseDirOverride: string | null = null;
/** Test-only: production code must never call this. */
export function _setApiKeysBaseDirForTesting(dir: string | null): void {
  baseDirOverride = dir;
}
function legacyPlaintextPath(): string {
  return path.join(baseDirOverride ?? path.join(os.homedir(), ".coding-agent"), "api-keys.json");
}

/**
 * One-time-per-process migration: if a secure backend is active (not the plaintext fallback itself) and the
 * legacy plaintext file still has entries, move each one into secure storage and remove it from the plaintext
 * file — so a key saved before this feature existed ends up properly protected without the user re-entering it.
 * Safe to call repeatedly; only does real work the first time there's something to migrate.
 */
let migrated = false;
/** Test-only: production code must never call this. */
export function _resetApiKeysMigrationForTesting(): void {
  migrated = false;
}
async function migrateLegacyPlaintextKeysIfNeeded(): Promise<void> {
  if (migrated) return;
  migrated = true;

  const store = await getSecretStore();
  if (store.backendName.includes("plaintext")) return; // nothing to migrate TO — the fallback IS the legacy format

  let legacy: Record<string, string>;
  try {
    const filePath = legacyPlaintextPath();
    if (!fs.existsSync(filePath)) return;
    legacy = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return;
  }

  const remaining: Record<string, string> = {};
  let movedAny = false;
  for (const [provider, key] of Object.entries(legacy)) {
    if (typeof key !== "string" || !key) continue;
    try {
      await store.set(provider, key);
      movedAny = true;
    } catch (err: any) {
      // Couldn't move this one into secure storage — leave it in the legacy file rather than lose it.
      remaining[provider] = key;
      console.warn(`[coding-agent] warning: failed to migrate the stored ${provider} API key into secure storage: ${err.message ?? err}`);
    }
  }

  if (movedAny) {
    try {
      const filePath = legacyPlaintextPath();
      if (Object.keys(remaining).length) {
        fs.writeFileSync(filePath, JSON.stringify(remaining, null, 2), "utf-8");
      } else {
        fs.rmSync(filePath, { force: true });
      }
      console.log("[coding-agent] Existing API key(s) were moved from a local plaintext file into OS-backed secure storage.");
    } catch {
      // best-effort — the keys are safely in secure storage either way; leaving the old plaintext copy around
      // is a minor residual exposure, not a lost-data problem
    }
  }
}

/** The stored key for a provider, or null if none is set. Never throws. */
export async function loadApiKey(provider: ApiKeyProvider): Promise<string | null> {
  await migrateLegacyPlaintextKeysIfNeeded();
  try {
    const store = await getSecretStore();
    return await store.get(provider);
  } catch {
    return null;
  }
}

export async function saveApiKey(provider: ApiKeyProvider, apiKey: string): Promise<void> {
  await migrateLegacyPlaintextKeysIfNeeded();
  try {
    const store = await getSecretStore();
    await store.set(provider, apiKey);
  } catch (err: any) {
    // best-effort — a save failure just means the user has to re-enter it next time
    console.error(`[coding-agent] warning: failed to save the ${provider} API key:`, err.message ?? err);
  }
}

export async function clearApiKey(provider: ApiKeyProvider): Promise<void> {
  try {
    const store = await getSecretStore();
    await store.delete(provider);
  } catch (err: any) {
    console.error(`[coding-agent] warning: failed to clear the ${provider} API key:`, err.message ?? err);
  }
}

/** Never send a raw stored key to the client — only whether one is set, and a masked hint. */
export function maskApiKey(apiKey: string): string {
  const tail = apiKey.slice(-4);
  return apiKey.length <= 4 ? "•".repeat(apiKey.length) : `${"•".repeat(8)}${tail}`;
}
