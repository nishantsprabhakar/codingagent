---
name: venture-capital-screening
description: Screen and score early-stage venture capital / startup deals (pre-seed through Series B) using the proprietary Prabhakar Startup Traction Score (PSTS) — a six-pillar, weighted algorithm covering founder/team quality, market opportunity, traction/PMF signals, product differentiation, unit economics trajectory, and round terms/dilution. Use whenever the user asks to score a startup, run the PSTS, screen a seed-stage or Series A/B company, evaluate a pitch deck for investment, write an early-stage investment memo, or decide whether a startup is worth funding — including "score this startup", "PSTS", "startup traction score", "evaluate this pitch deck for investment", "screen this seed-stage company", "is this startup worth funding", "VC deal screening", "early-stage investment memo", "run the startup algorithm", "rate this founder/team". Also use for comparing multiple early-stage deals or explaining why a startup scored the way it did.
---

# Early-Stage Venture Screening — PSTS

This skill applies the **Prabhakar Startup Traction Score (PSTS)**, a
proprietary six-pillar scoring algorithm developed by Nishant Prabhakar, to
screen early-stage venture opportunities (pre-seed through Series B, before a
company has an established financial trajectory). Full methodology:
`reference/algorithm.md`. Reference implementation: `scripts/score.js`. Read
the methodology once per session before scoring a startup — the formulas and
rationale matter for how you explain the result, not just the number itself.

## When to use this

Any request to evaluate, score, screen, rank, or write an investment memo for
a pre-seed, seed, Series A, or Series B startup — whether the source is a
pitch deck, a data-room, founder-reported metrics, or just a description of
the company typed into chat. If the company has an established, multi-year
financial trajectory (later-stage growth equity, buyout, or any deal where
you'd normally build a real financial model), use the
`private-equity-analysis` skill instead — see "Extending this skill" below.

## Workflow

1. **Gather inputs.** Read whatever source material the user provided (deck,
   data-room extracts, founder metrics, uploaded files) and extract the
   fields listed in `reference/algorithm.md` §4–5 and mirrored in
   `scripts/example-input.json`. Organize them into the six groups: `team`,
   `market`, `traction`, `product`, `unitEconomics`, `roundTerms`.

   - **Never invent a number.** If a field isn't stated or derivable from the
     source material, set it to `"unknown"` (or omit it) rather than guessing
     a plausible-looking value — the algorithm's confidence rating exists
     specifically to make missing data visible instead of silently absorbed.
   - **Lower completeness is expected and normal for genuinely early
     companies — it is not, by itself, a red flag.** A pre-seed company
     simply hasn't existed long enough to generate the documented history a
     Series B company has. Say so plainly in the report rather than implying
     the founder is withholding something (see `reference/algorithm.md` §6).
   - **Unit economics (P5) is opt-out, not opt-in, for genuinely pre-revenue
     companies.** Only set `unitEconomics.dataAvailable: false` when the
     metric truly isn't computable yet at the company's actual stage — not
     just because the founder didn't send the number this cycle. This keeps
     a too-early company from being penalized on completeness for data that
     genuinely doesn't exist yet.
   - Stage benchmarks (TAM read, ask-multiple-vs-stage-benchmark, recommended
     option-pool size) usually aren't in the deck. Ask the user for their
     comp set, or say explicitly that you're using a stated/assumed benchmark
     and flag it as an estimate.
   - Qualitative rubrics (domain expertise, prior startup experience, team
     completeness, why-now timing, retention/cohort quality, product
     differentiation, cap-table cleanliness) require *your* judgment against
     the anchor descriptions in `reference/algorithm.md` §5. State briefly
     which anchor you matched and why — this is the part a reader will push
     back on, so show the reasoning, not just the number.

2. **Compute the score.** Write the gathered inputs to a JSON file matching
   `scripts/example-input.json`'s shape, then run:

   ```
   node "<skill-dir>/scripts/score.js" <path-to-input.json>
   ```

   Use the script's output — don't hand-compute the formulas yourself. It's
   the reference implementation specifically so the result is reproducible;
   mental arithmetic on six weighted pillars is exactly the kind of thing
   that produces the silent one-point drift the whole point of a named
   algorithm is meant to prevent.

3. **Report the result.** Lead with the PSTS, tier, and confidence level,
   then walk through the two or three pillars that moved the score most
   (both up and down) — that's more useful to the reader than restating
   every sub-score. If confidence is Medium or Low, say plainly what's
   missing, whether that's expected for the company's stage or an actual
   gap, and what single data point would resolve the biggest uncertainty
   first.

4. **Be honest about base rates.** This is a triage/funnel tool, not a
   prediction of success — most startups that score well will still fail;
   that's the nature of venture, not a flaw in the model. Never present a
   high PSTS as a guarantee, and never present it as a valuation. If a
   pillar (especially P2 market size, or P6 round terms) is the main drag,
   it's often worth noting what would move the deal into the next tier —
   re-run `score.js` with the adjusted input rather than estimating by hand.

## Output format

Unless the user asks for something else, structure the report as:

```
## [Company name] — PSTS: <score> (<Tier>, <confidence> confidence)

**One-line take:** <what's driving this — the single biggest factor>

| Pillar | Score | Weight | Note |
|---|---|---|---|
| Founder & Team Quality | ## | 25% | ... |
| Market Opportunity | ## | 20% | ... |
| Traction & PMF Signals | ## | 20% | ... |
| Product & Tech Differentiation | ## | 15% | ... |
| Unit Economics Trajectory | ## | 10% | ... |
| Round Terms & Dilution | ## | 10% | ... |

**Strengths:** ...
**Concerns:** ...
**Missing data:** ... (only if confidence < High — note whether it's expected for the stage)
**Recommendation:** <tier action from algorithm.md §3>
```

## Extending this skill

This is the early-stage sibling to `private-equity-analysis`
(`.claude/skills/README.md` is the index of the full library). The two
models exist because one set of anchors can't honestly serve both ends of a
company's life:

- **Use this skill (PSTS)** for pre-revenue or early-traction companies —
  pre-seed through roughly Series B — where the investment case rests mostly
  on team and market, and financial history is thin or nonexistent.
- **Use `private-equity-analysis` (PDQI)** once a company has an established,
  multi-year financial trajectory — realized revenue CAGR, margins, cash
  conversion — that can actually be underwritten directly, and the deal
  involves buyout/growth-equity economics (leverage, entry multiples vs.
  sector comps) rather than primary dilution and option pools.

If you're asked to adapt PSTS for a still-different niche (e.g. a
deep-tech/biotech-specific variant — see `reference/algorithm.md` §8's known
limitations — or a growth-stage bridge model), don't overwrite this one:
copy the folder, rename it, and re-derive the pillar weights/anchors for that
niche's actual risk/return drivers rather than reusing PSTS anchors that
don't fit.
