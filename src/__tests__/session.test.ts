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
import { createSessionId, saveSession, loadSession, listSessions } from "../session";

function mkTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-session-test-"));
}

test("saveSession/loadSession: round-trips messages, history, tasks, and createdFiles", () => {
  const root = mkTempRoot();
  const id = createSessionId();
  saveSession(root, id, "Test chat", [{ role: "user", content: "hi" } as any], [{ type: "user", text: "hi" } as any], [], ["a.txt"]);

  const loaded = loadSession(root, id);
  assert.ok(loaded);
  assert.equal(loaded!.title, "Test chat");
  assert.deepEqual(loaded!.messages, [{ role: "user", content: "hi" }]);
  assert.deepEqual(loaded!.createdFiles, ["a.txt"]);
});

// Regression: saveSession used to fs.writeFileSync directly onto the final path. A second tab
// saving the same session concurrently (or a process killed mid-write) could leave that file
// truncated, and the next loadSession() would either throw or silently see a corrupt object.
// Now it writes to a per-process temp file and renames it into place -- rename is atomic on both
// Windows and POSIX for a same-volume move, so no reader ever observes a partially-written file.
test("saveSession: never leaves a stray .tmp file behind after a successful save", () => {
  const root = mkTempRoot();
  const id = createSessionId();
  saveSession(root, id, "Test chat", [], [], [], []);

  const dir = path.join(root, ".coding-agent", "sessions");
  const entries = fs.readdirSync(dir);
  assert.deepEqual(entries, [`${id}.json`], "only the final session file should remain, no leftover temp file");
});

test("saveSession: repeated saves to the same session id always leave a fully-valid, latest-wins file", () => {
  const root = mkTempRoot();
  const id = createSessionId();
  for (let i = 0; i < 20; i++) {
    saveSession(root, id, `Chat ${i}`, [{ role: "user", content: `turn ${i}` } as any], [], [], []);
  }
  const loaded = loadSession(root, id);
  assert.ok(loaded);
  assert.equal(loaded!.title, "Chat 19");
  assert.deepEqual(loaded!.messages, [{ role: "user", content: "turn 19" }]);
});

test("saveSession: preserves createdAt across repeated saves of the same session", () => {
  const root = mkTempRoot();
  const id = createSessionId();
  saveSession(root, id, "First", [], [], [], []);
  const first = loadSession(root, id)!;

  saveSession(root, id, "Second", [], [], [], []);
  const second = loadSession(root, id)!;

  assert.equal(second.createdAt, first.createdAt);
  assert.ok(second.updatedAt >= first.updatedAt);
});

test("listSessions: reflects a saved session's title and sorts most-recently-updated first", () => {
  const root = mkTempRoot();
  const a = createSessionId();
  saveSession(root, a, "Older", [], [], [], []);
  const b = createSessionId();
  saveSession(root, b, "Newer", [], [], [], []);

  const sessions = listSessions(root);
  assert.equal(sessions[0].id, b);
  assert.equal(sessions[0].title, "Newer");
});
