/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Runs the smallest applicable checks after a turn's mutating work, cheapest
 * first, and never invents a command that isn't actually available — an
 * empty result set (ranAny=false) is reported honestly rather than as a pass.
 */
import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { ProjectMemory, VerificationCheck, VerificationResult } from "./types";

const CHECK_TIMEOUT_MS = 90_000;
const MAX_CHECK_OUTPUT = 4_000;

function runCommandCheck(root: string, name: string, command: string): Promise<VerificationCheck> {
  return new Promise((resolve) => {
    exec(command, { cwd: root, timeout: CHECK_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const combined = `${stdout}${stderr}`.trim();
      const truncated = combined.length > MAX_CHECK_OUTPUT ? combined.slice(-MAX_CHECK_OUTPUT) : combined;
      if (error) {
        const reason = error.killed ? "timed out" : `exited with code ${error.code}`;
        resolve({ name, ok: false, output: `${reason}\n${truncated || "(no output)"}` });
        return;
      }
      resolve({ name, ok: true, output: truncated || "(no output)" });
    });
  });
}

/** True only if TypeScript is actually installed locally — never shells out to npx and risks an install prompt/hang. */
function hasLocalTypescript(root: string): boolean {
  return fs.existsSync(path.join(root, "node_modules", "typescript", "package.json"));
}

export async function runVerification(
  root: string,
  memory: ProjectMemory,
  touchedFiles: string[]
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];

  const touchedTs = touchedFiles.some((f) => /\.(ts|tsx)$/i.test(f));
  if (touchedTs && fs.existsSync(path.join(root, "tsconfig.json")) && hasLocalTypescript(root)) {
    const bin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
    const tscCmd = fs.existsSync(bin) ? `"${bin}" --noEmit` : "npx --no-install tsc --noEmit";
    checks.push(await runCommandCheck(root, "typecheck (tsc --noEmit)", tscCmd));
  }

  if (memory.buildCommand) checks.push(await runCommandCheck(root, `build (${memory.buildCommand})`, memory.buildCommand));
  if (memory.testCommand) checks.push(await runCommandCheck(root, `test (${memory.testCommand})`, memory.testCommand));
  if (memory.lintCommand) checks.push(await runCommandCheck(root, `lint (${memory.lintCommand})`, memory.lintCommand));

  const ranAny = checks.length > 0;
  return { ranAny, ok: ranAny && checks.every((c) => c.ok), checks };
}
