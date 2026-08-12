# Phase 1 — security fixes actually implemented in this milestone

Date: 2026-08-12. Companion to `2026-08-current-state-and-threat-model.md`
(what was found) and `backlog-phase3-through-13.md` (what's still open).

**Scope decision, stated plainly:** the full Phase 1 + Phase 2 checklist in
the originating instructions is, honestly, a multi-week engineering effort
(SSRF-hardened outbound fetch with DNS-rebinding tests, OS-keychain secret
storage with a documented fallback, a separated command-execution service,
a full CI matrix across Node versions/OSes, dependency-vulnerability
scanning, signed releases, etc.). The same instructions also asked this run
to finish fast and cheaply. Those two asks are in direct tension, so a
triage call was made rather than attempting shallow, unverified coverage of
everything: **fix the highest-severity, highest-confidence issues
completely and with real regression tests, and write down everything else
as an explicit, prioritized backlog** rather than claim partial or
unverified completion of items this pass didn't actually finish. This
document is that honest accounting — see §3 for exactly what did *not* get
done and why.

## 1. What was fixed

### 1.1 Web server: bind address, authentication, transport hardening

**Files:** `src/web/server.ts`, `src/webAuth.ts` (new), `src/web/security.ts`
(new), `src/index.ts`.

- `httpServer.listen(port, host, ...)` now binds `127.0.0.1` unless `--lan`
  is passed, in which case it binds `0.0.0.0`. Verified by test
  (`server: binds to 127.0.0.1 by default` / `binds to 0.0.0.0 only when
  --lan is explicitly passed`, both asserting the actual bound address via
  `httpServer.address()`, not just reading the source).
- A cryptographically random 256-bit token (`crypto.randomBytes(32)`) is
  generated fresh per process start, held only in memory (`WebAuth` class),
  never written to disk. Every `/api/*` route except the pairing exchange,
  and every WebSocket connection, requires it (`Authorization: Bearer
  <token>` header, or a `?token=` query param for the two browser contexts —
  `<img src>`, blob downloads — that can't set a custom header). Verified by
  live-server tests: an unauthenticated request gets 401, the correct token
  succeeds, an incorrect token is rejected, the query-param path works.
- WebSocket connections are authenticated and Origin-checked *during the
  upgrade handshake* via `ws`'s `verifyClient` option — a connection without
  a valid token or from a disallowed Origin is rejected at the HTTP level
  (401/403) before a socket is ever accepted, not accepted-then-closed.
  Verified by test (`WebSocket: a connection without a token is rejected
  during the handshake` / `...with the correct token succeeds`).
- `WebSocketServer` now sets `maxPayload: 5MB`, bounding any single message.
- A small dependency-free per-IP token-bucket rate limiter
  (`src/web/security.ts`) applies to every HTTP request (60 burst, 2/sec
  refill).
- Secure response headers (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, a `Content-Security-Policy` scoped to this app's own
  origin) are applied to every response.
- CSRF: not implemented as a separate token mechanism. Reasoning, not an
  oversight — CSRF exploits *ambient* credentials (cookies) a browser
  attaches automatically to cross-site requests. This design uses a bearer
  token that a cross-origin page cannot read or attach (no cookie is set at
  all), which removes the vulnerability class CSRF tokens exist to close.
  Documented here so it isn't mistaken for a missed checklist item.
- Time-limited LAN pairing for QR-code use: `WebAuth.issuePairingToken()`
  mints a separate, short-lived (10 min), single-use token; `/api/pair`
  exchanges a valid one for the real auth token exactly once. The QR image
  (`/api/lan-qrcode`) and the plain-text fallback (`/api/lan-info`) both
  return "LAN access is disabled" unless the server was started with
  `--lan`. Verified by unit tests on `WebAuth` (fresh-issue invalidates the
  previous token, expiry is enforced, wrong-token is rejected, single-use is
  enforced) and manually in a real browser (see §2).

### 1.2 Filesystem path confinement

**Files:** `src/tools/paths.ts`, `src/idValidation.ts` (new), `src/session.ts`,
`src/transactionLog.ts`.

- `resolveInRoot` now performs the existing lexical containment check
  *and* a realpath-aware one: it resolves the project root's real path and
  the target's real path (walking up to the nearest existing ancestor for a
  not-yet-created write target, since a symlink can't be planted at a path
  that doesn't exist yet), and rejects if the real target falls outside the
  real root. This defeats a symlink or Windows junction placed inside the
  project pointing outside it — including the case where the escaping
  symlink's target file doesn't exist yet, which a check that only looks at
  existing paths would miss. Verified by six tests covering: a plain
  in-root path, a lexical `..` escape, an absolute path outside root, an
  absolute path genuinely inside root, a not-yet-existing nested write
  path, a symlink escape with an existing target file, a symlink escape
  with a not-yet-existing leaf, and a symlink that stays inside root
  (must still work).
- New `src/idValidation.ts`: a strict allowlist (`^[a-zA-Z0-9_-]{1,128}$`)
  for session/transaction IDs, matching the actual shape
  `createSessionId()` produces. Enforced at the path-building function
  itself — `sessionPath()` in `session.ts` and the new
  `transactionLogPath()` in `transactionLog.ts` — rather than only at the
  WebSocket message handler that first surfaced the bug, so a future
  caller can't reintroduce the vulnerability by forgetting to validate.
  The WebSocket handler in `server.ts` *also* validates up front, so an
  invalid ID gets a clear user-facing error instead of a silent no-op from
  the defense-in-depth layer. Verified by a live-server test that plants a
  file outside the project root, sends `delete_session` with a `../`-laden
  id over an authenticated connection, and asserts the file still exists.

## 2. Manual verification (real server, real browser)

Beyond the automated suite, the actual `--web` server was started
(`coding-agent-devtest` launch config, rebuilt from this milestone's code)
and driven from the real Chromium-based preview browser:

- Opening the printed `http://127.0.0.1:<port>/?token=...` URL: the token
  was read into `sessionStorage`, the URL was immediately stripped back to
  a bare origin (confirmed via `location.href`), and the UI reached
  "connected" status (confirmed via the status indicator's text content and
  the WebSocket's actual state).
- Opening the bare origin with no token, in a fresh tab (no prior
  `sessionStorage`): the UI correctly stayed in "disconnected" status — the
  WebSocket handshake was rejected server-side, exactly as intended.

## 3. What Phase 1/2 explicitly did *not* get done this pass, and why

Every item below is a real, scoped gap, tracked in
`backlog-phase3-through-13.md` with the rest of the backlog, not silently
dropped:

- **Hardened outbound web-fetch (SSRF/DNS-rebinding protection).** This
  agent's `web_fetch`-style tool (if/where it exists) was not audited or
  hardened in this pass. Doing this correctly (resolve-before-connect,
  re-validate on every redirect hop, block the full private/link-local/
  metadata-address ranges for both IPv4 and IPv6, cap redirect count and
  decompressed size) is itself a multi-hour, test-heavy piece of work
  deserving its own milestone rather than a rushed addition here.
- **OS-backed secret storage for API keys.** API keys remain in the
  existing plain-JSON store (`src/apiKeys.ts`) rather than moving to
  OS keychain/Credential Manager/libsecret with a documented fallback.
  This is a real gap for a shared machine, appropriately scoped as its own
  milestone (needs a per-OS integration + a tested fallback path, not a
  quick swap).
- **MCP environment-variable scrubbing.** Whether MCP child processes
  inherit the full parent environment was not audited in this pass.
- **Separating the command-execution service from the web UI process.**
  Still one process; not split out.
- **Everything in Phase 2** (CI pipeline, lint/format tooling, dependency
  vulnerability scanning, signed releases) beyond the three `npm run`
  scripts (`typecheck`, `test`, `verify`) added here, which are real and
  passing but are the floor of Phase 2, not the ceiling.

None of these were skipped because they're unimportant — several (SSRF
hardening, secret storage) are genuinely high-severity. They were triaged
out of *this specific fast/cheap pass* in favor of finishing the two
highest-confidence, highest-blast-radius fixes (network exposure and path
traversal) completely, with real tests, rather than touching six areas
shallowly and being unable to stand behind all of them.

## 4. `npm audit` — reviewed and documented

Before this milestone: 5 vulnerabilities (2 moderate, 3 high), all in
transitive dependencies. Applied the one fix that was a non-breaking
version bump (`npm audit fix`, no `--force`): `brace-expansion`
(3 DoS advisories), pulled in transitively. Rebuilt and re-ran the full test
suite afterward — no regression.

Remaining 4 (2 moderate, 2 high), **not applied** because the only available
fix is a semver-major bump of a direct, actively-used dependency, which
needs its own regression pass against every document this app generates
before it's safe to take:

- `image-size` (high, DoS via infinite loop parsing malicious ICNS/JXL/HEIF
  image data) → transitive via `pptxgenjs`. Fix requires `pptxgenjs@1.1.5`,
  a breaking major-version change. Relevant to this app's PPTX image-embed
  path (`src/tools/documents.ts`'s image handling); tracked in the backlog.
- `uuid` (moderate, missing buffer bounds check in v3/v5/v6 when a buffer is
  supplied) → transitive via `exceljs`. Fix requires `exceljs@3.4.0+`, also
  a breaking change. Tracked in the backlog.

Both are lower urgency than the fixes in this document — neither is
reachable from network input; both require the app to already be generating
a document from attacker-controlled binary image/spreadsheet data, which is
a real but narrower threat than the web-server exposure this milestone
closed.

## 5. Verification commands run

```
npm run build      # clean
npm run typecheck   # clean
npm test             # 33/33 passing
npm run verify       # typecheck + test, clean
npm audit            # 5 → 1 fixed via non-breaking bump; 4 remain, tracked above
```
