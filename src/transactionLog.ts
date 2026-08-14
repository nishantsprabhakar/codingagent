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

/**
 * Lists transactions across this project (or one session, if given), most recent first --
 * read-only, for the Phase 11 history view. Reuses the same per-line JSON.parse-and-skip-corrupt
 * approach as loadTransaction, just across every session file instead of one known id. Throws if
 * `sessionId` is given but invalid (see assertValidId) -- validated unconditionally, before the
 * directory-existence check below, so an invalid id is rejected the same way whether or not any
 * transaction has ever been recorded for this project. Otherwise never throws.
 */
export function listTransactions(root: string, opts: { limit?: number; sessionId?: string } = {}): TransactionRecord[] {
  // sessionId can arrive from a REST query param (a client-supplied string) -- validated the same
  // way transactionLogPath() validates it for the write path, so it can never escape `dir` via a
  // ".."/separator, per this module's own established path-traversal defense (idValidation.ts).
  if (opts.sessionId) assertValidId(opts.sessionId, "session id");

  const dir = transactionsDir(root);
  if (!fs.existsSync(dir)) return [];

  const fileNames = opts.sessionId ? [`${opts.sessionId}.jsonl`] : fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl"));

  const records: TransactionRecord[] = [];
  for (const fileName of fileNames) {
    try {
      const lines = fs.readFileSync(path.join(dir, fileName), "utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          records.push(JSON.parse(line) as TransactionRecord);
        } catch {
          // skip corrupt line
        }
      }
    } catch {
      // skip unreadable file
    }
  }

  records.sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
  return opts.limit ? records.slice(0, opts.limit) : records;
}
