# Wrexlyn — repository assessment, gap analysis, and threat model

Date: 2026-08-12. Scope: this document is the required Phase 1 repository
assessment. It describes the state of the codebase *before* this milestone's
fixes; see `2026-08-phase1-security-fixes.md` for what changed and
`backlog-phase3-through-13.md` for everything still open.

## 1. Architecture map

Single Node.js/TypeScript process (`src/`, compiled to `dist/`), no external
services, no database. Two front ends share one core:

- **CLI/REPL** (`src/index.ts`) — readline loop, local-terminal trust
  boundary (the user typing commands is the same person the process runs as).
- **Web UI** (`src/web/server.ts` + `public/*.js`) — a plain Node `http`
  server plus a `ws` WebSocket server, serving a hand-written vanilla-JS SPA.
  This is the one network-facing surface in the whole product and is the
  focus of this assessment.

Core modules the two front ends both drive:

| Module | Responsibility |
|---|---|
| `src/agent.ts` | The agent loop: model calls, tool dispatch, the "V-Cycle" reliability pipeline (risk-gate → snapshot → verify → critique → repair → confidence score). |
| `src/tools/*.ts` | File read/write/edit, shell exec, search, Word/PowerPoint/Excel/PDF generation, all gated through `src/tools/paths.ts`'s `resolveInRoot`. |
| `src/permissions.ts` | Per-action risk classification and the approve/deny/always-allow decision. |
| `src/session.ts`, `src/transactionLog.ts` | Per-project persistence under `.coding-agent/` — chat history, audit trail, rollback snapshots. |
| `src/providers/*.ts`, `src/llm.ts` | Six pluggable model providers behind one dispatcher. |
| `src/mcp.ts` | MCP client (stdio servers, user-configured in `mcp.json`). |
| `src/apiKeys.ts`, `src/globalSettings.ts` | Machine-wide settings (API keys, global instructions) under the user's home directory. |

## 2. Gap analysis (as found, before this milestone)

Ordered by severity. Each was independently verified by reading the actual
source, not inferred from behavior.

