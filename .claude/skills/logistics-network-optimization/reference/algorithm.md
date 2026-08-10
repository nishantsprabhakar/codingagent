# Prabhakar Logistics Network Efficiency Score (PLNES) & Prabhakar Consolidation Heuristic (PCH) — v1.0

**Proprietary logistics-network diagnostic and consolidation methodology,
developed by Nishant Prabhakar.**

Status: v1.0 (2026-08-10). Author/owner: Nishant Prabhakar. This document is
the authoritative specification for both PLNES (`scripts/score.js`) and PCH
(`scripts/consolidate.js`) — both scripts are direct, literal implementations
of the formulas below. If a script and this document ever disagree, this
document is correct and the script has a bug.

Named in the tradition of other analyst-attributed scoring models (the Altman
Z-Score, the Piotroski F-Score) and classic named OR heuristics (the
Clarke-Wright savings algorithm itself is one) — the point of putting a name
on a model is that the name becomes shorthand for a specific, checkable
methodology, not a vibe. "PLNES 68" or "a PCH run" should mean the same thing
regardless of who's asking or who's answering.

This skill bundles **two distinct tools that answer two different
questions**:

- **PLNES** is a *diagnostic score* — it tells you how healthy an existing
  logistics network is right now, pillar by pillar, the same way PDQI scores
  a deal.
- **PCH** is an *operational heuristic* — it actually re-plans a set of
  shipments into consolidated routes and tells you how much distance you'd
  save by running them together.

They're complementary, not interchangeable: PLNES's Network Density pillar
(§4, P5) previews whether PCH-style consolidation would find much to work
with, but computing P5 does not require running PCH itself, and running PCH
does not require having computed a PLNES score first.

---

## 1. Purpose and positioning

### 1.1 PLNES

PLNES is a **screening and triage tool**, not a routing engine. It exists to
do three things quickly and consistently across a logistics network, lane, or
portfolio of distribution centers:

1. Convert fill-rate reports, cost data, OTD dashboards, and sustainability
   metrics into one comparable number.
2. Force the same six questions to get answered the same way every time, so
   two analysts scoring the same network land on the same number (±5 points).
3. Surface *which specific pillar* is weak, not just a vibe of "our logistics
   costs feel high" — so the operations conversation is "empty miles are 27%
   against an 18% benchmark" instead of "trucks feel emptier than they should."

It is deliberately **not** a black box: every sub-score is a named, auditable
formula against a named input. **What PLNES is not**: a routing engine, a
network-design tool, or a replacement for a real transportation-management
system (TMS). It scores the network's *current operating health*, not what
the optimal network would look like. Run PCH (§8) in parallel — PLNES tells
you whether consolidation is worth pursuing; PCH is what actually pursues it.

### 1.2 PCH

PCH is a **fast, good-enough greedy heuristic for shipment consolidation**,
not a promise of a globally optimal route plan. Its backbone — computing
pairwise merge "savings" between stops and greedily combining routes — is the
**Clarke-Wright savings algorithm**, a well-established vehicle-routing
technique from the operations-research literature (Clarke & Wright, 1964).
That backbone is decades old, widely taught, and not attributed to Nishant
Prabhakar.

**Exact vehicle-routing (VRP) solving is NP-hard.** No fast heuristic,
including this one, guarantees the mathematically optimal set of routes for
anything but small toy instances. Savings-algorithm heuristics are well known
to land in a "good enough, fast enough" zone — see §9 for the honest gap
versus true optimal. What *is* proprietary here, and what "Prabhakar
Consolidation Heuristic" actually names, is the **priority-weighting overlay**
described in §8(b): a business-priority layer (customer tier, SLA urgency,
carbon-impact-per-unit-saved) that decides which merges to act on first when
several are geometrically similar, instead of ranking purely by raw distance
savings. That overlay — not the savings-matrix backbone — is Nishant
Prabhakar's contribution.

---

## 2. PLNES structure at a glance

Six weighted pillars, each scored 0–100, rolled into one composite:

