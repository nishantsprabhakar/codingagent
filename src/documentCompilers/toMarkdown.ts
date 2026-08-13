/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Compiles the shared DocSpec (documentIR.ts) to a single, self-contained Markdown string. Images
 * are base64-embedded as data URIs (same self-containment reasoning as docx/pptx embedding bytes
 * directly rather than linking to an external file) — a real size tradeoff, since unlike a zip's
 * compressed parts, base64 in a .md file has no compression; see toHtml.ts's warning threshold,
 * mirrored here.
 */
import type { DocBlock, DocSpec } from "../documentIR";
import { normalizeListItem, mergeColonContinuations, normalizeCell, MAX_IMAGE_BYTES } from "../documentIR";
import { parseInlineMarkup } from "../tools/richText";
import { loadImageFile } from "../tools/imageUtils";

const BASE64_WARNING_THRESHOLD_BYTES = 25 * 1024 * 1024;

/** Escapes only the characters that would let raw HTML pass through CommonMark's inline-HTML
 *  allowance (<, >, &) — deliberately not quotes/apostrophes, since markdown body text isn't an
 *  HTML attribute and escaping them would visibly mangle ordinary prose. */
function escapeMdText(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Renders "**bold** _italic_ __underline__ ~~strike~~" text into real markdown syntax — bold/
 *  italic/strike map 1:1 onto CommonMark/GFM syntax; underline has no markdown equivalent (and
 *  "__text__" in real markdown means bold, not underline), so it's rendered as raw inline HTML
 *  <u>...</u> around the already-escaped inner text, which CommonMark passes through untouched. */
function renderInline(text: string): string {
  const spans = parseInlineMarkup(text ?? "");
  return spans
    .map((s) => {
      let out = escapeMdText(s.text);
      if (s.italic) out = `_${out}_`;
      if (s.bold) out = `**${out}**`;
      if (s.strike) out = `~~${out}~~`;
      if (s.underline) out = `<u>${out}</u>`;
      return out;
    })
    .join("");
}

/** Escapes a literal pipe (breaks pipe-table column counts) and collapses embedded newlines (pipe
 *  tables are single-line — an unescaped newline silently breaks the row). */
function renderTableCellInline(text: string): string {
  return renderInline(text).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function headingPrefix(level: number | undefined): string {
  const clamped = Math.min(6, Math.max(1, Math.round(level ?? 1)));
  return "#".repeat(clamped);
}

function renderImage(root: string, block: DocBlock & { type: "image" }, warnings: string[]): string {
  const loaded = loadImageFile(root, String(block.path ?? ""), MAX_IMAGE_BYTES);
  if ("error" in loaded) throw new Error(loaded.error);
  const mime = loaded.type === "jpg" ? "image/jpeg" : `image/${loaded.type}`;
  const base64 = loaded.buffer.toString("base64");
  if (base64.length > BASE64_WARNING_THRESHOLD_BYTES) {
    warnings.push(`Image "${block.path}" adds ~${Math.round(base64.length / 1024 / 1024)}MB of base64 to the output — consider a smaller image.`);
  }
  const alt = block.caption ? escapeMdText(String(block.caption)) : "image";
  const img = `![${alt}](data:${mime};base64,${base64})`;
  return block.caption ? `${img}\n\n*${escapeMdText(String(block.caption))}*` : img;
}

/** Compiles a DocSpec to a self-contained Markdown string. Throws if an image block's path can't
 *  be resolved/read (same failure the docx compiler surfaces, just via exception instead of an
 *  early-return — callers wrap this in try/catch to produce a clean tool-result error). */
export function compileToMarkdown(spec: DocSpec, root: string): { content: string; warnings: string[] } {
  const warnings: string[] = [];
  const lines: string[] = [];

  if (spec.title) {
    lines.push(`# ${escapeMdText(spec.title)}`, "");
  }

  for (const block of spec.blocks ?? []) {
    if (block.type === "heading") {
      lines.push(`${headingPrefix(block.level)} ${renderInline(block.text ?? "")}`, "");
    } else if (block.type === "paragraph") {
      lines.push(renderInline(block.text ?? ""), "");
    } else if (block.type === "bullets") {
      const items = mergeColonContinuations((block.items ?? []).map(normalizeListItem));
      items.forEach((item, i) => {
        const indent = "  ".repeat(item.level);
        const marker = block.ordered ? `${i + 1}.` : "-";
        lines.push(`${indent}${marker} ${renderInline(item.text)}`);
      });
      lines.push("");
    } else if (block.type === "table") {
      const headers = (block.headers ?? []).map(normalizeCell);
      const rows = (block.rows ?? []).map((row) => row.map(normalizeCell));
      const columnCount = headers.length || (rows[0]?.length ?? 0);
      if (columnCount > 0) {
        const headerCells = headers.length ? headers : Array.from({ length: columnCount }, () => ({ text: "" }));
        lines.push(`| ${headerCells.map((h) => renderTableCellInline(h.text)).join(" | ")} |`);
        lines.push(`| ${headerCells.map(() => "---").join(" | ")} |`);
        for (const row of rows) {
          lines.push(`| ${row.map((c) => renderTableCellInline(c.text)).join(" | ")} |`);
        }
        lines.push("");
      }
    } else if (block.type === "image") {
      lines.push(renderImage(root, block, warnings), "");
    } else if (block.type === "pagebreak") {
      // Markdown has no page concept — approximated as a thematic break, documented in the tool description.
      lines.push("---", "");
    } else if (block.type === "toc") {
      lines.push(`## ${block.text || "Table of Contents"}`, "");
      const headings = (spec.blocks ?? []).filter((b): b is DocBlock & { type: "heading" } => b.type === "heading");
      for (const h of headings) {
        const indent = "  ".repeat(Math.max(0, (h.level ?? 1) - 1));
        lines.push(`${indent}- ${escapeMdText(h.text ?? "")}`);
      }
      lines.push("");
    }
  }

  return { content: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n", warnings };
}
