# Nishant Legal Risk Score (NLRS) — v1.0

**Proprietary scoring methodology for commercial contract legal-risk triage,
developed by Nishant Prabhakar.**

Status: v1.0 (2026-08-15). Author/owner: Nishant Prabhakar. This document is
the authoritative specification — `scripts/score.js` is a direct, literal
implementation of the formulas below. If the two ever disagree, this document
is correct and the script has a bug.

Named in the tradition of other analyst-attributed scoring models (the Altman
Z-Score, the Piotroski F-Score) — the point of putting a name on a model is
that the name becomes shorthand for a specific, checkable methodology, not a
vibe. "NLRS 73" should mean the same thing regardless of who's asking or who's
answering.

> **This tool is not legal advice.** The NLRS assists in-house counsel and GC
> teams with pre-signature legal risk **triage** — a structured, repeatable
> way to flag which contracts and which clauses deserve attorney attention
> first. It does **not** constitute legal advice, does not replace review by
> a licensed attorney qualified in the relevant jurisdiction, and must
> **never** be the sole basis for a sign/no-sign decision on a material
> contract. Every tier below carries a "consult counsel" implication at some
> threshold precisely because a score is a triage signal, not a legal
> opinion. Treat the output as a prioritization aid for human review, not a
> substitute for it.

---

## 1. Purpose and positioning

**Contract type scored: an enterprise B2B SaaS subscription/services
agreement (a vendor's software-as-a-service and associated implementation/
support terms), scored from the customer's (licensee's) side — i.e., the
perspective of in-house counsel at the company procuring the software,
reviewing the vendor's paper before signature.** This is the single most
common contract in-house legal teams triage at volume (compared to, say, a
one-off M&A definitive agreement or a real property lease), which is why it's
the contract type this v1.0 specifies precisely. See §8 for why this does
**not** generalize as-is to other contract types (vendor/supplier goods
agreements, M&A definitive agreements, licensing/IP-out agreements, etc.).

The NLRS is a **pre-signature legal risk triage tool scoring a specific
contract's own legal terms** — not the counterparty's business quality, not
whether the deal is commercially attractive, and not whether the underlying
transaction is a good idea. It exists to answer the question every GC team
asks on every vendor contract that crosses their desk before signature: *does
this paper carry standard, acceptable risk, or does it need to be
renegotiated — and if so, which clauses, and how urgently?*

**Not this skill**: if the question is whether a company or a deal is a good
investment or a good synergy case, use `private-equity-analysis` (NDQI) or
`ma-synergy-analysis` (NMSI) instead — those score the business merits of a
company or transaction. NLRS specifically scores the legal risk allocation
**within the four corners of one contract's text**, independent of whether
the underlying deal is a good idea.

**Why six pillars, and why these six.** Contract risk review by legal teams
consistently organizes around a small number of recurring clause families,
and this pillar set maps directly onto them, chosen to be genuinely
non-overlapping for a SaaS/services agreement:

1. **Liability & Indemnification Exposure** is weighted highest (25%)
   because it is the single most financially consequential clause family in
   a vendor contract — a low liability cap with no carve-outs can leave an
   enterprise customer without meaningful recourse for a catastrophic vendor
   failure (a data breach, an IP infringement claim, a security incident),
   regardless of how favorable every other clause reads.
2. **Termination & Exit Rights** is split out from liability because it
   governs a different failure mode: not "what can we recover if things go
   wrong," but "how hard is it to leave, and how much does leaving cost us"
   — vendor lock-in, notice-period asymmetry, and wind-down obligations are
   an operational risk independent of the liability math.
3. **IP & Confidentiality Terms** is its own pillar because SaaS agreements
   routinely blur data/IP ownership in the vendor's favor (broad license-back
   grants, ambiguous rights over customer data or configurations) — a
   distinct risk from liability or exit mechanics.
4. **Dispute Resolution & Governing Law** is split out because it determines
   the *forum and cost* of enforcing every other clause in the contract — a
   contract with excellent substantive terms but a hostile, distant, or
   one-sided forum clause can make those terms practically unenforceable.
