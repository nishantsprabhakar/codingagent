---
name: credit-risk-analysis
description: Score corporate credit risk and underwrite lending opportunities using the proprietary Nishant Credit Risk Score (NCRS) — a six-pillar, weighted algorithm covering leverage, coverage, liquidity, profitability & stability, industry & cyclicality risk, and qualitative/governance factors, mapped to an agency-style rating band and indicative credit spread. Use whenever the user asks to score a credit, underwrite a loan, assess a borrower's default risk, or explain what rating a company would get — including from financial statements, a credit memo, a data room, or numbers typed into chat. Trigger phrases include "score this credit", "NCRS", "credit risk score", "underwrite this loan", "what rating would this borrower get", "assess this borrower's default risk", "credit analysis", "run the credit algorithm".
---

# Corporate Credit Risk Analysis — NCRS

This skill applies the **Nishant Credit Risk Score (NCRS)**, a proprietary
six-pillar scoring algorithm developed by Nishant Prabhakar, to underwrite
corporate lending opportunities and score default risk for triage/pricing
purposes. Full methodology: `reference/algorithm.md`. Reference
implementation: `scripts/score.js`. Read the methodology once per session
before scoring a credit — the formulas and rationale matter for how you
explain the result, not just the number itself.

## When to use this

Any request to score, underwrite, rate, or write a credit memo for a
corporate borrower or lending opportunity — whether the source is audited
financials, a credit memo, a data-room extract, a management deck, or just a
description of the borrower's numbers typed into chat. This covers term
loans, revolvers, secured and unsecured facilities, and general "how risky is
this borrower" questions.

## Workflow

1. **Gather inputs.** Read whatever source material the user provided
   (financial statements, credit memo, data room, uploaded files) and extract
   the fields listed in `reference/algorithm.md` §4–6 and mirrored in
   `scripts/example-input.json`. Organize them into the six groups:
   `leverage`, `coverage`, `liquidity`, `profitability`, `industry`,
   `qualitative`.

   - **Never invent a number.** If a field isn't stated or derivable from the
     source material, set it to `"unknown"` (or `null`, or omit it) rather
     than guessing a plausible-looking value — the algorithm's confidence
     rating exists specifically to make missing data visible instead of
     silently absorbed.
   - **This is not a substitute for full legal/covenant review.** NCRS scores
     the disclosed financial and qualitative picture. It does not read the
     credit agreement, does not verify lien perfection, and does not check
     cross-default language. Say so explicitly in any report, and recommend
     counsel review before any facility closes — see `reference/algorithm.md`
     §1.
   - **Handle the two conditional fields gracefully, not as missing data.**
     `liquidity.cashRunwayMonths` only matters if the borrower is
     cash-flow-negative; `qualitative.collateralQualityRubric` only matters
     if the facility is secured. If neither condition applies, leave the
     field out — it is correctly excluded from the completeness calculation,
     not silently penalized (see algorithm.md §4 and §6).
   - **Treat `qualitative.governanceRedFlags` as opt-in, not opt-out.** It
     defaults to "nothing found" when omitted, by design (an empty checklist
     reads as clean, not unknown). Only populate it from what the source
     material actually supports — don't state "no governance flags" in your
     report unless you actually looked for related-party transactions, audit
     qualifications, covenant breach history, and management turnover. An
     unexamined borrower defaulting to a clean P6 score is worse than a
     low-confidence score, because nothing flags it as unexamined.
   - Sector comps (median leverage, median EBITDA margin) usually aren't in
     the borrower's own financials. Ask the user for their comp set, or say
     explicitly that you're using a stated/assumed comp figure and flag it as
     an estimate.
   - Qualitative rubrics (management quality, collateral quality, industry
     cyclicality) require *your* judgment against the anchor descriptions in
     `reference/algorithm.md` §4–5. State briefly which anchor you matched and
     why — this is the part a reader will push back on, so show the
     reasoning, not just the number.

2. **Compute the score.** Write the gathered inputs to a JSON file matching
   `scripts/example-input.json`'s shape, then run:

   ```
   node "<skill-dir>/scripts/score.js" <path-to-input.json>
   ```

   Use the script's output — don't hand-compute the formulas yourself. It's
   the reference implementation specifically so the result is reproducible;
   mental arithmetic on six weighted pillars (several of them piecewise-linear)
   is exactly the kind of thing that produces the silent one-point drift a
   named algorithm is meant to prevent — and near a band boundary, that drift
   can flip the reported rating band.

3. **Report the result.** Lead with the NCRS, the rating band, and the
   indicative spread — not just the raw number, since the band and spread are
   what a credit committee or investor will actually act on. Then walk
   through the two or three pillars that moved the score most (both up and
   down). If confidence is Medium or Low, say plainly what's missing and what
   document would resolve the biggest gap first (audited financials and a
   debt schedule beat a management deck every time).

4. **Offer what-if framing when relevant.** If a pillar (especially P1
   leverage or P2 coverage) is the main drag, it's often worth noting what
   change in structure (lower advance rate, amortization schedule, a
   guarantee, a covenant reset) would move the credit into the next band up —
   re-run `score.js` with the adjusted input rather than estimating by hand,
   particularly near a band boundary (see the worked example in
   algorithm.md §7 for why boundary cases need the script, not hand-rounding).

## Output format

Unless the user asks for something else, structure the report as:

```
## [Borrower name] — NCRS: <score> (<Rating band>, <confidence> confidence)

**Indicative spread:** +<range> bps over risk-free benchmark (illustrative/directional, not a market quote)

**One-line take:** <what's driving this — the single biggest factor>

| Pillar | Score | Weight | Note |
|---|---|---|---|
| Leverage | ## | 25% | ... |
| Coverage | ## | 20% | ... |
| Liquidity | ## | 15% | ... |
| Profitability & Stability | ## | 15% | ... |
| Industry & Cyclicality Risk | ## | 10% | ... |
| Qualitative & Governance | ## | 15% | ... |

**Strengths:** ...
**Concerns:** ...
**Missing data:** ... (only if confidence < High)
**Not covered by this score:** full covenant/legal review — recommend counsel diligence before closing.
**Recommendation:** <band action from algorithm.md §3>
```

## Extending this skill

This is one entry in a growing library of niche-specific decision-framework
skills (`.claude/skills/README.md` is the index, alongside
`private-equity-analysis`). If you're asked to adapt NCRS for a different
lending context (e.g. project finance, structured/asset-backed lending,
sovereign or municipal credit), don't overwrite this one — copy the folder,
rename it, and re-derive the pillar weights/anchors for that context's actual
risk drivers rather than reusing corporate-borrower anchors that don't fit
(project finance in particular will misscore badly on P1/P4 as-is, since
those anchors assume an operating company with a multi-year margin and
leverage history rather than a single-asset cash-flow waterfall — see
algorithm.md §8).
