/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { ToolSpec } from "../types";
import { classifyShellCommand } from "../riskClassifier";
import { runInService } from "../shellServiceClient";

export const runShellCommandTool: ToolSpec = {
  mutating: true,
  riskOf: (args) => classifyShellCommand(String(args.command ?? "")),
  definition: {
    type: "function",
    function: {
      name: "run_shell_command",
      description:
        "Run a shell command in the working directory and return its stdout/stderr. " +
        "Use for things file tools can't do: running tests, installing packages, git, etc.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to execute." },
          timeout_ms: { type: "number", description: "Optional timeout in milliseconds (default 60000)." },
        },
        required: ["command"],
      },
    },
  },
  describe: (args) => `run: ${args.command}`,
  // Runs in a dedicated shell-execution service process, not in-process with the web server —
  // see shellService.ts's doc comment for exactly what that isolation does and doesn't provide.
  run: async (args, ctx) => runInService(String(args.command ?? ""), ctx.root, args.timeout_ms),
};
