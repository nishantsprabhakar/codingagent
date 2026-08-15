# Nishant Project Finance Score (NPFS) — v1.0

**Proprietary scoring methodology for infrastructure and project finance
credit and viability analysis, developed by Nishant Prabhakar.**

Status: v1.0 (2026-08-15). Author/owner: Nishant Prabhakar. This document is
the authoritative specification — `scripts/score.js` is a direct, literal
implementation of the formulas below. If the two ever disagree, this document
is correct and the script has a bug.

NPFS is the project finance sibling of the **Nishant Credit Risk Score
(NCRS)** (`../credit-risk-analysis/`), which scores corporate borrowers. The
two share a design philosophy — six named, auditable pillars rolled into one
composite, mapped to a rating-agency-style band — but deliberately do not
share pillar anchors. A project finance facility is not a smaller, riskier
version of a corporate borrower; it is a structurally different credit
altogether, and §1 exists specifically to make that difference precise rather
than assumed.

---

## 1. Purpose and positioning

The NPFS is a **triage and relative-ranking tool for underwriting and
structuring single-asset project finance facilities** — toll roads, power
plants (thermal, renewable, or hybrid), water/utility concessions, PPPs, and
comparable infrastructure concessions financed on a limited- or non-recourse
basis against one asset's cash flow. It is not a regulatory capital model and
not a substitute for full technical, legal, and model-audit due diligence.

**Why this is a new skill instead of an NCRS variant.** NCRS's own
`SKILL.md` flags this gap explicitly: its leverage and coverage pillars
(P1/P2) "would badly misscore project finance... since those anchors assume
an operating company with a multi-year margin and leverage history rather
than a single-asset cash-flow waterfall." That single sentence is the reason
this skill exists, and it's worth unpacking pillar by pillar, because the
mismatch is not superficial — it runs through nearly every NCRS anchor:

- **NCRS P1 (Leverage: Net Debt/EBITDA, Debt/Equity) does not transfer.** A
  project finance special-purpose vehicle (SPV) has no multi-year EBITDA
  history to trend, often has thin or deeply subordinated equity by design
  (sponsors want leverage as high as the cash flow supports, not a
  conservative D/E), and has no ongoing-concern balance sheet to compare
  against a sector median — there is only the single asset's projected cash
  waterfall. Scoring "leverage" as a balance-sheet ratio here would either be
  undefined (no trailing EBITDA pre-completion) or meaningless (equity book
  value is a structuring choice, not a risk signal). The debt-service-coverage
  ratio (DSCR) — minimum and average across the full debt tenor — is the
  actual mechanism project lenders use to answer "is there enough leverage
  here," because it tests the cash waterfall directly instead of proxying
  through a balance-sheet ratio that doesn't exist yet for a greenfield asset.
- **NCRS P2 (Coverage: EBITDA/Interest, FCF/Total Debt Service) is closer but
  still wrong in isolation.** Project lenders do use a DSCR-shaped metric, but
  a single point-in-time DSCR is not the standard — the two numbers that
  actually drive a project finance credit committee are the **minimum DSCR**
  across the tenor (the worst single period the structure has to survive) and
  the **average DSCR** (the base-case cushion). NCRS's single-period coverage
  ratio would report a project as healthy in a year with a strong PPA price
  step-up while missing a covenant-breaching trough three years later — which
  is exactly the failure mode a project finance lender is underwriting
  against. NPFS folds NCRS's leverage-and-coverage territory into one pillar
  (P1) built the right way for this asset class, at a combined 30% weight
  reflecting that DSCR *is* the leverage-and-coverage question here, not an
  approximation of it.
- **NCRS P4 (Profitability & Stability: EBITDA margin trend, margin
  coefficient of variation over 3–5 years) requires a multi-year operating
  history that a greenfield or recently-completed project simply does not
  have.** There is no "margin trend" for an asset that hasn't operated yet,
  and even for an operating asset, "profitability" is the wrong lens — a toll
  road or power plant's risk is about whether *revenue actually materializes
  as contracted or projected* (offtake/traffic/price risk) and whether the
  *asset gets built and then keeps running* (completion and operating risk),
  not whether margins are trending up or down like a normal operating
  company's. NPFS replaces this with two purpose-built pillars: **revenue/
  offtake certainty** (P2) and **operating risk** (P4), which ask the actual
  questions a single-asset infrastructure credit raises.
