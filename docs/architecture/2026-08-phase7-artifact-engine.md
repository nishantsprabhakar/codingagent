# Phase 7 — Professional artifact engine (flowing-document formats)

Date: 2026-08-13.

## Scope decisions

The backlog described Phase 7 as "a shared structured document representation compiling to
DOCX/PPTX/XLSX/PDF/Markdown/HTML." Two decisions were needed before design:

1. **The shared IR covers only flowing-document formats: DOCX, PDF, Markdown, HTML.** PPTX (slides)
   and XLSX (spreadsheet grid) stay exactly as they were — separate, format-native, untouched
   generators in `src/tools/documents.ts`. Forcing a slide deck or a spreadsheet through the same
   primitives as headings/paragraphs/tables is a known failure mode for generic document tools;
   both already have working format-native generators, so there was nothing to gain by merging them.
2. **PDF via Puppeteer** — compile the IR to HTML, print that HTML through headless Chromium. The
   explicit, accepted tradeoff: `puppeteer` is a `dependencies` addition (not dev-only), so **every
   install of this product now downloads a bundled Chromium** (confirmed ~150MB compressed
   download in this environment), not just users who touch `create_pdf`. This buys real CSS
   layout/page-break fidelity in exchange for that cost.

Grounding: `create_docx`'s existing `blocks` args shape was already almost exactly the IR the
backlog wanted. `checkDocxQuality()`/`checkDocxHasContent()` were already 100% generic over that
shape — zero docx-specific logic despite the names — and are reused verbatim (renamed
`checkBlocksQuality`/`checkBlocksHaveContent`) across all four formats. `richText.ts`'s inline
markup (`**bold**`, `_italic_`, `__underline__`, `~~strike~~`) is already CommonMark-compatible
except underline, which has no native markdown equivalent.

## What shipped

- **`src/documentIR.ts`** — the shared `DocBlock`/`DocSpec` types (formalizing, not inventing, the
  existing shape), the relocated block-shape helpers (`normalizeListItem`, `normalizeCell`,
  `mergeColonContinuations`, `optionalHexColor`) **and theming primitives**
  (`darkenHex`/`lightenHex`/`headerBandColors`/`DEFAULT_ACCENT_HEX`/etc — a gap the first design
  pass missed, caught by an adversarial review before any code was written: without relocating
  these too, the HTML compiler would either reinvent its own accent-tint math or duplicate it and
  silently drift from docx's). Also new: `escapeHtml()` and function-based (not shared-object-
  literal) JSON-schema fragments (`blocksPropertySchema()`, `accentColorPropertySchema()`) reused
  across four tool definitions without risking one tool's edit silently mutating another's.
- **`src/documentCompilers/{toMarkdown,toHtml,toPdf}.ts`** — the three new compilers. `toHtml.ts`
  reuses docx's exact theming functions for accent-color consistency across formats, builds
  deduped heading-id slugs so `toc` blocks render real `<a href="#slug">` jump links (a genuine
  capability upgrade over both docx's page-number-based field and markdown's plain list), and
  renders nested bullet lists via a small state-machine that tracks open `<li>`/`<ul>` pairs across
  arbitrary level jumps (ascend several levels at once, descend into a child, return to a shallower
  sibling) — verified with a dedicated test, not just the simple one-level case. `toPdf.ts` calls
  `toHtml.ts` and prints via Puppeteer, with launch failures caught and rephrased into an actionable
  message rather than an unhandled crash, and a `browser.close()` call raced against a 10s timeout
  with a `SIGKILL` fallback (a plain `try/finally` alone doesn't protect against a `close()` that
  never resolves — caught by the same adversarial review pass).
- **`src/tools/flowingDocuments.ts`** — `create_markdown`/`create_html`/`create_pdf`, following
  `create_docx`'s exact conventions (empty-content check → quality gate → compile → write →
  `{ok, output, qualityGate}`). `create_markdown` omits `accentColor` (meaningless — plain markdown
  has no color rendering); the other two include it.
- **`src/tools/documents.ts`** — `create_docx` refactored to import from `documentIR.ts` instead of
  defining everything locally. **Zero behavior change** — verified by a direct smoke test producing
  byte-for-byte equivalent output structure before and after the refactor.

## A real security issue found and fixed before any code shipped

