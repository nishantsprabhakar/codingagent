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
    // Whatever project this is, our own memory file shouldn't end up in its git history (and,
    // since Phase 10, shouldn't make a perfectly clean project look "dirty" to Best-of-N's
    // clean-working-tree precondition) -- a nested .gitignore covers that regardless of the target
    // project's own .gitignore contents. Same pattern already used by session.ts/codeIndex.ts/evidence.ts.
    const gitignorePath = path.join(root, ".coding-agent", ".gitignore");
    if (!fs.existsSync(gitignorePath)) fs.writeFileSync(gitignorePath, "*\n", "utf-8");
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

/** The package.json/lockfile scan shared by detectProjectMemory (first run) and refreshMissingCommands
 *  (every later run) — pulled out so both can re-derive the same facts from the same source of truth. */
function scanPackageJson(root: string): Pick<ProjectMemory, "packageManager" | "testCommand" | "buildCommand" | "lintCommand" | "framework"> {
  const found: ReturnType<typeof scanPackageJson> = {};
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) found.packageManager = "pnpm";
  else if (fs.existsSync(path.join(root, "yarn.lock"))) found.packageManager = "yarn";
  else if (fs.existsSync(path.join(root, "package-lock.json"))) found.packageManager = "npm";
  else if (fs.existsSync(path.join(root, "requirements.txt")) || fs.existsSync(path.join(root, "pyproject.toml")))
    found.packageManager = "pip";

  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const runner = found.packageManager && found.packageManager !== "pip" ? found.packageManager : "npm";
      if (pkg.scripts?.test) found.testCommand = `${runner} test`;
      if (pkg.scripts?.build) found.buildCommand = `${runner} run build`;
      if (pkg.scripts?.lint) found.lintCommand = `${runner} run lint`;

      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [pattern, name] of FRAMEWORK_HINTS) {
        if (Object.keys(deps ?? {}).some((dep) => pattern.test(dep))) {
          found.framework = name;
          break;
        }
      }
    } catch {
      // unreadable/corrupt package.json — leave found as-is
    }
  }
  return found;
}

/**
 * Seeds project memory from package.json + lockfiles the first time a
 * project is opened (no-op if memory.json already exists — we never
 * overwrite facts the agent, or the user, may have already refined).
 */
export function detectProjectMemory(root: string): ProjectMemory {
  if (fs.existsSync(memoryPath(root))) return loadProjectMemory(root);
  const memory: ProjectMemory = scanPackageJson(root);
  saveProjectMemory(root, memory);
  return memory;
}

/**
 * Closes a real gap `detectProjectMemory` alone leaves open: it only scans package.json the very
 * first time a project is opened, so a test/build/lint script the model adds mid-session (or in an
 * earlier session, before this project had one) never gets picked up — verification silently has
 * nothing to run for the rest of the project's life, not just that one turn. Call this right before
 * verification; it's a cheap no-op (no disk I/O beyond one directory check) once all three commands
 * are already known, and only re-scans package.json when at least one is still missing.
 */
export function refreshMissingCommands(root: string, memory: ProjectMemory): ProjectMemory {
  if (memory.testCommand && memory.buildCommand && memory.lintCommand) return memory;

  const found = scanPackageJson(root);
  const patch: Partial<ProjectMemory> = {};
  if (!memory.testCommand && found.testCommand) patch.testCommand = found.testCommand;
  if (!memory.buildCommand && found.buildCommand) patch.buildCommand = found.buildCommand;
  if (!memory.lintCommand && found.lintCommand) patch.lintCommand = found.lintCommand;
  if (!memory.framework && found.framework) patch.framework = found.framework;
  if (!memory.packageManager && found.packageManager) patch.packageManager = found.packageManager;

  if (Object.keys(patch).length === 0) return memory;
  const updated = { ...memory, ...patch };
  saveProjectMemory(root, updated);
  return updated;
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
