# Nishant Insurance Underwriting Score (NIUS) — v1.0

**Proprietary scoring methodology for commercial property (P&C) underwriting
risk assessment, developed by Nishant Prabhakar.**

Status: v1.0 (2026-08-15). Author/owner: Nishant Prabhakar. This document is
the authoritative specification — `scripts/score.js` is a direct, literal
implementation of the formulas below. If the two ever disagree, this document
is correct and the script has a bug.

Named in the tradition of other analyst-attributed scoring models (the Altman
Z-Score, the Piotroski F-Score) — the point of putting a name on a model is
that the name becomes shorthand for a specific, checkable methodology, not a
vibe. "NIUS 79" should mean the same thing regardless of who's asking or who's
answering.

---

## 1. Purpose and positioning

**Line of business scored: commercial property insurance** (first-party
property damage — building, business personal property, and business
interruption/time-element coverage written on a commercial risk). This is a
deliberate, narrow choice. Commercial P&C underwriting spans property,
general liability, workers' comp, auto, and professional lines (E&O/D&O),
and each has genuinely different risk drivers — a liability submission is
scored on operations/hazard class and claims-made trigger mechanics, not on
construction type and protection class. Trying to build one generic "P&C
score" would force every pillar into vague, line-agnostic language that
doesn't actually match how any single line is underwritten in practice. NIUS
v1.0 is precise about commercial property specifically; scoring general
liability or E&O/D&O well would mean re-deriving the exposure and coverage
pillars from that line's actual hazard drivers, not reusing these anchors
(see §8 and the note in `SKILL.md` on extending this skill).

The NIUS exists to do three things quickly and consistently across a
submission pipeline:

1. Convert a commercial property submission — loss runs, statement of
   values (SOV), COPE data, financial statements, broker market
   intelligence — into one comparable number.
2. Force the same six questions to get answered for every submission, in the
   same way, so two underwriters scoring the same risk land on the same
   number (±5 points) and reach the same decision tier.
3. Surface *which specific pillar* is driving the decision, not just a vibe
   of "this account feels risky" — so the file note is "protection class 7
   with a 9% supply — actually, wait, wrong domain — with a hail-exposed cat
   zone and no sprinklers" instead of "not thrilled about this one."

Six pillars were chosen to cover the standard, non-overlapping questions a
commercial property underwriter actually works through on a submission,
without collapsing distinct judgment calls into one bucket:

- **Loss History & Experience** and **Exposure Quality (COPE)** are the two
  hardest, most evidence-backed pillars — one is what has actually happened,
  the other is what the physical risk actually is. Together they carry half
  the score by design, mirroring how an underwriter reads a loss run and a
  SOV before anything else.
- **Financial Strength & Moral Hazard** is kept separate from loss history
  because it answers a different question: not "has this risk generated
  losses" but "is there a claims-culture or moral-hazard signal independent
  of the loss experience itself" (prior non-renewals, litigation posture,
  financial distress that could motivate a large loss).
- **Risk Management & Controls Quality** is kept separate from exposure
  quality because COPE describes the building; this pillar describes what
  the insured actually *does* about the risks the building presents (safety
  programs, loss-control follow-through, continuity planning) — a fixable,
  forward-looking variable rather than a fixed physical characteristic.
- **Coverage & Limits Adequacy** and **Market/Pricing Context** are the two
  pillars about the *deal*, not the *risk* — is the requested structure sized
  correctly to the exposure, and is the price/terms context viable — kept
  separate from the first four because a genuinely low-risk property can
  still be a bad piece of business if it's underpriced or under-limited, and
  a genuinely higher-risk property can still be good business at the right
  price and structure.

It is deliberately **not** a black box: every sub-score is a named, auditable
formula against a named input. If an input is unknown, the algorithm says so
and degrades its confidence rating rather than guessing silently.

**What the NIUS is not**: a substitute for a real engineering inspection, a
catastrophe-modeling platform's PML output, or actuarial rate-indication
work. It scores the *submission as presented* against standard commercial
property underwriting judgment — it does not independently verify a
statement of values, re-run a cat model, or audit financial statements.
Commission those in parallel; the NIUS tells you whether the submission is
worth that further diligence and roughly what terms to aim for.

