/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Server-side rendering for the web UI's left-side artifact preview panel. Images/PDFs are handled
 * client-side directly against /api/download (a blob URL is all they need); this module covers the
 * three formats that need real parsing before they're previewable at all, and aims for an actual
 * visual approximation of the file rather than a flat text dump:
 *  - docx: converted to real semantic HTML via mammoth (headings, bold/italic, lists, tables, images)
 *  - xlsx: a styled grid carrying each cell's real fill/font/border/alignment/merges
 *  - pptx: each slide reconstructed as absolutely-positioned shapes (text/image/table) from the raw
 *    slide XML's shape geometry, fill, and run formatting — not pixel-perfect (no theme/gradient/
 *    group-transform resolution — see previewPptx's doc comment) but a real layout, not bullet text.
 */
import JSZip from "jszip";
import ExcelJS from "exceljs";
import mammoth from "mammoth";

export interface XlsxCell {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  fill?: string;
  align?: string;
  /** Number of columns this cell's rendered <td> should span (merged cell) — omitted means 1. */
  colspan?: number;
  rowspan?: number;
}

export interface PptxTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  sizePt?: number;
}

export interface PptxParagraph {
  align?: "l" | "ctr" | "r" | "just";
  runs: PptxTextRun[];
}

export type PptxShape =
  | { kind: "text"; x: number; y: number; w: number; h: number; fill?: string; radius?: "round" | "ellipse" | "rect"; paragraphs: PptxParagraph[] }
  | { kind: "image"; x: number; y: number; w: number; h: number; src: string }
  | { kind: "table"; x: number; y: number; w: number; h: number; rows: string[][] };

export interface PptxSlide {
  background?: string;
  shapes: PptxShape[];
}

export type ArtifactPreview =
  | { kind: "xlsx"; sheets: Array<{ name: string; rows: XlsxCell[][] }> }
  | { kind: "docx"; html: string }
  | { kind: "pptx"; slideWidthPt: number; slideHeightPt: number; slides: PptxSlide[] }
  | { kind: "unsupported"; reason: string };

const MAX_PREVIEW_ROWS = 500;
const MAX_PREVIEW_SLIDES = 200;
/** 914400 EMU per inch, 72pt per inch — used to convert OOXML's native EMU geometry to points, which
 *  the client renders as percentages of the slide's own point dimensions. */
const EMU_PER_PT = 914400 / 72;

function unescapeXmlEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

// ---------- xlsx: real cell styling ----------

function argbToHex(argb: string | undefined): string | undefined {
  if (!argb || argb.length < 6) return undefined;
  return argb.slice(-6).toUpperCase();
}

async function previewXlsx(buffer: Buffer): Promise<ArtifactPreview> {
  const workbook = new ExcelJS.Workbook();
  // Cast needed: this repo has multiple conflicting @types/node copies pulled in by other
  // dependencies (docx, pptxgenjs each vendor their own), so TS sees two structurally-similar
  // but nominally distinct global `Buffer` types here even though there's only one at runtime.
  await workbook.xlsx.load(buffer as any);

  const sheets = workbook.worksheets.map((sheet) => {
    // model.merges is a list of "A1:B2"-style ranges — build a lookup of which cell is the
    // top-left anchor of a merge (gets the colspan/rowspan) vs. one absorbed into it (skipped
    // entirely, since a real merged cell in HTML is one <td> with a span, not N empty <td>s).
    const merges = (sheet.model as any)?.merges ?? [];
    const anchorSpan = new Map<string, { colspan: number; rowspan: number }>();
    const absorbed = new Set<string>();
    for (const range of merges as string[]) {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
      if (!m) continue;
      const colToNum = (col: string) => col.split("").reduce((acc, c) => acc * 26 + (c.charCodeAt(0) - 64), 0);
      const c1 = colToNum(m[1]);
      const r1 = Number(m[2]);
      const c2 = colToNum(m[3]);
      const r2 = Number(m[4]);
      anchorSpan.set(`${r1},${c1}`, { colspan: c2 - c1 + 1, rowspan: r2 - r1 + 1 });
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (!(r === r1 && c === c1)) absorbed.add(`${r},${c}`);
    }

    const rows: XlsxCell[][] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rows.length >= MAX_PREVIEW_ROWS) return;
      const cells: XlsxCell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (absorbed.has(`${rowNumber},${colNumber}`)) return;
        const v = cell.value;
        const text = v == null ? "" : typeof v === "object" && "result" in (v as any) ? String((v as any).result ?? "") : String(v);
        const span = anchorSpan.get(`${rowNumber},${colNumber}`);
        const fill = cell.fill?.type === "pattern" ? argbToHex((cell.fill as any).fgColor?.argb) : undefined;
        const out: XlsxCell = { text };
        if (cell.font?.bold) out.bold = true;
        if (cell.font?.italic) out.italic = true;
        const fontColor = argbToHex(cell.font?.color?.argb);
        if (fontColor) out.color = fontColor;
        if (fill) out.fill = fill;
        if (cell.alignment?.horizontal) out.align = cell.alignment.horizontal;
        if (span && span.colspan > 1) out.colspan = span.colspan;
        if (span && span.rowspan > 1) out.rowspan = span.rowspan;
        cells.push(out);
      });
      rows.push(cells);
    });
    return { name: sheet.name, rows };
  });
  return { kind: "xlsx", sheets };
}

