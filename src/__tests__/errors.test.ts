/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WrexlynError, PermissionDeniedError, PathTraversalError, ProviderError, redact, logError } from "../errors";

test("WrexlynError hierarchy: each subclass carries its own code and name", () => {
  const permErr = new PermissionDeniedError("denied");
  assert.equal(permErr.code, "PERMISSION_DENIED");
  assert.equal(permErr.name, "PermissionDeniedError");
  assert.ok(permErr instanceof WrexlynError);
  assert.ok(permErr instanceof Error);

  const pathErr = new PathTraversalError("escaped root");
  assert.equal(pathErr.code, "PATH_TRAVERSAL");

  const provErr = new ProviderError("rate limited", "groq");
  assert.equal(provErr.code, "PROVIDER_ERROR");
  assert.equal(provErr.provider, "groq");
});

test("redact: replaces an exact known secret value wherever it appears", () => {
  const result = redact("request failed with key gsk_abc123realvalue", ["gsk_abc123realvalue"]);
  assert.equal(result, "request failed with key [REDACTED]");
});

test("redact: catches well-known API-key shapes even without being told the value", () => {
  assert.match(redact("error: bad key gsk_1234567890abcdef"), /\[REDACTED\]/);
  assert.match(redact("Authorization: Bearer sk-ant-abcdefghijklmnop1234"), /\[REDACTED\]/);
  assert.match(redact("using sk-or-v1-abcdefghijklmnopqrst"), /\[REDACTED\]/);
  assert.match(redact("AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234"), /\[REDACTED\]/);
});

test("redact: leaves ordinary debugging content (git SHAs, paths, plain messages) untouched", () => {
  const message = "build failed at commit 4d8fc187, see src/agent.ts:142 for details";
  assert.equal(redact(message), message);
});

test("redact: never throws on empty or undefined-laden input", () => {
  assert.equal(redact(""), "");
  assert.equal(redact("safe text", [undefined, "", "real-secret"]), "safe text");
});

test("logError: does not throw, and redacts a known secret before logging", () => {
  const originalError = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => calls.push(args);
  try {
    logError("test context", new Error("failed with gsk_reallysecretvalue12345"), ["gsk_reallysecretvalue12345"]);
  } finally {
    console.error = originalError;
  }
  assert.equal(calls.length, 1);
  const logged = calls[0].join(" ");
  assert.ok(!logged.includes("gsk_reallysecretvalue12345"), "the raw secret must never reach the log");
  assert.match(logged, /\[REDACTED\]/);
});
