# Phase 8 — Skills platform (versioned packages, script preview)

Date: 2026-08-13.

## Scope decision

The backlog described Phase 8 as versioned skill packages (`SKILL.md` + `manifest.json` +
`scripts/` + `tests/` + `evals/`) replacing the flat-JSON skills store, explicitly gated: "'Never
execute untrusted skill scripts automatically' needs a concrete sandboxing/permission-preview
design before any code — don't build the package format first and bolt on safety later."

No sandboxing primitive exists anywhere in this codebase (confirmed — no vm2/isolated-vm/Docker/
resource-limiting code). Building one would be a large, novel, security-critical effort of its own,
disproportionate to a packaging phase. The user was asked and explicitly chose: **no new sandbox —
a skill's script, if it has one, only ever runs when the model separately calls the existing
`run_shell_command` tool with that exact command, which still hits the existing risk-classified
permission prompt exactly like any other shell command today.** Nothing about execution is
automatic, by construction — that is the entire safety story, and it needs no new infrastructure.

This mirrors a pattern the codebase already has for a different audience: `.claude/skills/` (a
separate, pre-existing, read-only reference library surfaced via `skillLibrary.ts`) already ships
real executable scripts that nothing auto-runs — a human or Claude Code decides when to invoke them.
Phase 8 builds the equivalent for Wrexlyn's own agent-authored skills, gated through
`run_shell_command`'s prompt instead of a human directly typing a command. `.claude/skills/` itself
was not touched — the two systems remain deliberately unrelated.

## What shipped

- **`src/tools/skills.ts`** (full rewrite) — on-disk layout is `.coding-agent/skills/<slug>/`:
  - `manifest.json` — the single source of truth `loadProjectSkills` reads back:
    `{name, description, steps, version, createdAt, updatedAt, script?, hasTestFixture}`.
  - `SKILL.md` — a generated, write-only, human-readable artifact regenerated from the manifest on
    every save. Wrexlyn's own code never reads this back, avoiding a two-sources-of-truth risk an
    earlier draft of this design had.
  - `scripts/<sanitized-filename>` — the literal script source, only written if the model supplied
    one.
  - `tests/sample-input.json` — an optional example-input fixture, if supplied. Not a test runner,
    not graded.
  - `evals/` — not built this phase. The backlog already ties real eval-running to Phase 13; a
    grading harness now would be scope creep across phases. Only a placeholder field exists.
  - Legacy flat `<slug>.json` files still load. `loadProjectSkills` reads legacy files first, then
    package directories, with package entries unconditionally overwriting a same-slug legacy entry
    — closing a transient-duplicate window a naive "read both, concatenate" approach would have.
  - `saveProjectSkill` writes the new package completely (manifest, `SKILL.md`, scripts, tests)
    *before* attempting to delete any legacy file for the same slug — a failure mid-write leaves the
    old skill recoverable rather than silently gone. Version increments off the existing manifest's
    `version` with a try/catch fallback to `1` on a corrupt/missing manifest, never throwing.
  - `validateScriptFilename` reduces to `path.basename()`, rejects empty/`.`/`..`/anything outside
    `/^[A-Za-z0-9._-]+$/`, and rejects an extension not in a fixed `INTERPRETER_BY_EXT` map
    (`.js/.mjs/.cjs → node`, `.py → python`, `.sh → bash`, `.ps1 → powershell -File`). The full shell
    command is assembled server-side — `"<interpreter> .coding-agent/skills/<slug>/scripts/<file>[
    <args>]"` — never supplied by the model as a whole string. `save_skill`'s args deliberately have
    no `scriptCommand` field: an earlier draft had the model supply the whole invocation and the
    server "rewrite" its path prefix, which is fragile (can splice a mismatched interpreter against
    the wrong extension) and addresses no real risk, since storing text isn't executing it.
  - `recallSkillTool.run()` appends a script-preview block when the matched skill has one: the
    script's description and the exact command to run it, with an explicit note that
    `run_shell_command` will still require confirmation. It only ever reads `manifest.json` fields —
    never opens the script file, never shells out, never calls `run_shell_command` itself.
  - `deleteProjectSkill` — **fixed a real regression the migration would otherwise introduce.**
    Before this phase it only removed the legacy `<slug>.json`; once a skill migrated to the package
    format, deleting it would silently no-op (the package directory — manifest, `SKILL.md`,
    scripts, tests — stayed on disk and kept loading forever, while Settings' "Delete" button
    appeared to succeed). Now it unconditionally attempts both the legacy-file removal and a
    recursive removal of the package directory.
- **`src/agent.ts`** — `handleSaveSkill` reads the four new optional args (`scriptContent`,
  `scriptFilename`, `scriptDescription`, `scriptArgs`), delegates entirely to `saveProjectSkill`,
  and surfaces its `{ok:false, error}` as a normal tool failure rather than throwing. `isReadOnlyCall`
  keeps `save_skill` in its existing permission-exempt tier (same as `remember_preference`/
  `record_evidence`) — writing skill metadata, now including script *source text*, is not more
  privileged than before; the actual execution risk is fully carried by `run_shell_command`'s own
  gate, unchanged. One sentence added to the "Self-learning" system-prompt block describing the
  optional script fields and that `recall_skill` will surface the exact command if one exists.
