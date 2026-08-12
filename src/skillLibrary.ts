/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Read-only view of a project's `.claude/skills/` directory (Claude Code's skill format — SKILL.md
 * frontmatter + reference material), for display in Wrexlyn's own UI. This is a DIFFERENT system from
 * tools/skills.ts's save_skill/recall_skill (Wrexlyn's own per-project learned skills) — this module
 * never writes anything, it just lets a Wrexlyn user see what's documented here, since Wrexlyn's own
 * agent doesn't invoke these directly (they're Claude Code's mechanism, not Wrexlyn's).
 */
import * as fs from "fs";
import * as path from "path";

export interface SkillLibraryEntry {
  name: string;
  description: string;
  /** Folder name relative to .claude/skills/ — lets the client link to/open SKILL.md if it wants to. */
  path: string;
}

/** Extracts `name:`/`description:` from a `---`-delimited YAML frontmatter block. Never throws. */
function parseFrontmatter(text: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const result: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^(name|description):\s*(.*)$/.exec(line);
    if (kv) result[kv[1] as "name" | "description"] = kv[2].trim();
  }
  return result;
}

/** Never throws — a missing/absent `.claude/skills/` directory just means an empty library for this project. */
export function loadSkillLibrary(root: string): SkillLibraryEntry[] {
  const dir = path.join(root, ".claude", "skills");
  if (!fs.existsSync(dir)) return [];

  const entries: SkillLibraryEntry[] = [];
  for (const folderName of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!folderName.isDirectory()) continue;
    const skillMdPath = path.join(dir, folderName.name, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;
    try {
      const { name, description } = parseFrontmatter(fs.readFileSync(skillMdPath, "utf-8"));
      if (name && description) entries.push({ name, description, path: folderName.name });
    } catch {
      // unreadable/malformed SKILL.md — skip it rather than fail the whole library load
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
