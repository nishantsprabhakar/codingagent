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
 * this buys on its own: it does NOT sandbox what a shell command can itself do once it runs. That
 * gap is addressed separately, opt-in, by dockerSandbox.ts (the --sandbox flag) — when a request
 * asks for it, this service runs the command in a Docker container instead of via exec() directly,
 * falling back to the exec() path (with a visible warning in the output, not a silent downgrade)
 * if Docker isn't actually reachable.
 *
 * Communicates over Node's built-in fork() IPC channel with a tiny JSON request/response protocol
 * — see shellServiceClient.ts for the parent-side half, which is the only intended caller.
 */
import { exec, execFile } from "child_process";
import * as path from "path";
import { isDockerAvailable, runInDockerSandbox } from "./dockerSandbox";

const MAX_OUTPUT = 20_000;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface ShellRequest {
  id: string;
  command: string;
  cwd: string;
  timeoutMs?: number;
  sandbox?: boolean;
  sandboxImage?: string;
}

/**
 * A separate, narrower request shape for run_pptx_script/run_docx_script/run_xlsx_script — executing
 * a model-written .cjs file rather than an arbitrary shell string. Distinguished from ShellRequest by
 * `type` (absent on every existing ShellRequest, so this is purely additive to the IPC protocol).
 * Deliberately NOT routed through Docker regardless of any sandbox flag: the sandbox container only
 * ever mounts `cwd`, never Wrexlyn's own node_modules/document-kits, so NODE_PATH would point at
 * nothing inside it — see runDocumentScriptOnHost's own comment.
 */
export interface RunDocumentScriptRequest {
  id: string;
  type: "run_document_script";
  scriptPath: string;
  cwd: string;
  timeoutMs?: number;
}

export type ServiceRequest = ShellRequest | RunDocumentScriptRequest;

export interface ShellResponse {
  id: string;
  ok: boolean;
  output: string;
}

/** The pre-sandbox exec()-and-format logic, unchanged — still the only path when sandbox isn't requested, and the fallback when it's requested but Docker isn't reachable. */
function runOnHost(req: ShellRequest, outputPrefix?: string): Promise<ShellResponse> {
  const timeout = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    exec(req.command, { cwd: req.cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const combined = `${stdout}${stderr}`.trim();
      const truncated = combined.length > MAX_OUTPUT ? combined.slice(0, MAX_OUTPUT) + "\n... (output truncated)" : combined;
      const prefix = outputPrefix ?? "";
      if (error) {
        const reason = error.killed ? "timed out" : `exited with code ${error.code}`;
        resolve({ id: req.id, ok: false, output: `${prefix}Command ${reason}.\n${truncated || "(no output)"}` });
        return;
      }
      resolve({ id: req.id, ok: true, output: `${prefix}${truncated || "(no output)"}` });
    });
  });
}

export async function runOne(req: ShellRequest): Promise<ShellResponse> {
  if (!req.sandbox) return runOnHost(req);

  const available = await isDockerAvailable();
  if (!available) {
    return runOnHost(req, "(--sandbox was requested but Docker is unreachable — ran on host instead.)\n\n");
  }

  const result = await runInDockerSandbox(req.command, req.cwd, req.timeoutMs, req.sandboxImage);
  return { id: req.id, ok: result.ok, output: result.output };
}

/**
 * Runs a document-generation script via `execFile(process.execPath, [scriptPath], ...)` — a real
 * argv invocation, never a shell string, so a working directory or script path containing spaces
 * (a real case, not hypothetical: this very repo's own path has one) never needs manual quoting.
 * `process.execPath` (not the string "node") guarantees the exact same Node binary running this
 * service is used, sidestepping any PATH ambiguity. NODE_PATH is set to Wrexlyn's own node_modules
 * (so `require('pptxgenjs')`/`require('docx')`/`require('exceljs')` resolve even though the script
 * physically lives inside the target project, not here) plus the top-level document-kits/ directory
 * (so `require('wrexlyn-pptx-kit')` etc. resolve the same way) — both computed relative to this
 * compiled module's own location, the same __dirname-walk-up pattern web/server.ts already uses for
 * its static PUBLIC_DIR.
 */
export function runDocumentScriptOnHost(req: RunDocumentScriptRequest): Promise<ShellResponse> {
  const timeout = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : DEFAULT_TIMEOUT_MS;
  const nodeModulesDir = path.join(__dirname, "..", "node_modules");
  const documentKitsDir = path.join(__dirname, "..", "document-kits");
  const env = { ...process.env, NODE_PATH: [nodeModulesDir, documentKitsDir].join(path.delimiter) };

  return new Promise((resolve) => {
    execFile(process.execPath, [req.scriptPath], { cwd: req.cwd, env, timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const combined = `${stdout}${stderr}`.trim();
      const truncated = combined.length > MAX_OUTPUT ? combined.slice(0, MAX_OUTPUT) + "\n... (output truncated)" : combined;
      if (error) {
        const reason = (error as any).killed ? "timed out" : `exited with code ${(error as any).code}`;
        resolve({ id: req.id, ok: false, output: `Script ${reason}.\n${truncated || "(no output)"}` });
        return;
      }
      resolve({ id: req.id, ok: true, output: truncated || "(script produced no stdout output)" });
    });
  });
}

function isDocumentScriptRequest(req: ServiceRequest): req is RunDocumentScriptRequest {
  return (req as RunDocumentScriptRequest).type === "run_document_script";
}

// Only runs the IPC listener when actually launched as the forked shell-service child — process.send
// only exists on a process that was itself created via fork() with an IPC channel. This file is also
// imported directly (never forked) by shellServiceClient.ts's tests for the shared request/response
// types and to unit-test runOne()/runDocumentScriptOnHost() in-process, which must not start a live
// listener.
if (typeof process.send === "function") {
  process.on("message", async (req: ServiceRequest) => {
    const response = isDocumentScriptRequest(req) ? await runDocumentScriptOnHost(req) : await runOne(req);
    process.send!(response);
  });
  process.send({ type: "ready" });
}
