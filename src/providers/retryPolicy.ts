/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Shared retry/backoff policy for rate-limit (429) and transient-server (5xx) responses, used by every
 * provider. 429 and 5xx get different treatment: a 429 means the provider is explicitly telling you to
 * slow down, so its own Retry-After header (when sent — most providers do send one) is honored instead
 * of overridden by a blind guess, and the fallback ceiling is much higher than a 5xx gets, since a
 * free-tier requests-per-minute window is typically ~60s — the previous fixed 20s cap on every provider
 * meant a retried 429 often landed back inside the same window it was just told to wait out. Jitter is
 * applied to the fallback so concurrent requests (e.g. multiple sessions on one key) don't retry in
 * lockstep and re-trigger the same limit together.
 */

/** Parses a Retry-After header as either delta-seconds or an HTTP-date (RFC 9110 §10.2.3). Returns ms, or null if absent/unparseable. */
export function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return asSeconds * 1000;
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) {
    const deltaMs = asDate - Date.now();
    return deltaMs > 0 ? deltaMs : 0;
  }
  return null;
}

/** Full-jitter exponential backoff: a random value in [0, cap], where cap itself grows with attempt up to capMs. */
function jitteredBackoffMs(baseMs: number, attempt: number, capMs: number): number {
  const cap = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.random() * cap;
}

/**
 * How long to sleep before retrying a 429/5xx response. Prefers the provider's own Retry-After value
 * when present (sanity-capped at 90s so a misbehaving provider can't stall the agent indefinitely);
 * otherwise falls back to jittered exponential backoff with a 60s ceiling for 429 (most free-tier RPM
 * windows) or 20s for 5xx (usually a transient blip that clears fast).
 */
export function computeRetryDelayMs(status: number, retryAfterHeader: string | null | undefined, attempt: number): number {
  const fromHeader = parseRetryAfterMs(retryAfterHeader);
  if (fromHeader !== null) return Math.min(fromHeader, 90_000);
  const capMs = status === 429 ? 60_000 : 20_000;
  return jitteredBackoffMs(2000, attempt, capMs);
}

/**
 * Builds the message thrown once a provider has exhausted its retries on a 429/5xx — one shared,
 * self-explanatory version instead of each provider file writing its own (historically only
 * openrouter.ts bothered; kilo/groq/openaiCompatible just threw a terse "X API returned 429").
 * A 429 gets the actionable framing (it's the provider's own quota, not a local setting, and it
 * clears on the provider's own schedule); a 5xx gets a shorter "transient, already retried" note.
 */
export function describeRetryExhausted(providerLabel: string, model: string, status: number): string {
  if (status === 429) {
    return (
      `${providerLabel} rate-limited this request (429)${model ? ` for "${model}"` : ""}. This is ` +
      `${providerLabel}'s own rate/quota limit (shared across free-tier users where applicable, not a ` +
      "local setting that needs resetting) — it clears on the provider's own schedule. If it keeps " +
      "happening, switch to a different free model or provider from the model picker."
    );
  }
  return `${providerLabel} API returned ${status} — a transient server-side issue that was already retried automatically.`;
}

function sleepPolicy(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serializes calls with a minimum spacing between them — deconflicts simultaneous bursts (e.g.
 * several concurrently-running agent instances, as in a Best-of-N parallel run, all hitting the
 * same keyless/shared-cap provider at once) without acting as a full requests-per-hour limiter.
 * Each call to the returned `acquire()` resolves only after at least `minIntervalMs` has passed
 * since the previous caller's turn began, queuing fairly in call order.
 */
export function createMinIntervalGate(minIntervalMs: number): () => Promise<void> {
  let queue: Promise<void> = Promise.resolve();
  let nextAvailableAt = 0;

  return function acquire(): Promise<void> {
    const turn = queue.then(async () => {
      const waitMs = Math.max(0, nextAvailableAt - Date.now());
      if (waitMs > 0) await sleepPolicy(waitMs);
      nextAvailableAt = Date.now() + minIntervalMs;
    });
    queue = turn;
    return turn;
  };
}
