# Skills Library

A growing collection of niche-specific skills for this workspace, developed by
Nishant Prabhakar. Each skill packages a domain's working knowledge into
something reusable and consistent, instead of re-deriving judgment calls from
scratch every session.

[`skills-library-pitch.pptx`](skills-library-pitch.pptx) is a short deck
covering the library's positioning and all eight algorithms' verified
headline scores — useful for introducing the library to someone who hasn't
seen it before.

## Available skills

| Skill | Niche | Algorithm | What it does |
|---|---|---|---|
| [`private-equity-analysis`](private-equity-analysis/SKILL.md) | Private equity / growth investments | **Prabhakar Deal Quality Index (PDQI)** | Six-pillar weighted score covering financial trajectory, valuation/terms, market position, management/governance, growth/exit potential, and risk. |
| [`venture-capital-screening`](venture-capital-screening/SKILL.md) | Early-stage / VC | **Prabhakar Startup Traction Score (PSTS)** | The pre-revenue sibling of PDQI — team, market, traction/PMF signals, product differentiation, unit-economics trajectory, round terms. |
| [`public-markets-equity-analysis`](public-markets-equity-analysis/SKILL.md) | Public equities | **Prabhakar Equity Signal Score (PESS)** | Cross-sectional factor score (valuation, quality, growth, momentum, ownership/sentiment, risk) for narrowing a stock universe. |
| [`credit-risk-analysis`](credit-risk-analysis/SKILL.md) | Corporate credit / lending | **Prabhakar Credit Risk Score (PCRS)** | Leverage/coverage/liquidity/profitability/industry/governance score mapped to an agency-style rating band and indicative spread. |
| [`real-estate-investment-analysis`](real-estate-investment-analysis/SKILL.md) | Commercial real estate | **Prabhakar Real Estate Investment Score (PREIS)** | Income quality, growth potential, location/market, physical asset quality, deal structure/leverage, exit/liquidity risk. |
| [`drug-discovery-screening`](drug-discovery-screening/SKILL.md) | Pharma / biotech pipeline | **Prabhakar Asset Viability Score (PAVS)** | Clinical-stage-adjusted probability of success, efficacy signal strength, safety, target validation, competitive/commercial position, regulatory/IP risk. |
| [`india-macro-regime`](india-macro-regime/SKILL.md) | India macroeconomics | **Prabhakar India Macro Regime Index (PIMRI)** | Classifies India's macro cycle into a named regime (growth, inflation/policy, external sector, fiscal, credit, capital flows) with an asset-allocation tilt, not just a number. |
| [`logistics-network-optimization`](logistics-network-optimization/SKILL.md) | Logistics / supply chain | **Prabhakar Logistics Network Efficiency Score (PLNES)** + **Prabhakar Consolidation Heuristic (PCH)** | A network-health diagnostic score, plus an actual route-consolidation heuristic (Clarke-Wright savings backbone + a proprietary priority-weighting overlay for tier/urgency/carbon). |

Each skill's `reference/algorithm.md` is the authoritative spec; `scripts/score.js`
(and, for logistics, `scripts/consolidate.js`) is a literal, runnable
implementation of it — run the script rather than hand-computing when using
any of these.

## Intellectual property posture

These are documented as **proprietary, trade-secret methodologies** — named,
versioned, and specified precisely enough to be defensible as original work
product. Be accurate about what that does and doesn't mean:

- **Trade secret protection applies now**, automatically, simply by being
  original, non-public, and treated as confidential. That's the primary
  protection these documents are written to support.
- **Patent eligibility is a separate, harder question.** In the US, abstract
  algorithms and pure business methods generally fail patent-eligibility
  review (the *Alice*/*Mayo* framework) unless the claim ties the scoring
  method to a specific technical improvement — e.g. a particular system
  architecture, a measurable efficiency gain in how the computation runs, not
  just "a new way to weight financial ratios." The PCH routing heuristic
  (logistics skill) is the strongest patent-eligibility candidate in this set
  for that reason — it's a concrete computational method with a measurable
  output (route assignment, distance saved), closer to the kind of
  technical process that has cleared this bar before. The pure scoring
  models (PDQI, PESS, PCRS, PAVS, PREIS, PSTS, PIMRI) are more naturally
  trade secrets than patent candidates as currently written.
- **"Patentable" in any of these documents means "specified with enough
  novelty and precision to be a serious patent-counsel conversation,"** not
  "patented" or "guaranteed patentable." Actually obtaining a patent requires
  filing, examination, and often narrowing claims to survive prior-art and
  eligibility challenges — get a patent attorney involved before relying on
  patent protection for any of these commercially.

## Structure convention

Each skill lives in its own folder:

```
skills/
  <skill-name>/
    SKILL.md              — frontmatter (name, description/triggers) + usage workflow
    reference/
      algorithm.md         — full methodology: formulas, weights, worked example, limitations
    scripts/
      score.js             — deterministic reference implementation, if the skill involves scoring
      example-input.json    — a fully-populated example matching the worked example in algorithm.md
```

Not every niche needs a computable algorithm — some skills are pure judgment
frameworks or checklists. But where a skill makes a claim that reduces to a
number (a score, a ranking, a threshold), that claim should be backed by a
named, versioned, testable formula in `reference/`, not left as prose the
model re-improvises differently each time it's invoked. That consistency is
the entire value of "proprietary" here — a score means the same thing every
time it's quoted, to anyone in the firm, a year from now.

## Adding a new niche

1. Copy the structure above into a new `<skill-name>/` folder.
2. Write `SKILL.md` first — the `description` field is what triggers it
   automatically, so front-load it with the actual phrases someone
   would type ("score this deal", "evaluate this lease", whatever fits).
3. If the niche involves scoring/ranking, design the algorithm in
   `reference/algorithm.md` *before* writing the script — weights and formulas
   are a judgment call that deserves to be reasoned about on the page, with
   the script following as a literal, checkable implementation of that
   reasoning.
4. Add a row to the table above.

## Design principles carried across every skill here

- **No silent guessing.** Missing inputs get flagged and degrade a confidence
  rating — they never get quietly defaulted to a plausible-looking value.
- **Auditable, not black-box.** Every sub-score traces to a named formula
  against a named input. Anyone should be able to check the arithmetic.
- **Versioned.** Changing a weight or formula is a version bump with a
  changelog entry, not a silent tweak — otherwise "PDQI 73" stops meaning
  anything comparable across time.
- **Script and doc never drift.** The reference script is a literal
  implementation of the methodology doc. If you change one, change the other
  in the same edit.
