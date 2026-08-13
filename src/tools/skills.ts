/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Phase 8 — versioned skill packages. A skill is a directory under .coding-agent/skills/<slug>/
 * containing manifest.json (the single source of truth this module reads back), a generated,
 * write-only SKILL.md (human-readable, never parsed by this app — avoids a two-sources-of-truth
 * risk), and optionally scripts/<file> + tests/sample-input.json.
 *
 * Execution safety: a skill's script, if it has one, is NEVER executed by this module or by
 * save_skill/recall_skill. The only way it ever runs is the model separately calling
 * run_shell_command with the exact command recall_skill previews — which still hits that tool's
 * own risk-classified permission prompt, exactly like any other shell command. No sandbox, because
 * nothing here is automatic to begin with. (Caveat, not this module's concern to enforce: if the
 * user has already clicked "Always allow" for run_shell_command earlier in the session, that
 * carries over to a skill's command too — see docs/architecture/2026-08-phase8-skills-platform.md.)
 *
 * Legacy compatibility: skills saved before this phase are flat JSON files at
 * .coding-agent/skills/<slug>.json. They keep loading indefinitely — never force-migrated — but any
 * skill re-saved through save_skill is rewritten into the new package format, and its old flat file
 * is removed only after the new package is fully written (never before).
 *
 * Not related to the .claude/skills/ directory some repos have for working on themselves with
 * Claude Code — that is unrelated, read-only reference tooling (see skillLibrary.ts), not a feature
 * of Wrexlyn's own agent.
 */
import * as fs from "fs";
import * as path from "path";
import type { ToolDefinition, ToolSpec } from "../types";

export interface SkillScript {
  /** Root-relative, e.g. ".coding-agent/skills/deploy-to-staging/scripts/run.js". */
  relativePath: string;
  description: string;
  args?: string;
  /** The full, server-computed invocation, e.g. "node .coding-agent/skills/deploy-to-staging/scripts/run.js --env=staging". */
  command: string;
}

export interface SkillRecord {
  name: string;
  description: string;
  steps: string;
  version?: number;
  createdAt?: number;
  updatedAt?: number;
  script?: SkillScript;
  hasTestFixture?: boolean;
}

export interface SaveSkillInput {
  name: string;
  description: string;
  steps: string;
  scriptContent?: string;
  scriptFilename?: string;
  scriptDescription?: string;
  scriptArgs?: string;
  testFixture?: unknown;
}

export interface SaveSkillResult {
  ok: boolean;
  error?: string;
}

interface SkillManifest {
  name: string;
  description: string;
  steps: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  script?: SkillScript;
  hasTestFixture: boolean;
  hasEvals: false;
}

/** Extension -> interpreter. Deliberately the only thing that decides how a script would be
 *  invoked — a model never supplies the command string itself (see module doc comment). */
const INTERPRETER_BY_EXT: Record<string, string> = {
  ".js": "node",
  ".mjs": "node",
  ".cjs": "node",
  ".py": "python",
  ".sh": "bash",
  ".ps1": "powershell -File",
};

function skillsDir(root: string): string {
  return path.join(root, ".coding-agent", "skills");
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "skill";
}

function legacySkillPath(root: string, slug: string): string {
  return path.join(skillsDir(root), `${slug}.json`);
}
function packageDir(root: string, slug: string): string {
  return path.join(skillsDir(root), slug);
}
function manifestPath(root: string, slug: string): string {
  return path.join(packageDir(root, slug), "manifest.json");
}
function skillMdPath(root: string, slug: string): string {
  return path.join(packageDir(root, slug), "SKILL.md");
}
function scriptsDir(root: string, slug: string): string {
  return path.join(packageDir(root, slug), "scripts");
}
function testsDir(root: string, slug: string): string {
  return path.join(packageDir(root, slug), "tests");
}

/**
 * Reduces to a safe basename and rejects anything that isn't a plain filename with a supported
 * extension. save_skill is permission-exempt (same tier as remember_preference/record_evidence),
 * so this is the one thing standing between a model-supplied filename and fs.writeFileSync —
 * without it, something like "../../../../Windows/System32/evil.dll" would let a save_skill call
 * write attacker/model-controlled content to an attacker/model-controlled path outside
 * .coding-agent/skills/ entirely, with zero confirmation of any kind.
 */
export function validateScriptFilename(raw: string): string | null {
  const base = path.basename(String(raw ?? "").trim());
  if (!base || base === "." || base === "..") return null;
  if (!/^[A-Za-z0-9._-]+$/.test(base)) return null;
  const ext = path.extname(base).toLowerCase();
  if (!INTERPRETER_BY_EXT[ext]) return null;
  return base;
}

function buildScriptCommand(slug: string, filename: string, args?: string): string {
  const interpreter = INTERPRETER_BY_EXT[path.extname(filename).toLowerCase()];
  const relPath = `.coding-agent/skills/${slug}/scripts/${filename}`;
  return args ? `${interpreter} ${relPath} ${args}` : `${interpreter} ${relPath}`;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function loadLegacySkill(root: string, filename: string): { slug: string; record: SkillRecord } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(skillsDir(root), filename), "utf-8"));
    if (raw && typeof raw.name === "string" && typeof raw.description === "string" && typeof raw.steps === "string") {
      return { slug: slugify(raw.name), record: { name: raw.name, description: raw.description, steps: raw.steps } };
    }
  } catch {
    // corrupt/unreadable legacy file — skip it
  }
  return null;
}

