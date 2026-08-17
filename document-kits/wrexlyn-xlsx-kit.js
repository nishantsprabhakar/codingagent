/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Curated exceljs helpers for scripts run via the run_xlsx_script tool — see
 * wrexlyn-pptx-kit.js's header comment for why this lives outside src/ and how NODE_PATH makes
 * `require('wrexlyn-xlsx-kit')`/`require('exceljs')` resolve from inside the target project.
 */
"use strict";

const path = require("path");
const ExcelJS = require("exceljs");
const ir = require(path.join(__dirname, "..", "dist", "documentIR.js"));

const DEFAULT_ACCENT_HEX = "2563EB";
const DEFAULT_ACCENT_DARK_HEX = "1E3A8A";

const THIN_BORDER = { style: "thin", color: { argb: "FFD1D5DB" } };
const CELL_BORDER = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };

/** A string starting with "=" becomes a live, recalculating Excel formula instead of a literal
 *  string value — pass the result of this function as the cell value when building a row array. */
function toFormulaAwareCellValue(v) {
  if (typeof v === "string" && v.startsWith("=") && v.length > 1) return { formula: v.slice(1) };
  return v;
}

/** Bold header row, colored fill, thin borders, and a frozen top row — the same look
 *  create_xlsx applies by default. `headerBand` is `{fill, text}` (see headerBandColors below). */
function styleHeaderRow(sheet, headerRow, headerBand) {
  headerRow.font = { bold: true, color: { argb: `FF${headerBand.text}` } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${headerBand.fill}` } };
  headerRow.eachCell((cell) => {
    cell.border = CELL_BORDER;
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

/** Thin gray borders on every cell in a data row, plus an alternating light-gray fill on odd rows
 *  (0-indexed data row number, not the sheet row number) — the same zebra-striping create_xlsx
 *  applies by default. */
function applyDataRowStyle(row, dataRowIndex) {
  if (dataRowIndex % 2 === 1) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  row.eachCell((cell) => {
    cell.border = CELL_BORDER;
  });
}

/** Reasonable auto-sized column width from header + data cell text lengths, capped 10-50 chars. */
function autoColumnWidth(headerName, columnValues) {
  const headerLen = String(headerName || "").length;
  const maxCellLen = columnValues.reduce((m, v) => Math.max(m, String(v == null ? "" : v).length), 0);
  return Math.min(50, Math.max(10, Math.max(headerLen, maxCellLen) + 3));
}

module.exports = {
  ExcelJS,
  DEFAULT_ACCENT_HEX,
  DEFAULT_ACCENT_DARK_HEX,
  toFormulaAwareCellValue,
  styleHeaderRow,
  applyDataRowStyle,
  autoColumnWidth,
  darkenHex: ir.darkenHex,
  lightenHex: ir.lightenHex,
  headerBandColors: ir.headerBandColors,
  optionalHexColor: ir.optionalHexColor,
};
