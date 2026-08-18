/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Deterministic, non-LLM structural checks for generated documents — the part of "quality" that's
 * genuinely enforceable irrespective of the underlying model, because it inspects the actual output
 * rather than trusting whatever model produced it. A weak model's placeholder text or a jagged table
 * looks the same on disk no matter how confident the model sounded about it.
 *
 * `blocking` issues fail the tool call closed (same pattern as the existing checkDocxHasContent-style
 * empty-content guards in documents.ts) so the model sees a specific reason and retries on its next
 * loop iteration. `warnings` are reported in the success output but don't block — style guidance, not
 * correctness bugs (mirrors the existing merge-range-warning pattern already used in create_xlsx).
 *
 * This cannot and does not try to judge prose quality — no deterministic checker can make a weak
 * model write like a strong one. It catches the concrete, objective failure modes: leftover
 * placeholder text, malformed tables, and empty sections dressed up as content.
 */

export interface QualityCheckResult {
  ok: boolean;
  blocking: string[];
  warnings: string[];
}

/** Exported so documentScriptQuality.ts's post-execution scan (over text extracted from a rendered
 *  .pptx/.docx/.xlsx) shares this exact list rather than maintaining a second, driftable copy. */
export const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\btodo\b/i,
  /\btbd\b/i,
  /\bfixme\b/i,
  /\bxxx\b/i,
  /lorem ipsum/i,
  /\[insert[^\]]{0,80}\]/i,
  /\bplaceholder\b/i,
  /\byour (?:text|content) here\b/i,
];

export function findPlaceholder(text: unknown): string | null {
  if (typeof text !== "string" || !text) return null;
  for (const re of PLACEHOLDER_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

function cellText(raw: any): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return String(raw.text ?? "");
  return String(raw ?? "");
}

function itemText(raw: any): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return String(raw.text ?? "");
  return String(raw ?? "");
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function result(blocking: string[], warnings: string[]): QualityCheckResult {
  return { ok: blocking.length === 0, blocking, warnings };
}

// ---------- flowing documents (docx/markdown/html/pdf — see documentIR.ts) ----------

/** Purely structural checks over the shared block shape (placeholder text, table row/header
 *  column-count mismatches, empty tables) — nothing docx-specific despite the historical name this
 *  had before Phase 7, so it's equally correct when reused by create_markdown/create_html/create_pdf. */
export function checkBlocksQuality(blocks: any[]): QualityCheckResult {
  const blocking: string[] = [];
  const warnings: string[] = [];

  (blocks ?? []).forEach((block, i) => {
    const where = `block #${i + 1} (${block?.type ?? "unknown"})`;

    if (block?.type === "heading" || block?.type === "paragraph") {
      const text = String(block.text ?? "");
      const placeholder = findPlaceholder(text);
      if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in ${where} — replace it with real content.`);
      if (block.type === "paragraph" && wordCount(text) > 150) {
        warnings.push(`${where} is a single ${wordCount(text)}-word paragraph — consider breaking it into headings/bullets for readability.`);
      }
    }

    if (block?.type === "bullets") {
      for (const raw of block.items ?? []) {
        const placeholder = findPlaceholder(itemText(raw));
        if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in a bullet item in ${where}.`);
      }
    }

    if (block?.type === "table") {
      const headers: any[] = Array.isArray(block.headers) ? block.headers : [];
      const rows: any[][] = Array.isArray(block.rows) ? block.rows : [];
      for (const h of headers) {
        const placeholder = findPlaceholder(cellText(h));
        if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in a table header in ${where}.`);
      }
      rows.forEach((row, ri) => {
        if (headers.length && Array.isArray(row) && row.length !== headers.length) {
          blocking.push(
            `${where}: row ${ri + 1} has ${row.length} cell(s) but the header row has ${headers.length} — table columns must line up.`
          );
        }
        for (const cell of row ?? []) {
          const placeholder = findPlaceholder(cellText(cell));
          if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in a table cell in ${where}, row ${ri + 1}.`);
        }
      });
      if (headers.length > 0 && rows.length === 0) {
        blocking.push(`${where} has header columns but no data rows — fill in real rows or remove the table.`);
      }
    }
  });

  return result(blocking, warnings);
}

// ---------- pptx ----------

