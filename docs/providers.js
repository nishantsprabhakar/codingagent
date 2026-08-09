/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 *
 * Provider configs for the browser-only chat demo. Only providers confirmed
 * (via a live CORS preflight+request test, not just docs) to send
 * Access-Control-Allow-Origin on their chat-completions endpoint are listed
 * here — the rest would need a backend proxy, which this static page
 * doesn't have. All five below were confirmed working as of 2026-08.
 *
 * Pollinations was deliberately left out despite passing that CORS check:
 * a real browser fetch() against it hit "Missing Turnstile token" (a
 * Cloudflare bot challenge) in practice, which curl-based verification
 * didn't surface. Every provider claim here should be checked with an
 * actual browser request, not just curl — they can behave differently.
 *
 * Note: this only holds for plain fetch() requests exactly as written
 * below. If you ever swap in the official OpenAI JS SDK, its extra
 * `x-stainless-*` headers break Gemini's CORS preflight specifically
 * (not the other providers) — stick to raw fetch for this file.
 */
const WREXLYN_SYSTEM_PROMPT =
  "You are Wrexlyn, an AI assistant. This is the browser-only chat demo — you have no tools, cannot read/write " +
  "files, and cannot run commands. If asked to do something that needs real file or code execution, say so plainly " +
  "and point to the local desktop app (github.com/nishantsprabhakar/codingagent) instead of pretending to do it.";

/** Consumes an OpenAI-compatible text/event-stream Response body, calling onDelta per content chunk. */
async function consumeOpenAiSseStream(res, onDelta) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let acc = "";

  const processLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    const delta = json.choices?.[0]?.delta ?? {};
    if (typeof delta.content === "string" && delta.content) {
      acc += delta.content;
      onDelta(delta.content);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      processLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  if (buffer.trim()) processLine(buffer);
  return acc;
}

async function openAiCompatibleStream(url, apiKey, model, messages, onDelta) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, stream: true, temperature: 0.4 }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text.slice(0, 300)}`);
  }
  await consumeOpenAiSseStream(res, onDelta);
}

const PROVIDER_META = {
  groq: {
    label: "Groq",
    model: "llama-3.3-70b-versatile",
    needsKey: true,
    note: 'Free key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a>.',
    stream: (messages, apiKey, onDelta) =>
      openAiCompatibleStream("https://api.groq.com/openai/v1/chat/completions", apiKey, "llama-3.3-70b-versatile", messages, onDelta),
  },
  openrouter: {
    label: "OpenRouter",
    model: "inclusionai/ling-3.0-flash:free",
    needsKey: true,
    note: 'Free key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a> — pick a ":free" model to avoid needing credits.',
    stream: (messages, apiKey, onDelta) =>
      openAiCompatibleStream("https://openrouter.ai/api/v1/chat/completions", apiKey, "inclusionai/ling-3.0-flash:free", messages, onDelta),
  },
  gemini: {
    label: "Google Gemini",
    model: "gemini-2.5-flash",
    needsKey: true,
    note: 'Free key (no credit card) at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.',
    stream: (messages, apiKey, onDelta) =>
      openAiCompatibleStream(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        apiKey,
        "gemini-2.5-flash",
        messages,
        onDelta
      ),
  },
  cerebras: {
    label: "Cerebras",
    model: "llama-3.3-70b",
    needsKey: true,
    note: 'Free key (no credit card) at <a href="https://cloud.cerebras.ai" target="_blank" rel="noopener">cloud.cerebras.ai</a>.',
    stream: (messages, apiKey, onDelta) =>
      openAiCompatibleStream("https://api.cerebras.ai/v1/chat/completions", apiKey, "llama-3.3-70b", messages, onDelta),
  },
  mistral: {
    label: "Mistral",
    model: "mistral-small-latest",
    needsKey: true,
    note: 'Free key at <a href="https://console.mistral.ai" target="_blank" rel="noopener">console.mistral.ai</a> (phone verification required).',
    stream: (messages, apiKey, onDelta) =>
      openAiCompatibleStream("https://api.mistral.ai/v1/chat/completions", apiKey, "mistral-small-latest", messages, onDelta),
  },
};
