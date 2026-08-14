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
import { appendTransaction, loadTransaction, listTransactions } from "../transactionLog";
import type { TransactionRecord } from "../types";

function mkRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-txlog-test-"));
}

function makeRecord(overrides: Partial<TransactionRecord>): TransactionRecord {
  return {
    id: "tx1",
    sessionId: "sess1",
    startedAt: 1000,
    endedAt: 1000,
    intent: "did something",
    gitStatusBefore: "",
    gitStatusAfter: "",
    actions: [],
    contract: { checks: [] },
    repairAttempts: 0,
    criticCalls: 0,
    outcome: "verified",
    confidence: 90,
    ...overrides,
  };
}

test("listTransactions: aggregates across every session file, most recent first", () => {
  const root = mkRoot();
  appendTransaction(root, "sess1", makeRecord({ id: "tx1", sessionId: "sess1", endedAt: 1000 }));
  appendTransaction(root, "sess2", makeRecord({ id: "tx2", sessionId: "sess2", endedAt: 3000 }));
  appendTransaction(root, "sess1", makeRecord({ id: "tx3", sessionId: "sess1", endedAt: 2000 }));

  const all = listTransactions(root);
  assert.deepEqual(all.map((t) => t.id), ["tx2", "tx3", "tx1"]);
});

test("listTransactions: sessionId filter restricts to one session's file only", () => {
  const root = mkRoot();
  appendTransaction(root, "sess1", makeRecord({ id: "tx1", sessionId: "sess1" }));
  appendTransaction(root, "sess2", makeRecord({ id: "tx2", sessionId: "sess2" }));

  const filtered = listTransactions(root, { sessionId: "sess1" });
  assert.deepEqual(filtered.map((t) => t.id), ["tx1"]);
});

test("listTransactions: limit caps the result after sorting, not before", () => {
  const root = mkRoot();
  appendTransaction(root, "sess1", makeRecord({ id: "tx-old", endedAt: 1000 }));
  appendTransaction(root, "sess1", makeRecord({ id: "tx-new", endedAt: 2000 }));

  const limited = listTransactions(root, { limit: 1 });
  assert.deepEqual(limited.map((t) => t.id), ["tx-new"]);
});

test("listTransactions: a corrupt line is skipped, not fatal to the rest of the file", () => {
  const root = mkRoot();
  appendTransaction(root, "sess1", makeRecord({ id: "tx1" }));
  const dir = path.join(root, ".coding-agent", "transactions");
  fs.appendFileSync(path.join(dir, "sess1.jsonl"), "{not valid json\n");
  appendTransaction(root, "sess1", makeRecord({ id: "tx2", endedAt: 2000 }));

  const records = listTransactions(root, { sessionId: "sess1" });
  assert.deepEqual(records.map((t) => t.id).sort(), ["tx1", "tx2"]);
});

test("listTransactions: an invalid sessionId is rejected rather than used in a path", () => {
  const root = mkRoot();
  assert.throws(() => listTransactions(root, { sessionId: "../../etc" }));
});

test("listTransactions: no transactions directory returns [] rather than throwing", () => {
  const root = mkRoot();
  assert.deepEqual(listTransactions(root), []);
});

test("loadTransaction: unaffected by listTransactions -- still finds a specific id in a specific session", () => {
  const root = mkRoot();
  appendTransaction(root, "sess1", makeRecord({ id: "tx1" }));
  const found = loadTransaction(root, "sess1", "tx1");
  assert.ok(found);
  assert.equal(found!.id, "tx1");
});
