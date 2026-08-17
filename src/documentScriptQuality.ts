/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Post-execution quality gate for run_pptx_script/run_docx_script/run_xlsx_script. Those tools have
 * no pre-render JSON args to check the way create_docx/create_pptx/create_xlsx do (documentQuality.ts
 * operates purely on those args) — a model-written script produces a file directly, so this re-opens
 * the actual rendered output instead.
 *
 * pptx/docx are both zip archives of XML. Text is deliberately extracted by concatenating every text
 * node WITHIN one paragraph/shape before running the placeholder scan, not per XML run: OOXML
 * routinely splits a single sentence — and therefore a placeholder word — across multiple
 * <w:t>/<a:t> runs (spell-check boundaries, manual formatting spans, pptxgenjs's own rich-text
 * handling). A naive per-run scan would silently miss e.g. "TODO" split into
 * "<w:t>TO</w:t><w:t>DO</w:t>", even though the same word would have been caught pre-render as a
 * single JS string by checkPptxQuality/checkBlocksQuality today.
 */
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { findPlaceholder, type QualityCheckResult } from "./documentQuality";

function result(blocking: string[], warnings: string[]): QualityCheckResult {
  return { ok: blocking.length === 0, blocking, warnings };
}

function unescapeXmlEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** For every match of `paragraphRe` (a paragraph/shape-level element), concatenates every text node
 *  matched by `textTagRe` inside it into one string — so text split across multiple runs within the
 *  same paragraph is scanned as a whole, not as separate fragments. */
function extractParagraphTexts(xml: string, paragraphRe: RegExp, textTagRe: RegExp): string[] {
  const texts: string[] = [];
  let pm: RegExpExecArray | null;
  paragraphRe.lastIndex = 0;
  while ((pm = paragraphRe.exec(xml))) {
    const paragraphXml = pm[1] ?? pm[0];
    let combined = "";
    const localTextRe = new RegExp(textTagRe.source, textTagRe.flags);
    let tm: RegExpExecArray | null;
    while ((tm = localTextRe.exec(paragraphXml))) {
      combined += tm[1];
    }
    if (combined) texts.push(unescapeXmlEntities(combined));
  }
  return texts;
}

const DOCX_PARAGRAPH_RE = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
const DOCX_TEXT_RE = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
const PPTX_PARAGRAPH_RE = /<a:p>([\s\S]*?)<\/a:p>/g;
const PPTX_TEXT_RE = /<a:t>([^<]*)<\/a:t>/g;

export async function checkRenderedDocxQuality(buffer: Buffer): Promise<QualityCheckResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err: any) {
    return result([`The generated file isn't a valid .docx (couldn't open it as a zip archive): ${err.message ?? err}`], []);
  }
  const docFile = zip.file("word/document.xml");
  if (!docFile) return result(["The generated file doesn't look like a valid .docx (no word/document.xml found)."], []);
  const xml = await docFile.async("string");

  const blocking: string[] = [];
  const paragraphs = extractParagraphTexts(xml, DOCX_PARAGRAPH_RE, DOCX_TEXT_RE);
  const anyText = paragraphs.some((p) => p.trim().length > 0);
  if (!anyText) blocking.push("The generated document has no visible text in any paragraph — this would produce a blank document.");
  for (const text of paragraphs) {
    const placeholder = findPlaceholder(text);
    if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in the generated document: "${text.slice(0, 120)}"`);
  }
  return result(blocking, []);
}

export async function checkRenderedPptxQuality(buffer: Buffer): Promise<QualityCheckResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err: any) {
    return result([`The generated file isn't a valid .pptx (couldn't open it as a zip archive): ${err.message ?? err}`], []);
  }
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return na - nb;
    });
  if (slideFiles.length === 0) {
    return result(["The generated file doesn't look like a valid .pptx (no ppt/slides/slideN.xml files found) — this would produce an empty deck."], []);
  }

  const blocking: string[] = [];
  let anyText = false;
  for (const name of slideFiles) {
    const xml = await zip.file(name)!.async("string");
    const paragraphs = extractParagraphTexts(xml, PPTX_PARAGRAPH_RE, PPTX_TEXT_RE);
    for (const text of paragraphs) {
      if (text.trim()) anyText = true;
      const placeholder = findPlaceholder(text);
      if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in ${name}: "${text.slice(0, 120)}"`);
    }
  }
  if (!anyText) blocking.push("The generated presentation has no visible text on any slide — this would produce a blank deck.");

  return result(blocking, []);
}

/** Unlike the docx/pptx checks, this reads `filePath` directly rather than a Buffer — exceljs's
 *  own xlsx reader only exposes a file-path/stream API, not an in-memory-buffer parse. Also unlike
 *  the docx/pptx checks, no run-fragmentation concern applies (a spreadsheet cell's text is never
 *  split across XML runs the way a Word/PowerPoint paragraph can be). Formula *result* verification
 *  (e.g. detecting a #REF!/#DIV/0! error) is a known, stated gap — exceljs doesn't evaluate formulas,
 *  and there is no LibreOffice-recalculation step in this design. */
export async function checkRenderedXlsxQuality(filePath: string): Promise<QualityCheckResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch (err: any) {
    return result([`The generated file isn't a valid .xlsx (couldn't open it): ${err.message ?? err}`], []);
  }
  if (workbook.worksheets.length === 0) {
    return result(["The generated workbook has no sheets — this would produce a blank workbook."], []);
  }

  const blocking: string[] = [];
  const warnings: string[] = [];
  let anyContent = false;
  for (const sheet of workbook.worksheets) {
    let rowCount = 0;
    sheet.eachRow((row) => {
      rowCount++;
      row.eachCell((cell) => {
        const text = cell.text != null ? String(cell.text) : "";
        if (text.trim()) anyContent = true;
        const placeholder = findPlaceholder(text);
        if (placeholder) blocking.push(`Placeholder text "${placeholder}" found in sheet "${sheet.name}": "${text.slice(0, 120)}"`);
      });
    });
    if (rowCount === 0) warnings.push(`Sheet "${sheet.name}" has no rows at all.`);
  }
  if (!anyContent) blocking.push("The generated workbook has no visible cell content in any sheet — this would produce a blank workbook.");

  return result(blocking, warnings);
}