An adversarial review pass (before implementation, not after) surfaced that **unescaped
model-supplied text interpolated into generated HTML is a live script-injection risk, not a
formatting bug**: nothing in this project validates `blocks` against its advertised JSON Schema at
runtime (no ajv/zod/joi dependency exists anywhere), and Puppeteer's `page.setContent()` executes
JS in the page it renders. A block like `{"type":"paragraph","text":"<script>...</script>"}` —
plausible after summarizing scraped web content via `web_fetch` — would have executed live during
PDF generation, and in any real browser that later opened the generated `.html` file.

Fixed with `escapeHtml()` (`documentIR.ts`), applied to every literal text node in both the HTML and
Markdown compilers, applied *after* `parseInlineMarkup` splits out bold/italic/strike spans (safe
either order — markup delimiters aren't HTML-meaningful characters). Markdown gets the same
treatment for a related reason: CommonMark passes raw inline HTML through untouched (exactly why
`<u>` was chosen for underline, which has no native markdown syntax), so an unescaped `<script>` in
plain paragraph text would pass through a `.md` file into whatever renders it downstream just as
readily. Verified with dedicated tests: a `<script>alert(1)</script>` payload in a heading,
paragraph, and table cell never survives unescaped in either compiler's output.

Two smaller, related correctness fixes from the same review: table cells escape a literal `|`
(would otherwise silently shift the rendered column count) and collapse embedded newlines to `<br>`
(pipe tables are single-line — an unescaped newline breaks the row); `align` values are mapped
through a fixed whitelist dictionary before touching a `style` attribute, never interpolated raw.

## Testing

`src/__tests__/documentCompilers.test.ts` (11 tests): full heading range (1–6, not truncated to
h1–4), every inline-markup style, nested-bullet correctness (multi-level ascend/descend, not just
one level deep), table pipe/newline escaping, real image embedding (base64 data URI, via an actual
1x1 PNG — not a mock), the `<script>` injection test for both compilers, heading-slug dedup + toc
jump-links, and pagebreak handling. One real (unmocked) Puppeteer test renders an actual PDF and
asserts the `%PDF-` magic bytes — matching this codebase's established "test the real mechanism"
precedent (`shellService.test.ts`) — with a 30s per-test timeout and an environment-skip escape
hatch for a sandbox where Chromium can't launch. `npm run verify`: clean, 165 tests, 162 pass (3
skipped — 2 pre-existing, 1 Phase 5's symlink test).

## Live verification — what was confirmed, and an honest gap

**Confirmed directly** (not through an LLM): all four flowing-document tools, invoked through the
actual `TOOLS` registry (`src/tools/index.ts`) that `agent.ts` dispatches through — the identical
code path a real tool call takes — with the same `blocks` (heading, paragraph, table, toc,
pagebreak) compiled to `.docx`/`.md`/`.html`/`.pdf` in one pass. All four succeeded; the markdown
output was inspected directly and confirmed correct (proper table, TOC, thematic break).

**What was not confirmed live through the actual web UI with a real model making the tool calls**:
three consecutive attempts across different free OpenRouter models failed for reasons outside this
codebase's control — two hit OpenRouter's free-tier rate limit (429, from the cumulative volume of
free-model testing already done across Phases 5, 6, and 7 today) and one silently stalled past the
90s model-idle timeout without ever producing a tool call. This is the same class of external
limitation already noted honestly in Phase 6's doc; it is not glossed over here either. Confidence
that the tools work correctly when a model calls them rests on: the tools being the exact same
`ToolSpec` objects registered in `tools/index.ts` (not a parallel reimplementation used only for
testing), the full compiler test suite, and the direct registry-level smoke test above exercising
the identical `describe`/`preview`/`run` functions the agent loop calls.

## Known, explicitly-scoped-out limitations

- PPTX/XLSX are not part of this IR — an explicit, discussed scope decision, not an oversight.
- `puppeteer` in `dependencies` means every install of the product downloads Chromium, not just PDF
  users — the explicitly accepted cost of the fidelity this approach buys.
- Markdown's TOC has no links (no reliable cross-renderer heading-anchor convention). HTML/PDF's
  TOC has real jump-links but no page numbers, unlike docx's Word-native field. Neither tool's
  description overclaims parity with docx's TOC.
- No schema-validation library exists in this project — every compiler defensively handles
  malformed input the same way `create_docx` already did (fixed lookup tables for enums,
  regex-constrained colors, escaped text) rather than trusting the advertised JSON Schema.
- Base64-embedded images have no compression (unlike docx/pptx's zip parts) — a size warning
  surfaces in the tool's own output past a ~25MB threshold rather than growing silently.
