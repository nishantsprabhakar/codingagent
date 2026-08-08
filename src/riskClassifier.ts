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
