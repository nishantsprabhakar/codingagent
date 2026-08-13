# Phase 3 — Verification engine (six-state outcome model)

## What changed

Replaced the flat 5-state `TransactionOutcome` (`verified | unverified_changes | failed | no_changes |
blocked`) and its numeric-only confidence score with:

- A **six-state outcome model** — `verified | reviewed | partially_verified | unverified | failed |
  blocked` — plus `no_changes` kept as a 7th, non-verification sentinel for the zero-action case
  (there's nothing to verify, distinct from any of the six real verification states).
- A **`VerificationContract`** abstraction (`src/types.ts`): a transaction accumulates
  `VerificationCheckEntry` evidence from three sources — `deterministic` (build/test/lint/typecheck,
  from `verification.ts`), `quality_gate` (create_docx/pptx/xlsx's structural checks, from
  `documentQuality.ts`), and `critic` (the independent LLM reviewer, from `critic.ts`).
- A single pure function, **`deriveOutcome()`** (`src/verificationOutcome.ts`), turns that evidence
  into an outcome + a pre-NCP confidence base. It's fully unit-tested
  (`src/__tests__/verificationOutcome.test.ts`, 13 cases covering every state and boundary) and has
  no dependency on the Agent, an LLM, or the filesystem.

## Outcome rules

`verified` — at least one authoritative check (deterministic or quality_gate) ran and every
authoritative check passed, and the critic (if it ran) also passed. `reviewed` — no authoritative
check was applicable, but the critic ran and passed. `partially_verified` — a mixed result: some
authoritative checks passed and others failed in the same turn, OR every authoritative check passed
but the critic still flagged a concern, OR no authoritative check ran and the critic-only result
failed. `unverified` — changes were made and nothing applicable ran at all (no authoritative check,
no critic). `failed` — at least one authoritative check ran and **all** of them failed (zero
passed) — a real behavior change from the old model, where a single failing check made the whole
turn `failed` even if others passed; that's now `partially_verified`. `blocked`/`no_changes` are
unchanged from before.

## Two bugs fixed while already touching this code

1. **Confidence-variable mismatch**: `finalizeTransaction()` used to report a pre-NCP confidence
   value to the live reporter/history event while persisting the post-NCP value to the transaction
   log — the two could disagree. Now both read `tx.confidence` (the post-NCP value) after NCP has
   run.
2. **Dead `risk === "low"` branch**: the old outcome ladder checked `a.risk === "low"` on actions
   that can never actually be low-risk (`recordTool()` never logs low-risk actions into
   `tx.actions` at all — `create_docx`/`pptx`/`xlsx` always resolve to `"medium"`). `deriveOutcome()`
   doesn't reference `ActionLogEntry.risk` at all; quality-gate evidence flows into the contract
   independently of the action's risk tier.

## A real gap closed

Previously, a *blocking* document-quality-gate failure was invisible to the outcome model — only
successful actions were inspected, so an all-gate-failed turn read as `"unverified_changes"` instead
of `"failed"`. `create_docx`/`pptx`/`xlsx` now attach a `qualityGate` result on **both** the
blocking-failure and the passing path (`src/tools/documents.ts`), so a failing document gate is real
evidence feeding `deriveOutcome()`, not just an error string. Verified with a dedicated regression
test.

## Migration — no runtime migration exists, by design

`TransactionRecord` gained an optional `schemaVersion?: 2` field (present on every record written
from this point on, absent on older ones) and its `verification?: VerificationResult` field was
replaced by a required `contract: VerificationContract`. **No code changes were made to
`transactionLog.ts`**, and none were needed: `loadTransaction()` has exactly one call site in the
whole codebase (`Agent.rollbackTransaction()`), and that function only ever reads
`actions[].ok`/`actions[].fileSnapshot` from a loaded record — never `outcome`, `confidence`,
`contract`, or `schemaVersion`. A pre-Phase-3 record on disk (old `outcome` string, no `contract`
field) therefore remains **fully rollback-safe as-is**. This was verified live on this machine, not
just reasoned about: reverting a transaction written by the new code round-tripped through
`appendTransaction`/`loadTransaction`/`restoreSnapshot` correctly.

If a future feature ever needs to *display* historical outcome/confidence from old JSONL lines (none
does today — `transaction_summary` history items are only ever pushed fresh in the same turn they're
produced, never rehydrated from the log), it must treat `schemaVersion === undefined` as "pre-Phase-3
shape" at that point. Do not add unused normalization code before such a reader exists.

## Frontend

Outcome is now the primary visual signal — a colored, labeled badge — instead of a numeric
confidence band. `public/app.js`'s `OUTCOME_LABELS`/new `OUTCOME_CLASS` maps cover all 7 states;
`public/style.css` replaces the old `.transaction-high/mid/low` confidence-threshold rules with
outcome-keyed color rules (`--success`/`--accent`/`--warn` with a `#fbbf24` fallback for the 4 themes
that don't define `--warn`/`--text-dim`/`--danger`/`--text-faint`). Confidence is kept as a small
`conf NN` secondary readout (still useful, still feeds `computeConvergenceScore`/NCP internally) with
no color weight of its own.

## Verification performed

- `npm run build` / `npm run typecheck` — clean.
- `npm run test` — 91/91 passing (78 pre-existing + 13 new `verificationOutcome` tests).
- **Live, through the actual web UI** (not just unit tests): triggered a `reviewed` turn (plain
  `.txt` write — no authoritative check applicable, critic ran and passed, badge rendered
  accent-colored "Reviewed", conf 80), a `verified` turn (a trivial `.ts` file addition — typecheck
  and `npm run build` both ran and passed, badge rendered success-colored "Verified", conf 90), and
  a `blocked` turn (denied a permission prompt — badge rendered "Blocked", conf 20, no revert
  button). Confirmed the computed CSS color for each matched the intended theme variable via
  `getComputedStyle`. Confirmed rollback ("Revert changes") actually restores a file from a
  transaction written by the new schema. All scratch files created during this live check were
  deleted afterward.

## What this milestone did NOT include

Per `docs/architecture/backlog-phase3-through-13.md`'s own sequencing note, several "Immediately
next" items (CI pipeline, MCP environment scrubbing, command-execution service separation, structured
error classes, dependency vulnerability scanning, two pending semver-major dependency upgrades) were
flagged to land *before* Phase 3 starts. Those remain outstanding — this milestone implemented Phase
3 specifically, on explicit user request, without expanding scope to also cover that backlog. They're
still tracked in `backlog-phase3-through-13.md`.
