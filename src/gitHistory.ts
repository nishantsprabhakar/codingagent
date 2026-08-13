/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * The "git-history signal" half of Phase 5 — a cheap, always-on recency list used two ways: as a
 * small block in the auto-gathered project context (see projectContext.ts) and as a minor ranking
 * boost inside codeIndex.ts's search_code. Deliberately much cheaper than gitCheckpoint.ts's
 * plumbing: this runs synchronously inside Agent's constructor on every session start (and on every
 * provider/model switch, which constructs a fresh Agent), so it needs a short timeout and a TTL
 * cache, not gitCheckpoint.ts's 30s budget which is tuned for a different, explicitly user-triggered
 * operation.
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { isGitRepo } from "./gitCheckpoint";

const RECENT_ACTIVITY_TIMEOUT_MS = 3_000;
const CACHE_TTL_MS = 60_000;
const LOG_COMMIT_LIMIT = 300;

interface CacheEntry {
  files: string[];
  at: number;
}

const cache = new Map<string, CacheEntry>();

function runGit(root: string): string | null {
  try {
    return execSync(`git log --no-merges --name-only --pretty=format: -n ${LOG_COMMIT_LIMIT}`, {
      cwd: root,
      timeout: RECENT_ACTIVITY_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString("utf-8");
  } catch {
    return null;
  }
}

function realpathKey(root: string): string {
  try {
    return fs.realpathSync.native(root);
  } catch {
    return path.resolve(root);
  }
}

/**
 * Recently-changed files across the last 300 non-merge commits, most-recent-first, deduped by
 * first occurrence. Returns null for a non-git directory or on any git failure — never throws.
 * An ORDERED array, not a Set: callers (codeIndex.ts) grade "how recent" by index, not just
 * membership.
 */
export function getRecentActivity(root: string): { files: string[] } | null {
  if (!isGitRepo(root)) return null;

  const key = realpathKey(root);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return { files: cached.files };

  const out = runGit(root);
  if (out === null) return null;

  const seen = new Set<string>();
  const files: string[] = [];
  for (const line of out.split("\n")) {
    const relPath = line.trim();
    if (!relPath || seen.has(relPath)) continue;
    seen.add(relPath);
    files.push(relPath);
  }

  cache.set(key, { files, at: Date.now() });
  return { files };
}

/** Test-only seam — clears the TTL cache so a test can force a fresh git call. */
export function _resetGitHistoryCacheForTesting(): void {
  cache.clear();
}
