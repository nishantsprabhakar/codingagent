# 2026-08-14 — Adversarial review of safety-critical code: 4 findings, 4 fixes

Following the critic-verification-ordering fix, a dedicated adversarial review pass was run
against the app's safety/correctness-critical paths (permission gating, risk classification,
path sandboxing, git-checkpoint rollback, MCP/OAuth, secret storage, web auth). Every finding
below was traced through the actual source and empirically reproduced against the real code
before being accepted — not inferred from reading alone. Fixed in commit order, most severe
first.

## 1. CRITICAL — a prior lower-risk "Always allow" silently approved later high-risk calls to the same tool

**File:** `src/permissions.ts`, `PermissionManager.confirm()`

`alwaysAllowed` is keyed by tool name only, but `run_shell_command`'s risk is recomputed on
every call (`classifyShellCommand` inspects the actual command string). The fast path
(`this.alwaysAllowed.has(toolName)`) returned `true` unconditionally, without checking the
current call's risk. Concretely: a user clicks "Always allow" on `npm test` (medium risk) —
an extremely natural way to stop repeat prompts on routine commands — and every subsequent
shell command, including `rm -rf /` or `git push --force` (high risk), is now auto-approved
with **zero confirmation**, for the rest of the process. This directly contradicted the
class's own documented invariant ("high-risk actions can never become an always").

**Fix:** the fast path now also requires `risk !== "high"`. `yolo` mode (an explicit,
documented, all-risk bypass used deliberately for disposable environments like the eval
harness and Best-of-N) is unaffected — it still bypasses everything, by design.

**Test:** `permissions.test.ts` — reproduces the exact scenario (medium "always" on
`run_shell_command`, then a high-risk call to the same tool) and asserts the second call
still goes through `confirmFn`.

## 2. HIGH — command chaining after a whitelisted read-only prefix disabled both the rollback checkpoint and post-hoc verification

**File:** `src/riskClassifier.ts`, `isReadOnlyIshShellCommand()`

The regex matched a read-only keyword prefix (`git status`, `echo`, `cat`, ...) without
checking what followed it. `git status && rm -rf .` matches the `git status` prefix and was
classified read-only-ish — even though `classifyShellCommand` correctly flags the same string
`high` for its confirmation prompt. Since this same predicate gates both the pre-execution git
checkpoint (`shouldCheckpointTree`) and the post-hoc verification/critic pass (`shouldVerify`)
in `agent.ts`, a chained command that got past confirmation (or was pre-approved — see Finding
1) would run with **no rollback snapshot and no independent review**.

**Fix:** added a check for shell chaining/substitution operators (`&&`, `||`, `;`, `|`, `&`,
backtick, `$(`) anywhere in the command string — matching the file's own stated "prefer false
positives" policy — before falling through to the prefix-keyword regex.

**Test:** `riskClassifier.test.ts` — covers `&&`, `;`, `|`, `||`, `&`, `` ` ``, and `$(...)`.

## 3. MEDIUM — the high-risk pattern list missed common Windows destructive-command variants

**File:** `src/riskClassifier.ts`, `HIGH_RISK_PATTERNS`

`rd` (cmd.exe's synonym for `rmdir`) wasn't matched at all; `rmdir`/`del` required a specific
flag order (`rmdir /q /s dir` — flags reversed from the pattern — was missed); `erase`
(cmd.exe's synonym for `del`) wasn't matched; `format /fs:ntfs /q c:` and `format /q c:` (drive
letter not immediately after "format") were missed. Each of these classified as `medium`
instead of `high` — meaning, combined with Finding 1, they could become an "always" after a
single unrelated medium-risk grant.

**Fix:** broadened the patterns to cover both command name synonyms and flag-order
independence, while adding a word-boundary-safe drive-letter check for `format` specifically
so it doesn't false-positive on an unrelated command like `npm run format`.

**Test:** `riskClassifier.test.ts` — covers `rd`/`rmdir` flag-order variants, `erase`, and
`format` with flags before/after the drive letter, plus a explicit non-regression check that
`npm run format` still classifies as `medium`.

## 4. LOW — a filename containing a literal `%VAR%` could silently fail to restore

**File:** `src/gitCheckpoint.ts`, `checkoutPaths()`

Not a security bug (confirmed: cmd.exe's quoting correctly contains shell metacharacters like
`&`/`|` inside a quoted argument, so command injection via a crafted filename was not
reproducible) but a real correctness gap: `checkoutPaths` built one shell-quoted string of all
restore paths and ran it through `execSync`, which always invokes a real shell. cmd.exe
expands `%VAR%` sequences even *inside* double-quoted arguments — a path legitimately
containing a literal `%...%` (valid on NTFS) would be silently rewritten before git ever saw
it, failing that one file's restore and aborting the whole tree rollback.

**Fix:** added `runGitArgv`, a sibling to the existing `runGit` helper that uses
`execFileSync` with a real argv array instead of one joined shell string — bypassing the
shell (and its expansion/quoting rules) entirely for this call. Used only for
`checkout-index`, the one call site that takes user-influenced file paths as arguments; every
other `gitCheckpoint.ts` call continues to use the existing `runGit`/`execSync` path
unchanged, since none of them pass file paths as arguments.

**Test:** `gitCheckpoint.test.ts` — a real git repo round-trip with a file named
`file-%NOT_A_REAL_VAR%-name.txt`.

## Areas reviewed with nothing found

`src/tools/paths.ts` (`resolveInRoot` — traversal, absolute/UNC paths, symlink escapes),
`src/tools/fs.ts` (all consistently route through `resolveInRoot`), `src/workspaceSnapshot.ts`
(staleness checks, binary handling, legacy fallback), `src/web/server.ts` (auth-token check is
centralized before dispatch, applied uniformly, WebSocket upgrade separately checks Origin and
token), `src/secretStore.ts`/`src/apiKeys.ts` (secrets passed via stdin where possible,
plaintext fallback explicit and logged once, never found flowing into an error/log message),
`src/mcpOAuth.ts` (PKCE verifier, strict CSRF `state` validation, loopback-only callback,
browser opened via argv array not a shell string).

## Verification

- `npx tsc -p . --noEmit`, `npm run build && node scripts/run-tests.js` — 250 passing, 0
  failing, 3 skipped (up from 242 before this pass; +8 new regression tests, +0 regressions).
- Each fix has a dedicated regression test exercising the real production class/function
  directly (not a mock) — sufficient proof for these deterministic, self-contained bugs, unlike
  the critic-ordering fix which needed a live multi-task benchmark to surface an emergent,
  cross-call interaction.

## Honest framing

This review found real, previously-unknown issues in code that had been in place since Phase
4 (risk classification, checkpointing) and the project's very first commits (permissions).
That is itself informative: it means issues like this can exist in shipped, seemingly-working
code for a long time without being caught by normal use, and a single adversarial pass — even
a thorough one — should not be read as proof no more exist. "10/10 engineering" was the stated
goal of this pass; what was actually achieved is four real, verified fixes with regression
coverage, and a documented list of what was checked and found clean. That is meaningfully
better than before, not a claim of completeness.
