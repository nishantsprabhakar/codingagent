# Prabhakar India Macro Regime Index (PIMRI) — v1.0

**Proprietary macro-regime classification methodology for the Indian economy,
developed by Nishant Prabhakar.**

Status: v1.0 (2026-08-10). Author/owner: Nishant Prabhakar. This document is
the authoritative specification — `scripts/score.js` is a direct, literal
implementation of the formulas below. If the two ever disagree, this document
is correct and the script has a bug.

Named in the tradition of established macro composite indices — the Chicago
Fed National Activity Index, the OECD Composite Leading Indicators — where the
point of a named, published methodology is that it becomes a fixed reference
point across time: "PIMRI 84" or "PIMRI in Slowdown/Caution" should mean the
same thing in Q1 as it does in Q4, regardless of who ran the numbers. A macro
narrative built from scratch every quarter drifts with whoever's telling it;
a named composite doesn't.

---

## 1. Purpose and positioning

The PIMRI classifies India's macro cycle into one of five named **regimes**,
not just a score, so that a portfolio conversation can move directly from
"where are we in the cycle" to "what should that mean for the book" — asset
allocation tilts are attached to each regime for exactly this reason (see §3).

It exists to do three things quickly and consistently, quarter over quarter:

1. Convert scattered official releases (GDP, IIP, CPI, PMI, RBI data, CGA
   fiscal data, FPI/FDI flows) into one comparable composite and one named
   regime label.
2. Force the same six questions — growth, inflation/policy, external
   balance, fiscal position, credit/liquidity, capital flows — to get
   answered the same way every quarter, so two readings of the same quarter
   land on the same regime.
3. Attach a concrete, actionable asset-allocation tilt to the regime, not
   just a diagnosis — "Slowdown/Caution" should tell a reader what to trim,
   not just that things are slowing.

It is deliberately **not** a black box: every sub-score is a named, auditable
formula against a named, sourced input. If an input is unknown, the algorithm
says so and degrades its confidence rating rather than guessing silently.

**What the PIMRI is not:**

- **Not a GDP forecast model.** It classifies the *current* reading of the
  cycle using data already released; it does not project next quarter's
  growth number.
- **Not a market-timing signal on its own.** A regime label describes the
  macro backdrop, not an entry/exit trigger for any specific trade. Equity
  and rate markets frequently move on expectations well before an official
  release confirms a regime shift — use PIMRI to frame the macro backdrop
  behind a decision, not as the decision rule itself.
- **Not a substitute for reading the actual release notes.** GDP and IIP
  data in particular carry base-effect and revision noise that a single
  composite number cannot fully strip out (see §8).

---

## 2. Structure at a glance

Six weighted pillars, each scored 0–100, rolled into one composite:

| Pillar | Weight | What it answers |
|---|---|---|
| P1. Growth Momentum | 25% | Is the real economy actually accelerating, or just printing a favorable base effect? |
| P2. Inflation & Monetary Stance | 20% | Is inflation near target and is policy calibrated for it, or fighting the wrong battle? |
| P3. External Sector Health | 20% | Is India's external position resilient to a global shock, or exposed? |
| P4. Fiscal Health | 15% | Is the deficit on the glide path, and is it buying growth or just financing consumption? |
| P5. Credit & Liquidity | 10% | Is credit flowing at a healthy pace, or is the system either starved or overheating? |
| P6. Capital Flows & Market Confidence | 10% | Is global capital voting for India right now? |

```
PIMRI = 0.25·P1 + 0.20·P2 + 0.20·P3 + 0.15·P4 + 0.10·P5 + 0.10·P6
```

**Weighting rationale**: P1 and P2 together are 45% of the score by design —
growth momentum and the inflation/policy backdrop are the two variables that
most directly drive the regime a business cycle is actually in, and both are
released frequently enough (monthly PMI/CPI/IIP, quarterly GDP) to keep the
composite current. External and fiscal health (35% combined) are the
structural buffers that determine how much room policy has to respond to a
shock — real but slower-moving, so weighted meaningfully but below the
current-cycle pillars. Credit/liquidity and capital flows (20% combined) are
faster-moving but noisier month to month, so they're weighted lowest
individually even though a sharp move in either can flip a regime call
quickly — which is why they're still tracked every quarter rather than
dropped.

---

## 3. Regime classification and asset-allocation tilts

