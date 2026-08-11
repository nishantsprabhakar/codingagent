# Nishant Equity Signal Score (NESS) — v1.0

**Proprietary cross-sectional screening methodology for listed-equity
universes, developed by Nishant Prabhakar.**

Status: v1.0 (2026-08-10). Author/owner: Nishant Prabhakar. This document is
the authoritative specification — `scripts/score.js` is a direct, literal
implementation of the formulas below. If the two ever disagree, this document
is correct and the script has a bug.

Named in the tradition of established quant-factor scoring conventions —
Fama-French style factor investing, and the older analyst-attributed models
(Altman Z-Score, Piotroski F-Score) that this document borrows real inputs
from directly. The point of putting a name on a model is that the name
becomes shorthand for a specific, checkable methodology, not a vibe. "NESS 72"
should mean the same thing regardless of who's asking or who's answering.

---

## 1. Purpose and positioning

The NESS is a **cross-sectional screening and ranking tool**, not a price
model. It exists to do three things quickly and consistently across a stock
universe:

1. Convert scattered valuation multiples, fundamentals, price history, and
   ownership data into one comparable number, ranked against a peer/sector
   universe rather than against an absolute anchor.
2. Force the same six questions to get answered for every name in a universe,
   in the same way, so screening 50 stocks produces a consistent, comparable
   list instead of 50 independently-vibed opinions.
3. Surface *which specific pillar* is driving the score — so "why is this on
   the shortlist" has a specific answer ("87th percentile quality, cheap on a
   blended multiple") instead of "the model likes it."

It is deliberately **not** a black box: every sub-score is a named, auditable
formula against a named input. If an input is unknown, the algorithm says so
and degrades its confidence rating rather than guessing silently.

**What the NESS is not**: a price-target model, a market-timing signal, or
investment advice. It does not forecast returns, does not tell you when to
buy or sell, and produces a *screening rank within a universe*, not a
standalone verdict on any one stock in isolation — a NESS of 80 means "near
the top of the peer set you compared it against," not "will go up." Run real
valuation work and your own judgment in parallel; the NESS tells you which
names in a universe are worth spending that time on.

---

## 2. Structure at a glance

Six weighted pillars, each scored 0–100, rolled into one composite. Most
pillars score by **percentile rank against a sector/peer universe** — a
company's raw P/E or ROIC means little on its own; where it sits relative to
comparable companies right now is the actual signal.

| Pillar | Weight | What it answers |
|---|---|---|
| P1. Valuation | 20% | Is this cheap or expensive versus its peer set, right now? |
| P2. Quality | 20% | Is the underlying business — returns, margin stability, balance sheet — actually good? |
| P3. Growth | 20% | Is it growing, and is that growth real (organic) or borrowed (M&A/one-off)? |
| P4. Momentum | 15% | Is the market and the sell-side already turning positive or negative on this name? |
| P5. Ownership & Sentiment | 10% | What are insiders, institutions, and short-sellers doing? |
| P6. Risk & Red Flags | 15% | What could blow this up — leverage, manipulation risk, volatility, litigation? |

```
NESS = 0.20·P1 + 0.20·P2 + 0.20·P3 + 0.15·P4 + 0.10·P5 + 0.15·P6
```

