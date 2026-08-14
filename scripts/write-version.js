#!/usr/bin/env node
/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Stamps the current git commit into version.json, for check-update.js to
 * compare against on installs that don't ship a .git directory (packaged
 * Windows/Linux installs). Run this from a git checkout right before
 * building installer/windows/wrexlyn.iss, or let install.sh call it
 * automatically at install time.
 *
 * Also guards against a real bug class found in install.sh's Linux packaging: unlike
 * install.sh (fixed to copy exactly `git ls-files`), wrexlyn.iss's [Files] section bundles
 * `public\*` / `src\*` / `scripts\*` with `recursesubdirs` -- a blind directory copy that
 * can't distinguish tracked source from stray untracked debris (a build artifact, a scratch
 * file, anything left lying around). Since ISCC.exe can't be scripted to check this itself,
 * this is the one hook every documented build path already runs right before compiling.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const PACKAGED_DIRS = ["public", "src", "scripts"];

function checkForStrayFiles() {
  let output;
  try {
    output = execSync(`git status --porcelain -- ${PACKAGED_DIRS.join(" ")}`, { cwd: root, encoding: "utf-8" });
  } catch {
    return; // not a git checkout, or git unavailable -- nothing to check against
  }
  const lines = output.split("\n").filter(Boolean);
  const untracked = lines.filter((l) => l.startsWith("??")).map((l) => l.slice(3));
  const modified = lines.filter((l) => !l.startsWith("??")).map((l) => l.slice(3));

  if (untracked.length) {
    console.error(`\nFound ${untracked.length} untracked file(s) inside ${PACKAGED_DIRS.join("/, ")}/ that wrexlyn.iss`);
    console.error("would bundle into the Windows installer verbatim (it copies whole directories, not just");
    console.error("git-tracked files):");
    for (const f of untracked) console.error(`  ${f}`);
    console.error("\nRemove or .gitignore these before building, or they'll ship inside Wrexlyn-Setup.exe.\n");
    process.exit(1);
  }
  if (modified.length) {
    console.error(`\nNote: ${modified.length} tracked file(s) inside ${PACKAGED_DIRS.join("/, ")}/ have uncommitted`);
    console.error("changes -- the installer will include your working tree, not the last commit:");
    for (const f of modified) console.error(`  ${f}`);
    console.error("");
  }
}

checkForStrayFiles();

try {
  const sha = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf-8" }).trim();
  fs.writeFileSync(path.join(root, "version.json"), JSON.stringify({ commit: sha }, null, 2) + "\n");
  console.log(`Wrote version.json (commit ${sha.slice(0, 8)})`);
} catch (err) {
  console.error(`Failed to write version.json: ${err.message ?? err}`);
  process.exit(1);
}
