/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionManager } from "../permissions";

test("preApprove: a pre-approved tool is confirmed without ever calling confirmFn", async () => {
  let confirmFnCalls = 0;
  const permissions = new PermissionManager(false, async () => {
    confirmFnCalls++;
    return "once";
  });
  permissions.preApprove("mcp__trusted__safe_tool", "low");

  const allowed = await permissions.confirm("mcp__trusted__safe_tool", "label", "low");
  assert.equal(allowed, true);
  assert.equal(confirmFnCalls, 0);
});

test("preApprove: a high-risk tool can never be pre-approved, regardless of what the config asked for", async () => {
  let confirmFnCalls = 0;
  const permissions = new PermissionManager(false, async () => {
    confirmFnCalls++;
    return "deny";
  });
  permissions.preApprove("mcp__trusted__dangerous_tool", "high");

  const allowed = await permissions.confirm("mcp__trusted__dangerous_tool", "label", "high");
  assert.equal(allowed, false);
  assert.equal(confirmFnCalls, 1, "high-risk must still go through confirmFn -- preApprove must not have seeded it");
});

test("clearConfigSeeded: removes only config-seeded entries, leaving a live user 'always' grant intact", async () => {
  let confirmFnCalls = 0;
  const permissions = new PermissionManager(false, async () => {
    confirmFnCalls++;
    return "always"; // simulates the user clicking "always" live, and (if called again) "deny" would fail the test either way
  });

  // A live "always" click during a session (not config-driven) for tool1.
  await permissions.confirm("mcp__a__tool1", "label", "medium");
  // A config-seeded pre-approval for tool2 (never went through confirmFn).
  permissions.preApprove("mcp__b__tool2", "medium");
  assert.equal(confirmFnCalls, 1, "only tool1's live confirm() should have called confirmFn so far");

  permissions.clearConfigSeeded();

  // tool1's live grant survives -- still auto-allowed, no new confirmFn call.
  assert.equal(await permissions.confirm("mcp__a__tool1", "label", "medium"), true);
  assert.equal(confirmFnCalls, 1, "tool1's live grant must survive clearConfigSeeded() without re-confirming");

  // tool2's config-seeded grant is gone -- confirm() must call confirmFn again.
  await permissions.confirm("mcp__b__tool2", "label", "medium");
  assert.equal(confirmFnCalls, 2, "tool2's config-seeded grant must require confirmation again after clearConfigSeeded()");
});

test("confirm: 'always' at medium risk is remembered for the rest of the process", async () => {
  let calls = 0;
  const permissions = new PermissionManager(false, async () => {
    calls++;
    return "always";
  });
  assert.equal(await permissions.confirm("tool", "label", "medium"), true);
  assert.equal(await permissions.confirm("tool", "label", "medium"), true);
  assert.equal(calls, 1, "the second call must be served from the always-allowed set, not confirmFn again");
});

test("confirm: 'always' at high risk allows just this once, never remembered (pre-existing invariant, unchanged)", async () => {
  let calls = 0;
  const permissions = new PermissionManager(false, async () => {
    calls++;
    return "always";
  });
  assert.equal(await permissions.confirm("tool", "label", "high"), true);
  assert.equal(await permissions.confirm("tool", "label", "high"), true);
  assert.equal(calls, 2, "high risk must confirm every single time even if the user picks 'always'");
});

// Regression test for a real bug: alwaysAllowed is keyed by tool name only, but run_shell_command's
// risk is recomputed per call (classifyShellCommand) -- a naive `alwaysAllowed.has(toolName)` fast
// path would auto-approve a LATER high-risk call to the same tool name just because an EARLIER,
// lower-risk call to it was granted "always" (e.g. "always allow" on "npm test", then "rm -rf /"
// silently sails through with no prompt). confirm() must re-check the CURRENT call's risk every
// time, not just whether this tool name was ever granted "always" before.
test("confirm: an earlier medium-risk 'always' for a tool must NOT auto-approve a later high-risk call to the same tool", async () => {
  const decisions: string[] = [];
  let calls = 0;
  const permissions = new PermissionManager(false, async (_toolName, _label, risk) => {
    calls++;
    decisions.push(risk);
    return "always"; // even if the user (or a confused UI) answers "always" to the high-risk prompt too
  });

  assert.equal(await permissions.confirm("run_shell_command", "npm test", "medium"), true);
  assert.equal(calls, 1);

  const highRiskAllowed = await permissions.confirm("run_shell_command", "rm -rf /", "high");
  assert.equal(highRiskAllowed, true, "the call itself is allowed (user answered 'always'), but only after re-confirming");
  assert.equal(calls, 2, "the high-risk call must go through confirmFn again, not be served from the medium-risk 'always'");
  assert.deepEqual(decisions, ["medium", "high"], "confirmFn must see the real risk of each call, not a cached one");

  // The high-risk "always" must still not stick (matches the existing high-risk invariant) -- a
  // third call, back at medium risk, is what's actually served from the earlier medium "always".
  await permissions.confirm("run_shell_command", "npm test", "medium");
  assert.equal(calls, 2, "medium risk is still correctly served from the earlier 'always' without a new prompt");
});

test("confirm: yolo mode bypasses even a high-risk call with no earlier 'always' on file", async () => {
  let calls = 0;
  const permissions = new PermissionManager(true, async () => {
    calls++;
    return "deny";
  });
  assert.equal(await permissions.confirm("run_shell_command", "rm -rf /", "high"), true);
  assert.equal(calls, 0, "yolo must never call confirmFn at all, regardless of risk");
});
