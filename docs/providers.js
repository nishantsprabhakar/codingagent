/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 *
 * Provider configs for the browser-only chat demo. Only providers confirmed
 * (via a live CORS preflight+request test, not just docs) to send
 * Access-Control-Allow-Origin on their chat-completions endpoint are listed
 * here — the rest would need a backend proxy, which this static page
 * doesn't have. Every provider claim here should be checked with an
 * actual browser request, not just curl — they can behave differently.
 *
 * Pollinations (text.pollinations.ai) is the no-key default: re-verified
 * 2026-08-09 from a real browser against the deployed GitHub Pages origin.
 * Plain chat (no tools) now passes both CORS and the Turnstile bot-check
 * that previously blocked it. Its anonymous tier is still not fully
 * reliable, though, in a different way — the same request flipped between
 * 200 and 402 "budget too low" seconds apart in testing, and only one
 * model is exposed anonymously (openai-fast, a reasoning model that
 * sometimes streams its answer in a `reasoning` delta field instead of
 * `content`). pollinationsStream() below handles both quirks. If it 402s,
 * the UI should point the visitor at picking a keyed provider instead of
 * retrying forever.
 *
 * Note: this only holds for plain fetch() requests exactly as written
 * below. If you ever swap in the official OpenAI JS SDK, its extra
 * `x-stainless-*` headers break Gemini's CORS preflight specifically
 * (not the other providers) — stick to raw fetch for this file.
 */
const WREXLYN_SYSTEM_PROMPT =
  "You are Wrexlyn, an AI assistant created by Nishant Prabhakar. This is the browser-only chat demo — you have " +
  "no tools, cannot read/write files, and cannot run commands. If asked to do something that needs real file or " +
  "code execution, say so plainly and point to the local desktop app (github.com/nishantsprabhakar/codingagent) " +
  "instead of pretending to do it. When asked who made you, say Nishant Prabhakar. If asked for detail about him: " +
  "he's Senior Vice President at SKEGEN Asset Management (a Bharat Biotech Group platform), with 11+ years in " +
  "private equity across The Rohatyn Group's Asia platform, Premji Invest, and EISAF, USD 2B+ in transactions " +
  "executed, and author of four books (Capital in the Shadows, The Next Frontier, The Sovereign Stack, The " +
  "Compute Shift). Point to nishantprabhakar.pages.dev for more.";

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Streams from Pollinations' anonymous endpoint. No Authorization header —
 * there is no key. Buffers reasoning deltas separately from content deltas
 * and only falls back to showing reasoning text if content never arrives
 * by the end of the stream (avoids live-streaming raw chain-of-thought
 * while a real answer is still coming). Retries a couple of times on
 * 429/5xx (the anonymous tier is rate-limited), but fails fast with an
 * actionable "pick another provider" message on anything else non-2xx
 * (402 budget exhaustion, 403 Turnstile, etc.) — those are policy
 * rejections, not transient errors worth retrying.
 */
async function pollinationsStream(messages, onDelta, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai", messages, stream: true }),
    });

    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // Covers 402 (anonymous budget exhausted), 403 (Cloudflare Turnstile —
      // observed to depend on the calling origin, so this can appear from
      // some hosts/networks and not others), and anything else non-2xx.
      // None of these are worth retrying — same steer as a hard failure.
      throw new Error(
        `Pollinations couldn't complete this request (${res.status}). Its free anonymous tier is shared and can ` +
          "become temporarily unavailable — pick another provider above and paste in a free API key instead; " +
          `Groq or Gemini take under a minute to set up. (${text.slice(0, 200)})`
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let contentAcc = "";
    let reasoningAcc = "";

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
        contentAcc += delta.content;
        onDelta(delta.content);
      } else if (typeof delta.reasoning === "string" && delta.reasoning) {
        // Buffered, not streamed live — this is the model's raw chain-of-
        // thought, not its answer. Only shown as a last resort below.
        reasoningAcc += delta.reasoning;
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

    if (!contentAcc && reasoningAcc) onDelta(reasoningAcc);
    return;
  }
}

const PROVIDER_META = {
  // Default (first = pre-selected in the dropdown). Pollinations is more convenient (no key at all) but its free
  // anonymous tier has proven unreliable in testing (intermittent 402/403s) — Groq trades one minute of signup
  // for an actually-reliable first impression. Pollinations stays one click away via the "try instantly" quick
  // start below the form, and further down this list for anyone who wants it as their saved default anyway.
  groq: {
    label: "Groq",
    model: "llama-3.3-70b-versatile",
    needsKey: true,
    note: 'Free key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a>.',
    stream: (messages, apiKey, onDelta) =>
      openAiCompatibleStream("https://api.groq.com/openai/v1/chat/completions", apiKey, "llama-3.3-70b-versatile", messages, onDelta),
  },
  pollinations: {
    label: "Pollinations (free, no key)",
    model: "openai-fast",
    needsKey: false,
    note:
      "Free, anonymous, no signup — but shared and rate-limited, so it can occasionally say it's out of budget. " +
      'If that happens, switch to <a href="https://console.groq.com/keys" target="_blank" rel="noopener">Groq</a> ' +
      "or another provider above and paste in a free key.",
    stream: (messages, apiKey, onDelta) => pollinationsStream(messages, onDelta),
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
