/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * scripts/write-version.js resolves its own root from `__dirname` (the location of the script
 * file itself), not from cwd -- so testing it means copying the real script into a fixture repo
 * shaped like `<fixture>/scripts/write-version.js`, exactly how it'd exist after a real git
 * checkout or install.sh run. This exercises the actual current script content, not a duplicate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const REAL_SCRIPT = path.join(__dirname, "..", "..", "scripts", "write-version.js");

function initFixtureRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-writeversion-test-"));
  execSync("git init -q", { cwd: root });
  execSync("git config user.email test@wrexlyn.local", { cwd: root });
  execSync("git config user.name Wrexlyn Test", { cwd: root });

  for (const dir of ["public", "src", "scripts"]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export {};\n");
  fs.writeFileSync(path.join(root, "public", "index.html"), "<html></html>\n");
  fs.copyFileSync(REAL_SCRIPT, path.join(root, "scripts", "write-version.js"));

  execSync("git add -A", { cwd: root });
  execSync('git commit -q -m "initial"', { cwd: root });
  return root;
}

function runWriteVersion(root: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "write-version.js")], { cwd: root, encoding: "utf-8" });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

test("write-version.js: clean tree writes version.json with the current commit", () => {
  const root = initFixtureRepo();
  const sha = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf-8" }).trim();

  const result = runWriteVersion(root);
  assert.equal(result.status, 0, result.stderr);

  const versionPath = path.join(root, "version.json");
  assert.ok(fs.existsSync(versionPath));
  const data = JSON.parse(fs.readFileSync(versionPath, "utf-8"));
  assert.equal(data.commit, sha);
});

// Regression: wrexlyn.iss bundles public\*, src\*, scripts\* verbatim with recursesubdirs --
// it can't tell a tracked source file from stray untracked debris (a build artifact, a scratch
// file, anything). This guard is the one place every documented build path already runs before
// compiling, so it's the only real chance to catch that before it ships inside Wrexlyn-Setup.exe.
test("write-version.js: an untracked file inside src/public/scripts blocks the build and writes nothing", () => {
  const root = initFixtureRepo();
  fs.writeFileSync(path.join(root, "src", "stray-debris.tmp"), "leftover junk");

  const result = runWriteVersion(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /untracked file/i);
  assert.match(result.stderr, /stray-debris\.tmp/);
  assert.equal(fs.existsSync(path.join(root, "version.json")), false, "must not write version.json when a stray file was found");
});

test("write-version.js: an untracked file outside public/src/scripts is not flagged", () => {
  const root = initFixtureRepo();
  fs.writeFileSync(path.join(root, "some-other-untracked-file.tmp"), "irrelevant to the installer");

  const result = runWriteVersion(root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(root, "version.json")));
});

test("write-version.js: a modified tracked file warns but still succeeds", () => {
  const root = initFixtureRepo();
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const changed = true;\n");

  const result = runWriteVersion(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /uncommitted/i);
  assert.ok(fs.existsSync(path.join(root, "version.json")));
});
