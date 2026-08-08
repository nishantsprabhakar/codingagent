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
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");

try {
  const sha = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf-8" }).trim();
  fs.writeFileSync(path.join(root, "version.json"), JSON.stringify({ commit: sha }, null, 2) + "\n");
  console.log(`Wrote version.json (commit ${sha.slice(0, 8)})`);
} catch (err) {
  console.error(`Failed to write version.json: ${err.message ?? err}`);
  process.exit(1);
}
