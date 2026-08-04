import type { ChatMessage, ToolDefinition, ToolCallRequest, ChatCompletionResult } from "../types";

const BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function chatCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model: string,
  apiKey: string,
  maxRetries = 5
): Promise<ChatCompletionResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools: tools.length ? tools : undefined,
          tool_choice: tools.length ? "auto" : undefined,
          temperature: 0.2,
          max_tokens: 8000,
        }),
      });

      if (res.status === 401 || res.status === 403) {
        throwFatal(
          "OpenRouter rejected the API key (401/403). Check that OPENROUTER_API_KEY / --api-key is correct and active."
        );
      }

      if (res.status === 402) {
        throwFatal(
          "OpenRouter returned 402 Payment Required — this model needs account credits. Switch to a ':free' model " +
            "with --model, or add credits at https://openrouter.ai/settings/credits."
        );
      }

      if (res.status === 404) {
        throwFatal(
          `OpenRouter returned 404 for model "${model}" — it may have been renamed or removed. Check current free ` +
            `models at https://openrouter.ai/models?max_price=0 and pass the exact id with --model.`
        );
      }

      if (res.status === 429 || res.status >= 500) {
        const waitMs = Math.min(2000 * 2 ** attempt, 20000);
        lastError = new Error(`OpenRouter API returned ${res.status}`);
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throwFatal(`OpenRouter API error ${res.status}: ${text.slice(0, 800)}`);
      }

      const data: any = await res.json();
      const choice = data.choices?.[0];
      const message = choice?.message ?? {};

      const toolCalls: ToolCallRequest[] = (message.tool_calls ?? []).map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name,
        arguments: tc.function?.arguments ?? "{}",
      }));

      if (choice?.finish_reason === "length") {
        console.error("[coding-agent] warning: response was truncated by the token limit (finish_reason=length)");
      }

      return { content: message.content ?? null, toolCalls };
    } catch (err: any) {
      lastError = err;
      if (err.fatal) throw err;
      if (attempt < maxRetries) {
        await sleep(Math.min(1500 * 2 ** attempt, 15000));
      }
    }
  }

  throw lastError ?? new Error("OpenRouter API request failed");
}

/** Throws an error marked non-retryable — e.g. a rejected key that a backoff loop can't fix. */
function throwFatal(message: string): never {
  const err: any = new Error(message);
  err.fatal = true;
  throw err;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
