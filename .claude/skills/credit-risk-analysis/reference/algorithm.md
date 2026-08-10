# Prabhakar Credit Risk Score (PCRS) — v1.0

**Proprietary scoring methodology for corporate credit risk analysis and
lending underwriting, developed by Nishant Prabhakar.**

Status: v1.0 (2026-08-10). Author/owner: Nishant Prabhakar. This document is
the authoritative specification — `scripts/score.js` is a direct, literal
implementation of the formulas below. If the two ever disagree, this document
is correct and the script has a bug.

Named credit-scoring models have real precedent: the **Altman Z-Score** (1968)
distilled five financial ratios into a single bankruptcy-prediction number
that's still quoted by name fifty-plus years later, precisely because "Z-Score
2.1" means the same specific, checkable thing every time it's cited. PCRS
borrows that same discipline — six named, auditable pillars instead of one
composite ratio — and borrows its output convention from **rating-agency
scales** (AAA...D), which solved the adjacent problem of collapsing a dense
credit file into a single comparable symbol decades ago. PCRS's leverage and
coverage pillars (P1/P2) are philosophically the closest thing here to
Altman's original leverage/liquidity ratios; the rest of the model extends
that lineage to the qualitative and industry factors a five-ratio model from
1968 was never meant to capture.

---

## 1. Purpose and positioning

The PCRS is a **triage and relative-ranking tool for underwriting and
pricing**, not a regulatory capital model and not a substitute for full
covenant or legal review. It exists to do three things quickly and
consistently across a lending pipeline:

1. Convert a borrower's financials, ratios, and qualitative diligence notes
   into one comparable number, produced the same way every time.
2. Force the same six questions to get answered for every borrower, so two
   credit analysts scoring the same file land on the same number (±5 points).
3. Surface *which specific pillar* is driving the risk, not just a gut feel —
   so the credit-committee conversation is "coverage is thin at 3.2x interest
   coverage against a 3-6x healthy band" instead of "this one feels tight."

It is deliberately **not** a black box: every sub-score is a named, auditable
formula against a named input. If an input is unknown, the algorithm says so
and degrades its confidence rating rather than guessing silently.

**What the PCRS explicitly is not**:

- **Not a regulatory capital model.** It does not produce a Basel-compliant
  Probability of Default (PD) or Loss Given Default (LGD) estimate, is not
  calibrated against a regulatory default database, and should never be
  represented as such to a regulator, auditor, or rating agency.
- **Not a substitute for full covenant or legal review.** PCRS scores what is
  disclosed in the financials and diligence notes. It does not read credit
  agreements, does not verify collateral perfection, and does not check
  cross-default or MAC clause language. Run real legal/covenant diligence in
  parallel — PCRS tells you whether the credit is worth that effort and at
  roughly what price.
- **Not a cash-flow or amortization forecaster.** It scores the *current
  credit profile*, not a projected repayment schedule. Build a real debt
  schedule / stress-tested cash flow model separately for sizing and
  structuring decisions.

---

## 2. Structure at a glance

Six weighted pillars, each scored 0–100, rolled into one composite:

| Pillar | Weight | What it answers |
|---|---|---|
| P1. Leverage | 25% | How much debt is sitting on this balance sheet relative to earnings and equity? |
| P2. Coverage | 20% | Can current cash flow actually service the debt, with room to spare? |
| P3. Liquidity | 15% | Can the borrower meet near-term obligations without a fire sale? |
| P4. Profitability & Stability | 15% | Are margins good *and* dependable, or good this year only? |
| P5. Industry & Cyclicality Risk | 10% | Does this sector default at 1% or 15% through a downturn? |
| P6. Qualitative & Governance | 15% | Is management credible, is the collateral real, and is anything being hidden? |

```
PCRS = 0.25·P1 + 0.20·P2 + 0.15·P3 + 0.15·P4 + 0.10·P5 + 0.15·P6
```

