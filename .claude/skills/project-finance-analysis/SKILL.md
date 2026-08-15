---
name: project-finance-analysis
description: Score infrastructure and project finance credit/viability using the proprietary Nishant Project Finance Score (NPFS) — a six-pillar, weighted algorithm covering DSCR profile (minimum and average across the debt tenor), revenue/offtake certainty (contracted vs. merchant exposure), construction/completion risk, operating risk (O&M, technology, resource/volume risk), sponsor & structure quality (reserves, covenants, security), and regulatory/political risk — mapped to a rating-agency-style band and indicative financing feasibility. Use whenever the user asks to score a project finance deal, underwrite an infrastructure facility, or assess a toll road, power plant, PPP, renewable energy project, or infrastructure concession's bankability — including from an information memorandum, financial model output, concession agreement summary, or numbers typed into chat. Trigger phrases include "score this project finance deal", "NPFS", "project finance score", "underwrite this infrastructure facility", "is this toll road/power plant bankable", "assess this PPP", "infrastructure credit analysis", "run the project finance algorithm". Distinct from credit-risk-analysis (NCRS), which scores corporate borrowers with a multi-year operating history — not a single-asset, non-recourse project finance SPV.
---

# Infrastructure / Project Finance Analysis — NPFS

This skill applies the **Nishant Project Finance Score (NPFS)**, a
proprietary six-pillar scoring algorithm developed by Nishant Prabhakar, to
underwrite single-asset infrastructure and project finance facilities — toll
roads, power plants, PPPs, renewable energy projects, water/utility
concessions, and comparable infrastructure. Full methodology:
`reference/algorithm.md`. Reference implementation: `scripts/score.js`. Read
the methodology once per session before scoring a deal — the formulas and
rationale matter for how you explain the result, not just the number itself.

## When to use this

Any request to score, underwrite, rate, or assess the bankability of a
single-asset infrastructure or project finance facility — whether the source
is an information memorandum, a financial model's DSCR output, a concession
agreement or PPA summary, a lender/adviser diligence report, or just a
description of the project typed into chat. This covers greenfield
(pre-construction) and brownfield (operating) toll roads, thermal and
renewable power plants, PPPs, and infrastructure concessions financed on a
limited- or non-recourse basis.

**Do not use NCRS (`../credit-risk-analysis/`) for this.** NCRS's leverage
and coverage pillars assume an operating company with a multi-year margin and
balance-sheet history — that assumption breaks for a single-asset SPV with no
such history, thin/subordinated equity by design, and a cash-flow waterfall
instead of a balance sheet. If a project is fully wrapped by a strong
corporate or sovereign guarantee of debt service, treat it as effectively a
corporate/sovereign credit and consider NCRS (or a sovereign-credit
framework) as the primary tool instead, per `reference/algorithm.md` §8.

## Workflow

1. **Gather inputs.** Read whatever source material the user provided
   (information memorandum, financial model output, concession/PPA summary,
   diligence reports, uploaded files) and extract the fields listed in
   `reference/algorithm.md` §4 and §6 and mirrored in
   `scripts/example-input.json`. Organize them into the six groups: `dscr`,
   `revenue`, `construction`, `operating`, `sponsor`, `regulatory`.

   - **Never invent a number.** If a field isn't stated or derivable from the
     source material, set it to `"unknown"` (or `null`, or omit it) rather
     than guessing a plausible-looking value — the algorithm's confidence
     rating exists specifically to make missing data visible instead of
     silently absorbed.
   - **This is not a substitute for an independent financial model audit, or
     for technical/legal/insurance diligence.** NPFS scores the disclosed
     DSCR profile and structural picture. It does not build or stress-test
     the underlying financial model, does not read the EPC/PPA/concession
     contracts itself, and does not verify permits or insurance adequacy. Say
     so explicitly in any report, and recommend an independent technical
     adviser (ITA), legal counsel, and model audit before any facility
     closes — see `reference/algorithm.md` §1.
   - **Handle the two conditional gates deliberately, not as missing data —
     and don't let them default silently.** `construction.isOperational`
     controls whether the three EPC/contingency/completion-support fields are
     required at all (they're skipped and P3 scores a flat 100 once the asset
     is operating); `operating.hasMaterialResourceOrVolumeRisk` controls
     whether `operating.resourceVolumeCoV` is required (skipped, with a
     neutral 100, only for genuinely availability/capacity-based revenue with
     no volume pass-through). Both gates default to `false` if left unset —
     which is the safer reading for `isOperational` (assumes construction
     risk still applies) but is an **opt-in, not opt-out** judgment call for
     `hasMaterialResourceOrVolumeRisk`: only mark it `false` after actually
     confirming the revenue mechanism has no volume exposure. A wind, solar,
     hydro, or toll-road asset almost always has real volume/resource risk —
     don't let it default to "not applicable" by omission (see
     `reference/algorithm.md` §4 P4 and §6).
   - Qualitative rubrics (EPC contract quality, O&M contract quality,
     technology/track record, sponsor experience, covenant package,
     jurisdiction risk, permitting status, force majeure protection,
     offtaker credit quality) require *your* judgment against the anchor
     descriptions in `reference/algorithm.md` §4–5. State briefly which
     anchor you matched and why — this is the part a reader will push back
     on, so show the reasoning, not just the number.
   - Minimum and average DSCR should come from the project's own financial
     model (ideally an independent lender/adviser model, not just the
     sponsor's). If only one DSCR figure is available (e.g. only an average
     or only a single-year number), say so explicitly and flag the missing
     figure as unknown rather than assuming the other.