function loadPackageSkill(root: string, slug: string): SkillRecord | null {
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath(root, slug), "utf-8"));
    if (!raw || typeof raw.name !== "string" || typeof raw.description !== "string" || typeof raw.steps !== "string") return null;
    const record: SkillRecord = { name: raw.name, description: raw.description, steps: raw.steps };
    if (typeof raw.version === "number") record.version = raw.version;
    if (typeof raw.createdAt === "number") record.createdAt = raw.createdAt;
    if (typeof raw.updatedAt === "number") record.updatedAt = raw.updatedAt;
    if (raw.script && typeof raw.script.command === "string") record.script = raw.script;
    if (raw.hasTestFixture) record.hasTestFixture = true;
    return record;
  } catch {
    return null;
  }
}

/** Never throws — a missing/corrupt skills directory or file just means fewer (or no) skills loaded.
 *  Reads legacy flat *.json files, then package directories — a package always wins over a
 *  same-slug legacy entry, so a skill mid-migration (or one saved both ways by a past bug) never
 *  renders twice. */
export function loadProjectSkills(root: string): SkillRecord[] {
  const dir = skillsDir(root);
  if (!fs.existsSync(dir)) return [];

  const bySlug = new Map<string, SkillRecord>();
  const entries = safeReaddir(dir);

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const legacy = loadLegacySkill(root, entry);
    if (legacy) bySlug.set(legacy.slug, legacy.record);
  }

  for (const entry of entries) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path.join(dir, entry));
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const record = loadPackageSkill(root, entry);
    if (record) bySlug.set(entry, record); // package always wins over a same-slug legacy entry
  }

  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function renderSkillMd(manifest: SkillManifest): string {
  const lines = ["---", `name: ${manifest.name}`, `description: ${manifest.description}`, "---", "", manifest.steps, ""];
  if (manifest.script) {
    lines.push("## Script", "", manifest.script.description, "", "```", manifest.script.command, "```", "");
  }
  return lines.join("\n");
}

