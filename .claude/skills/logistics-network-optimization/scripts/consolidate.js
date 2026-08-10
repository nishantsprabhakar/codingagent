#!/usr/bin/env node
/**
 * Prabhakar Consolidation Heuristic (PCH) — reference implementation, v1.0.
 * Developed by Nishant Prabhakar.
 *
 * IMPORTANT — attribution: the *backbone* of this heuristic is the
 * Clarke-Wright savings algorithm, a well-established, decades-old
 * operations-research technique for vehicle-routing consolidation (Clarke &
 * Wright, 1964). That backbone is NOT proprietary and is not claimed as an
 * original contribution here. What IS proprietary, and is the actual
 * "Prabhakar Consolidation Heuristic," is the priority-weighting overlay in
 * computePriorityWeight() / adjustedSavings() below, which re-ranks merge
 * opportunities by business priority (customer tier, SLA urgency,
 * carbon-impact-per-unit-saved) instead of raw distance savings alone. See
 * reference/algorithm.md §8 for the full specification and worked example.
 *
 * This is a literal implementation of reference/algorithm.md §8. If you
 * change a weight, anchor, or formula here, bump the version and update that
 * document too — they must never drift apart.
 *
 * Usage:
 *   node consolidate.js <stops-input.json>
 *   node consolidate.js -   (reads JSON from stdin)
 *
 * Input schema: see stops-example.json for a fully-populated example, and
 * reference/algorithm.md §8 for what each field means.
 */

"use strict";

const fs = require("fs");

const HEURISTIC_NAME = "Prabhakar Consolidation Heuristic (PCH)";
const HEURISTIC_VERSION = "1.0";
const BACKBONE_ATTRIBUTION =
  "Savings-matrix backbone: Clarke-Wright savings algorithm (Clarke & Wright, 1964) — a well-established OR method, not proprietary.";

function clamp(x, lo, hi) {
  return Math.min(Math.max(x, lo), hi);
}