**Weighting rationale**: valuation, quality, and growth are weighted equally
at 20% each and together are 60% of the score by design — these are the three
classic, evidence-backed cross-sectional factors (cheap, good, growing) that
most factor-investing research finds durable across market regimes.
Momentum gets a real but secondary 15% — it works, but decays fast and
reverses hard, so it shouldn't dominate a screen the way valuation or quality
does. Ownership/sentiment is intentionally the smallest pillar at 10% — it's
a real but noisy signal (see P5's short-interest caveat below), useful as a
tiebreaker, not a thesis. Risk & Red Flags is weighted 15% and deductive,
because a single credible red flag (litigation, manipulation risk) should be
able to move a name a full tier on its own, the same way it would in a real
diligence conversation.

---

## 3. Score bands / tiers

| NESS | Tier | Action |
|---|---|---|
| 80–100 | **Top decile / High conviction** | Priority shortlist; deepest research first |
| 65–79 | **Attractive** | Add to watchlist; underwrite further |
| 50–64 | **Neutral / Hold** | No action either direction; re-screen next cycle |
| 35–49 | **Weak / Avoid new positions** | Don't initiate; review existing positions for trims |
| 0–34 | **Red flag / Exit review** | Existing positions should get an active exit review |

These bands assume **high confidence** inputs (see §6) and a peer universe
that is actually comparable (see §8). Under low confidence, or a thin/loosely
matched peer set, treat the tier as directional only and widen the band by
±10 points in your head before acting on it.

---

## 4. Pillar formulas

All sub-scores are clamped to `[0, 100]` after computation unless stated
otherwise. `clamp(x, lo, hi)` = min(max(x, lo), hi). `lerp` = piecewise-linear
interpolation between named anchor points.

**A note on percentile inputs**: fields named `*Percentile` throughout this
section (e.g. `valuation.blendedMultiplePercentile`) are **not** computed by
`scripts/score.js`. Computing a real cross-sectional percentile requires
building an actual, dated, well-scoped peer/sector universe and ranking the
company within it — that is real analytical work and it is the analyst's job
to do it *before* calling the script, the same way sourcing a sector comp set
is the analyst's job in the NDQI (private-equity) skill. The script scores
the already-computed percentile; it does not infer one from a raw peer list,
and it cannot detect a badly-scoped peer set — see §8.

### P1. Valuation

| Sub-metric | Weight in P1 | Formula |
|---|---|---|
| a. Blended valuation multiple percentile (equal blend of P/E, EV/EBITDA, P/FCF z-scores vs. sector peers) | 100% | `score = clamp(100 − blendedMultiplePercentile, 0, 100)` |

```
P1 = 100 − percentile_rank_of_blended_multiple
```

**Why inverted**: the percentile input is "how expensive is this stock
relative to peers" (0 = cheapest in the peer set, 100 = most expensive).
Being at the 10th percentile of valuation multiples — i.e. cheap — should
score ~90, not ~10, so the score is `100 − percentile`. This is the entire
formula for P1; there is no separate weighting to derive because the blend
across P/E, EV/EBITDA, and P/FCF happens *before* this script sees the number
(the analyst blends the three z-scores into one multiple percentile — see
§6 for the required upstream field).

### P2. Quality

| Sub-metric | Weight in P2 | Formula |
|---|---|---|
| a. ROIC percentile vs. sector peers | 35% | `roicPercentile` directly as score |
| b. Gross-margin stability percentile (inverse of 5yr margin coefficient-of-variation, percentile-ranked vs. peers) | 30% | `marginStabilityPercentile` directly as score |
| c. Altman Z-Score, banded | 35% | Compute real Z-Score (below), then `lerp` anchors: 1.0→10, 1.81→40, 2.99→70, 4.5→90, 6.0→100 |

```
P2 = 0.35a + 0.30b + 0.35c
```

**Altman Z-Score** is Edward Altman's real, established 1968
balance-sheet-strength formula — cited here as a genuine external input, not
a Nishant invention:

```
Z = 1.2·(WorkingCapital/TotalAssets) + 1.4·(RetainedEarnings/TotalAssets)
  + 3.3·(EBIT/TotalAssets) + 0.6·(MarketValueEquity/TotalLiabilities)
  + 1.0·(Sales/TotalAssets)
```

Standard bands: Z < 1.81 is the distress zone, 1.81–2.99 is the grey zone,
Z > 2.99 is the safe zone. Unlike the percentile fields above, the Z-Score is
computed directly by `score.js` from raw balance-sheet line items
(`quality.altmanZInputs.*`) — it is an absolute, cross-company-comparable
formula by construction, so no separate peer-percentile step is needed before
banding it.

### P3. Growth

| Sub-metric | Weight in P3 | Formula |
|---|---|---|
| a. Revenue growth trend percentile vs. sector peers | 50% | `revenueGrowthPercentile` directly as score |
| b. EPS growth trend percentile vs. sector peers | 50% | `epsGrowthPercentile` directly as score |

```
base = 0.50a + 0.50b
P3 = clamp(base − 15, 0, 100)   if growthQualityFlag is true, else base
```

**Growth-quality flag**: if growth is judged to be driven mainly by
acquisitions or one-off items rather than organic performance, apply a flat
**−15 point** penalty to the blended base score. This is a binary flag, not a
graded rubric, deliberately — the analyst has to make a real call ("is this
organic") and state it, rather than the model quietly averaging away the
distinction. A company growing 20% organically and a company growing 20%
through a string of acquisitions are not the same investment case even
though the raw growth percentile looks identical.

### P4. Momentum

| Sub-metric | Weight in P4 | Formula |
|---|---|---|
| a. Price momentum percentile (12-month return excluding the most recent month) | 60% | `priceMomentumPercentile` directly as score |
| b. Estimate-revision momentum percentile (analysts raising vs. cutting estimates) | 40% | `estimateRevisionPercentile` directly as score |

```
P4 = 0.60a + 0.40b
```

**"12-1" momentum** (12-month return, excluding the most recent month) is a
well-known convention in the academic and practitioner momentum-factor
literature (Jegadeesh & Titman, and standard in most commercial factor
models) — the most recent month is excluded specifically because short-term
reversal effects tend to work against 1-month-old momentum, muddying the
signal if included raw. This convention is cited here as an established
practice, not a Nishant invention; only the weighting of it within NESS is.

### P5. Ownership & Sentiment

| Sub-metric | Weight in P5 | Formula |
|---|---|---|
| a. Insider net-buying/selling trend (1–5 rubric, see §5) | 40% | `likertToScore(rubricValue)` |
| b. Institutional-ownership trend | 30% | Likert-mapped: decreasing→20, flat→55, increasing→85 |
| c. Short interest as % of float (inverse) | 30% | `lerp` anchors: 0%→65, 5%→60, 10%→50, 20%→35, 30%→20 |

```
P5 = 0.40a + 0.30b + 0.30c
```

**Why short interest is only a 30%-weighted sub-component of a 10%-weighted
pillar (i.e. a 3% share of the total score)**: high short interest is
*directional only*, not a clean bearish signal. Heavily-shorted names can
mean-revert hard on short squeezes, so treating short interest as a strong
standalone signal would be actively misleading. It's included because it is
real, observable information — but deliberately kept small enough that it
can nudge P5, not drive the composite score.

### P6. Risk & Red Flags (deductive — starts at 100, subtracts)

| Flag | Deduction |
|---|---|
| Leverage above sector norm (Net Debt/EBITDA vs. sector median) | `clamp((leverage − sectorMedianLeverage) × 10, 0, 25)` |
| Beneish M-Score above the standard −1.78 manipulation threshold | −25 |
| Beta elevated vs. sector median | `clamp((beta − sectorMedianBeta) × 20, 0, 15)` |
| Material pending litigation or regulatory action | −20 |

```
P6 = clamp(100 − sum(triggered deductions), 0, 100)
```

**Beneish M-Score** is Messod Beneish's real, established 1999
earnings-manipulation forensic-accounting formula — cited here as a genuine
external input, not a Nishant invention:

```
M = −4.84 + 0.920·DSRI + 0.528·GMI + 0.404·AQI + 0.892·SGI
  + 0.115·DEPI − 0.172·SGAI + 4.679·TATA − 0.327·LVGI
```

where DSRI, GMI, AQI, SGI, DEPI, SGAI, TATA, and LVGI are the eight standard
Beneish ratio inputs, each derived by the analyst from two years of financial
statements (day-sales-in-receivables index, gross-margin index, asset-quality
index, sales-growth index, depreciation index, SG&A index, total-accruals-to-
total-assets, and leverage index, respectively — see any standard
forensic-accounting reference for the individual ratio definitions). The
standard published threshold is M > −1.78 flags elevated manipulation risk;
`score.js` computes M directly from the eight ratios and applies the flat −25
deduction if that threshold is crossed.

---

## 5. Qualitative rubrics (Likert → score)

Used for P5a (insider trend) and any other 1–5 qualitative input. Anchors,
not vibes — write down which anchor description matches before picking a
number.

| Value | Score | Anchor description |
|---|---|---|
| 1 | 10 | Heavy, sustained insider selling; no offsetting buying |
| 2 | 35 | Net selling — more sellers/volume than buyers over the lookback window |
| 3 | 60 | Neutral — routine, small transactions or no meaningful signal either way |
| 4 | 80 | Net buying — more buyers/volume than sellers over the lookback window |
| 5 | 100 | Heavy, sustained insider buying, especially from multiple insiders or the CEO/CFO |

`likertToScore`: linear interpolation is fine for non-integer averages.

**Insider net-buying/selling trend (P5a)**: judge over a consistent lookback
window (90 days is a reasonable default) — count distinct insiders and
transaction value, not just transaction count, since one large CFO purchase
is a stronger signal than several small option-exercise-driven sales.

---

## 6. Confidence and missing data

Every pillar has a **required input list** (see `scripts/score.js`'s
`REQUIRED_FIELDS`). Before computing, count how many required fields across
all six pillars are missing or explicitly marked `"unknown"`.

```
completeness = 1 − (missingCount / totalRequiredFields)
```

- `completeness ≥ 0.9` → **High confidence**. Report the tier as-is.
- `0.7 ≤ completeness < 0.9` → **Medium confidence**. Report the tier with a
  note listing which pillars used estimates.
- `completeness < 0.7` → **Low confidence**. Prefix the output
  `"PRELIMINARY — insufficient data for a reliable score"` and explicitly
  recommend which data would resolve the biggest gaps first (usually: the
  percentile fields are the highest-value gaps to close, since without a
  real peer universe P1–P4 are all guesses dressed as numbers).

Never silently substitute a default value for a missing required field and
present the result as if it were measured. If a value is genuinely unknown,
pass `null` and let the completeness penalty apply — a lower-confidence real
answer beats a confident wrong one. This matters more here than in most
scoring contexts: a `*Percentile` field with no real peer universe behind it
is not "unknown," it's actively fabricated, and the algorithm has no way to
distinguish a careful percentile from an invented one — that responsibility
sits entirely with whoever populates the input.

---

## 7. Worked example

Fictional mid-cap industrial-products company, screened against a sector peer
universe of roughly 25 listed comparables. Full input is
`scripts/example-input.json` — run
`node scripts/score.js scripts/example-input.json` to reproduce these numbers
exactly (they're copied straight from that output).

- Blended valuation multiple at the 35th percentile of the peer set (i.e.
  relatively cheap)
- ROIC at the 72nd percentile, margin stability at the 68th percentile;
  Altman Z-Score inputs: working capital $150M, total assets $1,000M,
  retained earnings $300M, EBIT $120M, market value of equity $900M, total
  liabilities $600M, sales $950M
- Revenue growth at the 78th percentile, EPS growth at the 82nd percentile,
  growth judged organic (no growth-quality flag)
- Price momentum (12-1) at the 55th percentile, estimate-revision momentum
  at the 60th percentile
- Insider trend rubric = 4 (net buying), institutional ownership trend =
  increasing, short interest 3.5% of float
- Net Debt/EBITDA 2.8x vs. sector median 2.0x, beta 1.15 vs. sector median
  1.00, no material pending litigation, Beneish inputs consistent with
  normal (non-manipulator) accruals

```
P1 = 100 − 35 = 65.0

P2: Altman Z = 1.2(150/1000) + 1.4(300/1000) + 3.3(120/1000)
             + 0.6(900/600) + 1.0(950/1000)
           = 0.18 + 0.42 + 0.396 + 0.9 + 0.95 = 2.846  (grey zone)
    c = lerp(2.846, [1.81,40]→[2.99,70]) = 40 + (2.846-1.81)/(2.99-1.81)×30
      = 66.34
P2 = 0.35(72) + 0.30(68) + 0.35(66.34) = 25.2 + 20.4 + 23.22 = 68.82

P3 = 0.50(78) + 0.50(82) = 80.0   (no growth-quality penalty)

P4 = 0.60(55) + 0.40(60) = 57.0

P5: a = likert(4) = 80   b = "increasing" = 85
    c = lerp(3.5%, [0,65]→[5,60]) = 65 + (3.5/5)×(60-65) = 61.5
P5 = 0.40(80) + 0.30(85) + 0.30(61.5) = 32 + 25.5 + 18.45 = 75.95

P6: Beneish M = −4.84 + 0.92(1.05) + 0.528(1.02) + 0.404(1.01) + 0.892(1.10)
              + 0.115(1.0) − 0.172(1.0) + 4.679(0.02) − 0.327(1.0)
            = −2.24  (below −1.78 threshold → no manipulation deduction)
    leverage deduction = clamp((2.8−2.0)×10, 0, 25) = 8.0
    beta deduction = clamp((1.15−1.00)×20, 0, 15) = 3.0
P6 = 100 − 8.0 − 3.0 = 89.0

NESS = 0.20(65.0) + 0.20(68.82) + 0.20(80.0) + 0.15(57.0) + 0.10(75.95) + 0.15(89.0)
     = 13.0 + 13.76 + 16.0 + 8.55 + 7.60 + 13.35 = 72.3
```

**Result: NESS 72.3 — Attractive tier, High confidence (100% complete).**
Momentum (57.0) is the softest pillar here — the stock isn't unloved, but it
isn't attracting price or estimate momentum either, which fits a name that's
cheap and high-quality but not yet catalyzed. Valuation (65.0) and Quality
(68.8) both point the same direction: cheap relative to peers, with a genuine
quality underpinning (72nd-percentile ROIC, a grey-zone-but-solid Altman
Z-Score of 2.85). Risk (89.0) is clean aside from modestly elevated leverage
and beta versus the sector — neither large enough on its own to change the
tier, but both worth monitoring if either widens further against peers on the
next re-screen.

---

## 8. Known limitations

- **Percentile scoring is only as good as the peer universe chosen.** A
  mis-scoped, too-narrow, or stale comp set will silently bias P1–P4 in
  either direction — a "72nd percentile ROIC" means nothing if the peer set
  mixes companies from different sub-industries or growth stages. Always
  record the peer universe's composition, size, and as-of date alongside the
  score, the same discipline the NDQI (private-equity) skill applies to
  sector comps.
- **Momentum factors decay fast and need frequent re-scoring.** Unlike
  quality or balance-sheet strength, a momentum percentile computed a month
  ago can already be stale — momentum is one of the fastest-decaying,
  fastest-reversing factors in the cross-sectional literature. Treat P4 as
  perishable; don't act on a NESS run more than a few weeks old without
  refreshing at minimum the momentum and short-interest inputs.
- **Accounting-quality proxies can miss sophisticated fraud.** The Beneish
  M-Score is a real, validated forensic tool, but it is a statistical
  screen built on historical fraud cases, not a guarantee — it can miss
  novel manipulation techniques and can also false-positive on legitimate
  high-growth companies whose accruals patterns happen to resemble
  manipulator profiles. Treat an M-Score flag as "warrants a closer look,"
  not as a proven finding.
- **Factor models crowd and underperform during regime shifts.** Valuation,
  quality, growth, and momentum are real, historically durable factors, but
  they are also widely known and widely traded — during sharp regime
  shifts or factor rotations (e.g. a violent value-to-growth or
  quality-to-junk rotation), a high NESS name can underperform for an
  extended stretch precisely because it's crowded with other systematic
  strategies making the same bet. The NESS ranks a universe as of today;
  it does not know when the market's factor regime is about to change.
- **The model rewards clean, well-sourced data.** A genuinely strong
  business with an unclear or thinly-covered peer set will score lower on
  confidence, not on merit — don't conflate the two when presenting results.

## 9. Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-10 | Initial specification and reference implementation |

Any change to a weight, formula, or anchor value is a version bump with an
entry here — the whole point of a proprietary, named algorithm is that
"NESS 72" means the same thing every time it's quoted. Silent tuning defeats
that.
