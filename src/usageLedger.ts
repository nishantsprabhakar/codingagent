/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Local, append-only record of who used this agent and how — session/login activity, tool
 * calls, and model/token usage. Never sent over the network; read back by usageExport.ts to keep
 * a live spreadsheet up to date. Every function here is best-effort: a failure must never
 * interrupt an actual agent turn, so all of them swallow their own errors.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { LlmProvider, RiskLevel, TokenUsage } from "./types";
import { scheduleUsageExport } from "./usageExport";

let baseDirOverrideForTesting: string | null = null;

/** Test-only seam — never called by production code. */
export function _setUsageLedgerBaseDirForTesting(dir: string | null): void {
  baseDirOverrideForTesting = dir;
}

function ledgerPath(): string {
  const dir = baseDirOverrideForTesting ?? path.join(os.homedir(), ".coding-agent");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "usage-ledger.jsonl");
}

function currentIdentity(): { user: string; host: string } {
  try {
    return { user: os.userInfo().username, host: os.hostname() };
  } catch {
    return { user: "unknown", host: "unknown" };
  }
}

export type UsageEvent =
  | { type: "session_start"; ts: number; user: string; host: string; sessionId: string; root: string }
  | { type: "session_end"; ts: number; user: string; host: string; sessionId: string }
  | { type: "tool"; ts: number; user: string; host: string; sessionId: string; tool: string; ok: boolean; risk: RiskLevel }
  | {
      type: "model";
      ts: number;
      user: string;
      host: string;
      sessionId: string;
      provider: LlmProvider;
      model: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };

function append(event: UsageEvent): void {
  try {
    fs.appendFileSync(ledgerPath(), JSON.stringify(event) + "\n", "utf-8");
  } catch {
    return;
  }
  scheduleUsageExport();
}

export function recordSessionStart(sessionId: string, root: string): void {
  append({ type: "session_start", ts: Date.now(), ...currentIdentity(), sessionId, root });
}

export function recordSessionEnd(sessionId: string): void {
  append({ type: "session_end", ts: Date.now(), ...currentIdentity(), sessionId });
}

export function recordToolUsage(sessionId: string, tool: string, ok: boolean, risk: RiskLevel): void {
  append({ type: "tool", ts: Date.now(), ...currentIdentity(), sessionId, tool, ok, risk });
}

export function recordModelUsage(sessionId: string, provider: LlmProvider, model: string, usage: TokenUsage): void {
  append({
    type: "model",
    ts: Date.now(),
    ...currentIdentity(),
    sessionId,
    provider,
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
  });
}

/** Summed prompt/completion/total tokens for every model call recorded so far in one session —
 *  the live, in-UI counterpart to usageExport.ts's after-the-fact spreadsheet. Reads the same
 *  durable ledger, so it stays correct across a server restart or a reconnect mid-session. */
export function getSessionUsageTotals(sessionId: string): TokenUsage {
  const totals: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  for (const e of readAllEvents()) {
    if (e.type !== "model" || e.sessionId !== sessionId) continue;
    totals.promptTokens += e.promptTokens;
    totals.completionTokens += e.completionTokens;
    totals.totalTokens += e.totalTokens;
  }
  return totals;
}

/** Reads every event ever recorded (across all sessions/processes on this machine). */
export function readAllEvents(): UsageEvent[] {
  let text: string;
  try {
    text = fs.readFileSync(ledgerPath(), "utf-8");
  } catch {
    return [];
  }
  const events: UsageEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // A single corrupted line (e.g. a partial write from a crash mid-append) shouldn't drop the rest.
    }
  }
  return events;
}