5. **Commercial & Performance Terms** captures the day-to-day operating
   mechanics (payment, SLA remedies, price escalation) — distinct from legal
   exposure in a dispute, this pillar is about whether the contract performs
   as expected during the ordinary course of the relationship.
6. **Counterparty & Compliance Risk** is split out because it scores facts
   *about the vendor* (financial stability, compliance posture, ability to
   be assigned to an unknown successor) rather than facts *in the contract
   text* — a vendor's paper can read perfectly and still carry risk because
   the vendor itself is financially fragile or under-compliant.

It is deliberately **not** a black box: every sub-score is a named, auditable
formula against a named input. If an input is unknown, the algorithm says so
and degrades its confidence rating rather than guessing silently.

**What the NLRS is not**: a substitute for reading the full contract text,
its exhibits/schedules, and its defined terms; a jurisdiction-specific legal
opinion; or a compliance certification. It scores the *legal risk profile of
the contract's stated terms* as extracted by the reviewer — it cannot detect
a schedule or exhibit that silently overrides an outwardly favorable clause,
and it does not replace the judgment of a licensed attorney reviewing the
actual document.

---

## 2. Structure at a glance

Six weighted pillars, each scored 0–100 (**higher score = lower legal risk /
more favorable to the customer**), rolled into one composite:

| Pillar | Weight | What it answers |
|---|---|---|
| P1. Liability & Indemnification Exposure | 25% | If the vendor's platform causes real harm, can we actually recover, and are the worst-case scenarios excluded from the cap? |
| P2. Termination & Exit Rights | 20% | How easy is it to leave — on our terms and on theirs — and what does leaving cost us? |
| P3. IP & Confidentiality Terms | 15% | Do we clearly keep what's ours, and is our confidential information protected for long enough? |
| P4. Dispute Resolution & Governing Law | 10% | If this goes to a dispute, where does it happen, under whose law, and on what terms? |
| P5. Commercial & Performance Terms | 15% | Do payment, SLA, and pricing terms behave predictably over the life of the contract? |
| P6. Counterparty & Compliance Risk | 15% | Is the vendor itself a stable, compliant counterparty who can actually perform and pay if something goes wrong? |

```
NLRS = 0.25·P1 + 0.20·P2 + 0.15·P3 + 0.10·P4 + 0.15·P5 + 0.15·P6
```

**Weighting rationale**: P1 (liability/indemnification) is weighted highest
at 25% because it bounds the worst-case financial downside of the entire
relationship — every other pillar matters, but none of them cap the loss the
way P1 does. P2 (termination/exit) is second at 20% because operational
lock-in risk compounds every year the contract renews, and is often the
hardest risk to unwind after signature. P3, P5, and P6 sit at 15% each —
each materially important but none individually as loss-bounding as P1 or as
compounding as P2. P4 (dispute resolution/governing law) is weighted lowest
at 10% deliberately: forum and venue terms matter, but only for the
subset of relationships that actually end up in a dispute, and a favorable
forum cannot rescue a contract whose substantive terms (P1–P3, P5–P6) are
already bad.

---

## 3. Score bands (risk tiers)

| NLRS | Tier | Legal sign-off implication |
|---|---|---|
| 80–100 | **Standard terms — proceed** | Terms are at or better than market standard; route through ordinary contract execution with no incremental legal escalation |
| 65–79 | **Acceptable, minor flags — proceed with redlines** | Proceed to signature after addressing the specific flagged clauses in the standard redline pass; no escalation required |
| 50–64 | **Elevated risk — negotiate before signing** | Do not execute as-is; the weak pillar(s) must be redlined and re-negotiated, and the revised draft should get a second attorney review before signature |
| 35–49 | **High risk — requires escalation** | Escalate to senior counsel/General Counsel before continuing negotiation; if a flagged term cannot be fixed, the business owner needs a documented risk-acceptance memo before proceeding |
| 0–34 | **Severe risk — do not sign without GC/executive sign-off** | Do not sign; requires explicit General Counsel and business-owner executive sign-off with a documented risk acceptance, or the deal should be walked away from |