| PIMRI | Regime | Asset-allocation tilt |
|---|---|---|
| 80–100 | **Expansion / Goldilocks** | Overweight equities, tilt toward cyclicals and small/mid-caps; risk-on across the book. |
| 65–79 | **Moderate Growth / Balanced Expansion** | Balanced allocation with a modest equity overweight; favor quality large-caps over high-beta names. |
| 50–64 | **Slowdown / Caution** | Trim cyclicals and small-caps, rotate toward quality large-caps and defensive sectors (IT, pharma, FMCG), raise cash buffer. |
| 30–49 | **Stress / Contraction** | Underweight equities; overweight defensives, duration (long-dated G-secs), and gold. |
| 0–29 | **Crisis / Deep Contraction** | Capital preservation: maximum defensive posture — gold, cash, and sovereign duration overweight; minimal equity exposure; consider INR hedges on residual foreign-asset exposure. |

These bands assume **high confidence** inputs (see §6). Under low confidence,
treat the regime as directional only and check whether the composite sits
within 8 points of a band edge before committing to the tilt on that basis
alone — a score of 63 on Medium confidence is not meaningfully different
from a 66, and the tilt language should reflect that.

---

## 4. Pillar formulas

All sub-scores are clamped to `[0, 100]` after computation unless stated
otherwise. `clamp(x, lo, hi)` = `min(max(x, lo), hi)`. `lerp` = piecewise-linear
interpolation between named anchor points (anchors need not be monotonic in
`y` — a tent-shaped function is just a `lerp` whose anchors rise then fall).

### P1. Growth Momentum

| Sub-metric | Weight in P1 | Formula |
|---|---|---|
| a. Real GDP YoY vs. trend growth (~6.5%) | 40% | `lerp` anchors: −2%→5, 0%→20, 3%→35, 6.5% (trend)→60, 9%→85, ≥12%→100 |
| b. IIP (Index of Industrial Production) YoY growth | 25% | `lerp` anchors: −6%→5, 0%→25, 4%→55, 7%→75, 10%→90, ≥14%→100 |
| c. Composite PMI (avg. of Manufacturing PMI and Services PMI) | 35% | `clamp(50 + (compositePmi − 50) × 3, 0, 100)` |

```
P1 = 0.40a + 0.25b + 0.35c
```

**Why 6.5% is the GDP anchor, not a higher or lower number**: 6.5% is used
here as India's approximate real potential/trend growth rate — the rate
consistent with neither a positive nor negative output gap. Printing exactly
at trend is "good, not remarkable" (score 60), mirroring how the PDQI treats
paying the sector-median multiple as fair-but-unremarkable. Growth
meaningfully above trend is what actually signals an expansion regime, not
merely growth that's merely positive.

**Why the composite PMI is anchored at the real neutral line of 50**: 50 is
the textbook expansion/contraction threshold for a diffusion-index PMI, so
using it as the score's own neutral point (score 50 at PMI 50) keeps the
sub-score legible against the number analysts already read in isolation. The
×3 multiplier means a composite PMI of 60 scores 80, and a composite PMI of
40 scores 20 — steep enough that a sustained cross of the 50 line moves this
sub-score meaningfully within a single print.

### P2. Inflation & Monetary Stance

| Sub-metric | Weight in P2 | Formula |
|---|---|---|
| a. CPI inflation vs. RBI target band | 60% | `lerp` (tent) anchors: 0%→20, 2%→55, 4% (target)→100, 6%→55, 8%→20, ≥12%→5 |
| b. Real repo rate (repo rate − CPI YoY) | 40% | `lerp` (tent) anchors: −3%→25, 0%→55, 1.5%→90, 3%→70, 5%→45, ≥8%→15 |

```
P2 = 0.60a + 0.40b
```

**Why (a) is a tent, not a simple "lower is better" curve**: the RBI's
inflation-targeting mandate is a 4% target with a 2–6% tolerance band, not a
"as low as possible" mandate. CPI sitting at 4% is the best possible reading
(score 100); CPI drifting toward either edge of the 2–6% band is
progressively worse, and CPI below 2% is treated as a demand-weakness signal
— nearly as concerning as CPI pushing past 6% on the high side, not a free
pass. This is the same shape as an athlete's target heart-rate zone, not a
golf score.

**Why (b) is also a tent**: a real repo rate that's too negative (policy too
loose relative to inflation) risks entrenching inflation expectations; a real
repo rate that's too high (policy too tight) chokes credit and investment.
The peak at 1.5% real reflects the historical range the RBI has tended to
treat as a "neutral-to-mildly-restrictive" real rate for India — moderately
positive, not aggressively so.