- **NCRS P5 (Industry & Cyclicality Risk, a 1–5 sector base-rate rubric)
  under-specifies the single biggest tail risk in project finance:**
  jurisdiction and regulatory/political risk are not a generic "how cyclical
  is this sector" base rate — they are asset-specific (this specific
  concession, this specific regulator, this specific country's expropriation
  and change-in-law history) and often the dominant driver of whether a deal
  is financeable at all. NPFS keeps a dedicated pillar for this (P6) rather
  than folding it into a generic industry base rate.
- **What NCRS gets right that NPFS keeps, adapted:** qualitative/governance
  judgment on the sponsor (NCRS P6a) and a genuine, purpose-built completion-
  risk pillar. Corporate credit has no real analogue to "construction risk" —
  a going concern is, by definition, already built — but project finance does,
  acutely, for any asset that hasn't reached commercial operation. NPFS's P3
  is new territory NCRS never needed.

Three things this score explicitly is:

1. A way to convert a project's financial model outputs, contractual
   structure, and technical/political diligence into one comparable number,
   produced the same way every time across a pipeline of infrastructure deals.
2. A forcing function so two project finance analysts scoring the same
   information memorandum land on the same number (±5 points) instead of a
   gut-feel "this looks bankable."
3. A way to surface *which specific pillar* is driving the risk — "this
   deal's minimum DSCR of 1.15x in year 7 is the binding constraint, not the
   average DSCR of 1.6x" is a usable committee conversation; "this project
   feels risky" is not.

**What the NPFS explicitly is not**:

