# Phase 10 — Parallel isolated agents (Best-of-N)

Date: 2026-08-14.

## Scope decision

The backlog described Phase 10 only as "parallel isolated agents," depending on "Phase 4's
Git-worktree-based checkpoints" — which turned out to be factually wrong. Phase 4 deliberately
avoided git worktrees for its own use case (whole-workspace rollback needs a restore-in-place, not a
second working directory), using pure git tree-object plumbing instead. Phase 4's own doc explicitly
named Phase 10 as where real worktree isolation belongs — this phase is where that actually happens,
built from scratch rather than reused.

The user chose the concrete shape: run the same task N ways in parallel (**Best-of-N**), each in a
real, isolated `git worktree`, then pick one result to merge back. Research confirmed
`src/convergence.ts`'s existing `runDivergentRepairEnsemble` — despite superficially sounding
related — is not reusable here: it's two parallel LLM *text* completions (root-cause diagnosis prose)
with no tool-calling loop or working-directory concept at all, bolted onto the single-transaction
repair path. Best-of-N needed genuinely new machinery: N real, tool-executing `Agent` instances
running concurrently in N isolated working directories.

## Adversarial review caught two severe issues before any code was written

A draft design was reviewed against a real, throwaway git repo — not just read, *reproduced* — and
found:

1. **The originally-planned merge-back call had its arguments backwards and could never actually
   merge anything.** `restoreTree(root, beforeTree, afterTree)` (`gitCheckpoint.ts`) is
   rollback-shaped: it asserts the workspace's *current* tree equals `afterTree`, then moves it to
   `beforeTree`. The naive "forward" call — `restoreTree(mainRoot, initialTreeSha, winnerTreeSha)` —
   checks `current === winnerTreeSha`, which is false (the main root was never touched, so it's still
   at `initialTreeSha`), and returns a conflict every single time. The review reproduced this against
   a real repo (edit + delete + add), found the failure, then verified the *corrected* call —
   `restoreTree(mainRoot, winnerTreeSha, initialTreeSha)` (target as `beforeTree`, actual-current as
   `afterTree`) — reproduces the winner's tree byte-for-byte. Zero new merge/diff logic needed either
   way; only the argument order needed correcting.
2. **Fresh worktrees have no `node_modules`** (or `.venv`/`vendor`/`target`) — untracked/gitignored in
   virtually every real project — so automatic build/test verification would spuriously fail for
   reasons unrelated to whether the agent's actual work was correct, and could trigger wasted
   automatic repair loops. The user was asked and chose to symlink/junction shared dependency
   directories from the main root into each worktree (fast, explicitly accepting that a concurrent
   install across attempts could corrupt the shared directory, since attempts are meant to be
   code-change tasks, not dependency-management tasks).

Also confirmed via the review (and by direct reads): `session.ts`/`transactionLog.ts` are fully
root-scoped (`<root>/.coding-agent/...`), so N concurrent worktree roots never collide;
`codeIndex.ts`/`gitHistory.ts`'s module-level caches are keyed by realpath, also safe. One real,
practically-scoped gap was found and flagged rather than silently fixed underneath the design:
**`shellServiceClient.ts` funnels every shell-tool call from every Agent instance in the process
through one shared forked child process** — correctness holds (requests are keyed and carry their own
`cwd`), but shell commands across all N attempts serialize rather than truly running in parallel, and
a crash of that one child fails every pending call across every attempt (though it transparently
respawns for the next call). Rebuilding this into a per-attempt pool was judged out of scope for this
phase and is stated as a known limitation below, not silently absorbed.

## What shipped

- **`src/worktree.ts`** (new) — `createWorktree(root, runId, index)`: `git worktree add --detach
  <path> HEAD` (no new branch — these are throwaway comparison attempts), guarded by `isGitRepo`
  reused as-is from `gitCheckpoint.ts`. `linkSharedDependencies`: symlinks (junction on Windows)
  `node_modules`/`.venv`/`vendor`/`target` from the main root into the worktree, skipping any that
  don't exist. `removeWorktree`: unlike every `runGit()` call in `gitCheckpoint.ts` (which silently
  swallows failures — appropriate for best-effort checkpoint pinning), this does **not** swallow
  errors, so a cleanup failure surfaces instead of leaving a silent orphan. `sweepOrphanedWorktrees`:
  parses `git worktree list --porcelain` and removes anything matching this module's own
  `wrexlyn-bestofn-` naming convention — run once at the start of every new Best-of-N invocation, since
  a match can only be a leftover from a crashed/killed prior run (no in-flight run state persists
  across restarts).
