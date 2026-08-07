/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { Reporter, TaskItem, HistoryItem } from "../types";
import type { ConfirmFn, PermissionDecision } from "../permissions";
import type { ServerMessage } from "./protocol";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

/** Bridges Agent's Reporter events to JSON messages over a WebSocket connection. */
export class WebSocketReporter implements Reporter {
  constructor(private send: (msg: ServerMessage) => void) {}

  toolCall(id: string, name: string, label: string, args: unknown): void {
    this.send({ type: "tool_call", id, name, label, args });
  }

  toolResult(id: string, output: string, ok: boolean): void {
    this.send({ type: "tool_result", id, output, ok });
  }

  assistant(text: string): void {
    this.send({ type: "assistant", text });
  }

  error(text: string): void {
    this.send({ type: "error", text });
  }

  thinking(value: boolean): void {
    this.send({ type: "thinking", value });
  }

  tasks(tasks: TaskItem[]): void {
    this.send({ type: "tasks", tasks });
  }

  files(files: string[]): void {
    this.send({ type: "files", files });
  }

  history(items: HistoryItem[]): void {
    this.send({ type: "history", items });
  }
}

/**
 * Turns a permission check into a request/response round-trip over the
 * socket: sends a permission_request and resolves once the browser sends
 * back a matching permission_response.
 */
export function createConfirmFn(
  send: (msg: ServerMessage) => void,
  pending: Map<string, (decision: PermissionDecision) => void>
): ConfirmFn {
  return (toolName, label, preview) => {
    return new Promise<PermissionDecision>((resolve) => {
      const id = nextId("perm");
      pending.set(id, resolve);
      send({ type: "permission_request", id, toolName, label, preview });
    });
  };
}
