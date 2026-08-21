/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import * as path from "path";
import {
  Document,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Packer,
  WidthType,
  BorderStyle,
  ShadingType,
  AlignmentType,
  LevelFormat,
  PageBreak,
  ImageRun,
  TableOfContents,
} from "docx";
import PptxGenJS from "pptxgenjs";
import ExcelJS from "exceljs";
import type { ToolSpec } from "../types";
import { resolveInRoot } from "./paths";
import { parseInlineMarkup, stripInlineMarkup } from "./richText";
import { loadImageFile, fitImageBox } from "./imageUtils";
import { checkBlocksQuality, checkPptxQuality, checkXlsxQuality } from "../documentQuality";
import {
  DEFAULT_ACCENT_HEX,
  DEFAULT_ACCENT_DARK_HEX,
  TEXT_HEX,
  BODY_FONT,
  MAX_IMAGE_BYTES,
  darkenHex,
  lightenHex,
  headerBandColors,
  optionalHexColor,
  normalizeListItem,
  mergeColonContinuations,
  normalizeCell,
  flattenCellMarkup,
  checkBlocksHaveContent,
  summarizeBlocks,
  blocksPropertySchema,
  accentColorPropertySchema,
  type CellSpec,
} from "../documentIR";

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

/** Default dark theme for pptx — slide background/text colors when theme !== "light". Matches the
 *  "Wrexlyn Professional" reference deck style: near-black navy, restrained muted body text (not
 *  high-contrast white-on-black everywhere), a bordered-card visual language, and a rotating
 *  color-coded badge palette for numbered/sequential content instead of one flat accent everywhere.
 *  Every value below is read directly out of the reference deck's own XML (python-pptx), not
 *  estimated from a rendered image — exact, not approximate. */
const PPTX_DARK_BG = "0A0E17";
const PPTX_DARK_BODY_TEXT = "8FA0B8";
const PPTX_DARK_TITLE_TEXT = "F4F7FB";
const PPTX_DARK_ZEBRA = "161F30";
const PPTX_LIGHT_ZEBRA = "F3F4F6";
const PPTX_CARD_BG = "111826";
const PPTX_CARD_BORDER = "232E45";
const PPTX_MUTED_TEXT = "8FA0B8";
const PPTX_FOOTER_TEXT = "5F7186";
/** The sidebar/callout panel is a visually distinct shade from a plain content card, not a reuse of
 *  PPTX_CARD_BG/PPTX_CARD_BORDER — slightly lighter fill, and a darker, more restrained teal border
 *  than the bright accent used for kickers/badges. */
const PPTX_SIDEBAR_BG = "161F30";
const PPTX_SIDEBAR_BORDER = "1B8F87";
/** Rotating palette for numbered/sequential card badges (the "01/02/03" and "1/2/3/4" step patterns) —
 *  cycling through distinct hues reads as deliberately designed, not the same accent repeated. */
const PPTX_BADGE_COLORS = ["2FE6D9", "FF6B6B", "FFB454", "8B7CFA", "4ADE80"];

/** Small curated icon vocabulary rendered as an emoji glyph inside an accent-colored circle badge — no
 *  image assets or native-binary rendering dependencies (react-icons/sharp), so this always works the
 *  same way on every machine this app is installed on. */
const ICON_GLYPHS: Record<string, string> = {
  check: "✓",
  star: "★",
  chart: "📊",
  target: "🎯",
  lock: "🔒",
  warning: "⚠",
  idea: "💡",
  rocket: "🚀",
  gear: "⚙",
  arrow: "→",
  dollar: "💲",
  calendar: "📅",
};

const THIN_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "D1D5DB" } as const;
const TABLE_BORDERS = {
  top: THIN_BORDER,
  bottom: THIN_BORDER,
  left: THIN_BORDER,
  right: THIN_BORDER,
  insideHorizontal: THIN_BORDER,
  insideVertical: THIN_BORDER,
};

// ---------- Word (.docx) ----------

const ORDERED_LIST_REFERENCE = "wrexlyn-ordered-list";
const DOCX_ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

function docxAlign(align: unknown): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  return typeof align === "string" && DOCX_ALIGN[align] ? DOCX_ALIGN[align] : undefined;
}

/** Turns "**bold** _italic_" text into real styled TextRuns; `override` forces bold/color regardless of markup (e.g. table headers). */
function docxRuns(text: string, override?: { color?: string; bold?: boolean }): TextRun[] {
  const spans = parseInlineMarkup(text ?? "");
  const list = spans.length ? spans : [{ text: "" }];
  return list.map(
    (s) =>
      new TextRun({
        text: s.text,
        bold: override?.bold || s.bold || undefined,
        italics: s.italic || undefined,
        strike: s.strike || undefined,
        underline: s.underline ? {} : undefined,
        color: override?.color,
      })
  );
}

// Deterministic backstop, not just system-prompt guidance: create_docx/create_pptx/create_xlsx
// require the model to describe an entire document as one JSON tool-call argument, which every
// provider's 8000-token completion cap (see src/providers/*.ts) makes unreliable past a certain
// size — the model hits finish_reason=length mid-argument and has to regenerate the whole blob.
// Rather than relying purely on the model reading and following prose guidance, these three tools
// themselves refuse past a threshold and redirect to the matching run_*_script tool
// (src/tools/documentScripts.ts), which has the model write a compact script instead. Thresholds
// are illustrative, not load-bearing precision — tunable without changing the underlying reasoning.
const DOCX_SCRIPT_THRESHOLD_BLOCKS = 40;
const PPTX_SCRIPT_THRESHOLD_SLIDES = 8;
const XLSX_SCRIPT_THRESHOLD_ROWS = 200;

function checkDocxSizeThreshold(blocks: any[] | undefined): string | null {
  const count = Array.isArray(blocks) ? blocks.length : 0;
  if (count <= DOCX_SCRIPT_THRESHOLD_BLOCKS) return null;
  return (
    `This document has ${count} blocks — past create_docx's practical size for a single JSON tool call (risks ` +
    `exceeding your own output token limit mid-argument). Use run_docx_script instead: write a .cjs script with ` +
    `write_file (require('docx') or require('wrexlyn-docx-kit')), then call run_docx_script with {scriptPath, path}.`
  );
}

function checkPptxSizeThreshold(slides: any[] | undefined): string | null {
  const count = Array.isArray(slides) ? slides.length : 0;
  if (count <= PPTX_SCRIPT_THRESHOLD_SLIDES) return null;
  return (
    `This deck has ${count} slides — past create_pptx's practical size for a single JSON tool call (risks ` +
    `exceeding your own output token limit mid-argument). Use run_pptx_script instead: write a .cjs script with ` +
    `write_file (require('pptxgenjs') or require('wrexlyn-pptx-kit')), then call run_pptx_script with {scriptPath, path}.`
  );
}

function checkXlsxSizeThreshold(sheets: any[] | undefined): string | null {
  const totalRows = Array.isArray(sheets) ? sheets.reduce((sum, s) => sum + (Array.isArray(s?.rows) ? s.rows.length : 0), 0) : 0;
  if (totalRows <= XLSX_SCRIPT_THRESHOLD_ROWS) return null;
  return (
    `This workbook has ${totalRows} total data rows — past create_xlsx's practical size for a single JSON tool ` +
    `call (risks exceeding your own output token limit mid-argument). Use run_xlsx_script instead: write a .cjs ` +
    `script with write_file (require('exceljs') or require('wrexlyn-xlsx-kit')), then call run_xlsx_script with ` +
    `{scriptPath, path}.`
  );
}

