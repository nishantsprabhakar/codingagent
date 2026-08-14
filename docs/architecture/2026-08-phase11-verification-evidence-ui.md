# Phase 11 (minus VS Code extension) — Verification history dashboard + evidence panel

Date: 2026-08-14.

## Scope decision

The backlog bundled a verification dashboard, an evidence panel, and a VS Code extension. The user
asked to skip the VS Code extension this round. What existed for the other two pieces was thinner
than the backlog's own framing assumed: verification/transaction outcomes rendered only as inline
chat-log rows (no persistent history view survives past the current session's scroll), and there was
no evidence UI at all — zero references to "evidence" anywhere in `app.js`/`protocol.ts`. The Phase 6
`record_evidence` feature is a flat, same-session conflict check, not the graph the backlog originally
envisioned. The user chose to ship a UI over the *existing* data model for both — no new evidence
data model, no cross-session provenance graph, no VS Code extension — keeping this phase to exactly
what the backlog's own text asked for once the assumptions were corrected: a dashboard and a panel,
not a Phase 6 rebuild.

## What shipped

- **`src/transactionLog.ts`** — new `listTransactions(root, {limit?, sessionId?})`: aggregates across
  every session's `.jsonl` file (or one, if `sessionId` is given), sorted most-recent-first, reusing
  the same per-line `JSON.parse`-and-skip-corrupt approach `loadTransaction` already used. A real bug
  was caught before shipping: the first draft checked `fs.existsSync(dir)` and returned `[]` *before*
  validating `sessionId` — meaning an invalid/traversal-shaped id would silently pass validation
  whenever no transaction had ever been recorded for the project, and only get caught once one had.
  Fixed by validating (`assertValidId`, the same allowlist already protecting the write path)
  unconditionally, before the existence check — an invalid id is now rejected the same way regardless
  of whether any prior data exists.
- **`src/tools/evidence.ts`** — new `listEvidenceWithConflicts(root, sessionId)`: returns every
  recorded entry for a session, each flagged with whether *any earlier* same-label entry conflicts
  with it. Built entirely from data `loadEvidence`/`appendEvidence` (Phase 6) already persist and the
  same conflict-detection logic (`valuesConflict`/`normalizeLabel`) those functions already used
  internally — no new storage, no new scoring, and it's deliberately a flat list, not a graph.
- **`src/web/server.ts`** — `GET /api/transactions?sessionId=&limit=` and
  `GET /api/evidence?sessionId=` (required for evidence — it's inherently per-session), following the
  same plain-REST pattern already used for `/api/mcp-config`. Both validate `sessionId` with
  `isValidId` before it ever reaches a filesystem path, matching this codebase's established
  path-traversal defense for client-supplied ids.
- **`public/index.html`/`app.js`/`style.css`** — two new Settings tabs, "History" and "Evidence",
  reusing the exact tab/panel structure already established for Instructions/MCP/API
  Keys/Skills/Phone (no new modal chrome). History lists past transactions with an outcome badge
  (reusing the existing `OUTCOME_CLASS`/`OUTCOME_LABELS` styling), confidence, and a "Revert" button —
  wired to the **already-existing** `rollback_request` message, not new rollback logic; the existing
  `handleRollbackResult` was extended by two lines to also update a matching History-panel button if
  one is showing, alongside the chat-log row it already updated. Evidence lists entries for the active
  session with conflicting ones visually flagged (reusing the same red/danger styling already used
  elsewhere for failure states) — a flat list, deliberately not a graph, matching what the underlying
  data actually is.

## Testing

`src/__tests__/transactionLog.test.ts` (new, 7 tests): cross-session aggregation and sort order,
session-scoped filtering, limit applied after sorting (not before), a corrupt line skipped without
losing the rest of the file, an invalid `sessionId` rejected (the bug described above, caught by
writing this exact test and fixed before it shipped), and the empty/no-directory case. Extended
`src/__tests__/evidence.test.ts` (+3 tests) for `listEvidenceWithConflicts`: an entry is flagged only
when an *earlier* same-label entry disagrees with it (not a later one), numerically-equivalent entries
are never flagged, and an empty session returns `[]`. Full suite: 222 tests, 219 pass, 3 skipped
(pre-existing/environment-gated), 0 fail.

## Live verification

Confirmed directly through the actual web UI against a real scratch project, seeded with a real
transaction and two real evidence entries (one genuinely conflicting) via the actual
`appendTransaction`/`appendEvidence` functions — not fabricated JSON. The History panel correctly
rendered the transaction's outcome badge, confidence, and intent, and clicking "Revert" round-tripped
through the real `rollback_request`/`rollback_result` WebSocket exchange, updating the button to
"Reverted 1 file(s)" — confirming the panel's revert path reaches the same, unmodified rollback code
the chat-log's own revert button already used. The Evidence panel correctly rendered both entries and
flagged only the second (later) one as conflicting, matching `listEvidenceWithConflicts`'s intended
"conflicts with something earlier" semantics exactly.

## Known, explicitly-scoped-out limitations

- No new evidence data model or cross-session provenance graph — the panel is a UI layer over Phase
  6's existing flat, same-session model, per the user's explicit choice.
- No VS Code extension — explicitly deferred by the user this round. The backlog's original framing
  (embed the existing web UI in a VS Code webview vs. drive the WS protocol with native VS Code UI) is
  still an open design fork for whenever that work is picked up.
- The History panel has no pagination beyond a `limit` query parameter (server-side default 100,
  capped at 200) — reasonable for a single local project's history, not built for a project with
  thousands of transactions.
