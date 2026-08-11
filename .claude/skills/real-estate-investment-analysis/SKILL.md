---
name: real-estate-investment-analysis
description: Screen and score commercial real estate acquisition targets using the proprietary Nishant Real Estate Investment Score (NREIS) — a six-pillar, weighted algorithm covering income quality, growth potential, location/market dynamics, physical asset quality, deal structure/leverage, and exit/liquidity risk. Use whenever the user asks to evaluate, score, screen, or underwrite a commercial property, acquisition target, or deal pipeline entry — including from an offering memorandum (OM), rent roll, comp set, or property condition report. Also use for comparing multiple properties, sensitivity-testing purchase price/leverage, or explaining why a deal scored the way it did. Trigger phrases include "score this property", "NREIS", "real estate investment score", "evaluate this acquisition", "should we buy this building", "CRE deal screening", "underwrite this property", "run the real estate algorithm".
---

# Commercial Real Estate Investment Screening — NREIS

This skill applies the **Nishant Real Estate Investment Score (NREIS)**, a
proprietary six-pillar scoring algorithm developed by Nishant Prabhakar, to
screen commercial real estate acquisition opportunities. Full methodology:
`reference/algorithm.md`. Reference implementation: `scripts/score.js`. Read
the methodology once per session before scoring a property — the formulas and
rationale matter for how you explain the result, not just the number itself.

## When to use this

Any request to evaluate, score, screen, rank, or write an acquisition summary
for a commercial real estate opportunity — whether the source is an offering
memorandum (OM), a rent roll, a broker's comp set, a property condition report
(PCR), a financial model/pro forma, or just a description of the property and
deal terms typed into chat.

## Workflow

1. **Gather inputs.** Read whatever source material the user provided (OM,
   rent roll, comps, PCR, uploaded files) and extract the fields listed in
   `reference/algorithm.md` §4–5 and mirrored in `scripts/example-input.json`.
   Organize them into the six groups: `income`, `growth`, `location`,
   `physical`, `structure`, `exit`.

   - **Never invent a number.** If a field isn't stated or derivable from the
     source material, set it to `"unknown"` (or omit it) rather than guessing
     a plausible-looking value — the algorithm's confidence rating exists
     specifically to make missing data visible instead of silently absorbed.
   - Submarket comps (median cap rate, vacancy trend, population/job growth,
     new-supply pipeline) usually aren't in the OM. Ask the user for their comp
     set/broker report, or say explicitly that you're using a stated/assumed
     comp figure and flag it as an estimate — exactly like sourcing sector
     comps in a PE screen, these numbers are only as good as their source and
     as-of date.
   - Qualitative rubrics (tenant credit quality, building class/age,
     asset-class liquidity) require *your* judgment against the anchor
     descriptions in `reference/algorithm.md` §5. State briefly which anchor
     you matched and why — this is the part a reader will push back on, so
     show the reasoning, not just the number.
   - Watch for asset-type mismatch: the WALE sub-metric (P1c) is tuned for
     multi-tenant commercial leasing and is largely uninformative for
     multifamily (short, ~1-year lease terms) — flag this rather than letting
     it silently drag the score; see algorithm.md §8.

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

3. **Report the result.** Lead with the NREIS, tier, and confidence level, then
   walk through the two or three pillars that moved the score most (both up
   and down) — that's more useful to the reader than restating every
   sub-score. If confidence is Medium or Low, say plainly what's missing and
   what document (usually a real rent roll or trailing operating statements)
   would resolve the biggest gap first.

4. **Offer what-if framing when relevant.** If a pillar (especially P5, deal
   structure & leverage) is the main drag, it's often worth noting what
   purchase price, leverage level, or debt terms would move the deal into the
   next tier up — re-run `score.js` with the adjusted input rather than
   estimating by hand.

## Output format

Unless the user asks for something else, structure the report as:

```
## [Property name/address] — NREIS: <score> (<Tier>, <confidence> confidence)

**One-line take:** <what's driving this — the single biggest factor>

| Pillar | Score | Weight | Note |
|---|---|---|---|
| Income Quality | ## | 25% | ... |
| Growth Potential | ## | 20% | ... |
| Location & Market | ## | 20% | ... |
| Physical Asset Quality | ## | 15% | ... |
| Deal Structure & Leverage | ## | 10% | ... |
| Exit / Liquidity Risk | ## | 10% | ... |

**Strengths:** ...
**Concerns:** ...
**Missing data:** ... (only if confidence < High)
**Recommendation:** <tier action from algorithm.md §3>
```

## Extending this skill

This is one entry in a growing library of niche-specific skills
(`.claude/skills/README.md` is the index, alongside `private-equity-analysis`).
If you're asked to adapt the NREIS for a different real estate strategy (e.g.
residential single-family rental, land development, hospitality/hotels), don't
overwrite this one — copy the folder, rename it, and re-derive the pillar
weights/anchors for that niche's actual risk/return drivers rather than reusing
these anchors as-is (hospitality in particular will misscore badly on P1's WALE
concept, since hotel rooms don't have leases at all; see algorithm.md §8 for the
analogous multifamily caveat).