// ---------- docx: real HTML via mammoth ----------

/** Defense-in-depth only — mammoth's own HTML builder already escapes text content, this just
 *  guards against a hypothetical escaping bug putting a live <script>/event-handler into our own
 *  page, since the source .docx is arbitrary project content, not something this app authored. */
function stripActiveHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, "").replace(/\son\w+='[^']*'/gi, "");
}

async function previewDocx(buffer: Buffer): Promise<ArtifactPreview> {
  const result = await mammoth.convertToHtml({ buffer } as any);
  return { kind: "docx", html: stripActiveHtml(result.value) };
}

// ---------- pptx: real slide-shape reconstruction ----------

/**
 * Reconstructs each slide's real layout from its raw shape geometry instead of flattening it to a
 * bullet list. Deliberate scope limits, documented rather than silently wrong:
 *  - Only `<a:srgbClr>` fill/text colors are resolved; `<a:schemeClr>` (theme colors) and gradients
 *    fall back to no fill / default text color — resolving the full theme1.xml + master/layout
 *    inheritance chain is a much larger undertaking for a preview panel.
 *  - Shape geometry (`<a:xfrm>`) is read as-is even for shapes nested inside a `<p:grpSp>` group,
 *    which in real OOXML is relative to the group's own child coordinate space, not the slide — for
 *    decks that use true nested groups this can misplace those shapes. Wrexlyn's own create_pptx
 *    (pptxgenjs) doesn't emit grouped shapes for its primitives, so this only affects group-heavy
 *    decks authored elsewhere.
 *  - Charts render as a labeled placeholder box (extracting real chart data here would mean parsing
 *    a whole separate chartN.xml + embedded workbook).
 */
const SHAPE_BLOCK_RE = /<p:sp>[\s\S]*?<\/p:sp>|<p:pic>[\s\S]*?<\/p:pic>|<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g;
const XFRM_OFF_RE = /<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>/;
const XFRM_EXT_RE = /<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/;
const SPPR_RE = /<p:spPr>([\s\S]*?)<\/p:spPr>/;
const PRSTGEOM_RE = /<a:prstGeom\s+prst="(\w+)"/;
const PARAGRAPH_RE = /<a:p>([\s\S]*?)<\/a:p>/g;
const PARA_ALIGN_RE = /<a:pPr[^>]*\balgn="(\w+)"/;
const RUN_RE = /<a:r>([\s\S]*?)<\/a:r>/g;
const RUN_PROPS_RE = /<a:rPr([^>]*)(?:\/>|>([\s\S]*?)<\/a:rPr>)/;
const RUN_TEXT_RE = /<a:t>([^<]*)<\/a:t>/;
const SRGB_RE = /<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/;
const BLIP_EMBED_RE = /<a:blip\s+r:embed="(rId\d+)"/;
const TBL_ROW_RE = /<a:tr[^>]*>([\s\S]*?)<\/a:tr>/g;
const TBL_CELL_RE = /<a:tc>([\s\S]*?)<\/a:tc>/g;

