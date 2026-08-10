/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * User-authored instructions that apply to every project, not just one —
 * a global set of standing instructions layered on top of any single
 * project's own. Stored once per machine, separate from any single
 * project's files.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function storePath(): string {
  return path.join(os.homedir(), ".coding-agent", "global-instructions.txt");
}

/** Never throws — a fresh machine or a corrupt file just means no global instructions. */
export function loadGlobalInstructions(): string {
  try {
    const filePath = storePath();
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

export function saveGlobalInstructions(text: string): void {
  const filePath = storePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf-8");
}