1. **CRITICAL — unauthenticated, network-bound web server.** `httpServer.listen(port)` with no host argument binds every interface (`0.0.0.0`), and zero routes or the WebSocket connection ever checked for a credential. Anyone on the same network — or reachable via port-forwarding, a misconfigured firewall, or a shared machine — had full read/write/delete access to the project, shell-adjacent tool calls (subject only to the existing permission-prompt UI, which a remote attacker's own WebSocket client can simply auto-answer), and could read/change stored API keys. This is the single highest-impact issue in the codebase.
2. **CRITICAL — path traversal via unvalidated session/transaction IDs.** `switch_session`/`delete_session`/`rollback_request` WebSocket messages carry a client-supplied `id`/`transactionId` string that was interpolated directly into a filesystem path (`` `${id}.json` ``) with no validation anywhere in the call chain. `delete_session` reaching `fs.rmSync` made this a genuine arbitrary-file-deletion primitive for any `*.json` file reachable via `../` from the sessions directory, gated only by issue #1's (absent) auth.
3. **HIGH — lexical-only path confinement.** `resolveInRoot` (the single choke point for every tool's file access) used `path.normalize`/`path.relative`/`startsWith("..")` with no `fs.realpathSync` call anywhere. A symlink or Windows junction placed inside the project root pointing outside it defeated the check entirely — the check ran against the pre-resolution string, which still lexically started with the root, while the real target did not.
4. **MEDIUM — no security response headers, no rate limiting, unbounded WebSocket message size.** No `X-Frame-Options`/CSP/etc. on any response; no per-IP or per-connection request throttling; `WebSocketServer` had no `maxPayload`, so a single message of unbounded size would be accepted.
5. **MEDIUM — `/api/lan-qrcode` advertised a bare, unauthenticated URL.** The QR-pairing feature encoded the plain `http://<lan-ip>:<port>` with no credential of any kind, and was generated even when the server wasn't actually meant to be LAN-reachable (see #1 — it always was, by default).
6. **Documentation drift.** README.md explicitly and incorrectly told users "the server already listens on all interfaces, not just localhost" as a *feature description*, reinforcing the unsafe default rather than flagging it.

Not yet assessed in this milestone (explicitly deferred — see backlog): the
Phase 1 items for hardened outbound web-fetch (SSRF/DNS-rebinding
protection), OS-backed secret storage, MCP environment-variable scrubbing,
and separating the command-execution service from the web UI process. These
are real, scoped gaps, not overlooked — see the backlog document for why
each was triaged out of this specific milestone and what doing them properly
would require.

## 3. Threat model

**Assets:** the user's project source code, shell access to the user's
machine (via the shell-exec tool), stored LLM provider API keys, chat
history/audit trail, generated documents.

**Trust boundaries:**
- The CLI/REPL: the operator IS the trusted principal (same OS user running
  the process). Out of scope for network-attacker threat modeling; in scope
  for "don't let a malicious/compromised MCP server or a crafted file this
  agent reads escalate beyond the sandboxed project root."
- The web UI: the browser is a separate principal from the server process
  the moment `--lan` is used, or even locally the moment any other local
  process/browser tab could reach `127.0.0.1:<port>` (a genuinely different,
  lesser threat: any other locally-running software on the same machine).

**Actors considered:**
- *Network-adjacent attacker* (same Wi-Fi/LAN, or the internet if the port
  is ever forwarded) — the primary actor issue #1 addresses. Mitigated by:
  binding to loopback by default, requiring `--lan` as an explicit,
  deliberate opt-in, and requiring a per-process random token on every
  connection regardless of bind address.
- *Malicious/buggy web page open in the same browser* (a same-machine,
  different-tab actor) — could attempt to reach `127.0.0.1:<port>` from
  JavaScript on an unrelated site. Mitigated by: Origin-header allowlisting
  on the WebSocket handshake (`verifyClient`), and the auth token not being
  guessable or stored anywhere a cross-origin page can read it
  (`sessionStorage` is origin-scoped; the token also never appears in a
  response an attacker-controlled origin could fetch, since CORS is not
  enabled and the browser's same-origin policy blocks a cross-origin
  `fetch` from reading the response body even if the request itself is
  sent).
- *A crafted file/symlink inside the project* (e.g., a cloned malicious
  repo, or a dependency's postinstall script) attempting to make the
  agent's own file tools read/write outside the intended sandbox. Mitigated
  by the realpath-aware `resolveInRoot` fix.
- *A malicious MCP server or tool-call argument* attempting path traversal
  via a session/transaction ID smuggled through some other channel. Mitigated
  by `idValidation.ts`'s allowlist being enforced at the path-building
  function itself (`sessionPath`/`transactionLogPath`), not just at the one
  call site it was first found at — so a future caller can't reintroduce the
  bug by forgetting to check.

**Explicitly out of scope for a single-user local tool** (documented, not
silently ignored): a fully compromised OS user account; a model provider
that returns malicious tool-call arguments faster than a human can review a
permission prompt (the existing risk-gating UI is the mitigation layer for
this, unchanged by this milestone); TLS/encryption-in-transit on the LAN
hop (this is plain HTTP over a local network by design — see the backlog
for why adding TLS to a local dev tool is a larger, separately-scoped
decision, not a quick fix).

## 4. Verification performed for this document

- Read `src/web/server.ts`, `src/tools/paths.ts`, `src/session.ts`,
  `src/transactionLog.ts`, `src/web/protocol.ts`, `src/index.ts`,
  `public/app.js` in full (not excerpts) before drawing any conclusion above.
- Confirmed each claimed vulnerability by tracing the actual call chain from
  client-controlled input to the sink (documented inline in the code
  comments added alongside the fixes), not by pattern-matching for
  "looks risky."
