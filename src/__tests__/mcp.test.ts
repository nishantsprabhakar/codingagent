/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMcpServerEnv, mergeToolDefinitions, getAlwaysAllowSeeds } from "../mcp";

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

test("mergeToolDefinitions: registering a server for the first time just appends its tools", () => {
  const result = mergeToolDefinitions([], "srv", [{ name: "tool1" }, { name: "tool2" }]);
  assert.deepEqual(
    result.map((d) => d.function.name),
    ["mcp__srv__tool1", "mcp__srv__tool2"]
  );
});

test("mergeToolDefinitions: re-registering the same server REPLACES its old entries, never appends duplicates", () => {
  const first = mergeToolDefinitions([], "srv", [{ name: "stale_tool" }]);
  // Simulates the OAuth flow's second registration after auth completes -- the passive attempt's
  // stale/unauthenticated tool set must not survive alongside the fresh one.
  const second = mergeToolDefinitions(first, "srv", [{ name: "fresh_tool" }]);
  assert.deepEqual(
    second.map((d) => d.function.name),
    ["mcp__srv__fresh_tool"]
  );
});

test("mergeToolDefinitions: re-registering one server never touches another server's entries", () => {
  const withA = mergeToolDefinitions([], "server-a", [{ name: "a_tool" }]);
  const withBoth = mergeToolDefinitions(withA, "server-b", [{ name: "b_tool" }]);
  const reregisterA = mergeToolDefinitions(withBoth, "server-a", [{ name: "a_tool_v2" }]);
  assert.deepEqual(
    reregisterA.map((d) => d.function.name).sort(),
    ["mcp__server-a__a_tool_v2", "mcp__server-b__b_tool"].sort()
  );
});

test("getAlwaysAllowSeeds: builds fully-qualified names from each server's permissions.alwaysAllow", () => {
  const seeds = getAlwaysAllowSeeds({
    mcpServers: {
      trusted: { command: "npx", permissions: { defaultRisk: "low", alwaysAllow: ["read_thing", "list_things"] } },
      untrusted: { command: "npx" },
    },
  });
  assert.deepEqual(seeds, [
    { toolName: "mcp__trusted__read_thing", risk: "low" },
    { toolName: "mcp__trusted__list_things", risk: "low" },
  ]);
});

test("getAlwaysAllowSeeds: defaultRisk defaults to medium when unspecified", () => {
  const seeds = getAlwaysAllowSeeds({
    mcpServers: { srv: { command: "npx", permissions: { alwaysAllow: ["tool"] } } },
  });
  assert.deepEqual(seeds, [{ toolName: "mcp__srv__tool", risk: "medium" }]);
});

test("getAlwaysAllowSeeds: no permissions block at all produces no seeds", () => {
  assert.deepEqual(getAlwaysAllowSeeds({ mcpServers: { srv: { command: "npx" } } }), []);
});