export function checkPptxQuality(slides: any[]): QualityCheckResult {
  const blocking: string[] = [];
  const warnings: string[] = [];

  (slides ?? []).forEach((slide, i) => {
    const where = `slide ${i + 1}`;

    const titlePlaceholder = findPlaceholder(slide?.title);
    if (titlePlaceholder) blocking.push(`Placeholder text "${titlePlaceholder}" found in the title of ${where}.`);

    const bulletItems: any[] = Array.isArray(slide?.bullets) ? slide.bullets : [];
    for (const raw of bulletItems) {
      const placeholder = findPlaceholder(itemText(raw));
      if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in a bullet on ${where}.`);
    }
    if (bulletItems.length > 6) {
      warnings.push(`${where} has ${bulletItems.length} bullets — split into more slides instead of packing one slide, per the deck's own design guidance.`);
    }

    if (Array.isArray(slide?.columns)) {
      let totalCols = 0;
      for (const col of slide.columns) {
        if (!Array.isArray(col)) continue;
        totalCols += col.length;
        for (const raw of col) {
          const placeholder = findPlaceholder(itemText(raw));
          if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in a column bullet on ${where}.`);
        }
      }
      if (totalCols > 10) warnings.push(`${where}'s two columns together have ${totalCols} bullets — that's dense for one slide.`);
    }

    if (slide?.table) {
      const headers: any[] = Array.isArray(slide.table.headers) ? slide.table.headers : [];
      const rows: any[][] = Array.isArray(slide.table.rows) ? slide.table.rows : [];
      for (const h of headers) {
        const placeholder = findPlaceholder(cellText(h));
        if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in a table header on ${where}.`);
      }
      rows.forEach((row, ri) => {
        if (headers.length && Array.isArray(row) && row.length !== headers.length) {
          blocking.push(
            `${where}: table row ${ri + 1} has ${row.length} cell(s) but the header row has ${headers.length} — table columns must line up.`
          );
        }
        for (const cell of row ?? []) {
          const placeholder = findPlaceholder(cellText(cell));
          if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in a table cell on ${where}, row ${ri + 1}.`);
        }
      });
      if (headers.length > 0 && rows.length === 0) {
        blocking.push(`${where}'s table has header columns but no data rows — fill in real rows or remove the table.`);
      }
    }

    if (slide?.chart) {
      const chart = slide.chart;
      const titlePlaceholder = findPlaceholder(chart?.title);
      if (titlePlaceholder) blocking.push(`Placeholder text "${titlePlaceholder}" found in the chart title on ${where}.`);
      const categories: any[] = Array.isArray(chart?.categories) ? chart.categories : [];
      const seriesArr: any[] = Array.isArray(chart?.series) ? chart.series : [];
      seriesArr.forEach((s, si) => {
        const namePlaceholder = findPlaceholder(s?.name);
        if (namePlaceholder) blocking.push(`Placeholder text "${namePlaceholder}" found in a chart series name on ${where}.`);
        const values: any[] = Array.isArray(s?.values) ? s.values : [];
        if (categories.length && values.length !== categories.length) {
          blocking.push(
            `${where}: chart series ${si + 1} ("${s?.name ?? ""}") has ${values.length} value(s) but there are ${categories.length} categories — they must match.`
          );
        }
      });
      if (seriesArr.length === 0 || categories.length === 0) {
        blocking.push(`${where}'s chart has no categories or no series — fill in real chart data or remove it.`);
      }
    }

    // layout=timeline
    for (const step of Array.isArray(slide?.steps) ? slide.steps : []) {
      const placeholder = findPlaceholder(step?.label) ?? findPlaceholder(step?.caption);
      if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in a timeline step on ${where}.`);
    }

    // layout=cover fields
    for (const field of [slide?.subtitle, slide?.description]) {
      const placeholder = findPlaceholder(field);
      if (placeholder) blocking.push(`Placeholder text "${placeholder}" found on ${where}.`);
    }
    for (const tag of Array.isArray(slide?.tags) ? slide.tags : []) {
      const placeholder = findPlaceholder(tag);
      if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in a tag on ${where}.`);
    }
    for (const stat of Array.isArray(slide?.stats) ? slide.stats : []) {
      const placeholder = findPlaceholder(stat?.label) ?? findPlaceholder(stat?.caption);
      if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in a stat on ${where}.`);
    }

    // layout=cards
    for (const card of Array.isArray(slide?.cards) ? slide.cards : []) {
      const placeholder = findPlaceholder(card?.heading) ?? findPlaceholder(card?.text);
      if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in a card on ${where}.`);
    }

    // sidebar (layout=cards or table)
    if (slide?.sidebar) {
      const placeholder =
        findPlaceholder(slide.sidebar.title) ?? findPlaceholder(slide.sidebar.text) ?? findPlaceholder(slide.sidebar.quote);
      if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in the sidebar on ${where}.`);
    }
  });

  return result(blocking, warnings);
}

// ---------- xlsx ----------

function looksNumeric(v: unknown): boolean {
  if (typeof v === "number") return true;
  if (typeof v !== "string") return false;
  if (v.startsWith("=")) return false; // formula, not a raw number
  return /^-?\$?\d[\d,]*(\.\d+)?%?$/.test(v.trim());
}

export function checkXlsxQuality(sheets: any[]): QualityCheckResult {
  const blocking: string[] = [];
  const warnings: string[] = [];

  (sheets ?? []).forEach((sheet, i) => {
    const where = `sheet "${sheet?.name || `Sheet${i + 1}`}"`;
    const headers: any[] = Array.isArray(sheet?.headers) ? sheet.headers : [];
    const rows: any[][] = Array.isArray(sheet?.rows) ? sheet.rows : [];

    const headerNames = headers.map((h) => (h && typeof h === "object" ? String(h.name ?? "") : String(h ?? "")));
    for (const name of headerNames) {
      const placeholder = findPlaceholder(name);
      if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in a header of ${where}.`);
    }

    rows.forEach((row, ri) => {
      if (headers.length && Array.isArray(row) && row.length > headers.length) {
        blocking.push(`${where}: row ${ri + 1} has ${row.length} cell(s) but only ${headers.length} header(s) — extra data has no column.`);
      }
      for (const cell of row ?? []) {
        const placeholder = findPlaceholder(cell);
        if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in ${where}, row ${ri + 1}.`);
      }
    });

    if (headers.length > 0 && rows.length === 0) {
      warnings.push(`${where} has headers but no data rows — fine for a template, worth double-checking it wasn't meant to have data.`);
    }

    headers.forEach((h, ci) => {
      if (!h || typeof h !== "object" || h.numberFormat) return;
      const columnValues = rows.map((r) => r[ci]).filter((v) => v !== undefined && v !== null && v !== "");
      if (columnValues.length > 0 && columnValues.every(looksNumeric)) {
        warnings.push(`${where}, column "${headerNames[ci]}" looks numeric but has no numberFormat set — consider one (e.g. '#,##0', '$#,##0.00').`);
      }
    });
  });

  return result(blocking, warnings);
}
