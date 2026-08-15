# Nishant Vendor Risk Score (NVRS) — v1.0

**Proprietary scoring methodology for third-party / vendor security and
operational risk assessment, developed by Nishant Prabhakar.**

Status: v1.0 (2026-08-15). Author/owner: Nishant Prabhakar. This document is
the authoritative specification — `scripts/score.js` is a direct, literal
implementation of the formulas below. If the two ever disagree, this document
is correct and the script has a bug.

Named composite scores have real precedent in third-party risk management
(TPRM) specifically: the **Shared Assessments SIG questionnaire** and
**security-ratings services** (BitSight, SecurityScorecard) both collapsed a
sprawling vendor due-diligence file into a single comparable rating, precisely
so a security or procurement team could triage hundreds of vendors the same
way every time instead of re-deriving judgment per vendor. **NIST SP 800-161**
and **ISO 27036** likewise formalized "vendor risk" into a small number of
named control domains rather than one blended checklist. NVRS borrows that
same discipline and extends it the way NCRS (this library's credit-risk
sibling) extends the Altman Z-Score: six weighted pillars instead of one
composite rating, so a vendor with a shiny SOC 2 badge but broad,
unmonitored production access can't silently score as "safe" just because one
dimension looks clean.

---

## 1. Purpose and positioning

The NVRS is a **triage and relative-ranking tool for onboarding and
reassessing third-party vendors/suppliers in a vendor risk management (TPRM)
program**, not a penetration test and not a substitute for full legal or
security-audit diligence. It exists to do three things quickly and
consistently across a vendor pipeline or existing vendor book:

1. Convert a vendor's data exposure, security posture, resilience,
   contractual controls, criticality, and remediation track record into one
   comparable number, produced the same way every time.
2. Force the same six questions to get answered for every vendor, so two
   GRC/security analysts scoring the same vendor file land on the same number
   (±5 points).
3. Surface *which specific pillar* is driving the risk, not just a gut feel —
   so the review conversation is "security posture is solid at SOC 2 Type II,
   but this vendor holds broad read-write payroll-PII access with no viable
   alternative provider" instead of "this vendor feels fine."

It is deliberately **not** a black box: every sub-score is a named, auditable
formula against a named input. If an input is unknown, the algorithm says so
and degrades its confidence rating rather than guessing silently.

**Why these six pillars, and why this way of grouping them** (the candidate
signal groups a TPRM intake questionnaire or SIG/CAIQ assessment usually
reaches for — data classification/access scope, certifications/pentest/breach
history, DR/uptime/going-concern risk, DPA/audit-rights/subprocessor/
regulatory terms, criticality/exit-planning, and questionnaire responsiveness/
remediation cadence — collapse into six non-overlapping axes once duplicated
signal is removed):

- **P1 Data Access & Sensitivity** answers "what is the blast radius if this
  vendor is compromised" — the single question every TPRM intake starts with,
  because it determines how much the other five pillars even matter. A vendor
  with no data access and a vendor with full production admin access to a
  regulated-PII datastore should never be evaluated with the same intensity,
  and P1 is what sets that intensity. It is weighted jointly highest with P2
  because impact (P1) and likelihood (P2) are the two variables that multiply
  together to produce actual risk — neither alone tells the story.
- **P2 Security Posture & Certifications** answers "how likely is a
  compromise" — certification status, audit/pentest recency, and breach
  history are the closest thing TPRM has to an independently-verifiable
  likelihood signal, as opposed to P1's impact signal or P6's process signal.
  It does not overlap with P1 (which asks what could be lost) or P6 (which
  asks how the vendor behaves *after* a finding, not its point-in-time
  security state).
- **P3 Business Continuity & Resilience** is a genuinely different failure
  mode from P1/P2: a vendor can have excellent access controls and a clean
  breach history and still take your operations down for a day through a
  DR failure, a missed SLA, or its own insolvency. Financial stability is
  grouped here rather than as a separate pillar because a going-concern risk
  is fundamentally a continuity risk — the practical consequence of a vendor
  failing financially is the same as a DR failure: the service stops.
- **P4 Contractual & Compliance Controls** is the pillar that determines
  whether the other five pillars' risks are *actually your problem* in a
  legally enforceable way, or just something you hope the vendor handles
  well. A vendor can have strong security and resilience today and still
  leave you exposed if the DPA has no breach-notification clock, no audit
  rights, and no subprocessor visibility — this is a distinct axis from
  "is the vendor secure" (P1/P2) because it asks "what happens, and how fast
  do you find out, when it isn't."
- **P5 Concentration & Criticality** is deliberately about the *relationship*,
  not the vendor in isolation — the same vendor with identical security
  posture is a materially different risk to onboard as a single-sourced,
  no-alternative payroll processor versus a redundant, easily-replaced
  vendor for a non-critical function. This is the pillar that answers "how
  much can this one relationship hurt us if everything else in this scorecard
  is fine," which none of P1–P4 or P6 capture on their own.