/**
 * Writes the new package format, always. If a script is supplied, `scriptFilename` must pass
 * validateScriptFilename or the whole save is rejected (not silently dropped). Version is a
 * monotonic integer incremented from whatever the existing package's manifest says (falling back
 * to 1 on a missing/corrupt manifest, never throwing) — no prior revisions are retained on disk;
 * this is "has this skill been revised," not real version history.
 *
 * Migration ordering matters: the new package is written COMPLETELY before any legacy
 * <slug>.json for the same name is removed. A failure partway through the write leaves the old
 * legacy file intact (recoverable); the legacy-delete step itself is best-effort/logged, same
 * philosophy as deleteProjectSkill.
 */
export function saveProjectSkill(root: string, input: SaveSkillInput): SaveSkillResult {
  const slug = slugify(input.name);

  let sanitizedFilename: string | null = null;
  if (input.scriptContent !== undefined) {
    sanitizedFilename = validateScriptFilename(input.scriptFilename ?? "");
    if (!sanitizedFilename) {
      return {
        ok: false,
        error: `Invalid scriptFilename "${input.scriptFilename ?? ""}" — use a plain filename with a supported extension (${Object.keys(
          INTERPRETER_BY_EXT
        ).join(", ")}), no path segments.`,
      };
    }
  }

  let version = 1;
  let createdAt = Date.now();
  try {
    const existing = JSON.parse(fs.readFileSync(manifestPath(root, slug), "utf-8"));
    if (typeof existing.version === "number") version = existing.version + 1;
    if (typeof existing.createdAt === "number") createdAt = existing.createdAt;
  } catch {
    // no existing package (or a corrupt one) — treat as a brand-new skill: version 1, createdAt now
  }

  const scriptArgs = input.scriptArgs?.trim() || undefined;
  const script: SkillScript | undefined = sanitizedFilename
    ? {
        relativePath: `.coding-agent/skills/${slug}/scripts/${sanitizedFilename}`,
        description: input.scriptDescription?.trim() || "Runs this skill's attached script.",
        args: scriptArgs,
        command: buildScriptCommand(slug, sanitizedFilename, scriptArgs),
      }
    : undefined;

  const manifest: SkillManifest = {
    name: input.name,
    description: input.description,
    steps: input.steps,
    version,
    createdAt,
    updatedAt: Date.now(),
    ...(script ? { script } : {}),
    hasTestFixture: input.testFixture !== undefined,
    hasEvals: false,
  };

  try {
    fs.mkdirSync(packageDir(root, slug), { recursive: true });
    fs.writeFileSync(manifestPath(root, slug), JSON.stringify(manifest, null, 2), "utf-8");
    fs.writeFileSync(skillMdPath(root, slug), renderSkillMd(manifest), "utf-8");

    if (sanitizedFilename && input.scriptContent !== undefined) {
      fs.mkdirSync(scriptsDir(root, slug), { recursive: true });
      fs.writeFileSync(path.join(scriptsDir(root, slug), sanitizedFilename), input.scriptContent, "utf-8");
    }
    if (input.testFixture !== undefined) {
      fs.mkdirSync(testsDir(root, slug), { recursive: true });
      fs.writeFileSync(path.join(testsDir(root, slug), "sample-input.json"), JSON.stringify(input.testFixture, null, 2), "utf-8");
    }
  } catch (err: any) {
    return { ok: false, error: `Failed to save skill: ${err.message ?? err}` };
  }

  // Only after the new package is fully written above — best-effort, never rolls back the save.
  try {
    fs.rmSync(legacySkillPath(root, slug), { force: true });
  } catch (err: any) {
    console.error("[coding-agent] warning: failed to remove legacy skill file during migration:", err.message ?? err);
  }

  return { ok: true };
}

/** Best-effort, idempotent. Removes both possible on-disk shapes for this name — the legacy flat
 *  file AND the package directory — so a migrated skill's "Delete" doesn't silently no-op and leave
 *  the package (including any scripts/tests) on disk forever. Deleting the whole package directory
 *  as a unit also means a script file can never end up orphaned (nothing lives outside it). */
