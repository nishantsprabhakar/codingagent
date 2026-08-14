/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { Reporter, TaskItem, HistoryItem, RiskLevel, VerificationResult, TransactionOutcome } from "../types";
import type { ConfirmFn, PermissionDecision } from "../permissions";
import type { ServerMessage } from "./protocol";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

/** Bridges Agent's Reporter events to JSON messages over a WebSocket connection.
 *  `notifyOthers`, if given, is called on every session save so the server's connection registry
 *  can warn sibling connections viewing the same session — see server.ts's activeConnections. */
export class WebSocketReporter implements Reporter {
  constructor(private send: (msg: ServerMessage) => void, private notifyOthers?: (sessionId: string) => void) {}

  sessionPersisted(sessionId: string): void {
    this.notifyOthers?.(sessionId);
  }

  toolCall(id: string, name: string, label: string, args: unknown, risk: RiskLevel): void {
    this.send({ type: "tool_call", id, name, label, args, risk });
  }

  verification(result: VerificationResult): void {
    this.send({ type: "verification_result", result });
  }

  critique(pass: boolean, reason: string): void {
    this.send({ type: "critique_result", pass, reason });
  }

  transactionSummary(transactionId: string, confidence: number, outcome: TransactionOutcome, rollbackAvailable: boolean): void {
    this.send({ type: "transaction_summary", transactionId, confidence, outcome, rollbackAvailable });
  }

  toolResult(id: string, output: string, ok: boolean): void {
    this.send({ type: "tool_result", id, output, ok });
  }

  assistantDelta(chunk: string): void {
    this.send({ type: "assistant_delta", chunk });
  }

  assistantDeltaEnd(fullText: string, isFinal: boolean): void {
    this.send({ type: "assistant_delta_end", text: fullText, final: isFinal });
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
  return (toolName, label, risk, preview) => {
    return new Promise<PermissionDecision>((resolve) => {
      const id = nextId("perm");
      pending.set(id, resolve);
      send({ type: "permission_request", id, toolName, label, risk, preview });
    });
  };
}
