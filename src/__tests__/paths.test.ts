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
import { resolveInRoot } from "../tools/paths";

function mkTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-paths-test-"));
}

test("resolveInRoot: allows a plain relative path inside root", () => {
  const root = mkTempRoot();
  const resolved = resolveInRoot(root, "src/index.ts");
  assert.equal(resolved, path.normalize(path.join(root, "src/index.ts")));
});

test("resolveInRoot: rejects a lexical '..' escape", () => {
  const root = mkTempRoot();
  assert.throws(() => resolveInRoot(root, "../../etc/passwd"));
});

test("resolveInRoot: rejects an absolute path outside root", () => {
  const root = mkTempRoot();
  const outside = mkTempRoot();
  assert.throws(() => resolveInRoot(root, path.join(outside, "secret.txt")));
});

test("resolveInRoot: allows an absolute path that is genuinely inside root", () => {
  const root = mkTempRoot();
  const resolved = resolveInRoot(root, path.join(root, "notes.md"));
  assert.equal(resolved, path.normalize(path.join(root, "notes.md")));
});

test("resolveInRoot: resolves a not-yet-existing nested write path without throwing", () => {
  const root = mkTempRoot();
  const resolved = resolveInRoot(root, "new/nested/report.docx");
  assert.equal(resolved, path.normalize(path.join(root, "new/nested/report.docx")));
});

test("resolveInRoot: rejects a symlink inside root pointing outside it (existing target)", () => {
  const root = mkTempRoot();
  const outside = mkTempRoot();
  fs.writeFileSync(path.join(outside, "secret.txt"), "top secret");

  const linkPath = path.join(root, "escape");
  try {
    fs.symlinkSync(outside, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch (err: any) {
    // Some CI/sandboxed environments block symlink creation entirely even for junctions —
    // skip rather than fail, since that's an environment limitation, not a code defect.
    console.warn(`skipping symlink test — could not create a symlink/junction: ${err.message ?? err}`);
    return;
  }

  assert.throws(
    () => resolveInRoot(root, "escape/secret.txt"),
    /outside the working directory/,
    "a symlink inside root pointing outside it must not grant access to the outside file"
  );
});

test("resolveInRoot: rejects a symlink inside root pointing outside it (nonexistent leaf under the link)", () => {
  const root = mkTempRoot();
  const outside = mkTempRoot();

  const linkPath = path.join(root, "escape2");
  try {
    fs.symlinkSync(outside, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch (err: any) {
    console.warn(`skipping symlink test — could not create a symlink/junction: ${err.message ?? err}`);
    return;
  }

  // "escape2/new-file.txt" doesn't exist yet, but the symlink it hangs off of does — this is exactly the
  // case a purely-lexical check (or a naive "only check existing paths") would miss.
  assert.throws(
    () => resolveInRoot(root, "escape2/new-file.txt"),
    /outside the working directory/,
    "a not-yet-existing file under an escaping symlink must still be rejected"
  );
});

test("resolveInRoot: still allows a symlink inside root that points to another location inside root", () => {
  const root = mkTempRoot();
  const innerTarget = path.join(root, "real-subdir");
  fs.mkdirSync(innerTarget);
  fs.writeFileSync(path.join(innerTarget, "file.txt"), "fine");

  const linkPath = path.join(root, "alias");
  try {
    fs.symlinkSync(innerTarget, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch (err: any) {
    console.warn(`skipping symlink test — could not create a symlink/junction: ${err.message ?? err}`);
    return;
  }

  assert.doesNotThrow(() => resolveInRoot(root, "alias/file.txt"));
});
