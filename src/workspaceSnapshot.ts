/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { resolveInRoot } from "./tools/paths";

export type SnapshotEncoding = "utf8" | "base64";

export interface FileSnapshot {
  path: string;
  existed: boolean;
  before: string | null;
  /**
   * Absent on any snapshot persisted before Phase 4 — the only encoding that ever existed then was
   * implicit UTF-8 text. `restoreSnapshot` treats a missing `encoding` as `"utf8"`, never `"base64"`,
   * so old transaction logs stay byte-for-byte rollback-safe with no migration. Always `"base64"` on
   * a freshly-taken snapshot (binary-safe: reads raw bytes, never assumes text).
   */
  encoding?: SnapshotEncoding;
  /** POSIX permission bits (mode & 0o777) immediately before the mutation. Absent on !existed or a pre-Phase-4 record. */
  modeBefore?: number;
  /**
   * Set by `captureAfterSnapshot()` once the mutating call returned ok:true — the durable record of
   * "what we left the file as," used by `restoreSnapshot()` to detect whether something else has
   * touched the file since. Absent on a pre-Phase-4 record, or if the capture itself failed — either
   * way `restoreSnapshot` degrades that one file to the old unconditional-restore behavior.
   */
  existedAfter?: boolean;
  after?: string | null;
  modeAfter?: number;
}

export type FileRestoreStatus = "restored" | "skipped_conflict" | "failed";

export interface FileRestoreResult {
  path: string;
  status: FileRestoreStatus;
  /** Human-readable, UI-safe. Present for "skipped_conflict"/"failed" only. */
  reason?: string;
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

/** Captures a file's current content (or "didn't exist") before a mutating tool touches it. Binary-safe. Never throws. */
export function snapshotFile(root: string, relPath: string): FileSnapshot {
  try {
    const abs = resolveInRoot(root, relPath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return { path: relPath, existed: false, before: null, encoding: "base64" };
    }
    const stat = fs.statSync(abs);
    return {
      path: relPath,
      existed: true,
      before: fs.readFileSync(abs).toString("base64"),
      encoding: "base64",
      modeBefore: stat.mode & 0o777,
    };
  } catch {
    return { path: relPath, existed: false, before: null, encoding: "base64" };
  }
}

/**
 * Captures the file's post-mutation state — call once a mutating tool call has returned ok:true, in
 * addition to (not instead of) the pre-mutation `snapshotFile()` call. Never throws; on any read
 * failure returns `snapshot` unchanged, which `restoreSnapshot()` reads as "no after-state recorded
 * for this file" and degrades to the pre-Phase-4 unconditional-restore behavior for it alone.
 */
export function captureAfterSnapshot(root: string, snapshot: FileSnapshot): FileSnapshot {
  try {
    const abs = resolveInRoot(root, snapshot.path);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return { ...snapshot, existedAfter: false, after: null };
    }
    const stat = fs.statSync(abs);
    return {
      ...snapshot,
      existedAfter: true,
      after: fs.readFileSync(abs).toString("base64"),
      modeAfter: stat.mode & 0o777,
    };
  } catch {
    return snapshot;
  }
}

function currentFileState(abs: string): { existed: boolean; content: string | null } {
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return { existed: false, content: null };
    return { existed: true, content: fs.readFileSync(abs).toString("base64") };
  } catch {
    return { existed: false, content: null };
  }
}

function restoreOneFile(root: string, snap: FileSnapshot): FileRestoreResult {
  let abs: string;
  try {
    abs = resolveInRoot(root, snap.path);
  } catch (err: any) {
    return { path: snap.path, status: "failed", reason: err.message ?? String(err) };
  }

  const isLegacy = snap.encoding === undefined;
  // Staleness check: only possible when we actually recorded an after-state (Phase-4-onward, and the
  // capture itself succeeded). A legacy pre-Phase-4 record has no after-state at all — it keeps
  // today's unconditional-overwrite behavior for that one file rather than refusing every old record.
  if (!isLegacy && snap.after !== undefined) {
    const current = currentFileState(abs);
    const expectedExisted = snap.existedAfter ?? snap.existed;
    const unchanged = current.existed === expectedExisted && current.content === snap.after;
    if (!unchanged) {
      return {
        path: snap.path,
        status: "skipped_conflict",
        reason: current.existed
          ? "File was modified after this transaction finished — restoring would discard those changes."
          : "File was deleted after this transaction finished.",
      };
    }
  }

  try {
    if (snap.existed) {
      const bytes = isLegacy ? Buffer.from(snap.before ?? "", "utf-8") : Buffer.from(snap.before ?? "", "base64");
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, bytes);
      if (snap.modeBefore !== undefined) {
        try {
          fs.chmodSync(abs, snap.modeBefore);
        } catch {
          // best-effort — never fail the whole restore over a permission bit
        }
      }
    } else if (fs.existsSync(abs)) {
      fs.rmSync(abs, { force: true });
    }
    return { path: snap.path, status: "restored" };
  } catch (err: any) {
    return { path: snap.path, status: "failed", reason: err.message ?? String(err) };
  }
}

/**
 * Restores files to their pre-transaction state, skipping any file that's been touched by something
 * else since (see `restoreOneFile`'s staleness check) rather than blindly clobbering it.
 * Manual-trigger only (the "Revert changes" button) — never called automatically.
 */
export function restoreSnapshot(root: string, snapshots: FileSnapshot[]): FileRestoreResult[] {
  return snapshots.map((snap) => restoreOneFile(root, snap));
}
