/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Whole-workspace checkpointing for `run_shell_command` — the only tool that can create, delete,
 * rename, or chmod arbitrary files, which the single-file mechanism in workspaceSnapshot.ts can't
 * cover (it only knows one target path per call). This uses git plumbing only — blob/tree objects
 * via `write-tree`/`read-tree`/`checkout-index` — never a second working directory (a
 * `git worktree add` checkout has no disk-cost advantage over a plain copy for a restore-in-place
 * use case; it only shares the .git object database, not working-tree files). Every operation reads
 * or writes the object database and a throwaway scratch index — the user's real staging area
 * (`.git/index`) is never touched.
 */
import { execSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveInRoot } from "./tools/paths";

const GIT_TIMEOUT_MS = 30_000;

function runGit(root: string, args: string[], env: NodeJS.ProcessEnv): string | null {
  try {
    return execSync(`git ${args.join(" ")}`, {
      cwd: root,
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
      env,
    })
      .toString("utf-8")
      .trim();
  } catch {
    return null;
  }
}

function scratchIndexPath(): string {
  return path.join(os.tmpdir(), `wrexlyn-idx-${crypto.randomBytes(8).toString("hex")}`);
}

/**
 * True only when `root` IS the top level of a git working tree — not merely "somewhere inside one."
 * A sandbox nested inside a larger repo would make `git add -A` (no pathspec) stage the WHOLE outer
 * repo, producing a tree rooted at the wrong place; rather than handle that, this case simply gets no
 * tree-checkpoint coverage (the same honest-limitation treatment as a non-git project).
 */
export function isGitRepo(root: string): boolean {
  const top = runGit(root, ["rev-parse", "--show-toplevel"], process.env);
  if (!top) return false;
  try {
    // fs.realpathSync.native (the OS's own realpath, not Node's JS-implemented one) is required here
    // on Windows: the JS implementation doesn't resolve 8.3 short-name components (e.g. "NISHAN~1")
    // to their canonical long form, but git always reports the long form — comparing against the
    // non-native realpath on a path that goes through a short-name alias produces a false mismatch.
    return path.resolve(fs.realpathSync.native(top)) === path.resolve(fs.realpathSync.native(root));
  } catch {
    return path.resolve(top) === path.resolve(root);
  }
}

/**
 * Captures the complete current working-tree state (tracked + untracked, respecting .gitignore) as a
 * git tree object — pure object-database writes, never a second working directory, never the user's
 * real index. Returns the tree SHA, or null if this isn't a (toplevel) git repo or any git op failed.
 */
export function captureTree(root: string): string | null {
  if (!isGitRepo(root)) return null;
  const scratchIndex = scratchIndexPath();
  const env = { ...process.env, GIT_INDEX_FILE: scratchIndex };
  try {
    if (runGit(root, ["add", "-A"], env) === null) return null;
    return runGit(root, ["write-tree"], env) || null;
  } finally {
    fs.rmSync(scratchIndex, { force: true });
  }
}

/**
 * Points a ref at `sha` so `git gc` (default ~2 weeks expiry on unreachable objects) can never reclaim
 * it — `write-tree` output is otherwise unreferenced garbage. Best-effort; a failure here just means
 * the checkpoint's durability is bounded by git's own gc schedule instead of being permanent, not that
 * anything breaks immediately. Follows the same "unbounded, no eviction" precedent transactionLog.ts's
 * append-only JSONL already establishes — a pruning policy for either is an explicit non-goal here.
 */
export function protectTree(root: string, ref: string, sha: string): void {
  runGit(root, ["update-ref", ref, sha], process.env);
}

interface TreeDiffEntry {
  status: string;
  relPath: string;
}

/** Pure tree-to-tree diff — reads only the object database, never touches the index or disk. */
function diffTrees(root: string, beforeTree: string, afterTree: string): TreeDiffEntry[] | null {
  // --no-renames is required, not optional: some git versions/configs enable rename detection by
  // default for `diff --name-status`, which reports a rename as a single "R100\told\tnew" line
  // instead of the plain D+A pair this function's caller relies on (checkout-index already restores
  // D-status paths from beforeTree; the explicit delete-of-"A"-paths loop removes new paths — together
  // that handles a rename correctly with no special-casing, but only if renames are actually split).
  const out = runGit(root, ["diff", "--no-renames", "--name-status", beforeTree, afterTree], process.env);
  if (out === null) return null;
  if (!out) return [];
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ status: line[0], relPath: line.slice(line.indexOf("\t") + 1) }));
}

