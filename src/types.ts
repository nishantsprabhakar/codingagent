/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ToolCallRequest[];
}

export type LlmProvider = "pollinations" | "groq" | "openrouter";

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  /** Required for "groq"/"openrouter"; ignored by "pollinations". */
  apiKey?: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolExecResult {
  ok: boolean;
  output: string;
}

export interface ToolSpec {
  definition: ToolDefinition;
  /** Mutating tools require permission before running; read-only ones don't. */
  mutating: boolean;
  /** Short label used in permission prompts, e.g. "write test.txt". */
  describe: (args: any) => string;
  /** Optional richer preview (e.g. a diff) shown above the permission prompt. */
  preview?: (args: any, ctx: ToolContext) => Promise<string>;
  run: (args: any, ctx: ToolContext) => Promise<ToolExecResult>;
}

export interface ToolContext {
  root: string;
}

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface TaskItem {
  subject: string;
  status: TaskStatus;
}

/** A past turn replayed to a freshly (re)connected client on session restore. */
export type HistoryItem =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; id: string; name: string; label: string; args: unknown; output: string; ok: boolean }
  | { type: "error"; text: string };

/**
 * Abstracts how agent activity is surfaced to a human: the CLI renders it to
 * stdout with ANSI colors, the web UI serializes it over a WebSocket.
 */
export interface Reporter {
  toolCall(id: string, name: string, label: string, args: unknown): void;
  toolResult(id: string, output: string, ok: boolean): void;
  assistant(text: string): void;
  error(text: string): void;
  thinking(isThinking: boolean): void;
  tasks(tasks: TaskItem[]): void;
  history(items: HistoryItem[]): void;
  files(files: string[]): void;
}
