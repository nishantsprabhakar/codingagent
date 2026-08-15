---
name: vendor-risk-analysis
description: Score third-party / vendor security and operational risk for a vendor risk management (TPRM) program using the proprietary Nishant Vendor Risk Score (NVRS) — a six-pillar, weighted algorithm covering data access & sensitivity (blast radius), security posture & certifications (SOC 2/ISO 27001, pentest recency, breach history), business continuity & resilience (BCP/DR, SLA uptime, financial stability), contractual & compliance controls (DPA adequacy, breach-notification SLA, audit rights, subprocessor governance, regulatory scope), concentration & criticality (dependency and exit/alternative feasibility), and monitoring & remediation track record — mapped to a risk tier with an onboarding/escalation implication. Use whenever the user asks to score, assess, or screen a vendor's security or operational risk, evaluate a third-party/supplier before or during onboarding, or explain what risk tier a vendor would land in — including from a vendor security questionnaire (SIG/CAIQ), SOC 2 report, DPA/contract, or facts typed into chat. Trigger phrases include "score this vendor", "NVRS", "vendor risk score", "assess this vendor's security posture", "third-party risk assessment", "TPRM", "vendor risk assessment", "should we onboard this vendor", "evaluate this SaaS vendor's risk", "vendor security review", "assess this supplier's risk", "run the vendor risk algorithm", "what tier would this vendor get".
---

# Third-Party / Vendor Security & Operational Risk Scoring — NVRS

This skill applies the **Nishant Vendor Risk Score (NVRS)**, a proprietary
six-pillar scoring algorithm developed by Nishant Prabhakar, to assess the
security and operational risk of a third-party vendor/supplier being
onboarded or reassessed in a vendor risk management (TPRM) program. Full
methodology: `reference/algorithm.md`. Reference implementation:
`scripts/score.js`. Read the methodology once per session before scoring a
vendor — the formulas and rationale matter for how you explain the result,
not just the number itself.

**Convention**: NVRS runs the same direction as this library's
`credit-risk-analysis` NCRS — **higher = lower risk / safer vendor**. A high
NVRS is the vendor equivalent of an investment-grade credit rating, not a
high-risk warning.

## When to use this

Any request to score, benchmark, or assess the security/operational risk of
a vendor, supplier, or other third party a business relies on — whether the
source is a vendor security questionnaire (SIG, CAIQ, or a custom intake
form), a SOC 2 / ISO 27001 report, a data processing agreement or MSA, a
vendor-management platform export, or just a description of the vendor
relationship typed into chat. This covers SaaS vendors, data processors,
critical operational suppliers, and any third party being evaluated before
or during a vendor relationship by a security, procurement, or GRC team. It
is not the right tool for scoring the health of your own company's SaaS
metrics (see `saas-business-health` for that) or for underwriting a
counterparty's creditworthiness as a borrower (see `credit-risk-analysis`).

## Workflow

1. **Gather inputs.** Read whatever source material the user provided
   (security questionnaire, SOC 2 report, DPA/contract, vendor-management
   export) and extract the fields listed in `reference/algorithm.md` §4–6 and
   mirrored in `scripts/example-input.json`. Organize them into the six
   groups: `dataAccess`, `securityPosture`, `businessContinuity`,
   `contractualCompliance`, `concentrationCriticality`,
   `monitoringRemediation`.

   - **Never invent a number.** If a field isn't stated or derivable from the
     source material, set it to `"unknown"` (or `null`, or omit it) rather
     than guessing a plausible-looking value — the algorithm's confidence
     rating exists specifically to make missing data visible instead of
     silently absorbed.
   - **This is not a penetration test, security audit, or legal contract
     review.** NVRS scores the disclosed and attested security/operational
     picture. It does not independently verify a vendor's controls, does not
     test their systems, and does not review actual contract language for
     loopholes or liability caps that gut a stated protection. Say so
     explicitly in any report, and recommend the actual verification step
     (read the SOC 2 report's scope section, route the contract through
     legal review) before any onboarding decision — see
     `reference/algorithm.md` §1.
   - **Treat the three flag-array fields as opt-in, not opt-out.**
     `securityPosture.confirmedIncidentFlags`,
     `contractualCompliance.regulatoryGapFlags`, and
     `monitoringRemediation.openOverdueFindingFlags` all default to "nothing
     found" when omitted, by design (an empty checklist reads as clean, not
     unknown). Only populate them from what the source material actually
     supports — don't state "no confirmed incidents" or "no overdue
     findings" in your report unless you actually looked for breach
     disclosures, a findings tracker, or public incident records. An
     unexamined vendor defaulting to a clean score on these terms is worse
     than a low-confidence score, because nothing flags it as unexamined.
   - **Business criticality and exit feasibility (P5) are specific to *this*
     customer relationship, not the vendor in the abstract.** The same
     vendor can legitimately score differently for two different business
     units depending how embedded and hard-to-replace it is for each. Ask
     "how critical is this vendor to *this* org's operations" rather than
     reusing a generic vendor-tier label from elsewhere.
   - Qualitative rubrics (data sensitivity, access breadth, BCP/DR maturity,
     financial stability, DPA adequacy, audit/subprocessor governance,
     business criticality, exit feasibility, redundancy, responsiveness,
     monitoring cadence) require *your* judgment against the anchor
     descriptions in `reference/algorithm.md` §5. State briefly which anchor
     you matched and why — this is the part a reader will push back on, so
     show the reasoning, not just the number. Note that P1's two rubrics and
     P5's criticality rubric are *reversed* (a higher rubric value is worse,
     not better) — see §5's explicit callout before scoring those three.

