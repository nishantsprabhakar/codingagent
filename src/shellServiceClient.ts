/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Parent-side half of the shell-exec privileged-execution service — see shellService.ts's doc
 * comment for what this buys and doesn't. Lazily forks the service on first use and reuses it
 * across calls; a dead/crashed child is transparently respawned on the next call rather than
 * leaving the app permanently unable to run shell commands.
 *
 * `fork()`'s child inherits `process.execArgv`, so this works unmodified in both dev (running
 * under `tsx`, which registers itself via execArgv flags this then re-applies to the child so it
 * can load shellService.ts directly) and production (compiled dist/, plain empty execArgv) — the
 * child script path is derived from this module's own extension (`.ts` under tsx, `.js` compiled),
 * so no separate build step or dev-only code path is needed.
 */
import { fork, type ChildProcess } from "child_process";
import * as path from "path";
import * as crypto from "crypto";
import type { ShellRequest, ShellResponse } from "./shellService";

/** How much longer than the caller's own exec timeout to wait for a response before giving up on the IPC round-trip itself. */
const IPC_SLACK_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 60_000;

interface PendingRequest {
  resolve: (res: ShellResponse) => void;
  timer: NodeJS.Timeout;
}

let child: ChildProcess | null = null;
let ready = false;
let readyWaiters: Array<() => void> = [];
const pending = new Map<string, PendingRequest>();

function failAllPending(reason: string): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.resolve({ id, ok: false, output: reason });
  }
  pending.clear();
}

function spawnChild(): ChildProcess {
  const scriptPath = path.join(__dirname, "shellService" + path.extname(__filename));
  const proc = fork(scriptPath, [], { execArgv: process.execArgv, stdio: ["ignore", "ignore", "ignore", "ipc"] });

  proc.on("message", (msg: any) => {
    if (msg?.type === "ready") {
      ready = true;
      const waiters = readyWaiters;
      readyWaiters = [];
      waiters.forEach((fn) => fn());
      return;
    }
    const response = msg as ShellResponse;
    const entry = pending.get(response.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(response.id);
    entry.resolve(response);
  });

  const handleExit = () => {
    ready = false;
    child = null;
    failAllPending("The shell-execution service exited unexpectedly.");
  };
  proc.on("exit", handleExit);
  proc.on("error", handleExit);

  return proc;
}

function getChild(): ChildProcess {
  if (!child) child = spawnChild();
  return child;
}

function whenReady(): Promise<void> {
  getChild();
  if (ready) return Promise.resolve();
  return new Promise((resolve) => readyWaiters.push(resolve));
}

/**
 * Runs a shell command in the dedicated shell-execution service process rather than in-process.
 * Same `{ok, output}` shape and behavior (timeout, output truncation) as the previous in-process
 * `exec()` call — only where it physically runs has changed.
 */
export async function runInService(command: string, cwd: string, timeoutMs?: number): Promise<{ ok: boolean; output: string }> {
  await whenReady();
  const proc = getChild();
  const id = crypto.randomBytes(8).toString("hex");

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, output: "The shell-execution service did not respond in time." });
    }, (timeoutMs && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS) + IPC_SLACK_MS);

    pending.set(id, { resolve: (res) => resolve({ ok: res.ok, output: res.output }), timer });
    proc.send({ id, command, cwd, timeoutMs } as ShellRequest);
  });
}

/** Test-only seam — terminates the service so tests don't leave an orphaned child process running. */
export function _shutdownServiceForTesting(): void {
  failAllPending("Service shut down for testing.");
  child?.kill();
  child = null;
  ready = false;
  readyWaiters = [];
}
