/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { FileSnapshot } from "./workspaceSnapshot";

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
  /** Overrides each provider's hardcoded default (0.15) — used by Best-of-N to spread attempts across
   *  different sampling temperatures for genuine solution diversity. Unset for ordinary single-turn chat. */
  temperature?: number;
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
   * Present when this tool ran a deterministic, model-agnostic structural quality gate on its own
   * output (create_docx/pptx/xlsx — see documentQuality.ts) — on both the blocking-failure and the
   * passing path, so a blocked generation is visible as real evidence to deriveOutcome(), not just
   * a plain tool failure. See VerificationContract in this file for how it feeds the outcome model.
   */
  qualityGate?: ToolQualityGateResult;
}

/** Small structured result a quality-gated tool (create_docx/pptx/xlsx) attaches to its own ToolExecResult. */
export interface ToolQualityGateResult {
  name: string;
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

/**
 * The end-state of one V-Cycle transaction (one user turn's worth of mutating work).
 * `no_changes` is a 7th, non-verification sentinel for the zero-action case — there was nothing to
 * verify, distinct from any of the six real verification states. See deriveOutcome() in
 * verificationOutcome.ts for exactly how a VerificationContract maps to one of these.
 */
export type TransactionOutcome =
  | "verified"
  | "reviewed"
  | "partially_verified"
  | "unverified"
  | "failed"
  | "blocked"
  | "no_changes";

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
  /** Present for file-mutating tools that know their own single target path — the pre/post-change state, used for manual rollback. */
  fileSnapshot?: FileSnapshot;
  /**
   * Present for run_shell_command actions in a git repo whose command isn't read-only-ish — a
   * whole-workspace before/after tree pair (see gitCheckpoint.ts), since a shell command has no
   * single known target path the way the other mutating tools do.
   */
  treeSnapshot?: { beforeTree: string; afterTree: string };
  /** Carried over from the tool's ToolExecResult — see ToolExecResult.qualityGate. */
  qualityGate?: ToolQualityGateResult;
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

/** Where one VerificationCheckEntry came from. */
export type VerificationSource = "deterministic" | "quality_gate" | "critic";

/**
 * One evidence entry backing a transaction's outcome — a build/test/lint/typecheck run (source:
 * "deterministic", from verification.ts), a generated document's structural quality gate (source:
 * "quality_gate", from documentQuality.ts via ToolQualityGateResult), or one round of independent
 * LLM critique (source: "critic", from critic.ts). deriveOutcome() (verificationOutcome.ts) is the
 * single place that turns an accumulated list of these into a six-state outcome — nothing else
 * should re-derive it.
 */
export interface VerificationCheckEntry {
  source: VerificationSource;
  /** Human-readable name for logs/audits — e.g. "test (npm test)", "docx quality gate", "independent review (round 2)". */
  name: string;
  ok: boolean;
  /** Failure detail / critique reason; "" on a clean pass. */
  output: string;
  /**
   * Dedup identity for a retryable target — used only by quality_gate entries (keyed by the file
   * path being generated), so a create_docx call that failed its gate once and then succeeded on
   * retry counts only its final attempt. Deterministic entries are wholesale-replaced on every
   * verification.ts run instead; critic entries are never deduped — each round is an independent
   * judgment of different work.
   */
  key?: string;
}

/** The accumulated evidence for one transaction — see VerificationCheckEntry for how each source is assembled/replaced. */
export interface VerificationContract {
  checks: VerificationCheckEntry[];
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
  /** The evidence outcome is derived from — replaces the old `verification?: VerificationResult` field. */
  contract: VerificationContract;
  repairAttempts: number;
  /** Total number of independent per-step critique calls made this turn (pass or fail), bounded and cost-capped. */
  criticCalls: number;
  outcome: TransactionOutcome;
  confidence: number;
  /** Nishant Convergence Protocol bookkeeping (see convergence.ts) — set only when its divergent-repair-ensemble path actually ran this turn (repair attempt 2+). */
  ncpInvoked?: boolean;
  ncpMargin?: "clear" | "close" | "n/a";
  /**
   * Schema version of this record, for readers written after this field existed. Always 2 on
   * records written from Phase 3 onward; absent on pre-Phase-3 records (5-state outcome, numeric-
   * only confidence, `verification` instead of `contract`). See
   * docs/architecture/2026-08-phase3-verification-engine.md — no runtime migration exists because
   * the one real consumer of loaded records (Agent.rollbackTransaction) never reads outcome,
   * confidence, contract, or this field; a pre-Phase-3 record stays fully rollback-safe as-is.
   */
  schemaVersion?: 2;
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
