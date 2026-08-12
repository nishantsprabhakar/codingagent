---
name: saas-business-health
description: Score SaaS / subscription business health and fundability using the proprietary Nishant SaaS Health Score (NSHS) — a six-pillar, weighted algorithm covering revenue retention & expansion, growth efficiency, unit economics, churn & cohort retention quality, capital efficiency & burn, and qualitative/governance & concentration risk, mapped to a tier system with an investment/operating implication. Use whenever the user asks to score a SaaS company's health, assess a subscription business's fundability, evaluate recurring-revenue metrics, or explain what tier a SaaS company would land in — including from a board deck, investor update, ARR/cohort report, or numbers typed into chat. Trigger phrases include "score this SaaS business", "NSHS", "SaaS health score", "is this a healthy SaaS company", "assess this subscription business", "rate this SaaS company's metrics", "SaaS health check", "run the SaaS algorithm", "evaluate this recurring revenue business".
---

# SaaS / Subscription Business Health Scoring — NSHS

This skill applies the **Nishant SaaS Health Score (NSHS)**, a proprietary
six-pillar scoring algorithm developed by Nishant Prabhakar, to assess the
health and fundability of SaaS and other subscription/recurring-revenue
businesses. Full methodology: `reference/algorithm.md`. Reference
implementation: `scripts/score.js`. Read the methodology once per session
before scoring a company — the formulas and rationale matter for how you
explain the result, not just the number itself.

## When to use this

Any request to score, benchmark, or assess the health of a SaaS or
subscription business — whether the source is a board deck, an investor
update, a metrics dashboard export, a data-room extract, or just a
description of the company's metrics typed into chat. This covers
seed-through-growth-stage SaaS, PLG and sales-led motions alike, and general
"how healthy is this SaaS business" questions. It is not the right tool for
pre-revenue or pre-PMF startups with no retention/cohort history yet — see
`venture-capital-screening` for that stage instead.

## Workflow

1. **Gather inputs.** Read whatever source material the user provided (board
   deck, investor update, metrics export, data room) and extract the fields
   listed in `reference/algorithm.md` §4–6 and mirrored in
   `scripts/example-input.json`. Organize them into the six groups:
   `retention`, `growth`, `unitEconomics`, `churn`, `capitalEfficiency`,
   `qualitative`.

   - **Never invent a number.** If a field isn't stated or derivable from the
     source material, set it to `"unknown"` (or `null`, or omit it) rather
     than guessing a plausible-looking value — the algorithm's confidence
     rating exists specifically to make missing data visible instead of
     silently absorbed.
   - **This is not a substitute for full financial or legal diligence.** NSHS
     scores the disclosed operating and retention picture. It does not audit
     revenue recognition, does not verify ARR build-up methodology, and does
     not check contractual lock-in or most-favored-customer clauses. Say so
     explicitly in any report, and recommend a full diligence pass (audited
     financials, cohort-level ARR reconciliation) before any capital
     decision — see `reference/algorithm.md` §1.
   - **Handle the two conditional fields gracefully, not as missing data.**
     `capitalEfficiency.burnMultiple` and `capitalEfficiency.runwayMonths`
     only matter if the company is *not* FCF-positive. If
     `capitalEfficiency.isFcfPositive` is `true`, leave them out — they are
     correctly excluded from the completeness calculation and default to full
     credit, not silently penalized (see algorithm.md §4 and §6).
   - **Treat `qualitative.governanceRedFlags` as opt-in, not opt-out.** It
     defaults to "nothing found" when omitted, by design (an empty checklist
     reads as clean, not unknown). Only populate it from what the source
     material actually supports — don't state "no governance flags" in your
     report unless you actually looked for related-party transactions,
     metric restatements, unplanned executive departures, and customer
     disputes/litigation. An unexamined company defaulting to a clean P6
     score is worse than a low-confidence score, because nothing flags it as
     unexamined.
   - ARR growth, NRR/GRR, and cohort curves usually require at least two
     consecutive reporting periods to compute correctly — a single snapshot
     month is not enough. If the source material only has one point in time,
     say so and flag those fields as estimates rather than hard numbers.
   - Qualitative rubrics (founder-market fit, product moat, cohort-curve
     health) require *your* judgment against the anchor descriptions in
     `reference/algorithm.md` §4–5. State briefly which anchor you matched and
     why — this is the part a reader will push back on, so show the
     reasoning, not just the number.

2. **Compute the score.** Write the gathered inputs to a JSON file matching
   `scripts/example-input.json`'s shape, then run:

   ```
   node "<skill-dir>/scripts/score.js" <path-to-input.json>
   ```

   Use the script's output — don't hand-compute the formulas yourself. It's
   the reference implementation specifically so the result is reproducible;
   mental arithmetic on six weighted pillars (several of them piecewise-linear)
   is exactly the kind of thing that produces the silent one-point drift a
   named algorithm is meant to prevent — and near a tier boundary, that drift
   can flip the reported tier.

3. **Report the result.** Lead with the NSHS, the tier, and the
   investment/operating implication — not just the raw number, since the tier
   is what an investor or operator will actually act on. Then walk through
   the two or three pillars that moved the score most (both up and down). If
   confidence is Medium or Low, say plainly what's missing and what report or
   data pull would resolve the biggest gap first (a cohort-level retention
   report and an ARR bridge beat a single board-deck slide every time).

4. **Offer what-if framing when relevant.** If a pillar (especially P1
   retention or P5 capital efficiency) is the main drag, it's often worth
   noting what operating change (raising net-negative-churn cohorts,
   tightening CAC payback, extending runway via a raise) would move the
   company into the next tier up — re-run `score.js` with the adjusted input
   rather than estimating by hand, particularly near a tier boundary (see the
   worked example in algorithm.md §7 for why boundary cases need the script,
   not hand-rounding).

## Output format

Unless the user asks for something else, structure the report as:

```
## [Company name] — NSHS: <score> (<Tier>, <confidence> confidence)

**Implication:** <investment/operating implication for this tier>

**One-line take:** <what's driving this — the single biggest factor>

| Pillar | Score | Weight | Note |
|---|---|---|---|
| Revenue Retention & Expansion | ## | 25% | ... |
| Growth Efficiency | ## | 15% | ... |
| Unit Economics | ## | 15% | ... |
| Churn & Cohort Retention Quality | ## | 15% | ... |
| Capital Efficiency & Burn | ## | 15% | ... |
| Qualitative & Governance / Concentration | ## | 15% | ... |

**Strengths:** ...
**Concerns:** ...
**Missing data:** ... (only if confidence < High)
**Not covered by this score:** revenue-recognition audit, ARR build-up verification, and legal/contract review — recommend full diligence before any capital decision.
**Recommendation:** <tier action from algorithm.md §3>
```

## Extending this skill

This is one entry in a growing library of niche-specific decision-framework
skills (`.claude/skills/README.md` is the index, alongside
`private-equity-analysis` and `venture-capital-screening`). If you're asked to
adapt NSHS for a different recurring-revenue context (e.g. consumer
subscription apps, usage-based/PLG-only businesses with no seat-based ACV, or
vertical SaaS with heavy services attach), don't overwrite this one — copy
the folder, rename it, and re-derive the pillar anchors for that context's
actual benchmarks rather than reusing B2B-SaaS anchors that don't fit
(consumer subscription in particular will misscore badly on P2/P3 as-is,
since those anchors assume seat/contract-based ACV economics rather than a
low-ACV, high-volume consumer funnel — see algorithm.md §8).
