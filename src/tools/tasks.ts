import type { ToolDefinition } from "../types";

/**
 * Handled specially by Agent.executeToolCall (it needs to mutate session
 * state and push a live update to the UI, not just touch the filesystem),
 * so only its definition lives here — no ToolSpec/run().
 */
export const UPDATE_TASKS_DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: "update_tasks",
    description:
      "Set the current task list for this session — shown to the user as a live checklist, the same way you'd " +
      "track your own todos. Call it once at the start of any multi-step piece of work to lay out your plan, and " +
      "again every time a task's status changes. Always pass the FULL list, not a diff. Skip this entirely for " +
      "single-step, trivial requests.",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description: "The complete, current task list.",
          items: {
            type: "object",
            properties: {
              subject: { type: "string", description: "Short, specific, imperative — e.g. 'Add login form validation'." },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] },
            },
            required: ["subject", "status"],
          },
        },
      },
      required: ["tasks"],
    },
  },
};
