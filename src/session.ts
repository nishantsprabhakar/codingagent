/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import * as path from "path";
import type { ChatMessage, TaskItem, HistoryItem } from "./types";
import { assertValidId } from "./idValidation";

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

/** One session's match for a searchSessions query. */
export interface SessionSearchResult {
  id: string;
  title: string;
  updatedAt: number;
  /** A short excerpt around the strongest match, for context in the results list. */
  snippet: string;
}

interface PersistedSession extends SessionMeta {
  messages: ChatMessage[];
  historyLog: HistoryItem[];
  tasks: TaskItem[];
  createdFiles: string[];
}

const LEGACY_SESSION_FILE = "session.json";
const MAX_TITLE_LENGTH = 48;

function sessionsDir(root: string): string {
  return path.join(root, ".coding-agent", "sessions");
}

/** The one choke point every session read/write/delete goes through — validating here means an unvalidated
 *  id from a client message (see web/server.ts) can never reach fs.rmSync/writeFileSync with a "../" in it. */
function sessionPath(root: string, id: string): string {
  assertValidId(id, "session id");
  return path.join(sessionsDir(root), `${id}.json`);
}

export function createSessionId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** A short, human-readable title derived from a user's first message. */
export function deriveTitle(firstUserMessage: string): string {
  const flat = firstUserMessage.replace(/\s+/g, " ").trim();
  if (!flat) return "New chat";
  return flat.length > MAX_TITLE_LENGTH ? `${flat.slice(0, MAX_TITLE_LENGTH - 1)}…` : flat;
}

/** All sessions for a project, most recently updated first. Never throws — unreadable files are skipped. */
export function listSessions(root: string): SessionMeta[] {
  migrateLegacySession(root);

  const dir = sessionsDir(root);
  if (!fs.existsSync(dir)) return [];

  const metas: SessionMeta[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));
      metas.push({
        id: data.id ?? name.replace(/\.json$/, ""),
        title: data.title ?? "New chat",
        createdAt: data.createdAt ?? 0,
        updatedAt: data.updatedAt ?? 0,
      });
    } catch {
      // skip unreadable session file
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Returns null if there's no saved session, or it's unreadable/corrupt — never throws. */
export function loadSession(root: string, id: string): PersistedSession | null {
  try {
    const filePath = sessionPath(root, id);
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!Array.isArray(data.messages)) return null;
    return {
      id,
      title: data.title ?? "New chat",
      createdAt: data.createdAt ?? Date.now(),
      updatedAt: data.updatedAt ?? Date.now(),
      messages: data.messages,
      historyLog: Array.isArray(data.historyLog) ? data.historyLog : [],
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      createdFiles: Array.isArray(data.createdFiles) ? data.createdFiles : [],
    };
  } catch {
    return null;
  }
}