### P3. External Sector Health

| Sub-metric | Weight in P3 | Formula |
|---|---|---|
| a. Current Account Deficit (CAD) as % of GDP | 40% | `lerp` (tent) anchors: −3% (surplus)→65, 0%→90, 1.25% (comfort zone)→100, 2.5%→75, 4%→45, ≥6%→15 |
| b. FX reserve adequacy (months of import cover) | 35% | `lerp` anchors: 3mo→10, 6mo→40, 9mo→80, 12mo→95, ≥15mo→100 |
| c. INR realized volatility (trailing 3-month annualized, %) | 25% | inverse `lerp` anchors: 2%→100, 5%→80, 8%→55, 12%→30, ≥18%→10 |

```
P3 = 0.40a + 0.35b + 0.25c
```

Sign convention for (a): a positive value is a deficit (imports of
goods+services+transfers exceed exports); a negative value is a current
account **surplus**. India's historical comfort zone for a sustainable CAD
is roughly 1–1.5% of GDP — wide enough to fund productive investment via
manageable external financing, not so wide that it depends on fickle
portfolio inflows. A large surplus scores slightly below the comfort-zone
peak (65 at −3% vs. 100 at 1.25%) because an unusually large surplus more
often reflects weak domestic demand (import compression) than genuine export
strength.

### P4. Fiscal Health

| Component | Formula |
|---|---|
| Base: fiscal deficit vs. glide-path target | `overshootPts = actualDeficitPctGdp − targetDeficitPctGdp`; `base = clamp(80 − overshootPts × 25, 0, 100)` |
| Quality-of-deficit adjustment | `+10` if capex share of total central government spending is rising YoY (capex-driven deficits are more growth-supportive than revenue-expenditure-driven ones) |

```
P4 = clamp(base + qualityAdjustment, 0, 100)
```

Hitting the budgeted/glide-path target exactly scores 80 — good, not
perfect, mirroring the PDQI's treatment of "at the sector median" as
fair-but-unremarkable. Beating the target pushes the base score above 80;
missing it costs 25 points per percentage point of GDP overshot, which is a
deliberately steep penalty — fiscal slippage is one of the fastest ways a
government re-prices its own borrowing costs. The capex-quality bonus exists
because two governments can print an identical headline deficit number with
very different growth consequences: one financing productive capital
formation, the other financing recurring revenue expenditure. Both count the
same in the headline print; they should not count the same here.

### P5. Credit & Liquidity

| Sub-metric | Weight in P5 | Formula |
|---|---|---|
| a. Non-food bank credit growth YoY | 60% | `lerp` anchors: 0%→15, 5%→40, 10%→75, 12.5%→95, 15%→95, 20%→65, 25%→35, ≥30%→15 |
| b. Banking-system liquidity stance | 40% | categorical map: `deep_deficit`→15, `deficit`→35, `neutral`→60, `comfortable_surplus`→90, `excess_surplus`→70 |

```
P5 = 0.60a + 0.40b
```

The credit-growth curve plateaus at its highest score across roughly
10–15% YoY — the range historically associated with credit supporting
real-economy activity without outrunning it — and falls off on **both**
sides: too-low growth signals a credit crunch or weak demand for credit,
too-high growth (>20%) risks the kind of credit-fueled excess that later
shows up as asset-quality stress. The liquidity map is deliberately
non-monotonic at the top end: `excess_surplus` scores below
`comfortable_surplus` because liquidity that's persistently too abundant
blunts monetary policy transmission (rate cuts/hikes take longer to reach
the real economy when the system is already flush) — comfortable is better
than excessive, not just better than tight.

### P6. Capital Flows & Market Confidence

| Sub-metric | Weight in P6 | Formula |
|---|---|---|
| a. Net FPI flows (trailing 3-month net, USD bn) | 45% | `lerp` anchors: −15→10, −5→30, 0→55, 5→75, 10→90, ≥20→100 |
| b. Net FDI flows (trailing quarter net, USD bn) | 35% | `lerp` anchors: −2→15, 0→40, 3→60, 6→80, 10→95, ≥15→100 |
| c. Risk-premium proxy (sovereign CDS-equivalent spread, bps) | 20% | inverse `lerp` anchors: 40bps→100, 80bps→80, 120bps→55, 200bps→30, ≥300bps→10 |

```
P6 = 0.45a + 0.35b + 0.20c
```

