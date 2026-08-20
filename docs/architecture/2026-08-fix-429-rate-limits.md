# 2026-08-20 — Fix 429 rate-limit handling

## Problem

A long-standing backlog item ("investigate and fix 429 rate-limit efficiency") had never actually
been worked on. Investigation found the retry mechanics themselves (a 2026-08-11 commit added
`src/providers/retryPolicy.ts`'s `computeRetryDelayMs`, honoring `Retry-After` with jittered
exponential backoff, wired into all four provider files) were already sound. Three real gaps
remained — one of them a confirmed, previously-unknown correctness bug found via a Plan-agent
critique before any code was written:

1. **A confirmed bug: a provider's own retry backoff could trip a *different* timeout and kill the
   whole turn.** `agent.ts` wraps every model call in `withIdleTimeout(..., 90_000, ...)`
   (`src/timeout.ts`), whose deadline only resets via a `heartbeat()` call wired to the SSE
   `onDelta` stream-chunk callback. A 429/5xx backoff sleep happens *before* any `fetch` even
   completes — no stream chunks, no heartbeat — and `computeRetryDelayMs` can legitimately return
   up to 90s from a `Retry-After` header. One or two such sleeps in a row, with no intervening
   stream activity, silently exceeded the 90s idle deadline and aborted the entire agent turn with
   `"model call went silent for 90000ms"` — the exact "aborts / times out" failure this fix needed
   to prevent, undetected by the retry logic because it lived one layer up.
2. **Inconsistent, unhelpful error messages.** Only `openrouter.ts` built a self-explanatory
   exhausted-429 message; `kilo.ts`/`groq.ts`/`openaiCompatible.ts` just threw a terse
   `"${label} API returned 429"`.
3. **No proactive pacing for `kilo`, the default no-key provider.** `kilo.ts`'s own comment states
   anonymous access is capped at 200 req/hour **per IP, shared across all anonymous Kilo users** —
   not raisable. Confirmed via `parallelRun.ts`'s `Promise.all(state.attempts.map(...))` that
   "Run N ways" (Best-of-N) fires N full Agent instances **concurrently**, each independently
   hitting the dispatcher — a real, confirmed source of simultaneous bursts against that shared cap.

Explicitly out of scope (considered, rejected during planning): a structured `RateLimitError`/error
`.code` distinction — nothing in the codebase would consume it (`agent.ts`'s catch block just does
`err.message ?? String(err)` regardless of error type), so it would be speculative complexity with
no near-term payoff; and automatic cross-provider fallback — `llm.ts`'s own
`sanitizeMessagesForProvider` comment already documents real hazards from switching providers
mid-conversation (stale tool-call metadata causing 400s), so silent auto-switching deserves its own
separate decision, not a rider on this fix.

## What was added

### 1. Fixed the idle-timeout/backoff interaction

A new `RetryNotice` type (`{provider, status, attempt, maxRetries, waitMs}`) and an optional
trailing `onRetry?: (info: RetryNotice) => void` parameter threaded through all four provider
`chatCompletion` signatures (`kilo.ts`, `groq.ts`, `openrouter.ts`, `openaiCompatible.ts`'s factory
and its exported `runOpenAiCompatibleChatCompletion`, plus `custom.ts`), called right before each
provider's `sleep(waitMs)` in its 429/5xx branch. `llm.ts`'s dispatcher forwards it through.

In `agent.ts`, the closure passed as `onRetry` does **two** things: calls `heartbeat()` (the exact
fix — resetting `withIdleTimeout`'s deadline so an intentional, bounded backoff wait is never
mistaken for a stuck connection) and calls `this.reporter.retryNotice(info)` (a natural, low-cost
addition once the callback exists for the timeout fix anyway). `Reporter` gained a `retryNotice`
method — real implementations in `src/ui.ts` (a dim console line) and `src/web/reporter.ts` (a new
`retry_notice` `ServerMessage`, rendered in `public/app.js` as a small transient status row,
`.retry-row` in `style.css`, mirroring the existing `.thinking-row` pattern exactly), no-op in
`src/eval/reporter.ts` and `parallelRun.ts`'s per-attempt reporter — matching the precedent
`sessionPersisted`'s own doc comment already established ("a no-op for reporters with no notion of
[X]").