- **Not a substitute for an independent financial model audit.** NPFS takes
  minimum and average DSCR as *inputs*, computed by the project's own
  financial model (or a lender's independent model). It does not build or
  stress-test that model itself, does not verify the model's circularity or
  formula integrity, and does not second-guess the underlying demand/price/
  cost assumptions feeding it. A model audit by an independent financial
  adviser remains mandatory before any facility closes.
- **Not a substitute for technical, legal, or insurance due diligence.** It
  does not read the EPC contract, PPA, concession agreement, or O&M contract
  itself — it scores rubric-based judgments *about* those documents. It does
  not verify permits are validly issued, does not assess seismic/geotechnical
  risk, and does not review insurance adequacy. Independent technical
  adviser (ITA), legal counsel, and insurance adviser review remain mandatory.
- **Not a cash-flow forecaster.** It scores the *disclosed* DSCR profile and
  structural picture, not a projected repayment schedule it builds itself.

---

## 2. Structure at a glance

Six weighted pillars, each scored 0–100, rolled into one composite:

| Pillar | Weight | What it answers |
|---|---|---|
| P1. DSCR Profile | 30% | Does the projected cash waterfall actually cover debt service, in the worst year and on average, across the full debt tenor? |
| P2. Revenue / Offtake Certainty | 20% | How much of this project's revenue is contracted (PPA, availability payment, take-or-pay) versus exposed to market price or demand volume? |
| P3. Construction / Completion Risk | 15% | Will this asset actually get built, on budget and on schedule, with someone standing behind it if it doesn't? (Zero residual risk once operational.) |
| P4. Operating Risk | 15% | Once built, does it keep running as modeled — is the O&M contract solid, is the technology proven, and how much resource/volume variability is the project exposed to? |
| P5. Sponsor & Structure Quality | 12% | Is the sponsor credible and experienced, and does the debt structure (reserves, security, covenants) actually protect lenders if things go wrong? |
| P6. Regulatory & Political Risk | 8% | Is the jurisdiction, permitting status, and legal/regulatory protection package strong enough that a policy or political shock doesn't sink the deal? |

```
NPFS = 0.30·P1 + 0.20·P2 + 0.15·P3 + 0.15·P4 + 0.12·P5 + 0.08·P6
```

**Weighting rationale**: DSCR profile is weighted highest (30%) because it is
the single most direct, mechanical predictor of project finance default —
project debt does not default because a balance sheet looks stretched, it
defaults because the cash waterfall cannot service the coupon and
amortization in a given period. Revenue/offtake certainty is second (20%)
because it is the primary driver of *how reliable* the DSCR projection
itself is — a DSCR profile built on a firm 20-year PPA is a fundamentally
different risk than an identical-looking DSCR profile built on a merchant
power price forecast. Construction/completion risk and operating risk are
each weighted 15%: real, first-order risks, but each is time-bound (completion
risk retires entirely at COD; operating risk is present for the life of the
asset but is generally the more moderate, better-precedented risk of the two
once a project clears completion). Sponsor & structure quality sits at 12% —
lower than the cash-flow-mechanical pillars, but high enough that a strong
reserve/covenant package and an experienced sponsor can meaningfully cushion
a mediocre DSCR profile, the same logic NCRS applies to qualitative/
governance factors. Regulatory & political risk is weighted lowest of the six
(8%) not because it doesn't matter — in the wrong jurisdiction it is a deal
-killer regardless of every other pillar — but because it functions more like
a gating/tail-risk factor than a smoothly graded one; extreme jurisdiction
risk should be handled as an outright red flag in the narrative write-up
(see §8), not diluted into an 8%-weighted average that a strong DSCR can
mathematically outweigh.

---

## 3. Score bands — rating-agency-style mapping

NPFS bands are mapped to a rating-agency-style scale for ease of
communication with credit committees, ECAs/DFIs, and institutional debt
investors already fluent in that convention. **The basis-point spread ranges
and financing-feasibility notes are illustrative and directional only — they
are not a market quote, not a pricing commitment, and not calibrated to any
specific benchmark curve, jurisdiction, or day.** Always price off an actual
market quote sheet; use these only to communicate roughly what tier of
financing an NPFS implies.

| NPFS | Rating-equivalent band | Indicative spread over benchmark swap/gov curve* | Financing feasibility |
|---|---|---|---|
| 85–100 | **AA/A-equivalent (Strong Investment Grade)** | +100 to +175 bps | Fully bankable; institutional (pension/insurance) long-tenor debt at tight pricing, high leverage achievable |
| 70–84 | **BBB-equivalent (Investment Grade)** | +175 to +275 bps | Bankable on standard project-finance bank/institutional debt at market-standard leverage and tenor |
| 50–69 | **BB/B-equivalent (Sub-Investment Grade)** | +275 to +450 bps | Financeable with tighter structuring (higher DSRA, lower leverage, shorter tenor, added guarantees); club deal or ECA/DFI support may be needed |
| 30–49 | **CCC-equivalent (Weak)** | +450 to +750 bps | Difficult on a pure non-recourse project-finance basis; likely needs sponsor recourse, credit enhancement (ECA/MLA/DFI guarantee), or restructuring before close |
| 0–29 | **CC/C-equivalent (Distressed)** | +750 to +1,500+ bps, or not financeable at any spread | Not financeable as structured; restructure, recapitalize, or abandon |

*Benchmark = the relevant sovereign or swap curve for the project's currency
and debt tenor. These ranges assume normal-volatility project finance and
infrastructure debt markets; in a risk-off episode or an emerging-markets
funding freeze, actual clearing spreads at every band can widen well beyond
this table, and the sub-50 bands may simply be unfinanceable at any spread
regardless of what the table implies — see §8.

These bands assume **high confidence** inputs (see §6). Under low confidence,
treat the band as directional only and widen it by one full band in your head
before quoting a spread off of it. **A single dominant red flag (a genuinely
unbankable jurisdiction, an uninsured force majeure gap, an unrated offtaker
with no sovereign support) can make a deal unfinanceable even at an NPFS that
otherwise lands in an investment-grade-equivalent band — say so explicitly in
the narrative rather than letting the composite number override it.**

---

## 4. Pillar formulas

All sub-scores are clamped to `[0, 100]` after computation unless stated
otherwise. `clamp(x, lo, hi)` = min(max(x, lo), hi). `lerp` = piecewise-linear
interpolation between named anchor points.

### P1. DSCR Profile

| Sub-metric | Weight in P1 | Formula |
|---|---|---|
| a. Minimum DSCR across the debt tenor | 60% | `lerp` anchors: 1.00x→0, 1.10x→20, 1.20x→45, 1.30x→65, 1.50x→85, 1.75x→95, 2.00x→100 |
| b. Average (base-case) DSCR across the debt tenor | 40% | `lerp` anchors: 1.10x→0, 1.30x→30, 1.50x→55, 1.75x→75, 2.00x→90, 2.50x→100 |

```
P1 = 0.60a + 0.40b
```

**Why minimum DSCR is weighted above average DSCR, not the reverse**: an
average DSCR of 1.8x across a 20-year tenor is not reassuring if the
structure breaches a 1.05x floor in year 11 because of a scheduled
maintenance capex spike or a step-down in contracted pricing — that single
trough year is when a covenant actually breaches and a lender actually takes
action. Project finance credit committees underwrite to the worst year, not
the average year, which is why minimum DSCR carries the larger share (60%)
of this pillar despite average DSCR being the more commonly quoted headline
number in an information memorandum.

**Anchor logic**: 1.00x is break-even (cash flow exactly covers debt
service, the conventional DSCR covenant floor definition); 1.20–1.30x is the
typical minimum-DSCR covenant range required by project finance lenders as a
real cushion above break-even; 1.50x+ starts to look comfortable even in a
stress case. The average-DSCR anchors sit slightly higher than the
minimum-DSCR anchors at each corresponding score, reflecting that a healthy
base case is expected to run above the covenant floor with real headroom —
an average DSCR barely above the minimum DSCR anchors would itself be a red
flag (a base case with almost no room above its own worst year implies a thin
or overly aggressive model).

### P2. Revenue / Offtake Certainty

| Sub-metric | Weight in P2 | Formula |
|---|---|---|
| a. Contracted revenue share (% of projected revenue under PPA / availability payment / take-or-pay / minimum-revenue-guarantee terms) | 60% | `lerp` anchors: 0%→10, 25%→30, 50%→50, 75%→75, 90%→90, 100%→100 |
| b. Offtaker / counterparty credit quality (1–5 rubric, see §5) | 40% | `likertToScore(rubricValue)` |

```
P2 = 0.60a + 0.40b
```

**Why contracted share dominates this pillar**: a project with 90% of
revenue locked under a fixed-price PPA with a strong utility offtaker and a
project with 90% merchant exposure to a volatile power market can look
identical on every other pillar and still be fundamentally different credits
— the first has a revenue line a lender can underwrite to directly, the
second has a revenue line that is itself a forecast subject to real
volatility. This mirrors why NCRS treats leverage as the dominant mechanical
signal in its own domain (§4 of `../credit-risk-analysis/reference/
algorithm.md`): revenue certainty is the project finance analogue — the input
that, if wrong, invalidates the DSCR profile computed in P1.

**Why counterparty credit quality is scored separately from the contracted
percentage**: a 100%-contracted revenue line backed by an unrated, thinly
capitalized offtaker with no sovereign guarantee is not the same credit as an
identical contract backed by an investment-grade utility or a sovereign-
guaranteed concession authority — the contract only transfers revenue
certainty as far as the counterparty is actually able to pay. Rate this
rubric against: the offtaker's own credit rating (or, for sovereign/
municipal counterparties, the sovereign's rating and payment history on
comparable obligations), any sovereign guarantee or letter-of-credit
backstop, and history of timely payment on existing comparable contracts.

