---
name: drug-discovery-screening
description: Screen and score drug discovery / pharma pipeline assets using the proprietary Prabhakar Asset Viability Score (PAVS) — a six-pillar, weighted algorithm covering clinical stage & historical probability of success, efficacy signal strength, safety/tolerability, target/mechanism validation, competitive & commercial position, and regulatory/IP risk. Use whenever the user asks to evaluate, score, screen, or prioritize a drug candidate, pipeline asset, clinical program, or biotech/pharma R&D program — including from trial readouts, IND/NDA filings, competitive-intelligence summaries, or a description typed into chat. Also use for comparing multiple pipeline assets, sensitivity-testing what data would move the tier, or explaining why an asset scored the way it did. Trigger phrases include "score this drug candidate", "evaluate this pipeline asset", "PAVS", "asset viability score", "screen this pharma program", "is this drug worth advancing", "pipeline prioritization", "run the PAVS algorithm".
---

# Drug Discovery / Pharma Pipeline Screening — PAVS

This skill applies the **Prabhakar Asset Viability Score (PAVS)**, a
proprietary six-pillar scoring algorithm developed by Nishant Prabhakar, to
screen drug discovery and pharma pipeline assets. Full methodology:
`reference/algorithm.md`. Reference implementation: `scripts/score.js`. Read
the methodology once per session before scoring an asset — the formulas and
rationale matter for how you explain the result, not just the number itself.

## When to use this

Any request to evaluate, score, screen, rank, or prioritize a drug candidate,
clinical-stage pipeline asset, or pharma R&D program — whether the source is
a trial readout, an investor/scientific update, competitive-intelligence
notes, regulatory filing status, or just a description of the program typed
into chat.

## Workflow

1. **Gather inputs.** Read whatever source material the user provided (trial
   data, regulatory status, competitive landscape notes, uploaded files) and
   extract the fields listed in `reference/algorithm.md` §4–5 and mirrored in
   `scripts/example-input.json`. Organize them into the six groups:
   `clinical`, `efficacy`, `safety`, `mechanism`, `competitive`, `regulatory`.

   - **Never invent a number.** If a field isn't stated or derivable from the
     source material, set it to `"unknown"` (or omit it) rather than guessing
     a plausible-looking value — the algorithm's confidence rating exists
     specifically to make missing data visible instead of silently absorbed.
   - **Historical phase-transition base rates (P1) are industry aggregates,
     not asset-specific guarantees.** They describe the average program at
     that stage across the industry. Say so explicitly when reporting P1 —
     don't present the base score as a bespoke forecast for this asset.
   - **P2's evidence-quality gate is opt-out, not opt-in** — check whether
     the result is statistically significant *and* from a controlled,
     randomized design before assuming the gate doesn't apply. An
     open-label or single-arm readout with a striking effect size still gets
     capped at 50; don't let an impressive-looking number bypass the gate
     just because the source material presents it confidently.
   - Competitive-density and pricing-power inputs (P5) usually require
     judgment against current competitive intelligence, which goes stale
     fast (see algorithm.md §8) — ask the user for their comp set / competitor
     list if it's not supplied, or say explicitly that you're using an
     as-of-date estimate and flag it as such.
   - Qualitative rubrics (target/mechanism validation, pricing power) require
     *your* judgment against the anchor descriptions in `reference/
     algorithm.md` §5. State briefly which anchor you matched and why — this
     is the part a reader will push back on, so show the reasoning, not just
     the number.

2. **Compute the score.** Write the gathered inputs to a JSON file matching
   `scripts/example-input.json`'s shape, then run:

   ```
   node "<skill-dir>/scripts/score.js" <path-to-input.json>
   ```

   Use the script's output — don't hand-compute the formulas yourself. It's
   the reference implementation specifically so the result is reproducible;
   mental arithmetic on six weighted pillars is exactly the kind of thing that
   produces the silent one-point drift the whole point of a named algorithm is
   meant to prevent.

3. **Report the result.** Lead with the PAVS, tier, and confidence level, then
   walk through the two or three pillars that moved the score most (both up
   and down) — that's more useful to the reader than restating every
   sub-score. If confidence is Medium or Low, say plainly what's missing and
   what data would resolve the biggest gap first.

4. **Offer what-if framing when relevant.** If a pillar (especially P1, stage
   risk, or P2, evidence strength) is the main drag and there's a pending
   readout that could move it, note what result would move the asset into the
   next tier up — re-run `score.js` with the adjusted input rather than
   estimating by hand.

## Output format

Unless the user asks for something else, structure the report as:

```
## [Asset/program name] — PAVS: <score> (<Tier>, <confidence> confidence)

**One-line take:** <what's driving this — the single biggest factor>

| Pillar | Score | Weight | Note |
|---|---|---|---|
| Clinical Stage & Historical POS | ## | 25% | ... |
| Efficacy Signal Strength | ## | 20% | ... |
| Safety & Tolerability | ## | 15% | ... |
| Target / Mechanism Validation | ## | 15% | ... |
| Competitive & Commercial Position | ## | 15% | ... |
| Regulatory & IP Risk | ## | 10% | ... |

**Strengths:** ...
**Concerns:** ...
**Missing data:** ... (only if confidence < High)
**Recommendation:** <tier action from algorithm.md §3>
```

## Extending this skill

This is one entry in a growing library of niche-specific skills
(`.claude/skills/README.md` is the index). If you're asked to adapt the PAVS
for a different screening context (e.g. medical-device pipeline, diagnostics,
agtech biologics), don't overwrite this one — copy the folder, rename it, and
re-derive the pillar weights/anchors for that niche's actual risk/return
drivers rather than reusing pharma-clinical anchors that don't fit (a
medical-device program, for instance, has no Phase 1/2/3 analogue and will
misscore badly on P1 as-is; see algorithm.md §8 for the limitations this
version's anchors already carry).
