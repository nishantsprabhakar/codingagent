# Prabhakar Asset Viability Score (PAVS) — v1.0

**Proprietary scoring methodology for drug discovery / pharma pipeline asset
screening, developed by Nishant Prabhakar.**

Status: v1.0 (2026-08-10). Author/owner: Nishant Prabhakar. This document is
the authoritative specification — `scripts/score.js` is a direct, literal
implementation of the formulas below. If the two ever disagree, this document
is correct and the script has a bug.

Named in the tradition of other analyst-attributed scoring models (the Altman
Z-Score, the Piotroski F-Score) — the point of putting a name on a model is
that the name becomes shorthand for a specific, checkable methodology, not a
vibe. "PAVS 64" should mean the same thing regardless of who's asking or who's
answering.

---

## 1. Purpose and positioning

The PAVS is a **screening and prioritization tool**, not a substitute for full
clinical or regulatory diligence. It exists to do three things quickly and
consistently across a pipeline:

1. Convert a messy pile of trial readouts, competitive intelligence, and
   regulatory status into one comparable number for ranking assets against
   each other.
2. Force the same six questions to get answered for every asset, in the same
   way, so two reviewers scoring the same program land on the same number
   (±5 points).
3. Surface *which specific pillar* is weak, not just a vibe of "promising" —
   so the portfolio conversation is "the Phase 2 competitive density is the
   drag, not the biology" instead of "I like it."

It is deliberately **not** a black box: every sub-score is a named, auditable
formula against a named input. If an input is unknown, the algorithm says so
and degrades its confidence rating rather than guessing silently.

**What the PAVS is not**: it is not a substitute for full clinical or
regulatory diligence, not a clinical trial design tool, and not a
probability-of-technical-and-regulatory-success (PTRS) model calibrated to a
specific therapeutic area's real transition data — it uses aggregate
cross-industry base rates (§4, P1) as a starting anchor, not a bespoke
forecast. It scores the *asset's current evidence package*, not the trial
that should be run next. Run real biostatistics, a formal PTRS model, and
outside medical/regulatory review in parallel — the PAVS tells you which
assets are worth spending that review budget on first.

---

## 2. Structure at a glance

Six weighted pillars, each scored 0–100, rolled into one composite:

| Pillar | Weight | What it answers |
|---|---|---|
| P1. Clinical Stage & Historical Probability of Success | 25% | How far along is it, and does the modality itself carry extra risk or precedent? |
| P2. Efficacy Signal Strength | 20% | Is the effect real, or just a big number from a small, uncontrolled study? |
| P3. Safety & Tolerability | 15% | Is the therapeutic window competitive with what's already approved? |
| P4. Target / Mechanism Validation | 15% | Is the biology proven, or still a hypothesis? |
| P5. Competitive & Commercial Position | 15% | Will this asset matter commercially by the time it could launch? |
| P6. Regulatory & IP Risk | 10% | What could take the exclusivity or the pathway away? |

```
PAVS = 0.25·P1 + 0.20·P2 + 0.15·P3 + 0.15·P4 + 0.15·P5 + 0.10·P6
```

**Weighting rationale**: P1 and P2 together are 45% of the score by design —
stage-adjusted probability of success and the strength of the efficacy signal
are the two variables with the most evidence behind them (they come from
trial data, not from a slide), so they get the most weight. Safety, mechanism
validation, and competitive position are real but each individually softer or
more forward-looking, so they're weighted lower individually — though at 45%
combined they still dominate the second half of the score, which is
intentional: a clean mechanism, a tolerable safety profile, and a defensible
commercial position are what turn a plausible Phase 2 readout into a launched,
differentiated drug five years out. Regulatory/IP risk is weighted lowest
(10%) because it is usually a modifier on an otherwise-good or otherwise-bad
asset rather than the primary driver — but a bad enough IP problem can still
sink an asset, which is why P6 includes a hard deduction, not just a small
weight.

---

## 3. Score bands

| PAVS | Tier | Action |
|---|---|---|
| 80–100 | **Fast-track** | Prioritize resourcing; accelerate to next milestone |
| 65–79 | **Advance** | Continue on current development plan |
| 50–64 | **Monitor** | Continue, but flag the specific weak pillar for the next data readout to resolve |
| 35–49 | **Deprioritize** | De-emphasize resourcing unless a specific pillar (usually P2 or P4) is expected to improve with pending data |
| 0–34 | **Discontinue** | Recommend killing or out-licensing the program |

These bands assume **high confidence** inputs (see §6). Under low confidence,
treat the tier as directional only and widen the band by ±10 points in your
head before acting on it.

---

## 4. Pillar formulas

All sub-scores are clamped to `[0, 100]` after computation unless stated
otherwise. `clamp(x, lo, hi)` = min(max(x, lo), hi). `lerp` = piecewise-linear
interpolation between named anchor points.

