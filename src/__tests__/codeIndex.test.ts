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
import { ensureIndex, searchCode, findSymbol, _resetCodeIndexCacheForTesting } from "../codeIndex";

function mkRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-codeidx-test-"));
}

function write(root: string, relPath: string, content: string | Buffer): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

test("findSymbol: exact and substring matches across languages", async () => {
  _resetCodeIndexCacheForTesting();
  const root = mkRoot();
  write(root, "src/foo.ts", "export function computeTotal(x: number) {\n  return x;\n}\n");
  write(root, "app.py", "def compute_total(x):\n    return x\n");
  await ensureIndex(root);

  const exact = findSymbol(root, "computeTotal", { exact: true });
  assert.equal(exact.matches.length, 1);
  assert.equal(exact.matches[0].file, "src/foo.ts");
  assert.equal(exact.matches[0].line, 1);
  assert.equal(exact.matches[0].kind, "function");

  const substring = findSymbol(root, "compute");
  assert.ok(substring.matches.length >= 2, "should find both computeTotal and compute_total");
});

test("searchCode: term-frequency scoring is log-dampened, not linear", async () => {
  _resetCodeIndexCacheForTesting();
  const root = mkRoot();
  write(root, "sparse.ts", "// the zephyr token appears exactly once in this file\n");
  write(root, "dense.ts", Array(100).fill("zephyr").join(" ") + "\n// filler, no declarations here\n");
  await ensureIndex(root);

  const result = searchCode(root, "zephyr");
  const sparse = result.results.find((r) => r.file === "sparse.ts");
  const dense = result.results.find((r) => r.file === "dense.ts");
  assert.ok(sparse, "sparse.ts should be a candidate");
  assert.ok(dense, "dense.ts should be a candidate");
  // dense.ts has ~100x the raw term frequency of sparse.ts for "zephyr" -- under log-dampened
  // scoring (1 + log(tf)) the ratio between their scores should be far below 100x.
  assert.ok(dense!.score < sparse!.score * 20, `expected log-dampened ratio, got dense=${dense!.score} sparse=${sparse!.score}`);
});

test("ensureIndex: incremental update reflects added, changed, and removed files without stale artifacts", async () => {
  _resetCodeIndexCacheForTesting();
  const root = mkRoot();
  write(root, "keep.ts", "export function keepMe() {}\n");
  write(root, "willChange.ts", "export function oldName() {}\n");
  write(root, "willRemove.ts", "export function goneName() {}\n");
  await ensureIndex(root);

  assert.equal(findSymbol(root, "oldName", { exact: true }).matches.length, 1);
  assert.equal(findSymbol(root, "goneName", { exact: true }).matches.length, 1);

  fs.rmSync(path.join(root, "willRemove.ts"));
  write(root, "willChange.ts", "export function newName() {}\n"); // changed content, same path
  write(root, "brandNew.ts", "export function freshName() {}\n"); // newly added

  _resetCodeIndexCacheForTesting(); // force a fresh walk against the persisted state from above
  await ensureIndex(root);

  assert.equal(findSymbol(root, "oldName", { exact: true }).matches.length, 0, "old symbol from changed file must be gone");
  assert.equal(findSymbol(root, "newName", { exact: true }).matches.length, 1, "new symbol from changed file must be present");
  assert.equal(findSymbol(root, "goneName", { exact: true }).matches.length, 0, "symbol from a removed file must be gone");
  assert.equal(findSymbol(root, "freshName", { exact: true }).matches.length, 1, "symbol from a newly added file must be present");
  assert.equal(findSymbol(root, "keepMe", { exact: true }).matches.length, 1, "untouched file's symbol must still be present");
});