---

## 2. Structure at a glance

Six weighted pillars, each scored 0–100, rolled into one composite:

| Pillar | Weight | What it answers |
|---|---|---|
| P1. Loss History & Experience | 25% | What has this risk actually cost, and is it getting better or worse? |
| P2. Exposure Quality (COPE) | 25% | What is the physical risk actually made of, occupied by, and exposed to? |
| P3. Financial Strength & Moral Hazard | 15% | Is there a claims-culture or moral-hazard signal behind the numbers? |
| P4. Risk Management & Controls Quality | 15% | Is the insured actively managing the risk, or just carrying it? |
| P5. Coverage & Limits Adequacy | 10% | Is the requested structure sized correctly to the actual exposure? |
| P6. Market/Pricing Context | 10% | Is the price/terms context viable, and is this account worth keeping? |

```
NIUS = 0.25·P1 + 0.25·P2 + 0.15·P3 + 0.15·P4 + 0.10·P5 + 0.10·P6
```

**Weighting rationale**: P1 and P2 together are 50% of the score by design —
loss experience and physical exposure quality are the two variables with the
most direct, verifiable evidence behind them (they're in the loss run and the
SOV/COPE data), and they are the foundation every other judgment sits on top
of. A pristine building with a terrible loss history is still a bad risk; a
rough loss history on a well-built, well-protected building is more
explicable and correctable than the reverse. P3 and P4 (financial
strength/moral hazard, risk management/controls) are real, standard
underwriting factors but are more qualitative and forward-looking than P1/P2,
so they're weighted lower individually at 15% each — 30% combined, enough to
swing a borderline file but not enough to overwhelm demonstrated loss
experience and physical risk quality. P5 and P6 (coverage/limits adequacy,
market/pricing context) are about the deal rather than the underlying risk —
real and can make or break whether binding the account makes sense, but
bounded in how much they should move the *risk* assessment itself, so they're
weighted lowest at 10% each.

---

## 3. Score bands / tiers

| NIUS | Tier | Underwriting action | Pricing/terms implication |
|---|---|---|---|
| 85–100 | **Preferred** | Bind at preferred terms | Rate credit consideration (e.g. −5% to −10% off indicated); minimal added conditions |
| 70–84 | **Standard** | Bind at standard terms | Rate flat to indicated, or modest credit; standard policy conditions |
| 55–69 | **Standard with conditions** | Bind, but with required risk-management conditions and/or a rate load | Rate load of roughly +10% to +20%; make named loss-control recommendations binding warranties, not suggestions |
| 40–54 | **Substandard** | Refer to senior underwriter; bind only with substantial mitigants | Rate load of roughly +25% or more, and/or a materially higher deductible/retention; consider sublimits or exclusions on the weakest pillar |
| 0–39 | **Decline** | Do not bind at current terms | Requires a materially different submission (corrected exposure data, resolved large-loss history, or a much higher retention) before reconsideration |

These bands assume **high confidence** inputs (see §6). Under low confidence,
treat the tier as directional only and widen the band by ±10 points in your
head before acting on it — and never bind at Preferred/Standard terms on a
Low-confidence score; refer it instead.

---

## 4. Pillar formulas

All sub-scores are clamped to `[0, 100]` after computation unless stated
otherwise. `clamp(x, lo, hi)` = min(max(x, lo), hi). `lerp` = piecewise-linear
interpolation between named anchor points.

### P1. Loss History & Experience

| Sub-metric | Weight in P1 | Formula |
|---|---|---|
| a. 5-year trailing loss ratio (incurred losses / earned premium, %) | 40% | `lerp` anchors: 20%→100, 40%→85, 60%→65, 80%→40, 100%→20, 120%→5 |
| b. Loss frequency trend (annualized % change in claim count, trailing 3–5yr) | 30% | `lerp` anchors: −15%→95, −5%→80, 0%→60, 10%→35, 25%→10 |
| c. Large-loss / catastrophic-loss presence (trailing 5yr) | 30% | `clamp(95 − 20 × min(largeLossCount, 3) − (hasCatLoss ? 15 : 0), 0, 100)` |

```
P1 = 0.40a + 0.30b + 0.30c
```

