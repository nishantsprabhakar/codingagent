/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketReporter } from "../web/reporter";
import type { ServerMessage } from "../web/protocol";

test("WebSocketReporter.sessionPersisted: forwards the session id to notifyOthers", () => {
  const calls: string[] = [];
  const reporter = new WebSocketReporter(
    () => {},
    (sessionId) => calls.push(sessionId)
  );
  reporter.sessionPersisted("session-abc");
  assert.deepEqual(calls, ["session-abc"]);
});

test("WebSocketReporter.sessionPersisted: never throws when no notifyOthers callback was given", () => {
  const reporter = new WebSocketReporter(() => {});
  assert.doesNotThrow(() => reporter.sessionPersisted("session-abc"));
});

test("WebSocketReporter: other events are unaffected by the notifyOthers wiring", () => {
  const sent: ServerMessage[] = [];
  const reporter = new WebSocketReporter(
    (msg) => sent.push(msg),
    () => {
      throw new Error("notifyOthers must never be called for a non-session event");
    }
  );
  reporter.error("boom");
  reporter.toolCall("id1", "run_shell_command", "run: ls", {}, "low");
  assert.deepEqual(sent, [
    { type: "error", text: "boom" },
    { type: "tool_call", id: "id1", name: "run_shell_command", label: "run: ls", args: {}, risk: "low" },
  ]);
});
