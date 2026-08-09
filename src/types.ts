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

export type LlmProvider = "pollinations" | "groq" | "openrouter" | "gemini" | "cerebras" | "mistral";

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

/** How dangerous an action is judged to be — drives permission UX and whether "always allow" is offered. */
export type RiskLevel = "low" | "medium" | "high";

export interface ToolSpec {
  definition: ToolDefinition;
  /** Mutating tools require permission before running; read-only ones don't. */
  mutating: boolean;
  /** Short label used in permission prompts, e.g. "write test.txt". */
  describe: (args: any) => string;
  /** Optional richer preview (e.g. a diff) shown above the permission prompt. */
  preview?: (args: any, ctx: ToolContext) => Promise<string>;
  /**
   * Optional per-call risk classification. Defaults applied by the caller
   * when absent: "medium" for mutating tools, "low" for read-only ones.
   */
  riskOf?: (args: any) => RiskLevel;
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

/** The end-state of one V-Cycle transaction (one user turn's worth of mutating work). */
export type TransactionOutcome = "verified" | "unverified_changes" | "failed" | "no_changes" | "blocked";

/** One mutating (or attempted-mutating) action taken during a transaction, for the audit trail. */
export interface ActionLogEntry {
  toolCallId: string;
  name: string;
  label: string;
  args: unknown;
  risk: RiskLevel;
  ok: boolean;
  output: string;
  timestamp: number;
  /** Present for file-mutating tools — the pre-change state, used for manual rollback. */
  fileSnapshot?: { path: string; existed: boolean; before: string | null };
}

export interface VerificationCheck {
  name: string;
  ok: boolean;
  output: string;
}

/** ranAny=false means no applicable check existed to run — distinct from a check that ran and passed. */
export interface VerificationResult {
  ranAny: boolean;
  ok: boolean;
  checks: VerificationCheck[];
}

/** The full audit record for one user turn, persisted to .coding-agent/transactions/<sessionId>.jsonl. */
export interface TransactionRecord {
  id: string;
  sessionId: string;
  startedAt: number;
  endedAt?: number;
  intent: string;
  gitStatusBefore: string | null;
  gitStatusAfter?: string | null;
  actions: ActionLogEntry[];
  verification?: VerificationResult;
  repairAttempts: number;
  /** Total number of independent per-step critique calls made this turn (pass or fail), bounded and cost-capped. */
  criticCalls: number;
  outcome: TransactionOutcome;
  confidence: number;
}

/** Durable, per-project facts the agent has learned — never secrets. Persisted to .coding-agent/memory.json. */
export interface ProjectMemory {
  packageManager?: string;
  testCommand?: string;
  buildCommand?: string;
  lintCommand?: string;
  framework?: string;
  conventions?: string[];
  blockedCommands?: string[];
}

/** A past turn replayed to a freshly (re)connected client on session restore. */
export type HistoryItem =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; id: string; name: string; label: string; args: unknown; output: string; ok: boolean }
  | { type: "error"; text: string }
  | { type: "verification"; result: VerificationResult }
  | { type: "critique"; pass: boolean; reason: string }
  | {
      type: "transaction_summary";
      transactionId: string;
      confidence: number;
      outcome: TransactionOutcome;
      rollbackAvailable: boolean;
    };

/**
 * Abstracts how agent activity is surfaced to a human: the CLI renders it to
 * stdout with ANSI colors, the web UI serializes it over a WebSocket.
 */
export interface Reporter {
  toolCall(id: string, name: string, label: string, args: unknown, risk: RiskLevel): void;
  toolResult(id: string, output: string, ok: boolean): void;
  error(text: string): void;
  thinking(isThinking: boolean): void;
  tasks(tasks: TaskItem[]): void;
  history(items: HistoryItem[]): void;
  files(files: string[]): void;
  /** A streamed chunk of the assistant's current message, as the model generates it token by token. */
  assistantDelta(chunk: string): void;
  /**
   * Marks the end of one streamed message with its authoritative full text —
   * fires both for reasoning that precedes tool calls (isFinal=false) and for
   * the turn's true final answer (isFinal=true, which is what should unlock
   * the composer / mark the turn complete on the client).
   */
  assistantDeltaEnd(fullText: string, isFinal: boolean): void;
  /** Results of the post-turn verification pass (build/test/lint), if any ran. */
  verification(result: VerificationResult): void;
  /** Verdict from the independent per-step reviewer, if it ran for this round. */
  critique(pass: boolean, reason: string): void;
  /** Final evidence-based summary of a completed transaction (one user turn). */
  transactionSummary(transactionId: string, confidence: number, outcome: TransactionOutcome, rollbackAvailable: boolean): void;
}
