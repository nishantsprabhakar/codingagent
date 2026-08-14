/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { RiskLevel } from "./types";

export type PermissionDecision = "once" | "always" | "deny";

export type ConfirmFn = (toolName: string, label: string, risk: RiskLevel, preview?: string) => Promise<PermissionDecision>;

/**
 * Gates mutating tools (write_file, edit_file, run_shell_command) behind an
 * explicit allow/always/deny decision. Read-only tools never hit this.
 * "always" is remembered per tool
 * name for the rest of the process; --yolo skips prompting entirely.
 *
 * High-risk actions (rm -rf, force push, DROP TABLE, ...) can never become
 * an "always" — every single one is confirmed individually, no matter what
 * the client sends, so a risky action can never silently auto-approve. This
 * holds even for a tool that already has a live "always" on file from an
 * earlier, lower-risk call: `alwaysAllowed` is keyed by tool name, but
 * run_shell_command's risk is recomputed per call (classifyShellCommand), so
 * confirm() re-checks the CURRENT call's risk on every invocation, not just
 * whether this tool name was ever granted "always" before.
 *
 * The confirmFn is UI-agnostic: the CLI maps a y/a/n keystroke onto it, the
 * web UI maps a button click.
 */
export class PermissionManager {
  private alwaysAllowed = new Set<string>();
  /** Subset of alwaysAllowed that came from config (mcp.json's `permissions.alwaysAllow`), not a
   * live "always" click -- tracked separately so a config reload can revoke exactly these entries
   * without touching anything the user granted interactively this session. */
  private configSeeded = new Set<string>();

  constructor(private yolo: boolean, private confirmFn: ConfirmFn) {}

  async confirm(toolName: string, label: string, risk: RiskLevel, preview?: string): Promise<boolean> {
    if (this.yolo) return true;
    // `alwaysAllowed` is keyed by tool name only, but a tool like run_shell_command has its risk
    // recomputed per call (classifyShellCommand) -- without this risk check, a user clicking
    // "Always allow" on one medium-risk command (e.g. "npm test") would silently auto-approve
    // every later call to the same tool regardless of ITS risk, including a high-risk one (e.g.
    // "rm -rf /"). High-risk must always re-confirm even after an earlier "always" for this tool.
    if (risk !== "high" && this.alwaysAllowed.has(toolName)) return true;

    const decision = await this.confirmFn(toolName, label, risk, preview);
    if (decision === "always" && risk !== "high") {
      this.alwaysAllowed.add(toolName);
      return true;
    }
    return decision === "once" || (decision === "always" && risk === "high");
  }

  /**
   * Pre-approves a tool name from config-driven trust (the user explicitly named it in mcp.json),
   * never from the model or the server itself. Re-checks the high-risk invariant itself -- the
   * "high risk can never become always" rule lives in exactly one place (here and in confirm()'s
   * own branch), not re-implemented at every seeding call site.
   */
  preApprove(toolName: string, risk: RiskLevel): void {
    if (risk === "high") return;
    this.alwaysAllowed.add(toolName);
    this.configSeeded.add(toolName);
  }

  /**
   * Removes only the entries preApprove() added, leaving intact anything the user granted via a
   * live "always" click this session. Call before re-seeding from a freshly reloaded config (e.g.
   * mcp.json edited to remove a tool from `alwaysAllow`) -- without this, a revoked entry would
   * silently keep auto-approving until the whole process restarted.
   */
  clearConfigSeeded(): void {
    for (const name of this.configSeeded) this.alwaysAllowed.delete(name);
    this.configSeeded.clear();
  }
}