- **P6 Monitoring & Remediation Track Record** is the only pillar that
  measures the vendor's *behavior over time* rather than a point-in-time
  state — how it responds to questionnaires, how fast it closes findings, and
  whether ongoing monitoring is even in place. A vendor can look identical to
  another on P1–P5 at assessment time and still be the one that goes quiet
  for six months after a finding — P6 exists specifically to catch that
  pattern, which none of the other five, all necessarily point-in-time
  measurements, can see.

**What the NVRS explicitly is not**:

- **Not a penetration test or independent security audit.** NVRS scores
  disclosed and attested information (questionnaire responses, certification
  reports, contract terms) — it does not independently verify a vendor's
  security controls, does not test their systems, and does not confirm a
  SOC 2 report's scope actually covers the service being purchased. Read the
  actual certification report's scope section; don't take "SOC 2 Type II" at
  face value from a sales deck.
- **Not a substitute for legal contract review.** NVRS scores whether
  contractual protections *exist* (DPA, audit rights, breach-notification
  SLA, subprocessor terms) at a rubric level — it does not review the actual
  contract language for loopholes, liability caps that gut the protection, or
  conflicting terms in a master services agreement versus a DPA addendum.
  Route the actual contract through legal review regardless of NVRS tier.
- **Not calibrated to a single regulatory framework.** NVRS's regulatory-scope
  term (P4d) is a general "does the vendor have the attestation its data
  access implies it should have" check, not a GDPR, HIPAA, or PCI-DSS
  compliance certification in itself. A vendor scoring well on NVRS can still
  require its own dedicated regulatory compliance review (e.g., a formal
  HIPAA Business Associate Agreement risk assessment) before onboarding for a
  regulated use case.

---

## 2. Structure at a glance

Six weighted pillars, each scored 0–100 (**higher = lower risk / safer
vendor**, the same convention this library's `credit-risk-analysis` NCRS
uses — a high NVRS is the vendor equivalent of an investment-grade rating,
not a high-risk warning), rolled into one composite:

| Pillar | Weight | What it answers |
|---|---|---|
| P1. Data Access & Sensitivity | 20% | What could this vendor lose or expose if compromised — what's the blast radius? |
| P2. Security Posture & Certifications | 20% | How likely is a compromise, based on independently-verifiable evidence? |
| P3. Business Continuity & Resilience | 15% | Will this vendor still be delivering the service in a year, and how gracefully does it handle its own failures? |
| P4. Contractual & Compliance Controls | 15% | If something goes wrong, is it actually your legal problem to catch fast, or just a hope? |
| P5. Concentration & Criticality | 15% | How much can this one relationship hurt you, and can you leave if it does? |
| P6. Monitoring & Remediation Track Record | 15% | Does the vendor behave well over time, not just at the moment of assessment? |

```
NVRS = 0.20·P1 + 0.20·P2 + 0.15·P3 + 0.15·P4 + 0.15·P5 + 0.15·P6
```

**Weighting rationale**: P1 and P2 together carry 40% of the score by
design — they are the classic impact × likelihood pair that actual risk is
built from, mirroring why NCRS weights leverage+coverage (its own default
mechanics) at 45% combined. Impact without likelihood, or vice versa,
materially understates real exposure: a vendor with trivial data access
barely needs a strong security posture to be low-risk, and a vendor with
excellent certifications but full production admin access to regulated PII
is still a meaningful concentration of risk. The remaining four pillars are
weighted evenly at 15% each: continuity, contractual controls, concentration,
and monitoring/remediation are all real, load-bearing signals, but none
individually predicts a bad outcome as reliably as the impact/likelihood
pair, and none is disposable enough to weight below the others — a vendor
can be a genuine problem through any one of them alone (e.g., excellent
security posture, trivial data access, but zero viable alternative and no
right-to-audit clause is still a vendor a security committee should be
uncomfortable single-sourcing).

---

## 3. Score bands — vendor risk tier mapping

NVRS tiers communicate what onboarding/reassessment posture a TPRM program
should take. **The implications below are illustrative and directional, not
a committed risk-acceptance decision** — always pair a tier with the
program's actual risk-acceptance policy and, at the lower tiers, real
executive/legal sign-off before proceeding.

