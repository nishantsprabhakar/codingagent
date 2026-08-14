/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Phase 6 — lightweight evidence citations and same-session consistency checking. The model can
 * optionally tag a labeled figure with its source when it states one in a generated artifact
 * (create_docx/pptx/xlsx); if a later artifact in the SAME session states the same-labeled fact
 * with a different value, record_evidence's caller (agent.ts) surfaces that immediately. This is
 * deliberately not a full evidence graph: no automatic fact extraction (the model must call this
 * tool — nothing scans document content on its own), no synonym/fact-normalization beyond exact
 * shallow label matching, and no cross-session tracking. See
 * docs/architecture/2026-08-phase6-evidence-consistency.md for the scope decision.
 *
 * Persisted at .coding-agent/evidence/<sessionId>.jsonl — the same per-session JSONL shape as
 * transactionLog.ts (assertValidId as the one choke point, append-only, never throws on load).
 */
import * as fs from "fs";
import * as path from "path";
import type { ToolDefinition } from "../types";
import { assertValidId } from "../idValidation";

export interface EvidenceEntry {
  label: string;
  normalizedLabel: string;
  value: string;
  numericValue: number | null;
  source: string;
  transactionId: string;
  timestamp: number;
}

export interface EvidenceConflict {
  label: string;
  priorValue: string;
  priorSource: string;
  priorTransactionId: string;
}

export const RECORD_EVIDENCE_DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: "record_evidence",
    description:
      "Record a specific, labeled figure or fact you just stated in a generated artifact (docx/pptx/xlsx) or elsewhere " +
      "in your response, so it can be automatically cross-checked against the same fact recorded earlier in this " +
      "session. Call this for figures worth reconciling across documents (financial numbers, counts, dates, statuses) " +
      "— not every number. If it conflicts with an earlier recording, you'll be told immediately in the tool result.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "What this fact is, e.g. 'Q4 Revenue' or 'Total headcount'." },
        value: { type: "string", description: "The value as stated, e.g. '$5.2M', '1,204', 'Approved'." },
        source: {
          type: "string",
          description: "Where this value came from, e.g. 'read_file:financials.xlsx' or 'computed from model.xlsx cell B12'.",
        },
      },
      required: ["label", "value", "source"],
    },
  },
};

function evidenceDir(root: string): string {
  return path.join(root, ".coding-agent", "evidence");
}

function evidenceLogPath(root: string, sessionId: string): string {
  assertValidId(sessionId, "session id");
  return path.join(evidenceDir(root), `${sessionId}.jsonl`);
}

/** Shallow, deliberate: case/whitespace/trailing-punctuation insensitive, nothing more — "Revenue" and
 *  "Total Revenue" are NOT the same label. Real fact-normalization is an explicit non-goal (see module doc). */
function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[:.]+$/g, "").replace(/\s+/g, " ");
}

/**
 * Parses a stated value as a number where possible: strips currency symbols/commas/whitespace,
 * treats parenthesized values as negative (accounting notation, e.g. "(500)" -> -500), and expands
 * k/m/b/t suffixes (e.g. "$5M" -> 5000000). Returns null for anything that isn't a plausible number
 * (e.g. "Approved") — callers fall back to string comparison in that case.
 */
function parseNumeric(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parenNegative = /^\(.*\)$/.test(trimmed);
  const unwrapped = parenNegative ? trimmed.slice(1, -1) : trimmed;
  const explicitNegative = unwrapped.startsWith("-");
  const stripped = unwrapped
    .replace(/^[-+]/, "")
    .replace(/[$€£¥,\s]/g, "");
  const match = /^(\d+(?:\.\d+)?)\s*([kmbt])?%?$/i.exec(stripped);
  if (!match) return null;

  let num = parseFloat(match[1]);
  const suffix = match[2]?.toLowerCase();
  if (suffix === "k") num *= 1e3;
  else if (suffix === "m") num *= 1e6;
  else if (suffix === "b") num *= 1e9;
  else if (suffix === "t") num *= 1e12;

  return parenNegative || explicitNegative ? -num : num;
}

const NUMERIC_TOLERANCE_RATIO = 0.005; // 0.5% — enough to treat "$5M" and "5,000,000" as the same fact

function valuesConflict(a: EvidenceEntry, candidateValue: string, candidateNumeric: number | null): boolean {
  if (a.numericValue !== null && candidateNumeric !== null) {
    const magnitude = Math.max(Math.abs(a.numericValue), Math.abs(candidateNumeric), 1);
    return Math.abs(a.numericValue - candidateNumeric) / magnitude > NUMERIC_TOLERANCE_RATIO;
  }
  return a.value.trim().toLowerCase() !== candidateValue.trim().toLowerCase();
}

/** Never throws — a missing or corrupt ledger file just means no prior evidence to compare against. */
export function loadEvidence(root: string, sessionId: string): EvidenceEntry[] {
  try {
    const filePath = evidenceLogPath(root, sessionId);
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    const entries: EvidenceEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as EvidenceEntry);
      } catch {
        // skip corrupt line
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Every prior same-label entry (this session only) whose value disagrees with the candidate,
 * beyond the numeric tolerance / string-equality fallback above — not just the most recent one.
 */
export function findConflicts(root: string, sessionId: string, label: string, value: string): EvidenceConflict[] {
  const normalizedLabel = normalizeLabel(label);
  const numericValue = parseNumeric(value);
  return loadEvidence(root, sessionId)
    .filter((e) => e.normalizedLabel === normalizedLabel && valuesConflict(e, value, numericValue))
    .map((e) => ({ label: e.label, priorValue: e.value, priorSource: e.source, priorTransactionId: e.transactionId }));
}

/** One recorded evidence entry, flagged with whether ANY earlier same-label entry this session
 *  conflicts with it — for the Phase 11 evidence panel (read-only; reuses loadEvidence's already-
 *  persisted data and this module's existing conflict logic, no new storage or scoring). */
export interface EvidenceEntryWithConflict extends EvidenceEntry {
  hasConflict: boolean;
}

/** Never throws. Ordered oldest-first (recording order), matching loadEvidence's own order. */
export function listEvidenceWithConflicts(root: string, sessionId: string): EvidenceEntryWithConflict[] {
  const entries = loadEvidence(root, sessionId);
  return entries.map((entry, i) => {
    const hasConflict = entries
      .slice(0, i)
      .some((earlier) => earlier.normalizedLabel === entry.normalizedLabel && valuesConflict(earlier, entry.value, entry.numericValue));
    return { ...entry, hasConflict };
  });
}

/** Best-effort — a write failure shouldn't interrupt the agent loop. */
export function appendEvidence(root: string, sessionId: string, label: string, value: string, source: string, transactionId: string): void {
  try {
    const dir = evidenceDir(root);
    fs.mkdirSync(dir, { recursive: true });
    const gitignorePath = path.join(root, ".coding-agent", ".gitignore");
    if (!fs.existsSync(gitignorePath)) fs.writeFileSync(gitignorePath, "*\n", "utf-8");

    const entry: EvidenceEntry = {
      label,
      normalizedLabel: normalizeLabel(label),
      value,
      numericValue: parseNumeric(value),
      source,
      transactionId,
      timestamp: Date.now(),
    };
    fs.appendFileSync(evidenceLogPath(root, sessionId), JSON.stringify(entry) + "\n", "utf-8");
  } catch (err: any) {
    console.error("[coding-agent] warning: failed to append evidence log:", err.message ?? err);
  }
}
