/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Compiles the shared DocSpec (documentIR.ts) to a single, self-contained HTML document (inline
 * <style>, no external stylesheet/CDN dependency, images base64-embedded). Reused by toPdf.ts,
 * which renders this exact HTML through headless Chromium and prints it to a PDF buffer.
 *
 * escapeHtml() is applied to every literal text node before interpolation — load-bearing, not
 * cosmetic (see documentIR.ts's doc comment on escapeHtml for why this matters for a compiler whose
 * output gets executed by a real browser engine, not just displayed).
 */
import type { DocBlock, DocSpec } from "../documentIR";
import {
  normalizeListItem,
  mergeColonContinuations,
  normalizeCell,
  optionalHexColor,
  darkenHex,
  headerBandColors,
  DEFAULT_ACCENT_HEX,
  DEFAULT_ACCENT_DARK_HEX,
  TEXT_HEX,
  BODY_FONT,
  MAX_IMAGE_BYTES,
  escapeHtml,
} from "../documentIR";
import { parseInlineMarkup } from "../tools/richText";
import { loadImageFile, fitImageBox } from "../tools/imageUtils";

const BASE64_WARNING_THRESHOLD_BYTES = 25 * 1024 * 1024;

const ALIGN_CSS: Record<string, string> = { left: "left", center: "center", right: "right", justify: "justify" };

/** Fixed lookup table, never raw string interpolation into a style attribute — mirrors docxAlign's
 *  defensive pattern (documents.ts), since nothing validates `align` against its advertised enum. */
function alignStyleAttr(align: unknown): string {
  if (typeof align === "string" && ALIGN_CSS[align]) return ` style="text-align:${ALIGN_CSS[align]}"`;
  return "";
}

function renderInlineHtml(text: string): string {
  const spans = parseInlineMarkup(text ?? "");
  return spans
    .map((s) => {
      let out = escapeHtml(s.text);
      if (s.italic) out = `<em>${out}</em>`;
      if (s.bold) out = `<strong>${out}</strong>`;
      if (s.strike) out = `<del>${out}</del>`;
      if (s.underline) out = `<u>${out}</u>`;
      return out;
    })
    .join("");
}

function colorSpan(html: string, color: string | undefined): string {
  return color ? `<span style="color:#${color}">${html}</span>` : html;
}

/** Restricted to [a-z0-9-] by construction — safe to interpolate into an id/href attribute without
 *  separate escaping. Deduped with a numeric suffix so two same-named headings don't collide. */
function slugify(text: string, seen: Map<string, number>): string {
  let base = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) base = "section";
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

/** Builds a properly nested <ul>/<ol> from a flat items array with per-item `level` — closing the
 *  right number of <li>/<ul> tags on every level change (ascend into a sibling, descend into a
 *  child, or several levels back up at once). */
function renderBulletsHtml(rawItems: unknown[], ordered: boolean, color: string | undefined): string {
  const items = mergeColonContinuations((rawItems ?? []).map(normalizeListItem));
  const tag = ordered ? "ol" : "ul";
  const parts: string[] = [];
  const openLiAtLevel: boolean[] = [];
  let depth = -1;

  for (const item of items) {
    const level = item.level;
    while (depth > level) {
      if (openLiAtLevel[depth]) parts.push("</li>");
      parts.push(`</${tag}>`);
      depth--;
    }
    if (depth === level) {
      if (openLiAtLevel[depth]) parts.push("</li>");
    } else {
      while (depth < level) {
        parts.push(`<${tag}>`);
        depth++;
        openLiAtLevel[depth] = false;
      }
    }
    parts.push(`<li>${colorSpan(renderInlineHtml(item.text), color)}`);
    openLiAtLevel[depth] = true;
  }
  while (depth >= 0) {
    if (openLiAtLevel[depth]) parts.push("</li>");
    parts.push(`</${tag}>`);
    depth--;
  }
  return parts.join("");
}

function renderImageHtml(root: string, block: DocBlock & { type: "image" }, warnings: string[]): string {
  const loaded = loadImageFile(root, String(block.path ?? ""), MAX_IMAGE_BYTES);
  if ("error" in loaded) throw new Error(loaded.error);
  const { widthIn, heightIn } = fitImageBox(loaded.intrinsic, 6.2, block.width, block.height);
  const mime = loaded.type === "jpg" ? "image/jpeg" : `image/${loaded.type}`;
  const base64 = loaded.buffer.toString("base64");
  if (base64.length > BASE64_WARNING_THRESHOLD_BYTES) {
    warnings.push(`Image "${block.path}" adds ~${Math.round(base64.length / 1024 / 1024)}MB of base64 to the output — consider a smaller image.`);
  }
  const alt = escapeHtml(String(block.caption ?? "image"));
  const align = alignStyleAttr(block.align) || ' style="text-align:center"';
  const img = `<img src="data:${mime};base64,${base64}" alt="${alt}" width="${Math.round(widthIn * 96)}" height="${Math.round(heightIn * 96)}" />`;
  const caption = block.caption ? `<figcaption>${escapeHtml(String(block.caption))}</figcaption>` : "";
  return `<figure${align}>${img}${caption}</figure>`;
}

