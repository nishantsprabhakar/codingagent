# 2026-08-21 — Local/custom provider idle-timeout was too short for real turns

## Problem

The user linked a local Ollama model (`qwen3:8b`, later `qwen2.5:7b-instruct`) to Wrexlyn's
"Custom / Local Model" provider on CPU-only hardware (no dedicated GPU). Real chat turns through
the web UI reliably failed with `⚠ model call went silent for 90000ms` — the same
`MODEL_IDLE_TIMEOUT_MS = 90_000` guard in `agent.ts` that protects against a genuinely stuck
provider (see the 2026-08-11/2026-08-14 429 rate-limit fix, which taught this codebase that a
provider's own retry backoff can trip this same timeout).

This time the cause was different: not a retry backoff, but the model itself being legitimately
slow. A direct `curl` against Ollama's OpenAI-compatible endpoint with a trivial 160-token prompt
and one tiny tool definition took 28-52s depending on the model — and Wrexlyn's real system prompt
plus its full ~18-tool schema is a much larger prefill than that, so real turns routinely pushed
past 90s, especially on the *second* model call of a turn (the one that summarizes a tool's result
back to the user), which carries an even larger prompt than the first.

Switching from `qwen3:8b` (which has a verbose "thinking" mode — confirmed via direct API testing
that its reasoning preamble alone added ~140 tokens before any real answer, and that Ollama's
OpenAI-compatible endpoint does not honor a `think: false` request field in this Ollama version,
0.32.14 — only the native `/api/chat` endpoint does) to `qwen2.5:7b-instruct` (no forced reasoning
step) helped but did not fully fix it: the first call became fast enough to actually produce a
real tool call, but the second call (post-tool-result summary) still hit the same 90s wall.

## Fix

`agent.ts` now picks the idle-timeout based on provider instead of using one constant everywhere:

```ts
const MODEL_IDLE_TIMEOUT_MS = 90_000;
const CUSTOM_PROVIDER_IDLE_TIMEOUT_MS = 300_000;

function modelIdleTimeoutMs(provider: LlmProvider): number {
  return provider === "custom" ? CUSTOM_PROVIDER_IDLE_TIMEOUT_MS : MODEL_IDLE_TIMEOUT_MS;
}
```

`withIdleTimeout(..., modelIdleTimeoutMs(this.llmConfig.provider), "model call")` replaces the bare
`MODEL_IDLE_TIMEOUT_MS` at the one call site in `handleUserMessage`'s tool-iteration loop — this
covers every model call in a turn (initial response and every post-tool-result follow-up alike,
since they all loop through the same `for` block), not just the first one.

Cloud providers (kilo/groq/openrouter/gemini/cerebras/mistral) keep the original 90s — they run on
real inference hardware and a 90s stall from one of them really does mean something's stuck. Only
`"custom"` (self-hosted/local servers — Ollama, LM Studio, etc.) gets the longer 300s window, since
CPU-only local inference is a fundamentally different, much slower regime and 90s reliably aborts a
genuine turn mid-flight rather than catching an actually-stuck connection.

## Verification

- `npx tsc -p . --noEmit` — clean.
- `node scripts/run-tests.js` — 330 passed, 0 failed, 5 skipped (unrelated, pre-existing skips) —
  no regressions.
- Live, via the real web UI (rebuilt `dist/`, restarted the running dev server so it picked up the
  change — a `dist/` rebuild alone doesn't affect an already-running Node process):
  - Switched the active provider to `custom` / `qwen2.5:7b-instruct` (`http://localhost:11434/v1/chat/completions`,
    no key).
  - Sent a message requiring a real tool call in a fresh chat. The first model call completed
    (~40s), chose `run_shell_command` to write a test file (no direct file-write tool matched the
    phrasing it received), and the shell command executed correctly after an "Allow once" approval.
  - The second model call (summarizing the tool result) ran for ~260s — well past the old 90s
    limit — without the idle-timeout firing. This directly confirms the fix: the exact call that
    used to abort at 90s now has room to actually finish.
  - **What this run does *not* prove fixed**: the turn still ended in "Verification failed, conf
    40" — not from a timeout this time, but because the model went into an unrelated tool-call
    loop (repeatedly calling `recall_skill("Create Invoice Template")`, a tool call with no
    connection to the actual request) until it hit the 30-tool-call safety cap
    (`MAX_TOOL_ITERATIONS`) and gave up. The file itself was still written correctly to disk before
    the loop started. This is a separate, real reliability limitation of running a small (7-8B,
    quantized) local model as Wrexlyn's full agentic driver against its real ~18-tool schema — not
    something the idle-timeout fix claims to solve, and not silently glossed over here.

## Commit

`src/agent.ts` only. Push after explicit confirmation, per standing practice.
