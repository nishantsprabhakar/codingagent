/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Curated docx (docx.js) helpers for scripts run via the run_docx_script tool — see
 * wrexlyn-pptx-kit.js's header comment for why this lives outside src/ and how NODE_PATH makes
 * `require('wrexlyn-docx-kit')`/`require('docx')` resolve from inside the target project.
 */
"use strict";

const path = require("path");
const docx = require("docx");
const { parseInlineMarkup } = require(path.join(__dirname, "..", "dist", "tools", "richText.js"));
const ir = require(path.join(__dirname, "..", "dist", "documentIR.js"));

const BODY_FONT = "Calibri";
const TEXT_HEX = "1F2937";
const DEFAULT_ACCENT_HEX = "2563EB";
const DEFAULT_ACCENT_DARK_HEX = "1E3A8A";

const THIN_BORDER = { style: docx.BorderStyle.SINGLE, size: 4, color: "D1D5DB" };
const TABLE_BORDERS = {
  top: THIN_BORDER,
  bottom: THIN_BORDER,
  left: THIN_BORDER,
  right: THIN_BORDER,
  insideHorizontal: THIN_BORDER,
  insideVertical: THIN_BORDER,
};

/** US Letter page size in DXA (docx.js defaults to A4) — pass as `sections[0].properties.page.size`. */
const LETTER_SIZE_DXA = { width: 12240, height: 15840 };

/** Converts "**bold** _italic_ __underline__ ~~strike~~" text into a real docx TextRun[] — pass the
 *  result as a Paragraph's `children`. `overrideOptions` merges into every run (e.g. {color, size}). */
function docxRuns(text, overrideOptions) {
  const spans = parseInlineMarkup(String(text ?? ""));
  return spans.map(
    (s) =>
      new docx.TextRun(
        Object.assign(
          {
            text: s.text,
            bold: s.bold || undefined,
            italics: s.italic || undefined,
            strike: s.strike || undefined,
          },
          s.underline ? { underline: {} } : {},
          overrideOptions || {}
        )
      )
  );
}

/** A numbering config for ordered lists — pass as `numbering: { config: [orderedListNumbering()] }`
 *  in `new docx.Document({...})`, then set each ordered Paragraph's `numbering: { reference:
 *  "wrexlyn-ordered-list", level: n }`. Cycles DECIMAL -> LOWER_LETTER -> LOWER_ROMAN -> DECIMAL
 *  across 4 nesting levels. */
function orderedListNumbering(reference) {
  const ref = reference || "wrexlyn-ordered-list";
  const formats = [docx.LevelFormat.DECIMAL, docx.LevelFormat.LOWER_LETTER, docx.LevelFormat.LOWER_ROMAN, docx.LevelFormat.DECIMAL];
  return {
    reference: ref,
    levels: formats.map((format, level) => ({
      level,
      format,
      text: format === docx.LevelFormat.DECIMAL ? `%${level + 1}.` : `%${level + 1})`,
      alignment: docx.AlignmentType.START,
      style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
    })),
  };
}

/** A real, auto-updating Table of Contents field — requires `features: { updateFields: true }` on
 *  the Document so Word computes page numbers on open. Every heading Paragraph you want included
 *  must set both a real HeadingLevel style AND a matching `outlineLevel` (0 for H1, 1 for H2, ...). */
function createToc(title) {
  return new docx.TableOfContents(title || "Table of Contents", { hyperlink: true, headingStyleRange: "1-3" });
}

module.exports = Object.assign(
  {
    BODY_FONT,
    TEXT_HEX,
    DEFAULT_ACCENT_HEX,
    DEFAULT_ACCENT_DARK_HEX,
    LETTER_SIZE_DXA,
    TABLE_BORDERS,
    docxRuns,
    orderedListNumbering,
    createToc,
  },
  // darkenHex/lightenHex/headerBandColors/optionalHexColor — shared, un-duplicated, from documentIR.ts.
  {
    darkenHex: ir.darkenHex,
    lightenHex: ir.lightenHex,
    headerBandColors: ir.headerBandColors,
    optionalHexColor: ir.optionalHexColor,
    DOCX_HEADER_LIGHT_FILL: ir.DOCX_HEADER_LIGHT_FILL,
    DOCX_HEADER_LIGHT_TEXT: ir.DOCX_HEADER_LIGHT_TEXT,
  }
);
