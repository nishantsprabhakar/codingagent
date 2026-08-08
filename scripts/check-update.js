#!/usr/bin/env node
/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Best-effort update check run at the start of every launch (both
 * scripts/launch.ps1 and scripts/launch.sh). Never blocks startup: any
 * failure (offline, GitHub unreachable, no version info available) is
 * swallowed and the app just launches with whatever it already has.
 *
 * Two install shapes are supported:
 *  - A git checkout (this repo cloned directly, or a dev copy): version is
 *    the current commit SHA, and an update means `git pull --ff-only` +
 *    reinstall + rebuild, offered as a yes/no prompt.
 *  - A packaged install (Wrexlyn-Setup.exe or install.sh): there's no .git
 *    directory to pull from, so version comes from a version.json stamped
 *    in at package/install time. An available update is reported but not
 *    applied automatically — replacing a running installed copy's files in
 *    place is a real footgun (locked files, no rollback), so this just
 *    points the user at the latest installer instead.
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execSync, spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const REPO = "nishantsprabhakar/codingagent";
const FETCH_TIMEOUT_MS = 5000;

function getLocalVersion() {
  if (fs.existsSync(path.join(root, ".git"))) {
    try {
      const sha = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf-8" }).trim();
      return { sha, isGit: true };
    } catch {
      return null;
    }
  }
  const versionPath = path.join(root, "version.json");
  if (fs.existsSync(versionPath)) {
    try {
      // Strip a leading UTF-8 BOM — common if this file is ever hand-edited and
      // re-saved from a Windows text editor — rather than silently disabling
      // the whole update check over one invisible character.
      const raw = fs.readFileSync(versionPath, "utf-8").replace(/^﻿/, "");
      const data = JSON.parse(raw);
      if (typeof data.commit === "string" && data.commit) return { sha: data.commit, isGit: false };
    } catch {
      // fall through to null
    }
  }
  return null;
}

async function getRemoteSha() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Wrexlyn-update-check" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.sha === "string" ? data.sha : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function shasMatch(a, b) {
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return longer.startsWith(shorter);
}

async function ask(query) {
  const rl = readline.createInterface({ input: process.stdin });
  process.stderr.write(query);
  const { value, done } = await rl[Symbol.asyncIterator]().next();
  rl.close();
  return done ? "" : value;
}

async function main() {
  const local = getLocalVersion();
  if (!local) return;

  const remoteSha = await getRemoteSha();
  if (!remoteSha) return;

  if (shasMatch(local.sha, remoteSha)) return;

  console.error("");
  console.error("A newer version of Wrexlyn is available.");

  if (!local.isGit) {
    console.error("This copy was installed via Setup.exe/install.sh, so it can't update itself in place.");
    console.error("Grab the latest installer from: https://github.com/nishantsprabhakar/codingagent");
    console.error("");
    return;
  }

  const answer = (await ask("Update now? [y/N]: ")).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") {
    console.error("Skipping update for this run.\n");
    return;
  }

  console.error("\nUpdating...");
  // Every step here is a fixed literal (no user input reaches these), so joining
  // into a single string is safe — done specifically to avoid passing a separate
  // args array alongside shell:true, which Node flags as unescaped-argument risk
  // (DEP0190) even though nothing variable actually flows into these commands.
  const steps = ["git pull --ff-only", "npm install", "npm run build"];
  for (const command of steps) {
    const result = spawnSync(command, { cwd: root, stdio: "inherit", shell: true });
    if (result.status !== 0) {
      console.error(`\nUpdate step failed: ${command} — continuing with the current version.\n`);
      return;
    }
  }
  console.error("Updated successfully.\n");
}

main().catch(() => {});