- **`src/parallelRun.ts`** (new) — `startParallelRun`: refuses to start unless
  `gitStatusPorcelain(root) === ""` (reused from `workspaceSnapshot.ts`) — the fix for the review's
  most serious finding-adjacent risk: a dirty main root would otherwise let every worktree build on
  clean `HEAD` content while the "before" baseline captured a dirty state, silently losing the user's
  own uncommitted work at merge time. Captures the baseline tree **once** from the main root (a fresh
  worktree's tree is always exactly `HEAD^{tree}`, confirmed independent of anything dirty in the main
  root at creation time — redundant per-worktree recapture isn't needed given the clean-tree
  precondition). Each of N attempts (capped at 4, default 3 — bounding concurrent LLM/shell/MCP-server
  load, since each attempt gets its own independent `McpManager`) gets its own worktree, a
  `PermissionManager(true /* yolo */, ...)` (reusing the existing bypass-everything flag exactly as-is
  — the user's explicit choice, since nothing reaches the real project without an explicit merge
  review), a distinct steering note (a cheap diversity nudge — "prioritize the simplest fix" /
  "consider a more thorough approach" / etc.) appended to the task text, and a distinct `temperature`
  spread across attempts (see below). Runs all N via `Promise.all`, each wrapped so cleanup always
  waits for the attempt's own promise to actually settle — never force-killed mid-flight, since there
  is no cancellation primitive anywhere in this codebase (confirmed: no `AbortController`/`signal` in
  `agent.ts` or any provider client). `mergeParallelRunAttempt`: the corrected merge-back call.
  `cleanupParallelRun`: removes every worktree once all attempts have settled, surfacing (not
  swallowing) any cleanup failure.
- **`src/types.ts` / four provider files** (`groq.ts`, `openrouter.ts`, `pollinations.ts`,
  `openaiCompatible.ts`) — `LlmConfig` gained an optional `temperature` field (defaulting to the
  existing hardcoded `0.15` when unset, so ordinary single-turn chat is unaffected). All four
  providers previously hardcoded `0.15`; the review flagged that N attempts at that fixed low
  temperature, differing only by a short steering note, would likely converge to near-identical
  output — undercutting the point of running N of them. Attempts now spread across
  `[0.15, 0.4, 0.65, 0.9]`.
- **`src/agent.ts`** — `startParallelRun`/`getParallelRunStatus`/`pickParallelRunAttempt`/
  `cancelParallelRun`, thin methods holding one active run at a time (matching how everything else in
  this class is already single-transaction-at-a-time). `pickParallelRunAttempt` records the merge as
  a **normal transaction** in the main session's own log — reusing `appendTransaction` verbatim, with
  the natural (pre-state, post-state) tree-snapshot convention `rollbackTransaction`'s *existing*
  generic code already expects — so a merged Best-of-N result shows up in the ordinary outcome UI and
  can be undone via the **already-existing** "Revert changes" button, with zero new rollback code.
- **`src/web/protocol.ts` / `server.ts`** — `start_parallel_run`/`parallel_run_pick`/
  `parallel_run_cancel` (client→server), `parallel_attempt_event`/`parallel_run_complete`/
  `parallel_run_merged` (server→client). `parallel_attempt_event`'s payload reuses the exact same
  `ServerMessage` discriminated union already used for the main chat's WS messages (tagged with an
  attempt index) — no new event vocabulary needed for "what happened," only "who it happened to."
- **`public/index.html`/`app.js`/`style.css`** — a "Run N ways" composer button opening a small N
  picker (2–4), a comparison view with one card per attempt (steering note, live status streamed from
  `parallel_attempt_event`, final outcome/confidence badge reusing the existing
  `OUTCOME_CLASS`/`OUTCOME_LABELS` styling, changed-file count), "Use this one" per settled card,
  "Discard all". One incidental bug fixed while building this UI is unrelated to Best-of-N itself:
  `src/projectMemory.ts` — see below.
- **`src/index.ts`** — `/parallel <n> <task text>` CLI command: prints per-attempt progress tagged by
  index, a final summary, then prompts to merge or discard.

## A real bug found during live verification, fixed on the spot

