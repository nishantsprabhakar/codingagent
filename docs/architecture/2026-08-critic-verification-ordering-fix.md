# 2026-08-14 — Fixing the critic's pre-verification blindness

## How this was found

Phase 13's eval harness (`src/eval/`) exists specifically to catch exactly this kind of gap.
A live 12-task benchmark run against the real agent showed **12/12 tasks passing their
deterministic ground-truth test**, but only **1/12 getting the user-visible "verified"
outcome** — the other 11 were downgraded to `partially_verified` at confidence 70. The gap
between "did the code actually work" and "does the app say it worked" was exactly the
statistic the harness's dual-scoring design was built to surface, not hide.

## Root cause

In `src/agent.ts`'s turn loop, the independent LLM "critic" (`critiqueStep` in
`src/critic.ts`) used to fire once per round **immediately after any round of tool calls**.
Deterministic test/build/lint verification (`runVerification`) only ever runs in the
**terminal, no-tool-calls round**, once the model has stopped calling tools. Because of
this ordering, **every critic check ever recorded in a transaction was chronologically
before the deterministic evidence existed** — the critic was asked "did this look right?"
with zero visibility into whether the code it was judging would actually pass the test
suite that runs moments later in the same turn.

`src/verificationOutcome.ts`'s `deriveOutcome()` then applies: any critic failure caps the
outcome at `partially_verified`, regardless of what the deterministic tests later show. This
wasn't a rare edge case — given the loop's structure, it was the *default* outcome for the
common "one round of edits, then a plain final answer" shape, which is most of what the
benchmark exercised.

## The fix

Moved critique so it's informed by verification instead of blind to it, without losing its
value for turns verification can't cover (non-code changes, off-task work):

- `critiqueRoundIfNeeded` (fired per tool-calling round) was replaced by `critiqueIfNeeded`
  (fired once per verification cycle, in the terminal round, after `runVerification` has had
  a chance to run). A new `lastCritiquedActionIndex` field tracks which actions have already
  been judged, so a multi-round turn still gets full coverage in one call instead of one call
  per round — a genuine reduction in request count for free/rate-limited providers, not just
  a side effect.
- `critiqueStep` (`src/critic.ts`) gained an optional `verificationSummary` parameter,
  inserted into the critic's prompt as labeled, authoritative evidence
  ("Automated verification for this step (trust this over your own guess about
  correctness): ...") whenever verification actually ran this cycle.
- `verificationOutcome.ts`'s derivation rule itself was **not** changed — it was already
  correct (a critic failure alongside a clean pass is a real signal worth surfacing). The bug
  was entirely upstream, in what evidence the critic was shown before rendering a verdict.
- `critic.ts` was refactored to expose `buildCritiqueMessages`/`parseCritiqueReply` as pure,
  separately-testable functions (see Testing below).

## Result

Same 12 tasks, same provider (Kilo), same 1-repeat setup, before vs. after:

| Metric | Before | After |
|---|---|---|
| Deterministic pass rate | 12/12 (100%) | 12/12 (100%) |
| Verified rate | 1/12 (8.3%) | **12/12 (100%)** |
| Confidence on passing tasks | 70 | **100** |

No regression in actual task-solving (the pass rate held steady) — this was purely a
reporting/trust-calibration fix. Every task that genuinely passed its test now correctly
reports as verified instead of being downgraded by a critic that used to render its verdict
before the evidence existed.

A related but separate, pre-existing limitation was observed (not fixed here, out of scope):
`detectProjectMemory`'s `testCommand` is read once, from `package.json`, at session start —
if the model adds a test script to a project that didn't have one yet, automatic
verification has nothing to run for the rest of that session, and the turn falls through to
critic-only evaluation (`"reviewed"`, not `"verified"`). This surfaced during a manual UI
smoke test (a from-scratch project where the model was asked to create both the code and its
test), and is orthogonal to the ordering bug fixed here — it's a *when-is-memory-refreshed*
gap, not a *what-does-the-critic-see* gap.

## Testing

- `src/__tests__/verificationOutcome.test.ts` — comment updated on the existing
  `"partially_verified (critic flagged a clean pass)"` test to reflect that a critic entry
  now represents an *informed* opinion, not a blind pre-verification guess. Assertions
  unchanged (the derivation rule itself was already correct).
- `src/__tests__/critic.test.ts` (new) — unit-tests `buildCritiqueMessages`/
  `parseCritiqueReply` directly: verification evidence is included when supplied and absent
  when not, evidence appears before the closing question, and PASS/FAIL/malformed-reply
  parsing is correct.
- **Deviation from the original plan**: the plan called for an additional
  `agentCritiqueOrdering.test.ts` driving a real `Agent` through a local mock HTTP server
  (matching `evalRunner.test.ts`'s pattern) to prove the reordering end-to-end. Building it
  surfaced a genuine platform issue: any test that makes `fetch()` actually consume a full,
  successful SSE-streamed response from a local Node `http.Server` on this machine (Node
  v24.18.0, Windows) crashes the test process at exit with a native libuv assertion
  (`UV_HANDLE_CLOSING`, `src/win/async.c:94`) — every individual assertion passed before the
  crash; it's an exit-teardown issue, not a logic bug. Several mitigations were tried
  (`Connection: close`, a single `res.end()` instead of multiple `res.write()`s, explicit
  socket destruction) without success. Rather than add `undici` as a new dependency solely to
  intercept `fetch()` without real sockets, `critiqueStep`'s pure logic was extracted and
  tested directly instead (see above), and the actual end-to-end proof was obtained the
  stronger way: re-running the real 12-task benchmark against a real cloud provider (Kilo),
  which is not subject to this local-server-specific issue at all.
- `npx tsc -p . --noEmit` and `npm run build && node scripts/run-tests.js` — 242 passing, 0
  failing, 3 skipped (up from 234 before this change; +8 new tests, +0 regressions).
- Live, end-to-end: the benchmark re-run above, plus a manual web-UI smoke test (see the
  related-limitation note).