### P1. Clinical Stage & Historical Probability of Success

| Sub-component | Role in P1 | Formula |
|---|---|---|
| a. Base stage score | Primary driver | Table lookup on current development stage (below) |
| b. Modality adjustment | Additive modifier | `+10` if well-precedented modality (small molecule, or a monoclonal antibody with an approved precedent in the same target class); `−15` if a novel modality with no approved precedent (e.g. a novel gene-therapy vector, a first-in-class mechanism); `0` otherwise |

Base stage scores are approximate **industry-aggregate probability-of-success
base rates** by current stage (drawn from cross-industry phase-transition
studies, e.g. BIO/QLS-style clinical development success-rate benchmarks) —
they describe the historical average asset at that stage, **not a claim about
this specific asset's odds**. Treat them as the starting prior that P2–P6
should update, not the final word:

| Stage | Base score |
|---|---|
| Preclinical | 8 |
| Phase 1 | 52 |
| Phase 2 | 29 |
| Phase 3 | 58 |
| Filed / NDA | 90 |

Phase 2 scoring lower than Phase 1 is not a typo: it reflects the well-known
"Phase 2 graveyard" effect in aggregate industry data, where a disproportionate
share of programs fail specifically at the efficacy-in-patients hurdle that
Phase 2 exists to test — Phase 1 mostly just needs to clear a safety bar.

```
P1 = clamp(baseStageScore + modalityAdjustment, 0, 100)
```

### P2. Efficacy Signal Strength

| Sub-component | Role in P2 | Formula |
|---|---|---|
| a. Effect size vs. standard of care | Primary driver | `lerp` anchors on relative % improvement over SOC (e.g. % reduction implied by hazard ratio, or absolute response-rate delta as a % of the SOC rate): 0%→15, 15%→45, 35%→70, 60%→90, ≥90%→100 |
| b. Evidence-quality gate | Overriding cap | If the result is **not** statistically significant (p > 0.05) **or** comes from an open-label / uncontrolled / single-arm design, cap the effective score at `min(raw, 50)` regardless of the raw effect size |

```
P2 = effectiveEffectSizeScore   (after the gate in (b) is applied)
```

**Why the gate exists**: a large effect size from an uncontrolled or
underpowered study is a promising anecdote, not evidence — capping at 50
keeps such a result in "worth funding the next study" territory without
letting it read as equivalent to a confirmed, powered, controlled result. This
mirrors the PE algorithm's hypergrowth guard (two data points isn't a trend;
one open-label cohort isn't proof).

### P3. Safety & Tolerability

| Sub-component | Role in P3 | Formula |
|---|---|---|
| a. Relative Grade 3+ adverse-event rate | Sole driver | `ratio = candidateGrade3PlusAEsPct / socGrade3PlusAEsPct`; `lerp` on ratio: 0.25→95, 0.5→85, 0.75→70, 1.0→55, 1.5→30, ≥2.0→10 |

```
P3 = lerp(ratio, anchors above)
```

**Why "same as SOC" (ratio = 1.0) scores 55, not near 100**: matching the
comparator's safety profile is *adequate*, not *differentiated* — it earns a
passing-but-unremarkable score, the same design choice the PE algorithm makes
for "paying the sector median multiple." A meaningfully cleaner safety profile
than the standard of care is what actually moves prescribing and payer
behavior, so it's rewarded steeply; a worse profile is punished steeply, since
tolerability is often the deciding factor once efficacy is roughly comparable
across a drug class.

### P4. Target / Mechanism Validation

| Sub-component | Role in P4 | Formula |
|---|---|---|
| a. Target/mechanism validation (1–5 rubric, see §5) | Sole driver | `likertToScore(rubricValue)` |

```
P4 = likertToScore(targetValidationRubric)
```

### P5. Competitive & Commercial Position

| Sub-component | Weight in P5 | Formula |
|---|---|---|
| a. Competitive density | 40% | Count of Phase 2-or-later competing programs sharing the same mechanism **and** same primary indication; `lerp` inverse: 0→100, 2→75, 5→50, 10→25, ≥15→10 |
| b. Population size × pricing power (joint) | 60% | `0.5 × marketSizeScore + 0.5 × pricingPowerScore` (both below) |

Market size score is **not** monotonically increasing with population — it is
`lerp` on addressable patient population: 5,000→60, 50,000→75, 500,000→90,
≥2,000,000→70. Pricing power score is `likertToScore(pricingPowerRubric)`,
a 1–5 rubric (see §5).

```
P5 = 0.40a + 0.60b
```

