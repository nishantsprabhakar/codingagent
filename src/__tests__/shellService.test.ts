/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Exercises the real fork()+IPC mechanism (not a mock) — this is the one place in the codebase
 * establishing that pattern, so the test spawns the actual compiled shellService.js child exactly
 * as shellServiceClient.ts does in production.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runInService, runDocumentScript, _shutdownServiceForTesting } from "../shellServiceClient";
import { runOne, runDocumentScriptOnHost } from "../shellService";

function mkTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-shellsvc-test-"));
}

after(() => {
  _shutdownServiceForTesting();
});

test("runOne (in-process, no fork): runs a command and returns its output", async () => {
  const root = mkTempRoot();
  const cmd = process.platform === "win32" ? "echo hello" : "echo hello";
  const result = await runOne({ id: "x", command: cmd, cwd: root });
  assert.equal(result.id, "x");
  assert.equal(result.ok, true);
  assert.match(result.output, /hello/);
});

test("runInService: runs a real command through the forked service process and returns correct output", async () => {
  const root = mkTempRoot();
  const result = await runInService("echo from-the-service", root);
  assert.equal(result.ok, true);
  assert.match(result.output, /from-the-service/);
});

test("runInService: a failing command reports ok:false with the real exit output", async () => {
  const root = mkTempRoot();
  const cmd = process.platform === "win32" ? "exit /b 1" : "exit 1";
  const result = await runInService(cmd, root);
  assert.equal(result.ok, false);
});

test("runInService: the command actually runs with the requested cwd", async () => {
  const root = mkTempRoot();
  fs.writeFileSync(path.join(root, "marker.txt"), "present");
  const cmd = process.platform === "win32" ? "dir /b" : "ls";
  const result = await runInService(cmd, root);
  assert.equal(result.ok, true);
  assert.match(result.output, /marker\.txt/);
});

test("runInService: the service survives and correctly serves a second call after the first one completes", async () => {
  const root = mkTempRoot();
  const first = await runInService("echo first", root);
  const second = await runInService("echo second", root);
  assert.match(first.output, /first/);
  assert.match(second.output, /second/);
});

test("runInService: concurrent calls resolve to their own matching response, not a mismatched one", async () => {
  const root = mkTempRoot();
  const [a, b, c] = await Promise.all([
    runInService("echo alpha", root),
    runInService("echo beta", root),
    runInService("echo gamma", root),
  ]);
  assert.match(a.output, /alpha/);
  assert.match(b.output, /beta/);
  assert.match(c.output, /gamma/);
});

test("runInService: transparently respawns after the service process is killed", async () => {
  const root = mkTempRoot();
  await runInService("echo warm-up", root); // ensure a child exists
  _shutdownServiceForTesting(); // simulate a crash
  const result = await runInService("echo after-respawn", root);
  assert.equal(result.ok, true);
  assert.match(result.output, /after-respawn/);
});

test("runDocumentScriptOnHost (in-process, no fork): executes a real .cjs file via execFile and returns its stdout", async () => {
  const root = mkTempRoot();
  const scriptPath = path.join(root, "gen.cjs");
  const outputPath = path.join(root, "output.txt");
  fs.writeFileSync(scriptPath, `require("fs").writeFileSync(${JSON.stringify(outputPath)}, "hello from document script");\nconsole.log("done");\n`);

  const result = await runDocumentScriptOnHost({ id: "y", type: "run_document_script", scriptPath, cwd: root });
  assert.equal(result.ok, true, result.output);
  assert.match(result.output, /done/);
  assert.equal(fs.readFileSync(outputPath, "utf-8"), "hello from document script");
});

test("runDocumentScript: NODE_PATH resolution actually works -- a real script requiring wrexlyn-pptx-kit and pptxgenjs succeeds", async () => {
  const root = mkTempRoot();
  const scriptPath = path.join(root, "gen.cjs");
  const outputPath = path.join(root, "deck.pptx");
  fs.writeFileSync(
    scriptPath,
    [
      `const { createDeckTheme, PptxGenJS } = require("wrexlyn-pptx-kit");`,
      `const theme = createDeckTheme({ accentColor: "2FE6D9", mode: "dark" });`,
      `const pres = new PptxGenJS();`,
      `const slide = pres.addSlide();`,
      `slide.background = { color: theme.bgColor };`,
      `slide.addText("real content", { x: 1, y: 1, w: 5, h: 1 });`,
      `pres.writeFile({ fileName: ${JSON.stringify(outputPath)} }).then(() => console.log("script finished OK"));`,
    ].join("\n")
  );

  const result = await runDocumentScript(scriptPath, root);
  assert.equal(result.ok, true, result.output);
  assert.match(result.output, /script finished OK/);
  assert.ok(fs.existsSync(outputPath));
});

test("runDocumentScript: a throwing script returns ok:false with the real error output, not a swallowed failure", async () => {
  const root = mkTempRoot();
  const scriptPath = path.join(root, "broken.cjs");
  fs.writeFileSync(scriptPath, `throw new Error("deliberate failure for the test");\n`);

  const result = await runDocumentScript(scriptPath, root);
  assert.equal(result.ok, false);
  assert.match(result.output, /deliberate failure for the test/);
});

// Regression: an earlier design reused runInService's shell-string exec() path for document
// scripts, which needs correct per-shell quoting for any path containing spaces -- this repo's own
// working directory has one ("Desktop Code Base... coding-agent" style names are common on real
// machines), so this isn't a hypothetical edge case. runDocumentScript uses execFile with a real
// argv array instead, which never needs quoting at all.
test("runDocumentScript: works correctly when the working directory and script path contain a space", async () => {
  const root = mkTempRoot();
  const spacedDir = path.join(root, "dir with spaces");
  fs.mkdirSync(spacedDir);
  const scriptPath = path.join(spacedDir, "gen.cjs");
  const outputPath = path.join(spacedDir, "out.txt");
  fs.writeFileSync(scriptPath, `require("fs").writeFileSync(${JSON.stringify(outputPath)}, "ok");\nconsole.log("space path OK");\n`);

  const result = await runDocumentScript(scriptPath, spacedDir);
  assert.equal(result.ok, true, result.output);
  assert.match(result.output, /space path OK/);
});