These bands assume **high confidence** inputs (see §6). Under low confidence,
treat the tier as directional only and widen the band by ±10 points in your
head before acting on it. Regardless of tier, **no NLRS output should be the
sole basis for a sign/no-sign decision on a material contract** — see the
disclaimer in §1.

---

## 4. Pillar formulas

All sub-scores are clamped to `[0, 100]` after computation unless stated
otherwise. `clamp(x, lo, hi)` = min(max(x, lo), hi). `lerp` = piecewise-linear
interpolation between named anchor points. Every sub-metric is oriented so
that **higher = lower risk to the customer** — a small, well-protected,
customer-favorable term always scores high, regardless of which pillar it's
in.

### P1. Liability & Indemnification Exposure

| Sub-metric | Weight in P1 | Formula |
|---|---|---|
| a. Liability cap level, as a multiple of trailing-12-month contract fees | 40% | If `"uncapped"` → 100. Else `lerp` on the numeric multiple: anchors `0→10, 0.5→30, 1→55, 2→75, 3→90, 5→100` |
| b. Carve-outs from the general cap (uncapped/super-cap exceptions) | 35% | `(matchedCarveOutCount / 5) × 100`, where the 5 recognized carve-out categories are: IP infringement, gross negligence/willful misconduct, confidentiality breach, data breach/security incident, and indemnification obligations themselves |
| c. Mutuality of indemnification obligations (1–5 rubric, see §5) | 25% | `likertToScore(rubricValue)` |

```
P1 = 0.40a + 0.35b + 0.25c
```

**Why (a) treats "uncapped" as the ceiling, not a red flag**: in a customer-
side risk read, an uncapped vendor liability is the single most protective
outcome available — it means the customer's recovery is not artificially
limited if the vendor causes serious harm. A cap below 1x annual fees is
common in vendor-favorable paper and is treated as materially risky (55 or
below) because it is frequently far smaller than the plausible cost of a
serious outage, breach, or IP claim.

**Why (b) carries near-equal weight to the cap level itself**: a healthy
cap multiple with no carve-outs is still a trap — if IP infringement or a
data breach is *not* excluded from the general cap, the cap effectively
protects the vendor against the exact scenarios an enterprise customer is
most exposed to. A high cap number is much less meaningful without the
carve-outs that keep it from applying to catastrophic-loss scenarios.

### P2. Termination & Exit Rights

| Sub-metric | Weight in P2 | Formula |
|---|---|---|
| a. Customer's termination-for-convenience right and required notice | 35% | If `customerTerminationForConvenience` is false → 30. Else `lerp` on `customerTerminationNoticeDays`: anchors `0→100, 30→90, 60→75, 90→60, 180→40` |
| b. Termination-for-cause cure period required before customer can exit for vendor breach | 30% | `lerp` on `terminationForCauseCureDays`: anchors `0→100, 15→85, 30→70, 45→55, 60→40, 90→20` |
| c. Post-termination obligations / wind-down (data return, transition assistance, exit fees) (1–5 rubric, see §5) | 35% | `likertToScore(rubricValue)` |

```
P2 = 0.35a + 0.30b + 0.35c
```

**Why shorter is better in both (a) and (b)**: from the customer's risk
perspective, flexibility to exit cuts both ways favorably — a *short* notice
period on customer termination-for-convenience means the customer isn't
locked into a long tail after deciding to leave, and a *short* cure period on
termination-for-cause means the customer isn't stuck feeding a
non-performing vendor for months before it can exit. Both anchors reward
shorter numbers because both measure how quickly the customer can act once
it has decided to.

### P3. IP & Confidentiality Terms

| Sub-metric | Weight in P3 | Formula |
|---|---|---|
| a. IP ownership/assignment clarity for customer data and work product (1–5 rubric, see §5) | 40% | `likertToScore(rubricValue)` |
| b. License scope fit to actual business need (1–5 rubric, see §5) | 30% | `likertToScore(rubricValue)` |
| c. Confidentiality survival term post-termination | 30% | If `"perpetual"` → 100. Else `lerp` on the numeric year count: anchors `0→20, 1→40, 2→60, 3→75, 5→90`. If `standardConfidentialityCarveOutsPresent` is `false`, subtract 15 (floor 0) |