**Weighting rationale**: Leverage and coverage together are 45% of the score
by design — they are the two variables most directly tied to default
mechanics (a company defaults when it cannot service debt, and leverage is
the leading indicator of when coverage breaks). Liquidity and
profitability/stability are real but slower-moving signals, weighted lower
individually. Industry risk is weighted lowest of the quantitative-adjacent
pillars because it is a base-rate adjustment, not a borrower-specific signal —
but it still matters enough (10%) that a single-B commodity shipping company
and a single-B regulated utility should not land at the same PCRS if
everything else about them looks identical. Qualitative & governance sits at
15% because a governance red flag (undisclosed related-party dealing, a prior
covenant breach) can invalidate the trustworthiness of every other pillar's
inputs, which is worth real weight even though it is the softest pillar.

---

## 3. Score bands — rating-agency-style mapping

PCRS bands are mapped to a rating-agency-style scale for ease of
communication with credit committees and investors already fluent in that
convention. **The basis-point spread ranges are illustrative and directional
only — they are not a market quote, not a pricing commitment, and not
calibrated to any specific benchmark curve, index, or day.** Always price
off an actual market quote sheet; use these only to communicate roughly what
tier of pricing a PCRS implies.

| PCRS | Rating-agency-equivalent band | Indicative spread over risk-free benchmark* | Action |
|---|---|---|---|
| 85–100 | **AAA/AA-equivalent** | +50 to +100 bps | Approve; price at the tight end of the book |
| 70–84 | **A/BBB-equivalent (Investment Grade)** | +100 to +250 bps | Approve; standard IG covenant package |
| 50–69 | **BB/B-equivalent (High Yield)** | +250 to +600 bps | Approve with tighter covenants/pricing, or escalate to committee |
| 30–49 | **CCC-equivalent (Substantial Risk)** | +600 to +1,000 bps | Decline, or restructure (collateral, guarantees, amortization) before proceeding |
| 0–29 | **CC/C-equivalent (Distressed)** | +1,000 to +2,000+ bps | Decline; workout/special-situations territory, not new-money underwriting |

*Risk-free benchmark = the relevant sovereign or swap curve for the
borrower's currency and tenor (e.g. the matching-tenor government bond yield).
These ranges assume a normal-volatility credit market; in a liquidity crisis
or flight-to-quality episode, actual clearing spreads at every band can
widen well beyond this table — see §8.

These bands assume **high confidence** inputs (see §6). Under low confidence,
treat the band as directional only and widen it by one full band in your head
before quoting a spread off of it.

---

## 4. Pillar formulas

All sub-scores are clamped to `[0, 100]` after computation unless stated
otherwise. `clamp(x, lo, hi)` = min(max(x, lo), hi). `lerp` = piecewise-linear
interpolation between named anchor points.

### P1. Leverage

| Sub-metric | Weight in P1 | Formula |
|---|---|---|
| a. Net Debt / EBITDA vs. sector median | 60% | `clamp(100 − max(0, leverage − sectorMedianLeverage) × 12, 0, 100)` |
| b. Debt / Equity | 40% | `lerp` anchors: 0.5x→100, 1.0x→80, 2.0x→50, 3.0x→25, 4.0x→5 |

```
P1 = 0.60a + 0.40b
```

**Why the sector-relative form for (a)**: an identical 4.0x Net Debt/EBITDA
means something very different for a capital-light software business than for
a capital-intensive industrial roll-up where 4.0x is the sector norm. Scoring
leverage *relative to sector median* (rather than against one fixed universal
threshold) is the same design choice PDQI makes for its valuation-multiple
pillar, for the same reason: an absolute threshold silently penalizes
capital-intensive sectors and silently rewards capital-light ones. Each turn
of leverage above the sector median costs 12 points — steep enough that
leverage dominates the pillar, deliberately, since it is the single most
mechanical predictor of default among the six pillars.

**Why Debt/Equity is scored on an absolute scale, not sector-relative**: unlike
EBITDA multiples, D/E is sensitive to accounting equity (retained deficits,
buybacks, goodwill write-downs) in ways that make "sector median D/E" a much
noisier benchmark than "sector median leverage multiple." The absolute anchors
above (1.0x adequate, 2.0x elevated, 3.0x+ high) reflect a generalist
mid-market lens — see §8 for where this breaks down.

### P2. Coverage

| Sub-metric | Weight in P2 | Formula |
|---|---|---|
| a. EBITDA / Interest Expense | 55% | `lerp` anchors: 1.0x→5, 1.5x→20, 3.0x→55, 6.0x→85, 10.0x→100 |
| b. Free Cash Flow / Total Debt Service | 45% | `lerp` anchors: 0.8x→5, 1.0x→25, 1.25x→50, 2.0x→80, 3.0x→100 |

