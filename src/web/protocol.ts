/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { PermissionDecision } from "../permissions";
import type { TaskItem, HistoryItem } from "../types";
import type { SessionMeta } from "../session";

export type ServerMessage =
  | { type: "init"; root: string; provider: string; model: string; yolo: boolean; recentFolders: string[]; sessionId: string; sessionTitle: string }
  | { type: "assistant_delta"; chunk: string }
  | { type: "assistant_delta_end"; text: string; final: boolean }
  | { type: "tool_call"; id: string; name: string; label: string; args: unknown }
  | { type: "tool_result"; id: string; output: string; ok: boolean }
  | { type: "permission_request"; id: string; toolName: string; label: string; preview?: string }
  | { type: "error"; text: string }
  | { type: "thinking"; value: boolean }
  | { type: "tasks"; tasks: TaskItem[] }
  | { type: "files"; files: string[] }
  | { type: "history"; items: HistoryItem[] }
  | { type: "model_changed"; model: string }
  | { type: "sessions"; sessions: SessionMeta[]; activeId: string }
  | { type: "settings_saved"; which: "instructions" }
  | { type: "mcp_reloaded"; toolCount: number };

export type ClientMessage =
  | { type: "user_message"; text: string }
  | { type: "permission_response"; id: string; decision: PermissionDecision }
  | { type: "switch_folder"; path: string }
  | { type: "switch_model"; model: string }
  | { type: "new_session" }
  | { type: "switch_session"; id: string }
  | { type: "delete_session"; id: string }
  | { type: "list_sessions" }
  | { type: "update_global_instructions"; text: string }
  | { type: "update_mcp_config"; mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> };
