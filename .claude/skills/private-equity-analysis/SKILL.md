---
name: private-equity-analysis
description: Screen and score private equity / growth-investment deals using the proprietary Prabhakar Deal Quality Index (PDQI) — a six-pillar, weighted algorithm covering financial trajectory, valuation/deal terms, market position, management/governance, growth/exit potential, and risk factors. Use whenever the user asks to evaluate, score, screen, or write an investment memo for a PE/VC/growth-equity deal, portfolio company, or target company — including from a pitch deck, financial model, CIM, or data-room documents. Also use for comparing multiple deals, sensitivity-testing entry price/terms, or explaining why a deal scored the way it did. Trigger phrases include "score this deal", "evaluate this investment", "is this a good deal", "PDQI", "deal quality index", "run the PE algorithm", "investment memo", "screen this company".
---

# Private Equity Deal Screening — PDQI

This skill applies the **Prabhakar Deal Quality Index (PDQI)**, a proprietary
six-pillar scoring algorithm developed by Nishant Prabhakar, to screen private
equity / growth-investment opportunities. Full methodology:
`reference/algorithm.md`. Reference
implementation: `scripts/score.js`. Read the methodology once per session
before scoring a deal — the formulas and rationale matter for how you explain
the result, not just the number itself.

## When to use this

Any request to evaluate, score, screen, rank, or write an investment memo for
a private equity, growth-equity, or buyout opportunity — whether the source is
a pitch deck, a CIM, a financial model, data-room extracts, or just a
description of the company and deal terms typed into chat.

## Workflow

1. **Gather inputs.** Read whatever source material the user provided (deck,
   model, CIM, uploaded files) and extract the fields listed in
   `reference/algorithm.md` §4–5 and mirrored in `scripts/example-input.json`.
   Organize them into the six groups: `financials`, `valuation`, `market`,
   `management`, `growth`, `risk`.

   - **Never invent a number.** If a field isn't stated or derivable from the
     source material, set it to `"unknown"` (or omit it) rather than guessing
     a plausible-looking value — the algorithm's confidence rating exists
     specifically to make missing data visible instead of silently absorbed.
   - **Exception — treat P4/P6 flag lists as opt-in, not opt-out.** `management.
     governanceRedFlags` and the `risk.*` booleans default to "nothing found"
     when omitted, by design (an empty checklist reads as clean, not unknown).
     Only populate them from what the source material actually supports —
     don't state "no red flags" in your report unless you actually looked for
     related-party transactions, customer concentration, key-person risk,
     etc. An unexamined deal defaulting to a clean P6 score is worse than a
     low-confidence score, because nothing flags it as unexamined.
   - Sector comps (median EV/EBITDA multiple, median leverage, median margin)
     usually aren't in the deck. Ask the user for their comp set, or say
     explicitly that you're using a stated/assumed comp figure and flag it as
     an estimate.
   - Qualitative rubrics (competitive moat, structural protections, exit path
     clarity, team track record) require *your* judgment against the anchor
     descriptions in `reference/algorithm.md` §5. State briefly which anchor
     you matched and why — this is the part a reader will push back on, so
     show the reasoning, not just the number.

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

3. **Report the result.** Lead with the PDQI, tier, and confidence level, then
   walk through the two or three pillars that moved the score most (both up
   and down) — that's more useful to the reader than restating every
   sub-score. If confidence is Medium or Low, say plainly what's missing and
   what document would resolve the biggest gap first.

4. **Offer what-if framing when relevant.** If a pillar (especially P2,
   valuation) is the main drag, it's often worth noting what entry price or
   term change would move the deal into the next tier up — re-run
   `score.js` with the adjusted input rather than estimating by hand.

## Output format

Unless the user asks for something else, structure the report as:

```
## [Company name] — PDQI: <score> (<Tier>, <confidence> confidence)

**One-line take:** <what's driving this — the single biggest factor>

| Pillar | Score | Weight | Note |
|---|---|---|---|
| Financial Performance | ## | 25% | ... |
| Valuation & Terms | ## | 20% | ... |
| Market Position | ## | 20% | ... |
| Management & Governance | ## | 15% | ... |
| Growth & Exit | ## | 10% | ... |
| Risk Factors | ## | 10% | ... |

**Strengths:** ...
**Concerns:** ...
**Missing data:** ... (only if confidence < High)
**Recommendation:** <tier action from algorithm.md §3>
```

## Extending this skill

This is the first entry in what's meant to become a library of niche-specific
skills (`.claude/skills/README.md` is the index). If you're asked to adapt the
PDQI for a different investment style (e.g. early-stage VC, real estate, credit),
don't overwrite this one — copy the folder, rename it, and re-derive the
pillar weights/anchors for that niche's actual risk/return drivers rather than
reusing PE anchors that don't fit (pre-revenue VC deals in particular will
misscore badly on P1 as-is; see algorithm.md §8).