/** Piecewise-linear interpolation. anchors: array of [x, y] pairs sorted by x. */
function lerp(x, anchors) {
  if (x <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

function euclidean(p1, p2) {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

const TIER_MULTIPLIER = { premium: 1.4, standard: 1.0, budget: 0.75 };

function tierMultiplier(tier) {
  return TIER_MULTIPLIER[tier] ?? TIER_MULTIPLIER.standard;
}

/** Tighter SLA (fewer hours until deadline) -> higher multiplier. */
function urgencyMultiplier(slaHours) {
  return lerp(slaHours, [
    [2, 1.5],
    [8, 1.3],
    [24, 1.0],
    [72, 0.85],
    [168, 0.7],
  ]);
}

/** Higher carbon-intensity-per-km shipments -> higher multiplier (consolidating
 *  them removes more CO2e per km cut, so the sustainability payoff is larger). */
function carbonMultiplier(carbonIntensityKgCo2ePerKm) {
  return lerp(carbonIntensityKgCo2ePerKm, [
    [0.05, 0.85],
    [0.15, 1.0],
    [0.3, 1.2],
    [0.5, 1.4],
  ]);
}

/**
 * The proprietary overlay. priorityWeight(i,j) = avg(tier) x avg(urgency) x
 * avg(carbon) across the two stops being considered for a merge. Centered
 * near 1.0 for two "standard/normal" stops so it scales raw savings up or
 * down rather than dominating them.
 */
function computePriorityWeight(stopA, stopB) {
  const tier = (tierMultiplier(stopA.tier) + tierMultiplier(stopB.tier)) / 2;
  const urgency = (urgencyMultiplier(stopA.slaHours) + urgencyMultiplier(stopB.slaHours)) / 2;
  const carbon =
    (carbonMultiplier(stopA.carbonIntensityKgCo2ePerKm) +
      carbonMultiplier(stopB.carbonIntensityKgCo2ePerKm)) /
    2;
  return { tier, urgency, carbon, combined: tier * urgency * carbon };
}

/**
 * Runs the full PCH pipeline: savings matrix -> priority-weighted overlay ->
 * greedy capacity/duration-constrained merge loop.
 *
 * input.depot: {x, y}
 * input.stops: [{id, x, y, demand, tier, slaHours, carbonIntensityKgCo2ePerKm}]
 * input.vehicle: {capacity, maxRouteDurationMinutes, avgSpeedKmh, serviceTimeMinutesPerStop}
 */
function runPCH(input) {
  const depot = input.depot;
  const stops = input.stops;
  const vehicle = {
    capacity: input.vehicle.capacity,
    maxRouteDurationMinutes: input.vehicle.maxRouteDurationMinutes ?? Infinity,
    avgSpeedKmh: input.vehicle.avgSpeedKmh ?? 40,
    serviceTimeMinutesPerStop: input.vehicle.serviceTimeMinutesPerStop ?? 10,
  };

  const byId = new Map(stops.map((s) => [s.id, s]));
  const distFromDepot = new Map(stops.map((s) => [s.id, euclidean(depot, s)]));
  const pairDist = new Map(); // key `${a}|${b}` (a<b lexically) -> distance

  function distKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }
  function dist(a, b) {
    if (a === b) return 0;
    return pairDist.get(distKey(a, b));
  }

  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      pairDist.set(distKey(stops[i].id, stops[j].id), euclidean(stops[i], stops[j]));
    }
  }

  // --- Step (a): pairwise savings, Clarke-Wright backbone ---
  // --- Step (b): proprietary priority-weighting overlay ---
  const candidates = [];
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const a = stops[i];
      const b = stops[j];
      const savings = distFromDepot.get(a.id) + distFromDepot.get(b.id) - dist(a.id, b.id);
      const weight = computePriorityWeight(a, b);
      const adjustedSavings = savings * weight.combined;
      candidates.push({ a: a.id, b: b.id, savings, priorityWeight: weight.combined, weightBreakdown: weight, adjustedSavings });
    }
  }
  candidates.sort((x, y) => y.adjustedSavings - x.adjustedSavings);

  // --- Step (c): greedy merge loop ---
  // Each route: { path: [ids from one end to other], demand, distance (closed tour incl. both depot legs) }
  const routes = new Map(); // stopId -> route object (all stops in a route point to the same object)
  for (const s of stops) {
    const d = distFromDepot.get(s.id);
    routes.set(s.id, { path: [s.id], demand: s.demand, distance: 2 * d });
  }

  const decisionLog = [];

  for (const cand of candidates) {
    if (cand.adjustedSavings <= 0) {
      decisionLog.push({ ...cand, decision: "stopped", reason: "no further positive adjusted savings" });
      break;
    }
    const routeA = routes.get(cand.a);
    const routeB = routes.get(cand.b);

    if (routeA === routeB) {
      decisionLog.push({ ...cand, decision: "skipped", reason: "already in same route (would form a cycle)" });
      continue;
    }
    const aIsEnd = routeA.path[0] === cand.a || routeA.path[routeA.path.length - 1] === cand.a;
    const bIsEnd = routeB.path[0] === cand.b || routeB.path[routeB.path.length - 1] === cand.b;
    if (!aIsEnd || !bIsEnd) {
      decisionLog.push({ ...cand, decision: "skipped", reason: "stop is interior to its route, not a mergeable endpoint" });
      continue;
    }

    const combinedDemand = routeA.demand + routeB.demand;
    if (combinedDemand > vehicle.capacity) {
      decisionLog.push({ ...cand, decision: "skipped", reason: `combined demand ${combinedDemand} exceeds vehicle capacity ${vehicle.capacity}` });
      continue;
    }

    const mergedDistance = routeA.distance + routeB.distance - cand.savings;
    const pathA = [...routeA.path];
    if (pathA[0] === cand.a) pathA.reverse(); // orient so cand.a is last
    const pathB = [...routeB.path];
    if (pathB[pathB.length - 1] === cand.b) pathB.reverse(); // orient so cand.b is first
    const mergedPath = pathA.concat(pathB);

    const mergedDurationMinutes =
      (mergedDistance / vehicle.avgSpeedKmh) * 60 + mergedPath.length * vehicle.serviceTimeMinutesPerStop;
    if (mergedDurationMinutes > vehicle.maxRouteDurationMinutes) {
      decisionLog.push({ ...cand, decision: "skipped", reason: `merged route duration ${mergedDurationMinutes.toFixed(1)}min exceeds max ${vehicle.maxRouteDurationMinutes}min` });
      continue;
    }

    const mergedRoute = { path: mergedPath, demand: combinedDemand, distance: mergedDistance };
    for (const id of mergedPath) routes.set(id, mergedRoute);
    decisionLog.push({ ...cand, decision: "merged", reason: "feasible; highest remaining adjusted savings" });
  }

  // Collect unique final routes
  const finalRoutes = [];
  const seen = new Set();
  for (const s of stops) {
    const r = routes.get(s.id);
    if (seen.has(r)) continue;
    seen.add(r);
    finalRoutes.push(r);
  }

  const baselineDistance = stops.reduce((sum, s) => sum + 2 * distFromDepot.get(s.id), 0);
  const consolidatedDistance = finalRoutes.reduce((sum, r) => sum + r.distance, 0);
  const totalDistanceSaved = baselineDistance - consolidatedDistance;
  const pctDistanceSaved = baselineDistance ? (totalDistanceSaved / baselineDistance) * 100 : 0;

  return {
    heuristic: HEURISTIC_NAME,
    version: HEURISTIC_VERSION,
    attribution: BACKBONE_ATTRIBUTION,
    savingsMatrix: candidates.map((c) => ({
      pair: [c.a, c.b],
      rawSavings: round2(c.savings),
      priorityWeight: round2(c.priorityWeight),
      adjustedSavings: round2(c.adjustedSavings),
    })),
    decisionLog: decisionLog.map((d) => ({
      pair: [d.a, d.b],
      rawSavings: round2(d.savings),
      adjustedSavings: round2(d.adjustedSavings),
      decision: d.decision,
      reason: d.reason,
    })),
    routes: finalRoutes.map((r, idx) => ({
      routeId: `R${idx + 1}`,
      stops: r.path,
      totalDemand: r.demand,
      vehicleCapacity: vehicle.capacity,
      distanceKm: round2(r.distance),
    })),
    baselineDistanceKm: round2(baselineDistance),
    consolidatedDistanceKm: round2(consolidatedDistance),
    totalDistanceSavedKm: round2(totalDistanceSaved),
    pctDistanceSaved: round2(pctDistanceSaved),
  };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`${result.heuristic} v${result.version}`);
  lines.push(result.attribution);
  lines.push("");
  lines.push("Savings matrix (raw -> priority-weighted -> adjusted), sorted by adjusted savings:");
  for (const s of result.savingsMatrix) {
    lines.push(`  ${s.pair[0]}-${s.pair[1]}: raw=${s.rawSavings}  priorityWeight=${s.priorityWeight}  adjusted=${s.adjustedSavings}`);
  }
  lines.push("");
  lines.push("Merge decisions, in adjusted-savings order:");
  for (const d of result.decisionLog) {
    lines.push(`  ${d.pair[0]}-${d.pair[1]} (adjusted=${d.adjustedSavings}): ${d.decision} — ${d.reason}`);
  }
  lines.push("");
  lines.push("Final route groupings:");
  for (const r of result.routes) {
    lines.push(`  ${r.routeId}: [depot] -> ${r.stops.join(" -> ")} -> [depot]  (demand ${r.totalDemand}/${r.vehicleCapacity}, ${r.distanceKm} km)`);
  }
  lines.push("");
  lines.push(`Baseline (no consolidation): ${result.baselineDistanceKm} km`);
  lines.push(`Consolidated (PCH):          ${result.consolidatedDistanceKm} km`);
  lines.push(`Total distance saved:        ${result.totalDistanceSavedKm} km (${result.pctDistanceSaved}%)`);
  return lines.join("\n");
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: node consolidate.js <stops-input.json>   (or '-' to read JSON from stdin)");
    process.exit(1);
  }
  const raw = arg === "-" ? fs.readFileSync(0, "utf-8") : fs.readFileSync(arg, "utf-8");
  const input = JSON.parse(raw);
  const result = runPCH(input);

  console.log(printHumanReadable(result));
  console.log("");
  console.log("--- JSON ---");
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { runPCH, HEURISTIC_NAME, HEURISTIC_VERSION, computePriorityWeight, tierMultiplier, urgencyMultiplier, carbonMultiplier };