**Sub-component (c) has a qualitative fallback.** A sovereign CDS-equivalent
spread isn't always readily to hand. When it's genuinely unavailable, use the
**Policy Credibility & Geopolitical Risk** rubric in §5 in its place —
`likertToScore` converts the same 1–5 rating used there to a 0–100 score on
the identical scale, so the sub-component slot is unaffected either way. This
is the one sub-component in the whole model that runs on either a
quantitative or a qualitative input by design, because it's the lowest-weighted
piece (20% of a 10%-weighted pillar = 2% of the composite) and the input most
likely to be missing on a given reporting day. Record in the output which
form was actually used.

---

## 5. Qualitative rubric

Used for P6c as a fallback only when a sovereign risk-premium figure isn't
available. Anchors, not vibes — write down which anchor description matches
before picking a number.

**Policy Credibility & Geopolitical Risk (1–5)**

| Value | Score | Anchor description |
|---|---|---|
| 1 | 10 | Acute stress — a major policy misstep, or an active geopolitical/election shock is actively repricing India risk |
| 2 | 35 | Elevated concern — meaningful uncertainty (fiscal slippage risk, a global risk-off episode, an adverse geopolitical development) weighing on sentiment |
| 3 | 60 | Neutral baseline — normal policy continuity, no major surprises priced in either direction |
| 4 | 80 | Supportive — credible policy path and reform momentum against a stable geopolitical backdrop |
| 5 | 100 | Highly supportive — active reform momentum plus a benign global backdrop, actively compressing India's risk premium |

`likertToScore`: linear interpolation is fine for non-integer averages (e.g.
a rating of 3.5 → score 70). This is the same conversion function and scale
used by the PDQI's qualitative rubrics — a deliberate consistency choice so
that a 1–5 rating means the same thing across every skill in this library.

---

## 6. Confidence and missing data

Every pillar has a **required input list** (see `scripts/score.js`'s
`REQUIRED_FIELDS`). Before computing, count how many required fields across
all six pillars are missing or explicitly marked `"unknown"`.

```
completeness = 1 − (missingCount / totalRequiredFields)
```

- `completeness ≥ 0.9` → **High confidence**. Report the regime as-is.
- `0.7 ≤ completeness < 0.9` → **Medium confidence**. Report the regime with a
  note listing which pillars used estimates or the qualitative fallback.
- `completeness < 0.7` → **Low confidence**. Prefix the output
  `"PRELIMINARY — insufficient data for a reliable regime call"` and
  explicitly name which official releases would resolve the biggest gaps
  first (a missing GDP print is a bigger gap than a missing CDS spread —
  prioritize closing growth/inflation data over capital-flows data).

Never silently substitute a default value for a missing required field and
present the result as if it were measured. If a value is genuinely unknown,
pass `null` and let the completeness penalty apply — a lower-confidence real
answer beats a confident wrong one.

---

## 7. Worked example

Hypothetical quarter, illustrative only (not an actual RBI/MOSPI release).
Full input is `scripts/example-input.json` — run
`node scripts/score.js scripts/example-input.json` to reproduce these numbers
exactly (they are copied straight from that output).

- Real GDP YoY 7.2%, IIP YoY 5.8%, Manufacturing PMI 57.5, Services PMI 60.3
  (composite 58.9)
- CPI YoY 3.6%, repo rate 6.00% (real repo rate 2.4%)
- CAD 1.1% of GDP, FX reserves 10.5 months of import cover, INR realized
  volatility 4.8% (trailing 3-month annualized)
- Fiscal deficit 4.4% of GDP vs. 4.5% budgeted target, capex share of
  spending rising YoY
- Non-food credit growth 12.8% YoY, liquidity stance "comfortable_surplus"
- Net FPI (trailing 3mo) +$6.2bn, net FDI (trailing quarter) +$8.5bn,
  sovereign risk-premium proxy 65bps

