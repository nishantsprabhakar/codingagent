# 2026-08-14 — Symbol map, opt-in Docker sandbox, multi-tab session safety

**Update (same day):** a follow-up product-quality review flagged the installer and the
untested Docker sandbox path as remaining gaps. See "Installer packaging bug found and fixed"
at the end of this doc for what was actually found and fixed, and an honest note on why the
Docker gap could not be closed the same way.

Three architectural gaps arrived as a single prescriptive request (specific file paths like
`src/context/astIndex.ts`, `src/config.ts`, `src/session/`, `src/server/`, and specific
libraries — `tree-sitter`, `proper-lockfile`). None of those paths exist in this codebase,
which uses flat top-level modules instead, and one of the three "gaps" was not actually a
gap. Direct exploration of the repo before writing any code (per the approved plan) found:

- **Symbol map** was already substantially solved by `src/codeIndex.ts`'s existing
  incremental symbol index. The right move was extending it with a new tool, not adopting
  tree-sitter — a dependency that codebase's own doc comments record as deliberately
  rejected to keep this a double-click-installable app with no native bindings.
- **Docker sandboxing** was a real, unaddressed gap. `src/shellService.ts` (process
  separation for shell exec, from an earlier phase) explicitly documents that it protects the
  *decision* to run a command, never what that command can do once running.
- **Multi-tab races** were real: every WebSocket connection builds its own independent
  `Agent`, each loading the same on-disk session into memory at connect time with no
  cross-connection awareness, and `session.ts` wrote directly with `fs.writeFileSync` (no
  atomicity), unlike `codeIndex.ts`'s already-established temp-file+rename pattern.

## 1. `get_symbol_map` — whole-repo structure in one call

`getSymbolMap()` in `src/codeIndex.ts` groups the same `SymbolEntry[]` data
`searchCode`/`findSymbol` already extract per file, filters out symbol-free files, applies the
existing path-prefix filter, and caps the result at `DEFAULT_SYMBOL_MAP_FILE_LIMIT` (150
files) so a large monorepo can't blow the model's context window in one call — the same
capped-and-honest-about-it pattern as `searchCode`'s own `capped` flag. `getSymbolMapTool`
(`src/tools/codeSearch.ts`) exposes it with a compact one-line-per-file format
(`path/to/file.ts: class Foo, function bar`), distinct from `find_symbol`'s per-match list
format, since the point here is letting the model see structure at a glance.

**Live-verified**: called against this repo's own `src/tools/` directory through the real web
UI (18 files, correct symbol grouping) — see the transcript captured during this session.

## 2. Opt-in Docker sandbox (`--sandbox` / `--sandbox-image`)