test("ensureIndex: binary and UTF-16-BOM'd files are recorded but never tokenized", async () => {
  _resetCodeIndexCacheForTesting();
  const root = mkRoot();
  write(root, "binary.bin", Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00, 0x10]));
  write(root, "utf16.txt", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hello world", "utf16le")]));
  write(root, "normal.ts", "export function normalFn() {}\n");

  await ensureIndex(root);

  const persisted = JSON.parse(fs.readFileSync(path.join(root, ".coding-agent", "index", "index.json"), "utf-8"));
  assert.ok(persisted.perFile["binary.bin"], "binary file must still be recorded in the file list");
  assert.equal(persisted.perFile["binary.bin"].tokenSet.length, 0);
  assert.ok(persisted.perFile["utf16.txt"], "UTF-16 file must still be recorded in the file list");
  assert.equal(persisted.perFile["utf16.txt"].tokenSet.length, 0);
  assert.ok(persisted.perFile["normal.ts"].tokenSet.length > 0);
});

test("ensureIndex: a symlink pointing outside the root is never read into the index", async (t) => {
  _resetCodeIndexCacheForTesting();
  const root = mkRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-codeidx-outside-"));
  const outsideFile = path.join(outsideDir, "secret.ts");
  fs.writeFileSync(outsideFile, "export function secretOutsideFn() {}\n");

  const linkPath = path.join(root, "link.ts");
  try {
    fs.symlinkSync(outsideFile, linkPath, "file");
  } catch {
    t.skip("cannot create filesystem symlinks in this environment (insufficient privilege)");
    return;
  }

  await ensureIndex(root);
  assert.equal(findSymbol(root, "secretOutsideFn", { exact: true }).matches.length, 0);
  assert.equal(searchCode(root, "secretoutsidefn").results.length, 0);
});

test("ensureIndex: .coding-agent/** is never indexed (self-indexing regression)", async () => {
  _resetCodeIndexCacheForTesting();
  const root = mkRoot();
  write(root, "real.ts", "export function realFn() {}\n");
  await ensureIndex(root); // creates .coding-agent/index/index.json and .coding-agent/.gitignore

  _resetCodeIndexCacheForTesting(); // force a second walk -- would pick up the index's own file if unexcluded
  await ensureIndex(root);

  const persisted = JSON.parse(fs.readFileSync(path.join(root, ".coding-agent", "index", "index.json"), "utf-8"));
  const indexedPaths = Object.keys(persisted.perFile);
  assert.ok(indexedPaths.every((p) => !p.includes(".coding-agent")));
  assert.ok(indexedPaths.includes("real.ts"));
});

test("ensureIndex: persisted index round-trips after clearing the in-memory cache", async () => {
  _resetCodeIndexCacheForTesting();
  const root = mkRoot();
  write(root, "roundtrip.ts", "export function roundTripFn() {}\n");
  await ensureIndex(root);
  assert.equal(findSymbol(root, "roundTripFn", { exact: true }).matches.length, 1);

  _resetCodeIndexCacheForTesting(); // simulate a fresh process -- nothing in memory
  // No ensureIndex call here -- findSymbol must see it via the persisted file alone.
  assert.equal(findSymbol(root, "roundTripFn", { exact: true }).matches.length, 1);
});

test("ensureIndex: concurrent calls for the same root share one in-flight walk", async () => {
  _resetCodeIndexCacheForTesting();
  const root = mkRoot();
  write(root, "concurrent.ts", "export function concurrentFn() {}\n");
  const p1 = ensureIndex(root);
  const p2 = ensureIndex(root);
  assert.strictEqual(p1, p2, "a second call before the first resolves must reuse the same in-flight promise");
  await Promise.all([p1, p2]);
  assert.equal(findSymbol(root, "concurrentFn", { exact: true }).matches.length, 1);
});

test("ensureIndex: an empty project returns empty results without throwing", async () => {
  _resetCodeIndexCacheForTesting();
  const root = mkRoot();
  await ensureIndex(root);
  assert.deepEqual(findSymbol(root, "anything").matches, []);
  assert.deepEqual(searchCode(root, "anything").results, []);
});