```
P1: a = lerp(7.2, [6.5,60]→[9,85]) = 60 + (7.2-6.5)/(9-6.5)×25 = 67.0
    b = lerp(5.8, [4,55]→[7,75]) = 55 + (5.8-4)/(7-4)×20 = 67.0
    c = clamp(50 + (58.9-50)×3, 0, 100) = 76.7
P1 = 0.40(67.0) + 0.25(67.0) + 0.35(76.7) = 70.4

P2: a = lerp(3.6, [2,55]→[4,100]) = 55 + (3.6-2)/(4-2)×45 = 91.0
    b = lerp(2.4, [1.5,90]→[3,70]) = 90 + (2.4-1.5)/(3-1.5)×(70-90) = 78.0
P2 = 0.60(91.0) + 0.40(78.0) = 85.8

P3: a = lerp(1.1, [0,90]→[1.25,100]) = 90 + (1.1-0)/(1.25-0)×10 = 98.8
    b = lerp(10.5, [9,80]→[12,95]) = 80 + (10.5-9)/(12-9)×15 = 87.5
    c = lerp(4.8, [2,100]→[5,80]) = 100 + (4.8-2)/(5-2)×(80-100) = 81.3
P3 = 0.40(98.8) + 0.35(87.5) + 0.25(81.3) = 90.5

P4: overshootPts = 4.4 - 4.5 = -0.1 → base = clamp(80 - (-0.1×25), 0, 100) = 82.5
    quality adjustment = +10 (capex share rising)
P4 = clamp(82.5 + 10, 0, 100) = 92.5

P5: a = lerp(12.8, [12.5,95]→[15,95]) = 95.0 (flat segment)
    b = comfortable_surplus = 90
P5 = 0.60(95.0) + 0.40(90) = 93.0

P6: a = lerp(6.2, [5,75]→[10,90]) = 75 + (6.2-5)/(10-5)×15 = 78.6
    b = lerp(8.5, [6,80]→[10,95]) = 80 + (8.5-6)/(10-6)×15 = 89.4
    c = lerp(65, [40,100]→[80,80]) = 100 + (65-40)/(80-40)×(80-100) = 87.5
P6 = 0.45(78.6) + 0.35(89.4) + 0.20(87.5) = 84.2

PIMRI = 0.25(70.4) + 0.20(85.8) + 0.20(90.5) + 0.15(92.5) + 0.10(93.0) + 0.10(84.2)
    = 17.6 + 17.2 + 18.1 + 13.9 + 9.3 + 8.4 = 84.4
```

**Result: PIMRI 84.4 — Expansion / Goldilocks regime.** Overweight equities,
tilt toward cyclicals and small/mid-caps. Growth (P1, 70.4) is the softest
pillar relative to the rest of the composite — above-trend GDP and a strong
composite PMI are doing the work, but IIP at 5.8% YoY is only middling on its
own curve, worth checking against the next release for base-effect noise
before treating the expansion call as fully confirmed. External health (P3,
90.5) and credit conditions (P5, 93.0) are the standout strengths this
quarter.

*(Note: this section is regenerated to match the actual script output as
part of the verification step in this skill's build process — see §9 for
the version this was last confirmed against.)*

---

## 8. Known limitations

- **Official growth data is noisy and gets revised.** India's GDP and IIP
  releases are routinely revised — sometimes materially — in subsequent
  quarters as more complete data comes in. An early PIMRI read on a fresh
  GDP print is directionally useful but should be treated as provisional
  until at least the first revision.
- **Monsoon and agricultural-output shocks aren't captured.** No pillar
  directly measures rainfall, kharif/rabi sowing, or agri-output, yet a poor
  monsoon materially affects rural demand and food inflation (which feeds
  back into P2's CPI reading) with a lag the composite doesn't isolate.
  Treat a below-normal monsoon as a qualitative overlay on top of the score,
  not something the pillars already priced in.
- **State-level heterogeneity is averaged away.** A national composite can
  read "Moderate Growth" while masking a state or region in outright
  contraction (or the reverse). For regionally concentrated exposure, don't
  rely on the national PIMRI alone.
- **Global risk-off contagion can override domestic fundamentals in the
  short run.** P6 (capital flows) and P3's INR-volatility sub-component can
  move sharply on global events — a Fed repricing, a regional crisis, a
  broad emerging-market sell-off — that have nothing to do with India's own
  fundamentals. A weak P6/P3 print during a global risk-off episode is a
  liquidity/sentiment signal, not necessarily a domestic-fundamentals one;
  say so explicitly rather than reading it as an India-specific downgrade.
- **Release-calendar misalignment.** PMI is monthly and near-real-time;
  CPI and IIP lag by roughly a month; GDP lags by about two months and
  arrives quarterly. A single PIMRI read blends indicators of different
  vintages, which can make the composite look more current than its
  slowest-moving input actually is.

---

## 9. Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-10 | Initial specification and reference implementation |

Any change to a weight, formula, or anchor value is a version bump with an
entry here — the whole point of a proprietary, named index is that "PIMRI 84"
means the same thing every time it's quoted. Silent tuning defeats that.