| NVRS | Tier | Next-step implication |
|---|---|---|
| 85–100 | **Tier 1 — Low Risk** | Standard onboarding; standard annual reassessment cadence; no compensating controls required beyond baseline contract terms |
| 70–84 | **Tier 2 — Moderate Risk** | Standard onboarding with minor compensating controls targeted at the weakest pillar; annual reassessment |
| 50–69 | **Tier 3 — Elevated Risk** | Enhanced due diligence and negotiated compensating controls required before onboarding/renewal; semi-annual reassessment; sign-off from both the business owner and security/GRC required |
| 30–49 | **Tier 4 — High Risk** | Onboarding/renewal requires security-leadership or GRC-committee sign-off; mandatory compensating controls (enhanced monitoring, a contractual remediation plan with hard deadlines, reduced data/access scope) must be in place before go-live; quarterly reassessment |
| 0–29 | **Tier 5 — Critical Risk** | No-go recommended absent extraordinary compensating controls; if proceeding at all, requires executive/board-level risk acceptance, continuous monitoring, a binding remediation plan with hard deadlines, and a documented exit plan; reassess at least every 90 days until the vendor moves out of this tier |

These bands assume **high confidence** inputs (see §6). Under low confidence,
treat the tier as directional only and widen it by one full tier (toward the
more cautious tier) in your head before acting on it — an under-documented
vendor should never quietly clear a threshold it hasn't actually earned.

---

## 4. Pillar formulas

All sub-scores are clamped to `[0, 100]` after computation unless stated
otherwise. `clamp(x, lo, hi)` = min(max(x, lo), hi). `lerp` = piecewise-linear
interpolation between named anchor points, in ascending order of the input
metric (lower-is-better metrics simply have descending anchor scores across
ascending inputs). `likertToScore` and its inverse `reverseLikertToScore` are
defined in §5 — three sub-metrics below (P1a, P1b, P5a) use the *reversed*
mapping because a higher rubric value on those specific scales describes
*more* exposure/criticality, which is *worse* for a score where higher always
means safer.

### P1. Data Access & Sensitivity

| Sub-metric | Weight in P1 | Formula |
|---|---|---|
| a. Data sensitivity classification (1–5 rubric, see §5) | 55% | `reverseLikertToScore(rubricValue)` |
| b. Access breadth / blast radius (1–5 rubric, see §5) | 45% | `reverseLikertToScore(rubricValue)` |

```
P1 = 0.55a + 0.45b
```

**Why sensitivity and breadth are separate terms, not one combined
rubric**: a vendor can have narrow access (a single read-only export) to
extremely sensitive data (full PHI records), or broad access (admin rights
across many systems) to relatively low-sensitivity data — these are
independent axes of the same underlying question, and collapsing them into
one rubric would hide exactly the case that most matters: broad access *to*
highly sensitive data, which should score far worse than either dimension
alone would suggest. Weighting sensitivity slightly higher (55/45) reflects
that *what* is exposed usually matters more than *how* it's reached — a
narrow path to a large regulated dataset is still a large regulated-data
exposure.

### P2. Security Posture & Certifications

| Sub-metric | Weight in P2 | Formula |
|---|---|---|
| a. Certification status (1–5 rubric, see §5) | 30% | `likertToScore(rubricValue)` |
| b. Months since last certification/audit report | 20% | `lerp` anchors: 0→100, 6→90, 12→75, 18→55, 24→35, 36→10 |
| c. Months since last penetration test | 25% | `lerp` anchors: 0→100, 6→90, 12→70, 18→50, 24→30, 36→10 |
| d. Confirmed security incidents, trailing 24 months (deductive) | 25% | Start at 100; `−20` per confirmed incident; floor 0 |

```
P2 = 0.30a + 0.20b + 0.25c + 0.25d
```

**Anchor logic for (b) vs (c)**: certification reports (SOC 2 Type II, ISO
27001) are typically renewed on a 12-month cycle, so staleness only starts
meaningfully penalizing past the 12-month mark; penetration tests decay
faster in this model (70 at 12 months vs. 75 for certification staleness)
because a pentest is a snapshot of exploitability at one point in time and
industry practice generally expects at least annual, often more frequent,
testing cadence — a 12-month-old pentest against a system that has shipped
a year of changes since is a meaningfully weaker signal than a 12-month-old
SOC 2 report, whose control environment typically changes more slowly.

**Why incident history is a flat per-incident deduction, not a rubric**:
a confirmed security incident is a fact, not a judgment call, so it is
scored deductively like NSHS's governance red-flag term — each confirmed
incident in the trailing 24 months is worth a fixed −20, stacking, rather
than being folded into a softer rubric that could understate a vendor with
multiple incidents.

### P3. Business Continuity & Resilience

| Sub-metric | Weight in P3 | Formula |
|---|---|---|
| a. BCP/DR maturity (1–5 rubric, see §5) | 30% | `likertToScore(rubricValue)` |
| b. SLA uptime commitment (%) | 20% | `lerp` anchors: 95→10, 99.0→30, 99.5→55, 99.9→80, 99.95→90, 99.99→100 |
| c. SLA breaches / major outages, trailing 12 months (count) | 25% | `lerp` anchors: 0→100, 1→75, 2→50, 3→30, 4→15, 6→5 |
| d. Financial stability / going-concern risk (1–5 rubric, see §5) | 25% | `likertToScore(rubricValue)` |

