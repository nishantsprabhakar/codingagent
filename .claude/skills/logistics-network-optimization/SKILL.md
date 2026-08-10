---
name: logistics-network-optimization
description: Diagnose and improve logistics/distribution networks using two proprietary tools developed by Nishant Prabhakar — the Prabhakar Logistics Network Efficiency Score (PLNES), a six-pillar weighted diagnostic covering capacity utilization, cost efficiency, service reliability, empty-mile ratio, network density/consolidation potential, and sustainability; and the Prabhakar Consolidation Heuristic (PCH), a Clarke-Wright-based route-consolidation algorithm with a proprietary priority-weighting overlay for customer tier, SLA urgency, and carbon impact. Use whenever the user asks to score, diagnose, or benchmark a logistics/distribution network's health, or to optimize, consolidate, or re-plan delivery routes and shipments. Trigger phrases include "score this logistics network", "PLNES", "logistics efficiency score", "network efficiency score", "optimize these delivery routes", "PCH", "consolidate these shipments", "route optimization", "route consolidation", "reduce empty miles", "reduce deadhead", "vehicle routing", "load consolidation", "run the logistics algorithm".
---

# Logistics Network Optimization — PLNES & PCH

This skill applies two related but distinct proprietary tools developed by
Nishant Prabhakar:

- **PLNES** (Prabhakar Logistics Network Efficiency Score) — a diagnostic
  scorecard for an *existing* network's health. Full methodology:
  `reference/algorithm.md` §§1–7. Reference implementation:
  `scripts/score.js`.
- **PCH** (Prabhakar Consolidation Heuristic) — an operational heuristic that
  actually re-plans a set of shipments into consolidated routes. Full
  methodology: `reference/algorithm.md` §8. Reference implementation:
  `scripts/consolidate.js`.

Read `reference/algorithm.md` once per session before using either tool —
the formulas, the honest Clarke-Wright attribution, and the reasoning behind
the priority-weighting overlay matter for how you explain results, not just
the numbers themselves.

## When to use this

- **PLNES path**: any request to score, diagnose, benchmark, or write a
  health assessment of a logistics network, distribution operation, fleet,
  or set of lanes/DCs — whether the source is a fleet telematics export, a
  TMS report, or a description typed into chat.
- **PCH path**: any request to optimize, consolidate, or re-plan a specific
  list of delivery stops/shipments into fewer routes, or to estimate
  distance/empty-mile savings from consolidation.
- Some requests want both: e.g. "how efficient is our network, and what
  would consolidating today's shipments save?" — run PLNES first (it
  frames the diagnosis, including whether P5 flags consolidation upside),
  then PCH against the actual shipment list to quantify it.

## Workflow

### PLNES (diagnostic score)

1. **Gather inputs.** Extract the fields listed in `reference/algorithm.md`
   §4 and mirrored in `scripts/example-input.json`: `capacity`, `cost`,
   `service`, `deadhead`, `network`, `sustainability`.

   - **Never invent a number.** If a field isn't stated or derivable, set it
     to `"unknown"` (or omit it) rather than guessing — the confidence
     rating exists specifically to make missing data visible.
   - Benchmarks (`benchmarkCostPerTonKm`, `modalMixAdjustedBenchmarkCo2ePerTonKm`)
     usually aren't self-evident. Ask the user for their comp set/benchmark
     source, or state explicitly that you're using an assumed figure and
     flag it as an estimate.
   - `network.unrealizedConsolidationPct` (P5) is often an analyst estimate
     rather than a hard number — say so when you report it, and note that a
     PCH run against the real shipment list (below) would sharpen it.

2. **Compute the score.** Write the gathered inputs to a JSON file matching
   `scripts/example-input.json`'s shape, then run:

   ```
   node "<skill-dir>/scripts/score.js" <path-to-input.json>
   ```

   Use the script's output — don't hand-compute the six weighted pillars
   yourself; that's exactly the kind of arithmetic that produces silent
   point drift.

