# Phase 6 — Evidence citations and same-session consistency checking

Date: 2026-08-13.

## Scope decision

The backlog's Phase 6 description was two lines — "Evidence graph and cross-artifact consistency...
depends on Phase 3 (verification contracts) and Phase 5 (stable IDs for retrieved content)" — with
no concrete deliverable anywhere else in the repo. A research pass confirmed there was nothing to
build on: no type anywhere tracked an individual fact/number or its provenance, document generation
(`create_docx`/`create_pptx`/`create_xlsx`) was fully stateless call-to-call, and Phase 5's "stable
IDs" didn't actually exist (search/symbol results are just file+line, recomputed fresh every call).

Since even the feature's basic shape was undefined, the user was given three genuinely different
interpretations before any code was written:

1. **Lightweight citation + same-session number conflicts** — the model optionally tags a labeled
   figure with its source; a later artifact in the same session stating the same fact differently
   gets flagged automatically. Small, bounded.
2. **Full evidence graph with automatic fact extraction** — a persisted graph of facts auto-extracted
   from generated documents, queried for cross-artifact conflicts. Closer to what the product's own
   marketing copy ("0 conflicts", "evidence-backed execution") implies, but fact
   normalization/extraction (recognizing "Revenue", "Total Revenue ($M)", and "revenue" as the same
   fact) is a genuinely open-ended NLP problem, not a bounded feature.
3. **Code-centric verification-coverage signal** — reinterpret this around Phase 3/5's actual
   machinery: flag when a change to file A (which file B depends on, per the Phase 5 symbol index)
   was never verified by a test run that exercises B.

**Option 1 was chosen.** Explicitly out of scope: cross-session tracking, automatic fact extraction
(the model must call the tool — nothing scans document content on its own), synonym/fact
normalization beyond shallow case/whitespace matching, and any new frontend UI.

## What shipped

### `src/tools/evidence.ts` — the ledger and comparison logic

A new tool, `record_evidence(label, value, source)`, lets the model tag a labeled figure with where
it came from. Persisted per-session at `.coding-agent/evidence/<sessionId>.jsonl` — the same JSONL
shape as `transactionLog.ts` (`assertValidId` as the one choke point, append-only, never throws on
load). Deliberately session-scoped, matching the chosen option's literal framing.

- **Label matching** is shallow by design: case/whitespace/trailing-punctuation insensitive
  (`"Revenue"` = `"revenue:"` = `" Revenue "`), but `"Revenue"` and `"Total Revenue"` are *not*
  merged — real fact normalization was the explicit reason option 2 was rejected.
- **Value comparison** parses both sides as numbers where possible (strips currency
  symbols/commas, handles `(500)` as accounting-negative, expands `k`/`m`/`b`/`t` suffixes) and
  flags a conflict only beyond a 0.5% tolerance — so `"$5M"` and `"5,000,000"` are recognized as the
  same fact, but `"$5M"` vs `"$4.8M"` is a real conflict. Non-numeric values (`"Approved"` vs
  `"Pending"`) fall back to case-insensitive string equality. Returns *every* prior disagreeing
  entry, not just the most recent.

### `src/agent.ts` — wiring, and two real bugs found via live verification

`record_evidence` is special-cased exactly like `remember_preference`/`save_skill` (needs direct
`Agent` instance access to `sessionId`/`currentTransaction` that a stateless `ToolSpec.run` can't
reach), including being exempt from permission prompts (a ledger append, not a project-filesystem
mutation). A conflict found during a turn is (a) reported back to the model immediately in the tool
result, so it can self-correct within the same turn, and (b) flushed into `tx.contract.checks` as a
`source: "critic"` entry in `finalizeTransaction` — reusing the existing critic severity tier rather
than adding a new `VerificationSource`, so `deriveOutcome()` needed zero changes and the existing
outcome badge picks it up with zero new frontend code.

Live testing (asking the agent to record the same fact twice with different values, through the
actual web UI) surfaced two real integration bugs before this could be trusted, both now fixed:

