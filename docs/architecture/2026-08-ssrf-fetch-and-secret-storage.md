# SSRF-hardened outbound fetch and OS-backed secret storage

Date: 2026-08-12. Follow-up to `2026-08-phase1-security-fixes.md` — these
were the two highest-priority items its §3 deferred. Both are now
implemented, tested, and (for the parts this machine can actually exercise)
manually verified live, including against the real user's own pre-existing
configuration.

## 1. SSRF-hardened outbound fetch

**Files:** `src/net/ipSafety.ts` (new), `src/net/safeFetch.ts` (new),
`src/tools/web.ts` (updated to use it).

The previous `web_fetch` implementation checked the *hostname string*
against a short blocklist and then called the global `fetch()`, which
resolves DNS and follows redirects internally — neither of which the
hostname-string check could see or re-validate. Concretely, a hostname that
resolves to a private/internal address (DNS rebinding, or simply an
attacker-controlled DNS record) sailed straight through, and so did a
redirect to one.

`safeFetch()` replaces this with:

- **Resolve-then-validate-then-connect.** The hostname is resolved via
  `dns.promises.lookup(..., { all: true })`; *every* resolved address (not
  just the first) is checked against `ipSafety.ts`'s blocklist — built on
  Node's own `net.BlockList` rather than hand-rolled regex, which gets
  IPv4-mapped IPv6 addresses right automatically (verified:
  `::ffff:127.0.0.1` correctly matches a `127.0.0.0/8` IPv4 subnet rule).
  If any resolved address is blocked, the whole hostname is refused.
- **Connect to the pre-validated literal IP directly**, not the hostname —
  `Host` header and TLS `servername` (SNI) are set to the original
  hostname so virtual hosting and certificate validation still work
  correctly (verified live against `https://example.com/`: resolves to
  two real IPs, connects to one directly, gets a valid 200 with no cert
  error). This closes the DNS-rebinding window entirely: there is no
  second, separate lookup between validation and connection for an
  attacker to race.
- **Redirects are followed manually**, one hop at a time, repeating the
  exact same resolve→validate→connect sequence for every hop, capped at 5
  by default. A redirect to a blocked address is rejected exactly like a
  direct request to one would be (verified: a local test server that's
  been explicitly allow-listed for the test redirects to
  `169.254.169.254`, and the real, unmodified `ipSafety` blocklist
  rejects it).
- **Response size is capped during streaming**, and — separately —
  **after decompression**, so a small gzip/deflate/br response can't
  expand into a memory-exhausting one (verified: a ~2MB all-zeros payload
  compresses to a few KB on the wire; a cap well above the wire size but
  below the decompressed size correctly aborts the stream).
- Protocol is restricted to `http`/`https` before any resolution happens.

Verified live against the real internet, outside the automated suite (kept
hermetic/offline): `https://example.com/` (plain fetch), `http://google.com/`
(a real redirect chain, landed on `http://www.google.com/` with 200).

Tests: `src/__tests__/ipSafety.test.ts` (13 tests — every blocked range
category for IPv4 and IPv6, including the AWS/Azure/GCP metadata address
and its IPv6-mapped form, plus confirming genuinely public addresses are
allowed) and `src/__tests__/safeFetch.test.ts` (14 tests — pre-connect
rejection of literal blocked addresses, the DNS-rebinding case via an
injected resolver, multi-address-record handling, protocol restriction,
successful fetch and redirect-following against real local test servers,
redirect-to-blocked-address rejection, max-redirect enforcement, raw and
decompressed size caps, and a correctness check that a real small gzip
response still decodes properly under the cap).

## 2. OS-backed secret storage for API keys

**Files:** `src/secretStore.ts` (new), `src/apiKeys.ts` (rewritten to use
it — its public API is now `async`, with every call site updated:
`src/index.ts`, `src/web/server.ts`).

