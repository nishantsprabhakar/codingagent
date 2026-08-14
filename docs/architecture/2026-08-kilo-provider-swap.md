# 2026-08-14 — Replacing Pollinations with Kilo as the default keyless provider

## Why

Pollinations (`text.pollinations.ai/openai`), the app's zero-signup default
provider since early development, stopped supporting tool-calling entirely.
Live-tested this session:

- A plain chat request (no `tools` in the body) still returns `200` in
  under a second.
- The exact same request with `tools` attached returns `HTTP 500` whose body
  embeds the string `"402 Payment Required"` — Pollinations now requires a
  funded account specifically for tool/function-calling requests. The
  previous code (`pollinations.ts`, added 2026-07-30) only recognized a
  literal `402` status, so it burned its entire 5xx retry budget (5 attempts,
  exponential backoff up to 20s each) before failing, and the outer
  90-second idle-timeout in `agent.ts` sometimes tripped first, surfacing as
  a vague "model call went silent" instead of the real, actionable error.
  That specific bug was fixed in-place before the provider swap (see the
  `peekPaymentRequired` check in the since-deleted `pollinations.ts`, now
  applied the same way in `kilo.ts` for any future variant of this failure
  mode).

Since this agent cannot function without tool calls, Pollinations' anonymous
tier is now unusable as the app's zero-config default.

## What replaced it

[Kilo](https://kilo.ai)'s gateway (`https://api.kilo.ai/api/gateway/chat/completions`),
using the `kilo-auto/free` model id, which auto-routes each request to
whichever free upstream model is currently available (observed routing to
`stepfun/step-3.7-flash` in testing). Confirmed live, via direct `curl` and
non-streaming/streaming requests with a real `tools` array:

- No `Authorization` header at all — genuinely anonymous, no signup.
- Real OpenAI-shaped `tool_calls` in both the non-streaming response and the
  streamed `delta.tool_calls[].function.arguments` fragments — the exact
  shape `sseStream.ts`'s existing parser already expects, so no parser
  changes were needed.
- Anonymous access is capped at 200 requests/hour per IP (Kilo's own docs) —
  no key means no way to raise that; this is disclosed in the CLI help text,
  README, and launcher prompts.

`src/providers/pollinations.ts` was deleted outright and replaced with
`src/providers/kilo.ts`, keeping the same retry/backoff shape (429/5xx
retried with jittered backoff via `retryPolicy.ts`, everything else fatal).
`LlmProvider`'s `"pollinations"` member was renamed to `"kilo"` throughout —
not kept as a second option — since Pollinations no longer has anything
useful to offer this agent. `DEFAULT_MODEL.kilo` is `"kilo-auto/free"`.

## Renamed touch points

Every reference across the app was updated in the same change, not left
half-migrated: `types.ts` (`LlmProvider`, `DEFAULT_MODEL`), `llm.ts`
(dispatch), `index.ts` and `eval/cli.ts` (CLI default/help text/flag
validation), `web/server.ts` (`VALID_PROVIDERS`, the no-key branch, the
model-list endpoint's note), `public/app.js` + `public/index.html` (provider
label, chip list, Settings copy), the launcher scripts (`launch.sh`,
`launch.ps1`, `launch-config.js` — softened from "no longer supports
tool-calling" to "capped at 200 req/hour, add a key for more"), `README.md`
(intro, quick start, CLI options, the Groq/OpenRouter section, Known
limitations, How it works), and every test that constructed an `LlmConfig`
literal (`parallelRun.test.ts`, `server.security.test.ts`, `evalReport.test.ts`).

No back-compat shim was added for a stale `"pollinations"` value in an old
`~/.coding-agent/preferences.json` (`lastModel`/`customBaseUrl`) — `loadLastModel`
is keyed by plain `string`, so an old `pollinations` entry just sits unused
and `loadLastModel("kilo")` safely falls through to `DEFAULT_MODEL.kilo`. No
crash risk, so no extra migration code was justified.

## What was deliberately NOT changed: `docs/`

`docs/` is a separate, static, browser-only GitHub Pages demo
(`nishantsprabhakar.github.io/codingagent`) with its own independent
provider client (`docs/providers.js`) — a from-scratch reimplementation, not
a build output of `src/providers/`, because it runs entirely client-side
with no backend at all.

Kilo's gateway was live-tested from that exact deployed origin (via a real
browser `fetch()`, not `curl`) and **fails**: the response carries no
`Access-Control-Allow-Origin` header, so the browser blocks it outright —
`Access to fetch at 'https://api.kilo.ai/...' from origin
'https://nishantsprabhakar.github.io' has been blocked by CORS policy`.
Kilo's API is server-to-server only.

Pollinations, meanwhile, is still fine for `docs/`'s specific use case: that
demo never sends a `tools` array (it's a plain, no-tool-calling chat
sandbox — see `WREXLYN_SYSTEM_PROMPT` in `providers.js`), and plain chat
requests are exactly the request shape that still returns `200` from
Pollinations' anonymous tier. The bug that killed Pollinations for the real
agent (the tool-calling paywall) doesn't apply to a page that never calls a
tool. `docs/providers.js`'s `pollinationsStream()` was left untouched.

## Verification

- `npx tsc -p . --noEmit` — clean.
- `npm run build && node scripts/run-tests.js` — 234 passed, 0 failed, 3
  skipped (237 total; unchanged from before this change).
- Live end-to-end, via the actual web UI (not a script): started the server
  against a scratch working directory with no `--provider` flag (so it used
  the new `kilo` default), confirmed the model badge read `kilo ·
  kilo-auto/free`, sent "Create a file called hello.txt containing exactly
  the text: Hello from Kilo", approved the resulting `write_file` permission
  prompt, and confirmed the file was created on disk with the exact
  requested content. The turn finished with outcome "Reviewed" at
  confidence 80, with rollback available — the full verification/outcome
  pipeline (Phase 3/4) worked correctly against the new provider with zero
  changes needed there.
- CORS behavior for `docs/` was checked with a real browser `fetch()`
  against the deployed GitHub Pages origin (not assumed from `curl`,
  consistent with this repo's own stated policy in `docs/README.md`).