**Why 85, not 100, is the baseline for a 40% loss ratio**: a 5-year loss
ratio in the low-to-mid 40s is a genuinely good, comfortably profitable
result for a commercial property book, not merely adequate — it earns a
strong-but-not-perfect score, leaving room above it for exceptionally clean
accounts (sub-25% loss ratio) to score higher still. Every 20 points of loss
ratio above 40% costs roughly 15–20 score points, reflecting how quickly a
worsening loss ratio erodes underwriting profitability at the account level.

**Large/cat-loss presence (c) as a standard red-flag metric**: presence of
even one large loss (a single loss materially eroding the account's loss
ratio, e.g. exceeding roughly 25% of total insured value or a named dollar
threshold) or any catastrophe-related loss (named windstorm, flood,
earthquake) in the trailing five years is treated as a standalone signal
independent of the aggregate loss ratio, because a single large or cat loss
can sit inside an otherwise-acceptable 5-year loss ratio while still
indicating a real, undiversified tail-risk exposure the aggregate number
hides. Each large loss (up to three) costs 20 points; a catastrophe-related
loss costs a further flat 15 points regardless of count, because CAT losses
correlate with the peril-specific exposure the account will keep facing
every year going forward, not a one-off.

### P2. Exposure Quality (COPE)

Named for the standard commercial property underwriting framework:
**C**onstruction, **O**ccupancy, **P**rotection, **E**xposure.

| Sub-metric | Weight in P2 | Formula |
|---|---|---|
| a. Construction class rubric (1–5, see §5) | 30% | `likertToScore(constructionClassRubric)` |
| b. Occupancy hazard rubric (1–5, see §5) | 25% | `likertToScore(occupancyHazardRubric)` |
| c. Protection class (ISO Public Protection Classification, PPC 1–10; 1 = best-protected) | 25% | `lerp` anchors: 1→100, 3→85, 5→65, 7→40, 10→15 |
| d. Natural catastrophe exposure zone rubric (1–5, see §5) | 20% | `likertToScore(catExposureZoneRubric)` |

```
P2 = 0.30a + 0.25b + 0.25c + 0.20d
```

**ISO Protection Class as a standard input**: the Public Protection
Classification (1 best-protected, 10 essentially unprotected) is a real,
standard commercial property underwriting and rating factor published by
ISO/the applicable state rating bureau, driven by local fire department
capability, water supply, and dispatch — it is not a proprietary invention
of this model, only the scoring curve applied to it is. A property in PPC 1–3
sits in a materially different risk tier than one in PPC 8–10 independent of
anything else about the building.

**Why Construction leads Occupancy in weight**: construction type (frame vs.
joisted masonry vs. non-combustible vs. fire-resistive) is the single most
durable driver of fire-loss severity and is essentially fixed for the life of
the building, whereas occupancy hazard, while also weighted heavily, can
shift if tenancy or use changes — construction gets the marginally higher
weight because it is the harder physical constraint.

### P3. Financial Strength & Moral Hazard

| Sub-metric | Weight in P3 | Formula |
|---|---|---|
| a. Insured financial stability rubric (1–5, see §5) | 40% | `likertToScore(financialStabilityRubric)` |
| b. Prior non-renewals/cancellations by other carriers (trailing 5yr, count) | 30% | `lerp` anchors: 0→95, 1→65, 2→40, 3→20, 4→5 |
| c. Litigation/adverse legal history rubric (1–5, see §5) | 30% | `likertToScore(litigationHistoryRubric)` |

```
P3 = 0.40a + 0.30b + 0.30c
```

**Prior non-renewals/cancellations as a moral-hazard proxy**: a prior carrier
declining to renew or cancelling mid-term is one of the most standard,
carrier-visible signals in commercial underwriting that something about the
account's risk or claims behavior concerned an informed counterparty who had
direct loss-experience access the current underwriter may not fully have —
each instance is treated as a steep, compounding penalty (a single
non-renewal costs 30 points off a clean 95) rather than a mild deduction,
because the *reason* for a non-renewal is so often exactly the kind of latent
risk a fresh submission's numbers alone won't show.