/** Persistence is best-effort — a write failure shouldn't interrupt the agent loop. */
export function saveSession(
  root: string,
  id: string,
  title: string,
  messages: ChatMessage[],
  historyLog: HistoryItem[],
  tasks: TaskItem[],
  createdFiles: string[]
): void {
  try {
    const dir = sessionsDir(root);
    fs.mkdirSync(dir, { recursive: true });
    // Whatever project this is, our own session state shouldn't end up in its
    // git history — a nested .gitignore covers that regardless of the
    // target project's own .gitignore contents.
    const gitignorePath = path.join(root, ".coding-agent", ".gitignore");
    if (!fs.existsSync(gitignorePath)) fs.writeFileSync(gitignorePath, "*\n", "utf-8");

    const existing = loadSession(root, id);
    const createdAt = existing?.createdAt ?? Date.now();
    const payload: PersistedSession = {
      id,
      title,
      createdAt,
      updatedAt: Date.now(),
      messages,
      historyLog,
      tasks,
      createdFiles,
    };
    // Atomic write (temp file + rename, same pattern as codeIndex.ts's savePersisted) so a second
    // tab writing this same session concurrently, or a crash mid-write, never leaves a half-written
    // JSON file that the next loadSession() would silently discard.
    const finalPath = sessionPath(root, id);
    const tmpPath = `${finalPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
    fs.renameSync(tmpPath, finalPath); // atomic on both Windows and POSIX for a same-volume rename
  } catch (err: any) {
    console.error("[coding-agent] warning: failed to save session:", err.message ?? err);
  }
}

export function deleteSession(root: string, id: string): void {
  try {
    fs.rmSync(sessionPath(root, id), { force: true });
  } catch {
    // best-effort
  }
}

const SNIPPET_RADIUS = 60;
const MAX_SEARCH_RESULTS = 20;

/** Flattens one session's history into plain text worth searching: user/assistant turns (the actual
 *  conversation) plus tool labels (so "create_pptx" or a filename mentioned in a tool call still
 *  matches) — deliberately excludes raw tool args/output, which is mostly noise for this purpose. */
function searchableText(historyLog: HistoryItem[]): string {
  return historyLog
    .map((item) => {
      if (item.type === "user" || item.type === "assistant") return item.text;
      if (item.type === "tool") return item.label;
      return "";
    })
    .filter(Boolean)
    .join(" \n ");
}

/**
 * Lexical (not embedding-based) relevance search across every persisted session in this project —
 * scores by how many times each query term appears, so a session that mentions a term repeatedly
 * ranks above one with a single passing mention. Never throws; an unreadable session is just skipped,
 * matching listSessions/loadSession's own error handling.
 */
export function searchSessions(root: string, query: string): SessionSearchResult[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (terms.length === 0) return [];

  const results: Array<SessionSearchResult & { score: number }> = [];
  for (const meta of listSessions(root)) {
    const full = loadSession(root, meta.id);
    if (!full) continue;
    const text = searchableText(full.historyLog);
    const lower = text.toLowerCase();

    let score = 0;
    let firstMatchIdx = -1;
    for (const term of terms) {
      let fromIdx = 0;
      let idx: number;
      while ((idx = lower.indexOf(term, fromIdx)) !== -1) {
        score++;
        if (firstMatchIdx === -1) firstMatchIdx = idx;
        fromIdx = idx + term.length;
      }
    }
    if (score === 0) continue;

    const start = Math.max(0, firstMatchIdx - SNIPPET_RADIUS);
    const end = Math.min(text.length, firstMatchIdx + SNIPPET_RADIUS);
    const snippet =
      (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");

    results.push({ id: meta.id, title: meta.title, updatedAt: meta.updatedAt, snippet, score });
  }

  return results
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
    .slice(0, MAX_SEARCH_RESULTS)
    .map(({ score: _score, ...rest }) => rest);
}

/** The session to resume on a fresh connection when none is explicitly requested. */
export function pickMostRecentSessionId(root: string): string | null {
  const sessions = listSessions(root);
  return sessions[0]?.id ?? null;
}

/**
 * Projects created before multi-session support have a single flat
 * `.coding-agent/session.json`. Fold it into the new sessions/ layout once,
 * so upgrading never loses a conversation someone's already relying on.
 */
function migrateLegacySession(root: string): void {
  const legacyPath = path.join(root, ".coding-agent", LEGACY_SESSION_FILE);
  if (!fs.existsSync(legacyPath)) return;

  try {
    const data = JSON.parse(fs.readFileSync(legacyPath, "utf-8"));
    if (Array.isArray(data.messages)) {
      const id = createSessionId();
      const firstUser = (data.historyLog ?? []).find((item: any) => item.type === "user");
      const title = firstUser ? deriveTitle(firstUser.text) : "Imported chat";
      saveSession(root, id, title, data.messages, data.historyLog ?? [], data.tasks ?? [], data.createdFiles ?? []);
    }
  } catch {
    // if it's unreadable there's nothing to migrate
  }
  fs.rmSync(legacyPath, { force: true });
}
