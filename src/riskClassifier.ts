/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { RiskLevel } from "./types";

/**
 * Patterns for shell commands that can destroy data, wipe a workspace, or
 * affect systems beyond it in a way that's hard or impossible to undo.
 * Deliberately conservative (prefers false positives — an extra red badge
 * on something harmless — over a false negative that under-warns).
 */
const HIGH_RISK_PATTERNS: RegExp[] = [
  /\brm\s+(-\w*[rf]\w*\s+)+/i, // rm -rf, rm -fr, rm -r -f
  /\brmdir\s+\/s/i,
  /\bdel\s+(\/[a-z]+\s*)*\/[a-z]*[fsq][a-z]*/i, // del /f /s /q variants
  /\bgit\s+push\b[^\n]*(--force|-f\b)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+(-\w*[fd]\w*\s*)+/i,
  /\bgit\s+branch\s+-D\b/i,
  /\bdrop\s+(table|database|schema)\b/i,
  /\btruncate\s+table\b/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bshutdown\b/i,
  /\btaskkill\s+\/f/i,
  /\bchmod\s+-R\s+777\b/i,
  /\bsudo\s+rm\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/sd/i,
  /\bdiskpart\b/i,
  /\bwevtutil\s+cl\b/i,
];

/** Everything mutating that isn't matched above is treated as ordinary "medium" risk. */
export function classifyShellCommand(command: string): RiskLevel {
  return HIGH_RISK_PATTERNS.some((re) => re.test(command)) ? "high" : "medium";
}

/** Shell commands that just inspect state — running a build/test suite (or a whole-tree checkpoint) after one of these would be pure noise. */
const READ_ONLY_ISH_SHELL = /^\s*(ls|dir|pwd|cat|type|echo|git\s+(status|log|diff|show|branch(\s|$)|remote)|node\s+-v|npm\s+-v|npx\s+--version|which|where)\b/i;

export function isReadOnlyIshShellCommand(command: string): boolean {
  // A leading keyword like "echo"/"cat" is only read-only-ish on its own — `echo x > file.txt` (or
  // `cmd 2>&1`) writes to a file and must never be classified as read-only no matter what precedes
  // the redirect. Checked before the keyword match, not folded into the regex, so it applies
  // regardless of which alternative matched.
  if (command.includes(">")) return false;
  return READ_ONLY_ISH_SHELL.test(command);
}