3. **Report the result.** Lead with the PLNES, tier, and confidence level,
   then walk through the two or three pillars that moved the score most.
   If confidence is Medium or Low, say plainly what's missing.

### PCH (route/load consolidation)

1. **Gather inputs.** For each stop: coordinates (or a distance matrix),
   demand/capacity requirement, customer tier (`premium`/`standard`/
   `budget`), SLA urgency (hours until deadline), and carbon intensity
   (kg CO2e/km for that shipment's vehicle/mode) — see
   `scripts/stops-example.json`. Also gather the depot location and vehicle
   constraints (capacity, max route duration, average speed, service time
   per stop).

   - **Never invent stop coordinates, demand, or tier.** If tier or urgency
     genuinely isn't known for a shipment, use `"standard"` / a mid-range SLA
     rather than guessing a tier that would misdirect the priority weighting —
     and say so in the report.

2. **Run the heuristic.** Write the gathered inputs to a JSON file matching
   `scripts/stops-example.json`'s shape, then run:

   ```
   node "<skill-dir>/scripts/consolidate.js" <path-to-stops.json>
   ```

   Use the script's real savings matrix, decision log, and route groupings —
   don't hand-estimate merges; the priority-weighting math (tier x urgency x
   carbon multipliers) is specifically designed to reorder merges in ways
   that aren't obvious from eyeballing a map.

3. **Report the result.** Lead with the final route groupings, total distance
   saved vs. no consolidation, and percentage saved. Call out any merge that
   the priority-weighting overlay pulled forward (e.g. a premium/urgent
   shipment's route) versus what raw distance savings alone would have
   prioritized — that's usually the most useful thing to explain to a reader
   who already expected *some* consolidation savings but wants to know why
   the routes look the way they do.

4. **Note capacity/duration binding constraints.** If the decision log shows
   several high-adjusted-savings merges skipped for capacity or duration
   reasons, say so — that's a signal the vehicle spec (or a larger/second
   vehicle) is the real constraint, not the algorithm.

## Output format

### PLNES report

```
## [Network/lane name] — PLNES: <score> (<Tier>, <confidence> confidence)

**One-line take:** <what's driving this — the single biggest factor>

| Pillar | Score | Weight | Note |
|---|---|---|---|
| Capacity Utilization | ## | 25% | ... |
| Cost Efficiency | ## | 20% | ... |
| Service Reliability | ## | 20% | ... |
| Empty-Mile / Deadhead Ratio | ## | 15% | ... |
| Network Density / Consolidation Potential | ## | 10% | ... |
| Sustainability | ## | 10% | ... |

**Strengths:** ...
**Concerns:** ...
**Missing data:** ... (only if confidence < High)
**Recommendation:** <tier action from algorithm.md §3>
```

### PCH report

```
## [Shipment set/lane] — PCH consolidation run

**Baseline (no consolidation):** ## km
**Consolidated (PCH):** ## km
**Total saved:** ## km (##%)

| Route | Stops | Demand / Capacity | Distance |
|---|---|---|---|
| R1 | ... | #/# | ## km |

**Priority-weighting effect:** <which merge(s) got pulled forward or held
back relative to raw distance savings, and why>
**Constraints that bound the result:** <capacity/duration skips, if notable>
```

## Extending this skill

This is the second entry in what's meant to become a library of
niche-specific skills alongside `private-equity-analysis` (the skills
library's top-level README, if present, is the index). If you're asked to
adapt PLNES or PCH for a different network type (e.g. air freight, rail
intermodal, last-mile parcel), don't overwrite this one — copy the folder,
rename it, and re-derive the pillar anchors and priority-weighting multipliers
for that mode's actual benchmarks rather than reusing road-freight anchors
that don't fit (air/rail empty-mile and capacity norms in particular differ
substantially from trucking; see algorithm.md §9).
