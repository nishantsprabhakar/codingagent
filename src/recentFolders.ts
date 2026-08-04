import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const MAX_RECENT = 10;

function storePath(): string {
  return path.join(os.homedir(), ".coding-agent", "recent-folders.json");
}

/** Never throws — a fresh machine or a corrupt file just means an empty list. */
export function loadRecentFolders(): string[] {
  try {
    const filePath = storePath();
    if (!fs.existsSync(filePath)) return [];
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(data) ? data.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** Moves `folder` to the front, dedupes, and caps the list — best-effort, a write failure is silently ignored. */
export function addRecentFolder(folder: string): void {
  try {
    const existing = loadRecentFolders().filter((p) => p !== folder);
    const updated = [folder, ...existing].slice(0, MAX_RECENT);
    const dir = path.dirname(storePath());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(updated, null, 2), "utf-8");
  } catch {
    // best-effort
  }
}