### P3. Construction / Completion Risk

**This pillar is zero-risk (scored 100, a neutral full score) for any asset
that has already reached commercial operation.** Once a project is
operational, there is no completion risk left to score — it is not a penalty
and not missing data, it is a genuinely retired risk. This mirrors how NCRS
treats its cash-runway modifier for cash-flow-positive borrowers and its
collateral-quality sub-metric for unsecured facilities (`../credit-risk-
analysis/reference/algorithm.md` §4): an inapplicable metric gets a neutral
default, not a low score and not a confidence penalty.

For a project still under construction (pre-commercial-operation-date):

| Sub-metric | Weight in P3 | Formula |
|---|---|---|
| a. EPC contract quality (1–5 rubric, see §5) | 40% | `likertToScore(rubricValue)` |
| b. Contingency adequacy (contingency budget as % of hard construction cost) | 30% | `lerp` anchors: 0%→10, 5%→40, 10%→70, 15%→90, 20%→100 |
| c. Sponsor completion support (1–5 rubric, see §5) | 30% | `likertToScore(rubricValue)` |

```
P3 = isOperational ? 100 : (0.40a + 0.30b + 0.30c)
```

**EPC contract quality (a)** rates the strength of the construction wrap:
fixed-price, date-certain, single-point-responsibility EPC contracts with
meaningful liquidated-damages provisions for both delay and performance
shortfall score highest; cost-plus, multi-contract (non-wrapped), or
weak-LD-cap structures score lowest.

**Contingency adequacy (b)**: project finance construction budgets
conventionally carry 5–15% contingency depending on technology maturity and
site complexity; below 5% is thin for almost any infrastructure asset class,
and 15%+ reflects either a genuinely complex/novel build or unusually
conservative budgeting.

