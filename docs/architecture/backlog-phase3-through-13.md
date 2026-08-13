# Backlog — Phases 3 through 13, plus deferred Phase 1/2 items

Date: 2026-08-12, updated 2026-08-13. This is the required written backlog.
Ordered by what most directly protects users or unlocks the next layer of
work — not by the phase numbers in the original spec, since e.g. some
Phase 1 hardening is higher priority than most of Phase 3.

**Update (2026-08-12):** items 1 and 2 below (SSRF-hardened fetch, OS-backed
secret storage) are now DONE — see `2026-08-ssrf-fetch-and-secret-storage.md`
for what was implemented, tested, and verified (including live, on this
machine's real pre-existing configuration). Left here, struck through, so
the history of what was originally flagged stays visible; the doc above is
the authoritative record of what actually shipped.

**Update (2026-08-13):** Phase 3 (below) is now DONE — see
`2026-08-phase3-verification-engine.md` for the six-state outcome model,
`VerificationContract` abstraction, and what was implemented, tested, and
live-verified. Done on explicit user request, ahead of items 3-8 below
("Immediately next"), which remain outstanding — see that doc's closing
section for the explicit scope note.

## Immediately next (before any Phase 3+ feature work)

1. ~~**SSRF-hardened outbound web fetch**~~ — DONE. See
   `2026-08-ssrf-fetch-and-secret-storage.md` §1.
2. ~~**OS-backed secret storage for API keys**~~ — DONE, with one honest
   caveat: the macOS and Linux backends are implemented against each OS's
   documented CLI syntax but not live-verified on those operating systems
   in this session (only Windows/DPAPI and the plaintext fallback were).
   See `2026-08-ssrf-fetch-and-secret-storage.md` §2 for the exact scope of
   what "verified" means here before relying on the macOS/Linux paths in
   production.
3. **MCP environment scrubbing + explicit per-var allowlist** (deferred
   Phase 1D). Audit whether `src/mcp.ts` spawns child processes with the
   full parent environment; if so, require an explicit allowlist of env
   vars a given MCP server config may see, and never forward the parent's
   own API keys unless a server config explicitly asks for one.
4. **CI pipeline** (deferred Phase 2). GitHub Actions (or equivalent)
   running `npm run verify` on a Node version matrix, on both
   `windows-latest` and `ubuntu-latest`. This project has zero CI today —
   the acceptance criterion "clean Windows and Linux CI" is unmet until
   this exists, regardless of how good the local test suite is.
5. **Command-execution service separation** (deferred Phase 1E). Today the
   shell-exec tool runs in the same process as the web server. Splitting it
   into its own privileged-execution service (even just a separate child
   process with a narrower IPC surface) reduces blast radius if the web
   process is ever compromised through some other vector.
6. **Structured error classes + safe structured logging with redaction**
   (Phase 2). Right now most of the codebase uses `catch { /* best-effort
   */ }` or `console.error` with the raw error. A small `WrexlynError`
   hierarchy (e.g. `PermissionDeniedError`, `PathTraversalError`,
   `ProviderError`) plus a logging helper that redacts anything matching an
   API-key shape would make Phase 3's "actionable errors without leaking
   secrets" acceptance criterion checkable rather than aspirational.
7. **Dependency vulnerability scanning** (Phase 2). `npm audit` as a CI
   step at minimum; Dependabot/Renovate for update PRs.
8. **Two specific breaking-change dependency upgrades**, deferred from this
   milestone's `npm audit` pass (see
   `2026-08-phase1-security-fixes.md` §4 for detail): `pptxgenjs` → 1.1.5+
   (fixes an `image-size` DoS advisory) and `exceljs` → 3.4.0+ (fixes a
   `uuid` bounds-check advisory). Each needs a full regression pass against
   every PPTX/XLSX generation code path before merging, since both are
   semver-major bumps of directly-used document-generation libraries.

## ~~Phase 3 — Verification engine~~ — DONE, see `2026-08-phase3-verification-engine.md`

