/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Real generated pptx/docx/xlsx files, not mocked buffers -- exercising the actual jszip/exceljs
 * parsing path, including the split-across-XML-runs regression that motivated concatenating text
 * within a paragraph/shape before running the placeholder scan (see documentScriptQuality.ts's own
 * header comment for why a naive per-run scan would miss this).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import PptxGenJS from "pptxgenjs";
import { Document, Paragraph, TextRun, Packer } from "docx";
import ExcelJS from "exceljs";
import { checkRenderedPptxQuality, checkRenderedDocxQuality, checkRenderedXlsxQuality } from "../documentScriptQuality";

function mkTempFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-docscriptquality-test-"));
  return path.join(dir, name);
}

test("checkRenderedPptxQuality: a clean slide with real content passes", async () => {
  const pres = new PptxGenJS();
  const slide = pres.addSlide();
  slide.addText("Real content here", { x: 1, y: 1, w: 5, h: 1 });
  const buffer = (await pres.write({ outputType: "nodebuffer" })) as Buffer;

  const result = await checkRenderedPptxQuality(buffer);
  assert.equal(result.ok, true);
  assert.deepEqual(result.blocking, []);
});

test("checkRenderedPptxQuality: a placeholder word split across two separate text runs is still caught", async () => {
  const pres = new PptxGenJS();
  const slide = pres.addSlide();
  // Two runs within one addText call render as two separate <a:r><a:t> runs inside one <a:p> paragraph --
  // a naive per-run regex scan would see "TO" and "DO: fix this later" separately and never match /\btodo\b/i.
  slide.addText([{ text: "TO" }, { text: "DO: fix this later" }], { x: 1, y: 1, w: 5, h: 1 });
  const buffer = (await pres.write({ outputType: "nodebuffer" })) as Buffer;

  const result = await checkRenderedPptxQuality(buffer);
  assert.equal(result.ok, false);
  assert.match(result.blocking.join("\n"), /Placeholder text "TODO"/);
});

test("checkRenderedPptxQuality: a blank deck (no visible text) is blocked", async () => {
  const pres = new PptxGenJS();
  pres.addSlide();
  const buffer = (await pres.write({ outputType: "nodebuffer" })) as Buffer;

  const result = await checkRenderedPptxQuality(buffer);
  assert.equal(result.ok, false);
  assert.match(result.blocking.join("\n"), /no visible text/);
});

test("checkRenderedPptxQuality: a corrupt (non-zip) buffer is handled without throwing", async () => {
  const result = await checkRenderedPptxQuality(Buffer.from("not a real pptx file"));
  assert.equal(result.ok, false);
  assert.match(result.blocking.join("\n"), /isn't a valid \.pptx/);
});

test("checkRenderedDocxQuality: a clean paragraph with real content passes", async () => {
  const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun("Real content")] })] }] });
  const buffer = await Packer.toBuffer(doc);

  const result = await checkRenderedDocxQuality(buffer);
  assert.equal(result.ok, true);
  assert.deepEqual(result.blocking, []);
});

test("checkRenderedDocxQuality: a placeholder word split across two runs in the same paragraph is still caught", async () => {
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun("TO"), new TextRun("DO later")] })] }],
  });
  const buffer = await Packer.toBuffer(doc);

  const result = await checkRenderedDocxQuality(buffer);
  assert.equal(result.ok, false);
  assert.match(result.blocking.join("\n"), /Placeholder text "TODO"/);
});

test("checkRenderedDocxQuality: a document with no visible text in any paragraph is blocked", async () => {
  const doc = new Document({ sections: [{ children: [] }] });
  const buffer = await Packer.toBuffer(doc);

  const result = await checkRenderedDocxQuality(buffer);
  assert.equal(result.ok, false);
  assert.match(result.blocking.join("\n"), /no visible text/);
});

test("checkRenderedDocxQuality: a corrupt (non-zip) buffer is handled without throwing", async () => {
  const result = await checkRenderedDocxQuality(Buffer.from("not a real docx file"));
  assert.equal(result.ok, false);
  assert.match(result.blocking.join("\n"), /isn't a valid \.docx/);
});

test("checkRenderedXlsxQuality: a clean sheet with real content passes", async () => {
  const filePath = mkTempFile("clean.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(["Name", "Value"]);
  sheet.addRow(["Widget", 42]);
  await workbook.xlsx.writeFile(filePath);

  const result = await checkRenderedXlsxQuality(filePath);
  assert.equal(result.ok, true);
  assert.deepEqual(result.blocking, []);
});

test("checkRenderedXlsxQuality: placeholder text in a cell is caught", async () => {
  const filePath = mkTempFile("placeholder.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(["Name", "Value"]);
  sheet.addRow(["TBD", "placeholder"]);
  await workbook.xlsx.writeFile(filePath);

  const result = await checkRenderedXlsxQuality(filePath);
  assert.equal(result.ok, false);
  assert.match(result.blocking.join("\n"), /Placeholder text "TBD"/);
});

test("checkRenderedXlsxQuality: a workbook with no sheets is blocked", async () => {
  const filePath = mkTempFile("empty.xlsx");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.writeFile(filePath);

  const result = await checkRenderedXlsxQuality(filePath);
  assert.equal(result.ok, false);
  assert.match(result.blocking.join("\n"), /no sheets/);
});

test("checkRenderedXlsxQuality: a nonexistent/corrupt file is handled without throwing", async () => {
  const result = await checkRenderedXlsxQuality(path.join(os.tmpdir(), "does-not-exist-" + Date.now() + ".xlsx"));
  assert.equal(result.ok, false);
  assert.match(result.blocking.join("\n"), /isn't a valid \.xlsx/);
});
