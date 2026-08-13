# Phase 5 — Project intelligence

Date: 2026-08-13.

Closes the backlog's Phase 5: "Incremental file/symbol index, lexical+semantic retrieval,
Git-history signal." The backlog flagged this as "the first phase that plausibly needs a new
dependency... flag that decision to the user before committing to one," since Wrexlyn is otherwise
zero-external-service/local-first by design. Both open decisions were put to the user before any
code was written:

- **Skip semantic/embedding retrieval entirely this phase.** No local or cloud embedding model, no
  new ML dependency. Ship lexical (ranked keyword) search + a symbol index + a git-history signal
  only. Semantic search remains a future decision, not an oversight here.
- **Symbol extraction via heuristic regex, not tree-sitter.** No new AST-parser dependency.

Net result: **zero new npm dependencies.** Everything below is built from Node built-ins plus the
`glob` package already in `package.json`.

## What shipped

### 1. `src/gitHistory.ts` — the git-history signal

`getRecentActivity(root)` runs one `git log --no-merges --name-only --pretty=format: -n 300` (a
~3s timeout, short enough to run synchronously inside `Agent`'s constructor without meaningfully
stalling session startup), parses it into a deduped, most-recent-first ordered file list, and
memoizes the result per project root for 60s. `isGitRepo` (reused from `gitCheckpoint.ts`) gates it
so a non-git project shells out to nothing. Consumed two ways: a small "Recently changed files"
block in the auto-gathered project context (`projectContext.ts`), and a graded ranking boost inside
`search_code`.

### 2. `src/codeIndex.ts` — the index engine

An incremental file/symbol index persisted at `.coding-agent/index/index.json`. "Incremental" here
means mtime/size comparison on each call, not push-based file watching — no file watcher exists
anywhere in this codebase, and this project's own working directory (like many users' will be) can
live on OneDrive/cloud-synced storage, where native watching is known to be unreliable.

- **Symbol extraction** is heuristic, line-by-line regex matching keyed by file extension
  (function/class/interface/type for TS/JS/TSX; def/class for Python; func/type for Go;
  fn/struct/enum/impl for Rust; class/interface/enum for Java/C#) — not real AST parsing. It will
  miss unusual syntax and doesn't understand scoping (a nested function isn't distinguished from a
  top-level one of the same name). This is a known, stated accuracy ceiling, not an exact
  language-server replacement.
- **Lexical search** is a hand-rolled inverted index (`token -> {file: count}`) scored as
  `sum over query tokens of IDF(token) * (1 + log(termFrequency))`, plus small bonuses for a query
  token matching a symbol name or the filename, plus a graded recency bonus from the git-history
  signal. The `1 + log(tf)` dampening (instead of raw term frequency) stops one large file that
  happens to repeat a token many times from scaling linearly with occurrence count — verified with
  a dedicated test (a 100x-more-repetitive file scores nowhere near 100x higher).
- **Persisted schema** is deliberately slim: `perFile[relPath] = {mtimeMs, size, symbols,
  tokenSet}` (just the distinct token *strings* a file contributed, not counts — counts live only
  in the aggregate `invertedIndex`) plus `invertedIndex[token][relPath] = count`. Storing each
  file's own `tokenSet` (beyond what the original plan called for) is what makes removing a
  changed/deleted file's contribution O(tokens in that one file) instead of O(entire project
  vocabulary) on every incremental update — a deliberate refinement made during implementation,
  not a scope change.