| Pillar | Weight | What it answers |
|---|---|---|
| P1. Capacity Utilization | 25% | Are vehicles/containers actually full, or rolling half-empty? |
| P2. Cost Efficiency | 20% | Are we paying more per ton-km than we should be? |
| P3. Service Reliability | 20% | Do shipments arrive on time, and predictably? |
| P4. Empty-Mile / Deadhead Ratio | 15% | How much distance is driven with no revenue load? |
| P5. Network Density / Consolidation Potential | 10% | How much easy consolidation is sitting on the table, unrealized? |
| P6. Sustainability | 10% | Is carbon intensity in line with a modal-mix-adjusted benchmark? |

```
PLNES = 0.25*P1 + 0.20*P2 + 0.20*P3 + 0.15*P4 + 0.10*P5 + 0.10*P6
```

**Weighting rationale**: P1 and P2 together are 45% of the score by design —
capacity utilization and cost efficiency are the two variables with the most
direct, hard evidence behind them (they come straight off fleet telematics
and the cost ledger), so they carry the most weight. Service reliability
(P3) matters just as much operationally but is weighted slightly lower
individually because a lot of unreliability *traces back to* capacity and
cost problems rather than being an independent lever. P4–P6 are real,
material issues but each is narrower in scope than the first three, so
individually they carry less weight — though combined they're still 35% of
the score, which keeps empty miles, unrealized consolidation, and carbon
intensity from being treated as afterthoughts.

---

## 3. PLNES score bands

| PLNES | Tier | Action |
|---|---|---|
| 85–100 | **Excellent** | Maintain; use as the internal benchmark for other lanes/DCs |
| 70–84 | **Efficient** | Healthy network; look for incremental gains pillar by pillar |
| 50–69 | **Adequate** | Functional but leaving real money/service on the table — prioritize the lowest pillar |
| 30–49 | **Underperforming** | Material structural issues; commission a lane-level review, likely including a PCH consolidation pass |
| 0–29 | **Critical — intervention needed** | Network is not operating viably as designed; escalate before the next planning cycle |

These bands assume **high confidence** inputs (see §6). Under low confidence,
treat the tier as directional only and widen the band by ±10 points in your
head before acting on it.

---

## 4. PLNES pillar formulas

All sub-scores are clamped to `[0, 100]` after computation unless stated
otherwise. `clamp(x, lo, hi)` = min(max(x, lo), hi). `lerp` = piecewise-linear
interpolation between named anchor points.

### P1. Capacity Utilization

| Input | Formula |
|---|---|
| Average fleet/container fill rate (%) | Clamp raw input to `[0, 100]` first — fill rate over 100% is a measurement error, not extra credit; flag `fill_rate_over_100_clamped` if the raw value exceeded 100. Then `lerp` anchors: 0%→5, 50%→30, 75%→65, 90%→90, 100%→100. |

```
P1 = lerp(clamp(fillRatePct, 0, 100), [[0,5],[50,30],[75,65],[90,90],[100,100]])
```

**Why the curve, not a straight line**: below 50% fill, a network is
genuinely wasting capacity and the score should read as poor across the whole
range, not scale gently. Between 75–90% is where most well-run mid-size fleets
actually sit — "good," not yet "excellent." Above 90% is uncommonly tight and
earns the top of the band.

### P2. Cost Efficiency

| Input | Formula |
|---|---|
| Cost per ton-km (or cost per unit-distance) vs. lane/benchmark average | `ratio = costPerTonKm / benchmarkCostPerTonKm`; `clamp(60 - (ratio - 1)*150, 0, 100)` |

```
P2 = clamp(60 - (costPerTonKm/benchmarkCostPerTonKm - 1) * 150, 0, 100)
```

**Why 60, not 100, is the baseline**: sitting exactly at the benchmark cost is
*adequate*, not *good* — matching a benchmark isn't an achievement, it's
table stakes. Every 10% below benchmark earns 15 points; every 10% above
benchmark costs 15 points. This is the steepest lever in the model, same
reasoning as PDQI's entry-multiple sub-score: cost-per-unit is the single most
controllable driver of network-level margin.

