/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import ExcelJS from "exceljs";
import {
  recordSessionStart,
  recordSessionEnd,
  recordToolUsage,
  recordModelUsage,
  readAllEvents,
  _setUsageLedgerBaseDirForTesting,
} from "../usageLedger";
import { _flushUsageExportForTesting } from "../usageExport";
import { resolveUsageExportDir, usageWorkbookPath, _setUsageExportDirForTesting } from "../usageExportPath";

function withTempEnv<T>(fn: (ledgerDir: string, exportDir: string) => Promise<T>): Promise<T> {
  const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-usage-ledger-"));
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-usage-export-"));
  _setUsageLedgerBaseDirForTesting(ledgerDir);
  _setUsageExportDirForTesting(exportDir);
  return fn(ledgerDir, exportDir).finally(() => {
    _setUsageLedgerBaseDirForTesting(null);
    _setUsageExportDirForTesting(null);
  });
}

test("resolveUsageExportDir: honors the testing override", async () => {
  await withTempEnv(async (_ledgerDir, exportDir) => {
    assert.equal(resolveUsageExportDir(), exportDir);
    assert.equal(usageWorkbookPath(), path.join(exportDir, "wrexlyn-usage.xlsx"));
  });
});

test("usage ledger: events round-trip through the JSONL file", async () => {
  await withTempEnv(async () => {
    recordSessionStart("sess-1", "/some/project");
    recordToolUsage("sess-1", "read_file", true, "low");
    recordModelUsage("sess-1", "groq", "llama-3.3-70b-versatile", {
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
    });
    recordSessionEnd("sess-1");

    const events = readAllEvents();
    assert.equal(events.length, 4);
    assert.equal(events[0].type, "session_start");
    assert.equal(events[1].type, "tool");
    assert.equal(events[2].type, "model");
    assert.equal(events[3].type, "session_end");
  });
});

test("usage export: writes a workbook with the expected sheets and rows", async () => {
  await withTempEnv(async (_ledgerDir, exportDir) => {
    recordSessionStart("sess-2", "/some/project");
    recordToolUsage("sess-2", "write_file", true, "medium");
    recordToolUsage("sess-2", "write_file", false, "medium");
    recordModelUsage("sess-2", "openrouter", "openai/gpt-oss-20b:free", {
      promptTokens: 50,
      completionTokens: 10,
      totalTokens: 60,
    });
    recordSessionEnd("sess-2");

    await _flushUsageExportForTesting();

    const outPath = path.join(exportDir, "wrexlyn-usage.xlsx");
    assert.ok(fs.existsSync(outPath), "workbook file should exist after export");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outPath);

    const sheetNames = workbook.worksheets.map((s) => s.name);
    assert.deepEqual(sheetNames, ["Summary", "Sessions", "Tool Usage", "Model Usage"]);

    const sessions = workbook.getWorksheet("Sessions")!;
    assert.equal(sessions.rowCount, 2); // header + 1 session

    const tools = workbook.getWorksheet("Tool Usage")!;
    assert.equal(tools.rowCount, 3); // header + 2 tool calls

    // Re-reading a workbook from disk loses exceljs's runtime column-key mapping (keys are not
    // part of the OOXML format itself), so cells here are addressed by position, matching the
    // column order defined in usageExport.ts's buildModelSheet/buildSummarySheet.
    const models = workbook.getWorksheet("Model Usage")!;
    assert.equal(models.rowCount, 2); // header + 1 model call
    assert.equal(models.getRow(2).getCell(9).value, 60); // Total Tokens

    const summary = workbook.getWorksheet("Summary")!;
    assert.equal(summary.rowCount, 2); // header + 1 user
    assert.equal(summary.getRow(2).getCell(3).value, 2); // Tool Calls
    assert.equal(summary.getRow(2).getCell(6).value, 60); // Total Tokens
  });
});

test("usage export: tolerates a locked/undeletable destination without throwing", async () => {
  await withTempEnv(async (_ledgerDir, exportDir) => {
    recordSessionStart("sess-3", "/some/project");
    const outPath = path.join(exportDir, "wrexlyn-usage.xlsx");
    fs.mkdirSync(outPath); // make the destination path a directory, so the rename can never succeed

    await assert.doesNotReject(_flushUsageExportForTesting());
  });
});
