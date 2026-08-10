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
 * the client sends, so a risky action can never silently auto-approve.
 *
 * The confirmFn is UI-agnostic: the CLI maps a y/a/n keystroke onto it, the
 * web UI maps a button click.
 */
export class PermissionManager {
  private alwaysAllowed = new Set<string>();

  constructor(private yolo: boolean, private confirmFn: ConfirmFn) {}

  async confirm(toolName: string, label: string, risk: RiskLevel, preview?: string): Promise<boolean> {
    if (this.yolo || this.alwaysAllowed.has(toolName)) return true;

    const decision = await this.confirmFn(toolName, label, risk, preview);
    if (decision === "always" && risk !== "high") {
      this.alwaysAllowed.add(toolName);
      return true;
    }
    return decision === "once" || (decision === "always" && risk === "high");
  }
}