export function deleteProjectSkill(root: string, name: string): void {
  const slug = slugify(name);
  try {
    fs.rmSync(legacySkillPath(root, slug), { force: true });
  } catch (err: any) {
    console.error("[coding-agent] warning: failed to delete legacy skill file:", err.message ?? err);
  }
  try {
    fs.rmSync(packageDir(root, slug), { recursive: true, force: true });
  } catch (err: any) {
    console.error("[coding-agent] warning: failed to delete skill package directory:", err.message ?? err);
  }
}

/** Renders the name+description index for the system prompt — full `steps` (and any script) stay out to keep the prompt small. */
export function formatSkillsIndexForPrompt(skills: SkillRecord[]): string {
  if (!skills.length) return "";
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`);
  return `Saved skills for this project (call recall_skill(name) for the full steps):\n${lines.join("\n")}`;
}

/**
 * Handled specially by Agent.executeToolCall (like update_tasks / remember_preference) because saving
 * a skill needs to rebuild the system prompt's skills index in place, not just write a file — so only
 * its definition lives here.
 */
export const SAVE_SKILL_DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: "save_skill",
    description:
      "Persist a genuinely reusable multi-step pattern you just completed, so it doesn't have to be re-derived " +
      "from scratch the next time it comes up in this project (a deployment sequence, a report's structure, a " +
      "recurring analysis). Not for one-off work unlikely to repeat. Saving with an existing skill's exact name " +
      "overwrites it — use that to refine a skill you already saved. Optionally attach a reusable script " +
      "(scriptContent/scriptFilename/scriptDescription/scriptArgs) — it is never run automatically; recall_skill " +
      "will show the exact command later, and actually running it always requires a separate run_shell_command " +
      "call that the user must approve, same as any other shell command.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short, distinct name, e.g. 'Deploy to staging'." },
        description: { type: "string", description: "One sentence: what this does and when to use it." },
        steps: { type: "string", description: "The actual steps/commands/approach, in enough detail to follow without re-deriving it." },
        scriptContent: {
          type: "string",
          description:
            "Optional: the full source of a reusable script for this skill (e.g. a scoring script, a migration " +
            "helper). Never executed automatically.",
        },
        scriptFilename: {
          type: "string",
          description: "Required if scriptContent is given: a plain filename with a supported extension (.js, .mjs, .cjs, .py, .sh, .ps1) — no path segments.",
        },
        scriptDescription: { type: "string", description: "One sentence: what the script does and how/when to run it." },
        scriptArgs: { type: "string", description: "Optional fixed arguments to append after the script path when it's run, e.g. '--env=staging'." },
        testFixture: { description: "Optional example input (any JSON value) stored alongside the skill as a reference fixture — not run or graded automatically." },
      },
      required: ["name", "description", "steps"],
    },
  },
};

export const recallSkillTool: ToolSpec = {
  mutating: false,
  definition: {
    type: "function",
    function: {
      name: "recall_skill",
      description: "Retrieve the full steps for a previously saved skill by name — see the saved-skills index in your system prompt for what's available.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "The skill's name, as listed in the saved-skills index." } },
        required: ["name"],
      },
    },
  },
  describe: (args) => `recall skill "${args.name}"`,
  run: async (args, ctx) => {
    const skills = loadProjectSkills(ctx.root);
    const wanted = String(args.name ?? "").toLowerCase();
    const match = skills.find((s) => s.name.toLowerCase() === wanted);
    if (!match) {
      const available = skills.map((s) => s.name).join(", ") || "(none saved yet)";
      return { ok: false, output: `No saved skill named "${args.name}". Available: ${available}` };
    }
    let output = `${match.name}: ${match.description}\n\n${match.steps}`;
    if (match.script) {
      output +=
        `\n\nThis skill has an attached script: ${match.script.description}\n` +
        `To run it, call run_shell_command with this exact command (you will be asked to confirm, same as any other shell command):\n` +
        `  ${match.script.command}`;
    }
    return { ok: true, output };
  },
};