```
P3 = 0.30a + 0.20b + 0.25c + 0.25d
```

**Why financial stability sits inside this pillar rather than as its own
pillar or inside P5**: the practical consequence of a vendor's insolvency or
sudden wind-down is operationally identical to a DR failure — the service
stops, on a timeline you don't control. It is not a P5 concentration
question (which is about *your* dependency and exit options) but a P3
continuity question (whether *the vendor itself* keeps existing to deliver
the service).

**Anchor logic for (c)**: a single SLA breach or major outage in a trailing
year is common enough across the vendor population that it only costs 25
points (75), not a cliff; by 3+ breaches in a year the pattern has stopped
looking like a one-off and starts looking like a structurally unreliable
provider, which is why the curve steepens noticeably past that point.

### P4. Contractual & Compliance Controls

| Sub-metric | Weight in P4 | Formula |
|---|---|---|
| a. DPA / data processing agreement adequacy (1–5 rubric, see §5) | 30% | `likertToScore(rubricValue)` |
| b. Contractual breach-notification SLA (hours to notify) | 25% | `lerp` anchors: 24→100, 48→80, 72→60, 120→35, 168→15, 336→5 |
| c. Right-to-audit & subprocessor governance (1–5 rubric, see §5) | 25% | `likertToScore(rubricValue)` |
| d. Regulatory scope alignment (deductive) | 20% | Start at 100; `−20` per applicable regulatory regime the vendor lacks the corresponding attestation/control for; floor 0 |

```
P4 = 0.30a + 0.25b + 0.25c + 0.20d
```

**Why right-to-audit and subprocessor governance are one combined rubric,
not two**: both terms answer the same underlying question — "can you ever
actually verify what this vendor (and whoever it relies on) is doing with
your data, or are you taking its word for it" — and in practice contracts
that grant meaningful audit rights are the same contracts that also disclose
and govern subprocessors; splitting them into separate terms would mostly
double-count the same negotiating leverage rather than capture independent
information.

**Anchor logic for (b)**: 24–72 hours is the range most modern data-processing
agreements and emerging breach-notification regulation converge on as a
"you can still act on this" window; beyond a week (168 hours), a
notification commitment is close to useless for containment purposes even
if it's better than nothing, which is why the curve is already down to 15
by then.

**Why regulatory scope alignment is deductive, not a rubric**: whether a
vendor's data access implies a specific regulatory regime (GDPR, HIPAA, PCI
DSS, CCPA, etc.) applies, and whether the corresponding attestation exists
(a signed BAA, a PCI-DSS attestation of compliance, GDPR Article 28 terms),
is a checkable fact per regime, not a judgment call — so it is scored the
same deductive way as P2d and P6d. If no regulatory regime is implicated by
the vendor's actual data access, this term defaults to full credit (100),
not a penalty and not a confidence hit — an inapplicable regulatory
question isn't missing data, mirroring how NSHS treats an FCF-positive
company's burn multiple as inapplicable rather than unknown (see
`saas-business-health/reference/algorithm.md` §4).

### P5. Concentration & Criticality

| Sub-metric | Weight in P5 | Formula |
|---|---|---|
| a. Business criticality (1–5 rubric, see §5) | 40% | `reverseLikertToScore(rubricValue)` |
| b. Exit / alternative-vendor feasibility (1–5 rubric, see §5) | 35% | `likertToScore(rubricValue)` |
| c. Redundancy / single-point-of-failure architecture (1–5 rubric, see §5) | 25% | `likertToScore(rubricValue)` |

```
P5 = 0.40a + 0.35b + 0.25c
```

**Why (a) uses the reversed mapping and (b)/(c) don't**: the criticality
rubric (§5) is written so a *higher* value describes a *more* critical,
harder-to-lose relationship — which is *more* risk, hence reversed. The
exit-feasibility and redundancy rubrics are written the opposite way on
purpose (a higher value describes an *easier* exit or *more* redundancy,
i.e., *less* risk), so they use the normal mapping directly. This is a
deliberate authoring choice for each rubric's anchor direction, not an
inconsistency — see the anchor tables in §5 for the exact wording each
value maps to.

**Why criticality is weighted highest within this pillar (40%)**: exit
feasibility and redundancy are both, in effect, mitigations *for* a
criticality problem — they matter more, and mean something different, when
criticality is high than when it's low. A non-critical vendor with a
difficult exit path is a minor inconvenience; a mission-critical vendor with
a difficult exit path is the textbook definition of concentration risk this
pillar exists to catch, which is why criticality anchors the pillar's
weight.

### P6. Monitoring & Remediation Track Record

