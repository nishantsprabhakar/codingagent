#!/usr/bin/env node
/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Explicit-file test runner, deliberately not relying on `node --test`'s glob-pattern support (added in a
 * later Node than this project's declared "engines": ">=18" minimum) or on shell globbing (which cmd.exe,
 * unlike bash, doesn't do) — this walks dist/__tests__ itself and passes each *.test.js as an explicit argv
 * entry, which every Node >=18 --test invocation understands identically on Windows and Linux.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const testDir = path.join(__dirname, "..", "dist", "__tests__");

if (!fs.existsSync(testDir)) {
  console.error(`No compiled tests found at ${testDir} — run "npm run build" first.`);
  process.exit(1);
}

const testFiles = fs
  .readdirSync(testDir)
  .filter((f) => f.endsWith(".test.js"))
  .map((f) => path.join(testDir, f));

if (!testFiles.length) {
  console.error(`No *.test.js files found under ${testDir}.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
process.exit(result.status ?? 1);
