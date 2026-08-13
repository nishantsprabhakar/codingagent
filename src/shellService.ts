/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * The shell-exec privileged-execution service — runs run_shell_command's actual `exec()` call in
 * its own OS process, separate from the web server. If the web-server process is ever compromised
 * (e.g. a bug in WebSocket message handling, unrelated to shell execution itself), an attacker
 * doesn't get direct in-process access to call exec() with arbitrary args — they'd have to go
 * through this narrow request/response protocol instead. That's the entire blast-radius reduction
 * this buys: it does NOT sandbox what a shell command can itself do once it runs (never in scope
 * here), only moves the *decision to run one* out of the network-facing process.
 *
 * Communicates over Node's built-in fork() IPC channel with a tiny JSON request/response protocol
 * — see shellServiceClient.ts for the parent-side half, which is the only intended caller.
 */
import { exec } from "child_process";

const MAX_OUTPUT = 20_000;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface ShellRequest {
  id: string;
  command: string;
  cwd: string;
  timeoutMs?: number;
}

export interface ShellResponse {
  id: string;
  ok: boolean;
  output: string;
}

/** Same exec()-and-format logic that used to live directly in tools/shell.ts — unchanged behavior, just relocated. */
export function runOne(req: ShellRequest): Promise<ShellResponse> {
  const timeout = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    exec(req.command, { cwd: req.cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const combined = `${stdout}${stderr}`.trim();
      const truncated = combined.length > MAX_OUTPUT ? combined.slice(0, MAX_OUTPUT) + "\n... (output truncated)" : combined;
      if (error) {
        const reason = error.killed ? "timed out" : `exited with code ${error.code}`;
        resolve({ id: req.id, ok: false, output: `Command ${reason}.\n${truncated || "(no output)"}` });
        return;
      }
      resolve({ id: req.id, ok: true, output: truncated || "(no output)" });
    });
  });
}

// Only runs the IPC listener when actually launched as the forked shell-service child — process.send
// only exists on a process that was itself created via fork() with an IPC channel. This file is also
// imported directly (never forked) by shellServiceClient.ts's tests for the shared request/response
// types and to unit-test runOne() in-process, which must not start a live listener.
if (typeof process.send === "function") {
  process.on("message", async (req: ShellRequest) => {
    const response = await runOne(req);
    process.send!(response);
  });
  process.send({ type: "ready" });
}