```
P3 = 0.40a + 0.30b + 0.30c
```

**Why (a) is weighted highest in this pillar**: ambiguous IP ownership over
customer data or custom work product is the most common and most consequential
IP defect in SaaS paper — a vendor claiming broad usage/derivative rights
over customer data, or leaving ownership of custom integrations unaddressed,
creates risk that compounds the longer the relationship runs (data
portability at exit, competitive exposure, etc.).

**Why the carve-out penalty on (c)**: a long confidentiality term with no
standard carve-outs (already-public information, independently developed
information, legally compelled disclosure) is itself a red flag — it usually
signals a boilerplate clause nobody actually negotiated, not a genuinely
protective one.

### P4. Dispute Resolution & Governing Law

| Sub-metric | Weight in P4 | Formula |
|---|---|---|
| a. Dispute resolution mechanism | 35% | Categorical: `"litigation_only"→50, "arbitration_binding"→75, "med_arb_tiered"→80, "arbitration_with_injunctive_relief_carveout"→90` |
| b. Venue / governing law favorability to customer (1–5 rubric, see §5) | 35% | `likertToScore(rubricValue)` |
| c. Mutuality of jury-trial and class-action waivers (1–5 rubric, see §5) | 30% | `likertToScore(rubricValue)` |

```
P4 = 0.35a + 0.35b + 0.30c
```

**Why "arbitration with an injunctive relief carve-out" scores highest in
(a)**: pure litigation preserves full rights but is slow and expensive;
pure binding arbitration is faster/cheaper but forecloses emergency court
relief; a hybrid that routes routine disputes to arbitration while
preserving the ability to seek emergency injunctive relief in court (the
scenario that actually matters for time-sensitive IP or confidentiality
breaches) captures the benefit of both without the main drawback of either.

**Why (c) scores *mutuality*, not presence**: jury-trial and class-action
waivers are standard, largely neutral tools between sophisticated commercial
parties. The risk signal isn't whether they exist — it's whether they apply
**only** to the customer while the vendor retains its own options, which is
the one-sided version that should score low.

### P5. Commercial & Performance Terms

| Sub-metric | Weight in P5 | Formula |
|---|---|---|
| a. Payment terms (net days customer has to pay) | 30% | `lerp` on `netPaymentDays`: anchors `15→40, 30→70, 45→85, 60→95, 90→100` |
| b. SLA / performance-standard specificity and remedies for breach (1–5 rubric, see §5) | 40% | `likertToScore(rubricValue)` |
| c. Price-adjustment / escalation cap | 30% | If `"uncapped"` → 15. Else `lerp` on the numeric annual cap %: anchors `0→100, 3→85, 5→70, 7→55, 10→40` |

```
P5 = 0.30a + 0.40b + 0.30c
```

**Why longer payment terms score higher in (a)**: from the paying customer's
side, more float (longer net-days) is lower risk, not higher — it preserves
cash-flow flexibility and reduces the chance of an inadvertent late-payment
default. This is the opposite orientation from how a vendor/seller would
score the same clause, which is expected — NLRS scores risk to whichever
party is doing the reviewing, and this v1.0 is built for the customer side.

### P6. Counterparty & Compliance Risk

| Sub-metric | Weight in P6 | Formula |
|---|---|---|
| a. Counterparty financial stability tier | 40% | Categorical: `"financial_distress_signals_present"→15, "private_early_stage_or_vc_backed"→50, "private_stable_profitable"→75, "public_large_cap"→95` |
| b. Regulatory/compliance representations and warranties adequacy (1–5 rubric, see §5) | 35% | `likertToScore(rubricValue)` |
| c. Assignment / change-of-control restriction | 25% | Categorical: `"vendor_can_assign_freely"→20, "vendor_can_assign_to_affiliate_or_successor_no_consent"→45, "notice_required_no_consent"→60, "consent_required_not_unreasonably_withheld"→85, "consent_required_sole_discretion"→95` |

```
P6 = 0.40a + 0.35b + 0.25c
```

**Why (a) carries the most weight in this pillar**: every other protection
in the contract — the liability cap, the indemnification obligation, the SLA
credits — is only as good as the vendor's ability to actually pay or perform
on it. A financially distressed vendor with excellent contract language is
still a high-risk counterparty in practice.

