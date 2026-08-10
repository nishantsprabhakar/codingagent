# Prabhakar Real Estate Investment Score (PREIS) — v1.0

**Proprietary scoring methodology for commercial real estate acquisition
screening, developed by Nishant Prabhakar.**

Status: v1.0 (2026-08-10). Author/owner: Nishant Prabhakar. This document is
the authoritative specification — `scripts/score.js` is a direct, literal
implementation of the formulas below. If the two ever disagree, this document
is correct and the script has a bug.

Named in the tradition of other analyst-attributed scoring models (the Altman
Z-Score, the Piotroski F-Score) — the point of putting a name on a model is
that the name becomes shorthand for a specific, checkable methodology, not a
vibe. "PREIS 77" should mean the same thing regardless of who's asking or who's
answering.

---

## 1. Purpose and positioning

The PREIS is a **screening and triage tool**, not an appraisal. It exists to do
three things quickly and consistently across a deal pipeline:

1. Convert an offering memorandum, rent roll, comp set, and diligence notes into
   one comparable number.
2. Force the same six questions to get answered for every acquisition target, in
   the same way, so two analysts scoring the same property land on the same
   number (±5 points).
3. Surface *which specific pillar* is weak, not just a vibe of "meh" — so the
   investment-committee conversation is "the submarket has a 9% supply pipeline
   against existing stock" instead of "I don't love the location."

It is deliberately **not** a black box: every sub-score is a named, auditable
formula against a named input. If an input is unknown, the algorithm says so and
degrades its confidence rating rather than guessing silently.

**What the PREIS is not**: an appraisal, a substitute for a real third-party
valuation, or a substitute for a physical property condition inspection. It
scores the *acquisition case* relative to comps and submarket data, not the
building's true fair value or its actual structural condition. Commission a real
appraisal and a property condition report in parallel — the PREIS tells you
whether it's worth commissioning them.

---

## 2. Structure at a glance

Six weighted pillars, each scored 0–100, rolled into one composite:

| Pillar | Weight | What it answers |
|---|---|---|
| P1. Income Quality | 25% | Is the in-place income priced right, occupied, and durable? |
| P2. Growth Potential | 20% | Is there real upside in NOI and rents, or is this already fully priced? |
| P3. Location & Market | 20% | Is the submarket tightening or about to get flooded with new supply? |
| P4. Physical Asset Quality | 15% | What condition is the building actually in, and what does that cost to fix? |
| P5. Deal Structure & Leverage | 10% | Is the financing sound, or does it turn a good asset into a bad deal? |
| P6. Exit / Liquidity Risk | 10% | Can we actually sell this later, and did we underwrite the exit honestly? |

```
PREIS = 0.25·P1 + 0.20·P2 + 0.20·P3 + 0.15·P4 + 0.10·P5 + 0.10·P6
```

