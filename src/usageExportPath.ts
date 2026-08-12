/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

let dirOverrideForTesting: string | null = null;

/** Test-only seam — never called by production code. */
export function _setUsageExportDirForTesting(dir: string | null): void {
  dirOverrideForTesting = dir;
}

/**
 * Resolves the folder the live usage workbook is written into, in priority order:
 * 1. `WREXLYN_USAGE_DIR` env var — explicit override.
 * 2. The OneDrive sync root, if this machine has one (`%OneDrive%` / `%OneDriveCommercial%`) —
 *    a "Wrexlyn Usage" subfolder inside it, so the file syncs to the cloud automatically.
 * 3. A Google Drive desktop-sync folder, if one exists at its default location.
 * 4. `~/.coding-agent/usage-export` — local-only fallback; still usable, just not cloud-synced.
 */
export function resolveUsageExportDir(): string {
  if (dirOverrideForTesting) return dirOverrideForTesting;

  const envDir = process.env.WREXLYN_USAGE_DIR;
  if (envDir) return envDir;

  const oneDrive = process.env.OneDrive || process.env.OneDriveCommercial;
  if (oneDrive && fs.existsSync(oneDrive)) {
    return path.join(oneDrive, "Wrexlyn Usage");
  }

  const googleDriveCandidates = [
    path.join(os.homedir(), "Google Drive"),
    path.join(os.homedir(), "GoogleDrive"),
    path.join(os.homedir(), "My Drive"),
  ];
  for (const candidate of googleDriveCandidates) {
    if (fs.existsSync(candidate)) return path.join(candidate, "Wrexlyn Usage");
  }

  return path.join(os.homedir(), ".coding-agent", "usage-export");
}

/** Full path to the live usage workbook, inside whichever folder resolveUsageExportDir() picks. */
export function usageWorkbookPath(): string {
  return path.join(resolveUsageExportDir(), "wrexlyn-usage.xlsx");
}
