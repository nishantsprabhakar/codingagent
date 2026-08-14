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
  // rmdir/rd, both cmd.exe names for the same command — matches /s in any position relative to
  // other flags (e.g. "rd /q /s dir", not just "rd /s"), since /s (recursive) is what makes it
  // destructive, not the flag order.
  /\b(rmdir|rd)\b[^\n]*\/s\b/i,
  // del/erase, both cmd.exe names for the same command — /f /s /q in any order/position.
  /\b(del|erase)\s+(\/[a-z]+\s*)*\/[a-z]*[fsq][a-z]*/i,
  /\bgit\s+push\b[^\n]*(--force|-f\b)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+(-\w*[fd]\w*\s*)+/i,
  /\bgit\s+branch\s+-D\b/i,
  /\bdrop\s+(table|database|schema)\b/i,
  /\btruncate\s+table\b/i,
  // format — matches whether the drive letter comes right after "format" or after other flags
  // (e.g. "format /fs:ntfs /q c:"), since requiring immediate adjacency missed realistic
  // invocations. Requires a standalone "<letter>:" token (preceded by start/whitespace/quote) so
  // this doesn't fire on an unrelated word like "npm run format" that has no drive argument at all.
  /\bformat\b[\s\S]*(?:^|[\s"])[a-z]:/i,
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

// Any of these let a command line run something beyond the single leading keyword the regex above
// matched — `git status && rm -rf .` starts with a whitelisted read-only prefix but chains an
// arbitrary second command after it. Disqualifying on ANY of these appearing anywhere in the
// string (not just after the matched keyword) is deliberately conservative: a legitimate read-only
// command that happens to contain one of these (e.g. piping `git log` through `head`) just loses
// the fast-path treatment and gets a checkpoint/verification pass it didn't strictly need — the
// safe direction to err, per this file's own "prefer false positives" policy. Covers POSIX
// chaining/substitution (&&, ||, ;, |, `, $(...)) and Windows cmd.exe's equivalents (&&, |, and a
// bare & for chaining without waiting).
const SHELL_CHAINING_RE = /&&|\|\||[;|&`]|\$\(/;

export function isReadOnlyIshShellCommand(command: string): boolean {
  // A leading keyword like "echo"/"cat" is only read-only-ish on its own — `echo x > file.txt` (or
  // `cmd 2>&1`) writes to a file and must never be classified as read-only no matter what precedes
  // the redirect. Checked before the keyword match, not folded into the regex, so it applies
  // regardless of which alternative matched.
  if (command.includes(">") || SHELL_CHAINING_RE.test(command)) return false;
  return READ_ONLY_ISH_SHELL.test(command);
}
