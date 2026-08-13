/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Phase 7 — create_markdown/create_html/create_pdf, the three new flowing-document tools sharing
 * the same DocSpec (documentIR.ts) as create_docx (tools/documents.ts). Kept in their own file
 * rather than appended to the already-1073-line documents.ts.
 */
import * as fs from "fs";
import * as path from "path";
import type { ToolSpec } from "../types";
import { resolveInRoot } from "./paths";
import { checkBlocksHaveContent, summarizeBlocks, blocksPropertySchema, accentColorPropertySchema, type DocSpec } from "../documentIR";
import { checkBlocksQuality, type QualityCheckResult } from "../documentQuality";
import { compileToMarkdown } from "../documentCompilers/toMarkdown";
import { compileToHtml } from "../documentCompilers/toHtml";
import { compileToPdf } from "../documentCompilers/toPdf";

function buildSpec(args: any): DocSpec {
  return { title: args.title, accentColor: args.accentColor, blocks: args.blocks ?? [] };
}

type GateResult =
  | { ok: false; output: string; qualityGate: { name: string; ok: false; output: string } }
  | { ok: true; quality: QualityCheckResult };

/** Runs the shared empty-content + structural quality gate once per call (not once per check site) — the
 *  caller uses `.quality.warnings` on the passing path instead of recomputing checkBlocksQuality itself. */
function runQualityGate(args: any, gateName: string): GateResult {
  const emptyCheck = checkBlocksHaveContent(args.blocks);
  if (emptyCheck) return { ok: false, output: emptyCheck, qualityGate: { name: gateName, ok: false, output: emptyCheck } };

  const quality = checkBlocksQuality(args.blocks ?? []);
  if (!quality.ok) {
    const output = quality.blocking.join("\n");
    return { ok: false, output, qualityGate: { name: gateName, ok: false, output } };
  }
  return { ok: true, quality };
}

export const createMarkdownTool: ToolSpec = {
  mutating: true,
  definition: {
    type: "function",
    function: {
      name: "create_markdown",
      description:
        "Create a Markdown (.md) file from structured content blocks — the same `blocks` shape as create_docx. " +
        "`blocks` must contain the actual, complete content the user asked for — never call this with an empty or " +
        "placeholder body. Text fields support inline markup: **bold**, _italic_, __underline__, ~~strikethrough~~ " +
        "(underline renders as raw <u> HTML, since Markdown has no native underline syntax). A `pagebreak` block " +
        "renders as a thematic break (---), since Markdown has no page concept. A `toc` block renders as a plain, " +
        "unlinked list of section headings (Markdown heading anchors aren't reliably supported across renderers) " +
        "— use create_html or create_pdf instead if you need real clickable navigation.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Output path relative to the working directory, ending in .md" },
          title: { type: "string", description: "Document title, rendered as a top-level heading." },
          blocks: blocksPropertySchema(),
        },
        required: ["path", "blocks"],
      },
    },
  },
  describe: (args) => `create ${args.path}`,
  preview: async (args) => summarizeBlocks(args.path, args.title, args.blocks, "Markdown file"),
  run: async (args, ctx) => {
    const gate = runQualityGate(args, "markdown quality gate");
    if (!gate.ok) return gate;

    const filePath = resolveInRoot(ctx.root, args.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    let compiled: { content: string; warnings: string[] };
    try {
      compiled = compileToMarkdown(buildSpec(args), ctx.root);
    } catch (err: any) {
      const message = err.message ?? String(err);
      return { ok: false, output: message, qualityGate: { name: "markdown quality gate", ok: false, output: message } };
    }

    fs.writeFileSync(filePath, compiled.content, "utf-8");
    const allWarnings = [...gate.quality.warnings, ...compiled.warnings];
    const warningSuffix = allWarnings.length ? `\nQuality notes: ${allWarnings.join(" ")}` : "";
    return {
      ok: true,
      output: `Created ${args.path} (${(args.blocks ?? []).length} content blocks, ${compiled.content.length} bytes).${warningSuffix}`,
      qualityGate: { name: "markdown quality gate", ok: true, output: allWarnings.join("\n") },
    };
  },
};

