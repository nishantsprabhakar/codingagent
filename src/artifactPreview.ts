/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Server-side rendering for the web UI's left-side artifact preview panel. Images/PDFs are handled
 * client-side directly against /api/download (a blob URL is all they need); this module covers the
 * three formats that need real parsing before they're previewable at all: xlsx (grid of cells),
 * docx/pptx (both zip-of-XML formats — reuses documentScriptQuality.ts's paragraph-concatenation
 * extraction pattern so text split across multiple <w:t>/<a:t> runs isn't mangled into fragments).
 */
import JSZip from "jszip";
import ExcelJS from "exceljs";

export type ArtifactPreview =
  | { kind: "xlsx"; sheets: Array<{ name: string; rows: string[][] }> }
  | { kind: "docx"; paragraphs: string[] }
  | { kind: "pptx"; slides: string[][] }
  | { kind: "unsupported"; reason: string };

const DOCX_PARAGRAPH_RE = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
const DOCX_TEXT_RE = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
const PPTX_PARAGRAPH_RE = /<a:p>([\s\S]*?)<\/a:p>/g;
const PPTX_TEXT_RE = /<a:t>([^<]*)<\/a:t>/g;
const MAX_PREVIEW_ROWS = 500;

function unescapeXmlEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

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
    texts.push(unescapeXmlEntities(combined));
  }
  return texts;
}

async function previewXlsx(buffer: Buffer): Promise<ArtifactPreview> {
  const workbook = new ExcelJS.Workbook();
  // Cast needed: this repo has multiple conflicting @types/node copies pulled in by other
  // dependencies (docx, pptxgenjs each vendor their own), so TS sees two structurally-similar
  // but nominally distinct global `Buffer` types here even though there's only one at runtime.
  await workbook.xlsx.load(buffer as any);
  const sheets = workbook.worksheets.map((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      if (rows.length >= MAX_PREVIEW_ROWS) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value;
        cells.push(v == null ? "" : typeof v === "object" && "result" in (v as any) ? String((v as any).result ?? "") : String(v));
      });
      rows.push(cells);
    });
    return { name: sheet.name, rows };
  });
  return { kind: "xlsx", sheets };
}

async function previewDocx(buffer: Buffer): Promise<ArtifactPreview> {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) return { kind: "unsupported", reason: "not a valid .docx (no word/document.xml)" };
  const xml = await docFile.async("string");
  const paragraphs = extractParagraphTexts(xml, DOCX_PARAGRAPH_RE, DOCX_TEXT_RE);
  return { kind: "docx", paragraphs };
}

async function previewPptx(buffer: Buffer): Promise<ArtifactPreview> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0));
  if (slideFiles.length === 0) return { kind: "unsupported", reason: "not a valid .pptx (no slides found)" };
  const slides: string[][] = [];
  for (const name of slideFiles) {
    const xml = await zip.file(name)!.async("string");
    slides.push(extractParagraphTexts(xml, PPTX_PARAGRAPH_RE, PPTX_TEXT_RE).filter((t) => t.trim()));
  }
  return { kind: "pptx", slides };
}

/** `ext` is the lowercased file extension without the dot. Returns `null` for formats this module
 *  doesn't parse (images/pdf render directly client-side from the raw file, no server parsing needed). */
export async function buildArtifactPreview(buffer: Buffer, ext: string): Promise<ArtifactPreview | null> {
  try {
    if (ext === "xlsx") return await previewXlsx(buffer);
    if (ext === "docx") return await previewDocx(buffer);
    if (ext === "pptx") return await previewPptx(buffer);
    return null;
  } catch (err: any) {
    return { kind: "unsupported", reason: err.message ?? String(err) };
  }
}
