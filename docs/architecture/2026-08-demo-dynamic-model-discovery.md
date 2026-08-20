# 2026-08-20 — Fixing the browser demo's hardcoded, now-deprecated default model

## Problem

The browser-only chat demo (`docs/demo.html` + `docs/providers.js` + `docs/app.js` — a separate,
from-scratch client implementation with no backend, per
`docs/architecture/2026-08-kilo-provider-swap.md`) stopped working: its default provider, Groq,
hardcoded `llama-3.3-70b-versatile` as the model to call. Confirmed via web search: Groq
deprecated that model for free/developer-tier usage in June 2026, recommending `openai/gpt-oss-120b`
or `qwen/qwen3.6-27b` as replacements. A hardcoded model string has no way to notice its own
provider retired it — every chat request against the default provider started failing with no
code change on this side at all.

The user's request was to default free usage to `kilo` (the main app's own zero-key default) and
have the keyed free providers use "any free model being provided by the provider at that point."

## Kilo is not usable here — re-verified, not assumed

`2026-08-kilo-provider-swap.md` already investigated and rejected this exact idea back on
2026-08-14: kilo's gateway sends no `Access-Control-Allow-Origin` header at all, so a browser
blocks it outright — it's server-to-server only. Re-verified live today via a real CORS preflight
(`curl -X OPTIONS` with `Origin: https://nishantsprabhakar.github.io`, the demo's real deployed
origin) against `https://api.kilo.ai/api/gateway/chat/completions`: still no CORS header of any
kind. This is not a regression to fix — it's an unchanged, structural fact about kilo's API that
makes it impossible to call from a static page with no backend, however it's configured. The main
app (desktop/CLI) already defaults to kilo since that Aug 14 change — nothing to do there.

## What was actually broken, and the real fix

Every one of the five keyed providers (Groq, OpenRouter, Gemini, Cerebras, Mistral) had its model
id hardcoded directly into a `stream()` closure. Re-verified live today that all five providers'
own `/models` list endpoints send CORS headers permitting this page's origin (OpenRouter's is
`Access-Control-Allow-Origin: *` and needs no key at all; the other four echo the requesting
origin back and need the user's key, same as their chat endpoints already do) — so instead of
picking one more hardcoded model that will eventually deprecate the same way, `providers.js` now
fetches each provider's live model list and picks a currently-available one at runtime:

- `fetchModelIds(url, apiKey)` — a shared fetch-and-parse helper handling both the OpenAI-shaped
  `{data: [...]}` response and Gemini's `{models: [...]}` shape, normalizing away Gemini's
  `models/` resource-name prefix.
- `pickModel(ids, preferred, fallback)` — checks a per-provider ordered list of preferred
  substrings against the live ids (e.g. Groq prefers `gpt-oss-120b`/`gpt-oss`/`qwen3`/`llama`, in
  that order — `gpt-oss-120b` is Groq's own stated migration target for the model this bug was
  about), falling through to the first id in the list, and only to a hardcoded string if the list
  itself is empty.
- Each provider's `discoverModel(apiKey)` filters out non-chat entries where relevant (Groq's list
  also contains `whisper-*` transcription and `*-guard` moderation models — picking one of those
  for a chat request would just produce a different failure) and calls `pickModel`.
- `resolveModel(providerId, apiKey)` is the actual entry point: checks a 24-hour localStorage
  cache first (`wrexlyn_model_cache_v1` — long enough to avoid a list fetch on every visit, short
  enough that a fresh deprecation clears itself out within a day instead of needing a code
  deploy), calls `discoverModel` on a cache miss, and falls back to the provider's hardcoded
  `fallbackModel` if that call throws for any reason (invalid key, network blip, a future CORS
  regression) — the demo degrades to today's exact previous behavior in that case rather than
  breaking outright.

`app.js`'s `startChat`/`sendMessage` flow was updated to call `resolveModel` once (with a
"Checking available models…" label on the Start button while it's in flight) before entering the
chat, store the resolved model on `setup.model`, and pass it through to `stream()` explicitly
(every `stream()` signature gained a `model` parameter) instead of each provider's closure baking
in a fixed string.

One more real bug found and fixed in passing: Gemini's displayed model name (`gemini-3.5-flash`,
shown to the user) never matched the model actually sent in the request body (`gemini-2.5-flash`,
hardcoded separately inside the `stream` closure) — a pre-existing mismatch, now impossible by
construction since there's exactly one resolved model used for both display and the request.