**Why financial stability matters independent of loss history**: an
insured under financial distress has a structurally different incentive
around a covered loss (proceeds relief) than a financially healthy one —
this is the standard "moral hazard" concern in insurance economics, and it
is scored as its own input rather than inferred from the loss run, because a
clean loss history from a now-distressed insured is not evidence the
incentive problem doesn't exist going forward.

### P4. Risk Management & Controls Quality

| Sub-metric | Weight in P4 | Formula |
|---|---|---|
| a. Safety program maturity rubric (1–5, see §5) | 35% | `likertToScore(safetyProgramRubric)` |
| b. Loss-control recommendations implemented (% of outstanding recs closed) | 40% | `lerp` anchors: 0%→20, 50%→50, 75%→70, 90%→90, 100%→100 |
| c. Business continuity / disaster recovery planning rubric (1–5, see §5) | 25% | `likertToScore(businessContinuityRubric)` |

```
P4 = 0.35a + 0.40b + 0.25c
```

**Loss-control implementation rate as the heaviest sub-metric**: whether an
insured actually closes out a prior engineering/loss-control survey's
recommendations is a real, standard underwriting file item and the single
best forward-looking behavioral signal in this pillar — a insured that
implements 90%+ of recommendations is demonstrating exactly the kind of
active risk ownership that predicts a better loss trajectory than the
current loss run alone would suggest, which is why it is weighted above even
the safety-program rubric itself.

### P5. Coverage & Limits Adequacy

| Sub-metric | Weight in P5 | Formula |
|---|---|---|
| a. Requested limit vs. probable maximum loss (PML) ratio | 40% | `limitToPmlRatio = requestedLimitUSD / pmlUSD`; `lerp` anchors: 0.5→15, 0.75→40, 0.9→60, 1.0→80, 1.15→95, 1.5→100 |
| b. Deductible/retention level (% of total insured value) | 30% | `lerp` anchors: 0.1%→30, 0.5%→55, 1%→75, 2%→90, 5%→100 |
| c. Layering / reinsurance structure quality rubric (1–5, see §5) | 30% | `likertToScore(layeringStructureRubric)` |

```
P5 = 0.40a + 0.30b + 0.30c
```

**PML as the standard property benchmark, not total insured value (TIV)**:
Probable Maximum Loss — the largest loss reasonably expected from a single
event given the building's construction, protection, and exposure, as
distinct from its full replacement value — is the real, standard benchmark
commercial property limits are underwritten against; a limit at or modestly
above PML (ratio ≥ 1.0) is properly sized, while a limit well below PML means
the insured (and, on a shared/layered placement, the carrier) is exposed to
an uninsured gap on exactly the loss scenario that matters most.

**Over-insurance guard**: if `limitToPmlRatio > 2.0` (the requested limit is
more than double the estimated PML), cap the *effective* contribution of (a)
at 90 regardless of the raw `lerp` result, and flag
`"requested_limit_far_exceeds_pml"` in the output. A limit far in excess of
realistic maximum loss is a standard moral-hazard red flag in property
underwriting in its own right (overinsurance can motivate deliberate
loss or neglect of upkeep) as much as it is evidence of thorough coverage —
the model refuses to reward an extreme ratio without qualification, the same
way NREIS refuses to reward an extreme mark-to-market rent gap without one.

**Retention level as an alignment signal**: a higher retention (deductible)
relative to total insured value means the insured retains more of the
frequency layer itself, which both reduces adverse selection on small,
attritional claims and aligns the insured's incentives with the carrier's —
this is a real, standard lever carriers use to underwrite better business,
which is why it is scored on its own rather than folded into limits
adequacy.

### P6. Market/Pricing Context

| Sub-metric | Weight in P6 | Formula |
|---|---|---|
| a. Rate adequacy (quoted rate vs. actuarially indicated rate need, % spread) | 45% | `rateAdequacyPct = (quotedRatePct − indicatedRatePct) / indicatedRatePct × 100`; `lerp` anchors: −20%→10, −10%→30, 0%→60, 10%→85, 20%→100 |
| b. Competitive market conditions rubric (1–5, see §5) | 25% | `likertToScore(competitiveMarketRubric)` |
| c. Account retention value / strategic value rubric (1–5, see §5) | 30% | `likertToScore(accountRetentionValueRubric)` |

