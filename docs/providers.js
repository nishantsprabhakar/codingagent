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
 * Kilo (the main app's zero-key default) was tried and rejected for this
 * page specifically: its gateway sends no Access-Control-Allow-Origin at
 * all (re-verified live, 2026-08-20, via a real preflight against this
 * page's deployed origin) — it's server-to-server only, so a browser blocks
 * it outright. There is no way to use it from a static page with no backend.
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
 *
 * Model IDs are resolved live, not hardcoded — see "Dynamic model
 * discovery" below. Groq deprecated the previously-hardcoded
 * llama-3.3-70b-versatile in June 2026 (for free/developer-tier usage),
 * which silently broke this page's default until this fix: a hardcoded
 * model string has no way to notice its own provider retired it. Each
 * `resolveModel()` fetches that provider's own live /models list (all five
 * keyed providers' list endpoints were confirmed, 2026-08-20, to send
 * Access-Control-Allow-Origin — a separate check from the chat endpoint's
 * own CORS above) and picks a currently-available chat model from it. A
 * hardcoded `fallbackModel` is kept purely as a last resort if that live
 * lookup itself fails (network hiccup, CORS regression, key not entered
 * yet) — never as the normal path.
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

// ---------- Dynamic model discovery ----------
// A hardcoded model id has no way to notice its own provider deprecated it — that's exactly what broke this
// page's Groq default in June 2026. Each provider's own /models list is the source of truth for what's actually
// callable right now; resolveModel() below fetches it live and picks a match, falling back to a hardcoded id
// only if that live lookup itself fails.

async function fetchModelIds(url, apiKey) {
  const res = await fetch(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
  if (!res.ok) throw new Error(`models list returned ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  return list.map((m) => String(m.id || m.name || "").replace(/^models\//, "")).filter(Boolean);
}

/** Picks the first id containing any of `preferred` (checked in order), else the first id in the list, else
 *  `fallback` — never throws, since "nothing matched" still needs a usable model to try. */
function pickModel(ids, preferred, fallback) {
  for (const pref of preferred) {
    const hit = ids.find((id) => id.toLowerCase().includes(pref));
    if (hit) return hit;
  }
  return ids[0] || fallback;
}

const MODEL_CACHE_KEY = "wrexlyn_model_cache_v1";
const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h -- long enough to avoid a list fetch on every visit, short
// enough that a fresh deprecation clears itself out on the next day's visit instead of needing a code deploy.

function readModelCache(provider) {
  try {
    const cache = JSON.parse(localStorage.getItem(MODEL_CACHE_KEY) || "{}");
    const entry = cache[provider];
    if (entry && Date.now() - entry.ts < MODEL_CACHE_TTL_MS) return entry.model;
  } catch {
    // corrupt cache -- fall through to a fresh lookup
  }
  return null;
}

function writeModelCache(provider, model) {
  try {
    const cache = JSON.parse(localStorage.getItem(MODEL_CACHE_KEY) || "{}");
    cache[provider] = { model, ts: Date.now() };
    localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage full/unavailable -- resolution still works, just re-fetches next time
  }
}

/** Resolves a provider's model once (live list -> cache), remembering the result so repeat sends in the same
 *  chat and repeat visits within MODEL_CACHE_TTL_MS don't re-fetch the list on every message. */
async function resolveModel(providerId, apiKey) {
  const meta = PROVIDER_META[providerId];
  const cached = readModelCache(providerId);
  if (cached) return cached;
  let model;
  try {
    model = await meta.discoverModel(apiKey);
  } catch {
    model = meta.fallbackModel;
  }
  writeModelCache(providerId, model);
  return model;
}

const PROVIDER_META = {
  // Default (first = pre-selected in the dropdown). Pollinations is more convenient (no key at all) but its free
  // anonymous tier has proven unreliable in testing (intermittent 402/403s) — Groq trades one minute of signup
  // for an actually-reliable first impression. Pollinations stays one click away via the "try instantly" quick
  // start below the form, and further down this list for anyone who wants it as their saved default anyway.
  groq: {
    label: "Groq",
    fallbackModel: "openai/gpt-oss-120b", // Groq's own migration target for the deprecated llama-3.3-70b-versatile
    needsKey: true,
    note: 'Free key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a>.',
    discoverModel: async (apiKey) => {
      const ids = await fetchModelIds("https://api.groq.com/openai/v1/models", apiKey);
      // Groq's /models list also includes non-chat models (whisper transcription, guard/moderation, tts) --
      // exclude those before picking, or a chat request could land on a model that can't answer one.
      const chatIds = ids.filter((id) => !/whisper|guard|moderation|tts/i.test(id));
      return pickModel(chatIds, ["gpt-oss-120b", "gpt-oss", "qwen3", "llama-3.1", "llama"], "openai/gpt-oss-120b");
    },
    stream: (messages, apiKey, model, onDelta) =>
      openAiCompatibleStream("https://api.groq.com/openai/v1/chat/completions", apiKey, model, messages, onDelta),
  },
  pollinations: {
    label: "Pollinations (free, no key)",
    fallbackModel: "openai-fast",
    needsKey: false,
    note:
      "Free, anonymous, no signup — but shared and rate-limited, so it can occasionally say it's out of budget. " +
      'If that happens, switch to <a href="https://console.groq.com/keys" target="_blank" rel="noopener">Groq</a> ' +
      "or another provider above and paste in a free key.",
    // Pollinations exposes exactly one anonymous model -- nothing to discover, no list endpoint needed.
    discoverModel: async () => "openai-fast",
    stream: (messages, apiKey, model, onDelta) => pollinationsStream(messages, onDelta),
  },
  openrouter: {
    label: "OpenRouter",
    fallbackModel: "openai/gpt-oss-20b:free",
    needsKey: true,
    note: 'Free key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a> — pick a ":free" model to avoid needing credits.',
    // OpenRouter's model catalog is public -- no key needed to list it, confirmed via Access-Control-Allow-Origin: *.
    discoverModel: async () => {
      const ids = await fetchModelIds("https://openrouter.ai/api/v1/models");
      const free = ids.filter((id) => id.endsWith(":free"));
      return pickModel(free, ["gpt-oss", "llama", "qwen"], "openai/gpt-oss-20b:free");
    },
    stream: (messages, apiKey, model, onDelta) =>
      openAiCompatibleStream("https://openrouter.ai/api/v1/chat/completions", apiKey, model, messages, onDelta),
  },
  gemini: {
    label: "Google Gemini",
    fallbackModel: "gemini-2.5-flash",
    needsKey: true,
    note: 'Free key (no credit card) at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.',
    discoverModel: async (apiKey) => {
      const ids = await fetchModelIds("https://generativelanguage.googleapis.com/v1beta/openai/models", apiKey);
      return pickModel(ids, ["gemini-2.5-flash", "gemini-flash", "2.0-flash", "flash"], "gemini-2.5-flash");
    },
    stream: (messages, apiKey, model, onDelta) =>
      openAiCompatibleStream("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", apiKey, model, messages, onDelta),
  },
  cerebras: {
    label: "Cerebras",
    fallbackModel: "llama-3.3-70b",
    needsKey: true,
    note: 'Free key (no credit card) at <a href="https://cloud.cerebras.ai" target="_blank" rel="noopener">cloud.cerebras.ai</a>.',
    discoverModel: async (apiKey) => {
      const ids = await fetchModelIds("https://api.cerebras.ai/v1/models", apiKey);
      return pickModel(ids, ["llama-3.3-70b", "llama-3.1-70b", "llama"], "llama-3.3-70b");
    },
    stream: (messages, apiKey, model, onDelta) =>
      openAiCompatibleStream("https://api.cerebras.ai/v1/chat/completions", apiKey, model, messages, onDelta),
  },
  mistral: {
    label: "Mistral",
    fallbackModel: "mistral-small-latest",
    needsKey: true,
    note: 'Free key at <a href="https://console.mistral.ai" target="_blank" rel="noopener">console.mistral.ai</a> (phone verification required).',
    discoverModel: async (apiKey) => {
      const ids = await fetchModelIds("https://api.mistral.ai/v1/models", apiKey);
      // Mistral's "-latest" aliases are themselves a rolling pointer -- prefer keeping that alias over pinning
      // to whatever dated snapshot id the list also exposes, so this stays current without a fresh pick each time.
      return pickModel(ids, ["mistral-small-latest", "small-latest", "mistral-small"], "mistral-small-latest");
    },
    stream: (messages, apiKey, model, onDelta) =>
      openAiCompatibleStream("https://api.mistral.ai/v1/chat/completions", apiKey, model, messages, onDelta),
  },
};
