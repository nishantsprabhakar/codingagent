/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import * as path from "path";
import type { TransactionRecord } from "./types";
import { assertValidId } from "./idValidation";

function transactionsDir(root: string): string {
  return path.join(root, ".coding-agent", "transactions");
}

/** The one choke point every transaction-log read/write goes through — see session.ts's sessionPath for why this
 *  validation lives at the path-building function itself rather than trusting every caller to have checked first. */
function transactionLogPath(root: string, sessionId: string): string {
  assertValidId(sessionId, "session id");
  return path.join(transactionsDir(root), `${sessionId}.jsonl`);
}

/** Appends one completed transaction as a JSON line — the durable audit trail. Best-effort, never throws. */
export function appendTransaction(root: string, sessionId: string, record: TransactionRecord): void {
  try {
    fs.mkdirSync(transactionsDir(root), { recursive: true });
    fs.appendFileSync(transactionLogPath(root, sessionId), JSON.stringify(record) + "\n", "utf-8");
  } catch (err: any) {
    console.error("[coding-agent] warning: failed to append transaction log:", err.message ?? err);
  }
}

/** Loads a specific transaction by id for a session — used to look up file snapshots when the user requests a rollback. */
export function loadTransaction(root: string, sessionId: string, transactionId: string): TransactionRecord | null {
  try {
    const filePath = transactionLogPath(root, sessionId);
    if (!fs.existsSync(filePath)) return null;
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const record = JSON.parse(lines[i]) as TransactionRecord;
        if (record.id === transactionId) return record;
      } catch {
        // skip corrupt line
      }
    }
    return null;
  } catch {
    return null;
  }
}
