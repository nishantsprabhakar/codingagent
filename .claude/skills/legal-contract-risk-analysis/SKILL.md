---
name: legal-contract-risk-analysis
description: Score the legal risk profile of an enterprise B2B SaaS subscription/services agreement, from the customer's (licensee's) side, using the proprietary Nishant Legal Risk Score (NLRS) — a six-pillar, weighted algorithm covering liability & indemnification exposure, termination & exit rights, IP & confidentiality terms, dispute resolution & governing law, commercial/performance terms, and counterparty & compliance risk. Use whenever in-house counsel or a GC team asks to score, triage, or risk-review a specific commercial contract before signature — including from a vendor's draft MSA/order form, a redlined SaaS agreement, or contract terms typed or pasted into chat. Trigger phrases include "score this contract", "NLRS", "legal risk score", "contract risk triage", "review this SaaS agreement for risk", "should we sign this vendor agreement", "pre-signature legal risk check", "contract redline risk assessment", "run the legal risk algorithm", "what tier would this contract get", "is this contract safe to sign". This tool assists legal risk triage only — it is NOT legal advice, does NOT replace attorney review, and must NEVER be the sole basis for a sign/no-sign decision. Distinct from ma-synergy-analysis (NMSI) and private-equity-analysis (NDQI), which score a company's or transaction's business merits, not a single contract's legal terms.
---

# Commercial Contract Legal Risk Triage — NLRS

This skill applies the **Nishant Legal Risk Score (NLRS)**, a proprietary
six-pillar scoring algorithm developed by Nishant Prabhakar, to score the
**legal risk profile of one specific contract's own terms** — not the
counterparty's business quality, not whether the underlying deal is
commercially attractive, just what the contract's text actually says and
how risky that is for the party signing it.

> **Not legal advice.** This skill assists pre-signature legal risk triage.
> It does **not** constitute legal advice, does **not** replace review by a
> licensed attorney qualified in the relevant jurisdiction, and must
> **never** be the sole basis for a sign/no-sign decision on a material
> contract. Always say this plainly when reporting a result — it is not
> boilerplate to omit when the score looks good.

**Contract type scored (v1.0): an enterprise B2B SaaS subscription/services
agreement, scored from the customer's (licensee's) side** — i.e., in-house
counsel at the company procuring the software reviewing the vendor's paper
before signature. Full methodology, including why this contract type and
this pillar set: `reference/algorithm.md` §1. Reference implementation:
`scripts/score.js`. Read the methodology once per session before scoring a
contract — the formulas and rationale matter for how you explain the
result, not just the number itself.

## When to use this

Any request to score, triage, or risk-review a proposed or existing
commercial SaaS/services agreement before signature — whether the source is
a vendor's draft Master Subscription Agreement (MSA), an order form, a
redlined draft mid-negotiation, or contract terms described or pasted into
chat.

**Not this skill**: if the question is whether a company or a proposed
transaction is a good investment or has a realistic synergy case, use
`private-equity-analysis` (NDQI) or `ma-synergy-analysis` (NMSI) instead —
those score business merits. NLRS scores the legal risk allocation within
one contract's text, independent of whether the underlying deal is a good
idea. NLRS also does not currently cover other contract types (vendor/
supplier goods agreements, M&A definitive agreements, real-property leases,
licensing-out agreements) — see `reference/algorithm.md` §8 before adapting
it to one of those.

## Workflow

