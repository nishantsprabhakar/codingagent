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
import { snapshotFile, captureAfterSnapshot, restoreSnapshot, type FileSnapshot } from "../workspaceSnapshot";

function mkTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-snapshot-test-"));
}

test("binary round-trip: non-UTF-8 bytes restore byte-exact", () => {
  const root = mkTempRoot();
  const abs = path.join(root, "image.png");
  // High bytes that are invalid as UTF-8 on their own — corrupts if ever decoded/encoded as text.
  const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xd8, 0xfe, 0x00, 0x81, 0x92]);
  fs.writeFileSync(abs, original);

  const before = snapshotFile(root, "image.png");
  fs.writeFileSync(abs, Buffer.from([0x00, 0x01, 0x02])); // simulate the mutating tool overwriting it
  const results = restoreSnapshot(root, [before]);

  assert.equal(results[0].status, "restored");
  assert.ok(Buffer.compare(fs.readFileSync(abs), original) === 0);
});

test("new-file lifecycle: snapshot of a not-yet-existing path, then rollback deletes it", () => {
  const root = mkTempRoot();
  const before = snapshotFile(root, "new/nested/file.txt");
  assert.equal(before.existed, false);

  fs.mkdirSync(path.join(root, "new/nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "new/nested/file.txt"), "created by the tool");
  const after = captureAfterSnapshot(root, before);
  assert.equal(after.existedAfter, true);

  const results = restoreSnapshot(root, [after]);
  assert.equal(results[0].status, "restored");
  assert.equal(fs.existsSync(path.join(root, "new/nested/file.txt")), false);
});

test("staleness happy path: no further changes since the transaction finished", () => {
  const root = mkTempRoot();
  const abs = path.join(root, "file.txt");
  fs.writeFileSync(abs, "original");

  const before = snapshotFile(root, "file.txt");
  fs.writeFileSync(abs, "mutated by the tool");
  const after = captureAfterSnapshot(root, before);

  const results = restoreSnapshot(root, [after]);
  assert.equal(results[0].status, "restored");
  assert.equal(fs.readFileSync(abs, "utf-8"), "original");
});

test("staleness conflict: file modified externally after the transaction finished", () => {
  const root = mkTempRoot();
  const abs = path.join(root, "file.txt");
  fs.writeFileSync(abs, "original");

  const before = snapshotFile(root, "file.txt");
  fs.writeFileSync(abs, "mutated by the tool");
  const after = captureAfterSnapshot(root, before);

  fs.writeFileSync(abs, "someone else's edit"); // happens after the transaction finished
  const results = restoreSnapshot(root, [after]);

  assert.equal(results[0].status, "skipped_conflict");
  assert.equal(fs.readFileSync(abs, "utf-8"), "someone else's edit", "the interloping edit must survive, not be clobbered");
});

test("staleness conflict: file deleted externally after the transaction finished", () => {
  const root = mkTempRoot();
  const abs = path.join(root, "file.txt");
  fs.writeFileSync(abs, "original");

  const before = snapshotFile(root, "file.txt");
  fs.writeFileSync(abs, "mutated by the tool");
  const after = captureAfterSnapshot(root, before);

  fs.rmSync(abs);
  const results = restoreSnapshot(root, [after]);

  assert.equal(results[0].status, "skipped_conflict");
  assert.equal(fs.existsSync(abs), false, "must not silently recreate a file someone else deleted");
});

test("permission-mode round-trip", { skip: process.platform === "win32" }, () => {
  const root = mkTempRoot();
  const abs = path.join(root, "script.sh");
  fs.writeFileSync(abs, "#!/bin/sh\necho hi");
  fs.chmodSync(abs, 0o755);

  const before = snapshotFile(root, "script.sh");
  assert.equal(before.modeBefore, 0o755);

  fs.chmodSync(abs, 0o644);
  fs.writeFileSync(abs, "mutated");
  const after = captureAfterSnapshot(root, before);

  restoreSnapshot(root, [after]);
  assert.equal(fs.statSync(abs).mode & 0o777, 0o755);
});

test("legacy pre-Phase-4 record: no encoding field decodes as text and restores unconditionally", () => {
  const root = mkTempRoot();
  const abs = path.join(root, "file.txt");
  fs.writeFileSync(abs, "someone else's edit — must be overwritten, matching pre-Phase-4 behavior");

  const legacy: FileSnapshot = { path: "file.txt", existed: true, before: "legacy text content" };
  const results = restoreSnapshot(root, [legacy]);

  assert.equal(results[0].status, "restored");
  assert.equal(fs.readFileSync(abs, "utf-8"), "legacy text content");
});

test("snapshotFile/restoreSnapshot reject a path-escape the same way resolveInRoot does", () => {
  const root = mkTempRoot();
  const escaping = snapshotFile(root, "../../etc/passwd");
  // snapshotFile never throws — an escape attempt just reads as "didn't exist," same as any other failure.
  assert.equal(escaping.existed, false);

  const results = restoreSnapshot(root, [{ path: "../../etc/passwd", existed: true, before: "cGF3bmVk", encoding: "base64" }]);
  assert.equal(results[0].status, "failed");
});