function parseXfrm(shapeXml: string, slideW: number, slideH: number): { x: number; y: number; w: number; h: number } | null {
  const off = XFRM_OFF_RE.exec(shapeXml);
  const ext = XFRM_EXT_RE.exec(shapeXml);
  if (!off || !ext) return null;
  const [x, y, cx, cy] = [Number(off[1]), Number(off[2]), Number(ext[1]), Number(ext[2])];
  return { x: (x / slideW) * 100, y: (y / slideH) * 100, w: (cx / slideW) * 100, h: (cy / slideH) * 100 };
}

function parseShapeFill(shapeXml: string): string | undefined {
  const sppr = SPPR_RE.exec(shapeXml)?.[1];
  if (!sppr) return undefined;
  // Scope the search to before any <a:ln> (outline/stroke) block, which has its own independent
  // solidFill for the border color — without this cutoff a stroke color could be misread as the fill.
  const beforeLn = sppr.split(/<a:ln[\s>]/)[0];
  return SRGB_RE.exec(beforeLn)?.[1]?.toUpperCase();
}

function parseShapeRadius(shapeXml: string): "round" | "ellipse" | "rect" | undefined {
  const prst = PRSTGEOM_RE.exec(shapeXml)?.[1];
  if (!prst) return undefined;
  if (prst === "ellipse") return "ellipse";
  if (/round/i.test(prst)) return "round";
  return "rect";
}

