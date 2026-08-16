/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { PermissionDecision } from "../permissions";
import type { TaskItem, HistoryItem, RiskLevel, VerificationResult, TransactionOutcome, TokenUsage } from "../types";
import type { SessionMeta, SessionSearchResult } from "../session";
import type { FileRestoreResult } from "../workspaceSnapshot";
import type { McpServerStatus } from "../mcp";
import type { ParallelAttemptEvent, ParallelAttemptResult } from "../parallelRun";

export type ServerMessage =
  | { type: "init"; root: string; provider: string; model: string; yolo: boolean; recentFolders: string[]; sessionId: string; sessionTitle: string }
  | { type: "assistant_delta"; chunk: string }
  | { type: "assistant_delta_end"; text: string; final: boolean }
  | { type: "tool_call"; id: string; name: string; label: string; args: unknown; risk: RiskLevel }
  | { type: "tool_result"; id: string; output: string; ok: boolean }
  | { type: "permission_request"; id: string; toolName: string; label: string; risk: RiskLevel; preview?: string }
  | { type: "error"; text: string }
  | { type: "thinking"; value: boolean }
  | { type: "tasks"; tasks: TaskItem[] }
  | { type: "files"; files: string[] }
  | { type: "history"; items: HistoryItem[] }
  | { type: "model_changed"; model: string }
  | { type: "provider_changed"; provider: string; model: string }
  | { type: "sessions"; sessions: SessionMeta[]; activeId: string }
  | { type: "settings_saved"; which: "instructions" | "api_keys" | "custom_provider" }
  | { type: "mcp_reloaded"; toolCount: number }
  | { type: "mcp_status"; servers: Record<string, McpServerStatus> }
  | { type: "verification_result"; result: VerificationResult }
  | { type: "critique_result"; pass: boolean; reason: string }
  | { type: "transaction_summary"; transactionId: string; confidence: number; outcome: TransactionOutcome; rollbackAvailable: boolean }
  | { type: "rollback_result"; transactionId: string; ok: boolean; items: FileRestoreResult[] }
  | { type: "skills_changed" }
  | { type: "parallel_attempt_event"; attemptIndex: number; event: ParallelAttemptEvent }
  | { type: "parallel_run_complete"; runId: string; attempts: ParallelAttemptResult[] }
  | { type: "parallel_run_merged"; ok: boolean; message: string }
  | { type: "session_changed_elsewhere"; sessionId: string }
  | ({ type: "usage_update" } & TokenUsage)
  | { type: "session_search_results"; query: string; results: SessionSearchResult[] };

export type ClientMessage =
  | { type: "user_message"; text: string }
  | { type: "permission_response"; id: string; decision: PermissionDecision }
  | { type: "switch_folder"; path: string }
  | { type: "switch_model"; model: string }
  | { type: "switch_provider"; provider: string; model?: string }
  | { type: "new_session" }
  | { type: "switch_session"; id: string }
  | { type: "delete_session"; id: string }
  | { type: "list_sessions" }
  | { type: "update_global_instructions"; text: string }
  | {
      type: "update_mcp_config";
      mcpServers: Record<
        string,
        {
          command?: string;
          args?: string[];
          env?: Record<string, string>;
          url?: string;
          permissions?: { defaultRisk?: RiskLevel; alwaysAllow?: string[] };
        }
      >;
    }
  | { type: "mcp_authorize"; server: string }
  | { type: "rollback_request"; transactionId: string }
  | { type: "update_api_key"; provider: "groq" | "openrouter" | "gemini" | "cerebras" | "mistral"; apiKey: string }
  | { type: "clear_api_key"; provider: "groq" | "openrouter" | "gemini" | "cerebras" | "mistral" | "custom" }
  | { type: "update_custom_provider"; baseUrl: string; model: string; apiKey: string }
  | { type: "delete_skill"; name: string }
  | { type: "add_starter_skill"; name: string }
  | { type: "start_parallel_run"; task: string; n: number }
  | { type: "parallel_run_pick"; attemptIndex: number }
  | { type: "parallel_run_cancel" }
  | { type: "abort_turn" }
  | { type: "session_search"; query: string };
