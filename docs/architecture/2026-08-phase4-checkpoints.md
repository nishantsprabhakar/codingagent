# Phase 4 — Complete checkpoints and auditability

## What changed

Replaced the per-file, UTF-8-only, unconditional-overwrite snapshot mechanism
(`src/workspaceSnapshot.ts`) with:

1. **Binary-safe, mode-aware, staleness-checked single-file snapshots** — for tools that already
   know their own single target path (`write_file`, `edit_file`, `create_docx/pptx/xlsx`,
   `redline_docx`).
2. **Whole-workspace git-tree checkpoints** (new `src/gitCheckpoint.ts`) — for `run_shell_command`,
   the only tool that can create, delete, rename, or `chmod` arbitrary files, which never had any
   rollback coverage before this phase.

## Scope decision: rejected literal "Git worktrees"

The backlog's literal suggestion ("preferring isolated Git worktrees when the project is a Git
repo") was rejected as the implementation mechanism. A `git worktree add` checkout has no disk-cost
advantage over a plain recursive copy for a *restore-in-place* use case — it only shares the `.git`
object database, not working-tree files — and would introduce a new temp-directory lifecycle this
codebase has no precedent for. Git's real advantage here (cheap, byte-exact, deduplicated storage)
comes from using git *plumbing* directly (`write-tree`/`read-tree`/`checkout-index` on blob/tree
objects) without ever materializing a second working directory. True worktree-based isolation
remains the right mechanism for Phase 10 (parallel isolated agents) — a different problem
(concurrent execution) than this one (restore-in-place after the fact).

## Part A — `src/workspaceSnapshot.ts`

`FileSnapshot.before` changed from UTF-8 text (`fs.readFileSync(abs, "utf-8")` — corrupts any
binary file) to base64-encoded raw bytes. Added `modeBefore`/`modeAfter` (POSIX permission bits)
and `existedAfter`/`after` — the latter two captured the moment a mutating tool call succeeds
(`captureAfterSnapshot()`), giving `restoreSnapshot()` a real staleness check: before restoring, it
re-reads the file's *current* content and compares against the recorded `after` value; a mismatch
(something else touched or deleted the file since the transaction finished) produces
`"skipped_conflict"` instead of clobbering. A pre-Phase-4 record (no `encoding` field) decodes as
text and restores unconditionally — exactly today's old behavior, so historical transaction logs
keep working with no migration. Both functions now route through `resolveInRoot()` instead of a
bare `path.join`, closing a symlink-safety gap the old mechanism had relative to every real tool.

## Part B — `src/gitCheckpoint.ts` (new)