---

## 5. Qualitative rubrics (Likert → score)

Used for P1c, P2c, P3a, P3b, P4b, P4c, P5b, P6b. Anchors, not vibes — write
down which anchor description matches before picking a number.

| Value | Score | Anchor description |
|---|---|---|
| 1 | 10 | Absent / actively concerning |
| 2 | 35 | Weak — present but thin, easily challenged |
| 3 | 60 | Adequate — defensible, industry-standard |
| 4 | 80 | Strong — clearly above peer set |
| 5 | 100 | Exceptional — genuinely best-in-class protection |

`likertToScore`: linear interpolation is fine for non-integer averages.

**Indemnification mutuality (P1c)**: is the indemnification obligation
symmetric — does the vendor indemnify the customer for the vendor's own IP
infringement and data breaches on terms comparable to what the customer
owes the vendor for its own misuse? A "1" is a one-sided obligation running
almost entirely against the customer; a "5" is fully mutual, comparable
scope and comparable carve-outs on both sides.

**Post-termination obligations / wind-down (P2c)**: rate the quality of data
export format and timeline, transition-assistance period, deletion
certification, and whether the vendor charges additional fees to exit. A "1"
is no defined data-return obligation and/or punitive exit fees; a "5" is a
clearly specified export format, a reasonable transition-assistance window,
and no additional exit charges.

**IP ownership/assignment clarity (P3a)**: does the contract unambiguously
state the customer retains all right, title, and interest in its own data
and any custom work product/integrations, granting the vendor only a narrow
license needed to provide the service? A "1" is ambiguous or vendor-favorable
(broad derivative-works or usage rights over customer data); a "5" is
unambiguous customer ownership with a narrow, purpose-limited license back
to the vendor.

**License scope fit (P3b)**: does the granted license scope (users,
affiliates, use cases, geographies) actually match the customer's real
business need, or does it create friction (undercounted seats, no affiliate
rights, restrictive use-case carve-outs)? A "1" is materially narrower than
business need; a "5" is a scope that cleanly covers current and reasonably
foreseeable use without renegotiation.

**Venue / governing law favorability (P4b)**: is the chosen forum and body
of law neutral or favorable to the customer (customer's home jurisdiction, a
well-established, predictable body of commercial law), or is it the vendor's
exclusive home turf under an unfamiliar or unfavorable legal regime? A "1" is
a distant, vendor-favorable, unfamiliar jurisdiction; a "5" is the customer's
own jurisdiction or a genuinely neutral, well-established commercial venue.

**Waiver mutuality (P4c)**: do jury-trial/class-action waivers apply equally
to both parties, or only to the customer? A "1" is a one-sided waiver
binding only the customer while the vendor retains its options; a "5" is
fully mutual (or absent for both equally).

**SLA/performance remedy specificity (P5b)**: are there measurable,
numeric performance commitments (uptime %, response times) with meaningful
remedies (service credits scaling with severity, a termination right after
chronic failure)? A "1" is a "commercially reasonable efforts" standard with
no measurable target or remedy; a "5" is specific numeric commitments with
credits and an escalating remedy up to termination for chronic breach.

**Regulatory/compliance reps adequacy (P6b)**: do the vendor's
representations and warranties adequately cover data-protection compliance
(e.g., GDPR/CCPA as applicable), security certifications (e.g., SOC 2 Type
II, ISO 27001), and anti-corruption/export-control compliance, backed by
audit rights? A "1" is no meaningful compliance representations; a "5" is
comprehensive reps, required certifications, and contractual audit rights.

---

## 6. Confidence and missing data

Every pillar has a **required input list** (see `scripts/score.js`'s
`REQUIRED_FIELDS` — 20 fields total across the six pillars). Before
computing, count how many required fields are missing or explicitly marked
`"unknown"`.

```
completeness = 1 − (missingCount / totalRequiredFields)
```

- `completeness ≥ 0.9` → **High confidence**. Report the tier as-is.
- `0.7 ≤ completeness < 0.9` → **Medium confidence**. Report the tier with a
  note listing which pillars used estimates.
