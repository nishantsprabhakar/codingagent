#!/usr/bin/env node
/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Scheduled health check for docs/providers.js's hardcoded `fallbackModel` values and each
 * provider's models-list endpoint — the exact class of thing that has broken the browser demo
 * three times already (Groq deprecating llama-3.3-70b-versatile, Gemini deprecating
 * gemini-2.5-flash, Pollinations winding its anonymous tier down), each time only noticed because
 * a person reported the demo as broken. `resolveModel()`'s live discovery already protects the
 * *normal* path; this exists to catch a regression in the *fallback* path before a user hits it —
 * the fallback is only exercised when discovery itself fails, which is exactly when nothing else
 * would have surfaced the problem.
 *
 * Scope, deliberately: providers that need an API key (Groq/Gemini/Cerebras/Mistral) can't have
 * their specific fallback model id verified here without a stored secret spending someone's real
 * quota — this only confirms their models-list *endpoint* is still reachable and returns a
 * well-formed body (catches a URL/response-shape break, not a single deprecated model id).
 * OpenRouter's list is public, so its exact fallback model id is checked directly. Pollinations is
 * skipped entirely — its own doc comment already states its anonymous tier is being wound down, so
 * monitoring it here would just produce noisy, uninformative failures for a fact already known and
 * disclosed, not a regression this check could usefully catch.
 */

const PROVIDERS = require("./demo-provider-endpoints.js");

async function checkEndpointReachable(name, url) {
  try {
    // Always send *some* bearer token, even a fake one — confirmed live that Google's gateway
    // returns a generic 404 ("Requested entity was not found") when no Authorization header is
    // present at all, but a proper 400 auth-rejection the moment any header is present, valid or
    // not. Sending no header at all can't distinguish "endpoint moved" from "this provider's
    // gateway 404s on a headerless request" — sending a placeholder token makes every provider
    // respond with an actual auth-rejection status, so 404 here reliably means the route itself is
    // gone, not an artifact of this check's own request shape.
    const res = await fetch(url, { headers: { Authorization: "Bearer wrexlyn-demo-health-check-placeholder" } });
    if (res.status === 404) return { name, ok: false, detail: `404 — endpoint no longer exists (${url})` };
    await res.json().catch(() => {
      throw new Error("response body is not valid JSON");
    });
    return { name, ok: true, detail: `reachable (HTTP ${res.status})` };
  } catch (err) {
    return { name, ok: false, detail: `unreachable: ${err.message ?? err}` };
  }
}

async function checkOpenRouterFallback() {
  const { fallbackModel } = PROVIDERS.openrouter;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    if (!res.ok) return { name: "openrouter (fallback model)", ok: false, detail: `models list returned HTTP ${res.status}` };
    const data = await res.json();
    const ids = (Array.isArray(data.data) ? data.data : []).map((m) => String(m.id || ""));
    const present = ids.includes(fallbackModel);
    return {
      name: "openrouter (fallback model)",
      ok: present,
      detail: present ? `"${fallbackModel}" is live` : `"${fallbackModel}" is NOT in the live model list — update the hardcoded fallback in docs/providers.js`,
    };
  } catch (err) {
    return { name: "openrouter (fallback model)", ok: false, detail: `check itself failed: ${err.message ?? err}` };
  }
}

async function main() {
  const results = await Promise.all([
    checkOpenRouterFallback(),
    checkEndpointReachable("groq (models endpoint)", PROVIDERS.groq.modelsUrl),
    checkEndpointReachable("gemini (models endpoint)", PROVIDERS.gemini.modelsUrl),
    checkEndpointReachable("cerebras (models endpoint)", PROVIDERS.cerebras.modelsUrl),
    checkEndpointReachable("mistral (models endpoint)", PROVIDERS.mistral.modelsUrl),
  ]);

  let anyFailed = false;
  for (const r of results) {
    console.log(`${r.ok ? "✔" : "✖"} ${r.name}: ${r.detail}`);
    if (!r.ok) anyFailed = true;
  }

  if (anyFailed) {
    console.error("\nOne or more demo provider checks failed — see docs/providers.js's fallbackModel values.");
    process.exit(1);
  }
  console.log("\nAll demo provider checks passed.");
}

main();
