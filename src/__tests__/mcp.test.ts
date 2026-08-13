/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMcpServerEnv } from "../mcp";

test("buildMcpServerEnv: returns undefined when a server config specifies nothing", () => {
  const result = buildMcpServerEnv({ command: "npx" }, { GROQ_API_KEY: "secret" });
  assert.equal(result, undefined);
});

test("buildMcpServerEnv: a server never sees the parent's API keys unless explicitly listed", () => {
  const result = buildMcpServerEnv({ command: "npx", env: { FOO: "bar" } }, { GROQ_API_KEY: "secret", OPENROUTER_API_KEY: "also-secret" });
  assert.deepEqual(result, { FOO: "bar" });
});

test("buildMcpServerEnv: envPassthrough pulls a named var's live value from the parent process", () => {
  const result = buildMcpServerEnv({ command: "npx", envPassthrough: ["GROQ_API_KEY"] }, { GROQ_API_KEY: "secret", UNRELATED: "x" });
  assert.deepEqual(result, { GROQ_API_KEY: "secret" });
});

test("buildMcpServerEnv: literal env and envPassthrough combine, passthrough wins on collision", () => {
  const result = buildMcpServerEnv(
    { command: "npx", env: { FOO: "literal", SHARED: "from-config" }, envPassthrough: ["SHARED"] },
    { SHARED: "from-parent" }
  );
  assert.deepEqual(result, { FOO: "literal", SHARED: "from-parent" });
});

test("buildMcpServerEnv: a passthrough name absent from the parent env is silently skipped, not set to undefined", () => {
  const result = buildMcpServerEnv({ command: "npx", envPassthrough: ["DOES_NOT_EXIST"] }, {});
  assert.equal(result, undefined);
});