| Sub-metric | Weight in P6 | Formula |
|---|---|---|
| a. Responsiveness to questionnaires/audit requests (1–5 rubric, see §5) | 25% | `likertToScore(rubricValue)` |
| b. Average time-to-remediate prior findings (days) | 30% | `lerp` anchors: 7→100, 30→80, 60→60, 90→40, 180→20, 365→5 |
| c. Ongoing monitoring cadence in place (1–5 rubric, see §5) | 25% | `likertToScore(rubricValue)` |
| d. Open/overdue findings past their remediation deadline (deductive) | 20% | Start at 100; `−15` per open flag; floor 0 |

```
P6 = 0.25a + 0.30b + 0.25c + 0.20d
```

**Why time-to-remediate gets the largest single weight in this pillar
(30%)**: responsiveness (a) and monitoring cadence (c) both describe
*process* — whether the right motions are happening — but time-to-remediate
is the one metric that measures actual *outcomes* against those processes.
A vendor can be perfectly responsive to a questionnaire and still take a
year to close a critical finding; (b) is what catches that gap, which is
why it outweighs the two process rubrics individually.

**Why open/overdue findings is deductive, not folded into (b)'s average**:
an average time-to-remediate can look fine while a small number of findings
sit open indefinitely past their agreed deadline — averages hide exactly
this tail-risk case. A separate deductive term for currently-open,
past-deadline findings makes that pattern visible instead of averaged away,
the same rationale as P2d and P4d.

---

## 5. Qualitative rubrics (Likert → score)

Base mapping — anchors, not vibes; write down which anchor description
matches before picking a number:

| Value | `likertToScore` | `reverseLikertToScore` |
|---|---|---|
| 1 | 10 | 100 |
| 2 | 35 | 80 |
| 3 | 60 | 60 |
| 4 | 80 | 35 |
| 5 | 100 | 10 |