### 2. Unified 429/5xx error messaging

`retryPolicy.ts` gained `describeRetryExhausted(providerLabel, model, status)`, generalizing
`openrouter.ts`'s existing good copy (self-explanatory, notes it clears on the provider's own
schedule, suggests switching model/provider) to work for any provider/status. All four provider
files now build their exhausted-retry error through this one shared function instead of four
independent (three of them terse) copies.

### 3. Proactive pacing for `kilo` only

`retryPolicy.ts` gained `createMinIntervalGate(minIntervalMs)`: a queue-based `acquire()` closure
that serializes calls with a minimum spacing — deliberately *not* a full requests-per-hour limiter
(that would meaningfully slow normal interactive use for no real benefit). `kilo.ts` creates one
module-level gate (3000ms) and awaits it at the top of each retry-loop attempt, before `fetch` —
deconflicting the concurrent Best-of-N-burst scenario confirmed above. Scoped to `kilo.ts` only:
every other provider runs against the user's own API key/account quota, so pacing those would slow
down legitimate usage without addressing a shared-cap problem that doesn't exist for them.

## Testing

No existing test mocked `fetch` or exercised a provider's retry loop before this — four new test
files, all real logic, no framework mocking beyond stubbing `global.fetch`:

- `src/__tests__/retryPolicy.test.ts` — `describeRetryExhausted` message content per status/
  provider/model; `createMinIntervalGate` proven with *real* elapsed-time measurement (not fake
  timers) that concurrent `acquire()` calls serialize with the minimum spacing, and that a lone
  call incurs no artificial delay; `computeRetryDelayMs`'s existing `Retry-After` handling.
- `src/__tests__/timeout.test.ts` — the actual regression this whole fix exists for: a heartbeat
  during a long wait prevents `withIdleTimeout` from firing; the identical total wait with *no*
  intervening heartbeat does time out; a scenario shaped exactly like two consecutive 429 backoff
  sleeps with no `onRetry`→heartbeat wiring reproduces the original bug on a short (100ms) idle
  deadline instead of the real 90s one, so the suite stays fast.
- `src/__tests__/kiloProvider.test.ts` — one real test against `kilo.ts` proving the pacing gate
  and `onRetry` fire together end-to-end (429 with `Retry-After: 0` for determinism, then a real
  200 SSE body); real elapsed time (~3s from the gate's own spacing) is accepted as the cost of
  proving the actual mechanism, not simulated.
- `src/__tests__/providerRetry.test.ts` — `groq.ts`/`openrouter.ts`/`openaiCompatible.ts` (none of
  which have a pacing gate, so these stay fast) each exhaust retries with the correct provider
  label in the message and fire `onRetry` on every attempt; a 5xx gets the shorter transient-
  failure message, not the rate-limit framing.

`npx tsc -p . --noEmit`, `npm run build && node scripts/run-tests.js` — 335 tests, 330 passing, 0
failing, 5 skipped (up from 320/315/0/5 before this work — +15 new tests, 0 regressions).

## Live verification

Deliberately did **not** attempt to trigger a real 429 by hammering the live kilo/OpenRouter
free-tier endpoints — that would be wasteful load against a shared free service for a fact already
provable deterministically via the mocked-fetch unit tests above. Instead: restarted the web server
on the fresh build and confirmed the happy path is unaffected — a real chat turn ("What is 12 * 7?"
→ "84") completed cleanly with no errors, proving the new `onRetry` plumbing threaded through every
call site doesn't break the non-rate-limited path. The `retryNotice` frontend rendering itself
(`.retry-row` in `app.js`/`style.css`) was verified by code review against the exact, already-
proven-in-production `.thinking-row` pattern it mirrors, rather than by contorting a live page
reload to intercept the WebSocket mid-session — the backend correctness (the part that actually
matters, and the part this whole fix is about) is what the automated tests above establish.

## Commits

Logical steps: `retryPolicy.ts` additions (`describeRetryExhausted`, `createMinIntervalGate`);
wiring all four providers (`onRetry` param, unified message, kilo's pacing gate) + `llm.ts`;
`agent.ts`/`Reporter`/`RetryNotice` wiring (the heartbeat fix) + CLI/web implementations + no-ops;
frontend rendering; tests; this doc. Push only after explicit confirmation, per standing practice.
