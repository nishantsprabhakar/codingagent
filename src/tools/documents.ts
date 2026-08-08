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
} from "docx";
import PptxGenJS from "pptxgenjs";
import ExcelJS from "exceljs";
import type { ToolSpec } from "../types";
import { resolveInRoot } from "./paths";
import { parseInlineMarkup } from "./richText";
import { loadImageFile, fitImageBox } from "./imageUtils";

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

/** Shared default accent used across docx/pptx/xlsx output when the caller doesn't supply its own accentColor. */
const DEFAULT_ACCENT_HEX = "2563EB";
const DEFAULT_ACCENT_DARK_HEX = "1E3A8A";
const TEXT_HEX = "1F2937";
const BODY_FONT = "Calibri";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const THIN_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "D1D5DB" } as const;
const TABLE_BORDERS = {
  top: THIN_BORDER,
  bottom: THIN_BORDER,
  left: THIN_BORDER,
  right: THIN_BORDER,
  insideHorizontal: THIN_BORDER,
  insideVertical: THIN_BORDER,
};

/** Darkens a 6-digit hex color by `factor` (0-1) — used to derive a heading color from a custom accentColor. */
function darkenHex(hex: string, factor = 0.35): string {
  const channel = (offset: number) => {
    const v = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.max(0, Math.round(v * (1 - factor)))
      .toString(16)
      .padStart(2, "0");
  };
  return (channel(0) + channel(2) + channel(4)).toUpperCase();
}

function optionalHexColor(input: unknown): string | undefined {
  if (typeof input !== "string" || !input) return undefined;
  const cleaned = input.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(cleaned) ? cleaned.toUpperCase() : undefined;
}

/** A list item, table cell, or table header may be a plain string or an object carrying formatting hints. */
function normalizeListItem(raw: any): { text: string; level: number } {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { text: String(raw.text ?? ""), level: Math.max(0, Math.min(3, Number(raw.level ?? 0) || 0)) };
  }
  return { text: String(raw ?? ""), level: 0 };
}

interface CellSpec {
  text: string;
  align?: string;
  bold?: boolean;
}