**Weighting rationale**: P1 and P2 together are 45% of the score by design — a
great building bought at a bad basis and a mediocre building bought at a great
basis both eventually work; a mediocre building bought at a bad basis never does.
In-place income quality and growth potential are the two variables with the most
evidence behind them (they're in the rent roll and the trailing financials), so
they get the most weight. P3 (location/market) is weighted equally with P2
because submarket supply and demand dynamics are the biggest swing factor on
whether growth potential is realized. The remaining pillars — physical condition,
deal structure, and exit/liquidity risk — are real but more bounded in how much
they can move the outcome on their own, so they're weighted lower individually,
though at 35% combined they still meaningfully shape whether a good basis in a
good submarket actually converts into a good realized return.

---

## 3. Score bands / tiers

| PREIS | Tier | Action |
|---|---|---|
| 80–100 | **Core** | Pursue aggressively |
| 65–79 | **Core-plus** | Attractive |
| 50–64 | **Value-add** | Proceed with plan |
| 35–49 | **Opportunistic/high-risk** | Proceed only with strong mitigants |
| 0–34 | **Pass** | Decline |

These bands assume **high confidence** inputs (see §6). Under low confidence, treat
the tier as directional only and widen the band by ±10 points in your head before
acting on it.

---

## 4. Pillar formulas

All sub-scores are clamped to `[0, 100]` after computation unless stated otherwise.
`clamp(x, lo, hi)` = min(max(x, lo), hi). `lerp` = piecewise-linear interpolation
between named anchor points.

### P1. Income Quality

| Sub-metric | Weight in P1 | Formula |
|---|---|---|
| a. Going-in cap rate vs. submarket comp median | 35% | `spreadPct = (dealCapRate − compMedianCapRate) / compMedianCapRate`; `clamp(70 + spreadPct × 100, 0, 100)` |
| b. Occupancy rate | 40% | `lerp` anchors: 60%→20, 80%→50, 92%→85, 100%→100 |
| c. WALE (Weighted Average Lease Expiry, years) blended with tenant credit quality | 25% | `0.7 × lerp(waleYears, [0→20, 2→45, 5→75, 8→92, 12→100]) + 0.3 × likertToScore(tenantCreditQualityRubric)` |

```
P1 = 0.35a + 0.40b + 0.25c
```

**Why 70, not 100, is the baseline for (a)**: buying at exactly the submarket
comp median cap rate is *fair*, not *good* — it earns a passing-but-unremarkable
score. Every 10% relative widening above the comp median (i.e. buying cheaper
relative to income) earns 10 points; every 10% tightening below the comp median
(paying up relative to income) costs 10 points. A wider cap rate than comps means
paying less per dollar of NOI — this is intentionally the steepest lever in P1,
because going-in basis relative to comps is the single most controllable driver
of realized yield.

**WALE as a standard underwriting metric**: Weighted Average Lease Expiry is a
real, standard commercial real estate underwriting figure — the tenant-weighted
average number of years remaining across all leases in the building. Longer WALE
with credit-quality tenants means more durable, predictable income and less
near-term re-leasing risk, which is why it carries real weight in P1 rather than
being treated as a footnote.

### P2. Growth Potential

| Sub-metric | Weight in P2 | Formula |
|---|---|---|
| a. NOI growth trend (trailing 2–3yr, avg annual %) | 55% | `lerp` anchors: ≤0%→20, 3%→50, 6%→75, 10%→90, ≥15%→100 |
| b. Mark-to-market rent upside | 45% | `gapPct = (marketRentPsf − inPlaceRentPsf) / inPlaceRentPsf × 100`; `lerp` anchors: −10%→30, 0%→50, 10%→70, 25%→90, 40%→97 |

```
P2 = 0.55a + 0.45b
```

**Mark-to-market as a standard value-add lever**: the gap between current
in-place rent and current market rent for comparable space is a real, standard
value-add underwriting lever — a positive gap means upside as leases roll to
market. But the formula deliberately does not let an implausibly large gap buy
an unlimited score.

**Extreme-gap guard**: if `gapPct > 35`, cap the *effective* contribution of (b)
at 80 regardless of the raw `lerp` result, and flag `"implausible_mark_to_market_gap"`
in the output. A very large in-place-to-market gap can also mean the current
tenants are significantly underpriced and at real risk of pushback, non-renewal,
or requiring costly retention concessions — the gap is a risk signal as much as
an opportunity signal once it gets extreme, so the model refuses to reward it
without qualification.

### P3. Location & Market

| Sub-metric | Weight in P3 | Formula |
|---|---|---|
| a. Submarket vacancy rate trend (pts/year) | 35% | `lerp` anchors: −3→95, −1→80, 0→60, 1→40, 3→15 |
| b. Local population/job growth rate | 30% | `lerp` anchors: −1%→20, 0%→40, 1.5%→65, 3%→85, 5%→100 |
| c. New-supply pipeline as % of existing submarket stock | 35% | `lerp` anchors: 0%→95, 3%→80, 6%→55, 10%→30, 15%→10 |

```
P3 = 0.35a + 0.30b + 0.35c
```

Falling submarket vacancy (a negative trend) scores higher — demand is
outpacing supply. A large new-supply pipeline relative to existing stock is a
real, standard oversupply risk flag in CRE underwriting: it can compress rent
growth and stall lease-up regardless of how strong current fundamentals look, so
it is weighted equally with vacancy trend rather than treated as secondary.

### P4. Physical Asset Quality

| Sub-metric | Weight in P4 | Formula |
|---|---|---|
| a. Building class/age rubric (1–5, see §5) | 45% | `likertToScore(buildingClassRubric)` |
| b. Deferred capex needs as % of purchase price | 40% | `lerp` anchors: 0%→100, 2%→85, 5%→60, 10%→30, 20%→5 |
| c. Energy-efficiency / ESG rating modifier | 15% | `"certified"→90, "partial"→65, "none"→50` |

```
P4 = 0.45a + 0.40b + 0.15c
```

Deferred-capex-needs-as-percentage-of-purchase-price is a real, standard CRE
diligence metric — it's the direct dollar cost of catching a building up to
where its class rating implies it should be. The ESG/energy-efficiency modifier
is deliberately weighted lowest in P4: it's a real and growing factor in
institutional capital preference and running utility costs, but it's a modifier
on top of class and capex condition, not a substitute for them.

### P5. Deal Structure & Leverage

| Sub-metric | Weight in P5 | Formula |
|---|---|---|
| a. Loan-to-Value (LTV) ratio | 35% | `lerp` anchors: 45%→100, 55%→85, 65%→65, 70%→50, 80%→25, 90%→5 |
| b. Debt yield (NOI / loan amount) | 35% | `debtYieldPct = noiUSD / loanAmountUSD × 100`; `lerp` anchors: 5%→15, 8%→40, 9%→60, 10%→80, 12%→95, 15%→100 |
| c. Going-in cap rate minus cost of debt (spread, pts) | 30% | `spreadPts = goingInCapRate − costOfDebtPct`; `lerp` anchors: −2→10, 0→30, 1→55, 2→75, 3→90, 4→100 |

```
P5 = 0.35a + 0.35b + 0.30c
```

Debt yield is a real, standard CRE lending metric lenders themselves underwrite
to — below roughly 8% is considered thin/risky, above roughly 10% is considered
comfortable, independent of LTV. A positive, wide spread between going-in cap
rate and cost of debt indicates healthy leveraged-return potential; a negative or
thin spread means leverage is working against the deal, not for it.

### P6. Exit / Liquidity Risk

| Sub-metric | Weight in P6 | Formula |
|---|---|---|
| a. Asset-class liquidity rubric (1–5, see §5) | 55% | `likertToScore(assetClassLiquidityRubric)` |
| b. Projected exit cap-rate expansion risk (bps, exit minus going-in) | 45% | `lerp` anchors: −100→20, −50→40, 0→65, 50→85, 100→95, 150→100 |

```
P6 = 0.55a + 0.45b
```

**Why underwriting conservatism scores better, not optimism**: (b) is deliberately
inverted from what might feel intuitive. Underwriting *no* cap-rate movement by
exit scores a middling 65; underwriting *cap-rate expansion* (a more conservative,
more defensible assumption that exit pricing will be tighter for the buyer than
for you) scores progressively higher. Underwriting cap-rate *compression* — betting
the market gets more expensive by the time you sell — scores progressively lower,
because it is the underwriting assumption most likely to be wrong in a rate
downturn and the one an IC reviewer should be most skeptical of. This rewards the
analyst who underwrites the exit conservatively over the analyst who underwrites
the exit optimistically, even though both are theoretically "just an assumption."

---

## 5. Qualitative rubrics (1–5 Likert → score)

Used for P1c (tenant credit quality), P4a (building class/age), and P6a (asset-class
liquidity). Anchors, not vibes — write down which anchor description matches
before picking a number.

| Value | Score | Anchor description |
|---|---|---|
| 1 | 10 | Absent / actively concerning |
| 2 | 35 | Weak — present but thin, easily challenged |
| 3 | 60 | Adequate — defensible, market-standard |
| 4 | 80 | Strong — clearly above peer set |
| 5 | 100 | Exceptional — a genuine, hard-to-replicate advantage |

`likertToScore`: linear interpolation is fine for non-integer averages (e.g. a
tenant credit quality average of 3.5 → score 70).

**Tenant credit quality (P1c)**: rate the WALE-weighted tenant roster as a whole —
5 = investment-grade/national credit tenants dominate the rent roll; 3 = a mix of
regional/local tenants with adequate but unverified financials; 1 = mostly unrated
tenants with visible payment or renewal risk.

**Building class/age rubric (P4a)**: 5 = Class A, newer construction (built or
fully renovated within roughly the last 10–15 years), minimal deferred
maintenance; 3 = Class B, functional but showing its age, moderate deferred
items; 1 = Class C, older construction with material deferred capex and
functional obsolescence relative to the current tenant market.

**Asset-class liquidity rubric (P6a)**: 5 = core asset type (multifamily,
industrial/logistics) in a gateway or top-tier metro with deep institutional buyer
demand; 3 = a solid asset type in a secondary market with an adequate but thinner
buyer pool; 1 = a niche, single-tenant, special-purpose asset (e.g. a build-to-suit
call center or a specialized manufacturing facility) in a tertiary market with few
natural buyers if the current use ends.

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
  a real rent roll and trailing operating statements beat an offering memorandum's
  pro forma every time — prioritize closing income/leasing gaps over qualitative
  ones).

