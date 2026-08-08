/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import { PDFParse } from "pdf-parse";
import type { ToolSpec } from "../types";
import { resolveInRoot } from "./paths";

const MAX_OUTPUT_CHARS = 100_000;

/** Parses "1-3,5,8-9" into a sorted, deduplicated array of 1-based page numbers. */
function parsePageRanges(spec: string): number[] {
  const pages = new Set<number>();
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      for (let p = Math.min(start, end); p <= Math.max(start, end); p++) pages.add(p);
    } else if (/^\d+$/.test(trimmed)) {
      pages.add(Number(trimmed));
    }
  }
  return Array.from(pages).sort((a, b) => a - b);
}

export const readPdfTool: ToolSpec = {
  mutating: false,
  definition: {
    type: "function",
    function: {
      name: "read_pdf",
      description:
        "Extract text from a PDF file in the working directory (data room documents, financial statements, " +
        "10-Ks, contracts, etc). Returns each requested page's text labeled by page number. For a large PDF, " +
        "call get_pdf_info first (or just try without `pages`) to see the page count, then page through it with " +
        "`pages` rather than requesting everything at once.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the PDF, relative to the working directory." },
          pages: {
            type: "string",
            description: "Which pages to extract, e.g. '1-3', '5', '1-3,7,10-12'. Omit to extract the whole document.",
          },
        },
        required: ["path"],
      },
    },
  },
  describe: (args) => `read ${args.path}${args.pages ? ` (pages ${args.pages})` : ""}`,
  run: async (args, ctx) => {
    const filePath = resolveInRoot(ctx.root, args.path);
    if (!fs.existsSync(filePath)) {
      return { ok: false, output: `File not found: ${args.path}` };
    }

    let parser: PDFParse | undefined;
    try {
      const buffer = fs.readFileSync(filePath);
      parser = new PDFParse({ data: buffer });

      const requestedPages = typeof args.pages === "string" && args.pages.trim() ? parsePageRanges(args.pages) : undefined;
      if (typeof args.pages === "string" && args.pages.trim() && (!requestedPages || requestedPages.length === 0)) {
        return { ok: false, output: `Couldn't parse page range "${args.pages}" — use a format like "1-3" or "1,4,7-9".` };
      }

      const result = await parser.getText(requestedPages ? { partial: requestedPages } : undefined);

      if (requestedPages && result.total > 0) {
        const outOfRange = requestedPages.filter((p) => p < 1 || p > result.total);
        if (outOfRange.length) {
          return {
            ok: false,
            output: `Page(s) ${outOfRange.join(", ")} don't exist — this PDF only has ${result.total} page(s).`,
          };
        }
      }

      if (!requestedPages && result.total > 0) {
        const fullLength = result.pages.reduce((sum, p) => sum + p.text.length, 0);
        if (fullLength > MAX_OUTPUT_CHARS) {
          return {
            ok: false,
            output:
              `This PDF has ${result.total} pages and ${fullLength} characters of text — too large to read in full. ` +
              `Re-call with a \`pages\` range (e.g. "1-10") to page through it.`,
          };
        }
      }

      const body = result.pages.map((p) => `--- Page ${p.num} of ${result.total} ---\n${p.text.trim() || "(no extractable text on this page)"}`).join("\n\n");
      const truncated = body.length > MAX_OUTPUT_CHARS;
      const output = truncated ? body.slice(0, MAX_OUTPUT_CHARS) + `\n\n... (truncated — narrow the \`pages\` range)` : body;

      return { ok: true, output: output || "(no extractable text — this PDF may be scanned images without OCR)" };
    } catch (err: any) {
      return { ok: false, output: `Failed to read PDF ${args.path}: ${err.message ?? err}` };
    } finally {
      if (parser) await parser.destroy();
    }
  },
};
