# Nishant M&A Synergy & Integration Score (NMSI) — v1.0

**Proprietary scoring methodology for merger & acquisition synergy realism
and integration-risk screening, developed by Nishant Prabhakar.**

Status: v1.0 (2026-08-12). Author/owner: Nishant Prabhakar. This document is
the authoritative specification — `scripts/score.js` is a direct, literal
implementation of the formulas below. If the two ever disagree, this document
is correct and the script has a bug.

Named in the tradition of other analyst-attributed scoring models (the Altman
Z-Score, the Piotroski F-Score) — the point of putting a name on a model is
that the name becomes shorthand for a specific, checkable methodology, not a
vibe. "NMSI 71" should mean the same thing regardless of who's asking or who's
answering.

---

## 1. Purpose and positioning

The NMSI is a **screening and diligence-triage tool for a specific proposed
transaction between two named parties** — an acquirer and a target — not a
tool for judging whether either company is independently attractive as a
standalone investment (that's `private-equity-analysis`'s NDQI). It exists to
answer one question corp-dev and deal teams ask on every deal: *is the
synergy case real, and can these two organizations actually integrate well
enough to capture it?*

**Why six pillars, and why these six.** M&A post-mortems consistently trace
failed deals back to a small number of recurring root causes, and the pillar
set below maps directly onto them, chosen to be genuinely non-overlapping:

1. **Revenue-synergy realism** and **2. Cost-synergy realism** are split into
   separate pillars because they fail for different reasons and at different
   rates. Cost synergies (headcount, facilities, procurement) are
   comparatively mechanical and get realized far more often than promised;
   revenue synergies (cross-sell, pricing power, new-market access) are
   consistently the least reliable line in every deal model because they
   depend on customer behavior nobody in the deal controls. Netting them into
   one "synergies" pillar would hide exactly the distinction a reader needs —
   which dollars are load-bearing engineering and which are hope.
2. **Cultural/organizational fit** is split out from execution mechanics
   because people problems (leadership flight, culture clashes, incompatible
   decision cultures) kill deals that pass every financial screen — it's a
   people-risk pillar, not a process-risk one.
3. **Integration complexity** captures the structural/mechanical difficulty
   of the integration itself (systems, regulatory approval, relative deal
   size) — distinct from culture (who wants to stay and work together) and
   from governance (whether anyone has a plan to manage the mechanics).
4. **Valuation & deal-structure discipline** is its own pillar because a deal
   can have a genuinely realistic synergy case and still destroy value if the
   acquirer overpays for it or structures the payment with no downside
   protection — this is the classic distinction between "the synergies are
   real" and "the price already assumes they're real, twice."
5. **Execution governance** is split from integration complexity because
   complexity is a property of the deal (given, not controllable after
   signing), while governance — IMO quality, day-1/day-100 plan specificity,
   retention package design — is a property of *how well the acquirer is
   preparing to handle that complexity*, and is squarely within management's
   control. Two deals with identical complexity can have very different
   governance quality, and that gap is often the actual determinant of
   whether synergies show up on schedule.

It is deliberately **not** a black box: every sub-score is a named, auditable
formula against a named input. If an input is unknown, the algorithm says so
and degrades its confidence rating rather than guessing silently.

**What the NMSI is not**: a full fairness opinion, an accretion/dilution
model, or a legal antitrust risk assessment. It scores the *synergy and
integration case*, not the deal's pro forma EPS. Run those analyses in
parallel — the NMSI tells you whether the synergy assumptions feeding them
are credible enough to be worth modeling precisely.

---

## 2. Structure at a glance

Six weighted pillars, each scored 0–100, rolled into one composite:

| Pillar | Weight | What it answers |
|---|---|---|
| P1. Revenue-Synergy Realism | 20% | Is the cross-sell/adjacency math grounded in evidence, or wishful "synergy slide" arithmetic? |
| P2. Cost-Synergy Realism | 20% | Do the claimed run-rate savings match the actual overlap in G&A, facilities, and procurement? |
| P3. Cultural & Organizational Fit | 15% | Will the people who matter still be there in 18 months, and will the two cultures actually work together? |
| P4. Integration Complexity | 20% | How mechanically hard is this integration, independent of anyone's plan to manage it? |
| P5. Valuation & Deal-Structure Discipline | 15% | Are we paying a fair price for the synergies, and are we protected if they don't show up? |
| P6. Execution Governance | 10% | Is there an actual plan, with named owners and named milestones, or just a slide with a synergy number on it? |

```
NMSI = 0.20·P1 + 0.20·P2 + 0.15·P3 + 0.20·P4 + 0.15·P5 + 0.10·P6
```