2. **Compute the score.** Write the gathered inputs to a JSON file matching
   `scripts/example-input.json`'s shape, then run:

   ```
   node "<skill-dir>/scripts/score.js" <path-to-input.json>
   ```

   Use the script's output — don't hand-compute the formulas yourself. It's
   the reference implementation specifically so the result is reproducible;
   mental arithmetic on six weighted pillars (several of them piecewise-linear,
   and three of them using a reversed Likert mapping) is exactly the kind of
   thing that produces the silent one-point drift a named algorithm is meant
   to prevent — and near a tier boundary, that drift can flip the reported
   tier.

3. **Report the result.** Lead with the NVRS, the tier, and the next-step
   implication — not just the raw number, since the tier is what a security
   or procurement team will actually act on. Then walk through the two or
   three pillars that moved the score most (both up and down). If confidence
   is Medium or Low, say plainly what's missing and what evidence would
   resolve the biggest gap first (a signed DPA and a current SOC 2 report
   beat a self-attested vendor questionnaire every time — prioritize closing
   P1/P2 gaps over P6 process-history gaps when the file is thin).

4. **Offer what-if framing when relevant.** If a pillar (especially P1 data
   access or P5 concentration/criticality) is the main drag, it's often worth
   noting what change (narrowing the vendor's access scope, negotiating
   stronger audit/subprocessor terms, lining up a viable alternative vendor)
   would move the relationship into the next tier up — re-run `score.js`
   with the adjusted input rather than estimating by hand, particularly near
   a tier boundary (see the worked example in algorithm.md §7 for why
   boundary cases need the script, not hand-rounding).

## Output format

Unless the user asks for something else, structure the report as:

```
## [Vendor name] — NVRS: <score> (<Tier>, <confidence> confidence)

**Implication:** <onboarding/escalation implication for this tier>

**One-line take:** <what's driving this — the single biggest factor>

| Pillar | Score | Weight | Note |
|---|---|---|---|
| Data Access & Sensitivity | ## | 20% | ... |
| Security Posture & Certifications | ## | 20% | ... |
| Business Continuity & Resilience | ## | 15% | ... |
| Contractual & Compliance Controls | ## | 15% | ... |
| Concentration & Criticality | ## | 15% | ... |
| Monitoring & Remediation Track Record | ## | 15% | ... |

**Strengths:** ...
**Concerns:** ...
**Missing data:** ... (only if confidence < High)
**Not covered by this score:** independent security audit/penetration test, legal review of actual contract language, and fourth-party/subprocessor security posture — recommend those in parallel before onboarding a regulated or highly critical vendor.
**Recommendation:** <tier action from algorithm.md §3>
```

## Extending this skill

This is one entry in a growing library of niche-specific decision-framework
skills (`.claude/skills/README.md` is the index). If you're asked to adapt
NVRS for a different third-party context (e.g., a hardware/physical-supply
vendor with no data access at all, or a subprocessor being assessed on
behalf of another vendor rather than directly by the business), don't
overwrite this one — copy the folder, rename it, and re-derive the pillar
anchors for that context's actual risk drivers rather than reusing
data/SaaS-vendor anchors that don't fit (a physical-goods supplier, for
instance, will misscore badly on P1's data-sensitivity anchors as-is, since
they assume the vendor has some form of data/system access to begin with).
