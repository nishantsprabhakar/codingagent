---
name: insurance-underwriting-analysis
description: Score commercial property (P&C) insurance risk submissions for underwriting and pricing decisions using the proprietary Nishant Insurance Underwriting Score (NIUS) — a six-pillar, weighted algorithm covering loss history & experience, exposure quality (COPE — construction, occupancy, protection, exposure), financial strength & moral hazard, risk management & controls quality, coverage & limits adequacy, and market/pricing context. Use whenever the user asks to score, underwrite, evaluate, or triage a commercial property risk submission for a new or renewal policy — including from a loss run, statement of values (SOV), COPE data sheet, broker submission, or numbers typed into chat. Also use for comparing multiple submissions, sensitivity-testing limits/deductible/rate, or explaining why a risk landed in a given underwriting tier. Trigger phrases include "score this risk", "NIUS", "insurance underwriting score", "underwrite this submission", "should we bind this account", "commercial property underwriting", "evaluate this loss run", "run the underwriting algorithm", "what tier would this account get".
---

# Commercial Property Underwriting Risk Scoring — NIUS

This skill applies the **Nishant Insurance Underwriting Score (NIUS)**, a
proprietary six-pillar scoring algorithm developed by Nishant Prabhakar, to
score commercial property (P&C) insurance risk submissions for
underwriting/pricing purposes. Full methodology: `reference/algorithm.md`.
Reference implementation: `scripts/score.js`. Read the methodology once per
session before scoring a submission — the formulas and rationale matter for
how you explain the result, not just the number itself.

**Line of business**: commercial property only (building, business personal
property, business interruption/time-element coverage). Not tuned for
general liability, workers' comp, auto, or professional liability (E&O/D&O)
— see `reference/algorithm.md` §1 and §8, and the extension note below.

## When to use this

Any request to score, underwrite, triage, rank, or write an underwriting
summary for a commercial property risk submission — whether the source is a
loss run, a statement of values (SOV) with COPE detail, a broker submission
package, financial statements, a loss-control/engineering survey, or just a
description of the risk and requested terms typed into chat.

## Workflow

1. **Gather inputs.** Read whatever source material the user provided (loss
   run, SOV/COPE sheet, broker submission, financials, loss-control report)
   and extract the fields listed in `reference/algorithm.md` §4–5 and
   mirrored in `scripts/example-input.json`. Organize them into the six
   groups: `lossHistory`, `exposure`, `financialMoralHazard`,
   `riskManagement`, `coverageLimits`, `marketPricing`.

   - **Never invent a number.** If a field isn't stated or derivable from the
     source material, set it to `"unknown"` (or omit it) rather than
     guessing a plausible-looking value — the algorithm's confidence rating
     exists specifically to make missing data visible instead of silently
     absorbed.
   - PML (probable maximum loss), cat exposure zone, and ISO protection
     class often aren't in a broker's initial submission. Ask the user for
     the engineering/cat-model output or broker's COPE sheet, or say
     explicitly that you're using a stated/assumed figure and flag it as an
     estimate — exactly like sourcing submarket comps in a real estate
     screen, these numbers are only as good as their source and as-of date.
   - Qualitative rubrics (construction class, occupancy hazard, cat exposure
     zone, financial stability, litigation history, safety program maturity,
     business continuity planning, layering/reinsurance structure,
     competitive market conditions, account retention value) require *your*
     judgment against the anchor descriptions in `reference/algorithm.md`
     §5. State briefly which anchor you matched and why — this is the part
     an underwriting file review will push back on, so show the reasoning,
     not just the number.
   - Watch for line-of-business mismatch: every anchor in this model is
     tuned for commercial property. If the submission is actually general
     liability, workers' comp, or a professional line, say so explicitly
     rather than forcing COPE-style fields onto it — see algorithm.md §8.

2. **Compute the score.** Write the gathered inputs to a JSON file matching
   `scripts/example-input.json`'s shape, then run:

   ```
   node "<skill-dir>/scripts/score.js" <path-to-input.json>
   ```

   Use the script's output — don't hand-compute the formulas yourself. It's
   the reference implementation specifically so the result is reproducible;
   mental arithmetic on six weighted pillars is exactly the kind of thing
   that produces the silent one-point drift the whole point of a named
   algorithm is meant to prevent.

3. **Report the result.** Lead with the NIUS, tier, and confidence level,
   then walk through the two or three pillars that moved the score most
   (both up and down) — that's more useful to the reader than restating
   every sub-score. If confidence is Medium or Low, say plainly what's
   missing and what document (usually a real 5-year carrier-certified loss
   run or a current SOV/COPE sheet) would resolve the biggest gap first.

4. **Offer what-if framing when relevant.** If a pillar (especially P5,
   coverage & limits adequacy, or P6, market/pricing context) is the main
   drag, it's often worth noting what limit, retention, or rate adjustment
   would move the account into the next tier up — re-run `score.js` with the
   adjusted input rather than estimating by hand.

## Output format

Unless the user asks for something else, structure the report as:

```
## [Account/insured name] — NIUS: <score> (<Tier>, <confidence> confidence)

**One-line take:** <what's driving this — the single biggest factor>

| Pillar | Score | Weight | Note |
|---|---|---|---|
| Loss History & Experience | ## | 25% | ... |
| Exposure Quality (COPE) | ## | 25% | ... |
| Financial Strength & Moral Hazard | ## | 15% | ... |
| Risk Management & Controls Quality | ## | 15% | ... |
| Coverage & Limits Adequacy | ## | 10% | ... |
| Market/Pricing Context | ## | 10% | ... |

**Strengths:** ...
**Concerns:** ...
**Missing data:** ... (only if confidence < High)
**Recommendation:** <tier action + pricing/terms implication from algorithm.md §3>
```

## Extending this skill

This is one entry in a growing library of niche-specific skills
(`.claude/skills/README.md` is the index). If you're asked to adapt the NIUS
for a different insurance line (e.g. general liability, workers'
compensation, professional liability/E&O/D&O, commercial auto), don't
overwrite this one — copy the folder, rename it, and re-derive the pillar
definitions and anchors for that line's actual risk drivers rather than
reusing these anchors as-is. Property-specific concepts like COPE, ISO
protection class, and PML don't transfer to liability lines, which are
instead underwritten on operations/hazard classification, claims-made vs.
occurrence trigger mechanics, defense-cost exposure, and industry-specific
loss trends — see algorithm.md §8 for the full caveat.
