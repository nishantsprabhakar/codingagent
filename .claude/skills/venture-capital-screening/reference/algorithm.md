# Nishant Startup Traction Score (NSTS) — v1.0

**Proprietary scoring methodology for early-stage venture capital / startup
screening (pre-seed through Series B), developed by Nishant Prabhakar.**

Status: v1.0 (2026-08-10). Author/owner: Nishant Prabhakar. This document is
the authoritative specification — `scripts/score.js` is a direct, literal
implementation of the formulas below. If the two ever disagree, this document
is correct and the script has a bug.

Named in the tradition of other analyst-attributed scoring models (the Altman
Z-Score, the Piotroski F-Score) — the point of putting a name on a model is
that the name becomes shorthand for a specific, checkable methodology, not a
vibe. It's also formalizing something VCs already do informally: every
partner meeting eventually asks "how's the team, how big is the market, is
there real traction" — NSTS just forces those judgments into named, weighted,
auditable sub-scores instead of a gut-feel average. "NSTS 71" should mean the
same thing regardless of who's asking or who's answering.

---

## 1. Purpose and positioning

The NSTS is a **deal-flow triage tool**, not a substitute for diligence and
absolutely not a valuation model. It exists to do one job well: take a firm
that sees hundreds of inbound pitches and get to a fast, consistent,
comparable pass/fail-ish read on each one, so partner time goes to the
opportunities that clear a bar — not to every deck that lands in the inbox.

It exists to do three things quickly and consistently across a funnel:

1. Convert a pitch deck, a data-room, and a set of scrappy early metrics into
   one comparable number, usable across a pipeline of wildly different-looking
   companies (a bio-adjacent SaaS tool and a fintech marketplace should still
   land on the same 0–100 scale via the same six questions).
2. Force the same six questions to get asked of every company, in the same
   way, so two analysts screening the same pitch land on the same number
   (±5 points) — and so "I don't love the team" becomes "domain expertise
   rubric = 2, no prior startup experience, and the technical co-founder gap
   is unaddressed" instead of a vibe.
3. Surface *which specific pillar* is weak, so the next conversation with the
   founder (if there is one) is targeted — "come back with 3 more months of
   retention data" instead of a form-letter pass.

**What the NSTS is explicitly not:**

- **Not a valuation model.** It says nothing about what the company is worth;
  §4's P6 pillar checks whether the *ask* is reasonably priced against the
  company's own traction stage, which is a sanity check, not a valuation.
- **Not an IRR or ownership-return forecaster.** Run real portfolio-construction
  math separately — NSTS tells you whether a deal is worth spending diligence
  time on, not what it will return.
- **Not a guarantee of outcome, and it should never be presented as one.**
  This needs to be said plainly: most startups that score well on this model
  will still fail. That is not a flaw in the model — it is the base-rate
  reality of early-stage venture, where the large majority of funded companies
  return less than invested capital even when the team, market, and product
  looked strong at the time of the check. NSTS improves *consistency and speed
  of triage*; it does not — cannot — repeal the power-law economics of the
  asset class. Treat a high score as "worth the partner's time," never as
  "safe."

It is deliberately **not** a black box: every sub-score is a named, auditable
formula or rubric against a named input. If an input is unknown, the
algorithm says so and degrades its confidence rating rather than guessing
silently — this matters more here than in later-stage investing, because
early-stage companies legitimately have less documented history to draw on
(see §6).

---

## 2. Structure at a glance

Six weighted pillars, each scored 0–100, rolled into one composite:

| Pillar | Weight | What it answers |
|---|---|---|
| P1. Founder & Team Quality | 25% | Can this specific team actually execute this specific plan? |
| P2. Market Opportunity | 20% | Is the prize big enough, and is now actually the right time? |
| P3. Traction & PMF Signals | 20% | Is anything real happening yet, and does it stick? |
| P4. Product & Technology Differentiation | 15% | If this works, how hard is it for someone else to copy? |
| P5. Unit Economics Trajectory | 10% | When the company does spend/earn money, is the underlying math sound? |
| P6. Round Terms & Dilution | 10% | Are we paying a sane price for this stage, and is the cap table clean? |

```
NSTS = 0.25·P1 + 0.20·P2 + 0.20·P3 + 0.15·P4 + 0.10·P5 + 0.10·P6
```

