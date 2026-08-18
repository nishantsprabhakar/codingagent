/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * run_pptx_script/run_docx_script/run_xlsx_script — a code2office-style alternative to
 * create_pptx/create_docx/create_xlsx for documents with substantial content. Those three tools
 * require the model to describe the *entire* document as one JSON tool-call argument, which every
 * provider's 8000-token completion cap (see src/providers/*.ts) makes unreliable for anything past
 * a handful of slides/rows — the model hits finish_reason=length mid-argument and has to regenerate
 * the whole blob. These three tools instead execute a compact Node.js script (already written via
 * write_file) that builds the document itself, using loops/variables to express repetitive
 * structure far more compactly than fully-expanded JSON ever could.
 *
 * The script runs via shellServiceClient.ts's runDocumentScript — the same forked-child-process
 * isolation run_shell_command uses, extended with a NODE_PATH environment variable (see
 * shellService.ts's runDocumentScriptOnHost) that makes `require('pptxgenjs')`/`require('docx')`/
 * `require('exceljs')` AND `require('wrexlyn-pptx-kit')`/`wrexlyn-docx-kit`/`wrexlyn-xlsx-kit`
 * (Wrexlyn's own curated theming/layout helpers, in the top-level document-kits/ directory) resolve
 * correctly even though the script physically lives inside the target project, not here — no extra
 * npm install needed in the user's project.
 *
 * These are classified "high" risk unconditionally: unlike create_pptx/docx/xlsx (which only ever
 * build a document from data already visible in the tool call), a script here is genuine arbitrary
 * Node code execution. That means every call prompts for confirmation — high-risk tool calls can
 * never be "always allow"-ed (see permissions.ts) — an intentional trade-off for being honest about
 * what this tool actually does, not a default nobody decided on.
 *
 * --sandbox is not supported for these three tools: the --sandbox Docker container only ever mounts
 * the project's own working directory, never Wrexlyn's own node_modules/document-kits, so NODE_PATH
 * would point at nothing reachable inside it. They always run on the host, --sandbox or not.
 */
import * as fs from "fs";
import type { ToolSpec, ToolExecResult, ToolContext } from "../types";
import { resolveInRoot } from "./paths";
import { runDocumentScript } from "../shellServiceClient";
import { checkRenderedPptxQuality, checkRenderedDocxQuality, checkRenderedXlsxQuality } from "../documentScriptQuality";
import type { QualityCheckResult } from "../documentQuality";

function validateScriptPath(scriptPath: unknown): string | null {
  if (typeof scriptPath !== "string" || !scriptPath.trim()) {
    return "scriptPath is required — write the script first with write_file, then pass its path here.";
  }
  if (!scriptPath.trim().toLowerCase().endsWith(".cjs")) {
    return (
      `scriptPath must end in .cjs (got "${scriptPath}"). A plain .js file is parsed as ES Modules if the ` +
      `target project's own package.json has "type": "module", which makes a bare require() throw immediately ` +
      `— .cjs is always parsed as CommonJS regardless of that setting.`
    );
  }
  return null;
}

function qualityGateResult(name: string, quality: QualityCheckResult): ToolExecResult["qualityGate"] {
  return { name, ok: quality.ok, output: quality.ok ? quality.warnings.join("\n") : quality.blocking.join("\n") };
}

async function runAndValidate(
  args: any,
  ctx: ToolContext,
  extension: string
): Promise<{ scriptError: string } | { execFailed: string } | { outputPath: string; outputAbsPath: string }> {
  const scriptErrorMsg = validateScriptPath(args.scriptPath);
  if (scriptErrorMsg) return { scriptError: scriptErrorMsg };
  if (typeof args.path !== "string" || !args.path.trim()) return { scriptError: "path (the output file) is required." };
  if (!args.path.trim().toLowerCase().endsWith(extension)) {
    return { scriptError: `path must end in ${extension} (got "${args.path}").` };
  }

  const scriptAbsPath = resolveInRoot(ctx.root, args.scriptPath);
  if (!fs.existsSync(scriptAbsPath)) {
    return { scriptError: `scriptPath "${args.scriptPath}" doesn't exist — write it with write_file first.` };
  }

  const outputAbsPath = resolveInRoot(ctx.root, args.path);
  const execResult = await runDocumentScript(scriptAbsPath, ctx.root);
  if (!execResult.ok) {
    return { execFailed: `Script execution failed:\n${execResult.output}` };
  }
  if (!fs.existsSync(outputAbsPath)) {
    return {
      execFailed:
        `The script ran successfully (${execResult.output || "no output"}) but never produced "${args.path}". ` +
        `Make sure the script's own save call writes to exactly that path (resolved against the working directory).`,
    };
  }

  return { outputPath: args.path, outputAbsPath };
}

const SCRIPT_PATH_PARAM = {
  type: "string",
  description: "Path to the .cjs script (relative to the working directory), already written with write_file.",
} as const;

export const runPptxScriptTool: ToolSpec = {
  mutating: true,
  riskOf: () => "high",
  definition: {
    type: "function",
    function: {
      name: "run_pptx_script",
      description:
        "Execute a Node.js (.cjs) script that builds a PowerPoint deck with pptxgenjs, for decks with substantial " +
        "content (roughly more than 8 slides) where create_pptx's single-JSON-call approach risks exceeding the " +
        "model's own output token limit — or whenever a deck needs a chart/table/layout richer than create_pptx's " +
        "JSON schema exposes. Write the script first with write_file (must end in .cjs). In the script: " +
        "require('pptxgenjs') for the raw library, or require('wrexlyn-pptx-kit') for Wrexlyn's curated dark-theme " +
        "helpers: createDeckTheme({accentColor, mode}) returns a theme object whose properties (theme.bgColor, " +
        "theme.titleColor, etc.) and methods — theme.addIconBadge(slide, icon, x, y, diameter), theme.addSidebar(...), " +
        "theme.renderDotList(...), theme.chartDefaults('categorical'|'circular') (base IChartOpts styling to merge " +
        "into your own addChart(type, data, {...theme.chartDefaults(kind), x, y, w, h}) call), " +
        "theme.tableHeaderRow(cells)/theme.tableBodyRow(cells, rowIndex, {highlight}) (styled row arrays for your own " +
        "addTable call), theme.renderStatsRow(slide, stats, x, y, w, h, 'compact'|'large'), " +
        "theme.renderTimeline(slide, steps, x, y, w, h) — provide the same color palette, icon badges, chart/table " +
        "styling, and infographic layouts create_pptx itself uses. Call these as theme.methodName(...), never as " +
        "bare functions — only pptxRuns and createDeckTheme are top-level exports of the kit; the rest are methods " +
        "on the theme object it returns. Both the kit and pptxgenjs resolve without any npm install. " +
        "Chart gotchas (only relevant if you go beyond theme.chartDefaults' preset): on a STACKED bar/column chart, " +
        "dataLabelPosition must be 'ctr'/'inEnd'/'inBase', never 'outEnd' (corrupts the file). A combo chart using " +
        "secondaryValAxis/secondaryCatAxis needs BOTH valAxes and catAxes set with two entries each, or PowerPoint " +
        "discards the chart as corrupt. Hex colors are always plain 6-digit, never '#'-prefixed or with alpha. " +
        "End the script with pres.writeFile({fileName: '<path>'}) writing exactly the `path` given below. This tool " +
        "is high risk (runs arbitrary code) and does not support --sandbox (always runs on the host).",
      parameters: {
        type: "object",
        properties: {
          scriptPath: SCRIPT_PATH_PARAM,
          path: { type: "string", description: "Output .pptx path the script will produce, relative to the working directory." },
        },
        required: ["scriptPath", "path"],
      },
    },
  },
  describe: (args) => `run script -> ${args.path}`,
  preview: async (args) => `Run ${args.scriptPath} to produce PowerPoint presentation: ${args.path}`,
  run: async (args, ctx) => {
    const result = await runAndValidate(args, ctx, ".pptx");
    if ("scriptError" in result) return { ok: false, output: result.scriptError };
    if ("execFailed" in result) return { ok: false, output: result.execFailed };

    const buffer = fs.readFileSync(result.outputAbsPath);
    const quality = await checkRenderedPptxQuality(buffer);
    if (!quality.ok) {
      const output = quality.blocking.join("\n");
      return { ok: false, output, qualityGate: qualityGateResult("pptx script quality gate", quality) };
    }
    const stat = fs.statSync(result.outputAbsPath);
    const qualitySuffix = quality.warnings.length ? `\nQuality notes: ${quality.warnings.join(" ")}` : "";
    return {
      ok: true,
      output: `Created ${result.outputPath} via script (${stat.size} bytes).${qualitySuffix}`,
      qualityGate: qualityGateResult("pptx script quality gate", quality),
    };
  },
};

export const runDocxScriptTool: ToolSpec = {
  mutating: true,
  riskOf: () => "high",
  definition: {
    type: "function",
    function: {
      name: "run_docx_script",
      description:
        "Execute a Node.js (.cjs) script that builds a Word document with the docx library, for documents with " +
        "substantial content (roughly more than 40 blocks/sections) where create_docx's single-JSON-call approach " +
        "risks exceeding the model's own output token limit. Write the script first with write_file (must end in " +
        ".cjs). In the script: require('docx') for the raw library, or require('wrexlyn-docx-kit') for Wrexlyn's " +
        "helpers (docxRuns(text) converts '**bold** _italic_' markup into real TextRuns, orderedListNumbering(), " +
        "createToc(), LETTER_SIZE_DXA — docx.js defaults to A4, not Letter — darkenHex/lightenHex/headerBandColors " +
        "for accent theming) — both resolve without any npm install. End the script with " +
        "Packer.toBuffer(doc).then(buf => fs.writeFileSync('<path>', buf)) writing exactly the `path` given below. " +
        "This tool is high risk (runs arbitrary code) and does not support --sandbox (always runs on the host).",
      parameters: {
        type: "object",
        properties: {
          scriptPath: SCRIPT_PATH_PARAM,
          path: { type: "string", description: "Output .docx path the script will produce, relative to the working directory." },
        },
        required: ["scriptPath", "path"],
      },
    },
  },
  describe: (args) => `run script -> ${args.path}`,
  preview: async (args) => `Run ${args.scriptPath} to produce Word document: ${args.path}`,
  run: async (args, ctx) => {
    const result = await runAndValidate(args, ctx, ".docx");
    if ("scriptError" in result) return { ok: false, output: result.scriptError };
    if ("execFailed" in result) return { ok: false, output: result.execFailed };

    const buffer = fs.readFileSync(result.outputAbsPath);
    const quality = await checkRenderedDocxQuality(buffer);
    if (!quality.ok) {
      const output = quality.blocking.join("\n");
      return { ok: false, output, qualityGate: qualityGateResult("docx script quality gate", quality) };
    }
    const stat = fs.statSync(result.outputAbsPath);
    return {
      ok: true,
      output: `Created ${result.outputPath} via script (${stat.size} bytes).`,
      qualityGate: qualityGateResult("docx script quality gate", quality),
    };
  },
};

export const runXlsxScriptTool: ToolSpec = {
  mutating: true,
  riskOf: () => "high",
  definition: {
    type: "function",
    function: {
      name: "run_xlsx_script",
      description:
        "Execute a Node.js (.cjs) script that builds an Excel workbook with exceljs, for workbooks with substantial " +
        "content (roughly more than 200 total data rows) where create_xlsx's single-JSON-call approach risks " +
        "exceeding the model's own output token limit. Write the script first with write_file (must end in .cjs). " +
        "In the script: require('exceljs') for the raw library, or require('wrexlyn-xlsx-kit') for Wrexlyn's " +
        "helpers (toFormulaAwareCellValue(v) turns a string starting with '=' into a live Excel formula, " +
        "styleHeaderRow/applyDataRowStyle/autoColumnWidth match create_xlsx's own default look, " +
        "darkenHex/lightenHex/headerBandColors for accent theming) — both resolve without any npm install. Use " +
        "live formulas (not precomputed literals) for anything that should stay an auditable, recalculating model. " +
        "End the script with workbook.xlsx.writeFile('<path>') writing exactly the `path` given below. This tool " +
        "is high risk (runs arbitrary code) and does not support --sandbox (always runs on the host).",
      parameters: {
        type: "object",
        properties: {
          scriptPath: SCRIPT_PATH_PARAM,
          path: { type: "string", description: "Output .xlsx path the script will produce, relative to the working directory." },
        },
        required: ["scriptPath", "path"],
      },
    },
  },
  describe: (args) => `run script -> ${args.path}`,
  preview: async (args) => `Run ${args.scriptPath} to produce Excel workbook: ${args.path}`,
  run: async (args, ctx) => {
    const result = await runAndValidate(args, ctx, ".xlsx");
    if ("scriptError" in result) return { ok: false, output: result.scriptError };
    if ("execFailed" in result) return { ok: false, output: result.execFailed };

    const quality = await checkRenderedXlsxQuality(result.outputAbsPath);
    if (!quality.ok) {
      const output = quality.blocking.join("\n");
      return { ok: false, output, qualityGate: qualityGateResult("xlsx script quality gate", quality) };
    }
    const stat = fs.statSync(result.outputAbsPath);
    const qualitySuffix = quality.warnings.length ? `\nQuality notes: ${quality.warnings.join(" ")}` : "";
    return {
      ok: true,
      output: `Created ${result.outputPath} via script (${stat.size} bytes).${qualitySuffix}`,
      qualityGate: qualityGateResult("xlsx script quality gate", quality),
    };
  },
};