```
P2 = 0.55a + 0.45b
```

**Anchor logic for (a)**: below 1.5x interest coverage, a company is servicing
interest almost entirely out of a thin margin of error — one soft quarter away
from a covenant conversation. 1.5–3x is "building" — serviceable but not yet
resilient. 3–6x is the conventional healthy mid-market band. Above 6x, interest
coverage stops being the binding constraint on the credit at all, which is why
the curve flattens hard above that point.

**Anchor logic for (b)**: Total Debt Service = scheduled interest + scheduled
principal amortization for the period. This is a stricter test than (a)
because it includes amortization, which is why the anchors sit at lower
absolute ratio values (1.0x is the break-even point for cash-flow-only debt
service, matching the conventional DSCR covenant floor used in real credit
agreements; 1.25x is the typical minimum covenant level lenders require as
headroom above break-even).

### P3. Liquidity

| Sub-metric | Weight in P3 | Formula |
|---|---|---|
| a. Current ratio | (50% of ratio blend) | `lerp` anchors: 0.5→10, 1.0→40, 1.5→70, 2.0→90, 3.0→100 |
| b. Quick ratio | (50% of ratio blend) | `lerp` anchors: 0.3→10, 0.7→40, 1.0→70, 1.5→90, 2.0→100 |
| c. Cash-runway-in-months (only if cash-flow-negative) | modifier | `lerp` anchors: 0→0, 3→15, 6→35, 12→65, 24→90, 36→100 |

```
ratioScore = 0.5a + 0.5b
P3 = 0.70·ratioScore + 0.30·runwayScore
```
where `runwayScore = 100` by default (full liquidity credit on the runway
sub-metric) unless the borrower is flagged cash-flow-negative, in which case
`runwayScore` is computed from actual months of cash runway at current burn.

**Why runway defaults to 100, not to a penalty, when not applicable**: a
cash-flow-positive borrower has no burn rate to measure — treating an
inapplicable metric as "unknown" and penalizing confidence for it would be
wrong (it isn't missing, it's not a relevant question for this borrower), and
treating it as a low score would be a false negative on liquidity. Cash
runway only becomes a real, distinct liquidity risk signal once a borrower is
burning cash; the standard ratio anchors already reflect the standard
convention that 1.0x is minimally adequate and 1.5–2.0x is the healthy zone
for both current and quick ratio.

### P4. Profitability & Stability

| Sub-metric | Weight in P4 | Formula |
|---|---|---|
| a. EBITDA margin vs. sector median | 55% | `clamp(50 + (companyMargin − sectorMedianMargin) × 2.5, 0, 100)` |
| b. Margin volatility (coefficient of variation, trailing 3–5yr) | 45% | `lerp` anchors: 0.00→100, 0.10→85, 0.25→60, 0.50→30, 0.75→10 |

```
P4 = 0.55a + 0.45b
```

**Why volatility is scored independently of level, at meaningful weight**: two
borrowers can post an identical 14% average EBITDA margin over five years —
one steady at 13–15% every year, the other swinging from 22% to 4% and back.
Coverage and leverage ratios computed off a single trailing-twelve-month
snapshot cannot distinguish these, but a lender absolutely should: the volatile
borrower is one bad year away from breaching the same coverage covenant the
stable borrower would clear comfortably. Coefficient of variation
(stdev/mean of the margin series) captures this directly and is weighted
almost as heavily as the level itself (45% vs. 55%) because it is genuinely a
distinct risk axis, not a refinement of the same one.

### P5. Industry & Cyclicality Risk (1–5 rubric)

| Value | Anchor description |
|---|---|
| 1 | Highly cyclical / historically high-default sector — commodities, shipping, upstream energy, homebuilders |
| 2 | Meaningfully cyclical — industrials, discretionary retail, auto suppliers |
| 3 | Moderate — diversified manufacturing, most B2B services |
| 4 | Below-average cyclicality — branded consumer staples, healthcare services |
| 5 | Defensive / historically low-default sector — regulated utilities, essential consumer staples, government-contracted services |

```
P5 = likertToScore(cyclicalityRubric)
```