function parseRunProps(propsXml: string | undefined): { bold?: boolean; italic?: boolean; underline?: boolean; color?: string; sizePt?: number } {
  if (!propsXml) return {};
  const out: { bold?: boolean; italic?: boolean; underline?: boolean; color?: string; sizePt?: number } = {};
  if (/\bb="1"/.test(propsXml)) out.bold = true;
  if (/\bi="1"/.test(propsXml)) out.italic = true;
  if (/\bu="(?!none)/.test(propsXml)) out.underline = true;
  const sz = /\bsz="(\d+)"/.exec(propsXml);
  if (sz) out.sizePt = Number(sz[1]) / 100;
  const color = SRGB_RE.exec(propsXml);
  if (color) out.color = color[1].toUpperCase();
  return out;
}

function parseParagraphs(txBodyXml: string): PptxParagraph[] {
  const paragraphs: PptxParagraph[] = [];
  let pm: RegExpExecArray | null;
  PARAGRAPH_RE.lastIndex = 0;
  while ((pm = PARAGRAPH_RE.exec(txBodyXml))) {
    const paraXml = pm[1];
    const align = PARA_ALIGN_RE.exec(paraXml)?.[1] as PptxParagraph["align"] | undefined;
    const runs: PptxTextRun[] = [];
    let rm: RegExpExecArray | null;
    const runRe = new RegExp(RUN_RE.source, RUN_RE.flags);
    while ((rm = runRe.exec(paraXml))) {
      const runXml = rm[1];
      const text = RUN_TEXT_RE.exec(runXml)?.[1];
      if (text == null) continue;
      const propsMatch = RUN_PROPS_RE.exec(runXml);
      const props = parseRunProps(propsMatch ? propsMatch[1] + (propsMatch[2] ?? "") : undefined);
      runs.push({ text: unescapeXmlEntities(text), ...props });
    }
    if (runs.length) paragraphs.push({ align, runs });
  }
  return paragraphs;
}

function parseTableRows(shapeXml: string): string[][] {
  const rows: string[][] = [];
  let rm: RegExpExecArray | null;
  TBL_ROW_RE.lastIndex = 0;
  while ((rm = TBL_ROW_RE.exec(shapeXml))) {
    const rowXml = rm[1];
    const cells: string[] = [];
    let cm: RegExpExecArray | null;
    const cellRe = new RegExp(TBL_CELL_RE.source, TBL_CELL_RE.flags);
    while ((cm = cellRe.exec(rowXml))) {
      const text = parseParagraphs(cm[1])
        .map((p) => p.runs.map((r) => r.text).join(""))
        .join(" ");
      cells.push(text);
    }
    rows.push(cells);
  }
  return rows;
}

async function resolveSlideImage(
  zip: JSZip,
  slideName: string,
  rId: string,
  relsCache: Map<string, Map<string, string>>
): Promise<string | undefined> {
  const relsPath = slideName.replace(/^ppt\/slides\/(.+)$/, "ppt/slides/_rels/$1.rels");
  let rels = relsCache.get(relsPath);
  if (!rels) {
    rels = new Map();
    const relsFile = zip.file(relsPath);
    if (relsFile) {
      const xml = await relsFile.async("string");
      const re = /<Relationship\s+Id="(rId\d+)"[^>]*Target="([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml))) rels.set(m[1], m[2]);
    }
    relsCache.set(relsPath, rels);
  }
  const target = rels.get(rId);
  if (!target) return undefined;
  const mediaPath = new URL(target, "zip:///ppt/slides/x").pathname.replace(/^\//, "");
  const mediaFile = zip.file(mediaPath);
  if (!mediaFile) return undefined;
  const bytes = await mediaFile.async("nodebuffer");
  const ext = mediaPath.split(".").pop()?.toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : "image/png";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function previewPptx(buffer: Buffer): Promise<ArtifactPreview> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0));
  if (slideFiles.length === 0) return { kind: "unsupported", reason: "not a valid .pptx (no slides found)" };

  const presXml = (await zip.file("ppt/presentation.xml")?.async("string")) ?? "";
  const sldSz = /<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/.exec(presXml);
  const slideWidthEmu = sldSz ? Number(sldSz[1]) : 12192000;
  const slideHeightEmu = sldSz ? Number(sldSz[2]) : 6858000;

  const relsCache = new Map<string, Map<string, string>>();
  const slides: PptxSlide[] = [];

  for (const name of slideFiles.slice(0, MAX_PREVIEW_SLIDES)) {
    const xml = await zip.file(name)!.async("string");
    const bg = /<p:bg>[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/.exec(xml)?.[1];
    const shapes: PptxShape[] = [];

    let m: RegExpExecArray | null;
    SHAPE_BLOCK_RE.lastIndex = 0;
    while ((m = SHAPE_BLOCK_RE.exec(xml))) {
      const block = m[0];
      const pos = parseXfrm(block, slideWidthEmu, slideHeightEmu);
      if (!pos) continue;

      if (block.startsWith("<p:pic>")) {
        const rId = BLIP_EMBED_RE.exec(block)?.[1];
        const src = rId ? await resolveSlideImage(zip, name, rId, relsCache) : undefined;
        if (src) shapes.push({ kind: "image", ...pos, src });
        continue;
      }

      if (block.startsWith("<p:graphicFrame>")) {
        if (block.includes("<a:tbl>")) {
          const rows = parseTableRows(block);
          if (rows.length) shapes.push({ kind: "table", ...pos, rows });
        } else {
          // Chart or other embedded object — no lightweight way to render it faithfully here.
          shapes.push({
            kind: "text",
            ...pos,
            fill: "F3F4F6",
            paragraphs: [{ align: "ctr", runs: [{ text: "[chart]", color: "6B7280", italic: true }] }],
          });
        }
        continue;
      }

      // <p:sp>
      const txBodyMatch = /<p:txBody>([\s\S]*?)<\/p:txBody>/.exec(block);
      const paragraphs = txBodyMatch ? parseParagraphs(txBodyMatch[1]) : [];
      const fill = parseShapeFill(block);
      const radius = parseShapeRadius(block);
      if (paragraphs.length || fill) {
        shapes.push({ kind: "text", ...pos, fill, radius, paragraphs });
      }
    }

    slides.push({ background: bg?.toUpperCase(), shapes });
  }

  return { kind: "pptx", slideWidthPt: slideWidthEmu / EMU_PER_PT, slideHeightPt: slideHeightEmu / EMU_PER_PT, slides };
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
