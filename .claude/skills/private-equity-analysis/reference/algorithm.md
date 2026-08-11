# Nishant Deal Quality Index (NDQI) — v1.0

**Proprietary scoring methodology for private equity and growth-investment
screening, developed by Nishant Prabhakar.**

Status: v1.0 (2026-08-10). Author/owner: Nishant Prabhakar. This document is
the authoritative specification — `scripts/score.js` is a direct, literal
implementation of the formulas below. If the two ever disagree, this document
is correct and the script has a bug.

Named in the tradition of other analyst-attributed scoring models (the Altman
Z-Score, the Piotroski F-Score) — the point of putting a name on a model is
that the name becomes shorthand for a specific, checkable methodology, not a
vibe. "NDQI 74" should mean the same thing regardless of who's asking or who's
answering.

---

## 1. Purpose and positioning

The NDQI is a **screening and triage tool**, not a substitute for full diligence. It
exists to do three things quickly and consistently across a deal pipeline:

1. Convert a messy pile of deck claims, a financial model, and diligence notes into
   one comparable number.
2. Force the same six questions to get answered for every deal, in the same way,
   so two analysts scoring the same company land on the same number (±5 points).
2. Surface *which specific pillar* is weak, not just a vibe of "meh" — so the
   partner conversation is "the entry multiple is 22% above sector comps" instead
   of "I don't love it."

It is deliberately **not** a black box: every sub-score is a named, auditable
formula against a named input. If an input is unknown, the algorithm says so and
degrades its confidence rating rather than guessing silently.

**What the NDQI is not**: a valuation model, an IRR/MOIC forecaster, or a legal risk
assessment. It scores the *investment case*, not the deal's cash flows. Run a real
LBO/DCF model in parallel — the NDQI tells you whether it's worth building one.

---

## 2. Structure at a glance

Six weighted pillars, each scored 0–100, rolled into one composite:

| Pillar | Weight | What it answers |
|---|---|---|
| P1. Financial Performance & Trajectory | 25% | Is the business actually growing profitably, or just growing? |
| P2. Valuation & Deal Terms | 20% | Are we overpaying, and are we protected if we're wrong? |
| P3. Market & Competitive Position | 20% | Is there a real moat, or just a good quarter? |
| P4. Management & Governance | 15% | Do incentives point the right way, and is anyone hiding anything? |
| P5. Growth & Exit Potential | 10% | Is there a second act, and can we actually sell this later? |
| P6. Risk Factors | 10% | What's the one thing that blows this up? |

```
NDQI = 0.25·P1 + 0.20·P2 + 0.20·P3 + 0.15·P4 + 0.10·P5 + 0.10·P6
```

