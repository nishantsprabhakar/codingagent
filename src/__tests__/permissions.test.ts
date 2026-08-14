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
