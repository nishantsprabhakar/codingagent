/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * A small typed-error hierarchy plus a redaction helper, used at the specific surfaces that echo
 * an error message back to a user or a log (over the WebSocket, an HTTP response, or console.error)
 * — not a mechanical sweep of every catch block in the codebase, most of which already convert a
 * failure into this app's own `{ok: false, output}` shape and never reach one of those surfaces.
 * Generalizes the one existing precedent (`SafeFetchError` in net/safeFetch.ts) into a shared base.
 */

export class WrexlynError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class PermissionDeniedError extends WrexlynError {
  constructor(message: string) {
    super(message, "PERMISSION_DENIED");
  }
}

export class PathTraversalError extends WrexlynError {
  constructor(message: string) {
    super(message, "PATH_TRAVERSAL");
  }
}

export class ProviderError extends WrexlynError {
  constructor(message: string, public readonly provider?: string) {
    super(message, "PROVIDER_ERROR");
  }
}

/**
 * Shape-based patterns for well-known provider API-key prefixes — a fallback for when the caller
 * doesn't know which secret value might be embedded in a given piece of text (e.g. a provider's
 * own error response echoing something back). Deliberately NOT a blind "any long random-looking
 * string" pattern: that would also redact git SHAs, UUIDs, and hashes that are actually useful for
 * debugging, undermining the "actionable" half of the acceptance criterion this exists for.
 */
const SECRET_PREFIX_PATTERNS: RegExp[] = [
  /\bgsk_[A-Za-z0-9]{10,}\b/g, // Groq
  /\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, // Anthropic
  /\bsk-or-v1-[A-Za-z0-9]{10,}\b/g, // OpenRouter
  /\bAIza[A-Za-z0-9_-]{20,}\b/g, // Google / Gemini
  /\bsk-[A-Za-z0-9]{20,}\b/g, // generic OpenAI-compatible
];

/**
 * Redacts any occurrence of `knownSecrets` (exact values — the precise, zero-false-positive path,
 * works for any provider regardless of key format) plus anything matching a well-known key-prefix
 * shape (the fallback for values the caller didn't have on hand). Safe to call on arbitrary text —
 * never throws.
 */
export function redact(text: string, knownSecrets: readonly (string | undefined)[] = []): string {
  let result = text;
  for (const secret of knownSecrets) {
    if (secret) result = result.split(secret).join("[REDACTED]");
  }
  for (const pattern of SECRET_PREFIX_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/** Formats and logs an error consistently, redacting anything matching a known secret or key shape first. */
export function logError(context: string, err: unknown, knownSecrets: readonly (string | undefined)[] = []): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[coding-agent] ${context}:`, redact(message, knownSecrets));
}