**Weighting rationale**: P1 and P2 together are 45% of the score by design — a
great business bought at a bad price and a mediocre business bought at a great
price both eventually work; a mediocre business bought at a bad price never does.
Financial trajectory and entry terms are the two variables with the most evidence
behind them (they're in the model), so they get the most weight. Qualitative
pillars (P3, P4, P5) are real but softer, so they're weighted lower individually —
though at 45% combined they still dominate the softer half of the score, which is
intentional: moat, management, and optionality are what turn a good entry price
into a great outcome five years out.

---

## 3. Score bands

| NDQI | Tier | Action |
|---|---|---|
| 80–100 | **Strong** | Pursue aggressively; fast-track to IC |
| 65–79 | **Attractive** | Proceed to deep diligence |
| 50–64 | **Conditional** | Proceed only with specific risk mitigants identified in P6 |
| 35–49 | **Weak** | Pass unless terms improve materially (re-run P2 at a lower entry multiple to see what price would clear 65) |
| 0–34 | **Pass** | Decline |

These bands assume **high confidence** inputs (see §6). Under low confidence, treat
the tier as directional only and widen the band by ±10 points in your head before
acting on it.

---

## 4. Pillar formulas

All sub-scores are clamped to `[0, 100]` after computation unless stated otherwise.
`clamp(x, lo, hi)` = min(max(x, lo), hi). `lerp` = piecewise-linear interpolation
between named anchor points.

### P1. Financial Performance & Trajectory

| Sub-metric | Weight in P1 | Formula |
|---|---|---|
| a. Revenue CAGR (3yr historical) | 35% | `lerp` anchors: ≤0%→10, 5%→40, 15%→75, 30%→95, ≥45%→100 |
| b. EBITDA margin vs. sector median | 25% | `clamp(50 + (companyMargin − sectorMedianMargin) × 2, 0, 100)` |
| c. Margin trend (pts/year, 3yr) | 15% | `clamp(50 + marginTrendPtsPerYear × 10, 0, 100)` |
| d. Revenue quality (% recurring/contracted) | 15% | `recurringPct` directly as score; `+10` bonus (cap 100) if avg. contract length > 2 years |
| e. Cash conversion (FCF / EBITDA) | 10% | `clamp(ratio × 100, 0, 100)`; **hard cap at 30** if FCF is negative while EBITDA is positive (working-capital red flag) |

```
P1 = 0.35a + 0.25b + 0.15c + 0.15d + 0.10e
```

**Hypergrowth guard**: if (a) implies CAGR ≥ 60% but fewer than 2 full fiscal years
of data support it, cap the *effective* contribution of (a) at 80 regardless of the
raw lerp result, and flag `"unverified_hypergrowth"` in the output. Extraordinary
growth claims need extraordinary evidence; two data points isn't a trend.

### P2. Valuation & Deal Terms

| Sub-metric | Weight in P2 | Formula |
|---|---|---|
| a. Entry multiple vs. sector comp median | 50% | `premiumPct = (dealMultiple − sectorMedianMultiple) / sectorMedianMultiple`; `clamp(70 − premiumPct × 100, 0, 100)` |
| b. Leverage vs. sector norm (Net Debt/EBITDA) | 30% | `clamp(100 − max(0, leverage − sectorMedianLeverage) × 15, 0, 100)` |
| c. Structural protections (1–5 rubric, see §5) | 20% | `likertToScore(rubricValue)` |

```
P2 = 0.50a + 0.30b + 0.20c
```

**Why 70, not 100, is the baseline for (a)**: paying exactly the sector median
multiple is *fair*, not *good* — it earns a passing-but-unremarkable score. Every
10% paid above median costs 10 points; every 10% below median earns 10 points. This
is intentionally the steepest lever in the whole model, because entry price is the
single most controllable driver of realized IRR.

### P3. Market & Competitive Position

| Sub-metric | Weight in P3 | Formula |
|---|---|---|
| a. TAM forecast growth rate | 30% | `lerp` anchors: ≤0%→20, 5%→50, 10%→70, 20%→90, ≥30%→100 |
| b. Relative market-share trend | 30% | Likert: losing materially→10, losing slightly→35, flat→60, gaining slightly→80, gaining materially→100 |
| c. Competitive moat (avg. of 4 sub-ratings, see §5) | 40% | `likertToScore(average(switchingCosts, ip, networkEffects, brandOrRegulatory))` |

```
P3 = 0.30a + 0.30b + 0.40c
```

### P4. Management & Governance

| Sub-metric | Weight in P4 | Formula |
|---|---|---|
| a. Team track record | 40% | Rubric: 0 exits & <2yr tenure→30; 0 exits & 2–5yr→50; 1 exit *or* 5yr+→70; 2+ exits→95 |
| b. Insider ownership post-deal | 30% | `lerp` anchors: <5%→30, 15%→60, 30%→85, ≥45%→100 |
| c. Governance red flags | 30% | Start at 100; `−15` per confirmed flag (related-party transactions, audit qualification, unresolved litigation, key-person risk w/o succession plan); floor 0 |

```
P4 = 0.40a + 0.30b + 0.30c
```

### P5. Growth & Exit Potential

| Sub-metric | Weight in P5 | Formula |
|---|---|---|
| a. Expansion optionality (count of *evidenced* levers: new geography, new product line, active M&A pipeline, demonstrated pricing power) | 60% | 0 levers→20, 1→45, 2→70, ≥3→90 |
| b. Exit path clarity (1–5 rubric, see §5) | 40% | `likertToScore(rubricValue)` |

```
P5 = 0.60a + 0.40b
```

"Evidenced" in (a) means named and substantiated in the deck/model/diligence
notes — "international expansion" with no market entry plan does not count as a
lever; it counts as a slide.

### P6. Risk Factors (deductive — starts at 100, subtracts)

| Flag | Deduction |
|---|---|
| Top-1 customer > 20% of revenue | −20 |
| Top-3 customers > 50% of revenue (additional, stacks with above) | −15 |
| Material unresolved regulatory/litigation exposure | −20 |
| Key-person dependency with no succession plan or non-compete | −15 |
| High cyclicality (revenue materially correlated to GDP/commodity cycles) | −15 |
| Meaningful FX or single-geography concentration | −10 |

```
P6 = clamp(100 − sum(triggered deductions), 0, 100)
```

---

## 5. Qualitative rubrics (Likert → score)

Used for P2c, P3c, P5b, and any other 1–5 qualitative input. Anchors, not vibes —
write down which anchor description matches before picking a number.

| Value | Score | Anchor description |
|---|---|---|
| 1 | 10 | Absent / actively concerning |
| 2 | 35 | Weak — present but thin, easily challenged |
| 3 | 60 | Adequate — defensible, industry-standard |
| 4 | 80 | Strong — clearly above peer set |
| 5 | 100 | Exceptional — a genuine, hard-to-replicate advantage |

`likertToScore`: linear interpolation is fine for non-integer averages (e.g. a
competitive-moat average of 3.5 → score 70).

**Competitive moat sub-ratings (P3c)** — rate each 1–5 independently, then average:
- *Switching costs*: how painful is it for a customer to leave?
- *IP / technical differentiation*: patents, proprietary data, or hard-to-replicate tech?
- *Network effects*: does the product get better as more people use it?
- *Brand or regulatory barrier*: does brand trust or a license/regulatory moat block new entrants?

**Structural protections (P2c)**: liquidation preference seniority, covenant
strength, board control/veto rights, anti-dilution provisions — rate the package
as a whole against what's market-standard for the deal's stage and size.

**Exit path clarity (P5b)**: are there ≥2 credible, named acquirer types or a
precedent IPO/transaction in the sector within the last 3 years?

---

## 6. Confidence and missing data

Every pillar has a **required input list** (see `scripts/score.js`'s
`REQUIRED_FIELDS`). Before computing, count how many required fields across all
six pillars are missing or explicitly marked `"unknown"`.

```
completeness = 1 − (missingCount / totalRequiredFields)
```

- `completeness ≥ 0.9` → **High confidence**. Report the tier as-is.
- `0.7 ≤ completeness < 0.9` → **Medium confidence**. Report the tier with a note
  listing which pillars used estimates.
- `completeness < 0.7` → **Low confidence**. Prefix the output
  `"PRELIMINARY — insufficient data for a reliable score"` and explicitly
  recommend which documents/data would resolve the biggest gaps first (usually:
  a real financial model beats a deck every time — prioritize closing financial
  gaps over qualitative ones).

Never silently substitute a default value for a missing required field and present
the result as if it were measured. If a value is genuinely unknown, pass `null` and
let the completeness penalty apply — a lower-confidence real answer beats a
confident wrong one.

---

## 7. Worked example

Mid-market SaaS company, control buyout. Full input is
`scripts/example-input.json` — run `node scripts/score.js scripts/example-input.json`
to reproduce these numbers exactly (they're copied straight from that output).

- Revenue CAGR 22%, EBITDA margin 18% vs. sector median 15%, margin trend +1.5pt/yr,
  78% recurring revenue with avg. 2.3yr contracts, FCF/EBITDA 0.65
- Entry multiple 11.5x EV/EBITDA vs. sector median 10.2x, Net Debt/EBITDA 3.5x vs.
  sector median 3.0x, structural protections rubric = 3
- TAM growth 12%, gaining share slightly, moat sub-ratings [3, 2, 2, 4] → avg 2.75
- Team: 1 prior exit, tenure 6yr, insider ownership post-deal 22%, one governance
  flag (no succession plan for founder-CEO)
- 2 evidenced expansion levers, exit path clarity rubric = 4
- Risk flags: none triggered

```
P1: a = lerp(22%, [15,75]→[30,95]) = 75 + (22-15)/(30-15)×20 = 84.3
    b = 50 + (18-15)×2 = 56
    c = 50 + 1.5×10 = 65
    d = 78, +10 contract-length bonus (2.3yr > 2yr) = 88
    e = 0.65×100 = 65
P1 = 0.35(84.3) + 0.25(56) + 0.15(65) + 0.15(88) + 0.10(65) = 73.0

P2: premiumPct = (11.5-10.2)/10.2 = 0.1275 → a = 70 - 12.75 = 57.3
    b = 100 - max(0, 3.5-3.0)×15 = 92.5
    c = likert(3) = 60
P2 = 0.50(57.3) + 0.30(92.5) + 0.20(60) = 68.4

P3: a = lerp(12%, [10,70]→[20,90]) = 70 + (12-10)/(20-10)×20 = 74
    b = "gaining_slightly" = 80
    moat avg = (3+2+2+4)/4 = 2.75 → c = likert(2.75) = 35 + 0.75×25 = 53.8
P3 = 0.30(74) + 0.30(80) + 0.40(53.8) = 67.7

P4: a = 70 (1 prior exit; tenure 6yr also independently qualifies for 70)
    b = lerp(22%, [15,60]→[30,85]) = 60 + (22-15)/(30-15)×25 = 71.7
    c = 100 - 1×15 = 85 (one governance flag)
P4 = 0.40(70) + 0.30(71.7) + 0.30(85) = 75.0

P5: a = 2 levers = 70   b = likert(4) = 80
P5 = 0.60(70) + 0.40(80) = 74.0

P6 = 100 (no risk flags triggered)

NDQI = 0.25(73.0) + 0.20(68.4) + 0.20(67.7) + 0.15(75.0) + 0.10(74.0) + 0.10(100)
    = 18.2 + 13.7 + 13.5 + 11.3 + 7.4 + 10.0 = 74.1
```

**Result: NDQI 74.1 — Attractive tier.** Proceed to deep diligence, with particular
attention to succession planning (the one governance flag) and to whether the
11.5x entry multiple has room to move — P2 (68.4) and P3 (67.7) are the two
pillars with the most room to improve the score further; re-underwriting at a
10.5x entry, for instance, would lift P2's entry-multiple sub-score from 57.3 to
roughly 67 and the overall NDQI by about a point and a half.

---

## 8. Known limitations

- **Sector comps must be sourced and dated.** "Sector median multiple" is only as
  good as the comp set behind it — a stale or mis-scoped comp set will silently
  bias P2 in either direction. Always record the comp set's source and as-of date
  alongside the score.
- **Qualitative rubrics are analyst-dependent.** Two analysts can legitimately
  land one Likert point apart. Mitigate by having a second reviewer score P3c/P2c/P5b
  independently on contested deals and averaging.
- **Not sector-agnostic in practice.** The anchor values (growth-rate bands,
  margin baselines) are tuned for a generalist mid-market lens. A deep-tech or
  biotech deal with pre-revenue economics will misscore on P1 almost by
  definition — for pre-revenue deals, treat P1 as directional only and weight P3
  (market) and P4 (team) more heavily in the qualitative read-through.
- **The model rewards clean data.** A great business with messy books will score
  lower on confidence, not on merit — don't conflate the two when presenting results.

## 9. Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-10 | Initial specification and reference implementation |

Any change to a weight, formula, or anchor value is a version bump with an entry
here — the whole point of a proprietary, named algorithm is that "NDQI 73" means
the same thing every time it's quoted. Silent tuning defeats that.
