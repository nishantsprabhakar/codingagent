# 2026-08-18 — Rich PPTX layouts: native charts, high-end tables, infographics

## Problem

A generated slide (dark theme, kicker, title, 5 bullet points) prompted direct feedback: "I want
rich layouts. High end tables, charts and infographics. Not plain slides." Investigation confirmed
this was a real capability gap, not just taste:

- **Zero chart support anywhere.** `checkPptxQuality`/`checkPptxHasContent`/the system prompt had
  no chart-awareness at all, despite `pptxgenjs` (already a dependency) supporting native,
  PowerPoint-editable charts via `addChart()`.
- **Tables worked but were plain.** Zebra striping and header shading already existed, but there
  was no per-column width control and no way to highlight a specific row (e.g. a "Total" row).
- **No dedicated infographic primitives.** The `cover` layout's `stats` row and the `cards` layout
  were good building blocks, but neither was a standalone slide layout, and there was no
  connected-step/process visual at all.

User-confirmed scope: improve the underlying capability generally, and add chart support to
**both** `create_pptx`'s JSON schema and the `run_pptx_script`/`wrexlyn-pptx-kit` script path —
mirroring how table support already worked (a simple JSON shape for the common case, full
`pptxgenjs` access for anything more complex).

## What was added

### Native charts

`create_pptx` gained a slide-level `chart` field: `{type: "bar"|"line"|"pie"|"doughnut",
categories, series: [{name, values}], title?}`, rendered via `pptxgenjs`'s real `addChart()` (not
a rendered image) with two theme-consistent style presets — bar/line get axis/gridline styling and
`outEnd` value labels, pie/doughnut get a right-side legend and percentage labels. `run_pptx_script`
scripts get the same defaults via a new `wrexlyn-pptx-kit.js` method, `theme.chartDefaults(kind)`,
while retaining full `addChart` access for anything the simple JSON schema doesn't expose (combo
charts, area/radar/scatter).

Two real pptxgenjs corruption modes were designed around rather than left as documentation
caveats: `dataLabelPosition: "outEnd"` corrupts a *stacked* bar/column chart (must be
`ctr`/`inEnd`/`inBase` there) — the JSON path never exposes `barGrouping: "stacked"`, so this can't
happen by construction; a combo chart's secondary axis needs *both* `valAxes` and `catAxes` set
with two entries each, or PowerPoint discards the chart — the JSON path never sets a secondary axis
at all. Both gotchas are still called out explicitly in `run_pptx_script`'s tool description and
the system prompt, since that path has raw `addChart` access where they're reachable.

### High-end tables

Two additive, optional fields on the existing `table` slide field: `widths` (per-column inches,
passed to `addTable`'s `colW` option instead of an even split) and `highlightRows` (0-indexed;
those rows get an accent-tinted fill — `darkenHex`/`lightenHex` of the accent color depending on
theme — instead of the normal zebra stripe). The header row's font size was split from the body
row's (13.5 vs 13) now that each row builds its own options object. `wrexlyn-pptx-kit.js` gained
matching `theme.tableHeaderRow`/`theme.tableBodyRow` helpers so a script's own `addTable` call
gets the same styling without reimplementing it.

### Two new infographic layouts

`layout: "stats"` promotes the `cover`-only stats-row rendering into a standalone, reusable
function (`renderStatsRow`, `size: "compact" | "large"`) — `"compact"` reproduces `cover`'s exact
existing geometry (zero regression there), `"large"` is the new layout's bigger, slide-filling
treatment. No new field was needed; it reuses the existing `stats` field, and the existing
placeholder check in `checkPptxQuality` already covered it unconditionally.

`layout: "timeline"` is a genuinely new visual: numbered/iconed badge circles connected by a
horizontal line, driven by a new `steps: [{icon?, label, caption?}]` field. It reuses `cards`'
row-mode badge-circle math but deliberately drops the card background rectangle — the point is a
connected flow, not freestanding boxes.

Both got `wrexlyn-pptx-kit.js` equivalents (`theme.renderStatsRow`, `theme.renderTimeline`) for
script-path parity, and `checkPptxQuality`/`checkPptxHasContent` were extended for `chart` and
`steps` (a chart-only or steps-only slide was previously — and would otherwise still be — rejected
as "empty").