Rate against the sector's own multi-cycle historical default-rate experience
where available (rating-agency transition studies are the best public source
for this), not against a single recent year — a sector that looked defensive
through a benign five-year stretch is not automatically a 5.

### P6. Qualitative & Governance

| Sub-metric | Weight in P6 | Formula |
|---|---|---|
| a. Management quality / track record (1–5 rubric, see §5) | 40% | `likertToScore(rubricValue)` |
| b. Collateral quality (1–5 rubric, see §5; N/A if genuinely unsecured) | 30% | `likertToScore(rubricValue)`, or **60 (neutral)** if unsecured by design |
| c. Governance red flags (deductive) | 30% | Start at 100; `−15` per confirmed flag; floor 0 |

```
P6 = 0.40a + 0.30b + 0.30c
```

**Governance red-flag checklist (each confirmed flag is −15, stacking)**:

| Flag |
|---|
| Related-party transactions not on arm's-length terms |
| Audit qualification (going-concern note, disclaimer of opinion, material weakness) |
| Covenant breach history (any prior waiver or default event on existing facilities) |
| Management turnover instability (CFO/CEO departures outside a normal succession plan) |

**Handling the unsecured case explicitly**: if a facility is genuinely
unsecured by design — a covenant-lite unsecured revolver to an investment-grade
issuer, for example, not a secured deal where collateral simply hasn't been
valued yet — score the collateral sub-metric as **60 (the "Adequate" Likert
anchor), not as a penalty and not as missing data**. An unsecured structure is
a deliberate credit decision, not an information gap; scoring it as 0 would
wrongly conflate "no collateral because none was required" with "no
collateral because none is available," and scoring it as missing would wrongly
depress confidence for a field that was never applicable. This mirrors how P3
treats cash runway for cash-flow-positive borrowers (§4, P3) — an inapplicable
metric gets a neutral default, not a penalty.

If the facility *is* secured and the collateral-quality rubric is genuinely
unknown (not yet assessed, not "not applicable"), that is a real missing
field and should degrade confidence per §6 — do not default it to neutral in
that case.

---

## 5. Qualitative rubrics (Likert → score)

Used for P5, P6a, P6b, and any other 1–5 qualitative input. Anchors, not
vibes — write down which anchor description matches before picking a number.

| Value | Score | Anchor description |
|---|---|---|
| 1 | 10 | Absent / actively concerning |
| 2 | 35 | Weak — present but thin, easily challenged |
| 3 | 60 | Adequate — defensible, industry-standard |
| 4 | 80 | Strong — clearly above peer set |
| 5 | 100 | Exceptional — a genuine, hard-to-replicate advantage |

`likertToScore`: linear interpolation is fine for non-integer averages.

**Management quality / track record (P6a)** — rate against: years of
relevant-sector operating experience, history of hitting or missing prior
lender-reported projections, succession depth, and candor in prior diligence
processes (did management proactively flag problems, or did lenders find them
first?).

**Collateral quality (P6b)** — rate against: asset type and liquidity (cash
and receivables score higher than specialized fixed assets; specialized fixed
assets score higher than intangibles-only), appraisal recency and method,
loan-to-value coverage, and lien priority/perfection status as represented by
counsel. Score 60 (neutral) if unsecured by design — see §4.

**Industry & cyclicality (P5)**: see the dedicated table in §4 — this rubric
has its own anchor descriptions rather than the generic table above.

---

## 6. Confidence and missing data

Every pillar has a **required input list** (see `scripts/score.js`'s
`REQUIRED_FIELDS`). Before computing, count how many required fields are
missing or explicitly marked `"unknown"`.

```
completeness = 1 − (missingCount / totalRequiredFields)
```

- `completeness ≥ 0.9` → **High confidence**. Report the band as-is.
- `0.7 ≤ completeness < 0.9` → **Medium confidence**. Report the band with a
  note listing which pillars used estimates.
- `completeness < 0.7` → **Low confidence**. Prefix the output
  `"PRELIMINARY — insufficient data for a reliable score"` and explicitly
  recommend which documents/data would resolve the biggest gaps first
  (usually: audited financials and a debt schedule beat a management deck
  every time — prioritize closing leverage/coverage gaps over qualitative
  ones).

