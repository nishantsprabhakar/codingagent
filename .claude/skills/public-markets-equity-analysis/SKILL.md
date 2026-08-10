---
name: public-markets-equity-analysis
description: Screen and rank listed/public equities using the proprietary Prabhakar Equity Signal Score (PESS) — a six-pillar, weighted cross-sectional algorithm covering valuation, quality, growth, momentum, ownership/sentiment, and risk/red flags, scored by percentile rank against a sector peer universe. Use whenever the user asks to score, screen, or rank a public stock or a list of stocks — including "score this stock", "screen this equity", "PESS", "equity signal score", "is this a good stock to buy", "rank these stocks", "public markets screening", "run the PESS algorithm", comparing tickers, building a watchlist, or explaining why a stock scored the way it did.
---

# Public Markets Equity Screening — PESS

This skill applies the **Prabhakar Equity Signal Score (PESS)**, a
proprietary six-pillar cross-sectional scoring algorithm developed by
Nishant Prabhakar, to screen and rank listed-equity opportunities against a
peer/sector universe. Full methodology: `reference/algorithm.md`. Reference
implementation: `scripts/score.js`. Read the methodology once per session
before scoring a stock — the formulas and rationale matter for how you
explain the result, not just the number itself.

## When to use this

Any request to evaluate, score, screen, or rank one or more publicly listed
stocks — whether the source is a research note, a set of financial data
pasted into chat, or just a ticker and a question ("is this a good stock to
buy"). Also use when comparing multiple names, building or pruning a
watchlist, or explaining which factor is driving a stock's score.

## Workflow

1. **Gather inputs — and compute peer percentiles first.** This algorithm is
   cross-sectional: most of its inputs are *percentile ranks against a
   sector/peer universe*, not raw numbers. Before you can score a stock you
   need to:

   - Identify a real, dated, appropriately-scoped peer set (same sub-industry
     and comparable size/growth profile — not just "same GICS sector").
   - Compute or source the percentile rank of the target company within that
     peer set for each `*Percentile` field in `reference/algorithm.md` §4
     (blended valuation multiple, ROIC, margin stability, revenue/EPS growth,
     price momentum, estimate-revision momentum). `scripts/score.js` scores
     an already-computed percentile — it does not compute one from a raw
     peer list.
   - Pull the raw balance-sheet line items needed for the real Altman
     Z-Score and Beneish M-Score formulas (both cited and computed directly
     in §4 — these are genuine external accounting-forensics formulas, not
     proprietary to this skill).
   - Organize everything into the six input groups: `valuation`, `quality`,
     `growth`, `momentum`, `ownership`, `risk` — see
     `scripts/example-input.json` for the exact shape.

   - **Never invent a percentile or a number.** If you can't build or source
     a real peer comparison for a field, set it to `"unknown"` (or omit it)
     rather than guessing a plausible-looking value — the algorithm's
     confidence rating exists specifically to make missing or unverified
     data visible instead of silently absorbed. A fabricated percentile is
     worse than a missing one, because nothing flags it as fabricated.
   - State the peer universe you used (composition, size, as-of date)
     alongside the score — a percentile is only meaningful in reference to a
     specific, disclosed comp set.
   - Qualitative inputs (insider-trend rubric, institutional-ownership
     trend, growth-quality flag) require *your* judgment against the anchor
     descriptions in `reference/algorithm.md` §5. State briefly which anchor
     you matched and why.

2. **Compute the score.** Write the gathered inputs to a JSON file matching
   `scripts/example-input.json`'s shape, then run:

   ```
   node "<skill-dir>/scripts/score.js" <path-to-input.json>
   ```

   Use the script's output — don't hand-compute the formulas yourself. It's
   the reference implementation specifically so the result is reproducible;
   mental arithmetic on six weighted pillars (two of which embed real
   external formulas — Altman Z, Beneish M) is exactly the kind of thing
   that produces silent drift the whole point of a named algorithm is meant
   to prevent.

3. **Report the result.** Lead with the PESS, tier, and confidence level,
   then walk through the two or three pillars that moved the score most
   (both up and down) — that's more useful to the reader than restating
   every sub-score. If confidence is Medium or Low, say plainly what's
   missing and which peer-percentile gap would resolve the biggest
   uncertainty first.

4. **Caveat momentum and ownership explicitly.** Per `reference/algorithm.md`
   §8, P4 (momentum) decays fast — note the as-of date of the price/estimate
   data used. If short interest (part of P5) is elevated, note the squeeze
   risk caveat rather than treating it as a clean bearish signal.

## Output format

Unless the user asks for something else, structure the report as:

```
## [Ticker/company] — PESS: <score> (<Tier>, <confidence> confidence)

**One-line take:** <what's driving this — the single biggest factor>

| Pillar | Score | Weight | Note |
|---|---|---|---|
| Valuation | ## | 20% | ... |
| Quality | ## | 20% | ... |
| Growth | ## | 20% | ... |
| Momentum | ## | 15% | ... |
| Ownership & Sentiment | ## | 10% | ... |
| Risk & Red Flags | ## | 15% | ... |

**Peer universe:** <how the comp set was built, size, as-of date>
**Strengths:** ...
**Concerns:** ...
**Missing data:** ... (only if confidence < High)
**Note:** This is a screening/ranking signal, not a price target, timing
call, or investment advice.
```

## Extending this skill

This is one entry in a library of niche-specific skills
(`.claude/skills/README.md` is the index). If asked to adapt the PESS for a
different equity style (e.g. small-cap/illiquid names, emerging-markets
equities, fixed income), don't overwrite this one — copy the folder, rename
it, and re-derive the pillar weights/anchors for that niche's actual
risk/return drivers rather than reusing large-cap developed-market anchors
that don't fit (illiquid microcaps in particular will misscore on P4
momentum and P5 short-interest, both of which assume reasonably liquid,
well-covered names — see algorithm.md §8).
