/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Git worktree lifecycle for Best-of-N parallel isolated agents (Phase 10). A worktree is a real,
 * separate checkout that shares the same repo's object database — unlike gitCheckpoint.ts (which
 * deliberately avoids worktrees for single-agent rollback, since a restore-in-place has no use for a
 * second working directory), Best-of-N genuinely needs N agents editing files concurrently without
 * stomping on each other, which only a real second working directory provides.
 */
import { execSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const GIT_TIMEOUT_MS = 30_000;
/** Recognizable prefix for every Best-of-N worktree directory -- lets sweepOrphanedWorktrees()
 * identify its own leftovers from a crashed/killed prior run without touching anything else. */
const WORKTREE_PREFIX = "wrexlyn-bestofn-";

function runGit(root: string, args: string[]): string | null {
  try {
    return execSync(`git ${args.join(" ")}`, { cwd: root, timeout: GIT_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] })
      .toString("utf-8")
      .trim();
  } catch {
    return null;
  }
}

/** Dependency directories commonly untracked/gitignored -- absent from a fresh worktree, which
 * would otherwise make automatic build/test verification spuriously fail for reasons unrelated to
 * whether the agent's actual work is correct. Linked (not copied) per explicit user choice. */
const SHARED_DEPENDENCY_DIRS = ["node_modules", ".venv", "vendor", "target"];

/**
 * Creates a detached-HEAD worktree off the current commit (no new branch -- these are throwaway
 * comparison attempts, not something the user continues developing on directly as a named branch).
 * Returns the new worktree's absolute path, or null on failure (including when `root` isn't a git
 * repo -- callers should already have guarded with isGitRepo()/gitStatusPorcelain(), but this never
 * throws either way).
 */
export function createWorktree(root: string, runId: string, attemptIndex: number): string | null {
  const worktreePath = path.join(os.tmpdir(), `${WORKTREE_PREFIX}${runId}-${attemptIndex}`);
  fs.rmSync(worktreePath, { recursive: true, force: true }); // clear any stale leftover at this exact path first
  const result = runGit(root, ["worktree", "add", "--detach", `"${worktreePath}"`, "HEAD"]);
  return result !== null ? worktreePath : null;
}

/**
 * Symlinks (junction on Windows) each dependency directory found in `root` into `worktreePath`,
 * skipping any that don't exist. Shared, not copied -- fast, but a concurrent install across
 * attempts could corrupt the shared directory; an explicitly accepted tradeoff, not silently picked.
 */
export function linkSharedDependencies(root: string, worktreePath: string): void {
  for (const dirName of SHARED_DEPENDENCY_DIRS) {
    const source = path.join(root, dirName);
    const link = path.join(worktreePath, dirName);
    if (!fs.existsSync(source)) continue;
    try {
      fs.symlinkSync(source, link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      // Best-effort only -- if linking fails (e.g. permissions), the attempt just runs without that
      // dependency directory, same as any other fresh-checkout limitation; never fatal to the attempt.
    }
  }
}

/**
 * Removes a worktree. Unlike every `runGit()` call in gitCheckpoint.ts (which silently swallows
 * failures, appropriate for best-effort checkpoint pinning), this one does NOT swallow errors --
 * returns false on failure so the caller can surface "this worktree could not be cleaned up" rather
 * than silently leaving an orphan behind.
 */
export function removeWorktree(root: string, worktreePath: string): boolean {
  return runGit(root, ["worktree", "remove", "--force", `"${worktreePath}"`]) !== null;
}

/**
 * Sweeps any worktree whose path matches this module's own naming convention -- these can only be
 * leftovers from a crashed/killed prior Best-of-N run, since no in-flight run state is persisted
 * across restarts. Called once at the start of every new Best-of-N invocation. Returns the paths it
 * removed (for logging), never throws.
 */
export function sweepOrphanedWorktrees(root: string): string[] {
  const listing = runGit(root, ["worktree", "list", "--porcelain"]);
  if (!listing) return [];

  const orphaned: string[] = [];
  for (const line of listing.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const worktreePath = line.slice("worktree ".length).trim();
    if (path.basename(worktreePath).startsWith(WORKTREE_PREFIX)) orphaned.push(worktreePath);
  }

  const removed: string[] = [];
  for (const worktreePath of orphaned) {
    if (removeWorktree(root, worktreePath)) removed.push(worktreePath);
  }
  return removed;
}

/** Random id for a single Best-of-N run -- used to namespace all N of its worktree directories. */
export function generateRunId(): string {
  return crypto.randomBytes(6).toString("hex");
}
