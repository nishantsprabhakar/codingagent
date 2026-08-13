/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { ToolSpec } from "../types";
import { readFileTool, writeFileTool, editFileTool, listDirTool } from "./fs";
import { globSearchTool, grepSearchTool } from "./search";
import { runShellCommandTool } from "./shell";
import { createDocxTool, createPptxTool, createXlsxTool } from "./documents";
import { webFetchTool } from "./web";
import { readPdfTool } from "./pdf";
import { redlineDocxTool } from "./redline";
import { recallSkillTool } from "./skills";
import { searchCodeTool, findSymbolTool } from "./codeSearch";

export const TOOLS: Record<string, ToolSpec> = {
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  list_dir: listDirTool,
  glob_search: globSearchTool,
  grep_search: grepSearchTool,
  search_code: searchCodeTool,
  find_symbol: findSymbolTool,
  run_shell_command: runShellCommandTool,
  create_docx: createDocxTool,
  create_pptx: createPptxTool,
  create_xlsx: createXlsxTool,
  web_fetch: webFetchTool,
  read_pdf: readPdfTool,
  redline_docx: redlineDocxTool,
  recall_skill: recallSkillTool,
};

export const TOOL_DEFINITIONS = Object.values(TOOLS).map((t) => t.definition);