### P3. Service Reliability

| Sub-metric | Weight in P3 | Formula |
|---|---|---|
| a. On-time delivery percentage | 70% | `lerp` anchors: 70%→20, 85%→55, 95%→80, 98%→95, 100%→100 |
| b. Order cycle-time consistency (coefficient of variation) | 30% | `lerp` anchors (inverse — lower CV is better): 0→100, 0.10→85, 0.25→60, 0.50→30, 1.0→5 |

```
P3 = 0.70a + 0.30b
```

95% OTD is anchored as "good" (80) rather than "excellent" because most
mature networks treat 95% as the standard service commitment, not a stretch
target — genuinely excellent reliability (98%+) is rarer and scores
accordingly higher.

### P4. Empty-Mile / Deadhead Ratio

| Input | Formula |
|---|---|
| % of total distance driven with no revenue load | `lerp` anchors (inverse): 5%→100, 15%→80, 20%→65, 30%→40, 45%→10 |

```
P4 = lerp(emptyMilePct, [[5,100],[15,80],[20,65],[30,40],[45,10]])
```

**Realistic benchmarks matter here**: 15–20% empty miles is common and
broadly acceptable in most trucking networks — backhaul opportunities rarely
close to zero, and treating 18% as a crisis would just be wrong. The anchors
reflect that: 15% still scores 80 ("good"), not a failing grade. Above ~30%,
though, it's no longer normal variance — it signals a real network-design
problem (poor backhaul planning, one-directional lanes, under-utilized
regional hubs) and the score drops sharply.

### P5. Network Density / Consolidation Potential

| Input | Formula |
|---|---|
| % of current shipment volume estimated to sit on overlapping origin-destination corridors that could plausibly be merged | `lerp` anchors (inverse): 0%→100, 10%→80, 25%→55, 40%→30, 60%→5 |

```
P5 = lerp(unrealizedConsolidationPct, [[0,100],[10,80],[25,55],[40,30],[60,5]])
```

**Why the score runs inverse to opportunity**: this pillar is a *diagnostic*
of current fragmentation, not a reward for future upside. A network sitting
on 40% unrealized consolidation potential is not "40% ahead" — it's
inefficient *today*, and the score should say so plainly. This is
deliberately the pillar most directly related to what a PCH run would find
(§8) — a low P5 score is a strong signal that running PCH on the current
shipment list will find real merge opportunities. Computing this pillar does
not require running PCH; a rough estimate (e.g., from lane/OD overlap
analysis) is sufficient for the diagnostic, and PCH is the follow-up action
once the diagnostic flags the opportunity.

### P6. Sustainability

| Input | Formula |
|---|---|
| CO2e per ton-km vs. modal-mix-adjusted benchmark | `ratio = co2ePerTonKm / benchmarkCo2ePerTonKm`; `clamp(60 - (ratio - 1)*150, 0, 100)` |

```
P6 = clamp(60 - (co2ePerTonKm/benchmarkCo2ePerTonKm - 1) * 150, 0, 100)
```

Same shape as P2 for the same reason: matching a modal-mix-adjusted carbon
benchmark is adequate, not exceptional. The benchmark must already be
adjusted for modal mix (rail vs. road vs. air) — comparing an all-road
network's raw CO2e/ton-km against an intermodal benchmark without that
adjustment will unfairly tank this pillar; see §9.

---

## 5. Qualitative rubrics

PLNES's six pillars are currently built entirely from measurable operational
data (fill rate, cost, OTD, cycle-time variance, empty-mile ratio, unrealized
consolidation estimate, carbon intensity) rather than Likert-style qualitative
judgment calls. There is no PLNES-equivalent of PDQI's moat/governance
rubrics in v1.0.