**Weighting rationale**: P1 and P2 together are 40% of the score by design —
the synergy case is the entire economic rationale for paying a premium in the
first place, so its credibility dominates. P4 (integration complexity) is
weighted equally with each synergy pillar at 20% because a mechanically
brutal integration can strand an otherwise-credible synergy case regardless
of intent. P3 and P5 sit at 15% each — real and material, but one step
removed from the core synergy math (culture determines *whether* the plan
executes; price discipline determines *how much room for error* the deal
has). P6 (governance) is weighted lowest at 10% deliberately: a great IMO and
a crisp Day-1 plan cannot manufacture synergies that were never realistic in
the first place (P1/P2) or overcome complexity that was structurally always
going to be hard (P4) — governance quality matters most as a tie-breaker
between two deals with similar underlying economics, not as a primary driver
of the score.

---

## 3. Score bands

| NMSI | Tier | Action |
|---|---|---|
| 80–100 | **High-conviction synergy case** | Proceed — the synergy math is evidenced and integration risk is manageable; finalize terms and lock in the synergy targets management communicates externally |
| 65–79 | **Credible, but verify weak links** | Proceed to signing; re-underwrite the lowest-scoring pillar before locking today's synergy targets into board materials or market guidance |
| 50–64 | **Conditional — proceed only with mitigants** | Proceed only if specific mitigants are put in place first (renegotiated price, a real earnout tied to synergy milestones, a dedicated IMO) |
| 35–49 | **Weak — synergy case needs rework** | Do not communicate the current synergy targets externally; revisit deal thesis, price, or structure before proceeding |
| 0–34 | **Synergy math likely won't materialize** | Decline, or fundamentally restructure the deal — the claimed synergies are not supported by the evidence gathered |

These bands assume **high confidence** inputs (see §6). Under low confidence,
treat the tier as directional only and widen the band by ±10 points in your
head before acting on it.

---

## 4. Pillar formulas

All sub-scores are clamped to `[0, 100]` after computation unless stated
otherwise. `clamp(x, lo, hi)` = min(max(x, lo), hi). `lerp` = piecewise-linear
interpolation between named anchor points.

### P1. Revenue-Synergy Realism

| Sub-metric | Weight in P1 | Formula |
|---|---|---|
| a. Claimed revenue synergy as % of target's standalone revenue | 40% | `pct = claimedAnnualRevenueSynergy / targetStandaloneRevenue × 100` (0 if revenue unknown); `lerp` anchors: 0%→50, 3%→75, 6%→90, 12%→60, 20%→30, ≥30%→10 |
| b. Market-adjacency / cross-sell credibility (1–5 rubric, see §5) | 35% | `likertToScore(rubricValue)` |
| c. Acquirer's historical revenue-synergy capture rate on prior deals | 25% | `clamp(priorDealsRevenueSynergyCaptureRatePct, 0, 100)` (defaults to 50 — industry-average capture — if the acquirer has no prior-deal track record on file) |

```
P1 = 0.40a + 0.35b + 0.25c
```

**Why (a) is a peak, not a ramp**: a claim of 0% revenue synergy on a
"strategic" deal is not itself good news — it usually means no real
cross-sell rationale was underwritten, which is a mild yellow flag, not a
clean pass (hence the anchor starts at 50, not 100). But past roughly 12% of
the target's standalone revenue, claimed revenue synergies enter territory
that is rarely realized in practice — the industry's own post-close tracking
consistently shows revenue synergies land well below plan, and outsized
claims deserve outsized skepticism unless (b) and prior deals support them.
This is the steepest-penalty sub-metric in the pillar for exactly that
reason.

### P2. Cost-Synergy Realism

| Sub-metric | Weight in P2 | Formula |
|---|---|---|
| a. Claimed cost synergy as % of target's cost base (COGS+SG&A) | 35% | `pct = claimedAnnualCostSynergy / targetCostBase × 100` (0 if cost base unknown); `lerp` anchors: 0%→40, 5%→70, 12%→90, 20%→70, 35%→40, ≥50%→10 |
| b. Itemized (bottom-up) coverage of the claimed number | 40% | `clamp(itemizedSynergyCoveragePct, 0, 100)`; `+10` bonus (cap 100) if `thirdPartyValidated` is true |
| c. Headcount / facilities / procurement overlap magnitude | 25% | `pct = headcountOrFacilitiesOverlapPct`; `lerp` anchors: 0%→30, 10%→55, 20%→75, 35%→90, ≥50%→100 |

```
P2 = 0.35a + 0.40b + 0.25c
```