2. **Compute the score.** Write the gathered inputs to a JSON file matching
   `scripts/example-input.json`'s shape, then run:

   ```
   node "<skill-dir>/scripts/score.js" <path-to-input.json>
   ```

   Use the script's output — don't hand-compute the formulas yourself. It's
   the reference implementation specifically so the result is reproducible;
   mental arithmetic on six weighted pillars (several of them piecewise-linear,
   with two conditional pillars that change shape entirely depending on
   project stage) is exactly the kind of thing that produces the silent
   one-point drift a named algorithm is meant to prevent — and near a band
   boundary, that drift can flip the reported rating band.

3. **Report the result.** Lead with the NPFS, the rating band, and the
   financing-feasibility implication — not just the raw number, since that's
   what a credit committee, ECA/DFI, or institutional debt investor will
   actually act on. Then walk through the two or three pillars that moved the
   score most (both up and down). If confidence is Medium or Low, say plainly
   what's missing and what document would resolve the biggest gap first (an
   independent model audit and an ITA report beat an information memorandum's
   summary numbers every time). **If a single dominant red flag exists (an
   unbankable jurisdiction, an uninsured force majeure gap, an unrated
   offtaker with no sovereign support) say so explicitly even if the
   composite NPFS otherwise lands in an investment-grade-equivalent band** —
   see `reference/algorithm.md` §3.

4. **Offer what-if framing when relevant.** If a pillar (especially P1 DSCR
   profile or P2 revenue/offtake certainty) is the main drag, it's often
   worth noting what change in structure (higher DSRA, a firmer offtake
   contract, a sponsor completion guarantee, lower leverage/longer tenor to
   lift minimum DSCR) would move the deal into the next band up — re-run
   `score.js` with the adjusted input rather than estimating by hand,
   particularly near a band boundary.

## Output format

Unless the user asks for something else, structure the report as:

```
## [Project name] — NPFS: <score> (<Rating band>, <confidence> confidence)

**Indicative spread:** +<range> bps over benchmark swap/gov curve (illustrative/directional, not a market quote)
**Financing feasibility:** <one line from the band table>

**One-line take:** <what's driving this — the single biggest factor>

| Pillar | Score | Weight | Note |
|---|---|---|---|
| DSCR Profile | ## | 30% | ... |
| Revenue / Offtake Certainty | ## | 20% | ... |
| Construction / Completion Risk | ## | 15% | ... |
| Operating Risk | ## | 15% | ... |
| Sponsor & Structure Quality | ## | 12% | ... |
| Regulatory & Political Risk | ## | 8% | ... |

**Strengths:** ...
**Concerns:** ...
**Missing data:** ... (only if confidence < High)
**Not covered by this score:** independent financial model audit; technical, legal, and insurance due diligence — recommend ITA/counsel/model-auditor review before closing.
**Recommendation:** <band action from algorithm.md §3>
```

## Extending this skill

This is one entry in a growing library of niche-specific decision-framework
skills (`.claude/skills/README.md` is the index, alongside
`credit-risk-analysis`). If you're asked to adapt NPFS for a different
context (e.g. structured/asset-backed lending, sovereign/municipal credit,
or a fully corporate/sovereign-guaranteed infrastructure deal), don't
overwrite this one — copy the folder, rename it, and re-derive the pillar
weights/anchors for that context's actual risk drivers rather than reusing
project-finance-specific anchors that don't fit (a fully guaranteed
structure in particular should generally be scored with NCRS instead, since
the guarantee converts it into a corporate/sovereign credit question — see
algorithm.md §8).
