/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import JSZip from "jszip";
import type { ToolSpec } from "../types";
import { resolveInRoot } from "./paths";

const AUTHOR = "Wrexlyn Agent";

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function xmlUnescape(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

// Matches a <w:r>...</w:r> run whose body is exactly an optional <w:rPr> followed by a
// single <w:t>plain text</w:t> — i.e. the common case of one contiguous, simply-formatted
// piece of text. Runs with tabs, breaks, drawings, or multiple text nodes are left alone;
// a target string that Word happens to have split across several such runs won't be found,
// same as how edit_file requires old_string to match a file's actual text exactly.
const SIMPLE_RUN_RE = /<w:r(\s[^>]*)?>\s*(?:(<w:rPr>[\s\S]*?<\/w:rPr>)\s*)?<w:t([^>]*)>([^<]*)<\/w:t>\s*<\/w:r>/g;

interface RunMatch {
  fullMatch: string;
  rAttrs: string;
  rPr: string;
  tAttrs: string;
  text: string;
  index: number;
}

function findSimpleRuns(documentXml: string): RunMatch[] {
  const matches: RunMatch[] = [];
  SIMPLE_RUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SIMPLE_RUN_RE.exec(documentXml))) {
    matches.push({
      fullMatch: m[0],
      rAttrs: m[1] ?? "",
      rPr: m[2] ?? "",
      tAttrs: m[3] ?? "",
      text: xmlUnescape(m[4]),
      index: m.index,
    });
  }
  return matches;
}