```
P6 = 0.45a + 0.25b + 0.30c
```

**Rate adequacy as the dominant sub-metric**: whether the quoted rate meets
or exceeds the actuarially indicated rate need is the single most direct
determinant of whether binding this account is profitable business
independent of how good the underlying risk is — a genuinely excellent risk
quoted well below indicated rate need is still bad business, which is why
this sub-metric carries the most weight in P6 and, unlike the risk-quality
pillars, is allowed to swing the pricing-context score sharply on its own.

**Below-indicated-rate flag**: if `rateAdequacyPct < −15`, the pillar flags
`"rate_likely_inadequate"` — a spread that wide is a standard signal to
revisit pricing before binding regardless of what the other five pillars
show, since no amount of risk quality offsets systematically underpriced
premium over a multi-year book.

---

## 5. Qualitative rubrics (1–5 Likert → score)

Used for P2a (construction class), P2b (occupancy hazard), P2d (cat exposure
zone), P3a (financial stability), P3c (litigation history), P4a (safety
program), P4c (business continuity), P5c (layering/reinsurance structure),
P6b (competitive market conditions), and P6c (account retention value).
Anchors, not vibes — write down which anchor description matches before
picking a number.

| Value | Score | Anchor description |
|---|---|---|
| 1 | 10 | Absent / actively concerning |
| 2 | 35 | Weak — present but thin, easily challenged |
| 3 | 60 | Adequate — defensible, market-standard |
| 4 | 80 | Strong — clearly above peer set |
| 5 | 100 | Exceptional — a genuine, hard-to-replicate advantage |

`likertToScore`: linear interpolation is fine for non-integer averages (e.g.
a construction-class rubric average of 3.5 → score 70).

**Construction class (P2a)**: 5 = fire-resistive (reinforced concrete/protected
steel); 4 = non-combustible or masonry non-combustible (e.g. tilt-up concrete
or masonry walls with a non-combustible roof); 3 = joisted masonry (masonry
walls, combustible roof/floor); 1 = frame (combustible walls and roof
structure) with no compensating protection.

**Occupancy hazard (P2b)**: 5 = low-hazard occupancy (e.g. office, light
storage of non-combustible goods); 3 = moderate-hazard occupancy (e.g.
general warehousing/light manufacturing with ordinary combustibles); 1 =
high-hazard occupancy (e.g. woodworking, spray-painting/finishing, chemical
processing, or other operations with elevated fire/explosion load).

**Natural catastrophe exposure zone (P2d)**: 5 = low-exposure zone (inland,
low wind/seismic/flood designation); 3 = moderate-exposure zone (some
convective storm/hail or moderate wind exposure, non-coastal); 1 =
high-exposure zone (coastal high-wind/named-storm zone, high seismic zone,
or FEMA high-risk flood zone) without compensating mitigation (e.g. wind
mitigation features, elevation certificates).

**Financial stability (P3a)**: 5 = strong balance sheet, investment-grade or
equivalent credit profile, multiple years of stable/improving financials; 3
= adequate, unremarkable financials with no red flags but no independent
verification beyond what was provided; 1 = visible financial distress
(covenant breaches, going-concern language, materially declining revenue/
margins).

**Litigation history (P3c)**: 5 = no material litigation exposure, clean
public record; 3 = ordinary-course litigation consistent with the insured's
size and industry, nothing unusual; 1 = a pattern of material litigation,
especially claims-related or regulatory litigation, suggesting an elevated
claims-culture or compliance risk.

**Safety program maturity (P4a)**: 5 = a documented, actively audited safety
program with measurable outcomes (e.g. declining OSHA recordables) and
clear ownership; 3 = a documented program that exists and is followed but
isn't independently audited; 1 = no meaningful documented safety program.

**Business continuity / disaster recovery planning (P4c)**: 5 = a tested,
documented business continuity plan with defined recovery time objectives
and evidence of at least one real test/drill; 3 = a documented plan that
exists but hasn't been tested recently; 1 = no documented continuity plan.

