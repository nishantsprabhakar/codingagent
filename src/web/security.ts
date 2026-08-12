/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Small, dependency-free security primitives shared by the HTTP and
 * WebSocket paths in server.ts: response headers, a per-IP rate limiter, and
 * Origin-header allowlisting.
 */
import type * as http from "http";

/**
 * Applied to every response — this app has no CDN scripts and no reason to be framed by another origin.
 * `scriptNonce` (a fresh random value per request, see server.ts) is the only thing allowed to run as an
 * inline `<script>` — index.html's early theme-init snippet needs to run before its stylesheet loads to
 * avoid a flash of the wrong theme, and a nonce lets it do that without a blanket 'unsafe-inline', which
 * would reopen exactly the XSS surface this header exists to close. Google Fonts is the one legitimate
 * cross-origin asset this app loads, so style-src/font-src carve out just those two hosts rather than 'self'.
 */
export function applySecureHeaders(res: http.ServerResponse, scriptNonce: string): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'nonce-${scriptNonce}'; style-src 'self' https://fonts.googleapis.com; ` +
      `font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:`
  );
}

/**
 * A plain per-key token bucket, refilling at `refillPerSec` tokens/second up
 * to `capacity`. No dependency, bounded memory (one entry per distinct key
 * seen, pruned lazily on access) — enough to blunt a brute-force loop against
 * the auth token or a runaway upload/mkdir client without needing a real
 * rate-limiting library for a single-user local server.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number
  ) {}

  /** Returns true if the request under `key` is allowed (and consumes one token), false if it should be rejected. */
  tryConsume(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, lastRefill: now };
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSec);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);

    // Lazy prune: an unbounded number of distinct client IPs over a long-running process would otherwise leak
    // memory slowly. Cheap enough to just do it on every call given the local, low-QPS nature of this server.
    if (this.buckets.size > 1000) {
      for (const [k, v] of this.buckets) {
        if (now - v.lastRefill > 10 * 60 * 1000) this.buckets.delete(k);
      }
    }
    return true;
  }
}

/**
 * Origin allowlist for the WebSocket handshake and any browser-issued
 * fetch(). A browser always sends Origin on a cross-origin (and same-origin,
 * for WS upgrades) request; a non-browser tool (curl, a Node script) sends
 * none — the "no Origin header at all" case is intentionally allowed through
 * here since that traffic already had to know the auth token, and blocking
 * it would break every legitimate non-browser client for no security benefit.
 */
export function isAllowedOrigin(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}
