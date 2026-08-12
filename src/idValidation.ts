/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Session IDs and transaction IDs are interpolated directly into filesystem
 * paths (see session.ts, transactionLog.ts) and arrive over the WebSocket as
 * arbitrary client-supplied strings. A ".." or path-separator in one of these
 * is a path-traversal primitive (e.g. delete_session turns into an arbitrary
 * `fs.rmSync` of any `*.json` file reachable via `..`), so every ID must pass
 * this strict allowlist before it's allowed anywhere near `path.join`.
 */

/** Matches the shape createSessionId()/createTransactionId() actually produce — base36 timestamp + random suffix. Generous enough for any reasonable caller, strict enough to exclude every path-traversal or separator character. */
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidId(id: unknown): id is string {
  return typeof id === "string" && ID_PATTERN.test(id);
}

/** Throws with a message safe to surface to a client (never echoes the invalid input verbatim into a path or log used for anything security-sensitive). */
export function assertValidId(id: unknown, kind: string): string {
  if (!isValidId(id)) {
    throw new Error(`Invalid ${kind}: must be 1-128 characters of letters, digits, "_", or "-".`);
  }
  return id;
}