**Weighting rationale**: P1 and P2 together are 45% of the score by design —
at pre-seed through Series B, the business itself is still mostly a bet on
*who* is building and *how big the room is*, because the financial evidence
that would let you underwrite the business directly usually doesn't exist
yet. That's the single biggest structural difference from the NDQI (the PE/
growth sibling of this model): NDQI weights realized financial trajectory at
25% because it's measurable and dominant; NSTS can't do that honestly this
early, so it shifts that weight onto team and market, the two things that
*do* have signal before revenue does. P3 (traction) is weighted 20% because
early metrics — while noisy (see §8) — are still the closest thing to
objective evidence a young company has. P4, P5, and P6 matter but are
weighted lower individually: technology differentiation and round terms are
real but second-order at this stage, and unit economics (P5) is frequently
not yet measurable at all, which is exactly why it carries the lowest weight
and the most forgiving confidence treatment (§6).

---

## 3. Score bands

| NSTS | Tier | Action |
|---|---|---|
| 80–100 | **Fast-track to partner meeting** | Prioritize; get this in front of a decision-maker this week |
| 65–79 | **Strong — proceed to diligence** | Open a data room, start reference calls |
| 50–64 | **Promising — needs one more data point** | Ask for the specific missing signal (usually P3 or P5) before deciding |
| 35–49 | **Pass for now — revisit at next milestone** | Tell the founder what would change the read (e.g. "come back at $30k MRR") |
| 0–34 | **Pass** | Decline; no need to re-engage absent a material change |

These bands assume **high confidence** inputs (see §6). Under low confidence
— which is common and expected at pre-seed — treat the tier as directional
only, and prefer "Promising, needs one more data point" over a false "Pass"
or false "Fast-track" when the completeness score is low. A funnel tool that
confidently kills a good deal on thin data is worse than one that routes it
back for one more look.

---

## 4. Pillar formulas

All sub-scores are clamped to `[0, 100]` after computation unless stated
otherwise. `clamp(x, lo, hi)` = min(max(x, lo), hi). `lerp` = piecewise-linear
interpolation between named anchor points. `likertToScore` converts a 1–5
rubric value (fractional averages allowed) to 0–100 per §5.

### P1. Founder & Team Quality

Three 1–5 rubrics, averaged as raw Likert values, then converted once via
`likertToScore`:

| Sub-rubric | What it rates |
|---|---|
| a. Domain expertise depth | How deep is the founding team's actual knowledge of this specific problem space? |
| b. Prior startup experience | Have they built or scaled something before — ideally to an exit? |
| c. Team completeness | Does the founding team cover both technical and commercial execution? |

```
teamAvg = (a + b + c) / 3
P1 = likertToScore(teamAvg)
```

Anchor descriptions for all three are in §5. Note (c) in particular: a lone
non-technical founder building a deep-tech product is a real, specific red
flag and should score low (1–2) on team completeness regardless of how
strong that founder is commercially — the gap is structural, not a
personality judgment.

### P2. Market Opportunity

| Sub-metric | Weight in P2 | Formula |
|---|---|---|
| a. TAM size (USD, millions) | 55% | `lerp` anchors ($M → score): 50→10, 100→20, 500→50, 1000→75, 3000→90, 10000→100 |
| b. "Why now" timing rubric (1–5, see §5) | 45% | `likertToScore(rubricValue)` |

```
P2 = 0.55a + 0.45b
```

**Why TAM is anchored the way it is**: a sub-$100M realistic addressable
market caps venture-scale outcomes almost regardless of everything else the
company does well — even a dominant player in a $100M market rarely returns
venture capital at fund scale. The curve is deliberately steep between $100M
and $1B (where most real venture debates actually happen) and flattens above
$3B, because past a certain size, "is the market big enough" stops being the
binding question and other pillars start mattering more.

**"Why now" (b)** asks whether there's a *named, specific* structural,
technological, or regulatory shift that makes this newly possible or newly
urgent — not "the market is growing." A market that has looked the same for a
decade with no catalyst should score low here even if it's large, because
"why hasn't someone already done this" needs a real answer.

### P3. Traction & Product-Market-Fit Signals

| Sub-metric | Weight in P3 | Formula |
|---|---|---|
| a. MoM growth rate of primary metric | 55% | `lerp` anchors (% MoM → score): 0→15, 5→45, 10→70, 15→90, 25→100 |
| b. Retention / cohort-curve quality rubric (1–5, see §5) | 45% | `likertToScore(rubricValue)` |

```
P3 = 0.55a + 0.45b
```

