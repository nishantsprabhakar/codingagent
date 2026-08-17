# 2026-08-17 — Script-based document generation (code2office-style)

## Problem

`create_pptx`/`create_docx`/`create_xlsx` (`src/tools/documents.ts`) require the model to describe
the *entire* document — every slide, block, or row — as one JSON tool-call argument in a single
completion. Every provider caps `max_tokens` at 8000 (`src/providers/{kilo,groq,openrouter,
openaiCompatible}.ts`). Any real-sized deck, report, or workbook blows past that, hits
`finish_reason=length` mid-argument, and the model has to regenerate the entire giant blob from
scratch — the reported "inefficient / times out most of the time" behavior.

## Approach

Three new tools — `run_pptx_script`, `run_docx_script`, `run_xlsx_script` (`src/tools/
documentScripts.ts`) — let the model write a compact Node.js script instead (loops/variables
express repetitive structure far more compactly than expanded JSON), then execute it. The existing
`create_pptx`/`create_docx`/`create_xlsx` are unchanged and kept for small documents, where the
JSON approach is genuinely simpler.

### The load-bearing problem this design had to solve first

A script written into the *user's* project directory can't `require('pptxgenjs')` and have it
resolve, because Node resolves bare specifiers from the requiring file's own location, not from
Wrexlyn's install directory. Two rounds of research (an Explore pass, then a Plan-agent critique of
the first draft) surfaced this and rejected the first design (concatenating a "kit" of helper code
as a text preamble in front of the model's script) for good reasons: identifier collisions between
the kit and the model's own variables are a hard `SyntaxError`, and prepending ~300+ lines of kit
source shifts every line number in stack traces the model needs to debug against — undermining the
main reason a script-based approach helps in the first place.

**Resolution (user-confirmed): NODE_PATH.** `shellService.ts`'s new `run_document_script` IPC
branch sets `NODE_PATH` (to Wrexlyn's own `node_modules` *and* the new top-level `document-kits/`
directory) on the child process actually executing the script. This makes ordinary
`require('pptxgenjs')` / `require('docx')` / `require('exceljs')` / `require('wrexlyn-pptx-kit')`
resolve correctly regardless of where the script physically lives — real, separate module scope, no
concatenation, no global pollution, correct independent line numbers in stack traces, and (as the
live test below actually proved) it's forgiving even when the model ignores the "these are already
available" guidance and writes its own `require(...)` call anyway — NODE_PATH resolves it either
way.

### Execution: extending `shellService.ts`, not bypassing it

`run_shell_command`'s isolation (a forked child process, so the network-facing main process never
calls `exec()` directly) exists specifically to bound what a compromised WS handler could do. A
script-execution tool is a new "run arbitrary code" primitive with the same shape of risk, so it
routes through the same forked child rather than adding a second, parallel code-execution surface
in the main process. The new IPC request shape (`RunDocumentScriptRequest`, distinguished from the
existing shell-command shape by a `type` field absent on every existing request) uses
`execFile(process.execPath, [scriptPath], {cwd, env, timeout})` — a real argv array, not a shell
string, avoiding exactly the quoting problem the codebase already moved off of once before
(`dockerSandbox.ts`/`gitCheckpoint.ts`'s own `execFile`-over-`exec` fix) — this repo's own working
directory has a space in it, a real case, not a hypothetical one.

**`--sandbox` is explicitly not supported for these three tools.** The Docker container only ever
mounts the project's own working directory, never Wrexlyn's `node_modules`/`document-kits/`, so
NODE_PATH would point at nothing reachable inside it. The new IPC branch never routes to Docker
regardless of `ctx.sandbox` — stated plainly in each tool's description, not a silent
inconsistency.

### `document-kits/` — curated helpers, not a blank slate

Three flat, uncompiled CommonJS files (`document-kits/wrexlyn-{pptx,docx,xlsx}-kit.js` — outside
`src/`, so `tsconfig.json`'s `"include": ["src/**/*.ts"]` never touches them, the same reasoning
`public/` static assets aren't compiled) port the highest-value "design DNA" out of
`src/tools/documents.ts` that a from-scratch script would otherwise reinvent: pptx's dark-theme
palette, `ICON_GLYPHS`/`addIconBadge`, shrink-to-fit sidebar text sizing; docx's markup-to-`TextRun`
conversion, ordered-list numbering, TOC helper, US-Letter page size (docx.js defaults to A4); xlsx's
formula-aware cell typing and header/zebra-row styling. `wrexlyn-docx-kit.js`/`wrexlyn-xlsx-kit.js`
re-export `darkenHex`/`lightenHex`/`headerBandColors` from the *compiled* `dist/documentIR.js`
rather than duplicating that logic.

**Real ergonomic gap found by live-testing, fixed same-day**: pptx's `createDeckTheme()` returns a
theme object whose color palette is plain properties (`theme.bgColor`) but whose layout helpers
(`addIconBadge`, `addSidebar`, `renderDotList`) are *methods* on that object, not top-level
exports — only `createDeckTheme` and `pptxRuns` are. The first prompt wording didn't make this
distinction clear enough; a live test (see below) had the model call `addIconBadge(slide, ...)` as
a bare function and get `TypeError: addIconBadge is not a function`. Both the tool description
(`documentScripts.ts`) and the system prompt (`agent.ts`) were rewritten to spell out
`theme.methodName(...)` explicitly, with a one-line "these are methods, not bare functions" note.

### New post-execution quality gate (`src/documentScriptQuality.ts`)

`documentQuality.ts`'s existing checks operate purely on pre-render JSON args — a script-based flow
has no such JSON, so an equivalent must re-open the *rendered* file. Per explicit direction, this
gate is strict and blocking, so a failure feeds the model's existing same-turn retry loop
(`agent.ts`, bounded by `MAX_TOOL_ITERATIONS`) — the "reiterate until well-formed" behavior asked
for already exists in this codebase; only the check itself needed building.

- **pptx/docx**: both are zip archives — the same `JSZip.loadAsync` pattern already used by
  `src/tools/redline.ts`. Text is extracted by **concatenating every text-run node within one
  paragraph/shape before regex-matching**, not scanning per run — OOXML routinely splits one
  sentence (and therefore a placeholder word) across multiple `<w:t>`/`<a:t>` runs. A regression
  test proves this: a "TODO" deliberately split into two adjacent runs within one paragraph is
  still caught; a naive per-run scan would miss it.
- **xlsx**: `exceljs`'s own `workbook.xlsx.readFile()` re-reads the just-written file directly.
  Known, stated limitation: formula *result* verification (e.g. detecting `#REF!`) is out of
  scope — `exceljs` doesn't evaluate formulas, and there is no LibreOffice-recalculation step here.
- Shares the exact `PLACEHOLDER_PATTERNS`/`findPlaceholder` from `documentQuality.ts` (now
  exported) rather than a second, driftable copy.

### Deterministic backstop in the existing tools

Rather than rely purely on ~30 lines of new system-prompt guidance, `create_pptx`/`create_docx`/
`create_xlsx` themselves now refuse past a threshold (8 slides / 40 blocks / 200 total data rows —
illustrative, tunable) and name the matching script tool in the refusal message. This guarantees the
fix engages even if the model doesn't consistently read and follow the prose.

### Risk classification (user-confirmed)

All three tools are unconditionally `"high"` risk — a script is genuine arbitrary code execution,
not just document assembly from data already visible in the tool call. Confirmed trade-off:
high-risk tool calls can never be `"always allow"`-ed (`permissions.ts`), so every call prompts —
verified live (see below): the permission modal for `run_pptx_script` showed only Deny/Allow-once,
no Always-allow, exactly as designed.

## Testing

- `src/__tests__/documentScriptQuality.test.ts` (new) — real generated pptx/docx/xlsx fixtures
  (not mocked buffers): clean content passes; the split-across-XML-runs placeholder regression for
  both pptx and docx; a blank deck/document/workbook is blocked; a corrupt/non-zip input is handled
  without throwing.
- `src/__tests__/documentScripts.test.ts` (new) — full `ToolSpec.run()` end-to-end, real script
  execution, no mocking: a real script requiring `wrexlyn-pptx-kit`/`wrexlyn-xlsx-kit` succeeds and
  passes the quality gate; a non-`.cjs` `scriptPath` is rejected before execution; a missing
  `scriptPath` fails clearly; a throwing script surfaces the real error; a script that never writes
  its declared output path fails with a clear message; a script whose output has placeholder text
  fails the quality gate rather than silently succeeding.
- `src/__tests__/shellService.test.ts` (extended) — the new IPC branch in isolation:
  `runDocumentScriptOnHost` in-process; `runDocumentScript` through the real forked child; the
  **crux test** (NODE_PATH resolution actually works — a real script requiring both
  `wrexlyn-pptx-kit` and `pptxgenjs` succeeds); a throwing script's real error surfaces; a
  regression test for a working directory *and* script path both containing a space (this repo's
  own path is exactly such a case).
- `npx tsc -p . --noEmit`, `npm run build && node scripts/run-tests.js` — 312 tests, 307 passing, 0
  failing, 5 skipped (up from 289/284/0/5 before this work; +23 new tests, +0 regressions).

## Live verification

Through the real web UI, pointed at a throwaway scratch project (not this repo):

- Asked for a 15-slide deck. The model correctly chose `run_pptx_script` over `create_pptx`
  (following the size-threshold guidance) and wrote a `.cjs` script requiring `wrexlyn-pptx-kit`.
- **Permission UX confirmed live**: `write_file`'s prompt showed Deny/Always-allow/Allow-once
  (medium risk, as before); `run_pptx_script`'s prompt showed only Deny/Allow-once — no
  Always-allow — confirming the high-risk classification actually takes effect in the real UI, not
  just in code.
- **The retry loop worked on a real, unanticipated failure, not just the fixture cases from the
  test suite**: the first script attempt threw `TypeError: addIconBadge is not a function` (the
  bare-function-vs-theme-method ambiguity described above); the model read the real stack trace,
  rewrote the script, and hit a second, different real error (`TypeError: Cannot create property
  'options' on string ...` — from pptxgenjs itself, caused by mixing a plain string into an array
  meant to be all rich-text-run objects); it corrected that too and the third attempt succeeded.
  Both failures were found by this live test, not anticipated in advance — real evidence the
  strict-quality-gate-plus-retry design actually converges on real mistakes, not just the ones this
  document's own examples happened to cover.
- The resulting `overview.pptx` (224KB, 16 real slides — one more than the 15 requested, since the
  model added its own cover slide, a reasonable interpretation) was independently re-checked
  against `checkRenderedPptxQuality` directly (not just trusted from the tool's own report): `{ok:
  true, blocking: [], warnings: []}`.
- The model's own post-success verification attempts (shelling out to PowerPoint via COM
  automation, then to `Expand-Archive`) were excessive relative to what was needed — the tool's own
  quality gate had already confirmed correctness — and burned a large amount of the free model's
  own turn budget re-deriving that same fact by other means. Not a defect in this design (the
  document was genuinely correct throughout), but a real, honestly-reported observation: nothing
  here stops a model from re-verifying past the point of diminishing returns once it already has a
  trustworthy signal.
- `run_xlsx_script`'s live path was not separately re-exercised through the UI in this same pass
  (time/free-tier-quota constraints, after the pptx run's three-attempt retry loop) — its
  correctness rests on the automated test suite above (real execution, real quality gate, no
  mocking), not on a second live UI run. Stated plainly rather than silently assumed.
- `--sandbox`'s no-op behavior for the three new tools was **not** independently live-verified in
  this pass either, for the same reason `--sandbox` itself couldn't be live-verified in the earlier
  Docker-sandbox work: Docker is not installed in this environment. It is verified at the code
  level (the new IPC branch has no Docker-routing path at all, unconditionally) and by inspection,
  not by observing a live `--sandbox` run actually skip it.

## Commits

Additive work — no existing tool's schema or behavior changed except the new size-threshold
backstop in `create_pptx`/`create_docx`/`create_xlsx`. Committed in logical steps (placeholder-regex
export + kit files + quality gate; shellService IPC extension; the three new tools + registration;
agent.ts wiring + system prompt + backstop; tests; the live-testing-driven prompt-clarity fix; this
doc), matching this session's one-logical-change-per-commit convention. Push only after explicit
confirmation, per standing practice.