**Layering / reinsurance structure quality (P5c)**: 5 = a well-structured
primary/excess tower with adequate limits at each layer and appropriate
facultative or treaty reinsurance support for cat-exposed layers; 3 = a
single-layer placement that is adequate but has no excess/umbrella backup;
1 = a thin or poorly structured placement leaving a material gap between
the primary limit and realistic total exposure.

**Competitive market conditions (P6b)**: 5 = a hard market with limited
carrier capacity chasing this risk type, giving significant underwriter
pricing power; 3 = a balanced market with adequate but not abundant
competing capacity; 1 = a soft, heavily competitive market with abundant
capacity chasing this risk type, constraining achievable price and terms.

**Account retention value (P6c)**: 5 = a longstanding, profitable
relationship with strong broker alignment and genuine cross-sell/account-
rounding potential; 3 = an adequate, unremarkable relationship with no
particular strategic upside or downside; 1 = a new or transactional
relationship with no broker alignment and no retention value beyond this
single policy.

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
  recommend which documents would resolve the biggest gaps first (usually: a
  real 5-year loss run beats a broker's summary loss history every time, and
  a current statement of values with COPE detail beats a prior-year
  renewal's SOV — prioritize closing loss-history and exposure-data gaps
  before qualitative ones).

Never silently substitute a default value for a missing required field and
present the result as if it were measured. If a value is genuinely unknown,
pass `null` (or `"unknown"`) and let the completeness penalty apply — a
lower-confidence real answer beats a confident wrong one.

---

## 7. Worked example

Mid-size distribution/warehouse facility submission, commercial property
line. Full input is `scripts/example-input.json` — run
`node scripts/score.js scripts/example-input.json` to reproduce these numbers
exactly (they're copied straight from that output).

- 5-year trailing loss ratio 42%, loss frequency trend −8%/yr, one large loss
  in the trailing 5 years, no catastrophic loss
- Construction class rubric 4 (non-combustible tilt-up), occupancy hazard
  rubric 4 (general storage, low-moderate hazard), ISO protection class 3,
  cat exposure zone rubric 3 (moderate — some convective storm/hail
  exposure)
- Financial stability rubric 4, zero prior non-renewals/cancellations,
  litigation history rubric 4
- Safety program rubric 4, 85% of loss-control recommendations implemented,
  business continuity rubric 3
- Requested limit $25,000,000 vs. PML $20,000,000, retention 1.0% of TIV,
  layering/reinsurance structure rubric 4
- Quoted rate 0.85 vs. indicated rate need 0.80, competitive market rubric
  3, account retention value rubric 4

```
P1: a = lerp(42, [40→85, 60→65]) = 85 + (42-40)/20×(-20) = 83.0
    b = lerp(-8, [-15→95, -5→80]) = 95 + (-8-(-15))/10×(-15) = 84.5
    c = clamp(95 - 20×min(1,3) - 0, 0, 100) = 95 - 20 = 75.0
P1 = 0.40(83.0) + 0.30(84.5) + 0.30(75.0) = 33.2 + 25.35 + 22.5 = 81.05

P2: a = likert(4) = 80
    b = likert(4) = 80
    c = lerp(3, [1→100, 3→85]) = 85.0
    d = likert(3) = 60
P2 = 0.30(80) + 0.25(80) + 0.25(85) + 0.20(60) = 24.0 + 20.0 + 21.25 + 12.0 = 77.25

P3: a = likert(4) = 80
    b = lerp(0, [0→95, 1→65]) = 95.0
    c = likert(4) = 80
P3 = 0.40(80) + 0.30(95) + 0.30(80) = 32.0 + 28.5 + 24.0 = 84.5

P4: a = likert(4) = 80
    b = lerp(85, [75→70, 90→90]) = 70 + (85-75)/15×20 = 83.33
    c = likert(3) = 60
P4 = 0.35(80) + 0.40(83.33) + 0.25(60) = 28.0 + 33.33 + 15.0 = 76.33

P5: limitToPmlRatio = 25,000,000/20,000,000 = 1.25
    a = lerp(1.25, [1.15→95, 1.5→100]) = 95 + (1.25-1.15)/0.35×5 = 96.43 (no cap; ratio ≤ 2.0)
    b = lerp(1.0, [0.5→55, 1→75]) = 75.0
    c = likert(4) = 80
P5 = 0.40(96.43) + 0.30(75.0) + 0.30(80) = 38.57 + 22.5 + 24.0 = 85.07

P6: rateAdequacyPct = (0.85-0.80)/0.80×100 = 6.25%
    a = lerp(6.25, [0→60, 10→85]) = 60 + 6.25/10×25 = 75.625
    b = likert(3) = 60
    c = likert(4) = 80
P6 = 0.45(75.625) + 0.25(60) + 0.30(80) = 34.03 + 15.0 + 24.0 = 73.03

NIUS = 0.25(81.05) + 0.25(77.25) + 0.15(84.5) + 0.15(76.33) + 0.10(85.07) + 0.10(73.03)
     = 20.26 + 19.31 + 12.68 + 11.45 + 8.51 + 7.30 = 79.5
```

**Result: NIUS 79.5 — Standard tier.** Bind at standard terms, rate flat to
indicated. The two pillars doing the most work here are P5 (coverage &
limits adequacy, 85.1 — a requested limit modestly above PML with a
reasonable 1% retention and a solid layering structure) and P3 (financial
strength & moral hazard, 84.5 — clean financials, zero prior non-renewals,
no adverse litigation). The pillar with the most room to improve is P6
(market/pricing context, 73.0) — the 6.25% rate-adequacy spread is healthy,
but a "3" on competitive market conditions (a balanced, not favorable, market)
caps how much upside pricing power exists here; and P4 (risk management &
controls, 76.3) would benefit most from a tested business continuity plan
(currently rubric 3) rather than only a documented one — worth re-running
through `score.js` if the account can produce evidence of a recent BCP test
before going firm on terms.

---

## 8. Known limitations

- **PML estimates are only as good as their source.** Probable Maximum Loss
  is itself a modeled estimate (engineering judgment, cat model output, or a
  broker-supplied figure), not an observed fact — a stale or overly
  optimistic PML will silently understate how exposed a "well-limited"
  account (P5a) actually is. Always record the PML's source (in-house
  engineering, third-party cat model, broker estimate) and as-of date
  alongside the score, the same way a comp set's recency matters in real
  estate underwriting.