`isGitRepo(root)` requires `root` to *be* the toplevel of a git working tree, not merely inside
one — a sandbox nested inside a larger repo gets no tree-checkpoint coverage (same honest-limitation
treatment as a non-git project), since `git add -A` with no pathspec would otherwise stage the
whole outer repo. `captureTree(root)` stages the complete tracked+untracked state (respecting
`.gitignore`) into a throwaway `GIT_INDEX_FILE` and returns a `write-tree` SHA — pure
object-database writes, the user's real index is never touched. `restoreTree(root, beforeTree,
afterTree)` re-captures the current tree and requires it to exactly match `afterTree` before doing
anything (the same staleness principle as Part A, at whole-tree granularity since a shell command
has no single target path) — any mismatch aborts the whole action's restore rather than attempting
a partial one.

**Gating signal**: `run_shell_command` always classifies as `"medium"`/`"high"` risk, never
`"low"` — risk level can't gate "does this touch files." Reused (moved into `riskClassifier.ts` as
exported `isReadOnlyIshShellCommand`) the existing `READ_ONLY_ISH_SHELL` heuristic that already
gated `shouldVerify`, so both call sites stay in sync from one definition.

### Two real bugs found during live verification (not caught by unit tests) — fixed here

1. **`rollbackAvailable` only checked `fileSnapshot`, never `treeSnapshot`** — a transaction whose
   only mutating evidence was a shell-command tree checkpoint never showed a "Revert changes"
   button at all, even though rollback data existed. Fixed in `finalizeTransaction()`.
2. **`isReadOnlyIshShellCommand("echo x > file.txt")` returned `true`** — the heuristic matches on
   a *leading* keyword (`echo`, `cat`, etc.) without checking for an output redirect later in the
   string, so any shell command starting with `echo`/`cat`/`type` and writing via `>` was
   misclassified as read-only. This silently skipped both `shouldVerify()`'s build check and (more
   seriously, for this phase) tree-checkpoint capture entirely — a shell command shaped exactly
   like the ones this phase is supposed to cover. Fixed by disqualifying any command containing
   `>` from being read-only-ish, regardless of what precedes it. Both bugs are covered by new
   regression tests (`src/__tests__/riskClassifier.test.ts`, and the `rollbackAvailable` fix is
   exercised indirectly by the live verification described below since no `Agent`-level test
   harness exists to unit-test `finalizeTransaction()` directly — same honest gap noted in the
   Phase 3 doc).
3. **`checkout-index -a -f` rewrote every tracked file in the whole repository on every rollback**
   — found live, not in unit tests: after a real rollback, `git status` flagged ~70 files across
   the repo as modified, none of which the triggering shell command had touched.
   `git diff`/`git hash-object` proved zero actual content change (confirmed no data was
   corrupted) — the effect was mtime-only, caused by unconditionally checking out *every* path in
   the loaded tree instead of only the paths the before/after diff says changed. Fixed by computing
   the diff first and scoping `checkout-index` to exactly those paths
   (`checkoutPaths()`/`git checkout-index -f -- <paths>` instead of `-a`). Regression test added:
   `src/__tests__/gitCheckpoint.test.ts`'s "never rewrites a file the action didn't touch" case,
   asserting an unrelated tracked file's mtime is bit-for-bit unchanged after a restore.

### A property discovered, not designed: idempotent repeats collapse safely

During live verification, a flaky free model retried the same (already-successful)
create+modify+delete shell command many times across one transaction, most of them no-ops against
already-mutated state. Because tree SHAs are content-addressed, every no-op repeat recorded an
identical `(beforeTree, afterTree)` pair, and rollback — which independently checks each recorded
action's `afterTree` against the *current* tree before restoring — correctly matched and restored
only the one action whose `afterTree` equaled the current state, and safely reported
`"skipped_conflict"` for every other (now-stale) recorded action in the same transaction, with zero
special-casing required. The full transaction rolled back to the true original state.

## Migration

No code changes to `transactionLog.ts` — same reasoning as Phase 3: `loadTransaction()`'s only
consumer (`rollbackTransaction()`) already tolerates old records missing the new fields
(`treeSnapshot`, `FileSnapshot.encoding`/`modeBefore`/`after`/etc. are all optional).

## Verification performed

- `npm run build` / `npm run typecheck` — clean.
- `npm run test` — 115/115 passing (2 skipped: POSIX-permission-bit tests on this Windows dev
  machine), including 8 new `workspaceSnapshot` tests, 9 new `gitCheckpoint` tests, and 5 new
  `riskClassifier` tests.
- **Live, through the actual web UI** — not just unit tests: a `run_shell_command` that created,
  modified, and deleted files in this real repository was checkpointed and rolled back correctly,
  including through a messy multi-retry transaction (see above); the two real bugs above were
  found this way and fixed; confirmed via `git diff`/`git status` that the fixed implementation
  touches only the files a given shell command actually changed.

## Known, explicitly-scoped-out limitations

- Non-git projects: `run_shell_command` gets no checkpoint coverage — unchanged from before this
  phase, not a regression.
- git-ignored paths (`node_modules`, build output) are invisible to the tree checkpoint, matching
  `git status`'s own scope.
- Tree-snapshot durability depends on `write-tree` objects staying reachable; this phase does not
  add ref-protection against `git gc` reclaiming old, unreferenced checkpoint objects — an explicit
  non-goal, consistent with `transactionLog.ts`'s existing unbounded, no-eviction append-only
  design. A very old rollback could fail with "objects may have been garbage-collected" after a
  `gc` run; `restoreTree()` reports this distinctly rather than silently doing nothing.
- Large repos pay `git add -A`'s full-tree-stat cost on every non-read-only-ish shell command; the
  `isReadOnlyIshShellCommand` gate is the only mitigation in scope for this phase.
