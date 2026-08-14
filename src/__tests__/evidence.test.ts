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
import { appendEvidence, findConflicts, loadEvidence, listEvidenceWithConflicts } from "../tools/evidence";

function mkRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-evidence-test-"));
}

test("findConflicts: no conflict for the first-ever recording of a label", () => {
  const root = mkRoot();
  assert.deepEqual(findConflicts(root, "sess1", "Revenue", "$5M"), []);
});

test("findConflicts: numeric equivalence across notations is not a conflict", () => {
  const root = mkRoot();
  appendEvidence(root, "sess1", "Revenue", "$5M", "computed from model.xlsx cell B12", "tx1");
  assert.deepEqual(findConflicts(root, "sess1", "Revenue", "5,000,000"), []);
});

test("findConflicts: a genuinely different number is a conflict", () => {
  const root = mkRoot();
  appendEvidence(root, "sess1", "Revenue", "$5M", "computed from model.xlsx cell B12", "tx1");
  const conflicts = findConflicts(root, "sess1", "Revenue", "$4.8M");
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].priorValue, "$5M");
  assert.equal(conflicts[0].priorSource, "computed from model.xlsx cell B12");
  assert.equal(conflicts[0].priorTransactionId, "tx1");
});

test("findConflicts: accounting-negative parentheses match their signed equivalent", () => {
  const root = mkRoot();
  appendEvidence(root, "sess1", "Net change", "(500)", "read_file:ledger.xlsx", "tx1");
  assert.deepEqual(findConflicts(root, "sess1", "Net change", "-500"), []);
});

test("findConflicts: label matching is case/whitespace/trailing-punctuation insensitive, but not synonym-aware", () => {
  const root = mkRoot();
  appendEvidence(root, "sess1", "Revenue", "$5M", "source A", "tx1");
  // Same fact, different casing/whitespace/punctuation -- still matched.
  assert.equal(findConflicts(root, "sess1", " revenue: ", "$4.8M").length, 1);
  // A different (if related) label is NOT treated as the same fact -- shallow matching only.
  assert.deepEqual(findConflicts(root, "sess1", "Total Revenue", "$4.8M"), []);
});

test("findConflicts: non-numeric values fall back to case-insensitive string equality", () => {
  const root = mkRoot();
  appendEvidence(root, "sess1", "Status", "Approved", "read_file:status.txt", "tx1");
  assert.deepEqual(findConflicts(root, "sess1", "Status", "approved "), []);
  assert.equal(findConflicts(root, "sess1", "Status", "Pending").length, 1);
});

test("findConflicts: returns every disagreeing prior entry, not just the most recent", () => {
  const root = mkRoot();
  appendEvidence(root, "sess1", "Revenue", "$5M", "source A", "tx1");
  appendEvidence(root, "sess1", "Revenue", "$5M", "source B", "tx2"); // agrees with tx1
  appendEvidence(root, "sess1", "Revenue", "$6M", "source C", "tx3"); // disagrees with both

  const conflicts = findConflicts(root, "sess1", "Revenue", "$4.8M");
  assert.equal(conflicts.length, 3, "must report every disagreeing prior entry, including the one that itself agreed with tx1");
});

test("appendEvidence/loadEvidence: persistence round-trips and is scoped per session", () => {
  const root = mkRoot();
  appendEvidence(root, "sess1", "Revenue", "$5M", "source A", "tx1");
  appendEvidence(root, "sess2", "Revenue", "$9M", "source Z", "tx9"); // a different session entirely

  const sess1Entries = loadEvidence(root, "sess1");
  assert.equal(sess1Entries.length, 1);
  assert.equal(sess1Entries[0].value, "$5M");
  assert.equal(sess1Entries[0].numericValue, 5_000_000);

  // Same-session scoping: sess2's entry must never surface as a conflict for sess1's query.
  assert.deepEqual(findConflicts(root, "sess1", "Revenue", "$4.8M").map((c) => c.priorSource), ["source A"]);
});

test("loadEvidence: a missing or corrupt ledger file returns [] rather than throwing", () => {
  const root = mkRoot();
  assert.deepEqual(loadEvidence(root, "no-such-session"), []);

  const dir = path.join(root, ".coding-agent", "evidence");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "corrupt.jsonl"), "{not valid json\n{\"also\": \"broken\n", "utf-8");
  assert.deepEqual(loadEvidence(root, "corrupt"), []);
});

test("listEvidenceWithConflicts: flags an entry only if an EARLIER same-label entry disagrees with it (Phase 11 panel)", () => {
  const root = mkRoot();
  appendEvidence(root, "sess1", "Revenue", "$5M", "source A", "tx1");
  appendEvidence(root, "sess1", "Revenue", "$4.8M", "source B", "tx2"); // disagrees with tx1
  appendEvidence(root, "sess1", "Headcount", "1,204", "source C", "tx3"); // unrelated label, no conflict

  const entries = listEvidenceWithConflicts(root, "sess1");
  assert.equal(entries.length, 3);
  assert.equal(entries[0].hasConflict, false, "the first-ever entry for a label has nothing earlier to conflict with");
  assert.equal(entries[1].hasConflict, true, "disagrees with the earlier Revenue entry");
  assert.equal(entries[2].hasConflict, false, "a different label entirely");
});

test("listEvidenceWithConflicts: an entry that only agrees with everything earlier is never flagged", () => {
  const root = mkRoot();
  appendEvidence(root, "sess1", "Revenue", "$5M", "source A", "tx1");
  appendEvidence(root, "sess1", "Revenue", "5,000,000", "source B", "tx2"); // numerically equivalent

  const entries = listEvidenceWithConflicts(root, "sess1");
  assert.deepEqual(entries.map((e) => e.hasConflict), [false, false]);
});

test("listEvidenceWithConflicts: empty for a session with no recorded evidence", () => {
  const root = mkRoot();
  assert.deepEqual(listEvidenceWithConflicts(root, "no-such-session"), []);
});