**Sponsor completion support (c)** rates the strength of completion
guarantees, cost-overrun facilities, and sponsor equity support undertakings
— a full, unconditional completion guarantee from an investment-grade sponsor
scores highest; no completion support beyond the EPC contract itself scores
lowest.

### P4. Operating Risk

| Sub-metric | Weight in P4 | Formula |
|---|---|---|
| a. O&M contract quality (1–5 rubric, see §5) | 35% | `likertToScore(rubricValue)` |
| b. Technology / asset track record (1–5 rubric, see §5) | 30% | `likertToScore(rubricValue)` |
| c. Resource / volume risk (only if material; coefficient of variation of the relevant resource/demand series) | 35% | `lerp` anchors: 0.00→100, 0.05→85, 0.10→65, 0.20→40, 0.35→15; **100 (neutral) if not materially applicable** |

```
P4 = 0.35a + 0.30b + 0.35c
```

**Why resource/volume risk defaults to neutral (100), not to a penalty or
missing data, when flagged not applicable**: a fully availability-based PPP
(paid for road/asset availability regardless of traffic) or a contracted-
capacity power plant paid a fixed capacity payment regardless of dispatch has
no material resource or volume exposure — the payment mechanism itself
removes it. Scoring an inapplicable risk as missing would wrongly depress
confidence for a question that genuinely doesn't apply to that revenue
structure; scoring it as a penalty would wrongly punish a project for a risk
it structurally doesn't carry. This is the same design choice as P3's
operational-asset default and as NCRS's cash-runway/collateral-quality
defaults — see §4, P3, and `../credit-risk-analysis/reference/algorithm.md`
§4. **Only mark this not-applicable if you've confirmed the revenue mechanism
is genuinely availability- or capacity-based with no volume pass-through —
don't leave it unassessed by omission.** A wind, solar, hydro, or toll-road
asset with real demand/resource exposure should virtually always have this
flagged true and a real coefficient of variation supplied (from a resource
study's P50/P90/P99 analysis, historical traffic data, or equivalent).

**Anchor logic for (c)**: coefficient of variation (stdev/mean) of the
trailing historical (or independently modeled, for greenfield resource
assets) annual resource/volume series. Below 0.05 is low variability
(e.g. a mature toll road with stable, price-inelastic commuter traffic); 0.10
–0.20 is moderate (typical wind/solar resource variability year-to-year);
above 0.35 reflects genuinely high variability that a DSCR profile needs
material headroom to absorb.

### P5. Sponsor & Structure Quality

| Sub-metric | Weight in P5 | Formula |
|---|---|---|
| a. Sponsor experience / credit quality (1–5 rubric, see §5) | 35% | `likertToScore(rubricValue)` |
| b. Debt service reserve account (DSRA) coverage, in months of debt service | 30% | `lerp` anchors: 0mo→10, 3mo→40, 6mo→65, 9mo→85, 12mo→100 |
| c. Covenant package strength (1–5 rubric, see §5) | 35% | `likertToScore(rubricValue)` |

```
P5 = 0.35a + 0.30b + 0.35c
```

**Why DSRA coverage gets its own quantitative sub-metric rather than folding
into a generic rubric**: unlike sponsor quality or covenant strength, reserve
account funding is a hard, disclosed number (months of forward debt service
funded in the DSRA, whether cash-funded or LC-backed) rather than a judgment
call, and it is one of the most concrete structural protections a project
finance lender actually negotiates — 6 months is a conventional market
standard for investment-grade-equivalent infrastructure; 12 months is a
strong, often merchant-risk-driven structuring outcome; below 3 months is
thin for almost any asset class in this space.

**Sponsor experience/credit quality (a)** rates against: track record
completing and operating comparable assets (same technology, similar scale,
ideally same jurisdiction), the sponsor's own balance-sheet strength and
credit standing, and history of standing behind (versus walking away from)
distressed projects in its portfolio.

**Covenant package strength (c)** rates against: distribution/lock-up test
robustness (does a DSCR breach actually trap cash, not just trigger a
notice), leverage/refinancing covenants, change-of-control and step-in
rights, and security package comprehensiveness (share pledges, account
security, direct agreements with the offtaker/concession authority).

### P6. Regulatory & Political Risk

| Sub-metric | Weight in P6 | Formula |
|---|---|---|
| a. Jurisdiction risk (1–5 rubric, see §5) | 40% | `likertToScore(rubricValue)` |
| b. Permitting / regulatory status (1–5 rubric, see §5) | 30% | `likertToScore(rubricValue)` |
| c. Force majeure / change-in-law protection (1–5 rubric, see §5) | 30% | `likertToScore(rubricValue)` |

```
P6 = 0.40a + 0.30b + 0.30c
```

**Jurisdiction risk (a)** rates against: sovereign credit rating, rule-of-law
and contract-enforcement track record, currency convertibility/
transferability history, and precedent of honoring (versus renegotiating or
expropriating) infrastructure concessions specifically — a country's general
sovereign rating and its specific track record on infrastructure contracts
can diverge, and the latter matters more here.

**Permitting/regulatory status (b)** rates against: completeness of permits
actually obtained (versus pending or assumed), any active legal or political
challenge to permits already granted, and the regulator's independence and
track record of tariff/rate predictability.

**Force majeure / change-in-law protection (c)** rates against: the
concession or PPA's actual contractual relief and compensation mechanisms for
force majeure events and adverse regulatory/tariff changes — a contract with
robust, specific change-in-law compensation language scores far higher than
one with generic, discretionary, or unfunded relief provisions, regardless of
how strong the underlying jurisdiction otherwise looks.

---

## 5. Qualitative rubrics (Likert → score)

Used for P2b, P3a, P3c, P4a, P4b, P5a, P5c, P6a, P6b, P6c, and any other 1–5
qualitative input. Anchors, not vibes — write down which anchor description
matches before picking a number. Same generic scale as NCRS, for the same
reason: a "3" should mean the same thing whether it's quoted from a credit
skill or a project finance skill in this library.

| Value | Score | Anchor description |
|---|---|---|
| 1 | 10 | Absent / actively concerning |
| 2 | 35 | Weak — present but thin, easily challenged |
| 3 | 60 | Adequate — defensible, industry-standard |
| 4 | 80 | Strong — clearly above peer set |
| 5 | 100 | Exceptional — a genuine, hard-to-replicate advantage |

`likertToScore`: linear interpolation is fine for non-integer averages.

Per-rubric anchor guidance is given alongside each formula in §4 (EPC
contract quality under P3a, O&M contract quality under P4a, technology/track
record under P4b, sponsor experience under P5a, covenant package under P5c,
jurisdiction/permitting/force-majeure under P6). Rate each independently
against its own anchor description — don't let a strong score on one rubric
pull up your judgment on an unrelated one (a top-tier sponsor does not make a
weak force majeure clause any stronger).

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
  recommend which documents would resolve the biggest gaps first (an
  independent-engineer/ITA report and the financial model's DSCR output beat
  an information memorandum's summary numbers every time — prioritize closing
  P1/P2 gaps over qualitative-rubric gaps).

**Twelve fields are unconditionally required**: minimum DSCR, average DSCR,
contracted revenue share, offtaker credit quality rubric, O&M contract
quality rubric, technology/track-record rubric, sponsor experience rubric,
DSRA months coverage, covenant package rubric, jurisdiction risk rubric,
permitting status rubric, and force majeure protection rubric — the twelve
listed as `REQUIRED_FIELDS` in `scripts/score.js`.

**Two groups of fields are conditionally required**, matching the
graceful-N/A handling described in §4:

- The three construction sub-metrics (EPC contract quality, contingency
  adequacy, sponsor completion support) are only required if
  `construction.isOperational` is `false`. If the project has already reached
  commercial operation, none of the three count against completeness — P3 is
  scored 100 directly.
- `operating.resourceVolumeCoV` is only required if
  `operating.hasMaterialResourceOrVolumeRisk` is `true`. If the revenue
  mechanism is genuinely availability- or capacity-based with no volume
  pass-through, this field is not counted against completeness.

**Both gate flags (`isOperational`, `hasMaterialResourceOrVolumeRisk`)
default to the conservative or "not yet assessed" reading if left unset** —
`isOperational` defaults to `false` (assume construction risk still applies,
which is the safer assumption and simply requires the P3 inputs), while
`hasMaterialResourceOrVolumeRisk` defaults to `false` (neutral, no volume
risk scored) the same way NCRS's `isCashFlowNegative` and `isSecuredLending`
gates default to their simpler-case reading. **This second default is opt-in,
not opt-out in practice**: only set `hasMaterialResourceOrVolumeRisk: false`
after actually confirming the revenue structure has no volume pass-through —
leaving it unset on a wind or toll-road asset because the resource study
wasn't reviewed yet silently understates a real risk, which is worse than a
lower-confidence score, because nothing flags it as unexamined.

Never silently substitute a default value for a missing required field and
present the result as if it were measured. If a value is genuinely unknown,
pass `null` and let the completeness penalty apply — a lower-confidence real
answer beats a confident wrong one.

---

## 7. Worked example

Highway 42 Toll Road Concession — a 30-year build-operate-transfer (BOT)
toll road concession, now in year 4 of operation (construction and traffic
ramp-up both complete). Full input is `scripts/example-input.json` — run
`node scripts/score.js example-input.json` to reproduce these numbers
exactly (they are copied straight from that output, not hand-estimated).

- Minimum DSCR across remaining debt tenor: 1.25x. Average (base-case) DSCR:
  1.55x.
- Revenue: 35% of projected revenue is under a state minimum-revenue
  guarantee (contracted); the remaining 65% is toll receipts exposed to
  actual traffic volume and price. Offtaker/counterparty (the state
  concession authority backing the minimum-revenue guarantee) credit quality
  rubric = 4.
- Construction: operational (post-COD) — no completion risk remains.
- Operating: O&M contract quality rubric = 4 (experienced operator,
  performance-based contract). Technology/track record rubric = 5
  (conventional toll-road asset, proven technology). Material volume risk:
  yes — trailing traffic coefficient of variation = 0.08.
- Sponsor & structure: sponsor experience/credit quality rubric = 4. DSRA
  coverage = 6 months of debt service. Covenant package strength rubric = 4.
- Regulatory: jurisdiction risk rubric = 4 (stable, investment-grade
  sovereign with a clean concession-honoring track record). Permitting
  status rubric = 5 (fully permitted, operating, no pending regulatory
  action). Force majeure/change-in-law protection rubric = 3 (adequate,
  industry-standard relief provisions, not exceptional).

```
P1: a = lerp(1.25, [1.20→45, 1.30→65]) = 45 + (1.25-1.20)/(1.30-1.20)×20 = 55.0
    b = lerp(1.55, [1.50→55, 1.75→75]) = 55 + (1.55-1.50)/(1.75-1.50)×20 = 59.0
P1 = 0.60(55.0) + 0.40(59.0) = 56.6

P2: a = lerp(35, [25→30, 50→50]) = 30 + (35-25)/(50-25)×20 = 38.0
    b = likertToScore(4) = 80.0
P2 = 0.60(38.0) + 0.40(80.0) = 54.8

P3 = 100 (operational — no completion risk remains)

P4: a = likertToScore(4) = 80.0
    b = likertToScore(5) = 100.0
    c = lerp(0.08, [0.05→85, 0.10→65]) = 85 + (0.08-0.05)/(0.10-0.05)×(65-85) = 73.0
P4 = 0.35(80.0) + 0.30(100.0) + 0.35(73.0) = 28.0 + 30.0 + 25.55 = 83.55

P5: a = likertToScore(4) = 80.0
    b = lerp(6, [0→10, 3→40, 6→65, 9→85, 12→100]) = 65.0  (6 months lands exactly on the named anchor)
    c = likertToScore(4) = 80.0
P5 = 0.35(80.0) + 0.30(65.0) + 0.35(80.0) = 28.0 + 19.5 + 28.0 = 75.5

P6: a = likertToScore(4) = 80.0
    b = likertToScore(5) = 100.0
    c = likertToScore(3) = 60.0
P6 = 0.40(80.0) + 0.30(100.0) + 0.30(60.0) = 32.0 + 30.0 + 18.0 = 80.0

NPFS = 0.30(56.6) + 0.20(54.8) + 0.15(100) + 0.15(83.55) + 0.12(75.5) + 0.08(80.0)
     = 16.98 + 10.96 + 15.0 + 12.5325 + 9.06 + 6.4
     = 70.9325 → rounds to 70.9
```

**Result: NPFS 70.9 — BBB-equivalent (Investment Grade), indicative spread
+175 to +275 bps over benchmark, bankable on standard project-finance bank/
institutional debt at market-standard leverage and tenor. High confidence
(100% complete).**

The two pillars with the most room to move this deal into the AA/A-
equivalent band are P1 (DSCR profile, 56.6 — the minimum DSCR of 1.25x in
particular is thin relative to the 1.50x+ anchors that unlock the top band)
and P2 (revenue/offtake certainty, 54.8 — driven mainly by the relatively
low 35% contracted-revenue share; a higher minimum-revenue-guarantee
percentage, if renegotiable, would lift this pillar directly). Construction
risk is a non-factor here (P3 = 100, correctly, since the asset is already
operating) — this worked example was chosen specifically to illustrate that
graceful-neutral behavior alongside a live resource/volume-risk calculation
in P4, rather than to also walk through the pre-completion construction-risk
formula; see §4 (P3) for that formula's own worked arithmetic pattern (it is
structurally identical to P1's weighted-average form, just with
construction-specific anchors).

