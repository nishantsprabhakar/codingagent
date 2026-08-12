/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Renders the local usage ledger (usageLedger.ts) into a live spreadsheet at
 * usageExportPath.ts's resolved location — typically inside a OneDrive/Google Drive sync folder,
 * so it becomes visible to anyone with access to that folder. Regenerated from the full ledger
 * on every change (debounced) rather than appended to, so the ledger stays the durable source of
 * truth and the workbook is always a clean, complete rebuild rather than something that can drift
 * out of sync with it.
 */
import * as fs from "fs";
import * as path from "path";
import ExcelJS from "exceljs";
import { readAllEvents, type UsageEvent } from "./usageLedger";
import { usageWorkbookPath } from "./usageExportPath";

const DEBOUNCE_MS = 2000;

let pendingTimer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> = Promise.resolve();

/** Called after every ledger append — coalesces bursts of events into one rewrite. */
export function scheduleUsageExport(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    inFlight = exportUsageWorkbook().catch(() => {});
  }, DEBOUNCE_MS);
}

/** Test-only seam: runs the export immediately and waits for it, bypassing the debounce. */
export function _flushUsageExportForTesting(): Promise<void> {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  inFlight = exportUsageWorkbook().catch(() => {});
  return inFlight;
}

interface Column {
  header: string;
  key: string;
  width: number;
  dateFormat?: boolean;
}

function addSheet(workbook: ExcelJS.Workbook, name: string, columns: Column[], rows: Record<string, unknown>[]): void {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    style: c.dateFormat ? { numFmt: "yyyy-mm-dd hh:mm:ss" } : undefined,
  }));
  rows.forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function buildSessionsSheet(workbook: ExcelJS.Workbook, events: UsageEvent[]): void {
  const sessions = new Map<
    string,
    { sessionId: string; user: string; host: string; root: string; startedAt: Date; endedAt: Date | null }
  >();
  for (const e of events) {
    if (e.type === "session_start") {
      sessions.set(e.sessionId, {
        sessionId: e.sessionId,
        user: e.user,
        host: e.host,
        root: e.root,
        startedAt: new Date(e.ts),
        endedAt: null,
      });
    } else if (e.type === "session_end") {
      const s = sessions.get(e.sessionId);
      if (s) s.endedAt = new Date(e.ts);
    }
  }
  const rows = [...sessions.values()].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  addSheet(
    workbook,
    "Sessions",
    [
      { header: "User", key: "user", width: 18 },
      { header: "Host", key: "host", width: 18 },
      { header: "Session ID", key: "sessionId", width: 24 },
      { header: "Project", key: "root", width: 44 },
      { header: "Started", key: "startedAt", width: 22, dateFormat: true },
      { header: "Ended", key: "endedAt", width: 22, dateFormat: true },
    ],
    rows
  );
}

function buildToolSheet(workbook: ExcelJS.Workbook, events: UsageEvent[]): void {
  const rows = events
    .filter((e): e is Extract<UsageEvent, { type: "tool" }> => e.type === "tool")
    .map((e) => ({ time: new Date(e.ts), user: e.user, host: e.host, sessionId: e.sessionId, tool: e.tool, ok: e.ok, risk: e.risk }))
    .sort((a, b) => b.time.getTime() - a.time.getTime());
  addSheet(
    workbook,
    "Tool Usage",
    [
      { header: "Time", key: "time", width: 22, dateFormat: true },
      { header: "User", key: "user", width: 18 },
      { header: "Host", key: "host", width: 18 },
      { header: "Session ID", key: "sessionId", width: 24 },
      { header: "Tool", key: "tool", width: 24 },
      { header: "Success", key: "ok", width: 10 },
      { header: "Risk", key: "risk", width: 10 },
    ],
    rows
  );
}

function buildModelSheet(workbook: ExcelJS.Workbook, events: UsageEvent[]): void {
  const rows = events
    .filter((e): e is Extract<UsageEvent, { type: "model" }> => e.type === "model")
    .map((e) => ({
      time: new Date(e.ts),
      user: e.user,
      host: e.host,
      sessionId: e.sessionId,
      provider: e.provider,
      model: e.model,
      promptTokens: e.promptTokens,
      completionTokens: e.completionTokens,
      totalTokens: e.totalTokens,
    }))
    .sort((a, b) => b.time.getTime() - a.time.getTime());
  addSheet(
    workbook,
    "Model Usage",
    [
      { header: "Time", key: "time", width: 22, dateFormat: true },
      { header: "User", key: "user", width: 18 },
      { header: "Host", key: "host", width: 18 },
      { header: "Session ID", key: "sessionId", width: 24 },
      { header: "Provider", key: "provider", width: 14 },
      { header: "Model", key: "model", width: 28 },
      { header: "Prompt Tokens", key: "promptTokens", width: 16 },
      { header: "Completion Tokens", key: "completionTokens", width: 18 },
      { header: "Total Tokens", key: "totalTokens", width: 14 },
    ],
    rows
  );
}

function buildSummarySheet(workbook: ExcelJS.Workbook, events: UsageEvent[]): void {
  interface Bucket {
    user: string;
    sessions: Set<string>;
    toolCalls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }
  const perUser = new Map<string, Bucket>();
  const bucketFor = (user: string): Bucket => {
    let b = perUser.get(user);
    if (!b) {
      b = { user, sessions: new Set(), toolCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      perUser.set(user, b);
    }
    return b;
  };
  for (const e of events) {
    const b = bucketFor(e.user);
    if (e.type === "session_start") b.sessions.add(e.sessionId);
    if (e.type === "tool") b.toolCalls++;
    if (e.type === "model") {
      b.promptTokens += e.promptTokens;
      b.completionTokens += e.completionTokens;
      b.totalTokens += e.totalTokens;
    }
  }
  const rows = [...perUser.values()]
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .map((b) => ({
      user: b.user,
      sessions: b.sessions.size,
      toolCalls: b.toolCalls,
      promptTokens: b.promptTokens,
      completionTokens: b.completionTokens,
      totalTokens: b.totalTokens,
    }));
  addSheet(
    workbook,
    "Summary",
    [
      { header: "User", key: "user", width: 18 },
      { header: "Sessions", key: "sessions", width: 12 },
      { header: "Tool Calls", key: "toolCalls", width: 12 },
      { header: "Prompt Tokens", key: "promptTokens", width: 16 },
      { header: "Completion Tokens", key: "completionTokens", width: 18 },
      { header: "Total Tokens", key: "totalTokens", width: 14 },
    ],
    rows
  );
}

/** Rebuilds the live workbook from the full ledger and writes it to the resolved export path. */
export async function exportUsageWorkbook(): Promise<void> {
  const events = readAllEvents();
  const workbook = new ExcelJS.Workbook();
  buildSummarySheet(workbook, events);
  buildSessionsSheet(workbook, events);
  buildToolSheet(workbook, events);
  buildModelSheet(workbook, events);

  const outPath = usageWorkbookPath();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.tmp-${process.pid}`;
  await workbook.xlsx.writeFile(tmpPath);
  try {
    fs.renameSync(tmpPath, outPath);
  } catch {
    // Most likely cause: the destination is currently open in Excel and locked by the OS.
    // Drop this update — the ledger (the durable source of truth) is unaffected, and the next
    // recorded event will trigger another export attempt.
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  }
}