export const createDocxTool: ToolSpec = {
  mutating: true,
  definition: {
    type: "function",
    function: {
      name: "create_docx",
      description:
        "Create a well-formatted Word (.docx) document from structured content blocks. Use this instead of " +
        "write_file for any Word document request. `blocks` must contain the actual, complete content the user " +
        "asked for — never call this with an empty or placeholder body. Text fields support inline markup: " +
        "**bold**, _italic_, __underline__, ~~strikethrough~~ (combinable, e.g. **_bold italic_**). A `toc` block " +
        "inserts a real, auto-updating, clickable table of contents generated from heading blocks placed earlier " +
        "in `blocks` — use it for anything long enough to need one (reports, specs), and put actual heading blocks " +
        "before it so it has something to list.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Output path relative to the working directory, ending in .docx" },
          title: { type: "string", description: "Document title, rendered as a large title heading at the top." },
          accentColor: accentColorPropertySchema(),
          blocks: blocksPropertySchema(),
        },
        required: ["path", "blocks"],
      },
    },
  },
  describe: (args) => `create ${args.path}`,
  preview: async (args) => summarizeBlocks(args.path, args.title, args.blocks),
  run: async (args, ctx) => {
    const emptyCheck = checkBlocksHaveContent(args.blocks);
    if (emptyCheck) return { ok: false, output: emptyCheck };
    const sizeCheck = checkDocxSizeThreshold(args.blocks);
    if (sizeCheck) return { ok: false, output: sizeCheck };

    const quality = checkBlocksQuality(args.blocks ?? []);
    if (!quality.ok) {
      const output = quality.blocking.join("\n");
      return { ok: false, output, qualityGate: { name: "docx quality gate", ok: false, output } };
    }

    const customAccent = optionalHexColor(args.accentColor);
    const accent = customAccent ?? DEFAULT_ACCENT_HEX;
    const accentDark = customAccent ? darkenHex(accent) : DEFAULT_ACCENT_DARK_HEX;
    const headerBand = headerBandColors(customAccent, accentDark);

    const filePath = resolveInRoot(ctx.root, args.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const children: (Paragraph | Table)[] = [];
    if (args.title) {
      children.push(
        new Paragraph({ text: String(args.title), heading: HeadingLevel.TITLE, spacing: { after: 240 } })
      );
    }

    for (const block of args.blocks ?? []) {
      if (block.type === "heading") {
        const idx = Math.min(Math.max((block.level ?? 1) - 1, 0), HEADING_LEVELS.length - 1);
        const isTopLevel = idx === 0;
        children.push(
          new Paragraph({
            children: docxRuns(block.text ?? "", { color: optionalHexColor(block.color) ?? (isTopLevel ? headerBand.text : undefined) }),
            heading: HEADING_LEVELS[idx],
            alignment: docxAlign(block.align),
            // A light-blue band behind H1 only — banding every heading level would stripe a long
            // document throughout instead of just marking its major sections.
            shading: isTopLevel && !optionalHexColor(block.color) ? { type: ShadingType.SOLID, fill: headerBand.fill } : undefined,
            spacing: { before: 240, after: 120 },
          })
        );
      } else if (block.type === "paragraph") {
        children.push(
          new Paragraph({
            children: docxRuns(block.text ?? "", { color: optionalHexColor(block.color) }),
            alignment: docxAlign(block.align),
            spacing: { after: 160 },
          })
        );
      } else if (block.type === "bullets") {
        const items = mergeColonContinuations((block.items ?? []).map(normalizeListItem));
        const ordered = !!block.ordered;
        for (const item of items) {
          children.push(
            new Paragraph({
              children: docxRuns(item.text, { color: optionalHexColor(block.color) }),
              ...(ordered
                ? { numbering: { reference: ORDERED_LIST_REFERENCE, level: item.level } }
                : { bullet: { level: item.level } }),
              spacing: { after: 60 },
            })
          );
        }
      } else if (block.type === "table") {
        const headers: any[] = block.headers ?? [];
        const rows: any[][] = block.rows ?? [];
        const tableRows: TableRow[] = [];
        if (headers.length) {
          tableRows.push(
            new TableRow({
              tableHeader: true,
              children: headers.map((h) => {
                const cell = normalizeCell(h);
                return new TableCell({
                  shading: { type: ShadingType.SOLID, fill: headerBand.fill },
                  children: [
                    new Paragraph({
                      children: docxRuns(cell.text, { color: headerBand.text, bold: true }),
                      alignment: docxAlign(cell.align),
                    }),
                  ],
                });
              }),
            })
          );
        }
        rows.forEach((row, i) => {
          tableRows.push(
            new TableRow({
              children: row.map((cellVal) => {
                const cell = normalizeCell(cellVal);
                return new TableCell({
                  shading: i % 2 === 1 ? { type: ShadingType.SOLID, fill: "F3F4F6" } : undefined,
                  children: [
                    new Paragraph({
                      children: docxRuns(cell.text, cell.bold ? { bold: true } : undefined),
                      alignment: docxAlign(cell.align),
                    }),
                  ],
                });
              }),
            })
          );
        });
        if (tableRows.length) {
          children.push(
            new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE }, borders: TABLE_BORDERS })
          );
        }
      } else if (block.type === "image") {
        const loaded = loadImageFile(ctx.root, String(block.path ?? ""), MAX_IMAGE_BYTES);
        if ("error" in loaded) return { ok: false, output: loaded.error };
        const { widthIn, heightIn } = fitImageBox(loaded.intrinsic, 6.2, block.width, block.height);
        children.push(
          new Paragraph({
            alignment: docxAlign(block.align) ?? AlignmentType.CENTER,
            children: [
              new ImageRun({
                type: loaded.type,
                data: loaded.buffer,
                transformation: { width: Math.round(widthIn * 96), height: Math.round(heightIn * 96) },
              }),
            ],
            spacing: { after: block.caption ? 60 : 160 },
          })
        );
        if (block.caption) {
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: docxRuns(String(block.caption), { color: "6B7280" }),
              spacing: { after: 200 },
            })
          );
        }
      } else if (block.type === "pagebreak") {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      } else if (block.type === "toc") {
        children.push(
          new Paragraph({ text: block.text || "Table of Contents", heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } })
        );
        children.push(new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }));
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
    }

    const doc = new Document({
      numbering: {
        config: [
          {
            reference: ORDERED_LIST_REFERENCE,
            levels: [
              { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START },
              { level: 1, format: LevelFormat.LOWER_LETTER, text: "%2.", alignment: AlignmentType.START },
              { level: 2, format: LevelFormat.LOWER_ROMAN, text: "%3.", alignment: AlignmentType.START },
              { level: 3, format: LevelFormat.DECIMAL, text: "%4.", alignment: AlignmentType.START },
            ],
          },
        ],
      },
      styles: {
        default: {
          document: { run: { font: BODY_FONT, size: 22, color: TEXT_HEX } },
          heading1: { run: { color: accentDark, size: 32, bold: true } },
          heading2: { run: { color: accentDark, size: 28, bold: true } },
          heading3: { run: { color: accentDark, size: 24, bold: true } },
        },
      },
      // A table of contents is inserted as a field with no cached page numbers (we can't lay out pages
      // ourselves) — this tells Word to compute them automatically the moment the file is opened.
      features: { updateFields: (args.blocks ?? []).some((b: any) => b.type === "toc") },
      sections: [{ children }],
    });
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);

    const headingText = (args.blocks ?? [])
      .filter((b: any) => b.type === "heading")
      .map((b: any) => String(b.text ?? "").trim())
      .filter(Boolean);
    // Real structural content, not just a block count — this is what the independent critic actually
    // reads (see critic.ts's stepSummary), so it can judge document quality against the stated intent
    // instead of just seeing "Created report.docx (12 blocks, 48213 bytes)".
    const structureSummary = [args.title ? `Title: ${args.title}` : null, headingText.length ? `Headings: ${headingText.join(" | ")}` : null]
      .filter(Boolean)
      .join(". ");
    const warningSuffix = quality.warnings.length ? `\nQuality notes: ${quality.warnings.join(" ")}` : "";

    return {
      ok: true,
      output: `Created ${args.path} (${(args.blocks ?? []).length} content blocks, ${buffer.length} bytes). ${structureSummary}${warningSuffix}`,
      qualityGate: { name: "docx quality gate", ok: true, output: quality.warnings.join("\n") },
    };
  },
};

// ---------- PowerPoint (.pptx) ----------

interface PptxTextBase {
  fontFace: string;
  fontSize: number;
  color: string;
}

/** Turns "**bold** _italic_" text into a run array pptxgenjs's addText accepts, inheriting `base`'s font/size/color. */
function pptxRuns(text: string, base: PptxTextBase, extra?: Record<string, unknown>): PptxGenJS.TextProps[] {
  const spans = parseInlineMarkup(text ?? "");
  const list = spans.length ? spans : [{ text: "" }];
  return list.map((s) => ({
    text: s.text,
    options: {
      fontFace: base.fontFace,
      fontSize: base.fontSize,
      color: base.color,
      bold: s.bold || undefined,
      italic: s.italic || undefined,
      strike: s.strike || undefined,
      underline: s.underline ? { style: "sng" } : undefined,
      ...extra,
    },
  }));
}

/** Renders a (possibly nested, possibly markup-styled) bullet list as one run array for a single addText call. */
function pptxBulletRuns(items: Array<{ text: string; level: number }>, base: PptxTextBase): PptxGenJS.TextProps[] {
  const runs: PptxGenJS.TextProps[] = [];
  items.forEach((item) => {
    const spans = parseInlineMarkup(item.text);
    const list = spans.length ? spans : [{ text: "" }];
    list.forEach((s, i) => {
      runs.push({
        text: s.text,
        options: {
          fontFace: base.fontFace,
          fontSize: base.fontSize,
          color: base.color,
          bold: s.bold || undefined,
          italic: s.italic || undefined,
          strike: s.strike || undefined,
          underline: s.underline ? { style: "sng" } : undefined,
          // Only the item's first run gets a bullet marker — pptxgenjs starts a new bullet paragraph at any
          // run carrying one, so an item with mixed markup (e.g. "**Label**: description") would otherwise
          // render as two separate bullets, one per inline-markup span, regardless of breakLine.
          ...(i === 0 ? { bullet: { characterCode: "2022" } } : {}),
          indentLevel: item.level,
          breakLine: i === list.length - 1,
        },
      });
    });
  });
  return runs;
}