**Why (b) carries the most weight**: the single biggest tell for whether a
cost-synergy number is real is whether it's a top-down percentage applied to
a cost base ("we'll take out 10% of combined SG&A") or a bottom-up,
line-item build (named facility closures, named system consolidations, named
headcount reductions by function). A high itemized-coverage percentage means
someone has actually done the work of finding the dollars; a low one means
the number is still an assertion.

### P3. Cultural & Organizational Fit

| Sub-metric | Weight in P3 | Formula |
|---|---|---|
| a. Key-leader retention coverage (% of identified key leaders/talent with signed retention agreements or equity rollover) | 35% | `clamp(keyLeaderRetentionCoveragePct, 0, 100)` (defaults to 0 if unknown — absence of evidence is not evidence of retention) |
| b. Acquirer's prior M&A integration track record | 30% | Rubric: `"none"`→30, `"adhoc"`→50, `"dedicated_pmi"`→75, `"dedicated_pmi_plus_advisor"`→95 |
| c. Cultural/organizational distance (1–5 rubric, see §5) | 35% | `likertToScore(rubricValue)` |

```
P3 = 0.35a + 0.30b + 0.35c
```

### P4. Integration Complexity

| Sub-metric | Weight in P4 | Formula |
|---|---|---|
| a. Relative deal size (deal value ÷ acquirer's enterprise value) | 35% | `pct = dealValue / acquirerEnterpriseValue × 100`; `lerp` anchors: ≤5%→95, 15%→75, 30%→50, 50%→25, ≥75%→10 |
| b. Systems/ERP & operational-overlap complexity (1–5 rubric, see §5) | 35% | `likertToScore(rubricValue)` |
| c. Regulatory/antitrust complexity (1–5 rubric, see §5) | 30% | `likertToScore(rubricValue)` |

```
P4 = 0.35a + 0.35b + 0.30c
```

**Note on direction**: this pillar scores *ease*, not *difficulty* — a small,
simple, low-regulatory-friction deal scores high; a large, systemically
tangled, antitrust-heavy deal scores low. Higher NMSI always means "better
deal," so every sub-metric here is oriented the same way as the other five.

### P5. Valuation & Deal-Structure Discipline

| Sub-metric | Weight in P5 | Formula |
|---|---|---|
| a. Entry EV/EBITDA multiple vs. comparable-transaction median | 40% | `premiumPct = (entryEvEbitdaMultiple − comparableTransactionMedianMultiple) / comparableTransactionMedianMultiple`; `clamp(70 − premiumPct × 100, 0, 100)` |
| b. Pro forma leverage vs. sector-serviceable norm (Net Debt/EBITDA) | 30% | `clamp(100 − max(0, proFormaNetDebtToEbitda − sectorMedianLeverage) × 15, 0, 100)` |
| c. Earnout/contingent-structure quality (1–5 rubric, see §5) | 30% | `likertToScore(rubricValue)` |

```
P5 = 0.40a + 0.30b + 0.30c
```

**Why 70, not 100, is the baseline for (a)**: paying exactly the comparable-
transaction median multiple is *fair*, not *good* — it earns a
passing-but-unremarkable score. Every 10% paid above the comp median costs
10 points; every 10% below earns 10 points back. This mirrors the same logic
NDQI applies to entry price in a standalone investment: price paid is the
single most controllable driver of realized returns, so it gets the steepest
lever in the pillar.

### P6. Execution Governance

| Sub-metric | Weight in P6 | Formula |
|---|---|---|
| a. Integration Management Office (IMO) quality | 40% | Rubric: `"none"`→30, `"adhoc"`→50, `"dedicated_imo"`→75, `"dedicated_imo_plus_advisor"`→95 |
| b. Day-1/Day-100 plan specificity (count of *evidenced* named workstream plans with milestones) | 35% | 0 workstreams→20, 1–2→45, 3–4→70, ≥5→90 |
| c. Retention-package design quality for key talent (1–5 rubric, see §5) | 25% | `likertToScore(rubricValue)` |

```
P6 = 0.40a + 0.35b + 0.25c
```

"Evidenced" in (b) means named and substantiated (an IT cutover plan with a
target date, a customer-communications plan, a finalized org design, a
synergy-execution roadmap with owners) — a bullet reading "integration
planning underway" does not count as a workstream; it counts as a slide.
Note (c) is distinct from P3a: P3a measures *how much* key-talent retention
is covered (a coverage percentage); P6c measures the *design quality* of the
retention packages themselves (vesting structure, milestone-linkage,
clawbacks) — a plan can cover 100% of key leaders with a weak, one-year,
no-strings package, which is a governance-quality problem, not a coverage
problem.

---

## 5. Qualitative rubrics (Likert → score)

Used for P1b, P3c, P4b, P4c, P5c, P6c, and any other 1–5 qualitative input.
Anchors, not vibes — write down which anchor description matches before
picking a number.

| Value | Score | Anchor description |
|---|---|---|
| 1 | 10 | Absent / actively concerning |
| 2 | 35 | Weak — present but thin, easily challenged |
| 3 | 60 | Adequate — defensible, industry-standard |
| 4 | 80 | Strong — clearly above peer set |
| 5 | 100 | Exceptional — a genuine, hard-to-replicate advantage |

`likertToScore`: linear interpolation is fine for non-integer averages.

**Market-adjacency / cross-sell credibility (P1b)**: is there genuine
product-market adjacency between acquirer and target customer bases, backed
by pilot programs, signed letters of intent, or comparable prior deals where
the same cross-sell thesis played out? A "1" is an unevidenced assertion; a
"5" is a demonstrated, piloted, quantified adjacency.

**Cultural/organizational distance (P4/P3c)**: rate geography, language,
management style (hierarchical vs. flat), decision-making culture, and
compensation philosophy as a package. A "1" is maximally distant (different
continents, languages, and management philosophies with no prior working
relationship); a "5" is near-identical operating cultures (e.g., a
same-market competitor with an already-similar org structure).

**Systems/ERP & operational-overlap complexity (P4b)**: rate the technical
difficulty of consolidating core systems (ERP, CRM, billing) and duplicative
operational footprints (regional offices, warehouses). A "1" is maximally
complex (fully incompatible systems across multiple geographies with no
planned single platform); a "5" is minimal (already-converged or
near-identical systems, single ERP achievable with light lift).

**Regulatory/antitrust complexity (P4c)**: rate the expected regulatory path.
A "1" is a multi-jurisdiction second-request/Phase-2 antitrust review with a
divestiture likely; a "5" is no meaningful regulatory review required
(single jurisdiction, well below any notification threshold).

**Earnout/contingent-structure quality (P5c)**: rate how well the deal
structure protects the acquirer against synergy non-realization — earnouts
tied to real, verifiable milestones, escrow, clawback rights, and seller
equity rollover that keeps incentives aligned post-close. A "1" is an
all-cash, no-contingency structure with zero downside protection; a "5" is a
structure where a meaningful share of consideration is genuinely at risk
against synergy delivery.

**Retention-package design quality (P6c)**: rate the design (not the
coverage — see P3a) of retention packages for identified key talent —
multi-year vesting, cliff structures, and explicit linkage to integration
milestones score higher than flat signing bonuses with no strings attached.

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
  recommend which documents/data would resolve the biggest gaps first
  (usually: a real itemized synergy bridge beats a headline synergy number
  every time — prioritize closing P1/P2 gaps over governance/cultural ones).

Never silently substitute a default value for a missing required field and
present the result as if it were measured. If a value is genuinely unknown,
pass `null` and let the completeness penalty apply — a lower-confidence real
answer beats a confident wrong one. (The numeric fallbacks used internally by
`score.js` when a field is missing — e.g. 0 for retention coverage, 50 for
prior-deal synergy capture rate — exist only so the arithmetic can still run;
they are not claims about the deal, and the missing-field count is what
actually drives the confidence rating reported to the user.)

---

## 7. Worked example

Hypothetical horizontal tech acquisition: **Atlas Health Systems**
(acquirer — hospital IT / EHR software platform) proposing to acquire
**Meridian Clinical Analytics** (target — clinical data analytics SaaS,
adjacent product line, overlapping hospital-system customer base). Full
input is `scripts/example-input.json` — run
`node scripts/score.js scripts/example-input.json` to reproduce these numbers
exactly (they're copied straight from that output).

- Claimed annual revenue synergy $18M vs. target standalone revenue $220M;
  market-adjacency rubric = 4; acquirer's prior-deal revenue-synergy capture
  rate 55%
- Claimed annual cost synergy $30M vs. target cost base $150M; itemized
  coverage 65% (no third-party validation); headcount/facilities overlap 22%
- Key-leader retention coverage 70%; acquirer integration track record =
  "dedicated_pmi"; cultural distance rubric = 3
- Deal value $650M vs. acquirer enterprise value $4.3B; systems complexity
  rubric = 3; regulatory/antitrust complexity rubric = 4
- Entry multiple 14.5x EV/EBITDA vs. comparable-transaction median 12.8x;
  pro forma Net Debt/EBITDA 4.2x vs. sector-serviceable norm 3.5x; earnout
  structure quality rubric = 3
- IMO quality = "dedicated_imo"; 4 evidenced Day-1/Day-100 workstreams;
  retention-package design quality rubric = 4

```
P1: a = 18/220×100 = 8.18% → lerp([6,90],[12,60]) = 90 + (8.18-6)/(12-6)×(60-90) = 79.1
    b = likert(4) = 80
    c = clamp(55, 0, 100) = 55
P1 = 0.40(79.1) + 0.35(80) + 0.25(55) = 31.6 + 28.0 + 13.75 = 73.4

P2: a = 30/150×100 = 20% → anchor exactly at [20,70] = 70
    b = clamp(65, 0, 100) = 65 (no third-party bonus)
    c = 22% → lerp([20,75],[35,90]) = 75 + (22-20)/(35-20)×(90-75) = 77.0
P2 = 0.35(70) + 0.40(65) + 0.25(77.0) = 24.5 + 26.0 + 19.25 = 69.75

P3: a = clamp(70, 0, 100) = 70
    b = "dedicated_pmi" = 75
    c = likert(3) = 60
P3 = 0.35(70) + 0.30(75) + 0.35(60) = 24.5 + 22.5 + 21.0 = 68.0

P4: a = 650/4300×100 = 15.12% → lerp([15,75],[30,50]) = 75 + (15.12-15)/(30-15)×(50-75) = 74.8
    b = likert(3) = 60
    c = likert(4) = 80
P4 = 0.35(74.8) + 0.35(60) + 0.30(80) = 26.2 + 21.0 + 24.0 = 71.2

P5: premiumPct = (14.5-12.8)/12.8 = 13.28% → a = clamp(70-13.28, 0, 100) = 56.7
    b = clamp(100 - max(0, 4.2-3.5)×15, 0, 100) = 100 - 10.5 = 89.5
    c = likert(3) = 60
P5 = 0.40(56.7) + 0.30(89.5) + 0.30(60) = 22.7 + 26.85 + 18.0 = 67.5

P6: a = "dedicated_imo" = 75
    b = 4 workstreams = 70
    c = likert(4) = 80
P6 = 0.40(75) + 0.35(70) + 0.25(80) = 30.0 + 24.5 + 20.0 = 74.5

NMSI = 0.20(73.4) + 0.20(69.75) + 0.15(68.0) + 0.20(71.2) + 0.15(67.5) + 0.10(74.5)
     = 14.68 + 13.95 + 10.20 + 14.24 + 10.13 + 7.45 = 70.6
```

**Result: NMSI 70.6 — Credible, but verify weak links tier.** Proceed to
signing, but re-underwrite the two weakest pillars before locking the
synergy targets into board materials: P5 (67.5, valuation/deal-structure
discipline — the 13.3% premium over comparable-transaction multiples is
doing most of the damage here) and P3 (68.0, cultural fit — the cultural
distance rubric of 3 is merely "adequate," not "strong"). A larger
milestone-linked earnout (moving P5c from 3 to 4) or a firmer retention
package tied to actual culture-integration milestones would each lift the
composite by roughly half a point to a point.

---

## 8. Known limitations

- **Comparable-transaction sets must be sourced and dated.** "Comparable
  median multiple" (P5a) is only as good as the comp set behind it — a stale
  or mis-scoped M&A comp set will silently bias P5 in either direction.
  Always record the comp set's source and as-of date alongside the score.
- **Qualitative rubrics are analyst-dependent.** Two analysts can legitimately
  land one Likert point apart on cultural distance or systems complexity.
  Mitigate by having a second reviewer score contested rubrics independently
  and averaging.
- **Revenue-synergy anchors assume a generalist commercial-adjacency lens.**
  The P1a peak (favoring claims in the 3–12% of target-revenue range) is
  tuned for cross-sell/up-sell theses. A deal whose revenue synergy comes
  from something structurally different (e.g., regulatory-driven pricing
  power in a rate-regulated utility merger) should treat P1a as directional
  only and lean more heavily on the P1b rubric's evidentiary judgment.
- **The model rewards clean data.** A genuinely strong deal with a thin or
  unaudited synergy bridge will score lower on confidence, not on merit —
  don't conflate the two when presenting results.
- **Not a substitute for antitrust counsel or a fairness opinion.** P4c and
  P5a are directional screens, not legal or valuation-advisory conclusions —
  treat a low P4c score as "get antitrust counsel involved early," not as a
  standalone regulatory risk assessment.

## 9. Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-12 | Initial specification and reference implementation |

Any change to a weight, formula, or anchor value is a version bump with an
entry here — the whole point of a proprietary, named algorithm is that
"NMSI 71" means the same thing every time it's quoted. Silent tuning defeats
that.