---

## 8. Known limitations

- **DSCR is only as good as the financial model producing it.** P1 takes
  minimum and average DSCR as inputs; it does not audit the model that
  generated them. A model with optimistic demand-growth assumptions, an
  aggressive discount rate, or a circularity error will produce a DSCR
  profile that looks fine and isn't. Always ask whether the DSCR came from
  the sponsor's own model or an independent lender/adviser model, and treat
  the former as directional until independently verified — this is the
  project finance analogue of NCRS's point about ratio-based scoring being
  gamed by balance-sheet window-dressing.
- **Contracted-revenue share can overstate true certainty if the contract
  itself is weak.** A PPA or concession agreement counted as "contracted" in
  P2a can still carry termination rights, price-review mechanisms, or
  force-majeure carve-outs broad enough to functionally convert it toward
  merchant risk. P2b (counterparty credit quality) partially captures
  counterparty *payment* risk but not contract *drafting* risk — read the
  actual contract, don't just take the revenue-mix percentage at face value.
- **Construction risk zeroing out at COD ignores latent-defect and
  warranty-period risk.** An asset that has just reached commercial operation
  is not yet proven over a full operating cycle — early-life technical
  issues, warranty claims, and initial ramp-up underperformance are real and
  are only partially captured by P4's technology/track-record rubric. Treat
  an asset in its first 12–24 months of operation with somewhat more caution
  than the raw P3=100 default implies, particularly for first-of-a-kind or
  novel technology.