`primaryMetric` is whichever number is stage-appropriate — revenue, active
users, transactions, whatever the company's core loop actually produces. Be
explicit in reporting about which metric was used; comparing MoM growth on
revenue for one company against MoM growth on signups for another is
comparing two different things wearing the same units.

**These growth thresholds are deliberately aggressive and deliberately
stage-specific.** Sustained >15% MoM is exceptional and 5–10% is solid *for
an early-stage company* — a mature, $50M-revenue business growing 10% a
*month* would be one of the fastest-growing companies in the world and
something has probably gone wrong with the input data. That mismatch is
exactly why this is a separate model from the NDQI rather than a re-skin of
it: NDQI's P1a anchors a 15% *annual* CAGR at a similar score-band position.
Never port NSTS's growth anchors onto a company with an established,
multi-year financial history — use the NDQI for that company instead (see
`private-equity-analysis/reference/algorithm.md` §8).

**Retention/cohort quality (b)** is arguably the single highest-signal number
in this entire model for an early company: does usage from a cohort flatten
at a healthy plateau (real product-market fit, people keep coming back) or
decay toward zero (no PMF yet, growth is being bought or is one-time
curiosity)? Ask for a cohort retention curve specifically, not just a
point-in-time retention percentage — the shape matters more than the number.

### P4. Product & Technology Differentiation

A single 1–5 rubric (see §5) on defensibility — proprietary data or
technology, technical complexity a well-funded competitor can't quickly
replicate, any IP filed:

```
P4 = likertToScore(differentiationRubric)
```

This is framed specifically for **pre-revenue technical differentiation** —
unlike the NDQI's competitive-moat rubric (P3c there), which averages four
sub-ratings (switching costs, IP, network effects, brand/regulatory) because
an established business has all four to evaluate, an early-stage company
usually only has one or two of those yet. Rate what actually exists today —
don't average in "will eventually have network effects" as if it were
already true.

### P5. Unit Economics Trajectory

| Sub-metric | Weight in P5 | Formula |
|---|---|---|
| a. LTV:CAC ratio | 50% | `lerp` anchors (ratio → score): 0.5→10, 1→25, 2→55, 3→80, 4→95, 5→100 |
| b. Burn multiple (net burn ÷ net new ARR) | 50% | `lerp` anchors (multiple → score, inverse): 0.5→100, 1→90, 1.5→75, 2→55, 3→35, 5→10 |

```
P5 = 0.50a + 0.50b
```

Both are real, current, industry-standard efficiency metrics — LTV:CAC of
3:1 or better is the standard SaaS-era health benchmark, and below 1:1 is an
outright red flag (the company loses money on every customer, structurally).
Burn multiple (a metric popularized industry-wide as a cleaner efficiency
signal than burn rate alone) below 1 is excellent capital efficiency; above 3
is a real concern about whether growth is being bought at an unsustainable
price.

**This pillar is explicitly optional and low-confidence-tolerant by design.**
A genuinely pre-revenue company, or one with too few paying customers to
compute a meaningful CAC/LTV yet, does not have this data because it is
*too early*, not because it did anything wrong. Set
`unitEconomics.dataAvailable: false` in the input when that's the case — the
script then scores P5 as neutral (60, "n/a — not yet applicable") and
**excludes** its two fields from the completeness denominator entirely,
rather than either inventing a number or dragging down completeness for a
company that is behaving exactly as an early-stage company should. Do not
set `dataAvailable: false` just because the founder didn't send the number in
this pitch cycle — reserve it for cases where the metric genuinely isn't
computable yet at the company's real stage.

### P6. Round Terms & Dilution

| Sub-metric | Weight in P6 | Formula |
|---|---|---|
| a. Valuation-to-traction reasonableness | 40% | `premiumPct = (askMultiple − stageBenchmarkMultiple) / stageBenchmarkMultiple`; `clamp(70 − premiumPct × 100, 0, 100)` |
| b. Cap-table cleanliness rubric (1–5, see §5) | 35% | `likertToScore(rubricValue)` |
| c. Option-pool adequacy | 25% | `ratio = actualPoolPct / recommendedPoolPctForStage`; `lerp` anchors (ratio → score): 0.4→15, 0.7→50, 1.0→85, 1.25→100 |

```
P6 = 0.40a + 0.35b + 0.25c
```