- **`public/app.js`/`public/style.css`** — each skill list item gets a small informational badge
  ("📎 script attached", with the script's description as a tooltip) and a relative "updated Xh ago"
  badge when present — no run affordance, since running only ever happens through the model calling
  `run_shell_command` in a live turn. The badge deliberately shows relative time, not a "v3" label,
  so it doesn't imply a rollback capability that doesn't exist.

## The permission model, stated precisely

`recall_skill` previews the exact command — it does not execute anything, and nothing in
`skills.ts` ever calls `child_process` or similar. The only path to execution is the model calling
`run_shell_command` with that previewed command, which goes through the existing
`PermissionManager.confirm()` risk-classified prompt. Direct probing of the real registered tools
confirmed `run_shell_command`'s `riskOf()` classifies a plain `node .coding-agent/skills/.../run.js`
invocation as `medium` risk — meaning it prompts, but is eligible for "Always allow."

**Honest caveat, not glossed over**: `PermissionManager`'s "Always allow" is keyed by tool name, not
command content. If the user already clicked "Always allow" for `run_shell_command` earlier in the
session on some unrelated ordinary command, every subsequent medium-risk shell command — including
a skill's previewed script command — auto-executes with no further prompt for the rest of that
process. High-risk commands can never become "always" per `riskClassifier.ts`, but a plain script
invocation typically isn't high-risk. This is pre-existing, unchanged behavior, not something this
phase alters — but "recall_skill previews the command" must not be conflated with "the command is
always re-confirmed."

## Testing

`src/__tests__/skills.test.ts` (13 tests): filename validation for valid extensions and for the
safe-basename-reduction property under traversal-shaped input (`path.basename()` strips every
leading segment regardless of how many `../` prefixes precede it, so the reduced result can never
contain a separator — this neutralizes traversal by reduction rather than needing outright
rejection); a genuine rejection case using a reduced-but-unsupported extension (`malware.exe`); an
integration test proving a traversal-attempt filename lands safely inside the skill's own
`scripts/` directory and nowhere else; script-carrying save with the exact server-computed command;
version increment plus corrupt-manifest fallback to `1`; legacy-to-package migration with
write-then-delete ordering verified via existence checks; package-always-wins-over-legacy dedupe;
`deleteProjectSkill` removing the package directory (the regression fix) and a legacy file;
`recall_skill`'s script-preview content and its absence when no script is attached; never-throws on
a missing/corrupt skills directory. All 13 pass; full suite: 179 tests, 176 pass, 3 skipped
(pre-existing/environment-gated), 0 fail.

Two wrong assumptions were caught and corrected while writing these tests, both from expecting
`validateScriptFilename` to reject traversal-shaped input outright rather than neutralize it via
`path.basename()` reduction — confirmed by directly probing `path.basename()`'s actual output for
each input before finalizing the assertions, rather than assuming.

## Live verification — what was confirmed, and an honest gap

**Attempted through the actual web UI**: a dev server was started, the browser pane connected, the
model switched to OpenRouter's free-tier router (`openrouter/free`), and a prompt was sent asking
the model to call `save_skill` with a script and then `recall_skill` to show the result. The request
was rate-limited by OpenRouter (HTTP 429) — the same free-tier quota exhaustion already documented
honestly in the Phase 6 and Phase 7 docs, not a bug in this codebase. This is the fourth time this
session that free-tier rate-limiting has blocked a live-UI confirmation attempt.

**Confirmed directly instead** (not through an LLM, but through the exact code paths a real tool
call takes): `saveProjectSkill` was called with a script (`hello.js`, `console.log('hello from skill
script');`), producing `{ok:true}` and a manifest with the expected server-computed command
(`node .coding-agent/skills/print-hello/scripts/hello.js`). `recall_skill` was then invoked through
the actual `TOOLS['recall_skill']` registry entry from `src/tools/index.ts` — the identical object
`agent.ts` dispatches through — and returned the expected script-preview block verbatim, including
the `run_shell_command` instruction text. `run_shell_command`'s own `riskOf()` was called against
that exact previewed command and returned `medium`, confirming it would hit a real confirmation
prompt rather than auto-running. `deleteProjectSkill` was then called against the same skill and
confirmed to remove the entire package directory from disk, closing the loop on the regression fix
above. This exercises the same registered objects and the same on-disk logic a live model turn
would, short of an actual LLM producing the tool-call JSON itself.

## Known, explicitly-scoped-out limitations

- No sandboxing — an explicit, discussed decision. Script safety rests entirely on
  `run_shell_command`'s existing permission gate, with the "Always allow" caveat above stated
  honestly rather than implied away.
- No real version history or rollback — a monotonic integer with no retained prior revisions. The
  UI deliberately doesn't oversell this as more than it is.
- No `evals/` runner — explicitly deferred to Phase 13, which already owns real eval-grading in the
  backlog's own sequencing.
- `.claude/skills/` (the separate reference library) is untouched and stays a distinct system — this
  phase does not merge or couple the two.
- The live web-UI confirmation was blocked by external OpenRouter free-tier rate-limiting, not a
  code defect; direct invocation of the real registered tools substitutes for it, as noted above.