export const createPptxTool: ToolSpec = {
  mutating: true,
  definition: {
    type: "function",
    function: {
      name: "create_pptx",
      description:
        "Create a well-formatted PowerPoint (.pptx) presentation from a list of slides. `slides` must contain " +
        "the actual content the user asked for — never call this with empty or placeholder slides. Bullet text " +
        "supports inline markup: **bold**, _italic_, __underline__, ~~strikethrough~~. Defaults to a dark, " +
        "restrained professional theme (near-black background, muted body text, bordered-card content panels, " +
        "a rotating color-coded badge per numbered item) — this is the deck's default look now, not a rare " +
        "flourish, so lean into `cover`/`cards`/`kicker` rather than defaulting every slide to plain bullets. " +
        "Actively prefer the richer content types over plain bullets when the content calls for them: comparative " +
        "or trend data → `chart`; a structured multi-column dataset → `table` (with `widths`/`highlightRows` when " +
        "there's an obvious total/key row); a sequence of steps/phases → layout='timeline'; a handful of headline " +
        "numbers → layout='stats'. 'Slide with 5 bullet points about X' is rarely the best answer to a request " +
        "for real data or a process — reach for one of these instead.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Output path relative to the working directory, ending in .pptx" },
          accentColor: { type: "string", description: "Optional hex color used for the title accent bar and section-divider backgrounds, instead of the default teal." },
          docTitle: { type: "string", description: "Short deck name shown at the bottom-left of every content slide's footer (e.g. the company/product name)." },
          footerText: { type: "string", description: "Short subtitle shown centered in every content slide's footer (e.g. 'Orchestration layer for AI hosting')." },
          theme: {
            type: "string",
            enum: ["dark", "light"],
            description: "'dark' (default): the near-black professional theme. 'light': the classic white-background look.",
          },
          slides: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                kicker: {
                  type: "string",
                  description:
                    "Optional short uppercase eyebrow label shown above the title (e.g. 'THE PROBLEM', 'MODEL FREEDOM') — " +
                    "use this on most slides in the default theme, it's a core part of the look, not decoration.",
                },
                icon: {
                  type: "string",
                  enum: Object.keys(ICON_GLYPHS),
                  description: "Optional icon badge shown next to the title (or above it, for layout='section') in a small accent-colored circle.",
                },
                layout: {
                  type: "string",
                  enum: ["title_bullets", "section", "two_column", "cover", "cards", "stats", "timeline"],
                  description:
                    "'title_bullets' (default): title + bullet list. 'section': a large centered title on an " +
                    "accent-colored background, for dividing the deck into sections. 'two_column': title + two " +
                    "side-by-side bullet lists (use with `columns`). 'cover': a deck-opening slide with tag pills, " +
                    "a big title, subtitle, description, and a row of small stat labels (use with `tags`/`subtitle`/" +
                    "`description`/`stats`) — also fits a closing/CTA slide. 'cards': a row or stack of numbered, " +
                    "color-badged bordered boxes for enumerated points, options, or process steps (use with `cards`), " +
                    "optionally paired with a `sidebar` callout panel. 'stats': a small number (2-5) of headline " +
                    "figures shown as large callout boxes filling the slide — use for a handful of key metrics " +
                    "(use with `stats`), a much bigger/bolder treatment than cover's compact stat row. 'timeline': " +
                    "numbered steps connected by a horizontal line, for a process/sequence/roadmap (use with `steps`) " +
                    "— prefer this over `cards` when the points are genuinely ordered/sequential, not just enumerated.",
                },
                bullets: {
                  type: "array",
                  description:
                    "Bullet items (layout=title_bullets). Each is a string, {text, level} to nest as a sub-bullet, or " +
                    "{title, caption} to render as a bold title with a muted caption line beneath a colored dot — good " +
                    "for a short closing/CTA list of next steps.",
                  items: {},
                },
                columns: {
                  type: "array",
                  description: "Exactly two arrays of bullet strings, side by side (layout=two_column only).",
                  items: { type: "array", items: { type: "string" } },
                },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  description: "Short pill-badge labels shown in a row above the title (layout=cover only), e.g. ['Local-first', 'Proprietary', '2026'].",
                },
                subtitle: { type: "string", description: "A one-line statement shown just below the title (layout=cover only)." },
                description: { type: "string", description: "A short paragraph shown below the subtitle (layout=cover only)." },
                stats: {
                  type: "array",
                  description: "Small bordered label/caption boxes shown in a row (layout=cover: a compact strip; layout=stats: large callouts filling the slide), e.g. {label: '6-STATE', caption: 'verification engine'}.",
                  items: {
                    type: "object",
                    properties: { label: { type: "string" }, caption: { type: "string" } },
                  },
                },
                steps: {
                  type: "array",
                  description: "Numbered steps connected by a line, left to right (layout=timeline only). Each is {icon?, label, caption?} — `icon` is optional and uses the same vocabulary as the slide-level `icon` field.",
                  items: {
                    type: "object",
                    properties: {
                      icon: { type: "string", enum: Object.keys(ICON_GLYPHS) },
                      label: { type: "string" },
                      caption: { type: "string" },
                    },
                  },
                },
                cards: {
                  type: "array",
                  description: "Numbered, color-badged bordered boxes (layout=cards only). Each is {number, heading, text} — `number` can be a plain integer (colored circle badge) or a zero-padded string like '01'.",
                  items: {
                    type: "object",
                    properties: {
                      number: {},
                      heading: { type: "string" },
                      text: { type: "string" },
                    },
                  },
                },
                cardLayout: {
                  type: "string",
                  enum: ["row", "stack"],
                  description: "'row' (default when cards are short, e.g. process steps): equal-width boxes side by side. 'stack' (default when cards have longer body text): full-width boxes stacked vertically. Layout=cards only.",
                },
                sidebar: {
                  type: "object",
                  description: "An optional bordered callout panel on the right side of a 'cards' or 'table' slide.",
                  properties: {
                    kicker: { type: "string" },
                    title: { type: "string" },
                    text: { type: "string" },
                    quote: { type: "string", description: "Optional italic pull-quote shown below `text`." },
                  },
                },
                image: {
                  type: "object",
                  description: "An image to place on this slide, below the title (overrides layout/bullets for this slide).",
                  properties: {
                    path: { type: "string", description: "Path to an image file, relative to the working directory." },
                    caption: { type: "string", description: "Optional caption shown centered below the image." },
                    width: { type: "number", description: "Width in inches — height is derived from the real aspect ratio if omitted." },
                    height: { type: "number", description: "Height in inches, overriding the aspect-derived value." },
                  },
                },
                table: {
                  type: "object",
                  description: "A table to place on this slide, below the title (overrides layout/bullets for this slide, unless layout='cards' with no `cards` given, in which case `sidebar` still applies).",
                  properties: {
                    headers: { type: "array", items: { type: "string" } },
                    rows: { type: "array", items: { type: "array", items: {} } },
                    widths: {
                      type: "array",
                      items: { type: "number" },
                      description: "Optional per-column width in inches, one entry per column (must sum to roughly the table's available width — 9in, or 5.6in if `sidebar` is also set). Omit to split columns evenly.",
                    },
                    highlightRows: {
                      type: "array",
                      items: { type: "number" },
                      description: "Optional 0-indexed row numbers (into `rows`) to highlight with an accent-tinted fill instead of the normal alternating stripe — use for a 'Total' or key-finding row.",
                    },
                  },
                },
                chart: {
                  type: "object",
                  description: "A native, PowerPoint-editable chart to place on this slide, below the title (overrides layout/bullets for this slide; can be paired with `sidebar`). Prefer this over a table or bullets whenever the content is comparative or trend data.",
                  properties: {
                    type: { type: "string", enum: ["bar", "line", "pie", "doughnut"], description: "'bar'/'line' for comparisons or trends across categories. 'pie'/'doughnut' for a part-to-whole breakdown — keep series to one for these two types." },
                    categories: { type: "array", items: { type: "string" }, description: "The x-axis / slice labels, e.g. ['2023', '2024', '2025']." },
                    series: {
                      type: "array",
                      description: "One or more data series, each with one value per category. Use exactly one series for 'pie'/'doughnut'.",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          values: { type: "array", items: { type: "number" } },
                        },
                      },
                    },
                    title: { type: "string", description: "Optional chart title shown above the plot area." },
                  },
                },
                notes: { type: "string", description: "Speaker notes for this slide." },
              },
            },
          },
        },
        required: ["path", "slides"],
      },
    },
  },
  describe: (args) => `create ${args.path}`,
  preview: async (args) => `New PowerPoint presentation: ${args.path}\n${(args.slides ?? []).length} slide(s)`,
  run: async (args, ctx) => {
    const emptyCheck = checkPptxHasContent(args.slides);
    if (emptyCheck) return { ok: false, output: emptyCheck };
    const sizeCheck = checkPptxSizeThreshold(args.slides);
    if (sizeCheck) return { ok: false, output: sizeCheck };

    const quality = checkPptxQuality(args.slides ?? []);
    if (!quality.ok) {
      const output = quality.blocking.join("\n");
      return { ok: false, output, qualityGate: { name: "pptx quality gate", ok: false, output } };
    }

    const accent = optionalHexColor(args.accentColor) ?? PPTX_BADGE_COLORS[0];
    const isDark = args.theme !== "light";
    const bgColor = isDark ? PPTX_DARK_BG : "FFFFFF";
    const titleColor = isDark ? PPTX_DARK_TITLE_TEXT : TEXT_HEX;
    const bodyColor = isDark ? PPTX_DARK_BODY_TEXT : "374151";
    const zebraColor = isDark ? PPTX_CARD_BG : PPTX_LIGHT_ZEBRA;
    const captionColor = isDark ? PPTX_MUTED_TEXT : "6B7280";
    const cardBg = isDark ? PPTX_CARD_BG : "F8FAFC";
    const cardBorder = isDark ? PPTX_CARD_BORDER : "E2E8F0";
    const mutedColor = isDark ? PPTX_MUTED_TEXT : "6B7280";
    const footerColor = isDark ? PPTX_FOOTER_TEXT : "9CA3AF";
    // A sidebar/callout panel and a numbered-badge circle are each a visually distinct shade from a
    // plain content card, not a reuse of cardBg/cardBorder/accent — see the constants' own doc comment.
    const sidebarBg = isDark ? PPTX_SIDEBAR_BG : "F0F9F8";
    const sidebarBorder = isDark ? PPTX_SIDEBAR_BORDER : accent;
    const badgeBg = isDark ? PPTX_SIDEBAR_BG : "FFFFFF";

    // Shared content-area geometry (10x5.625in slide) — a slide with a kicker/footer needs the same
    // top/bottom margins regardless of which layout renders the body, so every mode below anchors to
    // these instead of each choosing its own y-coordinates.
    const CONTENT_Y = 1.4;
    const CONTENT_BOTTOM = 4.95;
    const FOOTER_Y = 5.18;

    const filePath = resolveInRoot(ctx.root, args.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const pres = new PptxGenJS();
    const bodyBase: PptxTextBase = { fontFace: BODY_FONT, fontSize: 16, color: bodyColor };

    /** A small emoji glyph centered in a colored circle — the deck's default icon motif. `onAccentBg`
     *  inverts the badge (white circle, accent glyph) for section slides, whose background is already
     *  the accent color — an accent-on-accent circle would otherwise be invisible, leaving only the
     *  glyph floating with no visible badge. */
    function addIconBadge(slide: PptxGenJS.Slide, icon: unknown, x: number, y: number, diameterIn: number, onAccentBg = false): void {
      const glyph = typeof icon === "string" ? ICON_GLYPHS[icon] : undefined;
      if (!glyph) return;
      const circleColor = onAccentBg ? "FFFFFF" : accent;
      const glyphColor = onAccentBg ? accent : "FFFFFF";
      slide.addShape(pres.ShapeType.ellipse, { x, y, w: diameterIn, h: diameterIn, fill: { color: circleColor }, line: { type: "none" } });
      slide.addText(glyph, {
        x,
        y,
        w: diameterIn,
        h: diameterIn,
        align: "center",
        valign: "middle",
        fontSize: Math.round(diameterIn * 20),
        color: glyphColor,
        margin: 0,
      });
    }

    /** Rough estimate of wrapped line count for a plain-text box — good enough to size a text box tall
     *  enough that PowerPoint's own wrapping never overflows past it (real layout isn't available here,
     *  so this deliberately over-estimates height slightly rather than risk overlapping the next element). */
    function estimateWrappedLines(text: string, widthIn: number, fontSizePt: number): number {
      const avgCharWidthIn = fontSizePt * 0.0092;
      const charsPerLine = Math.max(6, Math.floor(widthIn / avgCharWidthIn));
      const rawLines = text.split("\n");
      return rawLines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
    }

    /** Total estimated height (in) `text` + `quote` would need at a given base font size, so a shrink-
     *  to-fit loop can search for the largest size that actually fits the space left after the kicker/
     *  title — sizing the box correctly doesn't help if the font itself is too large to fit its own
     *  text in the available width/height at that size, the way a fixed font size does. */
    function estimateTextQuoteHeight(text: string, quote: string, widthIn: number, fontSize: number): number {
      const textLines = text ? estimateWrappedLines(text, widthIn, fontSize) : 0;
      const quoteLines = quote ? estimateWrappedLines(quote, widthIn, fontSize - 1) : 0;
      const gapBetween = text && quote ? 0.16 : 0;
      return textLines * fontSize * 0.0187 + quoteLines * (fontSize - 1) * 0.0187 + gapBetween;
    }

    /** A bordered callout panel — the "sidebar" pattern paired with a `cards` or `table` slide: a
     *  kicker, a bold statement, body copy, and an optional italic pull-quote. The kicker/title are
     *  placed from an estimate of their own wrapped line count (never a fixed guessed offset), and the
     *  body/quote font size shrinks in a small loop until what's left of the panel can actually hold
     *  them — sizing the *box* correctly (the earlier fix) doesn't help if the *font* is too large to
     *  fit its own text in the remaining space at a fixed size. */
    function addSidebar(slide: PptxGenJS.Slide, sidebar: any, x: number, y: number, w: number, h: number): void {
      slide.addShape("roundRect", { x, y, w, h, rectRadius: 0.05, fill: { color: sidebarBg }, line: { color: sidebarBorder, width: 1 } });
      const innerX = x + 0.28;
      const innerW = w - 0.56;
      let cy = y + 0.26;

      if (sidebar.kicker) {
        slide.addText(String(sidebar.kicker).toUpperCase(), {
          x: innerX, y: cy, w: innerW, h: 0.28, fontFace: BODY_FONT, fontSize: 12, bold: true, color: accent, charSpacing: 2,
        });
        cy += 0.36;
      }
      if (sidebar.title) {
        const titleH = estimateWrappedLines(String(sidebar.title), innerW, 18) * 0.34;
        slide.addText(String(sidebar.title), {
          x: innerX, y: cy, w: innerW, h: titleH, fontFace: BODY_FONT, fontSize: 18, bold: true, color: titleColor, valign: "top",
        });
        cy += titleH + 0.16;
      }
      const text = sidebar.text ? String(sidebar.text) : "";
      const quote = sidebar.quote ? String(sidebar.quote) : "";
      if (text || quote) {
        const available = Math.max(0.35, y + h - cy - 0.22);
        let fontSize = 12.5;
        while (fontSize > 9 && estimateTextQuoteHeight(text, quote, innerW, fontSize) > available) fontSize -= 0.5;

        if (text) {
          const textH = estimateWrappedLines(text, innerW, fontSize) * fontSize * 0.0187;
          slide.addText(pptxRuns(text, { fontFace: BODY_FONT, fontSize, color: mutedColor }), {
            x: innerX, y: cy, w: innerW, h: textH, valign: "top", lineSpacingMultiple: 1.3,
          });
          cy += textH + (quote ? 0.16 : 0);
        }
        if (quote) {
          const quoteFontSize = fontSize - 1;
          // Sized from the quote's own estimated line count (like textH above), not from whatever space
          // happens to be left in the panel — a box sized to "leftover space" can be smaller than what
          // the text actually needs and overflow it, even when the shrink-to-fit loop above chose a
          // font size meant to make the total fit.
          const quoteH = Math.max(0.3, estimateWrappedLines(quote, innerW, quoteFontSize) * quoteFontSize * 0.0187);
          // The pull-quote renders in the bright title color, not the muted body tone — a deliberate
          // emphasis choice in the reference deck, confirmed directly from its own XML.
          slide.addText(pptxRuns(quote, { fontFace: BODY_FONT, fontSize: quoteFontSize, color: titleColor }), {
            x: innerX, y: cy, w: innerW, h: quoteH, valign: "top", italic: true, lineSpacingMultiple: 1.3,
          });
        }
      }
    }

    /** Bullet items shaped as {title, caption} (not {text, level}) — the closing/CTA "next steps" list
     *  pattern: a colored dot, a bold title, and a muted caption line beneath it. */
    function isDotListItems(bullets: any[]): boolean {
      return bullets.length > 0 && bullets.every((b) => b && typeof b === "object" && !Array.isArray(b) && typeof b.title === "string");
    }

    function renderDotList(slide: PptxGenJS.Slide, items: any[], x: number, y: number, w: number): void {
      let cy = y;
      for (const item of items) {
        const rowH = item.caption ? 0.72 : 0.45;
        slide.addShape("ellipse", { x, y: cy + 0.08, w: 0.16, h: 0.16, fill: { color: accent }, line: { type: "none" } });
        slide.addText(String(item.title ?? ""), { x: x + 0.32, y: cy, w: w - 0.32, h: 0.35, fontFace: BODY_FONT, fontSize: 15, bold: true, color: titleColor });
        if (item.caption) {
          slide.addText(String(item.caption), { x: x + 0.32, y: cy + 0.33, w: w - 0.32, h: 0.3, fontFace: BODY_FONT, fontSize: 11.5, color: mutedColor });
        }
        cy += rowH;
      }
    }

    /** Bordered label/caption boxes in a row — `"compact"` reproduces the cover layout's original
     *  bottom-strip treatment exactly (unchanged geometry); `"large"` is the standalone `stats`
     *  layout's bigger, slide-filling treatment. */
    function renderStatsRow(slide: PptxGenJS.Slide, stats: any[], x: number, y: number, w: number, h: number, size: "compact" | "large"): void {
      if (!stats.length) return;
      const gap = size === "large" ? 0.2 : 0.16;
      const boxW = (w - gap * (stats.length - 1)) / stats.length;
      const boxH = size === "large" ? h : 0.78;
      const labelSize = size === "large" ? 15 : 12.5;
      const captionSize = size === "large" ? 12.5 : 10;
      const flagW = size === "large" ? 0.06 : 0.045;
      stats.forEach((s, i) => {
        const sx = x + i * (boxW + gap);
        slide.addShape("rect", { x: sx, y, w: boxW, h: boxH, fill: { color: cardBg }, line: { color: cardBorder, width: 0.75 } });
        slide.addShape("rect", { x: sx, y, w: flagW, h: boxH, fill: { color: accent }, line: { type: "none" } });
        const labelY = size === "large" ? y + boxH * 0.32 : y + 0.1;
        slide.addText(String(s?.label ?? "").toUpperCase(), {
          x: sx + 0.2, y: labelY, w: boxW - 0.32, h: 0.4, fontFace: BODY_FONT, fontSize: labelSize, bold: true, color: accent, valign: "top",
        });
        slide.addText(String(s?.caption ?? ""), {
          x: sx + 0.2, y: labelY + 0.4, w: boxW - 0.32, h: boxH - (labelY - y) - 0.4, fontFace: BODY_FONT, fontSize: captionSize, color: mutedColor, valign: "top",
        });
      });
    }

    /** Numbered badge circles connected by a horizontal line — a process/sequence flow, distinct from
     *  `cards`' freestanding boxes on purpose (no card background is drawn here). */
    function renderTimeline(slide: PptxGenJS.Slide, steps: any[], x: number, y: number, w: number, h: number): void {
      if (!steps.length) return;
      const gap = 0.16;
      const colW = (w - gap * (steps.length - 1)) / steps.length;
      const badgeD = 0.56;
      const badgeCy = y + badgeD / 2;
      // Connector drawn first so each badge circle visually sits on top of the line at both ends.
      if (steps.length > 1) {
        const lineY = y + badgeD / 2;
        const fromX = x + colW / 2;
        const toX = x + (steps.length - 1) * (colW + gap) + colW / 2;
        slide.addShape("line", { x: fromX, y: lineY, w: toX - fromX, h: 0, line: { color: cardBorder, width: 1.5 } });
      }
      steps.forEach((s, i) => {
        const cx = x + i * (colW + gap);
        const badgeColor = PPTX_BADGE_COLORS[i % PPTX_BADGE_COLORS.length];
        const badgeX = cx + (colW - badgeD) / 2;
        slide.addShape("ellipse", { x: badgeX, y, w: badgeD, h: badgeD, fill: { color: badgeBg }, line: { color: badgeColor, width: 1.5 } });
        const glyph = typeof s?.icon === "string" ? ICON_GLYPHS[s.icon] : undefined;
        slide.addText(glyph ?? String(i + 1), {
          x: badgeX, y, w: badgeD, h: badgeD, align: "center", valign: "middle", fontFace: BODY_FONT, fontSize: glyph ? 18 : 15, bold: true, color: badgeColor,
        });
        slide.addText(String(s?.label ?? ""), {
          x: cx, y: badgeCy + badgeD / 2 + 0.14, w: colW, h: 0.4, align: "center", fontFace: BODY_FONT, fontSize: 13.5, bold: true, color: titleColor,
        });
        if (s?.caption) {
          slide.addText(String(s.caption), {
            x: cx, y: badgeCy + badgeD / 2 + 0.5, w: colW, h: h - (badgeCy + badgeD / 2 + 0.5 - y), align: "center", valign: "top", fontFace: BODY_FONT, fontSize: 11, color: mutedColor,
          });
        }
      });
    }

    for (let slideIdx = 0; slideIdx < (args.slides ?? []).length; slideIdx++) {
      const spec = (args.slides ?? [])[slideIdx];
      const slide = pres.addSlide();
      slide.background = { color: bgColor };

      const mode =
        spec.layout === "section"
          ? "section"
          : spec.layout === "cover"
          ? "cover"
          : spec.layout === "cards"
          ? "cards"
          : spec.layout === "stats"
          ? "stats"
          : spec.layout === "timeline"
          ? "timeline"
          : spec.image
          ? "image"
          : spec.chart
          ? "chart"
          : spec.table
          ? "table"
          : spec.layout === "two_column"
          ? "two_column"
          : "title_bullets";

      if (mode === "section") {
        slide.background = { color: accent };
        if (spec.icon) addIconBadge(slide, spec.icon, 4.55, 1.3, 0.9, true);
        slide.addText(String(spec.title ?? ""), {
          x: 0.5,
          y: 2.2,
          w: 9,
          h: 1.2,
          align: "center",
          fontFace: BODY_FONT,
          fontSize: 36,
          bold: true,
          color: "FFFFFF",
        });
        if (spec.notes) slide.addNotes(String(spec.notes));
        continue;
      }

      if (mode === "cover") {
        const tags: any[] = Array.isArray(spec.tags) ? spec.tags : [];
        let coverCy = 0.5;
        if (tags.length) {
          const tagText = tags.map((t) => String(t).toUpperCase()).join("   ·   ");
          const pillW = Math.min(9, 0.5 + tagText.length * 0.078);
          slide.addShape("roundRect", { x: 0.5, y: coverCy, w: pillW, h: 0.48, rectRadius: 0.24, fill: { color: bgColor }, line: { color: accent, width: 1 } });
          slide.addText(tagText, { x: 0.65, y: coverCy, w: pillW - 0.3, h: 0.48, valign: "middle", fontFace: BODY_FONT, fontSize: 11.5, bold: true, color: accent, charSpacing: 2 });
          coverCy += 0.7;
        }
        coverCy = Math.max(coverCy, 1.4);
        // Title through description flow top-down from each other's estimated (not guessed-fixed)
        // height, same reasoning as the title/content-area fix above — a longer real title or subtitle
        // must push what follows down instead of sitting on top of it.
        if (spec.title) {
          const lines = estimateWrappedLines(String(spec.title), 9, 44);
          const h = Math.max(0.6, lines * 0.62);
          slide.addText(String(spec.title), { x: 0.5, y: coverCy, w: 9, h, fontFace: BODY_FONT, fontSize: 44, bold: true, color: titleColor, valign: "top" });
          coverCy += h + 0.12;
        }
        if (spec.subtitle) {
          const lines = estimateWrappedLines(String(spec.subtitle), 9, 17);
          const h = Math.max(0.4, lines * 0.32);
          slide.addText(pptxRuns(String(spec.subtitle), { fontFace: BODY_FONT, fontSize: 17, color: mutedColor }), { x: 0.5, y: coverCy, w: 9, h, valign: "top" });
          coverCy += h + 0.15;
        }
        if (spec.description) {
          const lines = estimateWrappedLines(String(spec.description), 9, 12.5);
          const h = Math.max(0.35, lines * 0.24 * 1.3);
          slide.addText(pptxRuns(String(spec.description), { fontFace: BODY_FONT, fontSize: 12.5, color: mutedColor }), {
            x: 0.5, y: coverCy, w: 9, h, valign: "top", lineSpacingMultiple: 1.3,
          });
          coverCy += h + 0.3;
        }
        const bottomY = Math.max(coverCy, 4.3);
        const bulletsAsDots = Array.isArray(spec.bullets) ? spec.bullets : [];
        if (isDotListItems(bulletsAsDots)) {
          renderDotList(slide, bulletsAsDots, 0.5, bottomY, 9);
        } else {
          const stats: any[] = Array.isArray(spec.stats) ? spec.stats : [];
          renderStatsRow(slide, stats, 0.5, bottomY, 9, 0.78, "compact");
        }
        if (spec.notes) slide.addNotes(String(spec.notes));
        continue;
      }

      // No decorative accent stripe/underline under the title itself on purpose — a repeated geometric
      // flourish under every title is one of the most recognizable tells of an AI-generated deck. The
      // kicker label and per-card badge colors below do real work instead of existing purely as decoration.
      const hasIcon = !!spec.icon && ICON_GLYPHS[spec.icon];
      const hasKicker = typeof spec.kicker === "string" && spec.kicker.trim().length > 0;
      if (hasKicker) {
        slide.addText(String(spec.kicker).toUpperCase(), {
          x: hasIcon ? 1.3 : 0.5, y: 0.2, w: 8, h: 0.28, fontFace: BODY_FONT, fontSize: 12, bold: true, color: accent, charSpacing: 2,
        });
      }
      if (hasIcon) addIconBadge(slide, spec.icon, 0.5, 0.35, 0.62);
      // Title box height (and the content area below it) is sized from the title's own line count —
      // a fixed single-line-height box would let a wrapped 2-line title overflow straight into the
      // content below it rather than making room, since PowerPoint doesn't auto-shrink text that
      // wasn't laid out through its own editor.
      const titleY = hasKicker ? 0.55 : 0.35;
      const titleLineCount = spec.title ? estimateWrappedLines(String(spec.title), hasIcon ? 8.2 : 9, 32) : 0;
      const titleH = Math.max(0.55, titleLineCount * 0.46);
      const contentY = Math.max(CONTENT_Y, titleY + titleH + 0.12);
      if (spec.title) {
        slide.addText(String(spec.title), {
          x: hasIcon ? 1.3 : 0.5,
          y: titleY,
          w: hasIcon ? 8.2 : 9,
          h: titleH,
          fontFace: BODY_FONT,
          fontSize: 32,
          bold: true,
          color: titleColor,
          valign: "top",
        });
      }

      if (mode === "stats") {
        const stats: any[] = Array.isArray(spec.stats) ? spec.stats : [];
        renderStatsRow(slide, stats, 0.5, contentY, 9, CONTENT_BOTTOM - contentY, "large");
      } else if (mode === "timeline") {
        const steps: any[] = Array.isArray(spec.steps) ? spec.steps : [];
        renderTimeline(slide, steps, 0.5, contentY, 9, CONTENT_BOTTOM - contentY);
      } else if (mode === "image") {
        const loaded = loadImageFile(ctx.root, String(spec.image.path ?? ""), MAX_IMAGE_BYTES);
        if ("error" in loaded) return { ok: false, output: loaded.error };
        const y = contentY;
        // Slide is 5.625in tall; a portrait screenshot sized only by width would otherwise derive a height that
        // runs off the bottom edge — cap it to whatever room is actually left below the title, minus space for
        // the caption (if any) plus a bottom margin.
        const maxHeightIn = CONTENT_BOTTOM - y - (spec.image.caption ? 0.4 : 0.1);
        const { widthIn, heightIn } = fitImageBox(loaded.intrinsic, 8, spec.image.width, spec.image.height, maxHeightIn);
        const x = Math.max(0.5, (10 - widthIn) / 2);
        slide.addImage({ data: `data:image/${loaded.type};base64,${loaded.buffer.toString("base64")}`, x, y, w: widthIn, h: heightIn });
        if (spec.image.caption) {
          slide.addText(pptxRuns(String(spec.image.caption), { fontFace: BODY_FONT, fontSize: 13, color: captionColor }), {
            x: 0.5,
            y: Math.min(y + heightIn + 0.15, CONTENT_BOTTOM),
            w: 9,
            h: 0.35,
            align: "center",
          });
        }
      } else if (mode === "chart") {
        const chartSpec = spec.chart ?? {};
        const chartType: "bar" | "line" | "pie" | "doughnut" = chartSpec.type === "line" || chartSpec.type === "pie" || chartSpec.type === "doughnut" ? chartSpec.type : "bar";
        const categories: string[] = Array.isArray(chartSpec.categories) ? chartSpec.categories.map((c: any) => String(c)) : [];
        const seriesArr: any[] = Array.isArray(chartSpec.series) ? chartSpec.series : [];
        const chartData: PptxGenJS.OptsChartData[] = seriesArr.map((s) => ({
          name: String(s?.name ?? ""),
          labels: categories,
          values: (Array.isArray(s?.values) ? s.values : []).map((v: any) => Number(v) || 0),
        }));
        const hasSidebar = spec.sidebar && typeof spec.sidebar === "object";
        const chartW = hasSidebar ? 5.6 : 9;
        const isCircular = chartType === "pie" || chartType === "doughnut";
        const circularOptions: Partial<PptxGenJS.IChartOpts> = {
          showLegend: true,
          legendPos: "r",
          legendColor: mutedColor,
          legendFontFace: BODY_FONT,
          showPercent: true,
          dataLabelColor: "FFFFFF",
          dataLabelFontFace: BODY_FONT,
        };
        const categoricalOptions: Partial<PptxGenJS.IChartOpts> = {
          showLegend: seriesArr.length > 1,
          legendPos: "b",
          legendColor: mutedColor,
          legendFontFace: BODY_FONT,
          showValue: true,
          dataLabelPosition: "outEnd",
          dataLabelColor: bodyColor,
          dataLabelFontFace: BODY_FONT,
          catAxisLabelColor: mutedColor,
          catAxisLabelFontFace: BODY_FONT,
          valAxisLabelColor: mutedColor,
          valAxisLabelFontFace: BODY_FONT,
          valGridLine: { color: cardBorder, size: 0.75 },
          catGridLine: { style: "none" },
        };
        if (chartData.length) {
          slide.addChart(pres.ChartType[chartType], chartData, {
            x: 0.5,
            y: contentY,
            w: chartW,
            h: CONTENT_BOTTOM - contentY,
            chartColors: [accent, ...PPTX_BADGE_COLORS],
            showTitle: !!chartSpec.title,
            title: chartSpec.title ? String(chartSpec.title) : undefined,
            titleColor,
            titleFontFace: BODY_FONT,
            ...(isCircular ? circularOptions : categoricalOptions),
          } as PptxGenJS.IChartOpts);
        }
        if (hasSidebar) addSidebar(slide, spec.sidebar, 0.5 + chartW + 0.2, contentY, 9 - chartW - 0.2, CONTENT_BOTTOM - contentY);
      } else if (mode === "table") {
        const hasSidebar = spec.sidebar && typeof spec.sidebar === "object";
        const tableW = hasSidebar ? 5.6 : 9;
        const headers: any[] = spec.table.headers ?? [];
        const rows: any[][] = spec.table.rows ?? [];
        const highlightRows: number[] = Array.isArray(spec.table.highlightRows) ? spec.table.highlightRows.map((n: any) => Number(n)) : [];
        const highlightFill = isDark ? darkenHex(accent, 0.75) : lightenHex(accent, 0.75);
        const colW: number[] | undefined = Array.isArray(spec.table.widths) && spec.table.widths.length === headers.length
          ? spec.table.widths.map((n: any) => Number(n) || tableW / headers.length)
          : undefined;
        const tableRows: PptxGenJS.TableRow[] = [];
        if (headers.length) {
          tableRows.push(
            headers.map((h) => {
              // Unlike addText, pptxgenjs table cells take a plain string with one set of options for the
              // whole cell — there's no per-run styling within a cell. Strip markup delimiters so a model's
              // "**Total**" doesn't show as literal asterisks; the header row is already bold regardless.
              const flat = flattenCellMarkup(normalizeCell(h).text);
              return {
                text: isDark ? flat.text.toUpperCase() : flat.text,
                options: {
                  bold: true,
                  fontSize: 13.5,
                  color: isDark ? accent : "FFFFFF",
                  fill: { color: isDark ? cardBg : accent },
                  align: (normalizeCell(h).align as any) ?? "left",
                },
              };
            })
          );
        }
        rows.forEach((row, i) => {
          const highlighted = highlightRows.includes(i);
          tableRows.push(
            row.map((cellVal) => {
              const cell = normalizeCell(cellVal);
              const flat = flattenCellMarkup(cell.text);
              return {
                text: flat.text,
                options: {
                  // A cell can't be partially bold here, so a bold span anywhere in the text promotes the
                  // whole cell — closer to what the model intended than showing raw "**" characters.
                  bold: highlighted || cell.bold || flat.anyBold || undefined,
                  fontSize: 13,
                  color: bodyColor,
                  fill: { color: highlighted ? highlightFill : i % 2 === 1 ? zebraColor : bgColor },
                  align: (cell.align as any) ?? "left",
                },
              };
            })
          );
        });
        if (tableRows.length) {
          slide.addTable(tableRows, {
            x: 0.5,
            y: contentY,
            w: tableW,
            colW,
            fontFace: BODY_FONT,
            border: { type: "solid", color: cardBorder, pt: 0.5 },
          });
        }
        if (hasSidebar) addSidebar(slide, spec.sidebar, 0.5 + tableW + 0.2, contentY, 9 - tableW - 0.2, CONTENT_BOTTOM - contentY);
      } else if (mode === "cards") {
        const cardsArr: any[] = Array.isArray(spec.cards) ? spec.cards : [];
        const hasSidebar = spec.sidebar && typeof spec.sidebar === "object";
        const areaX = 0.5;
        const areaW = hasSidebar ? 5.6 : 9;
        const cardLayout: "row" | "stack" =
          spec.cardLayout === "row" || spec.cardLayout === "stack"
            ? spec.cardLayout
            : cardsArr.length <= 4 && cardsArr.every((c) => String(c?.text ?? "").length < 140)
            ? "row"
            : "stack";

        if (cardLayout === "row" && cardsArr.length) {
          const gap = 0.16;
          const cw = (areaW - gap * (cardsArr.length - 1)) / cardsArr.length;
          const ch = CONTENT_BOTTOM - contentY;
          cardsArr.forEach((c, i) => {
            const cx = areaX + i * (cw + gap);
            const badgeColor = PPTX_BADGE_COLORS[i % PPTX_BADGE_COLORS.length];
            slide.addShape("roundRect", { x: cx, y: contentY, w: cw, h: ch, rectRadius: 0.05, fill: { color: cardBg }, line: { color: cardBorder, width: 0.75 } });
            slide.addShape("ellipse", { x: cx + 0.18, y: contentY + 0.18, w: 0.48, h: 0.48, fill: { color: badgeBg }, line: { color: badgeColor, width: 1.5 } });
            slide.addText(String(c?.number ?? i + 1), {
              x: cx + 0.18, y: contentY + 0.18, w: 0.48, h: 0.48, align: "center", valign: "middle", fontFace: BODY_FONT, fontSize: 14, bold: true, color: badgeColor,
            });
            slide.addText(String(c?.heading ?? "").toUpperCase(), {
              x: cx + 0.18, y: contentY + 0.78, w: cw - 0.36, h: 0.35, fontFace: BODY_FONT, fontSize: 13, bold: true, color: badgeColor, charSpacing: 0.5,
            });
            slide.addText(pptxRuns(String(c?.text ?? ""), { fontFace: BODY_FONT, fontSize: 11.5, color: mutedColor }), {
              x: cx + 0.18, y: contentY + 1.22, w: cw - 0.36, h: ch - 1.38, valign: "top", lineSpacingMultiple: 1.25,
            });
          });
        } else if (cardsArr.length) {
          // Each card's natural height is derived from its own heading+body line count (same flowing
          // approach as addSidebar) rather than a fixed equal split — a rigid equal split let a card
          // with more text than its siblings overflow past its own box. If the natural total is taller
          // than the space actually available, every card (and the gap between them) is scaled down
          // proportionally so the whole stack still ends exactly at CONTENT_BOTTOM instead of the last
          // card or two running off the bottom of the slide.
          const rawGap = 0.14;
          const textW = areaW - 1.1;
          const rawHeights = cardsArr.map((c) => {
            const headingLines = estimateWrappedLines(String(c?.heading ?? ""), textW, 14.5);
            const textLines = estimateWrappedLines(String(c?.text ?? ""), textW, 11.5);
            return Math.max(0.9, 0.22 + headingLines * 0.26 + 0.12 + textLines * 0.24 * 1.25 + 0.2);
          });
          const available = CONTENT_BOTTOM - contentY;
          const rawTotal = rawHeights.reduce((sum, h) => sum + h, 0) + rawGap * (cardsArr.length - 1);
          const scale = rawTotal > available ? available / rawTotal : 1;
          const heights = rawHeights.map((h) => h * scale);
          const gap = rawGap * scale;

          // A fixed badge diameter regardless of scale — deriving it from the (possibly quite small,
          // post-scale) card height produced degenerate near-zero circles that clipped their own number.
          const badgeD = Math.min(0.5, Math.max(0.3, rawHeights.length ? Math.min(...heights) - 0.15 : 0.5));
          let cy = contentY;
          cardsArr.forEach((c, i) => {
            const chEach = heights[i];
            const badgeColor = PPTX_BADGE_COLORS[i % PPTX_BADGE_COLORS.length];
            const badgeCy = cy + (Math.min(chEach, 1.2) - badgeD) / 2;
            slide.addShape("roundRect", { x: areaX, y: cy, w: areaW, h: chEach, rectRadius: 0.05, fill: { color: cardBg }, line: { color: cardBorder, width: 0.75 } });
            slide.addShape("ellipse", { x: areaX + 0.2, y: badgeCy, w: badgeD, h: badgeD, fill: { color: badgeBg }, line: { color: badgeColor, width: 1.5 } });
            slide.addText(String(c?.number ?? i + 1), {
              x: areaX + 0.2, y: badgeCy, w: badgeD, h: badgeD, align: "center", valign: "middle", fontFace: BODY_FONT, fontSize: 13, bold: true, color: badgeColor,
            });
            slide.addText(String(c?.heading ?? ""), { x: areaX + 0.9, y: cy + 0.14 * scale, w: textW, h: 0.35, fontFace: BODY_FONT, fontSize: 14.5, bold: true, color: titleColor });
            slide.addText(pptxRuns(String(c?.text ?? ""), { fontFace: BODY_FONT, fontSize: 11.5, color: mutedColor }), {
              x: areaX + 0.9, y: cy + 0.5 * scale, w: textW, h: Math.max(0.2, chEach - 0.6 * scale), valign: "top", lineSpacingMultiple: 1.25,
            });
            cy += chEach + gap;
          });
        }
        if (hasSidebar) addSidebar(slide, spec.sidebar, areaX + areaW + 0.2, contentY, 9 - areaW - 0.2, CONTENT_BOTTOM - contentY);
      } else if (mode === "two_column") {
        const columns = Array.isArray(spec.columns) ? spec.columns : [[], []];
        const left = mergeColonContinuations((columns[0] ?? []).map(normalizeListItem));
        const right = mergeColonContinuations((columns[1] ?? []).map(normalizeListItem));
        const colH = CONTENT_BOTTOM - contentY;
        if (left.length) slide.addText(pptxBulletRuns(left, bodyBase), { x: 0.5, y: contentY, w: 4.3, h: colH, valign: "top" });
        if (right.length) slide.addText(pptxBulletRuns(right, bodyBase), { x: 5.2, y: contentY, w: 4.3, h: colH, valign: "top" });
      } else {
        const rawBullets: any[] = Array.isArray(spec.bullets) ? spec.bullets : [];
        if (isDotListItems(rawBullets)) {
          renderDotList(slide, rawBullets, 0.5, contentY + 0.15, 9);
        } else {
          const items = mergeColonContinuations(rawBullets.map(normalizeListItem));
          if (items.length) {
            slide.addText(pptxBulletRuns(items, bodyBase), { x: 0.5, y: contentY, w: 9, h: CONTENT_BOTTOM - contentY, valign: "top" });
          }
        }
      }

      // Footer chrome: doc name (left) / subtitle (center) / page N of Total (right) — matches the
      // reference deck's every-content-slide footer. Page numbers always show on content slides; the
      // name/subtitle only show if the caller actually provided them, so a deck that didn't opt in
      // doesn't get an unexplained label row.
      const totalContentSlides = (args.slides ?? []).filter((s: any) => s.layout !== "cover" && s.layout !== "section").length;
      const contentSlideIdx = (args.slides ?? []).slice(0, slideIdx + 1).filter((s: any) => s.layout !== "cover" && s.layout !== "section").length;
      if (args.docTitle) {
        slide.addText(String(args.docTitle), { x: 0.5, y: FOOTER_Y, w: 3, h: 0.28, fontFace: BODY_FONT, fontSize: 9.5, bold: true, color: footerColor });
      }
      if (args.footerText) {
        slide.addText(String(args.footerText).toUpperCase(), {
          x: 2.5, y: FOOTER_Y, w: 5, h: 0.28, align: "center", fontFace: BODY_FONT, fontSize: 9, color: footerColor, charSpacing: 1,
        });
      }
      slide.addText(`${contentSlideIdx} / ${totalContentSlides}`, { x: 8.7, y: FOOTER_Y, w: 0.8, h: 0.28, align: "right", fontFace: BODY_FONT, fontSize: 9.5, color: footerColor });

      if (spec.notes) slide.addNotes(String(spec.notes));
    }

    await pres.writeFile({ fileName: filePath });
    const stat = fs.statSync(filePath);

    const slideTitles = (args.slides ?? []).map((s: any, i: number) => String(s.title ?? "").trim() || `(slide ${i + 1}, no title)`);
    // Real slide titles, not just a count — see the matching comment in create_docx for why: this is
    // what the independent critic actually reads to judge quality against the stated intent.
    const structureSummary = `Slides: ${slideTitles.join(" | ")}`;
    const warningSuffix = quality.warnings.length ? `\nQuality notes: ${quality.warnings.join(" ")}` : "";

    return {
      ok: true,
      output: `Created ${args.path} (${(args.slides ?? []).length} slides, ${stat.size} bytes, ${isDark ? "dark" : "light"} theme). ${structureSummary}${warningSuffix}`,
      qualityGate: { name: "pptx quality gate", ok: true, output: quality.warnings.join("\n") },
    };
  },
};