Never silently substitute a default value for a missing required field and present
the result as if it were measured. If a value is genuinely unknown, pass `null` and
let the completeness penalty apply — a lower-confidence real answer beats a
confident wrong one.

---

## 7. Worked example

Class A single-tenant industrial/logistics acquisition. Full input is
`scripts/example-input.json` — run `node scripts/score.js scripts/example-input.json`
to reproduce these numbers exactly (they're copied straight from that output).

- Going-in cap rate 6.25% vs. submarket median 5.75%, occupancy 96%, WALE 6.5
  years with tenant credit quality rubric = 4
- NOI growth trend +4.2%/yr, in-place rent $5.10/SF vs. market rent $6.25/SF
- Submarket vacancy trend −0.8pt/yr, population/job growth 2.1%, new-supply
  pipeline 4.5% of existing stock
- Building class rubric = 4, deferred capex 1.2% of purchase price, ESG rating
  "certified"
- LTV 62%, NOI $3,750,000 on a $40,000,000 loan, going-in cap rate 6.25% vs.
  cost of debt 5.1%
- Asset-class liquidity rubric = 4, underwritten exit cap-rate expansion +25bps

```
P1: a = 70 + (6.25-5.75)/5.75×100 = 70 + 8.696 = 78.7
    b = lerp(96, [92→85, 100→100]) = 85 + (96-92)/8×15 = 92.5
    waleLerp = lerp(6.5, [5→75, 8→92]) = 75 + (6.5-5)/3×17 = 83.5
    c = 0.7(83.5) + 0.3(likert(4)=80) = 58.45 + 24.0 = 82.45
P1 = 0.35(78.7) + 0.40(92.5) + 0.25(82.45) = 27.5 + 37.0 + 20.6 = 85.2

P2: a = lerp(4.2, [3→50, 6→75]) = 50 + (4.2-3)/3×25 = 60.0
    gapPct = (6.25-5.10)/5.10×100 = 22.55%
    b = lerp(22.55, [10→70, 25→90]) = 70 + (22.55-10)/15×20 = 86.7 (no cap; gap ≤ 35)
P2 = 0.55(60.0) + 0.45(86.7) = 33.0 + 39.0 = 72.0

P3: a = lerp(-0.8, [-1→80, 0→60]) = 80 + (-0.8-(-1))/1×(-20) = 76.0
    b = lerp(2.1, [1.5→65, 3→85]) = 65 + (2.1-1.5)/1.5×20 = 73.0
    c = lerp(4.5, [3→80, 6→55]) = 80 + (4.5-3)/3×(-25) = 67.5
P3 = 0.35(76.0) + 0.30(73.0) + 0.35(67.5) = 26.6 + 21.9 + 23.6 = 72.1

P4: a = likert(4) = 80
    b = lerp(1.2, [0→100, 2→85]) = 100 + (1.2/2)×(-15) = 91.0
    c = "certified" = 90
P4 = 0.45(80) + 0.40(91.0) + 0.15(90) = 36.0 + 36.4 + 13.5 = 85.9

P5: a = lerp(62, [55→85, 65→65]) = 85 + (62-55)/10×(-20) = 71.0
    debtYieldPct = 3,750,000/40,000,000×100 = 9.375%
    b = lerp(9.375, [9→60, 10→80]) = 60 + 0.375×20 = 67.5
    spreadPts = 6.25 - 5.1 = 1.15
    c = lerp(1.15, [1→55, 2→75]) = 55 + 0.15×20 = 58.0
P5 = 0.35(71.0) + 0.35(67.5) + 0.30(58.0) = 24.85 + 23.6 + 17.4 = 65.9

P6: a = likert(4) = 80
    b = lerp(25, [0→65, 50→85]) = 65 + (25/50)×20 = 75.0
P6 = 0.55(80) + 0.45(75.0) = 44.0 + 33.75 = 77.8

PREIS = 0.25(85.2) + 0.20(72.0) + 0.20(72.1) + 0.15(85.9) + 0.10(65.9) + 0.10(77.8)
     = 21.3 + 14.4 + 14.4 + 12.9 + 6.6 + 7.8 = 77.4
```

**Result: PREIS 77.4 — Core-plus tier.** Attractive; proceed toward deep
diligence. The two pillars doing the most work here are P4 (physical asset
quality, 85.9 — a well-maintained Class A box with light deferred capex and an
efficiency certification) and P1 (income quality, 85.2 — a wide cap-rate spread
to comps with strong occupancy and a long, credit-tenant WALE). The pillar with
the most room to improve is P5 (deal structure & leverage, 65.9) — the 62% LTV
and 9.4% debt yield are adequate but unremarkable; tightening leverage toward
55% LTV would meaningfully lift P5a and the spread sub-score, and would be worth
re-running through `score.js` before going to committee.

---

## 8. Known limitations

- **Cap rates and comps are only as good as the comp set's recency and
  relevance.** "Submarket median cap rate" is only as reliable as the comps
  behind it — a stale comp set (trades more than 6–12 months old) or one that
  mixes asset subtypes will silently bias P1a and, indirectly, the perceived
  quality of the whole deal. Always record the comp set's source, size, and
  as-of date alongside the score.
- **The model does not independently verify physical condition or environmental
  issues.** P4 scores what a property condition report (PCR) and Phase I
  environmental assessment actually disclose — it cannot catch what those
  reports missed or what wasn't commissioned. A clean P4 score on an unordered
  PCR is not the same thing as a clean building.
- **Submarket supply-pipeline data can lag real construction starts.**
  Published pipeline figures (permits, announced projects) can run months behind
  what's actually breaking ground, especially in fast-moving industrial and
  multifamily submarkets — treat P3c as directional and cross-check against a
  recent local brokerage supply report before leaning on it heavily.
- **Interest-rate regime shifts can move going-in vs. exit cap-rate spreads
  faster than the model's inputs get refreshed.** P5c and P6b are only as good
  as the cost-of-debt and exit cap-rate assumptions typed into the input — in a
  fast-moving rate environment, a spread that looked healthy when the model was
  last run can be stale within weeks. Re-run the score against current rate
  quotes before an IC decision, not just at initial screening.
- **Qualitative rubrics are analyst-dependent.** Two analysts can legitimately
  land one Likert point apart on tenant credit quality, building class, or
  asset-class liquidity. Mitigate by having a second reviewer score P1c/P4a/P6a
  independently on contested deals and averaging.
- **Not asset-type-agnostic in practice.** The anchor values (WALE bands,
  occupancy stabilization thresholds) are tuned for a multi-tenant commercial
  lens (office, industrial, retail). A multifamily deal with typically short,
  1-year lease terms will misscore on P1c almost by definition — for
  multifamily, treat the WALE sub-metric as largely uninformative and weight
  occupancy and rent-growth trend more heavily in the qualitative read-through.

---

## 9. Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-10 | Initial specification and reference implementation |

Any change to a weight, formula, or anchor value is a version bump with an entry
here — the whole point of a proprietary, named algorithm is that "PREIS 77" means
the same thing every time it's quoted. Silent tuning defeats that.