**`askMultiple`** is a valuation-to-traction proxy appropriate to the
company's stage (e.g. valuation ÷ ARR for revenue-stage companies, or
whatever multiple convention is normal for the round type) and
**`stageBenchmarkMultiple`** is the going market rate for that stage/sector —
this needs to be sourced (recent comparable rounds), same caveat as the
NDQI's sector-comp inputs in §8. The formula's baseline-at-70-for-fair-price
logic is deliberately identical to the NDQI's P2a entry-multiple formula:
pricing exactly at the going rate is fair, not exceptional, and every 10%
paid above benchmark costs 10 points.

**Cap-table cleanliness (b)** rates the existing cap table as a whole:
few prior investors on standard terms with no unusual liquidation stacking is
clean; multiple stacked uncapped notes, a prior down round, or non-standard
preference stacking is messy.

**Option-pool adequacy (c)** checks whether the option pool set aside for
future hires is actually sized for the stage — a pool below ~40% of the
stage-typical size is a real problem (it means either founders or existing
investors will eat an unplanned dilution hit later, or hiring will be
underpowered), while at or above the typical pool size it stops mattering
much further.

---

## 5. Qualitative rubrics (Likert → score)

Used for P1a/b/c, P2b, P3b, P4, and P6b. Anchors, not vibes — write down
which anchor description matches before picking a number.

| Value | Score | Generic anchor |
|---|---|---|
| 1 | 10 | Absent / actively concerning |
| 2 | 35 | Weak — present but thin, easily challenged |
| 3 | 60 | Adequate — defensible, credible for the stage |
| 4 | 80 | Strong — clearly above the peer set |
| 5 | 100 | Exceptional — a genuine, hard-to-replicate advantage |

`likertToScore`: linear interpolation is fine for non-integer averages (e.g.
a P1 team average of 3.5 → score 70).

**Domain expertise depth (P1a):**
- 1 — No relevant domain background; this space is new to the whole team.
- 2 — Adjacent experience only; domain knowledge is shallow or secondhand.
- 3 — Solid, direct domain experience — has worked in or closely adjacent to
  this exact problem.
- 4 — Deep domain expertise; recognized as knowledgeable within the space.
- 5 — Leading authority or a genuine unfair advantage — e.g. built the exact
  system before, or has insider technical/regulatory knowledge competitors
  can't easily acquire.

**Prior startup experience (P1b):**
- 1 — First-time founder, no relevant startup experience.
- 2 — First-time founder with some relevant operating experience (e.g. early
  employee at a startup) but never in a founder seat.
- 3 — First-time founder with a strong, directly relevant domain background.
- 4 — Repeat founder, or a senior operator who has clearly scaled something
  before (no exit yet, but real scaling experience — e.g. took a team from
  5 to 100).
- 5 — Repeat founder with at least one prior successful exit, or another
  clearly-scaled outcome of comparable weight.

**Team completeness (P1c):**
- 1 — Solo founder with a critical, unaddressed gap (e.g. a lone
  non-technical founder building a deep-tech product with no technical
  co-founder or committed technical hire).
- 2 — Founding team covers only one side (all-technical or all-commercial)
  with a real, live gap on the other side.
- 3 — Founding team covers both technical and commercial basics, but the
  bench is thin (e.g. one person wearing too many hats).
- 4 — Well-rounded founding team with clear ownership of product,
  engineering, and go-to-market.
- 5 — Complete founding team with proven, complementary skillsets on both
  technical and commercial sides, plus early hires or advisors already
  filling any remaining gaps.

**"Why now" timing (P2b):**
- 1 — No identifiable catalyst; the market has looked the same for years and
  nothing explains why this wasn't built already.
- 3 — A plausible, named shift (a cost curve moving, a platform opening up, a
  regulatory change) exists but isn't clearly decisive yet.
- 5 — A specific, well-evidenced structural/technological/regulatory shift
  makes this newly possible or newly urgent, with a clear answer to "why
  didn't this exist five years ago."

**Retention / cohort-curve quality (P3b):**
- 1 — Retention decays toward zero within a few months for every cohort; no
  durable usage signal.
- 3 — Retention flattens at a modest plateau; some real habitual usage but
  not yet a standout curve.
- 5 — Retention flattens at a high, durable plateau (or improves — net
  negative churn) — a strong, textbook PMF signal.

**Product/technology differentiation (P4):**
- 1 — No real differentiation; easily replicated by a funded competitor in
  weeks.
- 2 — Some differentiation, but shallow — a well-funded competitor could
  close the gap within 6–12 months.