function checkPptxHasContent(slides: any[] | undefined): string | null {
  if (!Array.isArray(slides) || slides.length === 0) {
    return "slides is empty — this would create a blank presentation. Write out real slides (title + bullets) " +
      "for the content the user asked for before calling this tool.";
  }
  const hasContent = slides.some(
    (s) =>
      (typeof s.title === "string" && s.title.trim().length > 0) ||
      (Array.isArray(s.bullets) &&
        s.bullets.some((b: any) => normalizeListItem(b).text.trim().length > 0 || (b && typeof b === "object" && String(b.title ?? "").trim().length > 0))) ||
      (s.image && typeof s.image.path === "string" && s.image.path.trim().length > 0) ||
      (s.table && ((Array.isArray(s.table.headers) && s.table.headers.length > 0) || (Array.isArray(s.table.rows) && s.table.rows.length > 0))) ||
      (s.chart && Array.isArray(s.chart.series) && s.chart.series.some((sr: any) => Array.isArray(sr?.values) && sr.values.length > 0)) ||
      (Array.isArray(s.columns) && s.columns.some((col: any) => Array.isArray(col) && col.length > 0)) ||
      (Array.isArray(s.tags) && s.tags.length > 0) ||
      (typeof s.subtitle === "string" && s.subtitle.trim().length > 0) ||
      (typeof s.description === "string" && s.description.trim().length > 0) ||
      (Array.isArray(s.stats) && s.stats.length > 0) ||
      (Array.isArray(s.cards) && s.cards.some((c: any) => String(c?.heading ?? "").trim().length > 0 || String(c?.text ?? "").trim().length > 0)) ||
      (Array.isArray(s.steps) && s.steps.some((st: any) => String(st?.label ?? "").trim().length > 0)) ||
      (s.sidebar && typeof s.sidebar === "object" && (s.sidebar.title || s.sidebar.text || s.sidebar.quote))
  );
  if (!hasContent) {
    return "Every slide is empty (no title, bullets, image, table, chart, columns, cover fields, cards, or steps) — " +
      "this would create a blank presentation. Fill in the actual content, then call this tool again.";
  }
  return null;
}

