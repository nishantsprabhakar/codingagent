/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface FileSnapshot {
  path: string;
  existed: boolean;
  before: string | null;
}

/** Returns `git status --porcelain` output, or null if this isn't a git repo (or git isn't installed). Never throws. */
export function gitStatusPorcelain(root: string): string | null {
  try {
    return execSync("git status --porcelain", { cwd: root, timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] })
      .toString("utf-8")
      .trim();
  } catch {
    return null;
  }
}

/** Captures a file's current content (or "didn't exist") before a mutating tool touches it. Never throws. */
export function snapshotFile(root: string, relPath: string): FileSnapshot {
  try {
    const abs = path.join(root, relPath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return { path: relPath, existed: false, before: null };
    }
    return { path: relPath, existed: true, before: fs.readFileSync(abs, "utf-8") };
  } catch {
    return { path: relPath, existed: false, before: null };
  }
}

/**
 * Restores files to their pre-transaction state: writes back original content,
 * or deletes the file if it didn't exist before the transaction touched it.
 * Manual-trigger only (the "Revert changes" button) — never called automatically.
 */
export function restoreSnapshot(root: string, snapshots: FileSnapshot[]): { path: string; ok: boolean }[] {
  const results: { path: string; ok: boolean }[] = [];
  for (const snap of snapshots) {
    try {
      const abs = path.join(root, snap.path);
      if (snap.existed) {
        fs.writeFileSync(abs, snap.before ?? "", "utf-8");
      } else if (fs.existsSync(abs)) {
        fs.rmSync(abs, { force: true });
      }
      results.push({ path: snap.path, ok: true });
    } catch {
      results.push({ path: snap.path, ok: false });
    }
  }
  return results;
}
