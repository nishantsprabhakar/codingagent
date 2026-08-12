---
name: ma-synergy-analysis
description: Score a proposed merger or acquisition's synergy realism and integration risk using the proprietary Nishant M&A Synergy & Integration Score (NMSI) — a six-pillar, weighted algorithm covering revenue-synergy realism, cost-synergy realism, cultural/organizational fit, integration complexity, valuation/deal-structure discipline, and execution governance. Use whenever the user asks to evaluate, score, or stress-test a specific M&A transaction between an acquirer and a target — whether the claimed synergies are realistic and whether integration is likely to succeed — including from a deal announcement, synergy bridge, fairness opinion, S-4/merger proxy, integration plan, or a description typed into chat. Also use for comparing how a deal's synergy case would score under different price/structure assumptions, or explaining why a deal scored the way it did. Trigger phrases include "score this merger", "score this acquisition's synergies", "NMSI", "M&A synergy score", "is this merger's synergy case realistic", "integration risk score", "post-merger integration risk", "synergy realism check", "run the M&A algorithm", "corp dev deal screening", "will these synergies materialize". Distinct from private-equity-analysis (NDQI), which scores whether a standalone company is a good investment, not whether a two-party merger's synergy math holds up.
---

# M&A Deal Synergy & Integration-Risk Screening — NMSI

This skill applies the **Nishant M&A Synergy & Integration Score (NMSI)**, a
proprietary six-pillar scoring algorithm developed by Nishant Prabhakar, to
score a *specific proposed transaction between an acquirer and a target* —
not whether either company is independently attractive, but whether the
deal's claimed synergies are realistic and whether the two organizations are
likely to integrate successfully. Full methodology: `reference/algorithm.md`.
Reference implementation: `scripts/score.js`. Read the methodology once per
session before scoring a deal — the formulas and rationale matter for how you
explain the result, not just the number itself.

## When to use this

Any request to evaluate, score, screen, or stress-test the synergy case and
integration risk of a proposed merger or acquisition — whether the source is
a deal announcement, a synergy bridge/walk, a fairness opinion, an S-4 or
merger proxy, an integration management office (IMO) plan, or just a
description of the acquirer, target, and deal terms typed into chat.

**Not this skill**: if the question is "should we invest in this
standalone company" (no counterparty, no synergy claim), use
`private-equity-analysis` (NDQI) instead. NMSI specifically requires two
named parties and a claimed synergy thesis to score.

## Workflow

1. **Gather inputs.** Read whatever source material the user provided (deal
   announcement, synergy bridge, proxy statement, IMO plan, analyst notes)
   and extract the fields listed in `reference/algorithm.md` §4–5 and
   mirrored in `scripts/example-input.json`. Organize them into the six
   groups: `revenueSynergy`, `costSynergy`, `culturalFit`,
   `integrationComplexity`, `dealStructure`, `governance`.

   - **Never invent a number.** If a field isn't stated or derivable from the
     source material, set it to `"unknown"` (or omit it) rather than guessing
     a plausible-looking value — the algorithm's confidence rating exists
     specifically to make missing data visible instead of silently absorbed.
   - Comparable-transaction medians (P5a) and sector leverage norms (P5b)
     usually aren't in a deal announcement. Ask the user for their comp set,
     or say explicitly that you're using a stated/assumed figure and flag it
     as an estimate.
   - Qualitative rubrics (market adjacency, cultural distance, systems
     complexity, regulatory complexity, earnout quality, retention package
     design) require *your* judgment against the anchor descriptions in
     `reference/algorithm.md` §5. State briefly which anchor you matched and
     why — this is the part a reader will push back on, so show the
     reasoning, not just the number.
   - **Revenue-synergy claims deserve extra scrutiny.** Revenue synergies are
     the least reliable line in almost every deal model — always check the
     claimed figure against the target's standalone revenue (P1a) and ask
     what evidence (pilot programs, signed LOIs, comparable prior deals)
     backs the market-adjacency rubric (P1b) before accepting management's
     number at face value.

2. **Compute the score.** Write the gathered inputs to a JSON file matching
   `scripts/example-input.json`'s shape, then run:

   ```
   node "<skill-dir>/scripts/score.js" <path-to-input.json>
   ```

   Use the script's output — don't hand-compute the formulas yourself. It's
   the reference implementation specifically so the result is reproducible;
   mental arithmetic on six weighted pillars, each with its own sub-formula,
   is exactly the kind of thing that produces the silent one-point drift the
   whole point of a named algorithm is meant to prevent.

3. **Report the result.** Lead with the NMSI, tier, and confidence level,
   then walk through the two or three pillars that moved the score most
   (both up and down) — that's more useful to the reader than restating every
   sub-score. If confidence is Medium or Low, say plainly what's missing and
   what document would resolve the biggest gap first (usually: a real
   synergy bridge with itemized line items beats a headline "$X00M in
   synergies" claim every time).

4. **Offer what-if framing when relevant.** If P5 (valuation/deal-structure
   discipline) is the main drag — often because the premium paid is high
   relative to comps — it's often worth noting what price or structure
   change (e.g., a larger earnout tied to synergy milestones) would move the
   deal into the next tier up. Re-run `score.js` with the adjusted input
   rather than estimating by hand.

## Output format

Unless the user asks for something else, structure the report as:

```
## [Acquirer] / [Target] — NMSI: <score> (<Tier>, <confidence> confidence)

**One-line take:** <what's driving this — the single biggest factor>

| Pillar | Score | Weight | Note |
|---|---|---|---|
| Revenue-Synergy Realism | ## | 20% | ... |
| Cost-Synergy Realism | ## | 20% | ... |
| Cultural & Organizational Fit | ## | 15% | ... |
| Integration Complexity | ## | 20% | ... |
| Valuation & Deal-Structure Discipline | ## | 15% | ... |
| Execution Governance | ## | 10% | ... |

**Strengths:** ...
**Concerns:** ...
**Missing data:** ... (only if confidence < High)
**Recommendation:** <tier action from algorithm.md §3>
```

## Extending this skill

This is one entry in a library of niche-specific skills
(`.claude/skills/README.md` is the index). NMSI is deliberately distinct from
`private-equity-analysis` (NDQI): NDQI scores whether a standalone
company/deal is a good investment; NMSI scores whether a *proposed
transaction between two named parties* has a realistic synergy case and
manageable integration risk. If asked to adapt NMSI for a different
transaction type (e.g., a joint venture or a minority-stake strategic
investment rather than a control acquisition), don't overwrite this one —
copy the folder, rename it, and re-derive the pillar weights/anchors, since
several formulas here (P4a's relative deal size, P5a's control premium)
assume a full-control acquisition and will misscore a JV or minority deal as-is.
