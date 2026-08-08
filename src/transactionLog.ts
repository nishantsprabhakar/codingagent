/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import * as path from "path";
import type { TransactionRecord } from "./types";

function transactionsDir(root: string): string {
  return path.join(root, ".coding-agent", "transactions");
}

/** Appends one completed transaction as a JSON line — the durable audit trail. Best-effort, never throws. */
export function appendTransaction(root: string, sessionId: string, record: TransactionRecord): void {
  try {
    const dir = transactionsDir(root);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${sessionId}.jsonl`);
    fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");
  } catch (err: any) {
    console.error("[coding-agent] warning: failed to append transaction log:", err.message ?? err);
  }
}

/** Loads a specific transaction by id for a session — used to look up file snapshots when the user requests a rollback. */
export function loadTransaction(root: string, sessionId: string, transactionId: string): TransactionRecord | null {
  try {
    const filePath = path.join(transactionsDir(root), `${sessionId}.jsonl`);
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