`likertToScore(v)`: linear interpolation for non-integer averages, same as
this library's other skills. `reverseLikertToScore(v) = likertToScore(6 −
v)` — used only for the three rubrics below whose anchor wording runs the
opposite direction (a *higher* rubric value describes *more* exposure or
criticality, which is *worse*): **P1a, P1b, P5a**. Every other rubric in this
document uses `likertToScore` directly.

**P1a — Data sensitivity classification** (reversed):

| Value | Anchor description |
|---|---|
| 1 | No sensitive data access — public/marketing data only |
| 2 | Low-sensitivity internal data — non-PII internal business data |
| 3 | Moderate sensitivity — limited PII, aggregated/de-identified data, or non-production data only |
| 4 | High sensitivity — significant PII, financial/bank account data, or source code access |
| 5 | Critical sensitivity — regulated data at scale (PHI/PCI/full PII datasets), production credentials, or production system admin access |

**P1b — Access breadth / blast radius** (reversed):

| Value | Anchor description |
|---|---|
| 1 | Read-only access to a single non-production, non-sensitive system |
| 2 | Read-only access to a limited production data set or system |
| 3 | Read-write access to a single production system or a moderate dataset |
| 4 | Broad read-write / administrative access across multiple production systems |
| 5 | Full administrative/privileged access to the core production environment, or the ability to export bulk sensitive data across systems |

**P2a — Certification status** (normal):

| Value | Anchor description |
|---|---|
| 1 | No relevant certification; no formal security program evidence |
| 2 | Self-attestation only (e.g., vendor security questionnaire, no third-party validation) |
| 3 | SOC 2 Type I or equivalent limited-scope audit |
| 4 | SOC 2 Type II or ISO 27001, current, scope covers the relevant service |
| 5 | Multiple current certifications with full-scope coverage (e.g., SOC 2 Type II + ISO 27001, or an industry-specific standard such as PCI-DSS/HITRUST) |

**P3a — BCP/DR maturity** (normal):

| Value | Anchor description |
|---|---|
| 1 | No documented BCP/DR plan |
| 2 | Plan exists but has never been tested |
| 3 | Plan tested annually via tabletop exercise only |
| 4 | Plan tested via a full failover/DR exercise within the past 12 months |
| 5 | Full failover tested within the past 12 months, plus geographically redundant active-active architecture |

**P3d — Financial stability / going-concern risk** (normal):

| Value | Anchor description |
|---|---|
| 1 | Distressed — missed payroll/vendor payments reported, going-concern audit opinion, or imminent insolvency risk |
| 2 | Weak — early-stage with under 12 months of disclosed runway and no disclosed path to profitability |
| 3 | Adequate — funded or profitable, but a small or concentrated balance sheet |
| 4 | Strong — well-capitalized: profitable, or well-funded with 18+ months of runway |
| 5 | Very strong — large, publicly traded or investment-grade-rated, diversified revenue base |

**P4a — DPA adequacy** (normal):

| Value | Anchor description |
|---|---|
| 1 | No DPA in place despite handling regulated or sensitive data |
| 2 | Basic DPA missing key clauses (no breach-notification timeline, no subprocessor terms) |
| 3 | Standard DPA covering the basic requirements |
| 4 | Comprehensive DPA aligned to GDPR Art. 28 / CCPA-equivalent requirements, with clear liability/indemnification terms |
| 5 | Comprehensive DPA plus negotiated enhanced terms (e.g., uncapped liability for a data breach, a security addendum with specific named technical controls) |

**P4c — Right-to-audit & subprocessor governance** (normal):

| Value | Anchor description |
|---|---|
| 1 | No right to audit; subprocessors not disclosed |
| 2 | Limited audit rights (questionnaire only); subprocessors not disclosed |
| 3 | Annual audit rights, or an accepted third-party certification in lieu; subprocessor list available on request |
| 4 | Full audit rights (on-site or documented) and proactive subprocessor disclosure |
| 5 | Full audit rights plus contractual approval/objection rights over new subprocessors |

**P5a — Business criticality** (reversed):

| Value | Anchor description |
|---|---|
| 1 | Non-critical — a sustained outage would have negligible operational impact |
| 2 | Low criticality — a sustained outage would be a minor inconvenience |
| 3 | Moderate criticality — a sustained outage would disrupt a business function but core operations continue |
| 4 | High criticality — a sustained outage would materially disrupt core operations |
| 5 | Mission-critical — a sustained outage would halt a core operation or a regulatory obligation |

**P5b — Exit / alternative-vendor feasibility** (normal):

| Value | Anchor description |
|---|---|
| 1 | No viable alternative; highly proprietary lock-in with no realistic switching path |
| 2 | Switching is theoretically possible but would require a major, costly re-platforming effort |
| 3 | A qualified alternative exists, but migration/integration cost is moderate |
| 4 | Multiple qualified alternatives exist with manageable switching cost |
| 5 | Multiple qualified alternatives, low switching cost, and data portability has been confirmed in practice |

**P5c — Redundancy / single-point-of-failure architecture** (normal):

| Value | Anchor description |
|---|---|
| 1 | Single point of failure; no failover capability |
| 2 | Basic redundancy within a single site/region only |
| 3 | Standard multi-availability-zone redundancy within one region |
| 4 | Multi-region redundancy with tested failover |
| 5 | Fully redundant, multi-region/multi-vendor failover, validated in a real or drilled event |

**P6a — Responsiveness to questionnaires/audit requests** (normal):

| Value | Anchor description |
|---|---|
| 1 | Non-responsive, or refuses standard security questionnaires/audit requests |
| 2 | Slow and incomplete; requires repeated follow-up to get partial answers |
| 3 | Responsive within a reasonable timeline with adequate detail |
| 4 | Responsive ahead of deadline with thorough, well-evidenced answers |
| 5 | Proactive — surfaces relevant security updates and evidence without being asked |

**P6c — Ongoing monitoring cadence in place** (normal):

| Value | Anchor description |
|---|---|
| 1 | No reassessment planned |
| 2 | Ad hoc — only revisited at contract renewal, on a multi-year cycle |
| 3 | Annual reassessment on a fixed cadence |
| 4 | Annual reassessment plus continuous automated monitoring (e.g., a security-ratings service or breach-monitoring feed) |
| 5 | Continuous automated monitoring plus active quarterly engagement/reassessment |

---

## 6. Confidence and missing data

Every pillar has a **required input list** (see `scripts/score.js`'s
`REQUIRED_FIELDS` — 18 fields total). Before computing, count how many
required fields are missing or explicitly marked `"unknown"`.

```
completeness = 1 − (missingCount / totalRequiredFields)
```

- `completeness ≥ 0.9` → **High confidence**. Report the tier as-is.
- `0.7 ≤ completeness < 0.9` → **Medium confidence**. Report the tier with a
  note listing which pillars used estimates.
- `completeness < 0.7` → **Low confidence**. Prefix the output
  `"PRELIMINARY — insufficient data for a reliable score"` and explicitly
  recommend which evidence would resolve the biggest gaps first (prioritize
  closing P1/P2 data-access and security-posture gaps over P6
  process-history gaps — impact and likelihood evidence outweighs behavioral
  history when the file is thin).

**Eighteen fields are unconditionally required** — the rubric and
quantitative inputs across all six pillars listed as `REQUIRED_FIELDS` in
`scripts/score.js`:

```
dataAccess.dataSensitivityRubric, dataAccess.accessBreadthRubric,
securityPosture.certificationStatusRubric, securityPosture.monthsSinceLastCertAudit,
securityPosture.monthsSincePentest,
businessContinuity.bcpDrMaturityRubric, businessContinuity.slaUptimeCommitmentPct,
businessContinuity.slaBreachesTrailing12moCount, businessContinuity.financialStabilityRubric,
contractualCompliance.dpaAdequacyRubric, contractualCompliance.breachNotificationSlaHours,
contractualCompliance.auditSubprocessorGovernanceRubric,
concentrationCriticality.businessCriticalityRubric, concentrationCriticality.exitAlternativeFeasibilityRubric,
concentrationCriticality.redundancySpofRubric,
monitoringRemediation.questionnaireResponsivenessRubric, monitoringRemediation.avgTimeToRemediateDays,
monitoringRemediation.monitoringCadenceRubric
```

**Three fields are opt-in, not opt-out** — each defaults to "nothing found"
when omitted, by design (an empty checklist reads as clean, not unknown),
matching the same convention this library uses for risk-flag checklists
elsewhere (see `saas-business-health`'s `governanceRedFlags` and
`credit-risk-analysis`):

- `securityPosture.confirmedIncidentFlags` (P2d)
- `contractualCompliance.regulatoryGapFlags` (P4d)
- `monitoringRemediation.openOverdueFindingFlags` (P6d)

Only populate these from what the source material actually supports — don't
state "no confirmed incidents" or "no overdue findings" in a report unless
you actually looked (breach-notification history, a findings tracker,
public disclosure records). An unexamined vendor defaulting to a clean P2d/
P4d/P6d score is worse than a low-confidence score, because nothing flags it
as unexamined.

Never silently substitute a default value for a missing required field and
present the result as if it were measured. If a value is genuinely unknown,
pass `null` and let the completeness penalty apply — a lower-confidence real
answer beats a confident wrong one. Internally, `score.js` uses a
**conservative (worst-case) fallback** for any missing required field purely
so the arithmetic can still run — e.g., a missing `dataSensitivityRubric`
computes as if it were `5` (critical sensitivity) — precisely so an
unexamined vendor's *reported* score, before the confidence markdown, never
looks safer than the evidence actually supports. The confidence rating, not
the raw number, is what tells the reader how much to trust that number.

---

## 7. Worked example

**NimbusHR Payroll** — a cloud-based HR/payroll SaaS platform being
onboarded to process employee PII and direct-deposit bank account data,
integrated via API with read-write access to the client's core HRIS system
(not broader production infrastructure). Full input is
`scripts/example-input.json` — run `node scripts/score.js
example-input.json` to reproduce these numbers exactly (they are copied
straight from that output, not hand-estimated).

- Data sensitivity rubric = 4 (high sensitivity — significant PII and
  payroll/bank data), access breadth rubric = 3 (read-write to a single
  production system, the HRIS integration)
- Certification status rubric = 4 (SOC 2 Type II, in-scope), last cert/audit
  report 8 months ago, last pentest 10 months ago, one confirmed security
  incident in the trailing 24 months
- BCP/DR maturity rubric = 4 (full failover tested within 12 months), SLA
  uptime commitment 99.9%, 1 SLA breach/major outage in the trailing 12
  months, financial stability rubric = 4 (well-capitalized, profitable)
- DPA adequacy rubric = 4 (comprehensive, GDPR Art. 28-aligned), breach
  notification SLA 72 hours, audit/subprocessor governance rubric = 3
  (annual audit rights, subprocessor list on request), one regulatory gap
  (payroll/financial data handling lacks a dedicated attestation)
- Business criticality rubric = 4 (high — payroll is a core operational
  function), exit/alternative feasibility rubric = 3 (a qualified
  alternative exists, moderate migration cost), redundancy rubric = 3
  (standard multi-AZ redundancy, single region)
- Questionnaire responsiveness rubric = 4, average time-to-remediate 45
  days, monitoring cadence rubric = 4 (annual reassessment plus continuous
  automated monitoring), one open finding past its remediation deadline

```
P1: a = reverseLikertToScore(4) = likertToScore(2) = 35.0
    b = reverseLikertToScore(3) = likertToScore(3) = 60.0
