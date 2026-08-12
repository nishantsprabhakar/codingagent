# Nishant SaaS Health Score (NSHS) — v1.0

**Proprietary scoring methodology for SaaS / subscription business health
assessment, developed by Nishant Prabhakar.**

Status: v1.0 (2026-08-12). Author/owner: Nishant Prabhakar. This document is
the authoritative specification — `scripts/score.js` is a direct, literal
implementation of the formulas below. If the two ever disagree, this document
is correct and the script has a bug.

Named composite scores have real precedent in SaaS specifically: **Rule of
40** (popularized by Brad Feld and standardized by Bessemer Venture
Partners' annual State of the Cloud benchmarks) collapsed "is this company
growing responsibly or burning irresponsibly" into one number that is now
quoted by name in nearly every growth-stage SaaS board deck. **Net Revenue
Retention** underwent the same standardization through Bessemer's and
ICONIQ's public SaaS benchmark reports, to the point that "NRR" is now the
single most-cited health metric in SaaS diligence, ahead of raw growth rate.
NSHS borrows that same discipline — a small number of named, auditable
pillars instead of one blended ratio — and extends it the way NCRS (this
library's credit-risk sibling) extends the Altman Z-Score: six weighted
pillars instead of one, so a single dominant metric can't silently mask
weakness elsewhere (a company can have great NRR while quietly burning cash
at an unsustainable multiple, exactly the failure mode Rule of 40 alone
cannot catch because it nets growth and margin into one number).

---

## 1. Purpose and positioning

The NSHS is a **triage and relative-ranking tool for assessing SaaS/
subscription business health**, not an audit of financial statements and not
a substitute for full financial or legal diligence. It exists to do three
things quickly and consistently across a portfolio or deal pipeline:

1. Convert a SaaS company's retention, growth, unit-economics, churn,
   capital-efficiency, and qualitative signals into one comparable number,
   produced the same way every time.
2. Force the same six questions to get answered for every company, so two
   analysts scoring the same file land on the same number (±5 points).
3. Surface *which specific pillar* is driving the outcome, not just a gut
   feel — so the conversation is "NRR is healthy at 108% but CAC payback has
   drifted to 18 months and burn multiple is 1.3x" instead of "growth looks
   fine I guess."

**Why these six pillars, and why this way of grouping them** (the candidate
metrics a SaaS diligence process usually reaches for — NRR/GRR, Rule of 40 /
magic number / CAC payback, LTV:CAC / gross margin, logo churn / cohort
curves, burn multiple / runway, and founder/moat/concentration — collapse
into six non-overlapping axes once duplicated signal is removed):

- **P1 Revenue Retention & Expansion** (NRR + GRR) is kept as its own pillar,
  and weighted highest, because dollar-based retention of the *existing*
  customer base is the single metric most repeatedly shown (Bessemer,
  ICONIQ, OpenView annual SaaS benchmarks) to correlate with durable
  valuation and long-run survival — more so than headline growth rate, which
  is easy to buy with spend.
- **P2 Growth Efficiency** (Rule of 40 + CAC payback) answers a genuinely
  different question from P1: not "is the existing base durable" but "is
  *new* growth being bought efficiently." Rule of 40 nets top-line growth
  against margin at the whole-company level; CAC payback isolates the
  go-to-market engine specifically. Neither overlaps with NRR/GRR, which are
  silent on new-logo acquisition entirely.
- **P3 Unit Economics** (LTV:CAC + gross margin) is the *structural*
  profitability of a customer relationship — independent of how fast the
  company is growing or how sticky any given cohort turns out to be. A
  company can have perfect retention and still have bad unit economics if
  gross margin is thin or CAC is bloated relative to lifetime value.
- **P4 Churn & Cohort Retention Quality** (logo churn + cohort-curve shape)
  is deliberately kept separate from P1 despite both being "retention"
  metrics, because they measure different failure modes: P1 is
  dollar-weighted and can be flattered by one expanding whale account while
  the broader base quietly leaks logos — exactly the case P4's logo-churn
  and cohort-curve-shape metrics are built to catch. A business can pass P1
  and still be one enterprise-renewal decision away from a very different
  story, which is what P4 exists to surface.
- **P5 Capital Efficiency & Burn** (burn multiple + runway) is the survival
  axis — distinct from P2's growth-efficiency lens because burn multiple
  measures *cash* consumed per dollar of net-new ARR company-wide (including
  R&D, G&A, and non-S&M spend), not just the go-to-market engine's payback
  math, and runway is a pure survival clock that neither growth rate nor
  margin alone communicates.
- **P6 Qualitative & Governance / Concentration Risk** (founder-market fit +
  product moat + customer concentration + governance red flags) is the one
  pillar that cannot be reduced to a ratio computed from a metrics export —
  it captures whether the other five pillars' inputs can even be trusted,
  and whether the business is one lost contract away from a very different
  set of numbers.

It is deliberately **not** a black box: every sub-score is a named, auditable
formula against a named input. If an input is unknown, the algorithm says so
and degrades its confidence rating rather than guessing silently.

**What the NSHS explicitly is not**:

- **Not an audit or a substitute for financial diligence.** It does not
  verify ARR build-up methodology, does not confirm revenue-recognition
  treatment (especially for usage-based or multi-year prepaid contracts,
  where "ARR" definitions vary widely), and does not reconcile bookings to
  cash collected. Run real financial diligence in parallel — NSHS tells you
  whether the business is worth that effort and roughly where it will land.
- **Not a valuation model.** NSHS does not output a multiple, a price, or a
  fair-value estimate. Pair it with an actual comps-based or DCF valuation
  exercise for pricing decisions.
- **Not calibrated for pre-PMF or pre-revenue companies.** It requires at
  least one full trailing period of retention and cohort data to mean
  anything; a company with under ~12 months of paying-customer history should
  be screened with `venture-capital-screening`'s NSTS instead, which is built
  for traction signals before cohort curves exist.

---

## 2. Structure at a glance

Six weighted pillars, each scored 0–100, rolled into one composite:

| Pillar | Weight | What it answers |
|---|---|---|
| P1. Revenue Retention & Expansion | 25% | Is the existing customer base growing or leaking, in dollar terms? |
| P2. Growth Efficiency | 15% | Is new growth being bought efficiently, or at any cost? |
| P3. Unit Economics | 15% | Is each customer relationship structurally profitable? |
| P4. Churn & Cohort Retention Quality | 15% | Are customers (not just dollars) actually staying, and does the retention curve flatten? |
| P5. Capital Efficiency & Burn | 15% | How much cash does growth cost, and how long can the company operate? |
| P6. Qualitative & Governance / Concentration Risk | 15% | Is the team/moat real, and is anything concentrated or hidden? |

```
NSHS = 0.25·P1 + 0.15·P2 + 0.15·P3 + 0.15·P4 + 0.15·P5 + 0.15·P6
```

**Weighting rationale**: P1 alone carries 25% — a full 10 points more than
any other pillar — because dollar-based net/gross revenue retention is the
most consistently cited leading indicator of durable SaaS value across
public benchmark studies, and because expansion/contraction in the existing
base compounds every year it persists in either direction, unlike a
point-in-time efficiency ratio. The remaining five pillars are weighted
evenly at 15% each: growth efficiency, unit economics, churn/cohort quality,
capital efficiency, and qualitative/governance are all real, load-bearing
signals, but none of them individually predicts outcomes as reliably as P1,
and none is disposable enough to weight below the others — a company can be
undone by any one of them (e.g., perfect retention but a burn multiple of
4x will still run out of cash).

---

## 3. Score bands — tier mapping

NSHS tiers communicate roughly what posture an investor or operator should
take. **The implications below are illustrative and directional, not a
committed investment decision, term sheet, or valuation** — always pair a
tier with real diligence and a real valuation exercise before acting on it.

| NSHS | Tier | Investment/operating implication |
|---|---|---|
| 85–100 | **Tier 1 — Best-in-Class** | Top-decile SaaS health; premium multiple defensible, minimal structuring needed |
| 70–84 | **Tier 2 — Strong / Fundable** | Healthy, fundable business; standard growth-stage terms apply |
| 50–69 | **Tier 3 — Developing / Watch** | Mixed signals; proceed with structure (milestones, tighter terms) or targeted diligence on the weak pillar(s) before committing |
| 30–49 | **Tier 4 — Weak / At-Risk** | Material weakness in retention, economics, or cash runway; restructure terms, re-price, or pass |
| 0–29 | **Tier 5 — Distressed / Unfundable** | Broken retention, unit economics, or runway; not investable as-is — turnaround/workout territory, not a growth check |

These bands assume **high confidence** inputs (see §6). Under low confidence,
treat the tier as directional only and widen it by one full tier (toward the
more cautious tier) in your head before acting on it.

---

## 4. Pillar formulas

All sub-scores are clamped to `[0, 100]` after computation unless stated
otherwise. `clamp(x, lo, hi)` = min(max(x, lo), hi). `lerp` = piecewise-linear
interpolation between named anchor points, in ascending order of the input
metric (lower-is-better metrics simply have descending anchor scores across
ascending inputs).

### P1. Revenue Retention & Expansion

| Sub-metric | Weight in P1 | Formula |
|---|---|---|
| a. Net Revenue Retention (NRR, %) | 60% | `lerp` anchors: 80→10, 90→30, 100→55, 110→75, 120→90, 130→100 |
| b. Gross Revenue Retention (GRR, %) | 40% | `lerp` anchors: 80→10, 85→35, 90→55, 95→75, 98→90, 100→100 |

```
P1 = 0.60a + 0.40b
```

**Why both NRR and GRR, not NRR alone**: NRR nets expansion against
contraction/churn into one number, which means a company can post a
healthy-looking 108% NRR entirely on the back of one or two accounts
expanding hard while the broader base is actually churning — GRR strips out
expansion and isolates true retention/downgrade risk, which is why it gets
real weight (40%) rather than being a footnote. A wide gap between a strong
NRR and a weak GRR is itself a diagnostic signal worth calling out in the
report even though the formula doesn't have a separate term for the gap.

### P2. Growth Efficiency

| Sub-metric | Weight in P2 | Formula |
|---|---|---|
| a. Rule of 40 (YoY ARR growth % + FCF margin %) | 60% | `lerp` anchors: −20→0, 0→15, 20→35, 30→55, 40→75, 55→90, 70→100 |
| b. CAC Payback Period (months) | 40% | `lerp` anchors: 6→100, 12→85, 18→65, 24→45, 36→20, 48→5 |

```
P2 = 0.60a + 0.40b
```

**Anchor logic for (a)**: the conventional Rule-of-40 pass/fail line is 40 —
that single threshold sits at anchor 40→75 here, deliberately scored as
"strong, not merely passing," because a raw pass/fail treatment throws away
the information in *how far* above or below 40 a company sits. Below 0
(actively shrinking-and-burning, the worst combination) the curve floors
near zero fast; above 55 the curve flattens because incremental Rule-of-40
points above the mid-50s are a smaller differentiator than clearing 40 in
the first place.

**Anchor logic for (b)**: CAC payback is inherently a go-to-market-engine
metric, distinct from company-wide Rule of 40. Sub-12-month payback is
best-in-class efficiency (capital-light PLG motions and low-ACV SMB deals
often land here); 12–18 months is the conventional healthy mid-market
range; beyond 24 months, payback risk compounds with any interest-rate or
funding-market tightening because the company is effectively extending
long-duration credit to itself on every new logo.

### P3. Unit Economics

| Sub-metric | Weight in P3 | Formula |
|---|---|---|
| a. LTV : CAC ratio | 55% | `lerp` anchors: 1→10, 2→35, 3→60, 4→80, 5→90, 6→100 |
| b. Gross Margin (%) | 45% | `lerp` anchors: 50→10, 60→35, 70→60, 75→75, 80→90, 85→100 |

```
P3 = 0.55a + 0.45b
```

**Anchor logic for (a)**: 3:1 LTV:CAC is the long-standing conventional
"healthy" floor cited across SaaS benchmark literature; below 1:1 the
business is destroying value on every customer acquired by construction.
The curve is capped at 6:1 rather than continuing to reward ever-higher
ratios uncapped, because past roughly 5–6:1 an unusually high ratio more
often signals under-investment in growth (leaving CAC too low relative to
achievable LTV) than genuine best-in-class efficiency — see §8.

**Anchor logic for (b)**: 70–80% gross margin is the conventional healthy
band for software-delivered revenue; margins meaningfully below that
(50–60%) usually indicate a heavy services/implementation attach or
infrastructure-cost structure closer to an IT-enabled services business than
pure software, which is a real signal worth separating out in the qualitative
narrative even though it isn't a separate formula term.

### P4. Churn & Cohort Retention Quality

| Sub-metric | Weight in P4 | Formula |
|---|---|---|
| a. Annualized logo churn rate (%) | 55% | `lerp` anchors: 0→100, 2→95, 5→80, 10→55, 15→30, 20→10 |
| b. Cohort retention curve health (1–5 rubric, see §5) | 45% | `likertToScore(rubricValue)` |

```
P4 = 0.55a + 0.45b
```

**Why logo churn is scored independently of P1's dollar-based retention, at
real weight**: a company can post strong NRR while quietly bleeding small
accounts if a handful of larger accounts are expanding — logo churn, which
counts customers rather than dollars, is the metric that catches this
specifically. Sub-5% annualized logo churn is enterprise-grade retention;
10%+ starts to indicate either a weak ICP fit or a low-switching-cost
product category.

**Cohort retention curve health rubric (1–5) — rate against**: whether
month-by-month cohort retention curves plateau (product has found a durable
retained-usage floor) or keep decaying with no visible floor by month 18–24
(product is a slow-motion leak, however healthy the current-quarter
snapshot looks). A curve that plateaus early and high, or that goes
net-negative-churn within the cohort (expansion outpaces the cohort's own
churn), is the strongest form of this signal.

| Value | Anchor description |
|---|---|
| 1 | Curve shows no plateau through month 24+ — continuous decay, no floor visible |
| 2 | Curve decays significantly before a weak plateau forms, well below month-1 level |
| 3 | Curve plateaus by month 12–18 at a moderate retained level |
| 4 | Curve plateaus early (by month 6–12) at a high retained level |
| 5 | Curve plateaus at or near 100%+ of month-1 revenue, or cohort is net-negative-churn (expansion outpaces in-cohort churn) |

### P5. Capital Efficiency & Burn

| Sub-metric | Weight in P5 | Formula |
|---|---|---|
| a. Burn Multiple (net burn ÷ net-new ARR) | 60% | `lerp` anchors: 0→100, 0.5→90, 1.0→75, 1.5→55, 2.0→35, 3.0→10 |
| b. Runway (months at current net burn) | 40% | `lerp` anchors: 6→10, 12→40, 18→60, 24→80, 36→95, 48→100 |

```
P5 = 0.60a + 0.40b
```
unless `capitalEfficiency.isFcfPositive` is `true`, in which case **both a
and b default to 100** (full credit) — see below.

**Anchor logic for (a)**: sub-1.0x burn multiple (spending less than a
dollar to generate a dollar of net-new ARR) is the conventional "efficient
growth" bar cited in growth-stage SaaS benchmark data; above 2x, a company
is burning capital faster than it is compounding recurring revenue, which
becomes acutely dangerous in any funding-market tightening.

**Why both sub-metrics default to full credit (100) when FCF-positive, not
treated as missing data**: a profitable, FCF-positive company has no
meaningful "burn" to divide by, and functionally infinite runway — treating
an inapplicable metric as unknown and penalizing confidence for it would be
wrong (it isn't missing, it's not a relevant question for this company), and
treating it as a low score would be a false negative on capital efficiency.
This mirrors NCRS's treatment of cash runway for cash-flow-positive
borrowers in the credit-risk-analysis skill — an inapplicable metric gets a
neutral-to-favorable default, not a penalty, and not a confidence hit.

### P6. Qualitative & Governance / Concentration Risk

| Sub-metric | Weight in P6 | Formula |
|---|---|---|
| a. Founder-market fit / team quality (1–5 rubric, see §5) | 30% | `likertToScore(rubricValue)` |
| b. Product moat / competitive differentiation (1–5 rubric, see §5) | 30% | `likertToScore(rubricValue)` |
| c. Top-10-customer concentration (% of ARR) | 20% | `lerp` anchors: 0→100, 10→85, 20→60, 35→35, 50→10 |
| d. Governance red flags (deductive) | 20% | Start at 100; `−15` per confirmed flag; floor 0 |

```
P6 = 0.30a + 0.30b + 0.20c + 0.20d
```

**Governance red-flag checklist (each confirmed flag is −15, stacking)**:

| Flag |
|---|
| Related-party transactions not on arm's-length terms |
| ARR/bookings metric restated or redefined without clear disclosure |
| Unplanned executive departure (CEO/CFO/CRO) outside a normal succession plan |
| Material customer or partner dispute/litigation |

**Why customer concentration gets its own quantitative term inside the
qualitative pillar rather than a separate pillar**: concentration risk is
fundamentally a "how much can this company be hurt by one decision it
doesn't control" question — the same underlying risk category as
founder-dependency and moat durability, just measured on the revenue book
instead of the team or the product. Above ~35% of ARR sitting in the top 10
accounts, a single non-renewal decision can move every other pillar's
inputs at the next measurement, which is why the anchors steepen quickly
past that point.

---

## 5. Qualitative rubrics (Likert → score)

Used for P4b, P6a, P6b, and any other 1–5 qualitative input. Anchors, not
vibes — write down which anchor description matches before picking a number.

| Value | Score | Anchor description |
|---|---|---|
| 1 | 10 | Absent / actively concerning |
| 2 | 35 | Weak — present but thin, easily challenged |
| 3 | 60 | Adequate — defensible, industry-standard |
| 4 | 80 | Strong — clearly above peer set |
| 5 | 100 | Exceptional — a genuine, hard-to-replicate advantage |

`likertToScore`: linear interpolation is fine for non-integer averages.

**Founder-market fit / team quality (P6a)** — rate against: relevant-domain
operating experience, history of hitting or missing prior board-reported
targets, functional leadership depth (not just the founders), and candor in
prior investor updates (did leadership proactively flag problems, or did
investors find them first?).

**Product moat / competitive differentiation (P6b)** — rate against:
switching costs, proprietary data/network effects, technical
defensibility versus a well-funded fast-follower, and win-rate trend against
named competitors in the sales pipeline.

**Cohort retention curve health (P4b)**: see the dedicated table in §4 — this
rubric has its own anchor descriptions rather than the generic table above.

---

## 6. Confidence and missing data

Every pillar has a **required input list** (see `scripts/score.js`'s
`REQUIRED_FIELDS`). Before computing, count how many required fields are
missing or explicitly marked `"unknown"`.

```
completeness = 1 − (missingCount / totalRequiredFields)
```

- `completeness ≥ 0.9` → **High confidence**. Report the tier as-is.
- `0.7 ≤ completeness < 0.9` → **Medium confidence**. Report the tier with a
  note listing which pillars used estimates.
- `completeness < 0.7` → **Low confidence**. Prefix the output
  `"PRELIMINARY — insufficient data for a reliable score"` and explicitly
  recommend which report/data pull would resolve the biggest gaps first
  (usually: a cohort-level retention report and an ARR bridge beat a single
  board-deck slide every time — prioritize closing P1/P4 retention gaps and
  P5 burn/runway gaps over qualitative ones).

**Twelve core fields are unconditionally required**: the retention, growth,
unit-economics, churn, and founder/moat/concentration inputs listed as
`REQUIRED_FIELDS` in `scripts/score.js`. **Two fields are conditionally
required**, matching the graceful-N/A handling described in §4:

- `capitalEfficiency.burnMultiple` and `capitalEfficiency.runwayMonths` are
  only required if `capitalEfficiency.isFcfPositive` is `false`. If the
  company is FCF-positive, neither field is counted against completeness at
  all — see §4, P5.

**Opt-in, not opt-out**: `qualitative.governanceRedFlags` defaults to
"nothing found" when omitted, by design (an empty checklist reads as clean,
not unknown), matching the same convention used for risk-flag checklists
elsewhere in this library (see `credit-risk-analysis`). Only populate it
from what the source material actually supports — don't state "no
governance flags" in a report unless you actually looked for related-party
transactions, metric restatements, unplanned executive departures, and
customer disputes/litigation. An unexamined company defaulting to a clean
P6d score is worse than a low-confidence score, because nothing flags it as
unexamined.

Never silently substitute a default value for a missing required field and
present the result as if it were measured. If a value is genuinely unknown,
pass `null` and let the completeness penalty apply — a lower-confidence real
answer beats a confident wrong one.

---

## 7. Worked example

Series C, vertical B2B SaaS platform for mid-market logistics operators,
~$20M ARR, primarily sales-led with annual committed contracts. Full input
is `scripts/example-input.json` — run `node scripts/score.js
example-input.json` to reproduce these numbers exactly (they are copied
straight from that output, not hand-estimated).

- NRR 108%, GRR 92%
- YoY ARR growth 35%, FCF margin −10% (Rule of 40 = 25), CAC payback 18 months
- LTV:CAC 3.5x, gross margin 78%
- Annualized logo churn 8%, cohort retention curve rubric = 3 (plateaus by
  month 12–18 at a moderate level)
- Not FCF-positive: burn multiple 1.3x, runway 20 months
- Founder-market fit rubric = 4, product moat rubric = 3, top-10 customer
  concentration 18% of ARR, one governance flag (CFO departure outside a
  normal succession plan)

```
P1: a = lerp(108, [100→55, 110→75]) = 55 + (108-100)/(110-100)×20 = 71.0
    b = lerp(92, [90→55, 95→75])   = 55 + (92-90)/(95-90)×20    = 63.0
P1 = 0.60(71.0) + 0.40(63.0) = 67.8

P2: ruleOf40 = 35 + (-10) = 25
    a = lerp(25, [20→35, 30→55]) = 35 + (25-20)/(30-20)×20 = 45.0
    b = lerp(18, [18→65])        = 65.0   (exact anchor)
P2 = 0.60(45.0) + 0.40(65.0) = 53.0

P3: a = lerp(3.5, [3→60, 4→80]) = 60 + (3.5-3)/(4-3)×20 = 70.0
    b = lerp(78, [75→75, 80→90]) = 75 + (78-75)/(80-75)×15 = 84.0
P3 = 0.55(70.0) + 0.45(84.0) = 76.3

P4: a = lerp(8, [5→80, 10→55]) = 80 + (8-5)/(10-5)×(55-80) = 65.0
    b = likertToScore(3) = 60.0
P4 = 0.55(65.0) + 0.45(60.0) = 62.75

P5: a = lerp(1.3, [1.0→75, 1.5→55]) = 75 + (1.3-1.0)/(1.5-1.0)×(55-75) = 63.0
    b = lerp(20, [18→60, 24→80]) = 60 + (20-18)/(24-18)×20 = 66.667
P5 = 0.60(63.0) + 0.40(66.667) = 64.467

P6: a = likertToScore(4) = 80.0
    b = likertToScore(3) = 60.0
    c = lerp(18, [10→85, 20→60]) = 85 + (18-10)/(20-10)×(60-85) = 65.0
    d = clamp(100 - 1×15, 0, 100) = 85.0   (one governance flag)
P6 = 0.30(80.0) + 0.30(60.0) + 0.20(65.0) + 0.20(85.0) = 72.0

NSHS = 0.25(67.8) + 0.15(53.0) + 0.15(76.3) + 0.15(62.75) + 0.15(64.467) + 0.15(72.0)
     = 16.95 + 7.95 + 11.445 + 9.4125 + 9.67 + 10.8
     = 66.2275 → rounds to 66.2
```

**Result: NSHS 66.2 — Tier 3 (Developing / Watch), High confidence (100%
complete).**

Revenue retention (P1, 67.8) is solid but not exceptional — the GRR/NRR gap
(92% vs. 108%) says roughly 16 points of the NRR figure comes from
expansion rather than base retention, worth flagging explicitly. Growth
efficiency (P2, 53.0) is the single biggest drag: an 18-month CAC payback
and a Rule-of-40 score of only 25 (35% growth against a −10% FCF margin)
together say growth is being bought, not earned cheaply. Capital efficiency
(P5, 64.5) is adequate but not strong — a 1.3x burn multiple against a
20-month runway is serviceable, not comfortable. This is a genuinely mixed
profile: strong unit economics (P3, 76.3) and decent retention are being
partly offset by an inefficient growth engine and unremarkable capital
efficiency — exactly the kind of company Tier 3 exists to describe, where a
one-line "good" or "bad" verdict would flatten real, actionable nuance.

---

## 8. Known limitations

- **ARR and NRR/GRR definitions are not standardized across companies.**
  "ARR" can mean contracted, billed, or recognized revenue depending on who's
  reporting it, and NRR/GRR calculations vary in whether they include or
  exclude one-time fees, professional services, and usage overages. A
  cross-company comparison is only as good as confirming both companies
  compute these the same way — always ask for the definition, not just the
  number.
- **Ratio-based scoring can be gamed by timing.** Burn multiple, CAC payback,
  and Rule of 40 are all sensitive to the measurement window; a company can
  pull forward bookings, delay hiring, or defer marketing spend right before
  a board meeting or fundraise, then reverse the position the following
  quarter. Cross-check against monthly, not just quarterly, trend data where
  available.
- **The model does not independently verify contract terms or revenue
  recognition.** NSHS scores what is disclosed in metrics reports and
  diligence notes — it has no mechanism to catch aggressive ARR
  annualization of multi-year prepaid deals, side letters that quietly waive
  auto-renewal, or usage-based revenue mis-classified as committed ARR. Full
  financial and legal diligence remains mandatory before any capital
  decision; see §1.
- **Not calibrated for consumer subscription, PLG-only, or heavily
  usage-based businesses.** The CAC payback, gross-margin, and ACV-adjacent
  anchors in P2/P3 assume a seat/contract-based B2B motion with identifiable
  per-customer economics. A consumer app with $5/month ACV and a
  self-serve-only funnel, or a pure usage-based business with highly
  variable monthly revenue per account, will misscore on P2/P3 almost by
  definition — see the SKILL.md guidance on adapting the anchors for that
  context rather than reusing these as-is.
- **Qualitative rubrics are analyst-dependent.** Two analysts can legitimately
  land one Likert point apart on founder-market fit or product moat.
  Mitigate by having a second reviewer score P4b/P6a/P6b independently on
  contested calls and averaging.
- **A single-period snapshot decays quickly.** NSHS is built on trailing
  metrics that are, at best, refreshed monthly or quarterly. A company that
  scored a clean Tier 2 in Q1 can be genuinely Tier 3 or worse by Q3
  following a large non-renewal, a funding-market tightening that extends
  CAC payback, or a leadership departure — none of which shows up until the
  next reporting cycle. Treat NSHS as a point-in-time read that decays in
  reliability the longer it goes unrefreshed, especially for any company
  already near a tier boundary.

## 9. Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-12 | Initial specification and reference implementation |

Any change to a weight, formula, or anchor value is a version bump with an
entry here — the whole point of a proprietary, named algorithm is that "NSHS
70" means the same thing every time it's quoted. Silent tuning defeats that.
