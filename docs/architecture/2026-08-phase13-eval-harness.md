# 2026-08-14 — Phase 13: product evaluation harness (12-task pilot)

## Scope

The backlog asked for a 200-task reproducible benchmark. Authoring 200 real,
independently-verifiable coding tasks is a large content effort separate from the
engineering, so this phase ships the full harness plus a **12-task pilot corpus** — a number
chosen so every task could actually be manually verified (fails on its starter code, passes
on a hand-written correct solution) before being trusted, rather than overpromising a larger
count and rushing that verification. Growing the corpus later is purely "author more
fixtures in the same `task.json` + `repo/` format" — no harness changes needed.

## Design

- **Fixtures** (`evals/tasks/<id>/`): `task.json` (`{id, title, prompt, difficulty, tags}`) +
  `repo/` (starter files, a zero-dependency `test.js` using Node's built-in `assert`, a
  `package.json` with `"scripts": {"test": "node test.js"}`). No fixture is a git repo.
- **Dual scoring**: `deterministicTestPassed` — read directly from the persisted
  transaction's `contract.checks` (the `source: "deterministic"` entry) — is the primary,
  ground-truth "required-check pass rate." `outcome === "verified"` is reported alongside as
  the realistic, user-facing signal. The gap between them is reported explicitly, never
  hidden — see the critic-ordering bug below, which is exactly that gap made visible.
- **Reproducibility** = fraction of *tasks* (not runs) where every repeat agrees on pass/fail
  — a property of tasks, not of individual runs.
- **Environment isolation**: `isolateEvalEnvironment()` redirects `HOME`/`USERPROFILE` and
  `WREXLYN_USAGE_DIR` to a scratch home before anything else runs, so eval runs never pollute
  the real usage ledger, global instructions, or OS secret store — and never silently inherit
  the interactive session's stored API keys (a run must declare its own provider/key, or use
  the free default).
- **Scratch dirs**: every repeat gets a fresh `fs.mkdtempSync` path (never deterministic),
  with a hard `!isGitRepo(scratchDir)` guard before every attempt.
- Sequential execution only, no CI integration — both explicitly out of scope for this pass.

## What the pilot run actually found

This wasn't a dry run — building the harness and running it immediately surfaced two real,
unrelated bugs in the product it was built to evaluate, before it ever produced a benchmark
number:

1. **Pollinations, the provider assumed available when this phase was scoped, had dropped
   anonymous tool-calling entirely** (a 500 wrapping "402 Payment Required" for any request
   with a `tools` array). Fixed by replacing it with Kilo as the default keyless provider —
   see `2026-08-kilo-provider-swap.md`.
2. **The independent critic rendered its verdict before deterministic verification ever ran**,
   capping outcomes below "verified" regardless of what the tests actually showed. The
   harness's dual-scoring design caught this immediately and concretely: the first live run
   showed 12/12 tasks passing their real test but only 1/12 reported as "verified." Fixed —
   see `2026-08-critic-verification-ordering-fix.md` — and re-measured with the same harness:
   12/12 passing, 12/12 verified, on the second run.

## Final pilot results (post-fixes, Kilo · kilo-auto/free, 12 tasks × 1 repeat)

- Deterministic pass rate: 12/12 (100%)
- Verified rate: 12/12 (100%)
- Reproducibility: not yet meaningfully measured — this pilot ran `--repeats 1` to stay
  inside Kilo's 200 req/hour anonymous cap; a `--repeats 3`+ run is needed for a real
  reproducibility signal and hasn't been done yet.

## Known limitations, honestly stated

- 12 tasks, not 200.
- No reproducibility data yet (repeats=1 only, for rate-limit reasons).
- Sequential only; no CI wiring.
- A separate, unrelated gap surfaced during manual verification (not fixed here, out of
  scope): `detectProjectMemory`'s `testCommand` is read once, at session start — if a task
  requires the model to add its own test script to a project that didn't have one yet,
  automatic verification has nothing to run for the rest of that session. All 12 pilot
  fixtures ship their test script already in place, so this didn't affect the numbers above,
  but it's a real limitation for tasks shaped differently.

## Verification

- `npx tsc -p . --noEmit`, `npm run build && node scripts/run-tests.js` — clean, including
  the new unit tests for `discoverTasks` (fixture parsing/validation) and `buildReport`
  (scoring/aggregation math over synthetic inputs) and a real end-to-end smoke test of
  `runOne()` against the actual `Agent`/`PermissionManager` machinery (a local HTTP server
  returning a fatal 401 exercises the harness's plumbing — scratch dir creation/cleanup, the
  `isGitRepo` guard, environment isolation — in ~2s, without any live network dependency).
- Live: the full 12-task pilot corpus run twice against a real provider (Kilo), documented
  above, with the second run serving as direct proof the critic fix worked.