export const createHtmlTool: ToolSpec = {
  mutating: true,
  definition: {
    type: "function",
    function: {
      name: "create_html",
      description:
        "Create a self-contained HTML (.html) file from structured content blocks — the same `blocks` shape as " +
        "create_docx. `blocks` must contain the actual, complete content the user asked for — never call this with " +
        "an empty or placeholder body. Text fields support inline markup: **bold**, _italic_, __underline__, " +
        "~~strikethrough~~. Images are embedded directly (no separate image files to ship alongside it). A `toc` " +
        "block renders as a list of clickable links that jump to each section — unlike create_docx's table of " +
        "contents, these have no page numbers (HTML has no page concept outside of printing). A `pagebreak` block " +
        "is invisible when viewed in a browser but forces a real page break if the file is printed or converted " +
        "to PDF.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Output path relative to the working directory, ending in .html" },
          title: { type: "string", description: "Document title, used as the page <title> and a top-level heading." },
          accentColor: accentColorPropertySchema(),
          blocks: blocksPropertySchema(),
        },
        required: ["path", "blocks"],
      },
    },
  },
  describe: (args) => `create ${args.path}`,
  preview: async (args) => summarizeBlocks(args.path, args.title, args.blocks, "HTML file"),
  run: async (args, ctx) => {
    const gate = runQualityGate(args, "html quality gate");
    if (!gate.ok) return gate;

    const filePath = resolveInRoot(ctx.root, args.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    let compiled: { content: string; warnings: string[] };
    try {
      compiled = compileToHtml(buildSpec(args), ctx.root);
    } catch (err: any) {
      const message = err.message ?? String(err);
      return { ok: false, output: message, qualityGate: { name: "html quality gate", ok: false, output: message } };
    }

    fs.writeFileSync(filePath, compiled.content, "utf-8");
    const allWarnings = [...gate.quality.warnings, ...compiled.warnings];
    const warningSuffix = allWarnings.length ? `\nQuality notes: ${allWarnings.join(" ")}` : "";
    return {
      ok: true,
      output: `Created ${args.path} (${(args.blocks ?? []).length} content blocks, ${compiled.content.length} bytes).${warningSuffix}`,
      qualityGate: { name: "html quality gate", ok: true, output: allWarnings.join("\n") },
    };
  },
};

export const createPdfTool: ToolSpec = {
  mutating: true,
  definition: {
    type: "function",
    function: {
      name: "create_pdf",
      description:
        "Create a PDF (.pdf) file from structured content blocks — the same `blocks` shape as create_docx, " +
        "rendered via a real browser layout engine for accurate page breaks and table layout. `blocks` must " +
        "contain the actual, complete content the user asked for — never call this with an empty or placeholder " +
        "body. Text fields support inline markup: **bold**, _italic_, __underline__, ~~strikethrough~~. A `toc` " +
        "block renders as a list of clickable links that jump to each section (no page numbers, unlike " +
        "create_docx's table of contents). A `pagebreak` block forces a real page break.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Output path relative to the working directory, ending in .pdf" },
          title: { type: "string", description: "Document title, rendered as a top-level heading." },
          accentColor: accentColorPropertySchema(),
          blocks: blocksPropertySchema(),
        },
        required: ["path", "blocks"],
      },
    },
  },
  describe: (args) => `create ${args.path}`,
  preview: async (args) => summarizeBlocks(args.path, args.title, args.blocks, "PDF file"),
  run: async (args, ctx) => {
    const gate = runQualityGate(args, "pdf quality gate");
    if (!gate.ok) return gate;

    const filePath = resolveInRoot(ctx.root, args.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const compiled = await compileToPdf(buildSpec(args), ctx.root);
    if (!compiled.ok) {
      return { ok: false, output: compiled.error, qualityGate: { name: "pdf quality gate", ok: false, output: compiled.error } };
    }

    fs.writeFileSync(filePath, compiled.buffer);
    const allWarnings = [...gate.quality.warnings, ...compiled.warnings];
    const warningSuffix = allWarnings.length ? `\nQuality notes: ${allWarnings.join(" ")}` : "";
    return {
      ok: true,
      output: `Created ${args.path} (${(args.blocks ?? []).length} content blocks, ${compiled.buffer.length} bytes).${warningSuffix}`,
      qualityGate: { name: "pdf quality gate", ok: true, output: allWarnings.join("\n") },
    };
  },
};