export interface CompileToHtmlOptions {
  /** When true, page-break markers/CSS are meaningful (used by toPdf.ts's print-to-PDF); harmless either way in a browser. */
  forPrint?: boolean;
}

/** Compiles a DocSpec to a self-contained HTML document. Throws if an image block's path can't be
 *  resolved/read — callers wrap this in try/catch to produce a clean tool-result error. */
export function compileToHtml(spec: DocSpec, root: string, _opts?: CompileToHtmlOptions): { content: string; warnings: string[] } {
  const warnings: string[] = [];
  const customAccent = optionalHexColor(spec.accentColor);
  const accentDark = customAccent ? darkenHex(customAccent) : DEFAULT_ACCENT_DARK_HEX;
  const headerBand = headerBandColors(customAccent, accentDark);
  const slugSeen = new Map<string, number>();
  const headingSlugs = new Map<DocBlock, string>();
  for (const b of spec.blocks ?? []) {
    if (b.type === "heading") headingSlugs.set(b, slugify(b.text ?? "", slugSeen));
  }

  const body: string[] = [];
  if (spec.title) body.push(`<h1 class="doc-title">${escapeHtml(spec.title)}</h1>`);

  for (const block of spec.blocks ?? []) {
    if (block.type === "heading") {
      const level = Math.min(6, Math.max(1, Math.round(block.level ?? 1)));
      const isTop = level === 1;
      const slug = headingSlugs.get(block);
      const color = optionalHexColor(block.color) ?? (isTop ? headerBand.text : undefined);
      const cls = isTop ? ` class="doc-h1-band"` : "";
      body.push(`<h${level} id="${slug}"${cls}${alignStyleAttr(block.align)}>${colorSpan(renderInlineHtml(block.text ?? ""), color)}</h${level}>`);
    } else if (block.type === "paragraph") {
      body.push(`<p${alignStyleAttr(block.align)}>${colorSpan(renderInlineHtml(block.text ?? ""), optionalHexColor(block.color))}</p>`);
    } else if (block.type === "bullets") {
      body.push(renderBulletsHtml(block.items ?? [], !!block.ordered, optionalHexColor(block.color)));
    } else if (block.type === "table") {
      const headers = (block.headers ?? []).map(normalizeCell);
      const rows = (block.rows ?? []).map((row) => row.map(normalizeCell));
      const headHtml = headers.length
        ? `<thead><tr>${headers
            .map((h) => `<th style="background:#${headerBand.fill};color:#${headerBand.text}"${alignStyleAttr(h.align)}>${renderInlineHtml(h.text)}</th>`)
            .join("")}</tr></thead>`
        : "";
      const rowsHtml = rows
        .map(
          (row, i) =>
            `<tr${i % 2 === 1 ? ' class="zebra"' : ""}>${row
              .map((c) => `<td${alignStyleAttr(c.align)}${c.bold ? ' style="font-weight:bold"' : ""}>${renderInlineHtml(c.text)}</td>`)
              .join("")}</tr>`
        )
        .join("");
      if (headHtml || rowsHtml) body.push(`<table>${headHtml}<tbody>${rowsHtml}</tbody></table>`);
    } else if (block.type === "image") {
      body.push(renderImageHtml(root, block, warnings));
    } else if (block.type === "pagebreak") {
      body.push(`<div class="page-break"></div>`);
    } else if (block.type === "toc") {
      const headings = (spec.blocks ?? []).filter((b): b is DocBlock & { type: "heading" } => b.type === "heading");
      const items = headings
        .map((h) => `<li style="margin-left:${Math.max(0, (h.level ?? 1) - 1) * 1.2}em"><a href="#${headingSlugs.get(h)}">${escapeHtml(h.text ?? "")}</a></li>`)
        .join("");
      body.push(`<div class="toc"><h2>${escapeHtml(block.text || "Table of Contents")}</h2><ul>${items}</ul></div>`);
    }
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(spec.title || "Document")}</title>
<style>
  body { font-family: ${BODY_FONT}, Arial, sans-serif; color: #${TEXT_HEX}; line-height: 1.5; max-width: 800px; margin: 2em auto; padding: 0 1em; }
  h1, h2, h3, h4, h5, h6 { color: #${accentDark}; }
  .doc-title { font-size: 2em; margin-bottom: 1em; }
  .doc-h1-band { background: #${headerBand.fill}; padding: 0.3em 0.5em; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #D1D5DB; padding: 0.5em; text-align: left; }
  tr.zebra { background: #F3F4F6; }
  figure { margin: 1em 0; text-align: center; }
  figcaption { color: #6B7280; font-size: 0.9em; margin-top: 0.4em; }
  .toc a { color: #${customAccent ?? DEFAULT_ACCENT_HEX}; text-decoration: none; }
  .toc a:hover { text-decoration: underline; }
  .toc ul { list-style: none; padding-left: 0; }
  .page-break { page-break-after: always; }
  @media print { .page-break { break-after: page; } }
</style>
</head>
<body>
${body.join("\n")}
</body>
</html>
`;

  return { content: html, warnings };
}