**Twelve core fields are unconditionally required**: the leverage, coverage,
liquidity, profitability, industry, and management-quality inputs listed as
`REQUIRED_FIELDS` in `scripts/score.js`. **Two fields are conditionally
required**, matching the graceful-N/A handling described in §4:

- `liquidity.cashRunwayMonths` is only required if `liquidity.isCashFlowNegative`
  is `true`. If the borrower is cash-flow-positive, this field is not counted
  against completeness at all.
- `qualitative.collateralQualityRubric` is only required if
  `qualitative.isSecuredLending` is `true`. If the deal is unsecured by
  design, this field is not counted against completeness at all.

**Opt-in, not opt-out**: `qualitative.governanceRedFlags` defaults to "nothing
found" when omitted, by design (an empty checklist reads as clean, not
unknown), matching the same convention used for risk-flag checklists in other
skills in this library. Only populate it from what the source material
actually supports — don't state "no governance flags" in a report unless you
actually looked for related-party transactions, audit qualifications,
covenant breach history, and management turnover. An unexamined borrower
defaulting to a clean P6c score is worse than a low-confidence score, because
nothing flags it as unexamined.

Never silently substitute a default value for a missing required field and
present the result as if it were measured. If a value is genuinely unknown,
pass `null` and let the completeness penalty apply — a lower-confidence real
answer beats a confident wrong one.

---

## 7. Worked example

Mid-market industrial components manufacturer, secured senior term loan
(first-lien on fixed assets). Full input is `scripts/example-input.json` — run
`node scripts/score.js example-input.json` to reproduce these numbers exactly
(they are copied straight from that output, not hand-estimated).

- Net Debt/EBITDA 3.8x vs. sector median 3.0x, Debt/Equity 1.4x
- EBITDA/Interest 3.2x, FCF/Total Debt Service 1.4x
- Current ratio 1.3x, quick ratio 0.9x, cash-flow-positive (no runway modifier)
- EBITDA margin 14% vs. sector median 12%, margin coefficient of variation
  (trailing 3–5yr) 0.18
- Industry cyclicality rubric = 3 (moderate — diversified industrial manufacturing)
- Management quality rubric = 4, secured lending with collateral-quality
  rubric = 4, one governance flag (prior covenant breach history)

```
P1: a = clamp(100 - max(0, 3.8-3.0)×12, 0, 100) = 100 - 9.6 = 90.4
    b = lerp(1.4, [1.0→80, 2.0→50]) = 80 + (1.4-1.0)/(2.0-1.0)×(50-80) = 68.0
P1 = 0.60(90.4) + 0.40(68.0) = 81.44

P2: a = lerp(3.2, [3.0→55, 6.0→85]) = 55 + (3.2-3.0)/(6.0-3.0)×30 = 57.0
    b = lerp(1.4, [1.25→50, 2.0→80]) = 50 + (1.4-1.25)/(2.0-1.25)×30 = 56.0
P2 = 0.55(57.0) + 0.45(56.0) = 56.55

P3: a = lerp(1.3, [1.0→40, 1.5→70]) = 40 + (1.3-1.0)/0.5×30 = 58.0
    b = lerp(0.9, [0.7→40, 1.0→70]) = 40 + (0.9-0.7)/0.3×30 = 60.0
    ratioScore = 0.5(58.0) + 0.5(60.0) = 59.0
    runwayScore = 100 (cash-flow-positive, no modifier applied)
P3 = 0.70(59.0) + 0.30(100) = 71.3

P4: a = clamp(50 + (14-12)×2.5, 0, 100) = 55.0
    b = lerp(0.18, [0.10→85, 0.25→60]) = 85 + (0.18-0.10)/0.15×(60-85) = 71.67
P4 = 0.55(55.0) + 0.45(71.67) = 62.5

P5 = likertToScore(3) = 60.0

P6: a = likertToScore(4) = 80.0
    b = likertToScore(4) = 80.0  (secured, collateral rubric = 4)
    c = clamp(100 - 1×15, 0, 100) = 85.0  (one governance flag: covenant breach history)
P6 = 0.40(80.0) + 0.30(80.0) + 0.30(85.0) = 81.5

PCRS = 0.25(81.44) + 0.20(56.55) + 0.15(71.3) + 0.15(62.5) + 0.10(60.0) + 0.15(81.5)
     = 20.36 + 11.31 + 10.695 + 9.375 + 6.0 + 12.225
     = 69.97 → rounds to 70.0
```