Live-verifying through the actual web UI against a fresh scratch repo, the very first attempt to
start Best-of-N was refused: "Commit or stash your changes before running Best-of-N." The scratch repo
had just been committed clean — but simply *connecting* Wrexlyn to it had created an untracked
`.coding-agent/memory.json` (via `projectMemory.ts`'s `detectProjectMemory`/`saveProjectMemory`),
which `git status --porcelain` correctly reported as dirty. `session.ts`/`codeIndex.ts`/`evidence.ts`
each already write a `.coding-agent/.gitignore` (`*`) the first time they touch their own subdirectory
— but `projectMemory.ts` never did, so `.coding-agent/memory.json` specifically was never covered
unless one of the other three modules happened to run first. In practice this means **Best-of-N's
clean-tree precondition would have rejected essentially every freshly-opened project**, since simply
starting a chat is enough to create `memory.json` before anything else touches `.coding-agent/`.
Fixed by adding the same one-line `.gitignore`-ensuring snippet to `saveProjectMemory` (the same
pattern the other three modules already use) — confirmed by rebuilding, clearing the scratch repo's
stale `.coding-agent/` directory, and re-running: the project stayed git-clean after reconnecting, and
Best-of-N started immediately.

## Testing

`src/__tests__/worktree.test.ts` (7 tests, against real git repos in temp dirs): worktree
creation/removal, that a fresh worktree reflects last-committed content independent of uncommitted
changes in the main root, dependency-directory linking (present vs. missing), and the orphan sweep
correctly matching only its own naming convention (confirmed it never touches a foreign worktree).
`src/__tests__/parallelRun.test.ts` (5 tests): the corrected merge-back direction verified end-to-end
against a real repo — an edit, a delete, and an add all landing correctly, the main root's tree
matching the winning attempt's tree byte-for-byte; the merge correctly refusing (not clobbering) when
the main root changed since the run started; the clean-tree and git-repo preconditions correctly
rejecting before any LLM call is ever made. Two of the new worktree tests initially failed from a path
representation mismatch (`os.tmpdir()`'s 8.3 short-form path vs. git's canonical long-form,
forward-slash output) — a test-only artifact (confirmed `path.basename()`, what the production sweep
logic actually uses, already handles forward slashes correctly on Windows) — fixed by normalizing
both sides before comparing in the test. Full suite: 212 tests, 209 pass, 3 skipped
(pre-existing/environment-gated), 0 fail.

## Live verification — what was confirmed, and an honest gap

**Confirmed directly, through the actual web UI** against a real scratch git repo (not the project's
own repo, deliberately — Best-of-N's clean-tree precondition and worktree/merge mechanics shouldn't be
exercised against a repo with in-progress uncommitted work): two real, isolated `git worktree`
checkouts were created (confirmed via `git worktree list`); both attempts ran concurrently with their
own `Agent` instances, streaming live per-attempt status (`tool_call`/`thinking` events) into the
comparison UI through the real WebSocket protocol; both settled to `"done"`; clicking "Use this one"
correctly recorded a well-formed, reversible transaction in the main session's log and removed **both**
worktrees (confirmed `git worktree list` showed only the main root afterward). This exercised the full
pipeline: precondition checks, worktree lifecycle, concurrent agent execution, live event tagging,
completion detection, merge, transaction recording, and cleanup.

**Honest gap**: the free-tier `pollinations · openai` model used for this test made no file edits in
either attempt ("0 files changed" for both) — a model-capability/free-tier limitation, not a defect in
this phase's code (the same class of flakiness already documented repeatedly elsewhere in this
project's history). This means the live UI run never exercised a merge with an actual, non-trivial
diff. That gap is closed by `parallelRun.test.ts`'s direct, byte-for-byte verification of the corrected
merge-back logic against real edit/delete/add changes in a real repo — arguably a more rigorous check
of the merge mechanics than a live model happening to produce a small diff would have been, but it is
not the same as watching a real model's actual code change land through the UI, and that distinction
is stated plainly rather than glossed over.

## Known, explicitly-scoped-out limitations

- **`shellServiceClient.ts`'s shared single child process is not fixed this phase.** Shell commands
  across all N attempts still serialize through one forked process rather than truly running in
  parallel; a crash fails every pending call across every attempt (transparent respawn covers the
  *next* call). An explicit, stated tradeoff, not a silent one.
- **No true cancellation** — a timed-out or abandoned attempt keeps running in the background until it
  naturally finishes; nothing in this codebase can kill an in-flight LLM/tool call.
- **MCP servers multiply by N** — each attempt gets its own independent `McpManager`; factored into
  the N cap, not otherwise mitigated.
- **Symlinked dependency directories are shared, not isolated** — a concurrent install across attempts
  could corrupt the shared directory; explicitly accepted per the user's choice.
- **Loopback consistency across a mid-run crash relies on the next invocation's sweep** — a process
  killed between creating some worktrees and returning a `ParallelRunState` to the caller cleans up
  what it created so far (via a try/catch around the launch loop), but a harder crash (the whole
  process dying) still relies on `sweepOrphanedWorktrees` running on the *next* Best-of-N invocation,
  not immediately.