**Why population size is not "bigger is better"**: a very large, primary-care
scale indication (≥2M patients) typically comes with genericized comparators,
heavy payer pushback, and price erosion — the curve peaks around 500,000
addressable patients and *declines* past 2,000,000 to reflect that dynamic.
Pairing population size with pricing power in the same joint sub-score is
what lets a small, orphan population with strong pricing power (rare disease,
premium specialty pricing, faster regulatory pathway) score comparably to, or
better than, a much larger population with weak, commodity-level pricing
power. Neither dimension alone is the answer; §5 gives the pricing-power
rubric anchors.

### P6. Regulatory & IP Risk (baseline-and-modify)

| Component | Effect |
|---|---|
| Baseline | 60 |
| Regulatory designation bonus | `+10` per designation held (orphan drug, breakthrough therapy, fast track, accelerated approval pathway), **cap total bonus at +30** |
| Patent runway modifier (years of exclusivity remaining post-expected-launch) | `<5 years → −20`; `5–10 years → 0`; `>10 years → +10` (tiered step modifier — no interpolation within a band) |
| Unresolved IP dispute or freedom-to-operate concern | Hard `−25` if present |

```
P6 = clamp(60 + designationBonus + patentModifier − ipPenalty, 0, 100)
```

**Why baseline 60, not 50**: an asset with no regulatory designations and a
mid-range patent runway is not automatically a coin-flip on regulatory/IP
risk — the absence of a designation is the normal case for most programs at
Phase 1/2, not a red flag. The deductions and bonuses move the score away from
that neutral-favorable starting point based on specific, named facts, the
same deductive pattern the PE algorithm uses for its risk pillar.

---

## 5. Qualitative rubrics (Likert → score)

Used for P4a and P5's pricing-power sub-metric, and any other 1–5 qualitative
input. Anchors, not vibes — write down which anchor description matches
before picking a number.

| Value | Score | Anchor description |
|---|---|---|
| 1 | 10 | Absent / actively concerning |
| 2 | 35 | Weak — present but thin, easily challenged |
| 3 | 60 | Adequate — defensible, industry-standard |
| 4 | 80 | Strong — clearly above peer set |
| 5 | 100 | Exceptional — a genuine, hard-to-replicate advantage |

`likertToScore`: linear interpolation is fine for non-integer values (e.g. a
rubric value of 3.5 → score 70).

**Target / mechanism validation rubric (P4a)**:
- **1** — Mechanistic hypothesis only; no supportive human or robust
  preclinical data.
- **2** — Some preclinical signal, but weak, single-model, or non-translatable
  (e.g. only in vitro, no relevant animal model).
- **3** — Validated in relevant preclinical disease models, plus some
  translational biomarker signal suggesting the mechanism engages in the
  intended way.
- **4** — Strong translational biomarker linkage, or partial human evidence
  (e.g. genetic association data in a related but not identical population).
- **5** — Mechanism already validated in humans: genetic evidence directly
  in the target population, an approved drug acting through the same target
  in a different indication, or a validated biomarker with demonstrated
  clinical-outcome linkage.

**Pricing power rubric (P5b)**:
- **1** — Commodity pricing expected; comparator class is genericized or
  heavily price-competitive with no differentiation basis.
- **2** — Modest premium supportable, but payer pushback likely given weak
  differentiation from SOC.
- **3** — Moderate, defensible premium pricing; industry-standard specialty
  pricing dynamics apply.
- **4** — Strong premium pricing likely — biomarker-selected population,
  meaningful clinical differentiation, specialty/limited-distribution
  dynamics.
- **5** — Exceptional pricing power — orphan/ultra-rare population, high
  unmet need, and a faster regulatory pathway supporting premium orphan-style
  pricing with limited payer resistance.

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
  recommend which data would resolve the biggest gaps first (usually: a
  controlled-trial readout beats a competitive-intelligence estimate every
  time — prioritize closing efficacy/safety data gaps over commercial
  estimates).

Never silently substitute a default value for a missing required field and
present the result as if it were measured. If a value is genuinely unknown,
pass `null` and let the completeness penalty apply — a lower-confidence real
answer beats a confident wrong one.

---

## 7. Worked example