- **Windows:** values are encrypted with the Windows Data Protection API
  (DPAPI, `CurrentUser` scope) via a short PowerShell invocation, then the
  ciphertext (not the plaintext) is stored in a local JSON file
  (`~/.coding-agent/secrets.dpapi.json`). Deliberately chosen over driving
  the Credential Manager Win32 API (`CredWrite`/`CredRead`) directly via
  P/Invoke embedded in a shelled-out script — DPAPI is a single well-known
  .NET type, materially less fragile to get right across PowerShell
  versions than hand-written P/Invoke boilerplate, and still a genuine
  OS-level security boundary tied to the Windows user's login. Secret
  bytes travel over the child process's stdin, never as a command-line
  argument.
- **macOS:** the real login Keychain, via the `security` CLI. Disclosed
  limitation: `security add-generic-password` takes the secret as a
  command-line argument (no stdin form for writes exists in the standard
  CLI), so it's briefly visible to another local process inspecting the
  process list for the instant the command runs.
- **Linux:** libsecret via `secret-tool` (GNOME Keyring/KWallet). Writes go
  over stdin — no argv exposure. Availability is probed with a real
  operation, not just "is the binary present," since `secret-tool` can be
  installed with no keyring daemon reachable over D-Bus (e.g. a headless
  server) — in which case it falls through to the plaintext backend.
- **Fallback:** the original plaintext JSON file this project always used,
  at the same path, so nothing breaks if no OS mechanism is available. A
  one-time warning is logged when this path is taken. The active backend
  is always printed at startup (`API key storage: ...`) in both the CLI
  and web-server startup banners.
- **Migration:** the first time a key is read after a secure backend
  becomes active, any entries still in the legacy plaintext file are moved
  into the secure backend and removed from the plaintext file (the file is
  deleted outright if that empties it).

### Verification honesty

This session runs on Windows. The Windows/DPAPI backend and the plaintext
fallback are verified **live** — real PowerShell/DPAPI calls, real file
I/O, both in the automated suite and manually against this repository's
own actual `~/.coding-agent/` directory (see below). The macOS
(`MacKeychainBackend`) and Linux (`LinuxSecretServiceBackend`) backends'
platform-gating (`isAvailable()` correctly returns `false` on a
non-matching OS) is verified on every platform, since it's a pure
`process.platform` check — but their actual `security`/`secret-tool`
invocation logic has **not** been exercised on a real macOS or Linux
machine in this session. It's implemented against each tool's documented,
stable CLI syntax, but that's "implemented against the spec," not "verified
live," and this document says so rather than blur the difference.

### Live migration, on the real thing

Beyond the automated suite (which uses temp directories exclusively), this
was verified against this machine's actual, pre-existing
`~/.coding-agent/api-keys.json` — which had real `openrouter` and `gemini`
keys in plaintext from earlier in this project's history. After backing
the file up, the running web server's `/api/api-keys` route was hit for
real:

- Before: `api-keys.json` (plaintext) contained both keys.
- After: `api-keys.json` no longer exists (fully migrated, so it was
  removed); `secrets.dpapi.json` now contains both keys as DPAPI
  ciphertext (confirmed the stored blobs contain no substring of either
  plaintext key); `/api/api-keys` still correctly reports both as set,
  with the same masked suffix as before the migration.

Tests: `src/__tests__/secretStore.test.ts` (round-trip on the plaintext and
Windows-DPAPI backends including a check that the on-disk DPAPI file never
contains the plaintext value, platform-gating for all four backends, and
`getSecretStore()`'s fallback selection when every platform-specific
backend is forced unavailable) and `src/__tests__/apiKeys.test.ts`
(load/save/clear round-trip through whichever backend the running platform
selects, provider isolation, and the legacy-plaintext-migration path).

## 3. Verification commands run

```
npm run build       # clean
npm run typecheck    # clean
npm run test         # 74/74 passing (was 60 before this milestone)
npm run verify       # clean
```

## 4. What's still open

- macOS/Linux `secretStore.ts` backends: implemented, not live-verified
  (see above) — needs a real run on each OS before being fully trusted.
- Everything else already listed in `backlog-phase3-through-13.md`
  (command-execution service separation, MCP env scrubbing, CI pipeline,
  the two breaking-change `npm audit` dependency upgrades, and Phases 3
  onward) is unchanged by this milestone.