- 3 — Meaningful technical complexity or proprietary data that would take a
  competitor roughly 1–2 years to replicate.
- 4 — Strong defensibility — a genuine proprietary-data flywheel, hard-to-
  replicate technical architecture, and/or IP filed.
- 5 — Exceptional, structural defensibility — patented core technology,
  exclusive data access or partnerships, or technical complexity that is a
  multi-year build even for a well-capitalized competitor.

**Cap-table cleanliness (P6b):**
- 1 — Messy — multiple stacked uncapped notes, a prior down round, and/or
  complex or unusual liquidation-preference stacking.
- 3 — Adequate — a handful of prior investors on standard terms, nothing
  unusual.
- 5 — Clean — simple structure, standard market terms, no note-stacking or
  down-round history.

---

## 6. Confidence and missing data

Every pillar has a **required input list** (see `scripts/score.js`'s
`REQUIRED_FIELDS`). Before computing, count how many required fields across
all six pillars are missing or explicitly marked `"unknown"` — with one
exception (P5, below).

```
completeness = 1 − (missingCount / totalRequiredFields)
```

- `completeness ≥ 0.9` → **High confidence**. Report the tier as-is.
- `0.7 ≤ completeness < 0.9` → **Medium confidence**. Report the tier with a
  note listing which pillars used estimates.
- `completeness < 0.7` → **Low confidence**. Prefix the output
  `"PRELIMINARY — insufficient data for a reliable score"` and explicitly
  recommend which single data point would resolve the biggest gap first.

**Early-stage deals will legitimately, routinely, score lower on
completeness than PE/growth deals — this is expected and is not a flaw in the
target company.** A pre-seed company simply hasn't existed long enough to
generate the documented history a Series C company has. Don't read a Medium
or Low confidence NSTS score as "this founder is hiding something" by
default — it usually just means "this company is early," which is the entire
premise of investing at this stage. Only treat missing data as a real
yellow flag when the specific missing item is something a company at *that*
company's actual stage should reasonably already have (e.g. a Series A
company with genuinely no retention data at all is a more meaningful gap than
a pre-seed company with no retention data yet).

**P5 exception**: when `unitEconomics.dataAvailable` is explicitly set to
`false`, its two fields (`ltvCacRatio`, `burnMultiple`) are excluded from both
the missing-count numerator and the `totalRequiredFields` denominator — they
simply don't apply yet, and a company that is honestly too early to have unit
economics should not be penalized on completeness for that. If
`dataAvailable` is omitted entirely (not stated either way), the fields are
treated as expected-but-missing like any other field, which does count
against completeness — the explicit flag is the deliberate way to say "this
genuinely isn't measurable yet," not a default assumption.

Never silently substitute a default value for a missing required field and
present the result as if it were measured. If a value is genuinely unknown,
pass `null` and let the completeness penalty apply — a lower-confidence real
answer beats a confident wrong one.

---

## 7. Worked example

Series A-stage B2B SaaS startup. Full input is
`scripts/example-input.json` — run
`node scripts/score.js scripts/example-input.json` to reproduce these numbers
exactly (they are copied from that output, not hand-estimated).

- Team: domain expertise rubric 4, prior startup experience rubric 4 (repeat
  founder/operator, clear prior scaling, no exit yet), team completeness
  rubric 4
- Market: TAM $2,500M, "why now" timing rubric 4
- Traction: 9% MoM revenue growth, retention/cohort quality rubric 4
- Product: differentiation rubric 3
- Unit economics: data available; LTV:CAC 3.2, burn multiple 1.4
- Round terms: ask multiple 18x vs. stage benchmark 15x, cap-table
  cleanliness rubric 4, option pool 12% vs. 10% recommended for stage