P1 = 0.55(35.0) + 0.45(60.0) = 19.25 + 27.0 = 46.25

P2: a = likertToScore(4) = 80.0
    b = lerp(8, [6→90, 12→75]) = 90 + (8-6)/(12-6)×(75-90)  = 85.0
    c = lerp(10, [6→90, 12→70]) = 90 + (10-6)/(12-6)×(70-90) = 76.667
    d = clamp(100 - 1×20, 0, 100) = 80.0   (one confirmed incident)
P2 = 0.30(80.0) + 0.20(85.0) + 0.25(76.667) + 0.25(80.0)
   = 24.0 + 17.0 + 19.1667 + 20.0 = 80.1667

P3: a = likertToScore(4) = 80.0
    b = lerp(99.9, [99.5→55, 99.9→80]) = 80.0   (exact anchor)
    c = lerp(1, [0→100, 1→75]) = 75.0   (exact anchor)
    d = likertToScore(4) = 80.0
P3 = 0.30(80.0) + 0.20(80.0) + 0.25(75.0) + 0.25(80.0)
   = 24.0 + 16.0 + 18.75 + 20.0 = 78.75

P4: a = likertToScore(4) = 80.0
    b = lerp(72, [48→80, 72→60]) = 60.0   (exact anchor)
    c = likertToScore(3) = 60.0
    d = clamp(100 - 1×20, 0, 100) = 80.0   (one regulatory gap)
