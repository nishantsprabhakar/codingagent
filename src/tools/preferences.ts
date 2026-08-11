/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * remember_preference — how the agent "learns preferences based on its own user's input": when the
 * user states a standing preference (not a one-off ask), this persists it and Agent rebuilds the
 * system prompt in place, the same way setGlobalInstructions() already does, so it applies starting
 * with the very next response in this same session, not just next time the project is opened.
 *
 * Handled specially by Agent.executeToolCall (like update_tasks) because applying a preference means
 * rebuilding session state (this.sysMessage), not just touching a file — so only its definition and
 * the pure persistence logic live here, no ToolSpec/run().
 */
import type { ToolDefinition } from "../types";
import { addProjectPreference } from "../projectMemory";
import { appendGlobalInstruction } from "../globalSettings";

export const REMEMBER_PREFERENCE_DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: "remember_preference",
    description:
      "Persist a standing user preference about formatting, tone, or workflow so it applies to every future turn " +
      "— call this the moment the user states one (e.g. 'always use the light pptx theme', 'never use emoji in " +
      "reports', 'keep commit messages under 50 chars'), rather than just applying it once this turn and letting " +
      "it lapse. Don't call this for a one-off request that only applies to the current ask.",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["project", "global"],
          description: "'project' (default): applies only to this project. 'global': applies across every project on this machine.",
        },
        text: { type: "string", description: "The preference stated plainly, e.g. 'Use the light pptx theme by default.'" },
      },
      required: ["text"],
    },
  },
};

/** Persists the preference to the right store. Returns a short confirmation string for the tool result. */
export function applyRememberedPreference(root: string, scope: unknown, text: unknown): string {
  const clean = typeof text === "string" ? text.trim() : "";
  if (!clean) return "No preference text given — nothing saved.";

  if (scope === "global") {
    appendGlobalInstruction(clean);
    return `Remembered globally (applies to every project on this machine): "${clean}"`;
  }

  const { added } = addProjectPreference(root, clean);
  return added
    ? `Remembered for this project: "${clean}"`
    : `Already remembered for this project: "${clean}"`;
}
