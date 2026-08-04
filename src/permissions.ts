export type PermissionDecision = "once" | "always" | "deny";

export type ConfirmFn = (toolName: string, label: string, preview?: string) => Promise<PermissionDecision>;

/**
 * Gates mutating tools (write_file, edit_file, run_shell_command) behind an
 * explicit allow/always/deny decision, mirroring Claude Code's permission
 * model. Read-only tools never hit this. "always" is remembered per tool
 * name for the rest of the process; --yolo skips prompting entirely.
 *
 * The confirmFn is UI-agnostic: the CLI maps a y/a/n keystroke onto it, the
 * web UI maps a button click.
 */
export class PermissionManager {
  private alwaysAllowed = new Set<string>();

  constructor(private yolo: boolean, private confirmFn: ConfirmFn) {}

  async confirm(toolName: string, label: string, preview?: string): Promise<boolean> {
    if (this.yolo || this.alwaysAllowed.has(toolName)) return true;

    const decision = await this.confirmFn(toolName, label, preview);
    if (decision === "always") {
      this.alwaysAllowed.add(toolName);
      return true;
    }
    return decision === "once";
  }
}
