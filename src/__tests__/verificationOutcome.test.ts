/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveOutcome } from "../verificationOutcome";
import type { VerificationCheckEntry, VerificationContract } from "../types";

function contract(...checks: VerificationCheckEntry[]): VerificationContract {
  return { checks };
}

function deterministic(name: string, ok: boolean): VerificationCheckEntry {
  return { source: "deterministic", name, ok, output: "" };
}

function qualityGate(ok: boolean): VerificationCheckEntry {
  return { source: "quality_gate", name: "docx quality gate", ok, output: "" };
}

function critic(ok: boolean): VerificationCheckEntry {
  return { source: "critic", name: "independent review (round 1)", ok, output: "" };
}

test("no_changes wins regardless of contract or forced outcome when nothing mutated", () => {
  const result = deriveOutcome(contract(deterministic("test", false)), false, false, "failed");
  assert.deepEqual(result, { outcome: "no_changes", confidenceBase: 100 });
});

test("forced outcome overrides derivation when mutating happened", () => {
  const result = deriveOutcome(contract(), true, false, "failed");
  assert.deepEqual(result, { outcome: "failed", confidenceBase: 40 });
});

test("blocked: every action denied permission, regardless of contract contents", () => {
  const result = deriveOutcome(contract(deterministic("test", true)), true, true);
  assert.deepEqual(result, { outcome: "blocked", confidenceBase: 20 });
});

test("verified (ran a test): all authoritative checks pass including one named test", () => {
  const result = deriveOutcome(contract(deterministic("typecheck", true), deterministic("test (npm test)", true)), true, false);
  assert.deepEqual(result, { outcome: "verified", confidenceBase: 100 });
});

test("verified (no test ran): authoritative checks pass but none is test-named", () => {
  const result = deriveOutcome(contract(deterministic("typecheck", true)), true, false);
  assert.deepEqual(result, { outcome: "verified", confidenceBase: 90 });
});

test("verified via quality_gate alone: a passing document quality gate counts as authoritative with no deterministic checks", () => {
  const result = deriveOutcome(contract(qualityGate(true)), true, false);
  assert.deepEqual(result, { outcome: "verified", confidenceBase: 90 });
});

test("reviewed: no authoritative checks ran, critic ran and passed", () => {
  const result = deriveOutcome(contract(critic(true)), true, false);
  assert.deepEqual(result, { outcome: "reviewed", confidenceBase: 80 });
});

test("partially_verified (mixed authoritative): one check passed, another failed", () => {
  const result = deriveOutcome(contract(deterministic("typecheck", true), deterministic("test", false)), true, false);
  assert.deepEqual(result, { outcome: "partially_verified", confidenceBase: 65 });
});

test("partially_verified (critic flagged a clean pass): all authoritative pass but critic fails", () => {
  const result = deriveOutcome(contract(deterministic("typecheck", true), critic(false)), true, false);
  assert.deepEqual(result, { outcome: "partially_verified", confidenceBase: 70 });
});

test("partially_verified (critic-only failure): no authoritative checks, critic fails", () => {
  const result = deriveOutcome(contract(critic(false)), true, false);
  assert.deepEqual(result, { outcome: "partially_verified", confidenceBase: 55 });
});

test("failed: every authoritative check failed and none passed", () => {
  const result = deriveOutcome(contract(deterministic("typecheck", false), deterministic("test", false)), true, false);
  assert.deepEqual(result, { outcome: "failed", confidenceBase: 40 });
});

test("failed via quality_gate alone: a blocking document quality failure with no other evidence (regression: previously invisible to outcome)", () => {
  const result = deriveOutcome(contract(qualityGate(false)), true, false);
  assert.deepEqual(result, { outcome: "failed", confidenceBase: 40 });
});

test("unverified: nothing applicable ran at all", () => {
  const result = deriveOutcome(contract(), true, false);
  assert.deepEqual(result, { outcome: "unverified", confidenceBase: 60 });
});

// Quirk-2 regression: deriveOutcome's signature has no `risk` parameter at all — the previous dead
// `a.risk === "low"` branch is gone, and these two quality_gate-only tests (verified/failed above)
// prove outcome derivation works purely off VerificationContract, never off ActionLogEntry.risk.