- **Resource/volume coefficient of variation from a short history understates
  tail risk.** A trailing 3–5 year traffic or resource series, especially for
  a newer asset, may not include a genuine downside year (a severe drought
  for hydro, a demand shock for a toll road). Where available, use an
  independent resource study's P50/P90/P99 analysis rather than raw trailing
  historical variability, and treat a short history as a reason to widen
  confidence bands, not to trust the coefficient of variation at face value.
- **Jurisdiction and regulatory risk are the hardest pillar to score
  consistently and the most likely to change abruptly.** A stable-looking
  regulatory regime can shift with an election cycle or a fiscal crisis in a
  way that a quarterly-refreshed rubric will not catch in time. Treat P6 as a
  point-in-time snapshot that decays faster than the other pillars, and
  supplement it with real-time political-risk-insurance pricing or comparable
  sovereign CDS spreads for any deal already near a band boundary.
- **Qualitative rubrics are analyst-dependent.** Two analysts can legitimately
  land one Likert point apart on sponsor experience, EPC contract quality, or
  covenant package strength. Mitigate by having a second reviewer score
  contested rubrics independently and averaging, the same practice NCRS
  recommends for its own qualitative pillars.
- **Not calibrated for corporate-guaranteed or fully sovereign-wrapped
  structures.** A project where a strong-credit sponsor or sovereign entity
  provides an unconditional guarantee of debt service effectively converts
  the credit into (or close to) a corporate/sovereign credit — for those
  structures, NCRS (or a sovereign-credit framework) is the more appropriate
  tool, with NPFS at most a secondary cross-check on the underlying asset.
- **Not a substitute for insurance and force-majeure-event modeling.** P6c
  scores the *contractual* force majeure and change-in-law protection
  language qualitatively; it does not model the probability or financial
  impact of specific event scenarios (natural catastrophe, political
  violence, pandemic-scale demand shocks). Run scenario-specific stress tests
  separately for any asset with material exposure to a specific, identifiable
  tail event.

---

## 9. Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-15 | Initial specification and reference implementation |

Any change to a weight, formula, or anchor value is a version bump with an
entry here — the whole point of a proprietary, named algorithm is that "NPFS
71" means the same thing every time it's quoted. Silent tuning defeats that.
