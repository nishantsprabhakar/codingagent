/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * A small built-in catalog of generic, genuinely reusable skills a user can one-click add into a
 * project's saved-skills list (see tools/skills.ts) instead of starting from an empty one. These are
 * templates offered up front, not fabricated history — nothing here claims the agent already learned
 * these from real work on this project, unlike a skill saved via save_skill.
 */
import type { SkillRecord } from "./tools/skills";

export const STARTER_SKILLS: SkillRecord[] = [
  {
    name: "Root-cause a bug systematically",
    description: "Reproduce, isolate, and fix a bug by cause rather than by guessing at the symptom.",
    steps:
      "1. Reproduce the bug with the smallest input/steps that still trigger it — cut anything that " +
      "doesn't change the outcome.\n" +
      "2. Form a single, falsifiable hypothesis for the root cause. Don't fix yet.\n" +
      "3. Verify the hypothesis directly (a log line, a debugger breakpoint, a one-line test) before " +
      "touching the fix — confirm the cause, not just a plausible-looking one.\n" +
      "4. Apply the smallest fix that addresses the confirmed cause, not the first workaround that " +
      "makes the symptom go away.\n" +
      "5. Add a regression test that fails on the old code and passes on the fix, so this exact bug " +
      "can't silently come back.\n" +
      "6. Re-run the original reproduction steps once more against the fix to confirm end-to-end.",
  },
  {
    name: "Write a clear PR/commit description",
    description: "Structure a pull request or commit message so a reviewer understands the why, not just the what.",
    steps:
      "1. One sentence on WHY this change exists (the problem or request), not what the diff does — " +
      "the diff already shows that.\n" +
      "2. A short bulleted list of what changed, grouped by concern if the diff touches multiple areas.\n" +
      "3. A test plan: what you actually ran/checked to confirm it works, not just 'should work'.\n" +
      "4. Link the related issue/ticket if one exists.\n" +
      "5. Call out anything a reviewer should pay extra attention to (a risky edge case, a behavior " +
      "change, something you're not fully confident about) — don't make them find it themselves.",
  },
  {
    name: "Safely upgrade a dependency",
    description: "Upgrade a package without silently breaking something a version bump changed underneath you.",
    steps:
      "1. Read the changelog/release notes between the current and target version — specifically for " +
      "breaking changes, not just new features.\n" +
      "2. Upgrade one package at a time, not a bulk 'upgrade everything' pass — isolates which package " +
      "caused a regression if one appears.\n" +
      "3. Run the full test suite after each upgrade, not just a smoke check.\n" +
      "4. Grep the codebase for usage of anything the changelog flagged as removed/renamed/changed " +
      "default behavior — a passing test suite doesn't guarantee coverage of every call site.\n" +
      "5. Check the lockfile diff for unexpected transitive version changes before committing.",
  },
  {
    name: "Add input validation at a trust boundary",
    description: "Validate external input exactly once, at the edge, instead of scattering redundant checks deep in internal calls.",
    steps:
      "1. Identify the actual trust boundary — where untrusted input enters (an API handler, a CLI " +
      "argument parser, a file/config parser, a webhook payload) — not every function that happens to " +
      "receive the value afterward.\n" +
      "2. Validate shape, type, and any domain constraints (range, enum membership, required fields) " +
      "right there, and reject with a specific, actionable error message — not a generic 500/exception.\n" +
      "3. Once validated at the boundary, trust the value for the rest of the call chain — don't " +
      "re-validate the same field three functions deep; that's noise that hides the one check that " +
      "actually matters.\n" +
      "4. For anything that becomes a file path, shell argument, or query fragment, validate against " +
      "injection/traversal specifically, not just 'is it a string'.",
  },
  {
    name: "Diagnose a flaky test",
    description: "Confirm real flakiness and find the actual shared-state/timing cause before touching the implementation.",
    steps:
      "1. Rerun the failing test 10-20 times in isolation first — confirm it's genuinely flaky and not " +
      "a one-off environment issue or a test that's just wrong.\n" +
      "2. Check for shared/mutable state between tests (module-level variables, a shared fixture, " +
      "leftover DB/file state from a previous test) — the most common real cause.\n" +
      "3. Check for timing assumptions (a fixed sleep instead of waiting on a real condition, a race " +
      "between an async operation and an assertion).\n" +
      "4. Check whether the test passes in isolation but fails only as part of the full suite — that's " +
      "a strong signal of test-order dependence or leaked state, not the logic under test.\n" +
      "5. Fix the actual cause (add proper synchronization, isolate/reset shared state, remove the " +
      "order dependency) rather than papering over it with a longer timeout or a retry wrapper.",
  },
];
