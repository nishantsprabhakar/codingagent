import * as fs from "fs";
import * as path from "path";
import type { ChatMessage, TaskItem, HistoryItem } from "./types";

interface PersistedSession {
  messages: ChatMessage[];
  historyLog: HistoryItem[];
  tasks: TaskItem[];
}

function sessionPath(root: string): string {
  return path.join(root, ".coding-agent", "session.json");
}

/** Returns null if there's no saved session, or it's unreadable/corrupt — never throws. */
export function loadSession(root: string): PersistedSession | null {
  try {
    const filePath = sessionPath(root);
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!Array.isArray(data.messages)) return null;
    return {
      messages: data.messages,
      historyLog: Array.isArray(data.historyLog) ? data.historyLog : [],
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
    };
  } catch {
    return null;
  }
}

/** Persistence is best-effort — a write failure shouldn't interrupt the agent loop. */
export function saveSession(root: string, messages: ChatMessage[], historyLog: HistoryItem[], tasks: TaskItem[]): void {
  try {
    const dir = path.join(root, ".coding-agent");
    fs.mkdirSync(dir, { recursive: true });
    // Whatever project this is, our own session state shouldn't end up in its
    // git history — a nested .gitignore covers that regardless of the
    // target project's own .gitignore contents.
    const gitignorePath = path.join(dir, ".gitignore");
    if (!fs.existsSync(gitignorePath)) fs.writeFileSync(gitignorePath, "*\n", "utf-8");

    fs.writeFileSync(sessionPath(root), JSON.stringify({ messages, historyLog, tasks }, null, 2), "utf-8");
  } catch (err: any) {
    console.error("[coding-agent] warning: failed to save session:", err.message ?? err);
  }
}

export function clearSession(root: string): void {
  try {
    fs.rmSync(sessionPath(root), { force: true });
  } catch {
    // best-effort
  }
}