- `completeness < 0.7` → **Low confidence**. Prefix the output
  `"PRELIMINARY — insufficient data for a reliable score"` and explicitly
  recommend which contract sections would resolve the biggest gaps first
  (usually: the limitation-of-liability and indemnification sections,
  since P1 is the highest-weighted pillar and the one most likely to hide
  in dense cross-referenced boilerplate).

Never silently substitute a default value for a missing required field and
present the result as if it were measured. If a clause is genuinely unclear
or not found in the contract text, pass `null`/`"unknown"` and let the
completeness penalty apply — a lower-confidence real answer beats a
confident wrong one. (The numeric fallbacks used internally by `score.js`
when a field is missing exist only so the arithmetic can still run; they are
not claims about the contract, and the missing-field count is what actually
drives the confidence rating reported to the user.)

Regardless of confidence level, the disclaimer in §1 applies at every tier:
this is a triage aid, not a substitute for attorney review of the actual
document.

---

## 7. Worked example

Hypothetical enterprise SaaS procurement: **Brightline Retail Corp**
(customer, in-house counsel reviewing before signature) evaluating a
proposed Master Subscription Agreement from **Vertex Cloud Analytics**
(vendor — a mid-size, privately held retail-analytics SaaS provider). Full
input is `scripts/example-input.json` — run
`node scripts/score.js scripts/example-input.json` to reproduce these
numbers exactly (they're copied straight from that output).

- Liability cap: 1.5x trailing-12-month fees. Carve-outs from cap: IP
  infringement, confidentiality breach, and data breach/security incident
  present (3 of 5 recognized categories); gross negligence/willful
  misconduct and the indemnification obligations themselves are *not*
  separately carved out. Indemnification mutuality rubric = 3.
- Customer has termination-for-convenience with 60 days' notice.
  Termination-for-cause cure period = 30 days. Post-termination
  obligations/wind-down rubric = 4.
- IP ownership clarity rubric = 4. License scope rubric = 3. Confidentiality
  survives 3 years post-termination, with standard carve-outs present.
- Dispute resolution mechanism = arbitration with an injunctive-relief
  carve-out. Venue/governing law favorability rubric = 3. Waiver mutuality
  rubric = 4.
- Net payment terms = 45 days. SLA remedy specificity rubric = 4. Annual
  price-increase cap = 5%.
- Counterparty financial stability tier = "private, stable, profitable".
  Compliance reps adequacy rubric = 4. Assignment/change-of-control
  restriction = "consent required, not unreasonably withheld".

```
P1: a = 1.5x → lerp([1,55],[2,75]) = 55 + (1.5-1)/(2-1)×(75-55) = 65.0
    b = 3/5 carve-outs × 100 = 60.0
    c = likert(3) = 60.0
P1 = 0.40(65.0) + 0.35(60.0) + 0.25(60.0) = 26.0 + 21.0 + 15.0 = 62.0

P2: a = 60 days notice → anchor exactly at [60,75] = 75.0
    b = 30 days cure → anchor exactly at [30,70] = 70.0
    c = likert(4) = 80.0
P2 = 0.35(75.0) + 0.30(70.0) + 0.35(80.0) = 26.25 + 21.0 + 28.0 = 75.25

P3: a = likert(4) = 80.0
    b = likert(3) = 60.0
    c = 3 years → anchor exactly at [3,75] = 75.0 (carve-outs present, no penalty)
P3 = 0.40(80.0) + 0.30(60.0) + 0.30(75.0) = 32.0 + 18.0 + 22.5 = 72.5

P4: a = "arbitration_with_injunctive_relief_carveout" = 90.0
    b = likert(3) = 60.0
    c = likert(4) = 80.0
P4 = 0.35(90.0) + 0.35(60.0) + 0.30(80.0) = 31.5 + 21.0 + 24.0 = 76.5

P5: a = 45 days → anchor exactly at [45,85] = 85.0
    b = likert(4) = 80.0
    c = 5% → anchor exactly at [5,70] = 70.0
P5 = 0.30(85.0) + 0.40(80.0) + 0.30(70.0) = 25.5 + 32.0 + 21.0 = 78.5

P6: a = "private_stable_profitable" = 75.0
    b = likert(4) = 80.0
    c = "consent_required_not_unreasonably_withheld" = 85.0
P6 = 0.40(75.0) + 0.35(80.0) + 0.25(85.0) = 30.0 + 28.0 + 21.25 = 79.25

NLRS = 0.25(62.0) + 0.20(75.25) + 0.15(72.5) + 0.10(76.5) + 0.15(78.5) + 0.15(79.25)
     = 15.5 + 15.05 + 10.875 + 7.65 + 11.775 + 11.8875 = 72.7375 → 72.7
```

**Result: NLRS 72.7 — Acceptable, minor flags; proceed with redlines tier
(High confidence, 100% complete).** The contract is fundamentally sound and
can proceed to signature after the standard redline pass, but the lowest
pillar — P1, Liability & Indemnification Exposure (62.0) — deserves specific
attention: the 1.5x liability cap is only moderately protective, and two of
the five standard catastrophic-loss carve-outs (gross negligence/willful
misconduct, and the indemnification obligations themselves) are missing from
the cap exclusions. Pushing the carve-out count from 3 to 5 would raise P1's
(b) sub-score from 60 to 100, lifting P1 to roughly 76.0 and the composite
NLRS to roughly 76.2 — still in the same tier, but meaningfully de-risked on
the highest-weighted pillar. As always, this result is a triage signal for
where to focus attorney review, not a substitute for it (see §1).

---

## 8. Known limitations

- **Not legal advice, and not a substitute for attorney review.** Restated
  from §1 because it bears repeating in a limitations section: this tool
  assists risk triage and prioritization. It does not replace review of the
  actual contract text by a licensed attorney, and it must never be the sole
  basis for a sign/no-sign decision on a material contract.
- **Scoped to one contract type and one reviewing party.** This v1.0 is
  calibrated specifically for an enterprise B2B SaaS subscription/services
  agreement, scored from the customer's (licensee's) side. It does **not**
  generalize as-is to a vendor/supplier goods agreement, an M&A definitive
  agreement, a real-property lease, an employment agreement, or a
  licensing-out (IP owner's side) agreement — several formulas here (P5a's
  payment-term direction, P6c's assignment-restriction framing) are oriented
  specifically for a paying, licensing customer and would misscore a
  different contract type or the opposite party's perspective. Copy the
  folder and re-derive the pillar weights/anchors/direction before adapting
  to a different contract type or reviewing side.
- **Cannot detect exhibit/schedule overrides.** The score reflects the
  clauses as extracted by the reviewer from the main body of the agreement.
  A schedule, order form, or exhibit that silently narrows or overrides an
  outwardly favorable clause (a common vendor-paper tactic) will not be
  caught unless the reviewer explicitly checks defined terms and referenced
  exhibits against the main text.
- **Qualitative rubrics are reviewer-dependent.** Two reviewers can
  legitimately land one Likert point apart on venue favorability or license
  scope fit. Mitigate by having a second reviewer score contested rubrics
  independently and averaging, particularly for P1c and P4b, which tend to
  hide the most interpretation.
- **Governing law favorability is not a substitute for local-counsel
  analysis.** P4b is a directional screen on venue/forum convenience, not a
  conclusion about the substantive protections available under a given
  body of law — a low P4b score should trigger "get local counsel in that
  jurisdiction," not a standalone legal conclusion.
- **The model rewards clean, well-drafted paper.** A genuinely acceptable
  deal reviewed from a poorly organized or heavily cross-referenced contract
  will score lower on confidence, not on merit — don't conflate the two when
  presenting results.
- **Counterparty financial stability (P6a) is a point-in-time signal.** A
  vendor's financial position can change materially over a multi-year
  contract term; treat P6a as current-state input that should be
  refreshed at renewal, not a permanent characteristic of the vendor.

## 9. Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-15 | Initial specification and reference implementation |

Any change to a weight, formula, or anchor value is a version bump with an
entry here — the whole point of a proprietary, named algorithm is that
"NLRS 73" means the same thing every time it's quoted. Silent tuning defeats
that.
