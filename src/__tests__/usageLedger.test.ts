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
import { recordModelUsage, getSessionUsageTotals, _setUsageLedgerBaseDirForTesting } from "../usageLedger";

function withTempLedger<T>(fn: () => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-usageledger-test-"));
  _setUsageLedgerBaseDirForTesting(dir);
  try {
    return fn();
  } finally {
    _setUsageLedgerBaseDirForTesting(null);
  }
}

test("getSessionUsageTotals: sums prompt/completion/total tokens across multiple model calls in one session", () => {
  withTempLedger(() => {
    recordModelUsage("session-a", "groq", "llama-3.3-70b-versatile", { promptTokens: 100, completionTokens: 20, totalTokens: 120 });
    recordModelUsage("session-a", "groq", "llama-3.3-70b-versatile", { promptTokens: 50, completionTokens: 10, totalTokens: 60 });

    const totals = getSessionUsageTotals("session-a");
    assert.deepEqual(totals, { promptTokens: 150, completionTokens: 30, totalTokens: 180 });
  });
});

test("getSessionUsageTotals: never mixes totals from a different session", () => {
  withTempLedger(() => {
    recordModelUsage("session-a", "groq", "llama-3.3-70b-versatile", { promptTokens: 100, completionTokens: 20, totalTokens: 120 });
    recordModelUsage("session-b", "kilo", "kilo-auto/free", { promptTokens: 999, completionTokens: 999, totalTokens: 1998 });

    const totals = getSessionUsageTotals("session-a");
    assert.deepEqual(totals, { promptTokens: 100, completionTokens: 20, totalTokens: 120 });
  });
});

test("getSessionUsageTotals: a session with no recorded model calls returns all zeros, not an error", () => {
  withTempLedger(() => {
    const totals = getSessionUsageTotals("never-used-session");
    assert.deepEqual(totals, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });
});
