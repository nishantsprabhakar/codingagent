/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Durable, per-project facts (package manager, test/build/lint commands,
 * framework, conventions) so the agent doesn't have to rediscover them every
 * session. Seeded once by inspecting package.json/lockfiles, then refined as
 * the agent observes what actually works. Never stores secrets.
 */
import * as fs from "fs";
import * as path from "path";
import type { ProjectMemory } from "./types";

const FRAMEWORK_HINTS: Array<[RegExp, string]> = [
  [/^next$/, "Next.js"],
  [/^react(-dom)?$/, "React"],
  [/^vue$/, "Vue"],
  [/^svelte$/, "Svelte"],
  [/^@angular\/core$/, "Angular"],
  [/^express$/, "Express"],
  [/^fastify$/, "Fastify"],
  [/^django$/, "Django"],
  [/^flask$/, "Flask"],
];

function memoryPath(root: string): string {
  return path.join(root, ".coding-agent", "memory.json");
}

/** Never throws — a missing/corrupt file just means no stored memory yet. */
export function loadProjectMemory(root: string): ProjectMemory {
  try {
    const filePath = memoryPath(root);
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

/** Best-effort — a write failure shouldn't interrupt the agent loop. */
export function saveProjectMemory(root: string, memory: ProjectMemory): void {
  try {
    const filePath = memoryPath(root);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), "utf-8");
  } catch (err: any) {
    console.error("[coding-agent] warning: failed to save project memory:", err.message ?? err);
  }
}

/** Merges newly-learned facts into stored memory without discarding anything already known. */
export function updateProjectMemory(root: string, patch: Partial<ProjectMemory>): void {
  const current = loadProjectMemory(root);
  saveProjectMemory(root, { ...current, ...patch });
}

/**
 * Seeds project memory from package.json + lockfiles the first time a
 * project is opened (no-op if memory.json already exists — we never
 * overwrite facts the agent, or the user, may have already refined).
 */
export function detectProjectMemory(root: string): ProjectMemory {
  if (fs.existsSync(memoryPath(root))) return loadProjectMemory(root);

  const memory: ProjectMemory = {};
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) memory.packageManager = "pnpm";
  else if (fs.existsSync(path.join(root, "yarn.lock"))) memory.packageManager = "yarn";
  else if (fs.existsSync(path.join(root, "package-lock.json"))) memory.packageManager = "npm";
  else if (fs.existsSync(path.join(root, "requirements.txt")) || fs.existsSync(path.join(root, "pyproject.toml")))
    memory.packageManager = "pip";

  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const runner = memory.packageManager && memory.packageManager !== "pip" ? memory.packageManager : "npm";
      if (pkg.scripts?.test) memory.testCommand = `${runner} test`;
      if (pkg.scripts?.build) memory.buildCommand = `${runner} run build`;
      if (pkg.scripts?.lint) memory.lintCommand = `${runner} run lint`;

      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [pattern, name] of FRAMEWORK_HINTS) {
        if (Object.keys(deps ?? {}).some((dep) => pattern.test(dep))) {
          memory.framework = name;
          break;
        }
      }
    } catch {
      // unreadable/corrupt package.json — leave memory as-is
    }
  }

  saveProjectMemory(root, memory);
  return memory;
}

/** Renders known facts as a short block for the system prompt — omitted entirely when nothing is known yet. */
export function formatProjectMemoryForPrompt(memory: ProjectMemory): string {
  const lines: string[] = [];
  if (memory.packageManager) lines.push(`- Package manager: ${memory.packageManager}`);
  if (memory.framework) lines.push(`- Framework: ${memory.framework}`);
  if (memory.testCommand) lines.push(`- Test command: ${memory.testCommand}`);
  if (memory.buildCommand) lines.push(`- Build command: ${memory.buildCommand}`);
  if (memory.lintCommand) lines.push(`- Lint command: ${memory.lintCommand}`);
  if (memory.conventions?.length) lines.push(`- Conventions: ${memory.conventions.join("; ")}`);
  if (memory.blockedCommands?.length) lines.push(`- Previously blocked/denied commands: ${memory.blockedCommands.join("; ")}`);
  if (memory.preferences?.length) lines.push(`- User preferences for this project: ${memory.preferences.join("; ")}`);
  if (memory.learnedLessons?.length) lines.push(`- Lessons from past quality-check failures — don't repeat these: ${memory.learnedLessons.join("; ")}`);
  return lines.length ? `Known project facts (learned from past sessions):\n${lines.join("\n")}` : "";
}

/** Appends one standing preference (from remember_preference, scope=project), deduplicated. */
export function addProjectPreference(root: string, text: string): { added: boolean; preferences: string[] } {
  const clean = text.trim();
  const memory = loadProjectMemory(root);
  const existing = memory.preferences ?? [];
  if (!clean || existing.includes(clean)) return { added: false, preferences: existing };
  const preferences = [...existing, clean];
  updateProjectMemory(root, { preferences });
  return { added: true, preferences };
}