```
P1: teamAvg = (4+4+4)/3 = 4.0 → likertToScore(4.0) = 80.0
P1 = 80.0

P2: a = lerp(2500, [1000,75]→[3000,90]) = 75 + (2500-1000)/(3000-1000)×15 = 86.25
    b = likertToScore(4) = 80.0
P2 = 0.55(86.25) + 0.45(80.0) = 47.44 + 36.0 = 83.4

P3: a = lerp(9, [5,45]→[10,70]) = 45 + (9-5)/(10-5)×25 = 65.0
    b = likertToScore(4) = 80.0
P3 = 0.55(65.0) + 0.45(80.0) = 35.75 + 36.0 = 71.75

P4: likertToScore(3) = 60.0
P4 = 60.0

P5: a = lerp(3.2, [3,80]→[4,95]) = 80 + (3.2-3)/(4-3)×15 = 83.0
    b = lerp(1.4, [1,90]→[1.5,75]) = 90 + (1.4-1)/(1.5-1)×(75-90) = 78.0
P5 = 0.50(83.0) + 0.50(78.0) = 80.5

P6: premiumPct = (18-15)/15 = 0.20 → a = clamp(70-20,0,100) = 50.0
    b = likertToScore(4) = 80.0
    ratio = 12/10 = 1.2 → c = lerp(1.2, [1.0,85]→[1.25,100]) = 85 + (1.2-1.0)/(1.25-1.0)×15 = 97.0
P6 = 0.40(50.0) + 0.35(80.0) + 0.25(97.0) = 20.0 + 28.0 + 24.25 = 72.25

NSTS = 0.25(80.0) + 0.20(83.4) + 0.20(71.75) + 0.15(60.0) + 0.10(80.5) + 0.10(72.25)
     = 20.0 + 16.69 + 14.35 + 9.0 + 8.05 + 7.23 = 75.3
```

**Result: NSTS 75.3 — Strong, proceed to diligence.**

> Verification note: these numbers were checked against
> `node scripts/score.js scripts/example-input.json` and match the script's
> actual printed output exactly (P1 80.0, P2 83.4, P3 71.75, P4 60.0, P5
> 80.5, P6 72.25, composite 75.3, High confidence, 100% complete).

The two pillars carrying the score are P2 (market, 83.4) and P5 (unit
economics, 80.5) — a large TAM with a real "why now" story, and unit
economics that are already healthy for the stage. The main drag is P4
(product differentiation, 60.0 — "meaningful but not yet exceptional") and P6
(72.25, driven mainly by the ask being priced 20% above the stage benchmark).
A sharper diligence question for this company: is the 18x ask negotiable, or
is there a reason (an unusually hot round, a competing term sheet) that
justifies the premium — if not, this is the one number most likely to move
the deal from "Strong" toward "Fast-track" at a slightly better price.

---

## 8. Known limitations

- **This model cannot detect founder fraud or misrepresentation.** It scores
  what's presented — a founder who fabricates traction numbers or overstates
  domain expertise will score well on exactly the metrics they lied about.
  NSTS is not a diligence substitute for reference calls, data-room
  verification, or checking retention numbers against raw underlying data.
- **Traction metrics for a very young company are extremely noisy.** A
  6-month-old company's MoM growth rate can legitimately swing 20+ points
  between successive monthly updates purely from small-sample variance (one
  large customer signing or churning moves the whole number). Don't
  over-react to a single re-score; look at the trend across 2–3 updates
  before treating a P3 move as signal rather than noise.
- **Team-quality scoring (P1) is genuinely subject to evaluator bias.**
  "Domain expertise" and "team completeness" ratings can legitimately land a
  point apart between two analysts, and are more exposed to pattern-matching
  bias (e.g. favoring founders who resemble past successes) than the more
  mechanical pillars. Mitigate by having a second scorer independently rate
  P1's three sub-rubrics on any deal that's close to a tier boundary, and
  average.
- **This model is explicitly not calibrated for hardware, biotech, or other
  deep-tech startups** where capital intensity and time-to-market differ
  fundamentally from software. A biotech company in preclinical trials has a
  "traction" curve (P3) that looks nothing like a SaaS MoM-growth curve, and
  its capital efficiency (P5) operates on a completely different timescale
  and burn profile. Don't force those companies through this model's anchors
  — build a separate deep-tech-specific variant with its own milestone-based
  P3/P5 anchors, the same way this model itself was built as a separate
  sibling to the NDQI rather than a re-skin of it.
- **Sector/stage benchmarks (P2's TAM read, P6's ask multiple and option-pool
  benchmarks) must be sourced and dated**, same caveat as the NDQI's sector
  comps — a stale benchmark set will silently bias P2 and P6 in either
  direction.
- **The model rewards clean, well-documented pitches**, and early-stage
  pitches are frequently not that. A great company presented with a thin
  deck will score lower on *confidence*, not on merit — don't conflate the
  two when presenting results (see §6).

## 9. Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-10 | Initial specification and reference implementation |

Any change to a weight, formula, or anchor value is a version bump with an
entry here — the whole point of a proprietary, named algorithm is that
"NSTS 75" means the same thing every time it's quoted. Silent tuning defeats
that.