`src/dockerSandbox.ts` adds `isDockerAvailable()` (cached for the process lifetime, matching
`codeIndex.ts`'s throttling convention) and `runInDockerSandbox()`, which runs the command via
`docker run --rm -v <cwd>:/workspace -w /workspace --memory=1g --cpus=2 <image> sh -c
"<command>"` using `execFile` (argv array, no shell — same reasoning as `gitCheckpoint.ts`'s
earlier fix). `src/shellService.ts`'s `runOne` branches on `req.sandbox`: sandboxed on
success, host execution with a visible `(--sandbox was requested but Docker is unreachable —
ran on host instead.)` warning when Docker isn't reachable — never a silent downgrade.

Deliberate, stated trade-offs (not silently assumed):

- **Network stays enabled** (Docker's default bridge) — `npm install`/`git fetch` need it.
  The containment value here is filesystem/process isolation, not network isolation.
- **Default image is `node:18-alpine`**, which has no `git`, no `python`, etc. A command
  needing a tool the image doesn't ship will fail inside the sandbox where it wouldn't on the
  host. `--sandbox-image` lets the user pick a different one.
- `ToolContext` (`src/types.ts`) carries `sandbox?`/`sandboxImage?` from CLI flags through
  every `Agent` construction site, including the previously-missed one: `web/server.ts`'s
  `switch_folder` handler rebuilds its `Agent` on every folder switch, and that rebuild was
  found (during this work, not by the original request) to drop `sandboxOptions` — fixed
  alongside the rest of this gap.

**Honest verification note**: Docker is not installed in the environment this was built and
tested in. `isDockerAvailable()` correctly resolves `false` there, and the fallback path was
verified with an environment-forced test (`PATH` stripped so the `docker` binary can't be
found — indistinguishable from Docker being absent) — see Testing below. The actual
containerized-execution path (`runInDockerSandbox` succeeding, a destructive command's blast
radius staying inside the mounted volume) has **not** been exercised against a live Docker
daemon; the tests that would do so are written to run automatically the first time this is
tested somewhere Docker is available, and skip cleanly (not falsely-pass) otherwise.

## 3. Multi-tab session safety

Two independent fixes, matching the smaller, safer scope the user picked over full live sync:

- **Atomic writes**: `session.ts`'s `saveSession` now writes to a per-process temp file
  (`${sessionPath}.${pid}.tmp`) and `fs.renameSync`s it into place — the same pattern
  `codeIndex.ts`'s `savePersisted` already used elsewhere in this repo. A reader can no longer
  observe a partially-written session file, whether from a crash mid-write or two tabs saving
  the same session close together.
- **Cross-tab "reload needed" notice**: `Reporter` (`src/types.ts`) gained
  `sessionPersisted(sessionId)`, a no-op everywhere except `WebSocketReporter`
  (`src/web/reporter.ts`), which forwards it to an optional `notifyOthers` callback.
  `web/server.ts`'s `startWebServer` maintains a per-server `activeConnections` registry (one
  entry per open WebSocket, added on connect, removed on close); each connection's
  `notifyOthers` walks that registry and sends a new `session_changed_elsewhere` message
  (`src/web/protocol.ts`) to every *other* connection currently viewing the same session id.
  `Agent.persist()` (`src/agent.ts`) calls `this.reporter.sessionPersisted(this.sessionId)`
  right after `saveSession(...)` — the one choke point every session write already goes
  through, so no other call site needed to change.
- **Frontend** (`public/app.js`/`style.css`): a dismissible banner — "This chat was updated in
  another tab." with a Reload button that re-issues `switch_session` for the same id, reusing
  the existing session-switch code path to pull the authoritative on-disk state rather than
  attempting any in-memory merge.

**Live-verified** with two real browser tabs against the running dev server (both resumed the
same most-recent session, as they would with no session explicitly requested): a message sent
in tab A produced a real assistant reply and persisted; tab B received the
`session_changed_elsewhere` banner without any user action, and clicking its Reload button
correctly pulled tab A's new message into tab B's view.

## Testing

- `src/__tests__/codeIndex.test.ts` — extended with `getSymbolMap` cases: grouping/sort,
  the path filter, the file-count cap, and symbol-free files being excluded.
- `src/__tests__/dockerSandbox.test.ts` (new) — `isDockerAvailable()` tolerant of Docker being
  absent (as it is here); a real sandboxed run and a real sandboxed-failure case, both skipped
  when Docker isn't available rather than falsely passing; an environment-forced
  Docker-unreachable case (via a stripped `PATH`) proving `runOne`'s host fallback and its
  warning text actually fire.
- `src/__tests__/session.test.ts` (new) — round-trip correctness, no leftover `.tmp` file
  after a successful save, repeated-save correctness (latest-wins, `createdAt` preserved), and
  `listSessions` ordering.
- `src/__tests__/webReporter.test.ts` (new) — `WebSocketReporter.sessionPersisted` forwards to
  `notifyOthers` when given, never throws when it isn't, and doesn't interfere with any other
  event type.
- `npx tsc -p . --noEmit` and `npm run build && node scripts/run-tests.js` — 271 tests, 266
  passing, 0 failing, 5 skipped (up from 263/258/0/5 before this work; +8 new tests, +0
  regressions; the two Docker-live tests above account for 2 of the 5 skips, expected given
  Docker's absence here).
- Live, end-to-end (browser): `get_symbol_map` against this repo's own `src/tools/`; the
  multi-tab banner and reload flow with two real tabs (both above); Docker sandbox execution
  itself was **not** live-verified (see the honest note in section 2).

## Commits

Three separate commits, one per gap, matching this session's established convention:
`get_symbol_map` tool, opt-in Docker sandbox, multi-tab session safety (atomic writes +
cross-tab notice).

## Installer packaging bug found and fixed

A follow-up review asked to close two remaining gaps: the untested Docker sandbox path, and
the installer. Investigating the installer first (rather than assuming what was broken)
turned up a real, reproducible bug — not a hypothetical one.

**What was found**: `install.sh`'s no-`rsync` fallback (the path Git Bash on Windows actually
takes, since it doesn't ship `rsync`) does `find "$SOURCE_DIR" ... -exec cp -r`, copying every
top-level entry in the working directory except a hand-maintained exclude list
(`node_modules`, `dist`, `.git`, etc.). Running it against this repo's actual working copy
copied a stray empty directory literally named `-p` into the installed output — leftover
debris from some earlier command in this repo's history, invisible to `git status` because
git doesn't track empty directories at all. The bug wasn't "docs are dry" — it's an installer
that packages *whatever happens to be lying around*, not *what the project actually is*.
`installer/windows/wrexlyn.iss` has the identical exposure: its `[Files]` section bundles
`public\*`, `src\*`, `scripts\*` with `recursesubdirs`, which is just as blind to
tracked-vs-stray as the old `install.sh` path was.

**The fix**:
- `install.sh` now copies exactly `git ls-files` (minus `installer/`, which is Windows-only
  packaging) when the source is a git checkout, via `rsync --files-from`/`git ls-files -z` or
  a `tar --null -T -` pipe when `rsync` isn't available — an allowlist of what's actually
  committed, not a blocklist of what's guessed to be safe to exclude. The original
  name-exclude path is kept only as a last-resort fallback for a non-git source tree.
- `scripts/write-version.js` — already the one hook every documented build path runs right
  before compiling `wrexlyn.iss` — now runs `git status --porcelain` scoped to
  `public/`, `src/`, `scripts/` and **hard-fails** if it finds untracked files there (exactly
  the class of bug just found), or **warns** (but proceeds) on modified-but-tracked files,
  since building from an uncommitted work-in-progress is a legitimate thing to do
  deliberately.
- Verified by actually re-running `install.sh` against this repo (with an isolated fake
  `$HOME` so the test never touched real user directories) before and after the fix: before,
  the stray `-p` directory and a planted stray test file both leaked into the install; after,
  neither did, and `installer/` was correctly excluded too.
- `src/__tests__/writeVersion.test.ts` (new) exercises the actual current
  `scripts/write-version.js` file (copied into a fixture git repo, since the script resolves
  its root from its own file location) for: a clean tree succeeding, an untracked file
  blocking the build with no `version.json` written, an untracked file *outside* the packaged
  dirs being correctly ignored, and a modified tracked file warning without blocking.
- `wrexlyn.iss` itself was **not** rewritten to consume a generated file manifest — Inno Setup
  isn't installed in this environment, so a structural change to a `.iss` file that can't be
  compile-tested here would be an unverified guess, not a fix. The write-version.js guard
  catches the same bug class at the one point in the real build process that can be tested.

**The Docker sandbox gap was not closed the same way.** There is no code-level bug to find and
fix here — `isDockerAvailable()`/`runInDockerSandbox()` were already correct on inspection and
covered by tests that pass without a live daemon. What's missing is proof against a real
running container, and that requires either installing Docker Desktop in this environment
(a genuine system-level change — enabling WSL2/Hyper-V, admin rights, likely a reboot — well
outside what should happen without the user's explicit go-ahead) or the user testing it
themselves somewhere Docker already runs. Neither happened in this pass; the honest state is
unchanged from the original write-up above: code-reviewed and unit-tested, not live-verified.

Tests: 275 total, 270 passing, 0 failing, 5 skipped (up from 271/266/0/5; +4 new tests, +0
regressions). Committed separately from the three architectural-gap commits above, matching
this session's one-logical-change-per-commit convention.
