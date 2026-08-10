---
name: india-macro-regime
description: Classify India's macro cycle into a named regime and asset-allocation tilt using the proprietary Prabhakar India Macro Regime Index (PIMRI) — a six-pillar, weighted composite covering growth momentum, inflation/monetary stance, external sector health, fiscal health, credit/liquidity, and capital flows/market confidence. Use whenever the user asks for India's macro outlook, to score or classify India's macro cycle, or for an asset-allocation tilt tied to the current regime — including from RBI/MOSPI/CMIE data, a macro note, or numbers typed into chat. Trigger phrases include "India macro outlook", "PIMRI", "India macro regime", "score India's macro cycle", "what's the macro regime", "asset allocation tilt for India", "India economic cycle analysis", "is India in a slowdown", "classify the Indian business cycle".
---

# India Macro Regime Classification — PIMRI

This skill applies the **Prabhakar India Macro Regime Index (PIMRI)**, a
proprietary six-pillar scoring algorithm developed by Nishant Prabhakar, to
classify India's macro cycle into one of five named regimes and attach an
asset-allocation tilt to it. Full methodology: `reference/algorithm.md`.
Reference implementation: `scripts/score.js`. Read the methodology once per
session before scoring a quarter — the formulas and the regime tilts matter
for how you explain the result, not just the number itself.

## When to use this

Any request to assess, score, or classify India's current macro/business
cycle, to explain what the macro backdrop implies for portfolio positioning,
or to compare how the cycle has shifted quarter over quarter — whether the
source is official data the user pastes in, a macro research note, or a
description of current conditions typed into chat.

## Workflow

1. **Gather inputs.** Pull the latest official data points for the fields
   listed in `reference/algorithm.md` §4–6 and mirrored in
   `scripts/example-input.json`, organized into six groups: `growth`,
   `inflation`, `externalSector`, `fiscal`, `credit`, `capitalFlows`.

   - **Never invent a number.** Cite where each figure comes from in prose —
     realistic sources are MOSPI (GDP, IIP, CPI), RBI (repo rate, FX
     reserves, banking liquidity, CAD/BoP data), CGA (fiscal deficit
     data), and NSDL/CDSL or RBI (FPI/FDI flow data). If a field isn't
     available, set it to `"unknown"` (or omit it) rather than guessing a
     plausible-looking value — the algorithm's confidence rating exists
     specifically to make missing data visible instead of silently
     absorbed.
   - **P6's risk-premium sub-component is a documented exception** —
     `capitalFlows.sovereignRiskPremiumBps` (quantitative, preferred) can
     fall back to `capitalFlows.geopoliticalPolicyRiskRubric` (qualitative
     1–5, see `reference/algorithm.md` §5) when a spread figure genuinely
     isn't available. This is the one place a qualitative judgment call
     substitutes for a hard number by design — state briefly which anchor
     description you matched and why.
   - **Fiscal quality adjustment (`fiscal.capexShareRisingYoy`)** needs a
     YoY comparison of capex share of total central government spending —
     usually from the Union Budget documents or CGA monthly accounts. Don't
     default this to `true` just because a budget speech emphasized capex;
     check the actual YoY share.

2. **Compute the score.** Write the gathered inputs to a JSON file matching
   `scripts/example-input.json`'s shape, then run:

   ```
   node "<skill-dir>/scripts/score.js" <path-to-input.json>
   ```

   Use the script's output — don't hand-compute the formulas yourself,
   especially the tent-shaped (non-monotonic) curves in P2 and P3, which are
   easy to get backwards by hand. It's the reference implementation
   specifically so the result is reproducible.

3. **Report the regime and tilt, not just the number.** Lead with the PIMRI
   score, the named regime, and its asset-allocation tilt, then walk through
   the two or three pillars that moved the score most (both up and down) —
   that's more useful to the reader than restating every sub-score. If
   confidence is Medium or Low, say plainly what's missing and which
   official release would resolve the biggest gap first.

4. **Flag global-override situations explicitly.** If P6 (capital flows) or
   P3's INR-volatility sub-component is the main driver of a weak score
   during an active global risk-off episode, say so — per
   `reference/algorithm.md` §8, that's a contagion signal, not necessarily a
   domestic-fundamentals downgrade, and the report should make that
   distinction rather than reading it as an India-specific deterioration.

## Output format

Unless the user asks for something else, structure the report as:

```
## India Macro Regime — PIMRI: <score> (<Regime>, <confidence> confidence)

**One-line take:** <what's driving this — the single biggest factor>

| Pillar | Score | Weight | Note |
|---|---|---|---|
| Growth Momentum | ## | 25% | ... |
| Inflation & Monetary Stance | ## | 20% | ... |
| External Sector Health | ## | 20% | ... |
| Fiscal Health | ## | 15% | ... |
| Credit & Liquidity | ## | 10% | ... |
| Capital Flows & Market Confidence | ## | 10% | ... |

**Asset-allocation tilt:** <regime tilt from algorithm.md §3>
**Strengths:** ...
**Watch items:** ...
**Missing data:** ... (only if confidence < High)
```

## Extending this skill

This is one entry in a growing library of niche-specific skills
(`.claude/skills/README.md` is the index, alongside `private-equity-analysis`
for deal screening). If you're asked to adapt the PIMRI for a different
economy or a sub-national (state-level) read, don't overwrite this one — copy
the folder, rename it, and re-derive the pillar anchors for that economy's
actual structural characteristics rather than reusing India-specific anchors
that won't fit (the 6.5% GDP trend anchor, the 4% CPI target, and the
1–1.5%-of-GDP CAD comfort zone are all India-specific; see
`algorithm.md` §8 for why national composites like this one don't capture
sub-national heterogeneity either).