- **The model does not independently verify a statement of values or COPE
  data.** P2 scores what the submission's SOV and COPE fields say — it
  cannot catch an inaccurate construction-class entry or an outdated
  protection-class lookup. A clean P2 score on unverified SOV data is not
  the same thing as a verified building.
- **Loss-run completeness affects P1 more than any other pillar.** A loss
  run that only covers 3 years instead of 5, or that excludes
  subrogation/salvage recoveries inconsistently across years, will distort
  both the loss-ratio and frequency-trend sub-metrics — treat P1 as
  provisional until a full, carrier-certified 5-year loss run (not a
  broker's informal summary) is in hand.
- **Catastrophe exposure zone data can lag actual peril modeling.** The P2d
  rubric is a coarse categorical judgment; for any account with a
  non-trivial wind, flood, or seismic exposure, it should be treated as
  directional and cross-checked against an actual cat-model run (e.g.
  RMS/AIR/Verisk output) before finalizing terms on a Standard-or-better
  tier, not relied on as the final word.
- **Qualitative rubrics are analyst-dependent.** Two underwriters can
  legitimately land one Likert point apart on construction class, occupancy
  hazard, or any of the other seven rubric fields. Mitigate by having a
  second reviewer score contested rubrics independently on borderline files
  and averaging.
- **Not line-of-business-agnostic.** Every anchor value here (loss-ratio
  bands, PPC curve, PML-ratio bands) is tuned specifically for commercial
  property. Applying this model as-is to general liability, workers' comp,
  auto, or professional lines (E&O/D&O) will misscore badly — those lines'
  exposure and coverage-adequacy questions are fundamentally different (e.g.
  liability is scored on operations/hazard class and claims-made trigger
  mechanics, not construction and protection class). See `SKILL.md`'s
  extension note before adapting this model to another line.

---

## 9. Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-15 | Initial specification and reference implementation |

Any change to a weight, formula, or anchor value is a version bump with an
entry here — the whole point of a proprietary, named algorithm is that
"NIUS 79" means the same thing every time it's quoted. Silent tuning defeats
that.