Phase 2 targeted small-molecule oncology asset, second-line setting, against a
chemotherapy standard of care. Full input is `scripts/example-input.json` —
run `node scripts/score.js scripts/example-input.json` to reproduce these
numbers exactly (they're copied straight from that output).

- Development stage: Phase 2. Modality: small molecule with an approved
  precedent already on the market in the same target class.
- Efficacy: 35% relative improvement over SOC on the primary endpoint,
  statistically significant, randomized controlled design.
- Safety: 28% Grade 3+ AE rate vs. 35% for SOC.
- Mechanism: target-validation rubric = 4 (strong translational biomarker
  linkage plus partial human evidence).
- Competitive: 4 Phase-2-or-later programs sharing the same mechanism and
  indication; addressable population ~45,000 patients; pricing-power rubric
  = 4.
- Regulatory: breakthrough therapy + fast track designations held; 9 years of
  patent runway remaining post-expected-launch; no unresolved IP dispute.

```
P1: baseStageScore = 29 (Phase 2), modalityAdjustment = +10 (well-precedented)
    P1 = clamp(29 + 10, 0, 100) = 39.0

P2: raw = lerp(35%, anchors incl. [35,70]) = 70.0 (35% lands exactly on an anchor point)
    significant = true, controlled = true → gate not triggered
    P2 = 70.0

P3: ratio = 28 / 35 = 0.8
    P3 = lerp(0.8, [0.75,70]→[1.0,55]) = 70 + (0.8-0.75)/(1.0-0.75)×(55-70) = 67.0

P4: P4 = likertToScore(4) = 80.0

P5: a = lerp(4, [2,75]→[5,50]) = 75 + (4-2)/(5-2)×(50-75) = 58.3
    marketSizeScore = lerp(45000, [5000,60]→[50000,75])
                     = 60 + (45000-5000)/(50000-5000)×15 = 73.3
    pricingPowerScore = likertToScore(4) = 80.0
    b = 0.5×73.3 + 0.5×80.0 = 76.7
    P5 = 0.40×58.3 + 0.60×76.7 = 69.3

P6: designationBonus = min(30, 2×10) = 20
    patentModifier = 0 (9 years falls in the 5–10 band)
    ipPenalty = 0
    P6 = clamp(60 + 20 + 0 − 0, 0, 100) = 80.0

PAVS = 0.25(39.0) + 0.20(70.0) + 0.15(67.0) + 0.15(80.0) + 0.15(69.3) + 0.10(80.0)
     = 9.75 + 14.0 + 10.05 + 12.0 + 10.4 + 8.0 = 64.2
```

**Result: PAVS 64.2 — Monitor tier**, High confidence (100% complete). The
asset is one pillar away from Advance (65): P1 (39.0) is the clear drag,
driven almost entirely by the Phase 2 base rate itself rather than anything
asset-specific — that is the pillar to watch closely at the next readout, and
the one where a positive interim result would move the score the most. P3
(67.0) and P5 (69.3) are both solid but unremarkable; neither is a priority to
chase relative to getting P1's underlying stage risk resolved by advancing to
Phase 3.

---

## 8. Known limitations

- **Preclinical and early-clinical efficacy signals are weakly predictive of
  eventual human efficacy at scale**, especially animal-model results — a
  strong preclinical or small-Phase-2 signal narrows uncertainty but does not
  close it. Treat P2 scores based on small-n or single-arm data as directional
  even when the statistical-significance gate isn't triggered by design
  (e.g. a well-powered but still small pivotal-adjacent study).
- **The competitive landscape in P5 changes fast and goes stale quickly.**
  A competitor's Phase 3 failure or a new entrant's Phase 2 readout can shift
  the competitive-density sub-score materially within a single quarter —
  re-run P5 on a defined cadence (at minimum, at every internal portfolio
  review), not just when this asset itself has news.
- **Regulatory designations can be granted, and can also be lost or fail to
  translate into an approval advantage.** A breakthrough therapy or fast
  track designation reflects the regulator's view at a point in time; it is
  not a guarantee, and designations occasionally get revisited if later data
  disappoints. Don't treat P6's designation bonus as permanent — re-verify it
  is still current before quoting a score.
- **Modality-specific manufacturing and CMC risk is not captured anywhere in
  this model.** Cell and gene therapies, in particular, carry manufacturing,
  supply-chain, and scale-up risks that can delay or kill a program
  independently of clinical data — P1's novel-modality penalty partially
  captures development-risk correlation but is not a substitute for a real
  CMC/manufacturing risk assessment.
- **Historical phase-transition base rates (P1) are cross-indication
  aggregates.** Actual success rates vary substantially by therapeutic area
  (e.g. oncology transition rates differ materially from those in
  infectious disease or CNS) — where area-specific benchmark data is
  available and more relevant than the generic aggregate, note it as a
  qualitative override on the P1 read-through rather than silently
  substituting it into the formula (a formula change is a version bump, not
  an ad hoc substitution).
- **The model scores the evidence package, not the underlying biology's true
  probability of success**, which is unknowable in advance. A well-run,
  well-documented Phase 1 with modest results will out-score a genuinely
  more promising but poorly-documented one — that is a feature (confidence
  should track evidence quality) but is worth stating explicitly so a low
  score isn't over-read as "the biology is bad."

## 9. Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-10 | Initial specification and reference implementation |

Any change to a weight, formula, or anchor value is a version bump with an
entry here — the whole point of a proprietary, named algorithm is that "PAVS
64" means the same thing every time it's quoted. Silent tuning defeats that.
