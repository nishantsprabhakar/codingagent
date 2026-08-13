/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import * as path from "path";
import { getRecentActivity } from "./gitHistory";

const IGNORED_ENTRIES = new Set(["node_modules", ".git", "dist", "build", ".coding-agent"]);
const MAX_README_CHARS = 3000;
const MAX_TOP_LEVEL_ENTRIES = 40;
const MAX_RECENT_ACTIVITY_ENTRIES = 8;

/**
 * Gives the model a running start on a new session: a shallow directory
 * listing, README excerpt, and package.json summary, so it doesn't have to
 * spend its first couple of tool calls just figuring out what the project is.
 */
export function gatherProjectContext(root: string): string {
  const parts: string[] = [];

  const topLevel = listTopLevel(root);
  if (topLevel.length) {
    parts.push(`Top-level contents of the working directory:\n${topLevel.join("\n")}`);
  }

  const packageSummary = summarizePackageJson(root);
  if (packageSummary) parts.push(packageSummary);

  const readme = readReadme(root);
  if (readme) parts.push(readme);

  const recentActivity = summarizeRecentActivity(root);
  if (recentActivity) parts.push(recentActivity);

  return parts.join("\n\n");
}

/** Git-history signal (see gitHistory.ts) — silently omitted for a non-git project or on any git
 *  failure, same pattern as the other three block functions in this file. */
function summarizeRecentActivity(root: string): string | null {
  const activity = getRecentActivity(root);
  if (!activity || !activity.files.length) return null;
  const files = activity.files.slice(0, MAX_RECENT_ACTIVITY_ENTRIES);
  return `Recently changed files (most recent first, from git history):\n${files.join("\n")}`;
}

function listTopLevel(root: string): string[] {
  try {
    const entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => !IGNORED_ENTRIES.has(e.name) && !e.name.startsWith("."))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, MAX_TOP_LEVEL_ENTRIES)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    return entries;
  } catch {
    return [];
  }
}

function summarizePackageJson(root: string): string | null {
  const filePath = path.join(root, "package.json");
  if (!fs.existsSync(filePath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const lines = [`package.json: "${pkg.name ?? "(unnamed)"}"${pkg.description ? ` — ${pkg.description}` : ""}`];
    if (pkg.scripts) lines.push(`scripts: ${Object.keys(pkg.scripts).join(", ")}`);
    if (pkg.dependencies) lines.push(`dependencies: ${Object.keys(pkg.dependencies).join(", ")}`);
    if (pkg.devDependencies) lines.push(`devDependencies: ${Object.keys(pkg.devDependencies).join(", ")}`);
    return lines.join("\n");
  } catch {
    return null;
  }
}

function readReadme(root: string): string | null {
  try {
    const candidate = fs
      .readdirSync(root)
      .find((name) => /^readme(\.md|\.txt)?$/i.test(name));
    if (!candidate) return null;

    const content = fs.readFileSync(path.join(root, candidate), "utf-8");
    const truncated = content.length > MAX_README_CHARS ? content.slice(0, MAX_README_CHARS) + "\n... (truncated)" : content;
    return `${candidate} excerpt:\n${truncated}`;
  } catch {
    return null;
  }
}