P4 = 0.30(80.0) + 0.25(60.0) + 0.25(60.0) + 0.20(80.0)
   = 24.0 + 15.0 + 15.0 + 16.0 = 70.0

P5: a = reverseLikertToScore(4) = likertToScore(2) = 35.0
    b = likertToScore(3) = 60.0
    c = likertToScore(3) = 60.0
P5 = 0.40(35.0) + 0.35(60.0) + 0.25(60.0) = 14.0 + 21.0 + 15.0 = 50.0

P6: a = likertToScore(4) = 80.0
    b = lerp(45, [30→80, 60→60]) = 80 + (45-30)/(60-30)×(60-80) = 70.0
    c = likertToScore(4) = 80.0
    d = clamp(100 - 1×15, 0, 100) = 85.0   (one open overdue finding)
P6 = 0.25(80.0) + 0.30(70.0) + 0.25(80.0) + 0.20(85.0)
   = 20.0 + 21.0 + 20.0 + 17.0 = 78.0

NVRS = 0.20(46.25) + 0.20(80.1667) + 0.15(78.75) + 0.15(70.0) + 0.15(50.0) + 0.15(78.0)
     = 9.25 + 16.0333 + 11.8125 + 10.5 + 7.5 + 11.7
     = 66.7958 → rounds to 66.8
```

**Result: NVRS 66.8 — Tier 3 (Elevated Risk), High confidence (100%
complete).**

Security posture (P2, 80.2) and monitoring/remediation track record (P6,
78.0) are genuinely strong — a current SOC 2 Type II, a recent pentest, and
responsive, well-monitored vendor behavior. But two pillars pull the
composite down into Tier 3: data access & sensitivity (P1, 46.25) is
structurally weak because this vendor holds significant PII and
direct-deposit financial data with read-write access into the core HRIS —
that exposure doesn't go away no matter how well the vendor otherwise
behaves. Concentration & criticality (P5, 50.0) is the other drag: payroll
is a highly critical operational function, and while a qualified alternative
exists, the migration cost is real, so a single-source dependency is being
carried here. This is exactly the profile Tier 3 exists to describe — not a
"weak vendor," but a vendor whose *access and criticality* demand enhanced
compensating controls (e.g., tightened field-level access scoping in the
HRIS integration, and a documented exit/migration plan on file) even though
its security program itself is sound.

---

## 8. Known limitations

- **Most inputs are self-attested by the vendor unless independently
  verified.** A vendor's answers to a security questionnaire are only as
  reliable as the vendor's honesty and self-awareness; P2's certification and
  pentest terms are stronger evidence specifically because they're backed by
  a named third-party report, but even those reports should be read for
  actual scope (a SOC 2 report that excludes the specific product/service
  being purchased is much weaker evidence than the certification headline
  suggests).
- **Rubric-based terms are assessor-dependent.** Two analysts can
  legitimately land one Likert point apart on BCP/DR maturity or product
  criticality. Mitigate by having a second reviewer independently score
  contested rubrics (especially P1, P5, and P3d) and reconciling before the
  number is used for a go/no-go decision.
- **Criticality and exit-feasibility are relationship-specific, not
  vendor-specific.** The same vendor can and should score differently on P5
  for two different customers — a payroll processor is mission-critical to
  the company using it for live payroll runs and merely convenient to one
  still mid-migration onto it. Never reuse a P5 score computed for one
  business unit or customer relationship for another.
- **NVRS does not assess fourth-party/subprocessor risk directly.** P4c
  scores whether subprocessors are *disclosed and governed* contractually,
  not the security posture of those subprocessors themselves. A vendor with
  excellent NVRS pillars can still inherit meaningful risk from a
  subprocessor that has never itself been assessed — treat a long or opaque
  subprocessor chain as a reason to dig further, not something this score
  resolves.
- **A single-period snapshot decays quickly, and faster than an annual
  financial-health score.** Certifications lapse, pentests age out, and
  incident history changes the moment a new breach is disclosed. Treat NVRS
  as a point-in-time read that should be refreshed on the cadence its own
  tier implies (§3), not left to quietly go stale between contract renewals.
- **Regulatory scope alignment (P4d) is a heuristic gap-check, not a
  compliance certification.** It flags whether an attestation *appears*
  missing given the vendor's disclosed data access — it cannot confirm the
  attestation that does exist is itself adequate, current, or actually
  covers the specific processing activity in question. Route any regulated
  data-handling relationship through a dedicated compliance review regardless
  of this term's result.

## 9. Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-15 | Initial specification and reference implementation |

Any change to a weight, formula, or anchor value is a version bump with an
entry here — the whole point of a proprietary, named algorithm is that "NVRS
70" means the same thing every time it's quoted. Silent tuning defeats that.
