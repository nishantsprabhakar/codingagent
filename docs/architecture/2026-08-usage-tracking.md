# Usage tracking: sessions, tools, and model/token usage

## What this is

Wrexlyn now records three kinds of local usage activity and keeps a live spreadsheet of it,
per the explicit request: "record the user and usage," clarified to mean all three of
tool/action usage, model & token/cost usage, and session/login usage, exported to "a live excel
sheet on google/onedrive."

- **Session/login usage** — who ran the agent, on which machine, against which project, and
  when the session started/ended.
- **Tool/action usage** — every tool call the agent made, whether it succeeded, and its risk
  tier.
- **Model & token usage** — every model call's provider, model id, and prompt/completion/total
  token counts, when the provider actually reports them.

## How it works

```
agent.ts (hook points)  →  usageLedger.ts (JSONL append)  →  usageExport.ts (xlsx rebuild)
                                                                     ↓
                                              usageExportPath.ts (OneDrive/Drive/local path)
```

- **`src/usageLedger.ts`** — the durable source of truth: an append-only JSONL file at
  `~/.coding-agent/usage-ledger.jsonl`. Every event is tagged with the OS username
  (`os.userInfo().username`) and hostname — there is no separate login/auth system to draw
  identity from, since this is a locally-run agent. Every recording function swallows its own
  errors; usage tracking must never interrupt a real agent turn.
- **`src/usageExportPath.ts`** — resolves where the live workbook goes, in priority order:
  `WREXLYN_USAGE_DIR` env override → the OneDrive sync root (`%OneDrive%` /
  `%OneDriveCommercial%`, detected live on this machine) → a Google Drive desktop-sync folder at
  its default path → `~/.coding-agent/usage-export/` as a local-only fallback. Verified live on
  this machine: resolves to `<OneDrive root>\Wrexlyn Usage\wrexlyn-usage.xlsx`, which syncs to
  the cloud automatically because it's an ordinary file inside the existing OneDrive folder.
- **`src/usageExport.ts`** — rebuilds the entire workbook from the full ledger (not an append),
  so the workbook can never drift out of sync with the JSONL source of truth. Debounced 2s after
  the last event, so a burst of tool calls triggers one rewrite, not dozens. Writes to a temp
  file and renames it into place; if the destination is currently open and locked in Excel, the
  rename fails silently and the next event's export retries — no crash, no data loss (the ledger
  is unaffected).
- Four sheets: **Summary** (per-user totals), **Sessions**, **Tool Usage**, **Model Usage**.

## Hook points in `agent.ts`

- Constructor → `recordSessionStart(sessionId, root)`.
- `dispose()` → `recordSessionEnd(sessionId)`. Called on CLI exit and on web-server disconnect
  (both existing call sites), so this fires without any new wiring beyond the one line.
- After the turn-loop's `chatCompletion(...)` call returns → `recordModelUsage(...)` if
  `result.usage` is present (it's `undefined` for providers that don't report token counts).
- `recordTool()` (the existing single choke point every tool call finishing already passes
  through) → `recordToolUsage(...)`, for every call regardless of risk tier — this is
  intentionally broader than the existing `ActionLogEntry` audit trail, which only logs
  `risk !== "low"` actions for verification/rollback purposes. Usage analytics and the audit
  trail are separate concerns that happen to share a call site.

## Token usage plumbing (provider layer)

Streaming responses don't report token usage unless the request explicitly opts in. Added
`stream_options: { include_usage: true }` to every OpenAI-compatible provider's request body
(`openaiCompatible.ts`, `groq.ts`, `openrouter.ts`, `pollinations.ts`) and taught
`sseStream.ts`'s `consumeSseStream()` to extract the usage-bearing final SSE chunk — which has an
**empty** `choices` array, so the extraction has to happen before the existing
`if (!choice) return` early-exit, or it's silently skipped every time.

## What's honestly NOT covered

- **Cost in dollars** — only raw token counts are recorded, never a computed price. Pricing
  varies by provider/model/promo and changes without notice; a fabricated cost figure would be
  actively misleading. If per-model pricing is wanted later, it should be a separate, clearly
  labeled estimate, not blended into "usage."
- **Pollinations usage counts as free tier without providers reporting cost** — Pollinations,
  Groq, OpenRouter free-tier, Gemini, Cerebras, and Mistral don't charge per-token in the way
  this app is configured (free-tier models only, enforced elsewhere), so token counts here are
  for volume/analytics, not billing.
- **Multi-machine aggregation** — the ledger is local to each machine. If the same person runs
  Wrexlyn from two machines, each keeps its own ledger and its own workbook (both still land in
  the same OneDrive/Drive folder if that's shared, but as two separate files unless
  `WREXLYN_USAGE_DIR` is pointed at the same folder from both).
- **A locked destination file** (e.g. the workbook is open in Excel when a new event fires)
  drops that specific rebuild — verified via a dedicated test — rather than blocking or
  crashing. The next event retries.

## Verification performed

- `npm run build` / `npm run typecheck` — clean.
- New tests in `src/__tests__/usageExport.test.ts`: ledger round-trip, export path resolution
  override, full workbook generation (sheet names, row counts, cell values), and tolerance of a
  locked/undeletable destination. Full suite: 78/78 passing.
- **Live verification on this machine**: ran the compiled `usageLedger`/`usageExportPath`
  modules directly (bypassing test overrides) against the real environment, confirmed
  `resolveUsageExportDir()` resolves to the real OneDrive root, confirmed the workbook is
  actually written there, and read it back with `exceljs` to confirm real identity
  (`os.userInfo().username`, `os.hostname()`) and all four sheets' data are correct. The
  synthetic verification event and workbook were deleted afterward so the ledger starts clean
  from real usage.
