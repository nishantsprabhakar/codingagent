/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";
import type { ToolSpec } from "../types";
import { resolveInRoot } from "./paths";

// Kept intentionally short and JS/TS-biased plus a few common non-JS heavy directories — not a
// substitute for real .gitignore parsing (out of scope: hand-rolling correct .gitignore glob
// semantics is its own project). ".coding-agent" must stay in this list: it's Wrexlyn's own
// per-project state directory (sessions, transactions, the code index below), and without this
// exclusion glob_search/grep_search — and codeIndex.ts, which reuses this same list — would walk
// into and surface Wrexlyn's own persisted data as search results.
export const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.coding-agent/**",
  "**/dist/**",
  "**/build/**",
  "**/.venv/**",
  "**/venv/**",
  "**/__pycache__/**",
  "**/target/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/out/**",
  "**/coverage/**",
  "**/.cache/**",
  "**/.gradle/**",
  "**/.tox/**",
];
export const MAX_RESULTS = 200;

export const globSearchTool: ToolSpec = {
  mutating: false,
  definition: {
    type: "function",
    function: {
      name: "glob_search",
      description: "Find files by glob pattern (e.g. '**/*.ts') within the working directory.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern, e.g. 'src/**/*.ts'." },
          path: { type: "string", description: "Directory to search from, relative to the working directory. Defaults to '.'." },
        },
        required: ["pattern"],
      },
    },
  },
  describe: (args) => `glob ${args.pattern}`,
  run: async (args, ctx) => {
    const searchRoot = resolveInRoot(ctx.root, args.path || ".");
    const matches = await glob(args.pattern, {
      cwd: searchRoot,
      ignore: DEFAULT_IGNORE,
      nodir: true,
      dot: false,
      posix: true, // forward-slash paths even on Windows, for consistent model-facing output
    });
    const limited = matches.slice(0, MAX_RESULTS);
    const suffix = matches.length > MAX_RESULTS ? `\n... (${matches.length - MAX_RESULTS} more not shown)` : "";
    return { ok: true, output: (limited.join("\n") || "(no matches)") + suffix };
  },
};

export const grepSearchTool: ToolSpec = {
  mutating: false,
  definition: {
    type: "function",
    function: {
      name: "grep_search",
      description: "Search file contents for a regular expression within the working directory.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regular expression to search for." },
          path: { type: "string", description: "Directory to search from, relative to the working directory. Defaults to '.'." },
          glob: { type: "string", description: "Optional glob to restrict which files are searched, e.g. '*.ts'." },
          case_insensitive: { type: "boolean" },
        },
        required: ["pattern"],
      },
    },
  },
  describe: (args) => `grep ${args.pattern}`,
  run: async (args, ctx) => {
    const searchRoot = resolveInRoot(ctx.root, args.path || ".");
    const filePattern = args.glob || "**/*";
    const files = await glob(filePattern, {
      cwd: searchRoot,
      ignore: DEFAULT_IGNORE,
      nodir: true,
      dot: false,
      posix: true, // forward-slash paths even on Windows, for consistent model-facing output
    });

    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern, args.case_insensitive ? "i" : "");
    } catch (err: any) {
      return { ok: false, output: `Invalid regular expression: ${err.message}` };
    }

    const results: string[] = [];
    for (const relFile of files) {
      const fullPath = path.join(searchRoot, relFile);
      let content: string;
      try {
        content = fs.readFileSync(fullPath, "utf-8");
      } catch {
        continue; // skip binary/unreadable files
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push(`${relFile}:${i + 1}: ${lines[i].trim()}`);
          if (results.length >= MAX_RESULTS) break;
        }
      }
      if (results.length >= MAX_RESULTS) break;
    }

    return { ok: true, output: results.join("\n") || "(no matches)" };
  },
};
