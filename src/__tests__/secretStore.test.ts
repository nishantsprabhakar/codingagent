/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Verification honesty note: this suite runs on whatever OS the test process is actually on. The
 * Windows/DPAPI and plaintext-fallback backends are exercised live (real PowerShell/DPAPI calls, real file
 * I/O) whenever this runs on win32. The macOS and Linux backends' `isAvailable()` platform-gating is verified
 * on every OS (it's a pure `process.platform` check, real regardless of which OS is running the test), but
 * their actual command-invocation logic (the `security`/`secret-tool` calls) is only exercised live when this
 * suite runs on darwin/linux respectively — this file does not fake that verification on a platform it isn't.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  WindowsDpapiBackend,
  MacKeychainBackend,
  LinuxSecretServiceBackend,
  PlaintextFileBackend,
  getSecretStore,
  describeActiveBackend,
  _setBaseDirForTesting,
  _resetSecretStoreForTesting,
} from "../secretStore";

function withTempBaseDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-secretstore-test-"));
  _setBaseDirForTesting(dir);
  return fn(dir).finally(() => _setBaseDirForTesting(null));
}

test("PlaintextFileBackend: set/get/delete round-trip on a real temp file", async () => {
  await withTempBaseDir(async () => {
    const backend = new PlaintextFileBackend();
    assert.equal(await backend.get("groq"), null);
    await backend.set("groq", "gsk_test_value_123");
    assert.equal(await backend.get("groq"), "gsk_test_value_123");
    await backend.delete("groq");
    assert.equal(await backend.get("groq"), null);
  });
});

test("PlaintextFileBackend: is always reported available (last-resort fallback)", async () => {
  assert.equal(await new PlaintextFileBackend().isAvailable(), true);
});

test("MacKeychainBackend.isAvailable: platform-gates before attempting any command", async () => {
  if (process.platform === "darwin") {
    // Can't assert a specific result here without knowing the CI/dev machine's actual Keychain state —
    // just confirm it doesn't throw and returns a boolean.
    assert.equal(typeof (await new MacKeychainBackend().isAvailable()), "boolean");
  } else {
    assert.equal(await new MacKeychainBackend().isAvailable(), false);
  }
});

test("LinuxSecretServiceBackend.isAvailable: platform-gates before attempting any command", async () => {
  if (process.platform === "linux") {
    assert.equal(typeof (await new LinuxSecretServiceBackend().isAvailable()), "boolean");
  } else {
    assert.equal(await new LinuxSecretServiceBackend().isAvailable(), false);
  }
});

test("WindowsDpapiBackend.isAvailable: platform-gates before attempting any command", async () => {
  if (process.platform !== "win32") {
    assert.equal(await new WindowsDpapiBackend().isAvailable(), false);
  }
  // The win32-positive case is covered live by the round-trip test below.
});

if (process.platform === "win32") {
  test("WindowsDpapiBackend: is available on Windows", async () => {
    assert.equal(await new WindowsDpapiBackend().isAvailable(), true);
  });

  test("WindowsDpapiBackend: set/get/delete round-trip via real DPAPI encryption", async () => {
    await withTempBaseDir(async (dir) => {
      const backend = new WindowsDpapiBackend();
      assert.equal(await backend.get("openrouter"), null);
      await backend.set("openrouter", "sk-or-v1-a-real-looking-test-key");
      assert.equal(await backend.get("openrouter"), "sk-or-v1-a-real-looking-test-key");

      // The value on disk must actually be encrypted, not just a copy of the plaintext file format.
      const onDisk = fs.readFileSync(path.join(dir, "secrets.dpapi.json"), "utf-8");
      assert.ok(!onDisk.includes("a-real-looking-test-key"), "the stored ciphertext must not contain the plaintext secret");

      await backend.delete("openrouter");
      assert.equal(await backend.get("openrouter"), null);
    });
  });

  test("WindowsDpapiBackend: getSecretStore() selects DPAPI on this platform", async () => {
    await withTempBaseDir(async () => {
      _resetSecretStoreForTesting();
      const store = await getSecretStore();
      assert.equal(store.backendName, new WindowsDpapiBackend().backendName);
      assert.ok((await describeActiveBackend()).includes("DPAPI"));
      _resetSecretStoreForTesting();
    });
  });
}

test("getSecretStore: falls back to the plaintext backend when no OS backend reports available", async () => {
  await withTempBaseDir(async () => {
    _resetSecretStoreForTesting();
    // Force every platform-specific backend to report unavailable, regardless of the real OS, by
    // temporarily lying about process.platform — a standard, narrowly-scoped technique for testing
    // platform-dependent branches without needing three separate operating systems.
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "sunos", configurable: true });
    try {
      const store = await getSecretStore();
      assert.equal(store.backendName, new PlaintextFileBackend().backendName);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
      _resetSecretStoreForTesting();
    }
  });
});
