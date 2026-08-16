/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  loadApiKey,
  saveApiKey,
  clearApiKey,
  maskApiKey,
  _setApiKeysBaseDirForTesting,
  _resetApiKeysMigrationForTesting,
} from "../apiKeys";
import { _setBaseDirForTesting, _resetSecretStoreForTesting, _setSelectedBackendForTesting, WindowsDpapiBackend } from "../secretStore";

function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-apikeys-test-"));
  _setApiKeysBaseDirForTesting(dir);
  _setBaseDirForTesting(dir);
  _resetSecretStoreForTesting();
  _resetApiKeysMigrationForTesting();
  return fn(dir).finally(() => {
    _setApiKeysBaseDirForTesting(null);
    _setBaseDirForTesting(null);
    _resetSecretStoreForTesting();
    _resetApiKeysMigrationForTesting();
  });
}

test("maskApiKey: keeps only the last 4 characters visible", () => {
  assert.equal(maskApiKey("gsk_1234567890abcdef"), "••••••••cdef");
  assert.equal(maskApiKey("abc"), "•••"); // shorter than the tail length -> fully masked, no crash
});

test("loadApiKey: returns null for a provider with nothing stored", async () => {
  await withTempDir(async () => {
    assert.equal(await loadApiKey("groq"), null);
  });
});

test("saveApiKey / loadApiKey / clearApiKey: round-trip through whichever backend this platform selects", async () => {
  await withTempDir(async () => {
    await saveApiKey("groq", "gsk_real_looking_test_key");
    assert.equal(await loadApiKey("groq"), "gsk_real_looking_test_key");

    await clearApiKey("groq");
    assert.equal(await loadApiKey("groq"), null);
  });
});

test("saveApiKey: different providers don't collide", async () => {
  await withTempDir(async () => {
    await saveApiKey("groq", "groq-key");
    await saveApiKey("openrouter", "openrouter-key");
    assert.equal(await loadApiKey("groq"), "groq-key");
    assert.equal(await loadApiKey("openrouter"), "openrouter-key");
  });
});

test("migration: a pre-existing legacy plaintext api-keys.json is moved into the active secure backend on first read", async () => {
  await withTempDir(async (dir) => {
    // Simulate a user who already had a key saved before OS-backed storage existed.
    const legacyPath = path.join(dir, "api-keys.json");
    fs.writeFileSync(legacyPath, JSON.stringify({ groq: "gsk_legacy_value" }, null, 2), "utf-8");

    if (process.platform === "win32") {
      // Pin the backend instead of letting getSecretStore() probe live via a spawned PowerShell process —
      // under full-suite CPU contention that probe can lose its race and fall back to the plaintext backend,
      // which would make migration correctly no-op and fail this assertion for a reason unrelated to the
      // migration logic actually being tested. See _setSelectedBackendForTesting's doc comment.
      _setSelectedBackendForTesting(new WindowsDpapiBackend());
    }

    const value = await loadApiKey("groq");
    assert.equal(value, "gsk_legacy_value", "the legacy value should still be readable through loadApiKey after migration");

    if (process.platform === "win32") {
      // On the platform this suite can actually verify live: confirm the legacy file no longer holds the
      // secret in plaintext — either the key was removed from it, or the whole file is gone.
      if (fs.existsSync(legacyPath)) {
        const remaining = JSON.parse(fs.readFileSync(legacyPath, "utf-8"));
        assert.equal(remaining.groq, undefined, "the migrated key must be removed from the legacy plaintext file");
      }
    }
  });
});
