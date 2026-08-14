/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Tests critic.ts's pure prompt-building and reply-parsing logic directly (buildCritiqueMessages /
 * parseCritiqueReply), rather than driving critiqueStep through a real network round-trip. A local
 * mock HTTP server + streaming fetch() response was tried first (matching evalRunner.test.ts's
 * pattern) but reliably crashed the test process on this platform with a native libuv assertion
 * (`UV_HANDLE_CLOSING`, src/win/async.c:94) during exit teardown, unrelated to critic.ts's actual
 * logic — every individual assertion passed before the crash. Testing the pure pieces directly
 * covers the same behavior (does the prompt include verification evidence when supplied; does
 * PASS/FAIL/malformed parsing work) without depending on that combination of local server +
 * streaming fetch + process teardown at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCritiqueMessages, parseCritiqueReply } from "../critic";

test("buildCritiqueMessages: omitting verificationSummary sends no verification section", () => {
  const messages = buildCritiqueMessages("write a function", "- wrote foo.js\n  result: ok");
  const userMessage = messages.find((m) => m.role === "user")!;
  assert.doesNotMatch(String(userMessage.content), /Automated verification/);
});

test("buildCritiqueMessages: a supplied verificationSummary is included as evidence, prompt structure intact", () => {
  const messages = buildCritiqueMessages("write a function", "- wrote foo.js\n  result: ok", "- test: PASSED");
  const userMessage = messages.find((m) => m.role === "user")!;
  const content = String(userMessage.content);
  assert.match(content, /Automated verification for this step/);
  assert.match(content, /test: PASSED/);
  // The verification section must appear, and the closing question must still be there too --
  // this isn't just appending text, the existing prompt structure must survive intact.
  assert.match(content, /Did this step correctly and completely/);
  // Evidence must appear before the closing question, not after it (an LLM reading top-to-bottom
  // should see the ground truth before being asked to render a verdict).
  assert.ok(content.indexOf("Automated verification") < content.indexOf("Did this step correctly"));
});

test("buildCritiqueMessages: intent and step summary both reach the prompt", () => {
  const messages = buildCritiqueMessages("refactor the parser", "- edited parser.js\n  result: done");
  const content = String(messages.find((m) => m.role === "user")!.content);
  assert.match(content, /refactor the parser/);
  assert.match(content, /edited parser\.js/);
});

test("parseCritiqueReply: a PASS reply parses to pass:true with no reason", () => {
  assert.deepEqual(parseCritiqueReply("PASS"), { pass: true, reason: "" });
  assert.deepEqual(parseCritiqueReply("  pass  "), { pass: true, reason: "" });
});

test("parseCritiqueReply: a FAIL reply parses the reason, stripping the FAIL: prefix", () => {
  const result = parseCritiqueReply("FAIL: forgot to handle the empty-array case");
  assert.equal(result.pass, false);
  assert.equal(result.reason, "forgot to handle the empty-array case");
});

test("parseCritiqueReply: a FAIL reply with no reason text still fails, with a fallback reason", () => {
  const result = parseCritiqueReply("FAIL:");
  assert.equal(result.pass, false);
  assert.equal(result.reason, "no reason given");
});

test("parseCritiqueReply: a malformed/unparseable reply fails open (pass:true) rather than blocking", () => {
  const result = parseCritiqueReply("uh, looks fine I guess?");
  assert.equal(result.pass, true);
  assert.match(result.reason, /unparseable reply/);
});

test("parseCritiqueReply: an empty reply fails open rather than blocking", () => {
  const result = parseCritiqueReply("");
  assert.equal(result.pass, true);
  assert.match(result.reason, /unparseable reply/);
});
