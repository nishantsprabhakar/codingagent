/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { ToolCallRequest } from "../types";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StreamAccumulated {
  content: string | null;
  /** Some providers (e.g. Kilo) occasionally stream output as `delta.reasoning` instead of `delta.content`. */
  reasoning: string | null;
  toolCalls: ToolCallRequest[];
  finishReason: string | null;
  /** Present only for providers that actually report it — never fabricated when absent (see callers' handling of `undefined`). */
  usage?: TokenUsage;
}

/**
 * Consumes an OpenAI-compatible `text/event-stream` response body (used by
 * Groq, OpenRouter, and Kilo alike), calling `onDelta` with each
 * piece of assistant text as it arrives and returning the fully accumulated
 * content/tool-calls once the stream ends — the same shape a non-streaming
 * call would have returned, so callers don't need to know the difference.
 *
 * Handles the two things that make SSE parsing easy to get subtly wrong:
 * - A single `data: {...}` line can be split across multiple network chunks
 *   (or several lines can arrive in one chunk) — buffered and split on "\n".
 * - Tool-call arguments stream as fragments keyed by index and must be
 *   concatenated in arrival order, not overwritten.
 */
export async function consumeSseStream(
  res: Response,
  onDelta: ((chunk: string) => void) | undefined
): Promise<StreamAccumulated> {
  const body = res.body;
  if (!body) return { content: null, reasoning: null, toolCalls: [], finishReason: null };

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let contentAcc = "";
  let reasoningAcc = "";
  let hasContent = false;
  let hasReasoning = false;
  let finishReason: string | null = null;
  let usage: TokenUsage | undefined;
  const toolCallAcc = new Map<number, { id: string; name: string; arguments: string; extra?: Record<string, unknown> }>();

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;

    let json: any;
    try {
      json = JSON.parse(payload);
    } catch {
      return; // an incomplete/malformed event — nothing safe to do but skip it
    }

    // The usage-bearing final chunk (only sent when the request opted in via `stream_options.include_usage`)
    // typically has an EMPTY `choices` array alongside a top-level `usage` object — so this must be checked
    // before the `if (!choice) return` below, or the one chunk that carries token counts is silently skipped.
    if (json.usage && typeof json.usage.total_tokens === "number") {
      usage = {
        promptTokens: json.usage.prompt_tokens ?? 0,
        completionTokens: json.usage.completion_tokens ?? 0,
        totalTokens: json.usage.total_tokens,
      };
    }

    const choice = json.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;

    const delta = choice.delta ?? {};
    if (typeof delta.content === "string" && delta.content.length > 0) {
      contentAcc += delta.content;
      hasContent = true;
      onDelta?.(delta.content);
    }
    if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
      reasoningAcc += delta.reasoning;
      hasReasoning = true;
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === "number" ? tc.index : 0;
        const existing = toolCallAcc.get(idx) ?? { id: "", name: "", arguments: "" };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (typeof tc.function?.arguments === "string") existing.arguments += tc.function.arguments;
        // Gemini's "thinking" models attach an opaque, non-streamed thought_signature here (via
        // extra_content.google.thought_signature) that must round-trip back verbatim on the next turn's
        // tool_calls, or the API rejects the follow-up request — see ToolCallRequest.extra's comment.
        if (tc.extra_content && typeof tc.extra_content === "object") existing.extra = tc.extra_content;
        toolCallAcc.set(idx, existing);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      processLine(buffer.slice(0, newlineIdx));
      buffer = buffer.slice(newlineIdx + 1);
    }
  }
  if (buffer.trim()) processLine(buffer);

  const toolCalls: ToolCallRequest[] = Array.from(toolCallAcc.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, tc]) => ({ id: tc.id, name: tc.name, arguments: tc.arguments || "{}", extra: tc.extra }));

  return {
    content: hasContent ? contentAcc : null,
    reasoning: hasReasoning ? reasoningAcc : null,
    toolCalls,
    finishReason,
    usage,
  };
}