Replace the current 0-100 confidence score with the six-state
`verified/reviewed/partially_verified/unverified/failed/blocked` model and a
`VerificationContract` abstraction. This is a genuinely large refactor of
`src/agent.ts`'s `finalizeTransaction()` and the existing `documentQuality.ts`
checks — plan for it to touch `src/types.ts` (new status enum, contract
shape), `src/verification.ts`, `src/documentQuality.ts`, and every call site
that currently reads a numeric `confidence`. Recommend doing this as its own
dedicated milestone with its own test pass, not bundled with anything else,
given how central `confidence`/`outcome` already are to the existing
transaction log format (a format change here is a breaking change to
historical transaction logs — needs a migration note).

## Phase 4 — Complete checkpoints and auditability

Upgrade rollback from the current per-file text snapshot
(`src/workspaceSnapshot.ts`) to full workspace checkpoints, preferring
isolated Git worktrees when the project is a Git repo. Needs: binary-file
snapshot support (current mechanism's diff-based approach may assume text),
create/delete/rename/permission-change tracking, and a real "don't overwrite
unrelated user changes since the snapshot" check (currently unclear whether
this is handled — needs auditing before design, not assumed).

## Phase 5 — Project intelligence

Incremental file/symbol index, lexical+semantic retrieval, Git-history
signal. This is the first phase that plausibly needs a new dependency
(some embedding/vector approach) — flag that decision to the user before
committing to one, per the "stop and report" instruction, since it's a
meaningful new architectural dependency for a project that's otherwise
zero-external-service by design.

## Phase 6 — Evidence graph and cross-artifact consistency

Depends on Phase 3 (verification contracts) and Phase 5 (stable IDs for
retrieved content) existing first — sequence accordingly.

## Phase 7 — Professional artifact engine

A shared structured document representation compiling to
DOCX/PPTX/XLSX/PDF/Markdown/HTML is a significant rewrite of
`src/tools/documents.ts` (currently three separate, format-specific
generators). Recommend an additive approach — build the shared
representation as a new layer that the existing three generators adopt one
at a time — rather than a rewrite, to avoid a period where document
generation is broken.

## Phase 8 — Skills platform

Versioned skill packages (`SKILL.md` + `manifest.json` + `scripts/` +
`tests/` + `evals/`) replacing the current flat JSON skills
(`src/tools/skills.ts`). "Never execute untrusted skill scripts
automatically" needs a concrete sandboxing/permission-preview design before
any code — don't build the package format first and bolt on safety later.

## Phase 9 — MCP and connectors

Expanding beyond stdio transport, OAuth support, per-server/per-tool
permission policies. The instruction "treat all external content as
potentially prompt-injected" should inform the design from the start (e.g.
a clear visual/structural distinction in the agent's context between
"connector output" and "user instruction," not just a policy note).

## Phase 10 — Parallel isolated agents

Depends on Phase 4's Git-worktree-based checkpoints existing first (isolated
coding agents need the same isolation mechanism).

## Phase 11 — Product UX / VS Code extension

Depends on Phase 3 (verification dashboard needs real verification states
to show) and Phase 6 (evidence panel needs the evidence graph) to not be
UI-without-substance.

## Phase 12 — Enterprise readiness

Org workspaces, RBAC, SSO/SCIM, SOC 2 readiness. This is the largest
positioning question in the whole roadmap — Wrexlyn is currently explicitly
local-first/single-user by design (see the product positioning statement).
Recommend treating this as a genuinely separate product-decision
conversation with the user before any implementation, not a phase to
execute autonomously — it may imply a hosted/multi-tenant component that
changes the trust model this milestone's Phase 1 work was built around.

## Phase 13 — Product evaluation

A 200-task reproducible benchmark. Cheapest to build *after* Phase 3
(verification contracts) exist, since "required-check pass rate" and
"reproducibility" as metrics need a real verification status model to
measure against — building the benchmark first against the current ad-hoc
confidence score would mean rebuilding the benchmark's grading logic once
Phase 3 lands anyway.

## Note on sequencing

Phases 3 → 4 → 5/6 → 7/8/9 → 10 → 11 → 13 is the dependency-respecting order
above; Phase 12 is flagged as a product decision rather than slotted into
the sequence. Phase 1's remaining items (SSRF fetch, secret storage, MCP env
scrubbing, command-service separation) and Phase 2's CI/logging/scanning
items should land before Phase 3 starts, per the original instructions'
own gate ("do not begin later phases until security remediation, test
infrastructure, build, lint, typecheck and relevant regression tests
pass") — and per this document, that gate is not yet fully closed.
