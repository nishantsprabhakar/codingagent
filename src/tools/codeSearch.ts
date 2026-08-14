/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { ToolSpec } from "../types";
import { ensureIndex, searchCode, findSymbol, getSymbolMap } from "../codeIndex";

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

function formatSymbolMap(result: ReturnType<typeof getSymbolMap>): string {
  if (!result.files.length) {
    return result.capped ? "(no files with symbols — note: the project index is capped, some files were not indexed)" : "(no files with symbols)";
  }
  const lines = result.files.map((f) => `${f.file}: ${f.symbols.map((s) => `${s.kind} ${s.name}`).join(", ")}`);
  const suffix = result.capped ? "\n(note: capped — this is a partial view, not the whole project; narrow with 'path' to see more of one subtree)" : "";
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

export const getSymbolMapTool: ToolSpec = {
  mutating: false,
  definition: {
    type: "function",
    function: {
      name: "get_symbol_map",
      description:
        "Get a compact map of the functions/classes/types/etc. defined across the whole project (or a subtree), " +
        "grouped by file — use this to get oriented in an unfamiliar or large codebase in one call, instead of " +
        "reading many files or running repeated grep_search calls just to see what's there.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional relative path prefix to restrict the map to a subtree." },
          limit: { type: "number", description: "Max files to include (default 150) — narrow with 'path' if capped." },
        },
      },
    },
  },
  describe: (args) => (args.path ? `get_symbol_map ${args.path}` : "get_symbol_map"),
  run: async (args, ctx) => {
    await ensureIndex(ctx.root);
    const result = getSymbolMap(ctx.root, {
      path: typeof args.path === "string" ? args.path : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
    });
    return { ok: true, output: formatSymbolMap(result) };
  },
};
