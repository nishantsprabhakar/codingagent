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
} from "docx";
import PptxGenJS from "pptxgenjs";
import ExcelJS from "exceljs";
import type { ToolSpec } from "../types";
import { resolveInRoot } from "./paths";

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

// ---------- Word (.docx) ----------

export const createDocxTool: ToolSpec = {
  mutating: true,
  definition: {
    type: "function",
    function: {
      name: "create_docx",
      description:
        "Create a well-formatted Word (.docx) document from structured content blocks. Use this instead of " +
        "write_file for any Word document request. `blocks` must contain the actual, complete content the user " +
        "asked for — never call this with an empty or placeholder body.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Output path relative to the working directory, ending in .docx" },
          title: { type: "string", description: "Document title, rendered as a large title heading at the top." },
          blocks: {
            type: "array",
            description: "Ordered content blocks making up the document body.",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["heading", "paragraph", "bullets", "table"] },
                level: { type: "number", description: "Heading level 1-6 (type=heading only)." },
                text: { type: "string", description: "Text content (type=heading or paragraph)." },
                items: { type: "array", items: { type: "string" }, description: "Bullet list items (type=bullets)." },
                headers: { type: "array", items: { type: "string" }, description: "Table header row (type=table)." },
                rows: {
                  type: "array",
                  items: { type: "array", items: { type: "string" } },
                  description: "Table body rows, each an array of cell strings (type=table).",
                },
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

    const filePath = resolveInRoot(ctx.root, args.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const children: (Paragraph | Table)[] = [];
    if (args.title) children.push(new Paragraph({ text: String(args.title), heading: HeadingLevel.TITLE }));

    for (const block of args.blocks ?? []) {
      if (block.type === "heading") {
        const idx = Math.min(Math.max((block.level ?? 1) - 1, 0), HEADING_LEVELS.length - 1);
        children.push(new Paragraph({ text: block.text ?? "", heading: HEADING_LEVELS[idx] }));
      } else if (block.type === "paragraph") {
        children.push(new Paragraph({ children: [new TextRun(block.text ?? "")] }));
      } else if (block.type === "bullets") {
        for (const item of block.items ?? []) {
          children.push(new Paragraph({ text: String(item), bullet: { level: 0 } }));
        }
      } else if (block.type === "table") {
        const headers: string[] = block.headers ?? [];
        const rows: string[][] = block.rows ?? [];
        const tableRows: TableRow[] = [];
        if (headers.length) {
          tableRows.push(
            new TableRow({
              tableHeader: true,
              children: headers.map(
                (h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(h), bold: true })] })] })
              ),
            })
          );
        }
        for (const row of rows) {
          tableRows.push(new TableRow({ children: row.map((cell) => new TableCell({ children: [new Paragraph(String(cell))] })) }));
        }
        if (tableRows.length) children.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      }
    }

    const doc = new Document({ sections: [{ children }] });
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
    if (b.type === "bullets") return Array.isArray(b.items) && b.items.some((i: any) => String(i).trim().length > 0);
    if (b.type === "table") return (Array.isArray(b.headers) && b.headers.length > 0) || (Array.isArray(b.rows) && b.rows.length > 0);
    return false;
  });
  if (!hasContent) {
    return "Every block is empty (no text/items/rows) — this would create a near-blank document. Fill in the " +
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

export const createPptxTool: ToolSpec = {
  mutating: true,
  definition: {
    type: "function",
    function: {
      name: "create_pptx",
      description:
        "Create a well-formatted PowerPoint (.pptx) presentation from a list of slides, each with a title and " +
        "optional bullet points and speaker notes. `slides` must contain the actual content the user asked for " +
        "— never call this with empty or placeholder slides.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Output path relative to the working directory, ending in .pptx" },
          slides: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                bullets: { type: "array", items: { type: "string" } },
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

    const filePath = resolveInRoot(ctx.root, args.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const pres = new PptxGenJS();
    for (const slideSpec of args.slides ?? []) {
      const slide = pres.addSlide();
      if (slideSpec.title) {
        slide.addText(String(slideSpec.title), { x: 0.5, y: 0.35, w: 9, h: 1, fontSize: 28, bold: true, color: "1F2937" });
      }
      const bullets: string[] = slideSpec.bullets ?? [];
      if (bullets.length) {
        slide.addText(
          bullets.map((b) => ({ text: String(b), options: { bullet: true, breakLine: true } })),
          { x: 0.5, y: 1.6, w: 9, h: 5, fontSize: 18, color: "374151", valign: "top" }
        );
      }
      if (slideSpec.notes) slide.addNotes(String(slideSpec.notes));
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
    (s) => (typeof s.title === "string" && s.title.trim().length > 0) || (Array.isArray(s.bullets) && s.bullets.some((b: any) => String(b).trim().length > 0))
  );
  if (!hasContent) {
    return "Every slide is empty (no title or bullets) — this would create a blank presentation. Fill in the " +
      "actual content, then call this tool again.";
  }
  return null;
}

// ---------- Excel (.xlsx) ----------

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
          sheets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Sheet name (defaults to Sheet1, Sheet2, ...)." },
                headers: { type: "array", items: { type: "string" }, description: "Bold header row." },
                rows: {
                  type: "array",
                  items: { type: "array", items: {} },
                  description: "Data rows, each an array of cell values (string or number).",
                },
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

    const filePath = resolveInRoot(ctx.root, args.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const workbook = new ExcelJS.Workbook();
    const sheetSpecs = args.sheets ?? [];

    sheetSpecs.forEach((sheetSpec: any, i: number) => {
      const sheet = workbook.addWorksheet(sheetSpec.name || `Sheet${i + 1}`);
      const headers: string[] = sheetSpec.headers ?? [];
      const rows: any[][] = sheetSpec.rows ?? [];

      if (headers.length) {
        const headerRow = sheet.addRow(headers);
        headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
        headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
        headerRow.alignment = { vertical: "middle" };
        sheet.views = [{ state: "frozen", ySplit: 1 }];
      }
      for (const row of rows) sheet.addRow(row);

      const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
      for (let c = 0; c < colCount; c++) {
        const headerLen = String(headers[c] ?? "").length;
        const maxCellLen = rows.reduce((m, r) => Math.max(m, String(r[c] ?? "").length), 0);
        sheet.getColumn(c + 1).width = Math.min(50, Math.max(10, Math.max(headerLen, maxCellLen) + 3));
      }
    });

    await workbook.xlsx.writeFile(filePath);
    const stat = fs.statSync(filePath);
    return { ok: true, output: `Created ${args.path} (${sheetSpecs.length} sheet(s), ${stat.size} bytes)` };
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
