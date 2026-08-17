/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * End-to-end tests for run_pptx_script/run_docx_script/run_xlsx_script's full ToolSpec.run() --
 * real script execution through the real forked shell-service child (no mocking), matching this
 * repo's established preference for real subprocess tests over mocks (see shellService.test.ts).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runPptxScriptTool, runDocxScriptTool, runXlsxScriptTool } from "../tools/documentScripts";
import { _shutdownServiceForTesting } from "../shellServiceClient";
import type { ToolContext } from "../types";

function mkTempRoot(): ToolContext {
  return { root: fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-docscripts-test-")) };
}

after(() => {
  _shutdownServiceForTesting();
});

test("run_pptx_script: a real script requiring wrexlyn-pptx-kit produces a valid deck and passes the quality gate", async () => {
  const ctx = mkTempRoot();
  fs.writeFileSync(
    path.join(ctx.root, "gen.cjs"),
    [
      `const { createDeckTheme, PptxGenJS } = require("wrexlyn-pptx-kit");`,
      `const theme = createDeckTheme({ accentColor: "2FE6D9", mode: "dark" });`,
      `const pres = new PptxGenJS();`,
      `const slide = pres.addSlide();`,
      `slide.background = { color: theme.bgColor };`,
      `theme.addIconBadge(slide, "rocket", 0.5, 0.5, 0.6);`,
      `slide.addText("Real slide content from a script.", { x: 1, y: 1.5, w: 8, h: 1, fontSize: 18, color: theme.titleColor });`,
      `pres.writeFile({ fileName: "deck.pptx" });`,
    ].join("\n")
  );

  const result = await runPptxScriptTool.run({ scriptPath: "gen.cjs", path: "deck.pptx" }, ctx);
  assert.equal(result.ok, true, result.output);
  assert.equal(result.qualityGate?.ok, true);
  assert.ok(fs.existsSync(path.join(ctx.root, "deck.pptx")));
});

test("run_pptx_script: rejects a scriptPath that doesn't end in .cjs before ever executing anything", async () => {
  const ctx = mkTempRoot();
  const result = await runPptxScriptTool.run({ scriptPath: "gen.js", path: "deck.pptx" }, ctx);
  assert.equal(result.ok, false);
  assert.match(result.output, /must end in \.cjs/);
});

test("run_pptx_script: a scriptPath that doesn't exist fails with a clear message", async () => {
  const ctx = mkTempRoot();
  const result = await runPptxScriptTool.run({ scriptPath: "missing.cjs", path: "deck.pptx" }, ctx);
  assert.equal(result.ok, false);
  assert.match(result.output, /doesn't exist/);
});

test("run_docx_script: a throwing script returns ok:false with the real error surfaced", async () => {
  const ctx = mkTempRoot();
  fs.writeFileSync(path.join(ctx.root, "broken.cjs"), `throw new Error("deliberate docx script failure");\n`);

  const result = await runDocxScriptTool.run({ scriptPath: "broken.cjs", path: "report.docx" }, ctx);
  assert.equal(result.ok, false);
  assert.match(result.output, /deliberate docx script failure/);
});

test("run_xlsx_script: a script that runs but never writes the declared output path fails with a clear message", async () => {
  const ctx = mkTempRoot();
  fs.writeFileSync(path.join(ctx.root, "gen.cjs"), `console.log("ran but wrote nothing");\n`);

  const result = await runXlsxScriptTool.run({ scriptPath: "gen.cjs", path: "model.xlsx" }, ctx);
  assert.equal(result.ok, false);
  assert.match(result.output, /never produced/);
});

test("run_xlsx_script: a real script requiring wrexlyn-xlsx-kit produces a valid workbook and passes the quality gate", async () => {
  const ctx = mkTempRoot();
  fs.writeFileSync(
    path.join(ctx.root, "gen.cjs"),
    [
      `const kit = require("wrexlyn-xlsx-kit");`,
      `const wb = new kit.ExcelJS.Workbook();`,
      `const sheet = wb.addWorksheet("Sheet1");`,
      `const headerBand = kit.headerBandColors(undefined, kit.DEFAULT_ACCENT_DARK_HEX);`,
      `const headerRow = sheet.addRow(["Name", "Revenue"]);`,
      `kit.styleHeaderRow(sheet, headerRow, headerBand);`,
      `sheet.addRow(["Widget", kit.toFormulaAwareCellValue("=100*2")]);`,
      `wb.xlsx.writeFile("model.xlsx");`,
    ].join("\n")
  );

  const result = await runXlsxScriptTool.run({ scriptPath: "gen.cjs", path: "model.xlsx" }, ctx);
  assert.equal(result.ok, true, result.output);
  assert.equal(result.qualityGate?.ok, true);
});

test("run_pptx_script: a script whose output has placeholder text fails the quality gate, not silently succeeds", async () => {
  const ctx = mkTempRoot();
  fs.writeFileSync(
    path.join(ctx.root, "gen.cjs"),
    [
      `const PptxGenJS = require("pptxgenjs");`,
      `const pres = new PptxGenJS();`,
      `const slide = pres.addSlide();`,
      `slide.addText("TODO: fill this in later", { x: 1, y: 1, w: 5, h: 1 });`,
      `pres.writeFile({ fileName: "deck.pptx" });`,
    ].join("\n")
  );

  const result = await runPptxScriptTool.run({ scriptPath: "gen.cjs", path: "deck.pptx" }, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.qualityGate?.ok, false);
  assert.match(result.output, /Placeholder text "TODO"/);
});