function nextRevisionId(documentXml: string): number {
  let max = 9000;
  for (const m of documentXml.matchAll(/w:id="(\d+)"/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Applies one redline; returns the new document.xml and count of replacements, or an error string. */
function applyRedline(
  documentXml: string,
  oldString: string,
  newString: string,
  replaceAll: boolean
): { xml: string; count: number } | { error: string } {
  const runs = findSimpleRuns(documentXml);
  const occurrences = runs.filter((r) => r.text.includes(oldString));

  if (occurrences.length === 0) {
    return {
      error:
        `old_string was not found as a contiguous run of text in the document. This tool can only redline text ` +
        `that sits within a single simply-formatted run — it may be split across multiple runs (common after manual ` +
        `edits or spell-check), inside a table/header/footer this tool doesn't scan, or just not present verbatim.`,
    };
  }
  if (occurrences.length > 1 && !replaceAll) {
    return {
      error: `old_string occurs in ${occurrences.length} separate runs; it must be unique or replace_all must be set.`,
    };
  }

  const targets = replaceAll ? occurrences : [occurrences[0]];
  let id = nextRevisionId(documentXml);
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // Replace from the end backwards so earlier match indices in `documentXml` stay valid.
  let xml = documentXml;
  const sorted = [...targets].sort((a, b) => b.index - a.index);
  let totalCount = 0;
  for (const run of sorted) {
    // Handle multiple occurrences within the same run's text too.
    let text = run.text;
    let searchFrom = 0;
    const replacementsInRun: { at: number }[] = [];
    while (true) {
      const at = text.indexOf(oldString, searchFrom);
      if (at === -1) break;
      replacementsInRun.push({ at });
      searchFrom = at + oldString.length;
      if (!replaceAll) break;
    }
    if (!replacementsInRun.length) continue;

    // Build the whole run's replacement by walking left to right, splicing in tracked changes.
    let cursor = 0;
    let built = "";
    for (const { at } of replacementsInRun) {
      const segmentBefore = text.slice(cursor, at);
      if (segmentBefore) built += `<w:r${run.rAttrs}>${run.rPr}<w:t xml:space="preserve">${xmlEscape(segmentBefore)}</w:t></w:r>`;
      built +=
        `<w:del w:id="${id}" w:author="${xmlEscape(AUTHOR)}" w:date="${date}">` +
        `<w:r${run.rAttrs}>${run.rPr}<w:delText xml:space="preserve">${xmlEscape(oldString)}</w:delText></w:r></w:del>`;
      id++;
      if (newString) {
        built +=
          `<w:ins w:id="${id}" w:author="${xmlEscape(AUTHOR)}" w:date="${date}">` +
          `<w:r${run.rAttrs}>${run.rPr}<w:t xml:space="preserve">${xmlEscape(newString)}</w:t></w:r></w:ins>`;
        id++;
      }
      cursor = at + oldString.length;
      totalCount++;
    }
    const segmentAfter = text.slice(cursor);
    if (segmentAfter) built += `<w:r${run.rAttrs}>${run.rPr}<w:t xml:space="preserve">${xmlEscape(segmentAfter)}</w:t></w:r>`;

    xml = xml.slice(0, run.index) + built + xml.slice(run.index + run.fullMatch.length);
  }

  return { xml, count: totalCount };
}

export const redlineDocxTool: ToolSpec = {
  mutating: true,
  definition: {
    type: "function",
    function: {
      name: "redline_docx",
      description:
        "Mark up an existing Word (.docx) document with a real, reviewable tracked change (shown in Word as " +
        "strikethrough deletion + underlined insertion, attributed to 'Wrexlyn Agent', accept/reject-able) — not " +
        "a silent text replacement. Finds old_string as a contiguous run of plain, simply-formatted text; if " +
        "Word has split it across multiple runs (common after manual edits) this will report that it wasn't " +
        "found rather than guess. Use for redlining term sheets, contracts, LOIs — anything where the recipient " +
        "needs to see and approve/reject the specific proposed edit.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the existing .docx file, relative to the working directory." },
          old_string: { type: "string", description: "Exact existing text to mark as deleted." },
          new_string: {
            type: "string",
            description: "Replacement text to mark as inserted. Leave empty to propose a pure deletion with no replacement.",
          },
          replace_all: { type: "boolean", description: "Redline every occurrence instead of requiring exactly one." },
          output_path: {
            type: "string",
            description: "Where to write the redlined copy. Defaults to overwriting `path` in place.",
          },
        },
        required: ["path", "old_string"],
      },
    },
  },
  describe: (args) => `redline ${args.path}`,
  preview: async (args, ctx) => {
    const filePath = resolveInRoot(ctx.root, args.path);
    if (!fs.existsSync(filePath)) return `File not found: ${args.path}`;
    return `Propose change in ${args.path}:\n- ${args.old_string}\n+ ${args.new_string ?? "(deleted, no replacement)"}`;
  },
  run: async (args, ctx) => {
    const filePath = resolveInRoot(ctx.root, args.path);
    if (!fs.existsSync(filePath)) {
      return { ok: false, output: `File not found: ${args.path}` };
    }
    if (!args.old_string) {
      return { ok: false, output: "old_string is required." };
    }

    try {
      const buffer = fs.readFileSync(filePath);
      const zip = await JSZip.loadAsync(buffer);
      const docFile = zip.file("word/document.xml");
      if (!docFile) {
        return { ok: false, output: `${args.path} doesn't look like a valid .docx (no word/document.xml found).` };
      }
      const documentXml = await docFile.async("string");

      const result = applyRedline(documentXml, String(args.old_string), String(args.new_string ?? ""), !!args.replace_all);
      if ("error" in result) {
        return { ok: false, output: result.error };
      }

      zip.file("word/document.xml", result.xml);
      const outBuffer = await zip.generateAsync({ type: "nodebuffer" });

      const outputPath = resolveInRoot(ctx.root, args.output_path || args.path);
      fs.writeFileSync(outputPath, outBuffer);

      return {
        ok: true,
        output: `Redlined ${result.count} occurrence(s) in ${args.output_path || args.path} (tracked change, author "${AUTHOR}").`,
      };
    } catch (err: any) {
      return { ok: false, output: `Failed to redline ${args.path}: ${err.message ?? err}` };
    }
  },
};
