/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface Preferences {
  lastModel?: Record<string, string>;
}

function storePath(): string {
  return path.join(os.homedir(), ".coding-agent", "preferences.json");
}

function load(): Preferences {
  try {
    const filePath = storePath();
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function save(prefs: Preferences): void {
  try {
    const filePath = storePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(prefs, null, 2), "utf-8");
  } catch {
    // best-effort
  }
}

/** The last model explicitly chosen for a given provider, so a UI model switch survives a restart. */
export function loadLastModel(provider: string): string | null {
  return load().lastModel?.[provider] ?? null;
}

export function saveLastModel(provider: string, model: string): void {
  const prefs = load();
  prefs.lastModel = { ...prefs.lastModel, [provider]: model };
  save(prefs);
}