**Result: PCRS 70.0 — BB/B-equivalent (High Yield), indicative spread +250 to
+600 bps, High confidence (100% complete).**

This example lands right on top of the Investment-Grade cutoff, which is a
useful illustration of the model's boundary behavior: the *displayed*,
rounded score is exactly 70.0, but the rating band is assigned from the
unrounded raw composite (69.97), which falls a hair below the 70-point
Investment-Grade threshold — so this credit is reported as the top of
BB/B-equivalent, not the bottom of A/BBB-equivalent. Always let the script
make this call; hand-rounding before comparing to the band table is exactly
the kind of one-point drift a named, reproducible algorithm exists to
prevent. Coverage (P2, 56.6) and profitability/stability (P4, 62.5) are the
two pillars with the most room to move this borrower into Investment Grade —
the FCF/Total Debt Service ratio of 1.4x in particular is the single number
that would most efficiently lift the composite if amortization were
restructured or EBITDA grew.

---

## 8. Known limitations

- **Ratio-based scoring can be gamed by balance-sheet window-dressing.**
  Net Debt/EBITDA, Debt/Equity, and the liquidity ratios are all point-in-time
  snapshots as of a reporting date. A borrower can temporarily draw down cash
  to pay down debt, delay a payable, or accelerate a receivable collection
  right before a covenant test date or a loan application, then reverse the
  position the following quarter. Cross-check ratios against intra-period
  (monthly, not just quarterly) data where available, and be more skeptical
  of ratios measured exactly on a covenant test date than of ratios measured
  mid-quarter.
- **Sector-norm benchmarks must be current and correctly scoped, or leverage
  scoring is meaningless.** P1's entire design rests on comparing the
  borrower to its actual sector median leverage — a stale, too-broad
  (e.g. "all industrials" instead of the borrower's actual sub-sector), or
  mis-sourced comp set will silently bias the leverage score in either
  direction. Always record the comp set's source, scope, and as-of date
  alongside the score, same discipline as PDQI requires for its valuation
  comps.
- **The model does not independently verify covenant language or collateral
  perfection.** PCRS scores what is disclosed in financials and diligence
  notes — it has no mechanism to catch a cross-default clause, an
  unperfected lien, a subordination trap, or covenant-definition games (e.g.
  "EBITDA" adjusted well beyond a standard definition). Full legal/covenant
  review by counsel remains mandatory before closing; see §1.
- **Sudden macro or liquidity shocks can move a credit faster than
  quarterly-frequency scoring can capture.** PCRS is built on trailing
  financials and ratios that are, at best, refreshed quarterly. A credit that
  scored a clean Investment-Grade-equivalent 78 in Q1 can be genuinely
  distressed by Q3 following a demand shock, a supply-chain disruption, or a
  sudden funding-market freeze — none of which shows up in a backward-looking
  ratio until the next reporting cycle. Treat PCRS as a point-in-time
  snapshot that decays in reliability the longer it goes unrefreshed, and
  supplement it with real-time signals (payment behavior, covenant-compliance
  certificates, market-implied credit spreads on comparable issuers) between
  refreshes for any credit already near a band boundary.
- **Qualitative rubrics are analyst-dependent.** Two analysts can legitimately
  land one Likert point apart on management quality or collateral quality.
  Mitigate by having a second reviewer score P5/P6a/P6b independently on
  contested credits and averaging.
- **Not sector-agnostic in practice.** The Debt/Equity anchors and the
  margin-level baseline in P4 are tuned for a generalist mid-market
  industrial/services lens. A financial-services borrower (where D/E is
  structurally high by business model, not by risk) or a pre-revenue/early-
  stage credit will misscore on P1 and P4 almost by definition — for those
  borrower types, treat P1/P4 as directional only and weight P6 (qualitative)
  and direct covenant analysis more heavily.

## 9. Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-10 | Initial specification and reference implementation |

Any change to a weight, formula, or anchor value is a version bump with an
entry here — the whole point of a proprietary, named algorithm is that "PCRS
70" means the same thing every time it's quoted. Silent tuning defeats that.