1. **Gather inputs.** Read whatever source material the user provided
   (draft MSA, order form, redline, or a description of terms) and extract
   the fields listed in `reference/algorithm.md` §4 and mirrored in
   `scripts/example-input.json`. Organize them into the six groups:
   `liabilityIndemnification`, `terminationExit`, `ipConfidentiality`,
   `disputeResolution`, `commercialPerformance`, `counterpartyCompliance`.

   - **Never invent a number.** If a field isn't stated or derivable from the
     source material, set it to `"unknown"` (or omit it) rather than
     guessing a plausible-looking value — the algorithm's confidence rating
     exists specifically to make missing data visible instead of silently
     absorbed.
   - Qualitative rubrics (indemnification mutuality, wind-down obligations,
     IP ownership clarity, license scope fit, venue favorability, waiver
     mutuality, SLA remedy specificity, compliance reps adequacy) require
     *your* judgment against the anchor descriptions in
     `reference/algorithm.md` §5. State briefly which anchor you matched and
     why — this is the part a reader will push back on, so show the
     reasoning, not just the number.
   - **Liability & indemnification terms deserve extra scrutiny.** This is
     the highest-weighted pillar (25%) precisely because it bounds the
     worst-case financial downside. Read the limitation-of-liability section
     and the indemnification section together, and check the cap language
     against the carve-out list — a healthy-looking cap multiple with no
     carve-outs for IP infringement or data breach is a common trap.
   - **Check exhibits and order forms, not just the main body.** A schedule
     or order form can silently override a favorable clause in the main
     agreement (see `reference/algorithm.md` §8) — always ask the user
     whether an order form, SOW, or exhibit exists before finalizing an
     input, especially for payment terms and SLA commitments, which often
     live there instead of in the main body.

2. **Compute the score.** Write the gathered inputs to a JSON file matching
   `scripts/example-input.json`'s shape, then run:

   ```
   node "<skill-dir>/scripts/score.js" <path-to-input.json>
   ```

   Use the script's output — don't hand-compute the formulas yourself. It's
   the reference implementation specifically so the result is reproducible;
   mental arithmetic on six weighted pillars, each with its own sub-formula,
   is exactly the kind of thing that produces the silent one-point drift the
   whole point of a named algorithm is meant to prevent.

3. **Report the result.** Lead with the NLRS, tier, and confidence level —
   and the not-legal-advice reminder — then walk through the two or three
   pillars that moved the score most (both up and down) rather than
   restating every sub-score. If confidence is Medium or Low, say plainly
   what's missing and which contract section would resolve the biggest gap
   first (usually the limitation-of-liability/indemnification sections,
   since P1 is the highest-weighted pillar).

4. **Offer what-if framing when relevant.** If a specific clause is the main
   drag on the score (e.g., a low liability cap multiple, or missing
   carve-outs), it's often worth noting what redline would move the
   contract into the next tier up — a higher cap multiple, an added
   carve-out category, a shorter cure period. Re-run `score.js` with the
   adjusted input rather than estimating by hand.

## Output format

Unless the user asks for something else, structure the report as:

```
## [Customer] / [Vendor] — NLRS: <score> (<Tier>, <confidence> confidence)

**Not legal advice** — this is a pre-signature risk triage aid, not a
substitute for attorney review; do not treat this score as the sole basis
for a sign/no-sign decision.

**One-line take:** <what's driving this — the single biggest factor>

| Pillar | Score | Weight | Note |
|---|---|---|---|
| Liability & Indemnification Exposure | ## | 25% | ... |
| Termination & Exit Rights | ## | 20% | ... |
| IP & Confidentiality Terms | ## | 15% | ... |
| Dispute Resolution & Governing Law | ## | 10% | ... |
| Commercial & Performance Terms | ## | 15% | ... |
| Counterparty & Compliance Risk | ## | 15% | ... |

**Strengths:** ...
**Concerns:** ...
**Missing data:** ... (only if confidence < High)
**Recommendation:** <tier action from algorithm.md §3>
```

## Extending this skill

This is one entry in a library of niche-specific skills
(`.claude/skills/README.md` is the index) — the library's first branch into
the legal domain rather than finance/investment. NLRS v1.0 is deliberately
scoped to one contract type and one reviewing side: an enterprise B2B SaaS
subscription/services agreement, scored from the customer's (licensee's)
side. Several formulas here assume that framing (P5a's payment-term
direction rewards longer float for the paying customer; P6c's assignment-
restriction framing protects the party being asked to consent to a
successor) and would misscore a different contract type or the opposite
party's perspective. If asked to adapt NLRS for a vendor/supplier goods
agreement, an M&A definitive agreement, a real-property lease, or the
vendor's (licensor's) side of a SaaS deal, don't overwrite this one — copy
the folder, rename it, and re-derive the pillar weights/anchors/direction,
per `reference/algorithm.md` §8.
