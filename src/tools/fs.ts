import * as fs from "fs";
import * as path from "path";
import { diffLines } from "diff";
import type { ToolSpec } from "../types";
import { resolveInRoot } from "./paths";

const MAX_READ_BYTES = 200_000;

export const readFileTool: ToolSpec = {
  mutating: false,
  definition: {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a text file from the working directory. Returns content with 1-based line numbers. " +
        "Use offset/limit to page through large files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the working directory." },
          offset: { type: "number", description: "1-based line number to start reading from." },
          limit: { type: "number", description: "Maximum number of lines to read." },
        },
        required: ["path"],
      },
    },
  },
  describe: (args) => `read ${args.path}`,
  run: async (args, ctx) => {
    const filePath = resolveInRoot(ctx.root, args.path);
    if (!fs.existsSync(filePath)) {
      return { ok: false, output: `File not found: ${args.path}` };
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return { ok: false, output: `${args.path} is a directory, not a file. Use list_dir instead.` };
    }
    if (stat.size > MAX_READ_BYTES && !args.offset && !args.limit) {
      return {
        ok: false,
        output: `File is ${stat.size} bytes, too large to read in full. Re-call with offset/limit to page through it.`,
      };
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.split("\n");
    const offset = args.offset && args.offset > 0 ? args.offset : 1;
    const limit = args.limit && args.limit > 0 ? args.limit : 2000;
    const slice = lines.slice(offset - 1, offset - 1 + limit);

    const numbered = slice.map((line, i) => `${offset + i}\t${line}`).join("\n");
    return { ok: true, output: numbered || "(empty file)" };
  },
};

export const listDirTool: ToolSpec = {
  mutating: false,
  definition: {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files and subdirectories at a path within the working directory (non-recursive).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the working directory. Defaults to '.'." },
        },
      },
    },
  },
  describe: (args) => `list ${args.path || "."}`,
  run: async (args, ctx) => {
    const dirPath = resolveInRoot(ctx.root, args.path || ".");
    if (!fs.existsSync(dirPath)) {
      return { ok: false, output: `Directory not found: ${args.path || "."}` };
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const lines = entries
      .filter((e) => e.name !== ".coding-agent")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => `${e.isDirectory() ? "d" : "-"}  ${e.name}`);
    return { ok: true, output: lines.join("\n") || "(empty directory)" };
  },
};

export const writeFileTool: ToolSpec = {
  mutating: true,
  definition: {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create a new file or overwrite an existing file with the given content. " +
        "Prefer edit_file for small changes to existing files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the working directory." },
          content: { type: "string", description: "Full file content to write." },
        },
        required: ["path", "content"],
      },
    },
  },
  describe: (args) => `write ${args.path}`,
  preview: async (args, ctx) => {
    const filePath = resolveInRoot(ctx.root, args.path);
    const existed = fs.existsSync(filePath);
    if (!existed) {
      const preview = args.content.length > 2000 ? args.content.slice(0, 2000) + "\n... (truncated)" : args.content;
      return `New file ${args.path}:\n${preview}`;
    }
    const before = fs.readFileSync(filePath, "utf-8");
    return renderDiff(before, args.content);
  },
  run: async (args, ctx) => {
    const filePath = resolveInRoot(ctx.root, args.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, args.content, "utf-8");
    return { ok: true, output: `Wrote ${args.content.length} bytes to ${args.path}` };
  },
};

export const editFileTool: ToolSpec = {
  mutating: true,
  definition: {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Replace an exact substring in an existing file. old_string must match the file content exactly " +
        "(including whitespace) and, unless replace_all is true, must occur exactly once.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the working directory." },
          old_string: { type: "string", description: "Exact text to find and replace." },
          new_string: { type: "string", description: "Text to replace it with." },
          replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring exactly one." },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  describe: (args) => `edit ${args.path}`,
  preview: async (args, ctx) => {
    const filePath = resolveInRoot(ctx.root, args.path);
    if (!fs.existsSync(filePath)) return `File not found: ${args.path}`;
    const before = fs.readFileSync(filePath, "utf-8");
    const after = applyEdit(before, args);
    if (after === null) return `old_string not found (or not unique) in ${args.path}`;
    return renderDiff(before, after);
  },
  run: async (args, ctx) => {
    const filePath = resolveInRoot(ctx.root, args.path);
    if (!fs.existsSync(filePath)) {
      return { ok: false, output: `File not found: ${args.path}` };
    }
    const before = fs.readFileSync(filePath, "utf-8");
    const after = applyEdit(before, args);
    if (after === null) {
      const occurrences = countOccurrences(before, args.old_string);
      return {
        ok: false,
        output:
          occurrences === 0
            ? `old_string was not found in ${args.path}. Read the file again to get the exact current text.`
            : `old_string occurs ${occurrences} times in ${args.path}; it must be unique or replace_all must be set.`,
      };
    }
    fs.writeFileSync(filePath, after, "utf-8");
    return { ok: true, output: `Edited ${args.path}` };
  },
};

function applyEdit(
  content: string,
  args: { old_string: string; new_string: string; replace_all?: boolean }
): string | null {
  const occurrences = countOccurrences(content, args.old_string);
  if (occurrences === 0) return null;
  if (!args.replace_all && occurrences > 1) return null;

  return args.replace_all
    ? content.split(args.old_string).join(args.new_string)
    : content.replace(args.old_string, args.new_string);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function renderDiff(before: string, after: string): string {
  const parts = diffLines(before, after);
  const lines: string[] = [];
  for (const part of parts) {
    const prefix = part.added ? "+" : part.removed ? "-" : " ";
    const partLines = part.value.replace(/\n$/, "").split("\n");
    for (const line of partLines) lines.push(`${prefix} ${line}`);
  }
  return lines.join("\n");
}
