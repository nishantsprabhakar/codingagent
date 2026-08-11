/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * How the agent "builds new skills" — a genuinely reusable multi-step pattern gets saved once
 * (save_skill) and is available in every later session for this project, listed by name+description
 * in the system prompt and retrievable in full on demand (recall_skill). Persisted as plain JSON
 * under .coding-agent/skills/, the same trust boundary and load/save convention as ProjectMemory
 * (see projectMemory.ts) — not related to the .claude/skills/ directory some repos have for working
 * on themselves with Claude Code, which is unrelated tooling, not a feature of Wrexlyn itself.
 */
import * as fs from "fs";
import * as path from "path";
import type { ToolDefinition, ToolSpec } from "../types";

export interface SkillRecord {
  name: string;
  description: string;
  steps: string;
}

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

/** Never throws — a missing/corrupt skills directory or file just means fewer (or no) skills loaded. */
export function loadProjectSkills(root: string): SkillRecord[] {
  const dir = skillsDir(root);
  if (!fs.existsSync(dir)) return [];
  const skills: SkillRecord[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
      if (raw && typeof raw.name === "string" && typeof raw.description === "string" && typeof raw.steps === "string") {
        skills.push({ name: raw.name, description: raw.description, steps: raw.steps });
      }
    } catch {
      // corrupt/unreadable skill file — skip it rather than fail the whole load
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** Best-effort — a write failure shouldn't interrupt the agent loop. Overwrites a same-named skill. */
export function saveProjectSkill(root: string, skill: SkillRecord): void {
  try {
    const dir = skillsDir(root);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${slugify(skill.name)}.json`), JSON.stringify(skill, null, 2), "utf-8");
  } catch (err: any) {
    console.error("[coding-agent] warning: failed to save skill:", err.message ?? err);
  }
}

/** Renders the name+description index for the system prompt — full `steps` stay out to keep the prompt small. */
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
      "overwrites it — use that to refine a skill you already saved.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short, distinct name, e.g. 'Deploy to staging'." },
        description: { type: "string", description: "One sentence: what this does and when to use it." },
        steps: { type: "string", description: "The actual steps/commands/approach, in enough detail to follow without re-deriving it." },
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
    return { ok: true, output: `${match.name}: ${match.description}\n\n${match.steps}` };
  },
};
