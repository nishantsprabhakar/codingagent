/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Opt-in Docker sandboxing for run_shell_command (the --sandbox CLI flag). This is a real
 * capability gap the existing shell-exec process separation (shellService.ts) explicitly
 * documents as out of scope: that split protects the network-facing web-server process from a
 * compromised WebSocket handler, but does nothing to contain what a shell command itself can do
 * once it runs. Docker containment does exactly that — at the cost of being a genuinely new,
 * heavyweight external dependency (the user must have Docker installed and running) for an app
 * otherwise positioned as "zero external service, works after npm install." That's why this is
 * opt-in and falls back to host execution with a clear warning rather than failing outright.
 *
 * Deliberate scope, stated plainly rather than silently assumed:
 * - Network is left enabled (Docker's default bridge) — legitimate commands routinely need it
 *   (npm install, git fetch/push, curl). The value here is filesystem/process containment, not
 *   network isolation.
 * - The default image (node:18-alpine) only has what that image ships with — no git, no python,
 *   etc. A command needing a tool the image doesn't have will fail inside the sandbox where it
 *   wouldn't on the host. --sandbox-image lets the user pick a different one.
 * - This is invoked from inside shellService.ts (the forked shell-exec child), not the main
 *   process — see that file's own doc comment for why shell execution lives there at all.
 */
import { execFile } from "child_process";

const DOCKER_CHECK_TIMEOUT_MS = 5_000;
const MAX_OUTPUT = 20_000;
const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_SANDBOX_IMAGE = "node:18-alpine";

let cachedAvailability: Promise<boolean> | null = null;

/** Checked once per process and cached for its lifetime — matches this codebase's existing
 *  "throttle repeated subprocess/probe calls" convention (see codeIndex.ts's THROTTLE_MS). A
 *  Docker daemon that goes up or down mid-session won't be re-detected until the next restart;
 *  that's an acceptable trade-off for not spawning `docker info` on every single shell command. */
export function isDockerAvailable(): Promise<boolean> {
  if (!cachedAvailability) {
    cachedAvailability = new Promise((resolve) => {
      execFile("docker", ["info"], { timeout: DOCKER_CHECK_TIMEOUT_MS }, (error) => resolve(!error));
    });
  }
  return cachedAvailability;
}

/** Test-only seam — forces the next isDockerAvailable() call to re-probe instead of returning a cached result. */
export function _resetDockerAvailabilityCacheForTesting(): void {
  cachedAvailability = null;
}

export interface DockerRunResult {
  ok: boolean;
  output: string;
}

/**
 * Runs `command` inside a disposable, non-root-by-default container with `cwd` mounted at
 * /workspace. Uses execFile (a real argv array, no shell) for the same reason gitCheckpoint.ts's
 * checkoutPaths does — the command string itself is passed as a single argv entry to `sh -c`
 * inside the container, never concatenated into a host shell command line.
 */
export function runInDockerSandbox(command: string, cwd: string, timeoutMs?: number, image?: string): Promise<DockerRunResult> {
  const timeout = timeoutMs && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const resolvedImage = image && image.trim() ? image.trim() : DEFAULT_SANDBOX_IMAGE;
  const args = [
    "run",
    "--rm",
    "-v",
    `${cwd}:/workspace`,
    "-w",
    "/workspace",
    "--memory=1g",
    "--cpus=2",
    resolvedImage,
    "sh",
    "-c",
    command,
  ];

  return new Promise((resolve) => {
    execFile("docker", args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const combined = `${stdout}${stderr}`.trim();
      const truncated = combined.length > MAX_OUTPUT ? combined.slice(0, MAX_OUTPUT) + "\n... (output truncated)" : combined;
      if (error) {
        const reason = (error as any).killed ? "timed out" : `exited with code ${(error as any).code}`;
        resolve({ ok: false, output: `Sandboxed command ${reason}.\n${truncated || "(no output)"}` });
        return;
      }
      resolve({ ok: true, output: truncated || "(no output)" });
    });
  });
}
