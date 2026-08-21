/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Phase 7 — the shared "structured document representation" for flowing-document formats
 * (DOCX/Markdown/HTML/PDF). PPTX (slides) and XLSX (spreadsheet) are deliberately NOT part of this
 * IR — an explicit scope decision, not an oversight: forcing a slide deck or a spreadsheet grid
 * through the same primitives as headings/paragraphs/tables is a known failure mode for generic
 * document tools, and those two formats already have their own working, format-native generators
 * in tools/documents.ts.
 *
 * This type is not new content — it formalizes create_docx's existing `blocks` args shape (which
 * was already almost exactly this) as a named type shared by every flowing-document compiler, plus
 * relocates (not duplicates) the helpers/theming primitives create_docx already had, so
 * toMarkdown/toHtml/toPdf render visually and structurally consistent output with docx from the
 * exact same input, not a parallel reimplementation that can drift.
 */
import { parseInlineMarkup } from "./tools/richText";

export interface DocBlockHeading {
  type: "heading";
  level?: number;
  text: string;
  align?: string;
  color?: string;
}
export interface DocBlockParagraph {
  type: "paragraph";
  text: string;
  align?: string;
  color?: string;
}
export interface DocBlockBullets {
  type: "bullets";
  ordered?: boolean;
  color?: string;
  items: unknown[];
}
export interface DocBlockTable {
  type: "table";
  headers?: unknown[];
  rows: unknown[][];
}
export interface DocBlockImage {
  type: "image";
  path: string;
  width?: number;
  height?: number;
  caption?: string;
  align?: string;
}
export interface DocBlockPageBreak {
  type: "pagebreak";
}
export interface DocBlockToc {
  type: "toc";
  text?: string;
}
export type DocBlock =
  | DocBlockHeading
  | DocBlockParagraph
  | DocBlockBullets
  | DocBlockTable
  | DocBlockImage
  | DocBlockPageBreak
  | DocBlockToc;

export interface DocSpec {
  title?: string;
  accentColor?: string;
  blocks: DocBlock[];
}

// ---------- Theming (relocated from documents.ts — shared so a custom accentColor looks the same
// shade across every flowing-document format, not a per-compiler reimplementation that can drift) ----------

export const DEFAULT_ACCENT_HEX = "2563EB";
export const DEFAULT_ACCENT_DARK_HEX = "1E3A8A";
export const TEXT_HEX = "1F2937";
export const BODY_FONT = "Calibri";
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const DOCX_HEADER_LIGHT_FILL = "DBEAFE";
export const DOCX_HEADER_LIGHT_TEXT = "1E3A8A";

/** Darkens a 6-digit hex color by `factor` (0-1) — used to derive a heading color from a custom accentColor. */
export function darkenHex(hex: string, factor = 0.35): string {
  const channel = (offset: number) => {
    const v = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.max(0, Math.round(v * (1 - factor)))
      .toString(16)
      .padStart(2, "0");
  };
  return (channel(0) + channel(2) + channel(4)).toUpperCase();
}

/** Lightens a 6-digit hex color toward white by `factor` (0-1) — used to derive a light header-band
 *  fill from a custom accentColor, mirroring darkenHex, so a custom brand color still gets a coherent
 *  light-tinted table header instead of always falling back to the hardcoded default blue tint. */
export function lightenHex(hex: string, factor = 0.82): string {
  const channel = (offset: number) => {
    const v = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.max(0, Math.min(255, Math.round(v + (255 - v) * factor)))
      .toString(16)
      .padStart(2, "0");
  };
  return (channel(0) + channel(2) + channel(4)).toUpperCase();
}

/** Perceived-luminance check (ITU-R BT.601 weights) — used to decide whether a fill color needs
 *  white or dark text on top of it to stay readable. */
export function isDarkHex(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

/** Derives the light-blue-style header fill + dark text pair for table headers: the fixed default
 *  tint when no accentColor was given, or a tint derived from the custom accent so it stays visually
 *  coherent with the rest of the document.
 *
 *  `allowDark` (xlsx only — see createXlsxTool) opts into keeping a genuinely dark custom accent as
 *  a dark fill with white text, instead of always lightening it. docx deliberately never passes this:
 *  its header band sits inside a printable, light-themed page, so lightening stays the right default
 *  there even for a dark brand color. */
export function headerBandColors(
  customAccent: string | undefined,
  accentDark: string,
  options?: { allowDark?: boolean }
): { fill: string; text: string } {
  if (!customAccent) return { fill: DOCX_HEADER_LIGHT_FILL, text: DOCX_HEADER_LIGHT_TEXT };
  if (options?.allowDark && isDarkHex(customAccent)) return { fill: customAccent, text: "FFFFFF" };
  return { fill: lightenHex(customAccent), text: accentDark };
}

export function optionalHexColor(input: unknown): string | undefined {
  if (typeof input !== "string" || !input) return undefined;
  const cleaned = input.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(cleaned) ? cleaned.toUpperCase() : undefined;
}

// ---------- Block-shape helpers (relocated from documents.ts) ----------

/** A list item, table cell, or table header may be a plain string or an object carrying formatting hints. */
export function normalizeListItem(raw: any): { text: string; level: number } {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { text: String(raw.text ?? ""), level: Math.max(0, Math.min(3, Number(raw.level ?? 0) || 0)) };
  }
  return { text: String(raw ?? ""), level: 0 };
}

/**
 * Repairs a common model mistake: writing a bold "label" and its ": description" as two separate list items
 * instead of one — e.g. `["**Accelerated Drug Discovery**", ": explores molecular spaces..."]` instead of
 * `["**Accelerated Drug Discovery**: explores molecular spaces..."]` — which renders as two disconnected
 * bullets (the second starting with a bare colon) instead of the intended single "**Label**: description"
 * line. Merges any item whose text starts with a bare colon into the previous item instead of giving it its
 * own bullet.
 */
