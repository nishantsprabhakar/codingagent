# 2026-08-14 — Symbol map, opt-in Docker sandbox, multi-tab session safety

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