function normalizeCell(raw: any): CellSpec {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { text: String(raw.text ?? ""), align: typeof raw.align === "string" ? raw.align : undefined, bold: !!raw.bold };
  }
  return { text: String(raw ?? "") };
}

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
        "**bold**, _italic_, __underline__, ~~strikethrough~~ (combinable, e.g. **_bold italic_**).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Output path relative to the working directory, ending in .docx" },
          title: { type: "string", description: "Document title, rendered as a large title heading at the top." },
          accentColor: {
            type: "string",
            description: "Optional hex color (e.g. 'C026D3' or '#C026D3') used for headings and table header shading, instead of the default blue.",
          },
          blocks: {
            type: "array",
            description: "Ordered content blocks making up the document body.",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["heading", "paragraph", "bullets", "table", "image", "pagebreak"] },
                level: { type: "number", description: "Heading level 1-6 (type=heading only)." },
                text: { type: "string", description: "Text content, supports inline markup (type=heading or paragraph)." },
                align: { type: "string", enum: ["left", "center", "right", "justify"], description: "Text alignment (type=heading or paragraph)." },
                color: { type: "string", description: "Optional hex color override for this block's text (type=heading or paragraph)." },
                ordered: { type: "boolean", description: "Render as a numbered list instead of bulleted (type=bullets)." },
                items: {
                  type: "array",
                  description:
                    "List items (type=bullets). Each item is either a plain string, or {text, level} where level " +
                    "(0-3) nests the item for a sub-list.",
                  items: {},
                },
                headers: {
                  type: "array",
                  description: "Table header row (type=table). Each header is a string or {text, align}.",
                  items: {},
                },
                rows: {
                  type: "array",
                  items: { type: "array", items: {} },
                  description: "Table body rows (type=table). Each cell is a string or {text, align, bold}.",
                },
                path: { type: "string", description: "Path to an image file, relative to the working directory (type=image)." },
                width: { type: "number", description: "Image width in inches — height is derived from the image's real aspect ratio if omitted (type=image)." },
                height: { type: "number", description: "Image height in inches, overriding the aspect-derived value (type=image)." },
                caption: { type: "string", description: "Optional caption shown centered below the image (type=image)." },
              },
              required: ["type"],
            },
          },
        },
        required: ["path", "blocks"],
      },
    },
  },
  describe: (args) => `create ${args.path}`,
  preview: async (args) => summarizeBlocks(args.path, args.title, args.blocks),
  run: async (args, ctx) => {
    const emptyCheck = checkDocxHasContent(args.blocks);
    if (emptyCheck) return { ok: false, output: emptyCheck };

    const accent = optionalHexColor(args.accentColor) ?? DEFAULT_ACCENT_HEX;
    const accentDark = optionalHexColor(args.accentColor) ? darkenHex(accent) : DEFAULT_ACCENT_DARK_HEX;

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
        children.push(
          new Paragraph({
            children: docxRuns(block.text ?? "", { color: optionalHexColor(block.color) }),
            heading: HEADING_LEVELS[idx],
            alignment: docxAlign(block.align),
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
        const items = (block.items ?? []).map(normalizeListItem);
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
                  shading: { type: ShadingType.SOLID, fill: accent },
                  children: [
                    new Paragraph({
                      children: docxRuns(cell.text, { color: "FFFFFF", bold: true }),
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
      sections: [{ children }],
    });
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);

    return { ok: true, output: `Created ${args.path} (${(args.blocks ?? []).length} content blocks, ${buffer.length} bytes)` };
  },
};

/** Returns an error message if `blocks` has no real content, or null if it's fine. */
function checkDocxHasContent(blocks: any[] | undefined): string | null {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return "blocks is empty — this would create a near-blank document. Write out the actual content the user " +
      "asked for as real blocks (headings, paragraphs, bullets, tables) before calling this tool.";
  }
  const hasContent = blocks.some((b) => {
    if (b.type === "heading" || b.type === "paragraph") return typeof b.text === "string" && b.text.trim().length > 0;
    if (b.type === "bullets") return Array.isArray(b.items) && b.items.some((i: any) => normalizeListItem(i).text.trim().length > 0);
    if (b.type === "table") return (Array.isArray(b.headers) && b.headers.length > 0) || (Array.isArray(b.rows) && b.rows.length > 0);
    if (b.type === "image") return typeof b.path === "string" && b.path.trim().length > 0;
    if (b.type === "pagebreak") return true;
    return false;
  });
  if (!hasContent) {
    return "Every block is empty (no text/items/rows/path) — this would create a near-blank document. Fill in the " +
      "actual content the user asked for, then call this tool again.";
  }
  return null;
}

function summarizeBlocks(filePath: string, title: string | undefined, blocks: any[]): string {
  const counts: Record<string, number> = {};
  for (const b of blocks ?? []) counts[b.type] = (counts[b.type] ?? 0) + 1;
  const summary = Object.entries(counts)
    .map(([type, n]) => `${n} ${type}${n === 1 ? "" : "s"}`)
    .join(", ");
  return `New Word document: ${filePath}${title ? `\nTitle: ${title}` : ""}\nContent: ${summary || "(empty)"}`;
}

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
          bullet: { characterCode: "2022" },
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
        "supports inline markup: **bold**, _italic_, __underline__, ~~strikethrough~~.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Output path relative to the working directory, ending in .pptx" },
          accentColor: { type: "string", description: "Optional hex color used for the title accent bar and section-divider backgrounds, instead of the default blue." },
          slides: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                layout: {
                  type: "string",
                  enum: ["title_bullets", "section", "two_column"],
                  description:
                    "'title_bullets' (default): title + bullet list. 'section': a large centered title on an " +
                    "accent-colored background, for dividing the deck into sections. 'two_column': title + two " +
                    "side-by-side bullet lists (use with `columns`).",
                },
                bullets: {
                  type: "array",
                  description: "Bullet items (layout=title_bullets). Each is a string or {text, level} to nest as a sub-bullet.",
                  items: {},
                },
                columns: {
                  type: "array",
                  description: "Exactly two arrays of bullet strings, side by side (layout=two_column only).",
                  items: { type: "array", items: { type: "string" } },
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
                  description: "A table to place on this slide, below the title (overrides layout/bullets for this slide).",
                  properties: {
                    headers: { type: "array", items: { type: "string" } },
                    rows: { type: "array", items: { type: "array", items: {} } },
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

    const accent = optionalHexColor(args.accentColor) ?? DEFAULT_ACCENT_HEX;

    const filePath = resolveInRoot(ctx.root, args.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const pres = new PptxGenJS();
    const bodyBase: PptxTextBase = { fontFace: BODY_FONT, fontSize: 18, color: "374151" };

    for (const spec of args.slides ?? []) {
      const slide = pres.addSlide();
      slide.background = { color: "FFFFFF" };

      const mode = spec.image ? "image" : spec.table ? "table" : spec.layout === "section" ? "section" : spec.layout === "two_column" ? "two_column" : "title_bullets";

      if (mode === "section") {
        slide.background = { color: accent };
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

      if (spec.title) {
        slide.addText(String(spec.title), {
          x: 0.5,
          y: 0.35,
          w: 9,
          h: 0.9,
          fontFace: BODY_FONT,
          fontSize: 28,
          bold: true,
          color: TEXT_HEX,
        });
        slide.addShape(pres.ShapeType.rect, { x: 0.5, y: 1.22, w: 1.4, h: 0.045, fill: { color: accent }, line: { type: "none" } });
      }

      if (mode === "image") {
        const loaded = loadImageFile(ctx.root, String(spec.image.path ?? ""), MAX_IMAGE_BYTES);
        if ("error" in loaded) return { ok: false, output: loaded.error };
        const { widthIn, heightIn } = fitImageBox(loaded.intrinsic, 8, spec.image.width, spec.image.height);
        const x = Math.max(0.5, (10 - widthIn) / 2);
        const y = 1.55;
        slide.addImage({ data: `data:image/${loaded.type};base64,${loaded.buffer.toString("base64")}`, x, y, w: widthIn, h: heightIn });
        if (spec.image.caption) {
          slide.addText(pptxRuns(String(spec.image.caption), { fontFace: BODY_FONT, fontSize: 13, color: "6B7280" }), {
            x: 0.5,
            y: Math.min(y + heightIn + 0.15, 5.2),
            w: 9,
            h: 0.4,
            align: "center",
          });
        }
      } else if (mode === "table") {
        const headers: any[] = spec.table.headers ?? [];
        const rows: any[][] = spec.table.rows ?? [];
        const tableRows: PptxGenJS.TableRow[] = [];
        if (headers.length) {
          tableRows.push(
            headers.map((h) => ({
              text: normalizeCell(h).text,
              options: { bold: true, color: "FFFFFF", fill: { color: accent }, align: (normalizeCell(h).align as any) ?? "left" },
            }))
          );
        }
        rows.forEach((row, i) => {
          tableRows.push(
            row.map((cellVal) => {
              const cell = normalizeCell(cellVal);
              return {
                text: cell.text,
                options: {
                  bold: cell.bold || undefined,
                  fill: i % 2 === 1 ? { color: "F3F4F6" } : undefined,
                  align: (cell.align as any) ?? "left",
                },
              };
            })
          );
        });
        if (tableRows.length) {
          slide.addTable(tableRows, { x: 0.5, y: 1.55, w: 9, fontFace: BODY_FONT, fontSize: 14, border: { type: "solid", color: "D1D5DB", pt: 0.5 } });
        }
      } else if (mode === "two_column") {
        const columns = Array.isArray(spec.columns) ? spec.columns : [[], []];
        const left = (columns[0] ?? []).map(normalizeListItem);
        const right = (columns[1] ?? []).map(normalizeListItem);
        if (left.length) slide.addText(pptxBulletRuns(left, bodyBase), { x: 0.5, y: 1.55, w: 4.3, h: 5, valign: "top" });
        if (right.length) slide.addText(pptxBulletRuns(right, bodyBase), { x: 5.2, y: 1.55, w: 4.3, h: 5, valign: "top" });
      } else {
        const items = (spec.bullets ?? []).map(normalizeListItem);
        if (items.length) {
          slide.addText(pptxBulletRuns(items, bodyBase), { x: 0.5, y: 1.55, w: 9, h: 5, valign: "top" });
        }
      }

      if (spec.notes) slide.addNotes(String(spec.notes));
    }

    await pres.writeFile({ fileName: filePath });
    const stat = fs.statSync(filePath);
    return { ok: true, output: `Created ${args.path} (${(args.slides ?? []).length} slides, ${stat.size} bytes)` };
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
      (Array.isArray(s.bullets) && s.bullets.some((b: any) => normalizeListItem(b).text.trim().length > 0)) ||
      (s.image && typeof s.image.path === "string" && s.image.path.trim().length > 0) ||
      (s.table && ((Array.isArray(s.table.headers) && s.table.headers.length > 0) || (Array.isArray(s.table.rows) && s.table.rows.length > 0))) ||
      (Array.isArray(s.columns) && s.columns.some((col: any) => Array.isArray(col) && col.length > 0))
  );
  if (!hasContent) {
    return "Every slide is empty (no title, bullets, image, table, or columns) — this would create a blank " +
      "presentation. Fill in the actual content, then call this tool again.";
  }
  return null;
}

// ---------- Excel (.xlsx) ----------

/** A cell value of "=SOME_FORMULA" becomes a live Excel formula instead of a literal string. */
function toFormulaAwareCellValue(v: any): any {
  if (typeof v === "string" && v.startsWith("=") && v.length > 1) {
    return { formula: v.slice(1) };
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
          accentColor: { type: "string", description: "Optional hex color for header row fill, instead of the default blue." },
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

    const accent = optionalHexColor(args.accentColor) ?? DEFAULT_ACCENT_HEX;

    const filePath = resolveInRoot(ctx.root, args.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const workbook = new ExcelJS.Workbook();
    const sheetSpecs = args.sheets ?? [];
    const allMergeWarnings: string[] = [];

    sheetSpecs.forEach((sheetSpec: any, i: number) => {
      const sheet = workbook.addWorksheet(sheetSpec.name || `Sheet${i + 1}`);
      const headers: HeaderSpec[] = (sheetSpec.headers ?? []).map(normalizeHeader);
      const rows: any[][] = sheetSpec.rows ?? [];

      const THIN: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFD1D5DB" } };
      const cellBorder = { top: THIN, bottom: THIN, left: THIN, right: THIN };

      if (headers.length) {
        const headerRow = sheet.addRow(headers.map((h) => h.name));
        headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
        headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${accent}` } };
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

    const warningSuffix = allMergeWarnings.length ? `\nSome merge ranges were invalid and skipped: ${allMergeWarnings.join(", ")}` : "";
    return { ok: true, output: `Created ${args.path} (${sheetSpecs.length} sheet(s), ${stat.size} bytes)${warningSuffix}` };
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
