/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import * as path from "path";
import type { EvalTask } from "./types";

/** Reads every evals/tasks/<id>/task.json + its sibling repo/ directory. Throws on a malformed
 *  fixture -- a benchmark corpus with a broken task should fail loudly, not silently skip it. */
export function discoverTasks(tasksDir: string): EvalTask[] {
  if (!fs.existsSync(tasksDir)) return [];
  const tasks: EvalTask[] = [];
  for (const entry of fs.readdirSync(tasksDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const taskDir = path.join(tasksDir, entry.name);
    const taskJsonPath = path.join(taskDir, "task.json");
    const repoDir = path.join(taskDir, "repo");
    if (!fs.existsSync(taskJsonPath)) throw new Error(`Task "${entry.name}" is missing task.json`);
    if (!fs.existsSync(repoDir)) throw new Error(`Task "${entry.name}" is missing its repo/ directory`);

    const parsed = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8"));
    if (!parsed.id || !parsed.title || !parsed.prompt || !parsed.difficulty) {
      throw new Error(`Task "${entry.name}"'s task.json is missing a required field (id/title/prompt/difficulty)`);
    }
    tasks.push({
      id: parsed.id,
      title: parsed.title,
      prompt: parsed.prompt,
      difficulty: parsed.difficulty,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      repoDir,
    });
  }
  return tasks.sort((a, b) => a.id.localeCompare(b.id));
}