/**
 * Checks out only `relPaths` from `treeSha` — never the whole-tree `checkout-index -a`, which would
 * rewrite every tracked file in the repository (touching its mtime, even when content is unchanged)
 * on every single rollback, no matter how small the original action was. `relPaths` always come from
 * `git diff --name-status` output, never external/attacker-controlled input, but are still quoted
 * defensively since a path could contain a space.
 */
function checkoutPaths(root: string, treeSha: string, relPaths: string[]): boolean {
  if (relPaths.length === 0) return true;
  const scratchIndex = scratchIndexPath();
  const env = { ...process.env, GIT_INDEX_FILE: scratchIndex };
  try {
    if (runGit(root, ["read-tree", treeSha], env) === null) return false;
    const pathArgs = relPaths.map((p) => `"${p.replace(/"/g, '\\"')}"`).join(" ");
    if (runGit(root, ["checkout-index", "-f", "--", pathArgs], env) === null) return false;
    return true;
  } finally {
    fs.rmSync(scratchIndex, { force: true });
  }
}

/** Count of changed paths between two tree SHAs -- used by Best-of-N (parallelRun.ts) to summarize an
 * attempt's changes without needing gitCheckpoint's internal diff-entry shape. Null on any git failure. */
export function countChangedPaths(root: string, beforeTree: string, afterTree: string): number | null {
  const diff = diffTrees(root, beforeTree, afterTree);
  return diff === null ? null : diff.length;
}

export interface TreeRestoreResult {
  ok: boolean;
  /** True only when the workspace changed since this action's recorded "after" tree — nothing was touched. */
  conflict: boolean;
  restoredPaths: string[];
  deletedPaths: string[];
  reason?: string;
}

/**
 * Restores the workspace to `beforeTree`, but only if it currently matches `afterTree` exactly (the
 * same staleness principle as workspaceSnapshot.ts's per-file check, at whole-tree granularity since
 * a shell command has no single target path). On any mismatch, aborts the entire action's restore
 * rather than attempting a partial one.
 */
export function restoreTree(root: string, beforeTree: string, afterTree: string): TreeRestoreResult {
  const current = captureTree(root);
  if (current === null) {
    return {
      ok: false,
      conflict: false,
      restoredPaths: [],
      deletedPaths: [],
      reason: "Could not recompute the current workspace tree (git unavailable, or this is no longer a git repository).",
    };
  }
  if (current !== afterTree) {
    return {
      ok: false,
      conflict: true,
      restoredPaths: [],
      deletedPaths: [],
      reason: "The workspace changed after this action finished — refusing to overwrite those changes.",
    };
  }

  const diff = diffTrees(root, beforeTree, afterTree);
  if (diff === null) {
    return {
      ok: false,
      conflict: false,
      restoredPaths: [],
      deletedPaths: [],
      reason: "Could not diff the recorded before/after trees (objects may have been garbage-collected).",
    };
  }

  // M/D/T entries need their beforeTree content checked out; A entries (created since beforeTree)
  // get deleted instead — never checked out, since they don't exist in beforeTree at all.
  const toRestore = diff.filter((e) => e.status !== "A").map((e) => e.relPath);
  const toDelete = diff.filter((e) => e.status === "A").map((e) => e.relPath);

  if (!checkoutPaths(root, beforeTree, toRestore)) {
    return {
      ok: false,
      conflict: false,
      restoredPaths: [],
      deletedPaths: [],
      reason: "git checkout-index failed while restoring the pre-change tree.",
    };
  }

  const deletedPaths: string[] = [];
  for (const relPath of toDelete) {
    try {
      const abs = resolveInRoot(root, relPath);
      if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
      deletedPaths.push(relPath);
    } catch {
      // Can't safely resolve/remove — leave it in place rather than risk deleting the wrong thing;
      // it shows up as an unexpected extra file, never a silently-lost one.
    }
  }

  return { ok: true, conflict: false, restoredPaths: toRestore, deletedPaths };
}
