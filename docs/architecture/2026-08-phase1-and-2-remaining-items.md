# Phase 1/2 remaining items — MCP env scrubbing, CI, shell-exec separation, structured errors, dependency scanning

Date: 2026-08-13.

Closes items 3–8 of the "Immediately next" list in
`backlog-phase3-through-13.md`. Each item below states what was built, what
was found along the way (including two real bugs), and — where relevant —
what it honestly does not cover.

## 3. MCP environment scrubbing + explicit per-var allowlist

Audited `src/mcp.ts` first, since the backlog item was phrased as "audit
whether...". Finding: `@modelcontextprotocol/sdk`'s `StdioClientTransport`
spawns MCP server child processes via `cross-spawn`, and already merges a
small OS-appropriate default allowlist (`DEFAULT_INHERITED_ENV_VARS`, e.g.
`PATH`, `HOME`) with whatever `env` object the caller passes — it does not
inherit the full parent environment. So this app's own provider API keys
(`GROQ_API_KEY`, `OPENROUTER_API_KEY`, etc.) were never actually leaking into
MCP children. But that was true only as an implicit side effect of a
third-party dependency's default, not something this app explicitly owns or
tests.

Added `envPassthrough?: string[]` to `McpServerConfig` and a new pure
function, `buildMcpServerEnv(config, parentEnv)`, that starts from the
server's own literal `env` block and layers in only the named
`envPassthrough` vars pulled live from the parent process at connect time —
nothing else. `connectOne()` now calls this instead of passing `config.env`
straight through, so the app has an explicit, testable, own allowlist
regardless of what the SDK's default happens to be. Documented with a worked
example in `mcp.json.example`. 5 new tests in `src/__tests__/mcp.test.ts`
cover: nothing passed through by default, API keys never forwarded unless
explicitly listed, a live passthrough value, `env` + `envPassthrough`
combining with passthrough winning on collision, and a passthrough name
absent from the parent env being silently skipped.

## 4 & 7. CI pipeline + dependency vulnerability scanning

`.github/workflows/ci.yml`: a `verify` job running `npm ci && npm run verify`
across a `windows-latest` × `ubuntu-latest` by Node `18.x`/`20.x`/`22.x`
matrix (6 combinations, `fail-fast: false`), plus a separate `audit` job
running `npm run audit` (`audit-ci --config .audit-ci.json`) on
`ubuntu-latest`/Node 20. `.github/dependabot.yml` adds weekly update PRs for
both the `npm` and `github-actions` ecosystems.

`audit-ci` (new devDependency) was chosen over a blanket `npm audit
--audit-level=high` because it supports a precise, per-advisory allowlist by
GHSA ID — a specific, currently-unfixable finding (see item 8) can be
suppressed with a documented reason while any *new* advisory still fails the
build. A blanket severity gate would have forced a permanent choice between
a red CI or ignoring the whole severity tier.

**Bug found while wiring the allowlist**: `audit-ci`'s object-form allowlist
entry (`{"GHSA-...": {"notes": "..."}}`) silently did nothing without an
explicit `"active": true` key. Reading `audit-ci`'s source
(`isNSPRecordActive()` in its compiled bundle) showed it checks
`content.active` directly — the library's `DEFAULT_NSP_CONTENT` defaults are
a separate constant that is never merged into a user-supplied partial
object, so a missing `active` key is indistinguishable from an
intentionally-disabled entry. Fixed by adding `active: true` to both entries
in `.audit-ci.json`; verified locally with `npm run audit` passing with the
message "Found vulnerable allowlisted advisories" rather than silently
green.

## 5. Command-execution service separation

New `src/shellService.ts` (the same `exec()` logic that used to live inline
in `tools/shell.ts`, relocated unchanged) is now the entry point of a
separate forked child process, talked to over Node's built-in `fork()` IPC
channel by a new `src/shellServiceClient.ts` (lazy-spawn on first use,
auto-respawn if the child dies, per-request timeout with IPC-round-trip
slack on top of the exec timeout). `src/tools/shell.ts` now delegates to
`runInService()` instead of calling `exec()` in-process.

**What this isolation does and does not provide** (stated here, not left
implicit, per the doc-comment already in `shellService.ts`): it does **not**
sandbox what a shell command can do once it runs — a malicious or buggy
command still has the same OS-level permissions it always had, and this was
never in scope. What it *does* do is move the decision to call `exec()` at
all out of the network-facing web-server process and into a separate,
narrower process whose only job is running the one command it's told to
run. If the web process is ever compromised through some other vector (a
dependency vulnerability, a request-handling bug), that compromise does not
by itself grant in-process `exec()` capability — the attacker would need to
also compromise or spoof the IPC channel to the shell service.

**dev/prod parity, verified empirically, not just reasoned about**: `fork()`
inherits `process.execArgv`, and `tsx` (used in dev via `npm run dev`/`npm
run web`) registers itself through `execArgv` flags rather than rewriting
`__filename` extensions — confirmed with disposable probe scripts (since
deleted) that under `tsx`, `__filename` for every module keeps its original
`.ts` extension, and `process.execArgv` exposes the exact loader flags `tsx`
registered. So `shellServiceClient.ts` derives the child's script path as
`path.join(__dirname, "shellService" + path.extname(__filename))` and
forks with `execArgv: process.execArgv` — this resolves to `shellService.ts`
under `tsx` and `shellService.js` in the compiled `dist/` build, with no
separate dev/prod code path.