1. **The conflict was detected and reported correctly, but the transaction outcome stayed
   `no_changes`.** `record_evidence`'s low-risk classification means it's deliberately never added
   to `tx.actions` (the same audit-trail gate `remember_preference`/`save_skill` are already
   exempt from) — so `mutatingHappened` (`tx.actions.length > 0`) stayed false, and
   `deriveOutcome()`'s first check (`if (!mutatingHappened) return no_changes`) short-circuited
   before ever looking at `contract.checks`. The evidence-conflict entry was built correctly and
   was simply unreachable. Fixed by widening `mutatingHappened` to
   `tx.actions.length > 0 || evidenceConflictFound` — a no-conflict recording still correctly
   counts as `no_changes`.
2. **That fix then caused the outcome to read `blocked` instead of `partially_verified`.**
   `allDenied` was computed as `mutatingHappened && tx.actions.every(...)` — and
   `Array.prototype.every` on an **empty** array is vacuously `true` in JavaScript. Once
   `mutatingHappened` could be true with `tx.actions` still empty, "every action was denied"
   trivially passed even though nothing was ever denied. Fixed by requiring
   `tx.actions.length > 0 && tx.actions.every(...)` explicitly, rather than relying on
   `mutatingHappened` to imply non-emptiness.

Neither bug was in `deriveOutcome()` itself (`verificationOutcome.ts`, unchanged, still covered by
its own 14-case test suite) — both were in how `agent.ts` computed its two boolean inputs for a
scenario (a mutating turn with zero `tx.actions` entries) that hadn't existed before this phase.

### System prompt

One short addition to the existing "Self-learning" section pointing at `record_evidence`, next to
the `remember_preference`/`save_skill` bullets already there.

## Testing

`src/__tests__/evidence.test.ts` (9 tests): numeric equivalence across notations, accounting-negative
parentheses, label normalization (shallow, not synonym-aware), non-numeric fallback, multi-entry
conflict reporting (every disagreeing entry, not just the latest), session-scoped persistence
round-trip, and missing/corrupt-file handling. `npm run verify`: clean, 154 tests, 151 pass (3
skipped — 2 pre-existing platform skips, 1 from Phase 5's symlink test), across both fixes above.

## Live verification — what was confirmed, and an honest gap

Confirmed live, through the actual web UI: calling `record_evidence` twice with the same label and
a genuinely different value (a) ran with no permission prompt (correct low-risk classification),
(b) the second call's tool output immediately and correctly reported the conflict against the first
recording, and — after the `mutatingHappened` fix, before the `allDenied` fix was discovered — that
the outcome had moved off `no_changes` (it read `Blocked`, which is exactly what led to finding bug
2).

**What was not re-confirmed live**: the final state, after the `allDenied` fix, showing the outcome
badge as `partially_verified` in the browser. Every OpenRouter free model tried (5 in a row) was
429-rate-limited during this session, almost certainly from the volume of free-tier testing already
done today across Phase 5 and Phase 6 — an external, temporary constraint, not something in this
codebase's control. Confidence in the final fix instead rests on: `deriveOutcome()` itself is
unchanged and already exhaustively tested (`verificationOutcome.test.ts`); a direct trace of its
ladder logic with the corrected inputs (`mutatingHappened=true`, `allDenied=false`,
`ranAuthoritative=false`, `ranCritic=true`, `criticFailed=true`) lands on
`if (ranCritic) return partially_verified` deterministically; and the full regression suite passed
clean after both fixes. This is a real, stated gap in verification rigor, not glossed over — revisit
with a live check once OpenRouter's free-tier limit clears, or with a paid-key provider.

## Known, explicitly-scoped-out limitations

- No cross-session tracking — a fact recorded in one chat session is invisible to a different
  session, even for the same project. Explicit, discussed non-goal.
- No automatic fact extraction — the model must call `record_evidence` itself; nothing scans
  generated document content looking for numbers to track.
- Shallow label matching only — `"Revenue"` and `"Total Revenue"` are different facts as far as
  this system is concerned. Real synonym/fact normalization was the reason the full-evidence-graph
  option was rejected.
- No new frontend UI — a conflict surfaces via the existing generic outcome badge and via the tool
  call's own output text, not a dedicated evidence/citation panel.
