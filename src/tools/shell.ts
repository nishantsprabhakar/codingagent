/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { exec } from "child_process";
import type { ToolSpec } from "../types";
import { classifyShellCommand } from "../riskClassifier";

const MAX_OUTPUT = 20_000;
const DEFAULT_TIMEOUT_MS = 60_000;

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
  run: async (args, ctx) => {
    const timeout = args.timeout_ms && args.timeout_ms > 0 ? args.timeout_ms : DEFAULT_TIMEOUT_MS;

    return new Promise((resolve) => {
      exec(
        args.command,
        { cwd: ctx.root, timeout, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const combined = `${stdout}${stderr}`.trim();
          const truncated =
            combined.length > MAX_OUTPUT
              ? combined.slice(0, MAX_OUTPUT) + "\n... (output truncated)"
              : combined;

          if (error) {
            const reason = error.killed ? "timed out" : `exited with code ${error.code}`;
            resolve({
              ok: false,
              output: `Command ${reason}.\n${truncated || "(no output)"}`,
            });
            return;
          }
          resolve({ ok: true, output: truncated || "(no output)" });
        }
      );
    });
  },
};
