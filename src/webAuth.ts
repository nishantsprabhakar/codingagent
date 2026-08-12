/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Authentication for the web server: a random token generated fresh for
 * every process start, held only in memory (never written to disk), required
 * on every privileged HTTP route and WebSocket connection. Also implements
 * time-limited LAN pairing — a separate, short-lived, single-use token that
 * exchanges for the real auth token once, so the long-lived credential is
 * never the thing printed into a QR code or a URL.
 */
import * as crypto from "crypto";

const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;

function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/** Constant-time comparison so a timing side-channel can't be used to guess the token byte-by-byte. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export class WebAuth {
  readonly authToken: string;
  private pairing: { token: string; expiresAt: number } | null = null;

  constructor() {
    this.authToken = generateToken();
  }

  /** True if the given token (from an Authorization header or a query-string fallback) is the real auth token. */
  checkAuthToken(candidate: string | null | undefined): boolean {
    return !!candidate && safeEqual(candidate, this.authToken);
  }

  /** Issues a fresh short-lived pairing token, invalidating any previous unused one. */
  issuePairingToken(ttlMs = DEFAULT_PAIRING_TTL_MS): { token: string; expiresAt: number } {
    this.pairing = { token: generateToken(16), expiresAt: Date.now() + ttlMs };
    return this.pairing;
  }

  /** Single-use: a valid, unexpired pairing token exchanges for the real auth token exactly once, then is consumed. */
  redeemPairingToken(candidate: string | null | undefined): string | null {
    if (!this.pairing || !candidate) return null;
    const { token, expiresAt } = this.pairing;
    if (Date.now() > expiresAt) {
      this.pairing = null;
      return null;
    }
    if (!safeEqual(candidate, token)) return null;
    this.pairing = null;
    return this.authToken;
  }
}

/** Extracts a bearer token from an `Authorization: Bearer <token>` header value. */
export function extractBearerToken(headerValue: string | string[] | undefined): string | null {
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1] : null;
}