**Live end-to-end verification** (2026-08-13): started the actual compiled
web server (`dist/index.js --web`), sent "Run this exact shell command: echo
hello-from-shell-service" through the browser UI on a live OpenRouter free
model, approved the permission prompt, and confirmed the returned output
contained `hello-from-shell-service`. Separately confirmed via the OS
process list that `dist/shellService.js` is running as a distinct child
process of the web server's PID, not inline in it.

**Real hang found and fixed along the way, unrelated to the service logic
itself**: `src/__tests__/shellService.test.ts` is the one place in this
codebase exercising a real `fork()`+IPC child (not mocked), and after it the
whole `node --test` run would hang indefinitely instead of exiting, even
though every test reported passing in under a second. Isolated
minimal-repro scripts (fork + kill + `_getActiveHandles()` logging, later
deleted) showed a killed child alone lets the parent exit in ~75ms with no
lingering handles — so the hang is specific to some interaction between
`node --test`'s own worker/scheduling internals and a process that briefly
held an IPC channel, not a bug in this codebase's own cleanup. Fixed with
Node's own documented escape hatch for exactly this situation:
`--test-force-exit` (available since Node ~18.18/20.2, within this project's
`engines: ">=18"` and the new CI matrix's Node range), added to
`scripts/run-tests.js`'s `spawnSync` call.

## 6. Structured error classes + safe structured logging with redaction

New `src/errors.ts`: a `WrexlynError` base class (`code` discriminant,
`this.name` auto-set to the real subclass name via `new.target.name`) with
three subclasses — `PermissionDeniedError`, `PathTraversalError`,
`ProviderError` (with an optional `provider` field). `SafeFetchError`
(`src/net/safeFetch.ts`) was refactored to extend this base instead of
`Error` directly, with no behavior change (`new.target.name` reproduces the
exact `err.name === "SafeFetchError"` behavior the existing test suite
already asserted on).

`redact(text, knownSecrets = [])` combines two strategies: exact-value
replacement of secrets the caller already has on hand (e.g. the current
provider's live API key — zero false positives, works for any provider),
plus shape-based regex fallbacks for well-known key prefixes (Groq `gsk_`,
Anthropic `sk-ant-`, OpenRouter `sk-or-v1-`, Google `AIza`, generic OpenAI-
style `sk-`) for values the caller doesn't have on hand. Deliberately not a
blind long-random-string pattern — that would also redact git SHAs, UUIDs,
and hashes that are genuinely useful for debugging. `logError(context, err,
knownSecrets)` wraps this for the common "log safely" case.

Wired into `src/web/server.ts`: the HTTP and WebSocket error handlers, and
both `agent.connectMcp().catch(...)` sites, now call `logError`/`redact`
with the current provider's live API key as a known secret, instead of
logging `err.message` raw. New `src/__tests__/errors.test.ts` covers the
class hierarchy's `code`/`name`/`instanceof` behavior, both redaction
strategies, confirmation that ordinary debugging content is left untouched,
and that `logError` redacts before it reaches `console.error`.

## 8. Dependency audit findings

The backlog's stated upgrade targets (`pptxgenjs` → 1.1.5+, `exceljs` →
3.4.0+) turned out to be stale — they were `npm audit`'s auto-suggested fix
versions from an earlier pass, which are *lower* than what's actually
installed today (`pptxgenjs@4.0.1`, `exceljs@4.4.0`). Re-investigated from
the current `npm audit --json` output rather than trusting the old note:

- **`uuid` (moderate, transitive via `exceljs`) — fixed.** `exceljs` only
  uses `uuid`'s stable `v4()` export (confirmed by grepping
  `node_modules/exceljs`), so forcing the patched range via
  `"overrides": { "uuid": "^11.1.1" }` in `package.json` is safe and carries
  no behavior change.
- **`image-size` (two advisories — ICNS and JXL/HEIF parser DoS, transitive
  via `pptxgenjs`) — no fix available upstream.** Confirmed via `npm view
  image-size versions` that the latest published release (2.0.2) is still
  inside both advisories' vulnerable range (`<=2.0.2`) — there is currently
  no non-vulnerable version to upgrade to. Documented and allowlisted in
  `.audit-ci.json` (`GHSA-w3rx-r6r6-pgpr`, `GHSA-5p2g-fcmc-qvqq`) with the
  reasoning above in the `notes` field, so CI stays green on this specific,
  known, currently-unfixable pair while still failing on anything new.
  **Revisit when image-size ships a fix** — at that point `pptxgenjs`'s own
  dependency range would need to actually resolve to it, which may also
  require a `pptxgenjs` upgrade if it hasn't bumped its own `image-size`
  range by then.

## Verification

`npm run verify` (typecheck + full test suite): clean, 133 tests total (131
pass, 2 skipped — POSIX-permission-only tests skip on Windows by design),
0 failures. `npm run audit`: passes with the two documented, allowlisted
`image-size` advisories and nothing else. Live end-to-end check of item 5
per that section above.

## What this does not close

This closes backlog items 3–8. It does **not** revisit the two items 1–2
scope caveats already recorded in `2026-08-ssrf-fetch-and-secret-storage.md`
(macOS/Linux secret-storage backends unverified on those OSes), and it does
not start any Phase 5+ feature work. The originally-stated Phase 1/2 gate —
"do not begin later phases until security remediation, test infrastructure,
build, lint, typecheck and relevant regression tests pass" — is now fully
closed for the first time this session: every item on the original
"Immediately next" list is done.