export function mergeColonContinuations(items: Array<{ text: string; level: number }>): Array<{ text: string; level: number }> {
  const result: Array<{ text: string; level: number }> = [];
  for (const item of items) {
    if (item.text.trimStart().startsWith(":") && result.length > 0) {
      result[result.length - 1] = { ...result[result.length - 1], text: result[result.length - 1].text + item.text.trimStart() };
    } else {
      result.push(item);
    }
  }
  return result;
}

export interface CellSpec {
  text: string;
  align?: string;
  bold?: boolean;
}

export function normalizeCell(raw: any): CellSpec {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { text: String(raw.text ?? ""), align: typeof raw.align === "string" ? raw.align : undefined, bold: !!raw.bold };
  }
  return { text: String(raw ?? "") };
}

/** Strips markup delimiters to plain text and reports whether any span was meant to be bold — for
 *  renderers (pptx table cells) that can't mix formatting within one string. */
export function flattenCellMarkup(text: string): { text: string; anyBold: boolean } {
  const spans = parseInlineMarkup(text);
  return { text: spans.map((s) => s.text).join(""), anyBold: spans.some((s) => s.bold) };
}

/** Returns an error message if `blocks` has no real content, or null if it's fine. Shared by every
 *  flowing-document tool (was checkDocxHasContent — renamed since it's format-agnostic). */
export function checkBlocksHaveContent(blocks: any[] | undefined): string | null {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return (
      "blocks is empty — this would create a near-blank document. Write out the actual content the user " +
      "asked for as real blocks (headings, paragraphs, bullets, tables) before calling this tool."
    );
  }
  const hasContent = blocks.some((b) => {
    if (b.type === "heading" || b.type === "paragraph") return typeof b.text === "string" && b.text.trim().length > 0;
    if (b.type === "bullets") return Array.isArray(b.items) && b.items.some((i: any) => normalizeListItem(i).text.trim().length > 0);
    if (b.type === "table") return (Array.isArray(b.headers) && b.headers.length > 0) || (Array.isArray(b.rows) && b.rows.length > 0);
    if (b.type === "image") return typeof b.path === "string" && b.path.trim().length > 0;
    if (b.type === "pagebreak" || b.type === "toc") return true;
    return false;
  });
  if (!hasContent) {
    return (
      "Every block is empty (no text/items/rows/path) — this would create a near-blank document. Fill in the " +
      "actual content the user asked for, then call this tool again."
    );
  }
  return null;
}

/** `kind` names the format in the preview text shown in the permission prompt (e.g. "Word document", "Markdown file"). */
export function summarizeBlocks(filePath: string, title: string | undefined, blocks: any[], kind = "Word document"): string {
  const counts: Record<string, number> = {};
  for (const b of blocks ?? []) counts[b.type] = (counts[b.type] ?? 0) + 1;
  const summary = Object.entries(counts)
    .map(([type, n]) => `${n} ${type}${n === 1 ? "" : "s"}`)
    .join(", ");
  return `New ${kind}: ${filePath}${title ? `\nTitle: ${title}` : ""}\nContent: ${summary || "(empty)"}`;
}

// ---------- HTML escaping (new) ----------

/**
 * Escapes text for safe interpolation into generated HTML. Load-bearing, not cosmetic: nothing in
 * this project validates `blocks` against its advertised JSON Schema at runtime (no ajv/zod/joi
 * dependency exists), so a heading/paragraph/table-cell string is untrusted input by the time it
 * reaches a compiler — and toPdf.ts's Puppeteer executes JS in the page it renders. An unescaped
 * "<script>...</script>" in model-supplied text (plausible after summarizing scraped web content)
 * would run in the headless browser during PDF generation, and in any real browser that later opens
 * the generated .html file. Apply this to every literal text span AFTER parseInlineMarkup has split
 * out bold/italic/strike markers — safe either order, since the markup delimiters aren't
 * HTML-meaningful characters — but never to a raw unparsed string (that would also escape the
 * markup delimiters themselves).
 */
export function escapeHtml(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- Shared JSON-schema fragments for tool definitions ----------
// Functions, not shared object literals — a shared literal reused by reference across multiple
// ToolDefinitions would mean a future one-off edit to one tool's field description (via mutation)
// silently changes every tool that shares it.

/** The `blocks` array parameter — identical shape across every flowing-document tool (docx/markdown/html/pdf),
 *  since the block types themselves don't differ per output format, only how each compiler renders them. */
export function blocksPropertySchema(): Record<string, unknown> {
  return {
    type: "array",
    description: "Ordered content blocks making up the document body.",
    items: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["heading", "paragraph", "bullets", "table", "image", "pagebreak", "toc"] },
        level: { type: "number", description: "Heading level 1-6 (type=heading only)." },
        text: {
          type: "string",
          description:
            "Text content, supports inline markup (type=heading or paragraph). For type=toc, an optional " +
            "title (defaults to 'Table of Contents').",
        },
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
  };
}

/** The `accentColor` parameter — shared by every format except Markdown (which has no color rendering at all). */
export function accentColorPropertySchema(): Record<string, unknown> {
  return {
    type: "string",
    description:
      "Optional brand hex color (e.g. 'C026D3' or '#C026D3'). By default, top-level headings and table header " +
      "rows use a light-blue band (dark navy text on a pale blue fill); passing accentColor derives a matching " +
      "light tint of your color instead, so the look stays coherent with a custom brand color.",
  };
}
