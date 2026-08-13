/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { ToolSpec } from "../types";
import { ensureIndex, searchCode, findSymbol } from "../codeIndex";

function formatSearchResults(result: ReturnType<typeof searchCode>): string {
  if (!result.results.length) {
    return result.capped ? "(no matches — note: the project index is capped, some files were not indexed)" : "(no matches)";
  }
  const lines = result.results.map((r) => `${r.file} (score ${r.score})${r.snippet ? `: ${r.snippet}` : ""}`);
  const suffix = result.capped ? "\n(note: the project index is capped — some files were not fully indexed)" : "";
  return lines.join("\n") + suffix;
}

function formatSymbolMatches(result: ReturnType<typeof findSymbol>): string {
  if (!result.matches.length) {
    return result.capped ? "(no matches — note: the project index is capped, some files were not indexed)" : "(no matches)";
  }
  const lines = result.matches.map((m) => `${m.file}:${m.line}: ${m.kind} ${m.name}`);
  const suffix = result.capped ? "\n(note: the project index is capped — some files were not fully indexed)" : "";
  return lines.join("\n") + suffix;
}

export const searchCodeTool: ToolSpec = {
  mutating: false,
  definition: {
    type: "function",
    function: {
      name: "search_code",
      description:
        "Ranked, whole-project relevance search across file contents (a lightweight index maintained automatically, " +
        "not a fresh scan each call) — use this instead of grep_search when you don't know the exact text/regex to " +
        "look for and want the most relevant files ranked, not every literal match.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language-ish or keyword query, e.g. 'shell command permission check'." },
          path: { type: "string", description: "Optional relative path prefix to restrict results to a subtree." },
          limit: { type: "number", description: "Max results to return (default 15)." },
        },
        required: ["query"],
      },
    },
  },
  describe: (args) => `search_code ${args.query}`,
  run: async (args, ctx) => {
    await ensureIndex(ctx.root);
    const result = searchCode(ctx.root, String(args.query ?? ""), {
      path: typeof args.path === "string" ? args.path : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
    });
    return { ok: true, output: formatSearchResults(result) };
  },
};

export const findSymbolTool: ToolSpec = {
  mutating: false,
  definition: {
    type: "function",
    function: {
      name: "find_symbol",
      description:
        "Look up a function/class/type/etc. by name across the whole project instantly (backed by a maintained " +
        "symbol index), without guessing a grep pattern for it. Returns the defining file and line for each match.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Symbol name to look up, e.g. 'buildMcpServerEnv'." },
          exact: { type: "boolean", description: "If true, only exact (case-insensitive) name matches — no substring matches." },
        },
        required: ["name"],
      },
    },
  },
  describe: (args) => `find_symbol ${args.name}`,
  run: async (args, ctx) => {
    await ensureIndex(ctx.root);
    const result = findSymbol(ctx.root, String(args.name ?? ""), { exact: Boolean(args.exact) });
    return { ok: true, output: formatSymbolMatches(result) };
  },
};