## Design process

Before writing any code: an Explore agent mapped the exact current state of table/stats/cards
rendering, `checkPptxQuality`, `checkPptxHasContent`, the full `wrexlyn-pptx-kit.js`, and
pptxgenjs's real `addChart`/`IChartOpts` type signatures. A Plan agent then critiqued the resulting
design against that real code before implementation started, catching two real issues fixed before
any code was written: the `timeline` layout's plan initially left ambiguous whether to keep the
`cards`-style card background behind the connector line (dropped, since a background box behind a
"connected flow" visual reads as a leftover, not a corruption risk but a real design miss); and
`src/tools/documentScripts.ts`'s tool description — which hardcodes the full list of available kit
methods — was missing from the initial "critical files" list, despite being exactly what caused a
real live bug (`addIconBadge is not a function`) the last time kit methods changed without a
matching description update (see `2026-08-script-based-document-generation.md`).

## Testing

- `src/__tests__/documentsPptxRich.test.ts` (new, 7 tests) — real `createPptxTool.run()` calls, no
  mocking: a chart slide produces a real `ppt/charts/chartN.xml` part in the generated zip;
  mismatched `categories`/`values` lengths are rejected by the quality gate *before* any file is
  written; a placeholder chart series name is blocked; `stats` and `timeline` layouts each render a
  real, valid deck; a placeholder timeline caption is blocked; a table with `widths`/
  `highlightRows` renders with the highlighted row's real fill color (`darkenHex(accent, 0.75)`)
  present in the slide XML and distinct from the zebra pattern.
- `src/__tests__/documentScripts.test.ts` (extended, +1 test) — a real `.cjs` script exercising
  `theme.chartDefaults`, `theme.tableHeaderRow`/`tableBodyRow`, `theme.renderStatsRow`, and
  `theme.renderTimeline` together, run through the real `run_pptx_script` tool (real forked child
  process, real NODE_PATH resolution) — proves the new kit methods actually work end-to-end, not
  just that they typecheck.
- `npx tsc -p . --noEmit`, `npm run build && node scripts/run-tests.js` — 320 tests, 315 passing, 0
  failing, 5 skipped (up from 312/307/0/5 before this work — +8 new tests, 0 regressions).

## Live verification

Through the real web UI, in a throwaway scratch project: asked for a 5-slide SaaS quarterly-review
deck (cover, bar chart, table with a highlighted Total row, 3-step timeline, 3-stat KPI slide) in
plain English, with no mention of the new field names. The model (`kilo-auto/free`) chose
`layout='cover'` with `stats`, a `chart` field with `type: 'bar'`, a `table` with `highlightRows`,
`layout='timeline'` with `steps`, and `layout='stats'` — every new field, chosen unprompted from
the system-prompt guidance alone.

The resulting `overview.pptx` was independently re-checked (not just trusted from the tool's own
report):
- `checkRenderedPptxQuality` on the actual file: `{ok: true, blocking: [], warnings: []}`.
- A real `ppt/charts/chart1.xml` part exists in the zip — a native, PowerPoint-editable chart, not
  a rendered image.
- The table slide's `<a:tbl>` XML shows the "Total" row's cell fill as `0C3A36` — exactly
  `darkenHex("2FE6D9", 0.75)`, the computed highlight color — while every other row alternates
  between the two normal zebra fills (`0A0E17`/`111826`).
- The timeline slide's XML contains a line shape (the connector) alongside the badge circles.

One real environmental snag, not a code defect: the permission prompt for the `create_pptx` call
(medium risk) rendered outside the region `get_page_text` captures (a modal, not part of `<main>`),
so a purely text-based check of the page looked like the tool was silently hung for several
minutes when it was actually just waiting on approval the whole time. Confirmed via `read_page`
(which does capture dialogs) and resolved by clicking through it — not a bug in this feature, but
worth knowing when live-verifying medium/high-risk tools through text-only browser inspection in
future sessions.

## Commits

Additive work — no existing `create_pptx`/`run_pptx_script` schema field changed meaning, only new
optional fields and layout values. Committed in logical steps (chart support; table enhancements;
stats/timeline layouts; kit helpers; tool description + system prompt guidance; tests; this doc).
Push only after explicit confirmation, per standing practice.