If a future version needs a qualitative input (e.g., "carrier relationship
quality" or "network resilience to single-point failures"), use the same 1–5
Likert anchor convention as PDQI for consistency across the skills library:

| Value | Score | Anchor description |
|---|---|---|
| 1 | 10 | Absent / actively concerning |
| 2 | 35 | Weak — present but thin |
| 3 | 60 | Adequate — defensible, industry-standard |
| 4 | 80 | Strong — clearly above peer set |
| 5 | 100 | Exceptional — a genuine, hard-to-replicate advantage |

Any such addition is a version bump (§10), not a silent extension.

---

## 6. Confidence and missing data (PLNES)

Every pillar has a **required input list** (see `scripts/score.js`'s
`REQUIRED_FIELDS`). Before computing, count how many required fields are
missing or explicitly marked `"unknown"`.

```
completeness = 1 - (missingCount / totalRequiredFields)
```

- `completeness >= 0.9` -> **High confidence**. Report the tier as-is.
- `0.7 <= completeness < 0.9` -> **Medium confidence**. Report the tier with a
  note listing which pillars used estimates.
- `completeness < 0.7` -> **Low confidence**. Prefix the output
  `"PRELIMINARY — insufficient data for a reliable score"` and explicitly
  recommend which data source would resolve the biggest gap first (usually:
  real fleet telematics/TMS exports beat a manager's verbal estimate every
  time — prioritize closing capacity and cost gaps over sustainability ones,
  since P1+P2 carry 45% of the weight).

Never silently substitute a default value for a missing required field and
present the result as if it were measured. If a value is genuinely unknown,
pass `null`/`"unknown"` and let the completeness penalty apply — a
lower-confidence real answer beats a confident wrong one.

---

## 7. PLNES worked example

Regional mid-size distribution network, single-region road fleet. Full input
is `scripts/example-input.json` — run
`node scripts/score.js scripts/example-input.json` to reproduce these numbers
exactly (they are copied straight from that command's real output).

Inputs: average fill rate 78%; cost per ton-km $0.092 vs. benchmark $0.085;
on-time delivery 94% with order cycle-time CV 0.22; empty-mile ratio 22%;
estimated unrealized consolidation potential 18%; carbon intensity 0.071 kg
CO2e/ton-km vs. modal-mix-adjusted benchmark 0.078.

```
P1 = lerp(78, [[0,5],[50,30],[75,65],[90,90],[100,100]])
   = 65 + (78-75)/(90-75) * (90-65) = 65 + 0.2*25 = 70.0

P2: ratio = 0.092/0.085 = 1.0824
   P2 = 60 - (1.0824-1)*150 = 60 - 12.35 = 47.6

P3: a = lerp(94, [[70,20],[85,55],[95,80],[98,95],[100,100]])
      = 55 + (94-85)/(95-85)*(80-55) = 55 + 0.9*25 = 77.5
    b = lerp(0.22, [[0,100],[0.10,85],[0.25,60],[0.50,30],[1.0,5]])
      = 85 + (0.22-0.10)/(0.25-0.10)*(60-85) = 85 - 0.8*25 = 65.0
    P3 = 0.70(77.5) + 0.30(65.0) = 54.25 + 19.5 = 73.75

P4 = lerp(22, [[5,100],[15,80],[20,65],[30,40],[45,10]])
   = 65 + (22-20)/(30-20)*(40-65) = 65 - 0.2*25 = 60.0

P5 = lerp(18, [[0,100],[10,80],[25,55],[40,30],[60,5]])
   = 80 + (18-10)/(25-10)*(55-80) = 80 - 0.533*25 = 66.7

P6: ratio = 0.071/0.078 = 0.9103
   P6 = 60 - (0.9103-1)*150 = 60 + 13.46 = 73.5

PLNES = 0.25(70.0) + 0.20(47.6) + 0.20(73.75) + 0.15(60.0) + 0.10(66.7) + 0.10(73.5)
      = 17.5 + 9.53 + 14.75 + 9.0 + 6.67 + 7.35 = 64.8
```

**Result: PLNES 64.8 — Adequate tier** (confidence: High, 100% complete, per
the script's real output). The network is functional but leaving real money
on the table: **P2 (cost efficiency, 47.6)** is the weakest pillar by a wide
margin — the network is running about 8% above benchmark cost-per-ton-km,
which alone costs roughly 2.5 composite points versus running at benchmark.
**P4 (empty miles, 60.0)** is the second-largest drag; 22% deadhead is above
the 15–20% "common/acceptable" band. Both P2 and P4 point toward the same fix
— **P5 (consolidation potential, 66.7)** shows there's a real, if moderate,
amount of unrealized consolidation (18%) that a PCH run (§8) against the
current shipment list would likely convert into both lower empty miles and
lower cost-per-ton-km.

---

## 8. THE PCH ALGORITHM

### 8(a). Pairwise savings — the Clarke-Wright backbone (not proprietary)

For every pair of stops `i, j` (excluding the depot), compute the classic
Clarke-Wright savings value:

```
S(i,j) = cost(depot,i) + cost(depot,j) - cost(depot,i,j)
```

where `cost(depot,i,j)` is read as the cost (here, distance) of visiting `i`
and `j` directly in sequence instead of returning to the depot between them —
i.e. `cost(depot,i,j) = dist(i,j)`, so:

```
S(i,j) = dist(depot,i) + dist(depot,j) - dist(i,j)
```

`S(i,j)` is the distance saved by merging two single-stop round trips
(depot→i→depot and depot→j→depot) into one combined trip that visits both.
This step is entirely standard OR — the same formula appears in the original
1964 Clarke & Wright paper and in essentially every vehicle-routing textbook
since.

### 8(b). The proprietary priority-weighting overlay

Raw savings alone treats every merge opportunity as equally worth pursuing if
the distance math is similar. In practice, a business rarely wants that: a
large merge opportunity between two low-priority, slack-SLA shipments isn't
necessarily more valuable to act on first than a smaller merge that happens
to protect a premium customer's delivery window. The **Prabhakar
Consolidation Heuristic** re-ranks merge candidates by a priority-weighting
overlay before the greedy loop runs:

```
adjusted_savings(i,j) = S(i,j) x priorityWeight(i,j)
```

`priorityWeight(i,j)` is the average, across the two stops, of three
independent multipliers — customer tier, SLA urgency, and carbon intensity —
each centered near 1.0 so the overlay scales raw savings up or down rather
than overwhelming the underlying distance math:

```
priorityWeight(i,j) = tierFactor(i,j) x urgencyFactor(i,j) x carbonFactor(i,j)

tierFactor(i,j)    = avg( tierMultiplier(tier_i), tierMultiplier(tier_j) )
urgencyFactor(i,j) = avg( urgencyMultiplier(sla_i), urgencyMultiplier(sla_j) )
carbonFactor(i,j)  = avg( carbonMultiplier(carbon_i), carbonMultiplier(carbon_j) )
```

**Tier multiplier** — premium customers' shipments get weighted up so their
routes are consolidated/protected first:

| Tier | Multiplier |
|---|---|
| premium | 1.4 |
| standard | 1.0 |
| budget | 0.75 |

**Urgency multiplier** — tighter SLA (fewer hours to deadline) weights up,
via `lerp` on hours-to-deadline:

```
urgencyMultiplier(slaHours) = lerp(slaHours, [[2,1.5],[8,1.3],[24,1.0],[72,0.85],[168,0.7]])
```

A shipment with a 4-hour SLA window is under real time pressure — merging it
into a well-planned route now (rather than leaving it to whatever the raw
distance math gets around to) has outsized value. A 1-week-window shipment
can safely wait its turn.

**Carbon multiplier** — this is the sustainability-conscious weighting.
Shipments with a higher carbon intensity per km (heavier vehicles, less
efficient modes) get weighted up, because consolidating *those* shipments
removes more CO2e per km of empty running eliminated — the carbon payoff per
unit of distance saved is larger:

```
carbonMultiplier(carbonKgCo2ePerKm) = lerp(carbonKgCo2ePerKm, [[0.05,0.85],[0.15,1.0],[0.3,1.2],[0.5,1.4]])
```

### 8(c). The greedy merge loop

1. Compute `S(i,j)` and `adjusted_savings(i,j)` for every stop pair.
2. Sort all pairs by `adjusted_savings` **descending**.
3. Initialize every stop as its own single-stop route (depot → stop → depot).
4. Walk the sorted list. For each pair `(i,j)` with `adjusted_savings > 0`:
   - Skip if `i` and `j` are already in the same route (merging them would
     close a loop, not extend a route).
   - Skip if either `i` or `j` is no longer a route **endpoint** (Clarke-Wright
     only merges at the two open ends of a route chain — an interior stop is
     already locked between two other stops).
   - Skip if the combined demand of the two routes would exceed **vehicle
     capacity**.
   - Skip if the combined route's estimated duration (`distance / avgSpeed +
     stopCount * serviceTimePerStop`) would exceed **max route duration**.
   - Otherwise, merge: link `i` to `j` directly, combine the two route chains
     into one, and continue.
5. Stop once no positive `adjusted_savings` pairs remain (or all remaining
   candidates are infeasible).
6. Report final route groupings, total distance vs. the no-consolidation
   baseline (sum of individual round trips), and the full decision log.

### 8(d). Worked numeric example

Five stops around a single depot at `(0,0)`, coordinates in km:

| Stop | (x, y) | Demand | Tier | SLA (hrs) | Carbon (kg CO2e/km) |
|---|---|---|---|---|---|
| A | (3, 4) | 3 | standard | 24 | 0.15 |
| B | (4, 3) | 2 | **premium** | **4** | 0.15 |
| C | (6, 8) | 4 | standard | 72 | 0.15 |
| D | (8, 6) | 3 | standard | 24 | **0.50** |
| E | (-5, 0) | 2 | budget | 168 | 0.05 |

Vehicle: capacity 10, max route duration 480 min, 40 km/h, 10 min service per
stop. Full input is `scripts/stops-example.json` — run
`node scripts/consolidate.js scripts/stops-example.json` to reproduce every
number below exactly (copied from that command's real output).

**Savings matrix — raw vs. priority-weighted vs. adjusted** (real output,
sorted by adjusted savings):

| Pair | Raw savings | Priority weight | Adjusted savings |
|---|---|---|---|
| C-D | 17.17 | 1.11 | **19.06** |
| B-D | 10.00 | 1.75 | **17.52** |
| B-C | 9.61 | 1.37 | 13.17 |
| A-B | 8.59 | 1.46 | 12.54 |
| A-D | 9.61 | 1.20 | 11.54 |
| A-C | 10.00 | 0.93 | 9.25 |
| C-E | 1.40 | 0.63 | 0.88 |
| A-E | 1.06 | 0.69 | 0.73 |
| D-E | 0.68 | 0.84 | 0.57 |
| B-E | 0.51 | 1.06 | 0.54 |

**How the priority weighting changed the order vs. raw distance-savings
alone**: sorting the same real savings values by *raw* savings instead of
adjusted savings gives `C-D(17.17) > A-C(10.00) = B-D(10.00) > B-C(9.61) =
A-D(9.61) > A-B(8.59) > ... `. Every pair touching **B** — the premium,
4-hour-SLA customer — sits in the middle of that raw ordering, tied or behind
`A-C`, which involves no premium/urgent/high-carbon stop at all. Under the
priority-weighted PCH ordering, `B-D` and `B-C` jump to solidly 2nd and 3rd
place (`B-D`'s weight of 1.75 comes from averaging B's premium+urgent
multipliers with D's high-carbon multiplier — three separate priority signals
compounding on one pair), while `A-C` — which gets no boost from either
stop — drops to 6th. In practice this means B's shipment is pulled into the
first consolidation pass PCH considers, instead of being left to whichever
merges the raw distance math happens to get to once its geometrically bigger
neighbors are already spoken for.

**Merge decisions** (real output, in adjusted-savings order):

| Pair | Adjusted savings | Decision | Reason |
|---|---|---|---|
| C-D | 19.06 | **merged** | feasible; highest remaining adjusted savings |
| B-D | 17.52 | **merged** | feasible; highest remaining adjusted savings |
| B-C | 13.17 | skipped | already in same route (would form a cycle) |
| A-B | 12.54 | skipped | combined demand 12 exceeds vehicle capacity 10 |
| A-D | 11.54 | skipped | D is interior to its route, not a mergeable endpoint |
| A-C | 9.25 | skipped | combined demand 12 exceeds vehicle capacity 10 |
| C-E | 0.88 | skipped | combined demand 11 exceeds vehicle capacity 10 |
| A-E | 0.73 | **merged** | feasible; highest remaining adjusted savings |
| D-E | 0.57 | skipped | D is interior to its route, not a mergeable endpoint |
| B-E | 0.54 | skipped | combined demand 14 exceeds vehicle capacity 10 |

**Final route groupings** (real output):

```
R1: [depot] -> A -> E -> [depot]      demand 5/10,  18.94 km
R2: [depot] -> B -> D -> C -> [depot] demand 9/10,  22.83 km
```

**Result**: baseline (no consolidation) = 70.00 km. Consolidated (PCH) =
41.77 km. **Total distance saved: 28.23 km (40.32%).** Note that B's
shipment — the one merge chain the priority overlay pulled forward — ends up
in a fully-loaded 9/10-capacity route (`R2`) built from the two
highest-adjusted-savings merges available, rather than being pushed into the
smaller, lower-priority `A-E` route that only fills to 5/10.

---

## 9. Known limitations

- **PLNES benchmarks must be real, lane-level data, or the score is
  meaningless.** "Benchmark cost-per-ton-km" and "modal-mix-adjusted carbon
  benchmark" are only as good as the comp set behind them. A generic
  industry-average benchmark applied to a specialized lane (e.g.,
  last-mile cold-chain) will misscore P2 and P6 badly. Always record the
  benchmark's source and as-of date alongside the score.
- **Savings-algorithm heuristics are not optimal.** Clarke-Wright-style
  greedy savings heuristics are well documented in the OR literature to land
  roughly 5–15% above the true optimal total distance for realistic
  instances, not at it. PCH inherits that gap. For networks where the last
  few percent of routing efficiency matters enough to justify the cost, a
  full VRP solver (exact or metaheuristic — branch-and-cut, simulated
  annealing, genetic algorithms) should be run instead; PCH is the fast,
  explainable first pass, not the final word.
- **PCH does not model real-time traffic or dynamic re-routing.** Distances
  and durations are static inputs (or straight-line/Euclidean estimates). A
  route that looks efficient on the savings matrix can still run long because
  of live congestion, road closures, or a driver going off-plan — PCH plans
  the network, it doesn't operate it in real time.
- **Capacity and duration constraints are simplified.** The `maxRouteDurationMinutes`
  check is a flat cap computed from average speed and per-stop service time;
  it does not model real driver hours-of-service regulations (mandatory
  breaks, daily/weekly driving limits, rest periods), time-window
  constraints at individual stops, or multi-depot/multi-vehicle-type fleets.
  Treat PCH's output as a planning input to a real TMS/dispatch process, not
  a compliance-ready dispatch order.
- **PLNES's P5 estimate and PCH's actual findings can disagree.** P5 is a
  rough, often analyst-estimated proxy for consolidation opportunity; PCH
  works off the actual shipment list and real constraints. Treat a large gap
  between "P5 said there was room" and "PCH found little to merge" as a
  signal that P5's input estimate needs to be revisited, not that either tool
  is wrong.

## 10. Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-10 | Initial specification and reference implementation for both PLNES and PCH |

Any change to a weight, formula, anchor value, or priority-weighting
multiplier is a version bump with an entry here — the whole point of a
proprietary, named algorithm (and a named heuristic overlay) is that "PLNES
68" or "a PCH v1.0 run" means the same thing every time it's quoted. Silent
tuning defeats that.