- **Correctness/security guards**, each with its own test: symlinks are never indexed (stat via
  `lstatSync`, skip entirely) — a glob walk that read whatever it enumerated would otherwise be the
  one code path in this app that doesn't route through `resolveInRoot`'s containment check;
  oversized files (>512KB) are never even read, specifically because a OneDrive/cloud-synced
  placeholder file triggers synchronous hydration on first read; binary files and UTF-16-BOM'd
  files are recorded (so they aren't re-scanned every cycle) but never tokenized, so neither
  garbles into noise tokens; `.coding-agent/**` is excluded from the walk, closing a **pre-existing
  bug** that also affected `grep_search`/`glob_search` (both could already walk into and surface
  Wrexlyn's own session/transaction data before this change).
- **Concurrency**: `ensureIndex` de-duplicates concurrent calls for the same root via a shared
  in-flight promise, and throttles real walks to at most once every 5s per root. A wall-clock time
  budget (~2s) bounds how much of a single walk's file-processing loop runs before deferring the
  rest to a later call — this bounds the *number of files processed*, not a single pathological
  blocking read (Node's synchronous `fs` calls can't be preempted mid-read); an offline OneDrive
  placeholder that hangs on `readFileSync` is an accepted, stated limitation, not solved by this
  budget.
- **A real bug found during implementation, not left in**: `glob@10` returns **backslash**-
  separated paths for nested files on Windows by default (confirmed empirically — the original
  design assumed forward-slash, which is wrong for this glob version/platform combination without
  an explicit option). Fixed by passing `posix: true` to every `glob()` call in this codebase
  (`codeIndex.ts`, and `search.ts`'s two existing tools, for consistency) — otherwise every
  persisted index key would have been platform-inconsistent, and `glob_search`/`grep_search` would
  have kept returning backslash paths to the model on Windows.

### 3. `src/tools/codeSearch.ts` — two new tools

`search_code` (ranked relevance search across file contents) and `find_symbol` (exact/substring
lookup by name across the maintained symbol index), both non-mutating (default "low" risk, no
permission prompt — confirmed live). Tool-selection disambiguation lives in each tool's own
`description` field rather than a system-prompt decision tree, so it stays co-located with the tool
and can't drift out of sync; `agent.ts`'s system prompt gets one short pointer line instead of a
multi-tool explanation.

### 4. `src/projectContext.ts` — recent-activity block

A fourth auto-gathered context block, "Recently changed files (most recent first, from git
history)," silently omitted on a non-git project or any git failure, matching the existing three
blocks' pattern exactly.

## Live verification (2026-08-13)

Through the actual web UI (OpenRouter's free router model, a fresh dev server on a throwaway port):

- `find_symbol("buildMcpServerEnv", exact: true)` correctly returned `src/mcp.ts:81` — confirmed
  against the real source line.
- `search_code("shell command permission check")` ranked `src/agent.ts` highest (score 22.27) —
  genuinely the file containing the actual shell-command risk-classification and permission logic
  — ahead of docs, `README.md`, and frontend files that also mention the same words.
- The persisted index for this real project indexed 148 files / 8,548 distinct tokens; a binary
  `.docx` whitepaper (ZIP-format, high-entropy compressed bytes) was correctly recorded with zero
  tokens — the NUL-byte heuristic caught it without needing explicit ZIP-magic detection.
- `.coding-agent/index/index.json` is created and covered by the existing `.coding-agent/.gitignore`
  (`*`), so it never lands in a user's own git history.
- Neither tool call triggered a permission prompt, confirming the non-mutating/low-risk
  classification took effect as designed.

## Testing

`src/__tests__/codeIndex.test.ts` and `src/__tests__/gitHistory.test.ts` — symbol hits (exact +
substring) across three languages; log-dampened scoring; incremental add/changed/removed handling
with no stale artifacts; binary/UTF-16 skip verified against the actual persisted JSON; a symlink
pointing outside the sandboxed root is never read in (gracefully self-skips via `t.skip()` on an
environment without symlink privilege — the same tolerance `paths.test.ts` already established for
this exact class of problem); the `.coding-agent/**` self-indexing regression; persistence
round-trip after clearing in-memory state; concurrent-call de-duplication (asserts the literal same
promise is returned, not just "no crash"); empty-project handling; git-history recency ordering and
TTL memoization against a real temp git repo.

`npm run verify`: clean. Full suite: 145 tests, 142 pass, 3 skipped (2 pre-existing POSIX-only
skips on Windows, plus the new symlink test on this environment).

## Known, explicitly-scoped-out limitations

- No semantic/embedding retrieval — a discussed, explicit decision, not an oversight.
- No `.gitignore` parsing — hand-rolling correct `.gitignore` glob semantics is its own project.
  `DEFAULT_IGNORE` is extended with common non-JS heavy directories (`.venv`, `venv`,
  `__pycache__`, `target`, `.next`, `.nuxt`, `out`, `coverage`, `.cache`, `.gradle`, `.tox`) instead,
  since Wrexlyn opens arbitrary projects, not just JS/TS ones — an unusual generated-output
  directory not on this list will still get walked.
- Regex-based symbol extraction, not real AST parsing — documented accuracy ceiling, not silently
  overclaimed as exact.
- Index staleness is bounded by the throttle/time-budget (~5s), not instant — a file changed by an
  external editor won't be reflected until the next tool call triggers a fresh-enough walk.
- A single pathological blocking file read (e.g. an offline cloud-storage placeholder) cannot be
  preempted mid-read by the wall-clock time budget, since Node's synchronous `fs` calls aren't
  cancellable — the budget bounds file *count* per walk, not one call's worst-case duration.