// ---------- Excel (.xlsx) ----------

/**
 * A cell value of "=SOME_FORMULA" becomes a live Excel formula instead of a literal string. Any other string
 * has markup delimiters stripped — Excel cells have no concept of an inline bold run within a value (unlike
 * docx/pptx), so a model reusing the **bold** convention it was taught for those would otherwise show the
 * literal asterisks in the spreadsheet instead of anything resembling emphasis.
 */
function toFormulaAwareCellValue(v: any): any {
  if (typeof v === "string" && v.startsWith("=") && v.length > 1) {
    return { formula: v.slice(1) };
  }
  if (typeof v === "string" && v.length > 0) {
    return stripInlineMarkup(v);
  }
  return v;
}

interface HeaderSpec {
  name: string;
  numberFormat?: string;
  width?: number;
  align?: string;
}

function normalizeHeader(raw: any): HeaderSpec {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return {
      name: String(raw.name ?? ""),
      numberFormat: typeof raw.numberFormat === "string" ? raw.numberFormat : undefined,
      width: typeof raw.width === "number" && raw.width > 0 ? raw.width : undefined,
      align: typeof raw.align === "string" ? raw.align : undefined,
    };
  }
  return { name: String(raw ?? "") };
}

export const createXlsxTool: ToolSpec = {
  mutating: true,
  definition: {
    type: "function",
    function: {
      name: "create_xlsx",
      description:
        "Create a well-formatted Excel (.xlsx) workbook with one or more sheets, each with an optional bold " +
        "header row and auto-sized columns. Sheets must contain the actual data the user asked for — never call " +
        "this with empty or placeholder rows.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Output path relative to the working directory, ending in .xlsx" },
          accentColor: {
            type: "string",
            description:
              "Optional brand hex color. By default, header rows use a light-blue fill with dark navy text and the " +
              "sheet tab is colored to match; passing accentColor derives a matching light tint of your color and " +
              "uses it for the sheet tab instead.",
          },
          sheets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Sheet name (defaults to Sheet1, Sheet2, ...)." },
                headers: {
                  type: "array",
                  description:
                    "Bold header row. Each header is a string, or {name, numberFormat, width, align} to control " +
                    "that column: numberFormat examples: '$#,##0.00' (currency), '0.0%' (percent), 'yyyy-mm-dd' " +
                    "(date), '#,##0' (thousands separator).",
                  items: {},
                },
                rows: {
                  type: "array",
                  items: { type: "array", items: {} },
                  description:
                    "Data rows, each an array of cell values (string or number). A string starting with '=' is " +
                    "written as a live, recalculating Excel formula (e.g. '=SUM(B2:B10)', '=B2*C2') instead of a " +
                    "literal string — use this for anything that should stay an auditable, formula-driven model " +
                    "(financial models, running totals) rather than baked-in numbers.",
                },
                merges: {
                  type: "array",
                  items: { type: "string" },
                  description: "Cell ranges to merge, e.g. ['A1:C1'] to merge a title across three columns.",
                },
                autoFilter: { type: "boolean", description: "Add filter dropdowns to the header row." },
              },
            },
          },
        },
        required: ["path", "sheets"],
      },
    },
  },
  describe: (args) => `create ${args.path}`,
  preview: async (args) => `New Excel workbook: ${args.path}\n${(args.sheets ?? []).length} sheet(s)`,
  run: async (args, ctx) => {
    const emptyCheck = checkXlsxHasContent(args.sheets);
    if (emptyCheck) return { ok: false, output: emptyCheck };
    const sizeCheck = checkXlsxSizeThreshold(args.sheets);
    if (sizeCheck) return { ok: false, output: sizeCheck };

    const quality = checkXlsxQuality(args.sheets ?? []);
    if (!quality.ok) {
      const output = quality.blocking.join("\n");
      return { ok: false, output, qualityGate: { name: "xlsx quality gate", ok: false, output } };
    }

    const customAccent = optionalHexColor(args.accentColor);
    const accent = customAccent ?? DEFAULT_ACCENT_HEX;
    const accentDark = customAccent ? darkenHex(accent) : DEFAULT_ACCENT_DARK_HEX;
    const headerBand = headerBandColors(customAccent, accentDark, { allowDark: true });

    const filePath = resolveInRoot(ctx.root, args.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const workbook = new ExcelJS.Workbook();
    const sheetSpecs = args.sheets ?? [];
    const allMergeWarnings: string[] = [];

    sheetSpecs.forEach((sheetSpec: any, i: number) => {
      const sheet = workbook.addWorksheet(sheetSpec.name || `Sheet${i + 1}`);
      sheet.properties.tabColor = { argb: `FF${accent}` };
      const headers: HeaderSpec[] = (sheetSpec.headers ?? []).map(normalizeHeader);
      const rows: any[][] = sheetSpec.rows ?? [];

      const THIN: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFD1D5DB" } };
      const cellBorder = { top: THIN, bottom: THIN, left: THIN, right: THIN };

      if (headers.length) {
        const headerRow = sheet.addRow(headers.map((h) => stripInlineMarkup(h.name)));
        headerRow.font = { bold: true, color: { argb: `FF${headerBand.text}` } };
        headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${headerBand.fill}` } };
        headerRow.eachCell((cell, colNumber) => {
          cell.border = cellBorder;
          const align = headers[colNumber - 1]?.align;
          cell.alignment = { vertical: "middle", horizontal: align === "center" || align === "right" ? (align as any) : "left" };
        });
        sheet.views = [{ state: "frozen", ySplit: 1 }];
      }
      rows.forEach((row, i) => {
        // Column widths below are measured from the raw (pre-formula) values, so a cell
        // like "=SUM(B2:B10)" sizes the column by the formula text, not "[object Object]".
        const dataRow = sheet.addRow(row.map(toFormulaAwareCellValue));
        if (i % 2 === 1) dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
        dataRow.eachCell((cell, colNumber) => {
          cell.border = cellBorder;
          const align = headers[colNumber - 1]?.align;
          if (align === "center" || align === "right" || align === "left") cell.alignment = { horizontal: align as any };
          // A cell can't be partially bold, so **markup** anywhere in the raw (pre-strip) value promotes the
          // whole cell — same reasoning as the pptx table-cell fallback above.
          const raw = row[colNumber - 1];
          if (typeof raw === "string" && !raw.startsWith("=") && parseInlineMarkup(raw).some((s) => s.bold)) {
            cell.font = { bold: true };
          }
        });
      });

      const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
      for (let c = 0; c < colCount; c++) {
        const header = headers[c];
        if (header?.numberFormat) {
          sheet.getColumn(c + 1).numFmt = header.numberFormat;
        }
        if (header?.width) {
          sheet.getColumn(c + 1).width = header.width;
        } else {
          const headerLen = String(header?.name ?? "").length;
          const maxCellLen = rows.reduce((m, r) => Math.max(m, String(r[c] ?? "").length), 0);
          sheet.getColumn(c + 1).width = Math.min(50, Math.max(10, Math.max(headerLen, maxCellLen) + 3));
        }
      }

      for (const range of sheetSpec.merges ?? []) {
        if (typeof range !== "string") continue;
        try {
          sheet.mergeCells(range);
        } catch (err: any) {
          allMergeWarnings.push(`${range} (${err.message ?? err})`);
        }
      }

      if (sheetSpec.autoFilter && headers.length) {
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: colCount } };
      }
    });

    await workbook.xlsx.writeFile(filePath);
    const stat = fs.statSync(filePath);

    // Real sheet/header structure, not just a sheet count — see the matching comment in create_docx
    // for why: this is what the independent critic actually reads to judge quality against intent.
    const sheetSummaries = sheetSpecs.map((s: any, i: number) => {
      const headerNames = (s.headers ?? []).map((h: any) => (h && typeof h === "object" ? h.name : h)).filter(Boolean);
      return `${s.name || `Sheet${i + 1}`} [${headerNames.join(", ")}]`;
    });
    const structureSummary = `Sheets: ${sheetSummaries.join(" | ")}`;
    const mergeSuffix = allMergeWarnings.length ? `\nSome merge ranges were invalid and skipped: ${allMergeWarnings.join(", ")}` : "";
    const qualitySuffix = quality.warnings.length ? `\nQuality notes: ${quality.warnings.join(" ")}` : "";

    return {
      ok: true,
      output: `Created ${args.path} (${sheetSpecs.length} sheet(s), ${stat.size} bytes). ${structureSummary}${mergeSuffix}${qualitySuffix}`,
      qualityGate: { name: "xlsx quality gate", ok: true, output: quality.warnings.join("\n") },
    };
  },
};

function checkXlsxHasContent(sheets: any[] | undefined): string | null {
  if (!Array.isArray(sheets) || sheets.length === 0) {
    return "sheets is empty — this would create a blank workbook. Write out the actual headers/rows for the data " +
      "the user asked for before calling this tool.";
  }
  const hasContent = sheets.some(
    (s) => (Array.isArray(s.headers) && s.headers.length > 0) || (Array.isArray(s.rows) && s.rows.length > 0)
  );
  if (!hasContent) {
    return "Every sheet is empty (no headers or rows) — this would create a blank workbook. Fill in the actual " +
      "data, then call this tool again.";
  }
  return null;
}
