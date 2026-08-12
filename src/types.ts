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
  /**
   * Opaque per-call vendor metadata some providers attach to a tool call and require echoed back verbatim on the
   * next turn — e.g. Gemini's `thought_signature` (an encrypted reasoning-continuity token for its "thinking"
   * models), sent as `tool_calls[i].extra_content` on the OpenAI-compatible endpoint. Never inspect or modify
   * this; just carry it through unchanged, or the provider rejects the follow-up request with a 400.
   */
  extra?: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ToolCallRequest[];
  /** Present only when the provider actually reported it — never fabricated. */
  usage?: TokenUsage;
}

export type LlmProvider = "pollinations" | "groq" | "openrouter" | "gemini" | "cerebras" | "mistral" | "custom";

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  /** Required for "groq"/"openrouter"/etc; optional for "custom" (many local model servers need none); ignored by "pollinations". */
  apiKey?: string;
  /** Full chat-completions endpoint URL — "custom" only. Lets any OpenAI-compatible API (a provider not built in, or a
   *  locally-running model server like Ollama/LM Studio/llama.cpp) be used without a code change. */
  baseUrl?: string;
}

/** Fallback model when switching to a provider with no explicit model chosen yet. Shared by the CLI and the web server's live provider switch. */
export const DEFAULT_MODEL: Record<LlmProvider, string> = {
  pollinations: "openai",
  groq: "llama-3.3-70b-versatile",
  openrouter: "openai/gpt-oss-20b:free",
  gemini: "gemini-3.5-flash",
  cerebras: "llama-3.3-70b",
  mistral: "mistral-small-latest",
  // No sensible default — the model id on a custom/local endpoint is entirely user-defined.
  custom: "",
};

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    /** Round-tripped verbatim from `ToolCallRequest.extra` — see that field's comment. */
    extra_content?: Record<string, unknown>;
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
  /**
   * True when this tool ran a deterministic, model-agnostic structural quality gate on its own
   * output and it passed — lets finalizeTransaction() treat a clean document-generation turn as
   * genuinely verified instead of always falling back to the flat "unverified_changes" outcome.
   */
  qualityChecked?: boolean;
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
  /** Carried over from the tool's ToolExecResult — see ToolExecResult.qualityChecked. */
  qualityChecked?: boolean;
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
  /** Nishant Convergence Protocol bookkeeping (see convergence.ts) — set only when its divergent-repair-ensemble path actually ran this turn (repair attempt 2+). */
  ncpInvoked?: boolean;
  ncpMargin?: "clear" | "close" | "n/a";
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
  /**
   * Standing formatting/tone/workflow preferences the user has explicitly stated for this project
   * (via the remember_preference tool) — distinct from one-off asks, applies to every future turn.
   */
  preferences?: string[];
  /**
   * Short, specific lessons derived from a document quality-check failure that has now blocked a
   * generation more than once in this project (see documentQuality.ts) — never a model's own
   * unreliable self-assessment of what went wrong, always traceable back to a real, catalogued check.
   */
  learnedLessons?: string[];
  /** Bookkeeping for learnedLessons: quality-check failure strings seen exactly once so far, not yet promoted. */
  recentQualityFailures?: string[];
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