## Verification

- `node --check` on both edited files — clean.
- Live, via a real HTTP-served page (not a `file://` static snapshot, which doesn't execute
  scripts at all — confirmed the hard way first): started a throwaway static server for `docs/`
  and, in a real browser context with real CORS enforcement:
  - `resolveModel("openrouter", "")` — a real, keyless fetch against OpenRouter's public model
    list — returned `openai/gpt-oss-20b:free`, and the result was written to the localStorage
    cache correctly.
  - The full UI flow (select OpenRouter, enter a key, click "Start chatting") showed
    `OpenRouter · openai/gpt-oss-20b:free` in the chat header and persisted `{provider, apiKey,
    model}` to `localStorage` — the resolved model reaches the UI and storage layer correctly, not
    just the internal function.
  - `resolveModel("groq", "definitely-not-a-real-key")` — with an invalid key, Groq's `/models`
    call fails as expected, and the function correctly fell back to `openai/gpt-oss-120b` instead
    of throwing — the safety net for a live-lookup failure works.
- Gemini/Cerebras/Mistral's *successful* discovery paths were not exercised live (no real API
  keys for those three on hand) — their CORS reachability was independently confirmed via a real
  preflight request, and the code path is structurally identical to OpenRouter's already-proven
  path with an `Authorization` header added, but this is stated plainly rather than claimed as
  fully live-verified for those three specifically.
- Bumped the `?v=` cache-busting suffix on `demo.html`'s `<script>`/`<link>` tags
  (`20260810` → `20260820`) so the fix actually reaches visitors' browsers instead of sitting
  behind a cached copy of the old files.

## Follow-up (same day): Pollinations reported "not working"

A user report that Pollinations specifically ("not working") plus a repeat of "replace with
kilo" prompted two things: re-confirming kilo's CORS block a third time (identical result — still
zero `Access-Control-Allow-*` headers on a fresh preflight against the real demo origin; this is
not something a client-side change can route around, so it stays out of `PROVIDER_META`), and
actually diagnosing Pollinations rather than assuming the existing "occasionally unavailable"
framing still held.

Five back-to-back live requests (`curl`, spoofing `Origin: https://nishantsprabhakar.github.io` to
match the real deployed origin) returned 402, 429 ("Queue full for IP: ... 1 requests already
queued (max: 1)"), 200, 429, 200 — and the 402 response body states outright that this legacy
anonymous endpoint is being deprecated in favor of `enter.pollinations.ai`. That's a materially
higher failure rate than "occasionally," and explains the report directly.

The actionable finding: a 402 that fails now often succeeds again within a couple of seconds (the
same test's own alternating pattern proves it), so `pollinationsStream()`'s previous behavior —
treating 402 as an immediate, non-retryable hard failure — was leaving successes on the table.
Fixed to retry 402 exactly like 429/5xx (bumped `maxRetries` 2 → 3 to match the now-higher failure
rate), which meaningfully raises the odds a single click succeeds without the visitor ever seeing
an error. This does not fully fix Pollinations — no client-side retry can compensate for a provider
actively shutting its own free tier down — so the UI copy (the quick-start button label and the
provider note) was rewritten to state that plainly instead of the now-inaccurate "occasionally
unavailable," and to point at Groq (already the default, already dynamically model-resolved) as
the reliable option.

Live-tested the retry behavior itself in a real (non-production-origin) browser context and hit a
different, environment-specific issue: Cloudflare Turnstile returned a flat 403 for every attempt
from `http://localhost:4392`, which the retry logic correctly does *not* retry (403 was never in
scope — it's Turnstile's bot-check, not a capacity signal, and the original comment already noted
Turnstile's behavior depends on the calling origin). This is a local-testing artifact, not evidence
about the real deployed origin: the `curl` tests that established the 402-clears-up-on-retry
finding explicitly spoofed the real production `Origin` header and never saw a 403. Stated plainly
rather than glossed over: the retry-on-402 logic is grounded in real evidence from the production
origin; it was not re-confirmed end-to-end from a real browser hitting that same production origin
(this repo has no way to do that outside the actual deployed GitHub Pages environment).

## Commits

`docs/providers.js` (discovery mechanism + fixed the Gemini model-name mismatch + retry-on-402 +
honest reliability copy), `docs/app.js` (async resolution wiring), `docs/demo.html` (cache-bust
bumps, quick-start button copy), this doc. Push only after explicit confirmation, per standing
practice.
