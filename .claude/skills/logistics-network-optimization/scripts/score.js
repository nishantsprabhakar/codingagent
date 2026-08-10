#!/usr/bin/env node
/**
 * Prabhakar Logistics Network Efficiency Score (PLNES) — reference
 * implementation, v1.0.
 * Developed by Nishant Prabhakar.
 *
 * This is a literal implementation of reference/algorithm.md §§1-7. If you
 * change a weight or formula here, bump the version and update that
 * document too — they must never drift apart.
 *
 * Usage:
 *   node score.js <input.json>
 *   node score.js -   (reads JSON from stdin)
 *
 * Input schema: see example-input.json for a fully-populated example, and
 * reference/algorithm.md §4 and §6 for what each field means and how
 * missing/"unknown" values are handled.
 *
 * PLNES is the diagnostic scorecard in this skill. The companion
 * optimization heuristic — the Prabhakar Consolidation Heuristic (PCH) — is
 * implemented separately in consolidate.js; the two are related but answer
 * different questions (see algorithm.md §1).
 */

"use strict";

const fs = require("fs");

const ALGORITHM_NAME = "Prabhakar Logistics Network Efficiency Score (PLNES)";
const ALGORITHM_VERSION = "1.0";

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

/** Likert 1-5 (fractional allowed) -> 0-100, per algorithm.md §5. */
function likertToScore(value) {
  return lerp(value, [
    [1, 10],
    [2, 35],
    [3, 60],
    [4, 80],
    [5, 100],
  ]);
}

const MISSING = new Set([undefined, null, "unknown"]);

/** Tracks which required fields were missing, for the confidence calculation. */
function makeReader(input, missingList, pillarLabel) {
  return function read(path, fallbackForMissingCalc) {
    const parts = path.split(".");
    let v = input;
    for (const p of parts) {
      v = v == null ? undefined : v[p];
    }
    if (MISSING.has(v)) {
      missingList.push(`${pillarLabel}: ${path}`);
      return fallbackForMissingCalc;
    }
    return v;
  };
}

// ---------------------------------------------------------------------------
// P1. Capacity Utilization — weight 25%
// ---------------------------------------------------------------------------
function scoreP1(input, missing) {
  const read = makeReader(input, missing, "P1");
  const fillRate = read("capacity.avgFillRatePct", 0);

  // Clamp raw fill rate first — a fleet cannot be more than 100% full;
  // anything above that is a data/measurement error, not extra credit.
  const clampedFill = clamp(fillRate, 0, 100);

  const score = lerp(clampedFill, [
    [0, 5],
    [50, 30],
    [75, 65],
    [90, 90],
    [100, 100],
  ]);

  const overReported = fillRate > 100;

  return {
    score,
    subScores: { fillRate: score },
    flags: overReported ? ["fill_rate_over_100_clamped"] : [],
  };
}

// ---------------------------------------------------------------------------
// P2. Cost Efficiency — weight 20%
// ---------------------------------------------------------------------------
function scoreP2(input, missing) {
  const read = makeReader(input, missing, "P2");
  const costPerTonKm = read("cost.costPerTonKm", 0);
  const benchmarkCostPerTonKm = read("cost.benchmarkCostPerTonKm", costPerTonKm || 1);

  const ratio = benchmarkCostPerTonKm ? costPerTonKm / benchmarkCostPerTonKm : 1;
  // ratio 1.0 (at benchmark) -> 60 (adequate, not good); every 10% cheaper is
  // worth 15 points, every 10% more expensive costs 15 points. Steeper on the
  // expensive side is intentional: cost overruns compound across a network.
  const score = clamp(60 - (ratio - 1) * 150, 0, 100);

  return { score, subScores: { costVsBenchmark: score }, flags: [] };
}

// ---------------------------------------------------------------------------
// P3. Service Reliability — weight 20%
// ---------------------------------------------------------------------------
function scoreP3(input, missing) {
  const read = makeReader(input, missing, "P3");
  const otdPct = read("service.onTimeDeliveryPct", 0);
  const cycleTimeCv = read("service.orderCycleTimeCv", 0);

  const a = lerp(otdPct, [
    [70, 20],
    [85, 55],
    [95, 80],
    [98, 95],
    [100, 100],
  ]);
  // Coefficient of variation of order cycle time: 0 = perfectly predictable.
  const b = lerp(cycleTimeCv, [
    [0, 100],
    [0.1, 85],
    [0.25, 60],
    [0.5, 30],
    [1.0, 5],
  ]);

  const score = 0.7 * a + 0.3 * b;
  return { score, subScores: { onTimeDelivery: a, cycleTimeConsistency: b }, flags: [] };
}

// ---------------------------------------------------------------------------
// P4. Empty-Mile / Deadhead Ratio — weight 15%
// ---------------------------------------------------------------------------
function scoreP4(input, missing) {
  const read = makeReader(input, missing, "P4");
  const emptyMilePct = read("deadhead.emptyMilePct", 0);

  // Industry reality: 15-20% empty miles is common/acceptable, not a crisis.
  // Below 10% is excellent (and, past a point, physically hard to beat).
  // Above ~30% signals a real network-design problem, not noise.
  const score = lerp(emptyMilePct, [
    [5, 100],
    [15, 80],
    [20, 65],
    [30, 40],
    [45, 10],
  ]);

  return { score, subScores: { emptyMileRatio: score }, flags: [] };
}

// ---------------------------------------------------------------------------
// P5. Network Density / Consolidation Potential — weight 10%
// ---------------------------------------------------------------------------
function scoreP5(input, missing) {
  const read = makeReader(input, missing, "P5");
  // unrealizedConsolidationPct: analyst/PCH-derived estimate of the share of
  // current shipment volume that sits on overlapping O-D corridors and could
  // plausibly be merged into fewer routes. This pillar previews what PCH
  // would find (see algorithm.md §1) — it does not run PCH itself.
  const unrealizedPct = read("network.unrealizedConsolidationPct", 0);

  // Inverse: lots of easy unrealized savings sitting on the table means the
  // network is fragmented today, which is bad, so score goes DOWN as the
  // unrealized opportunity goes UP.
  const score = lerp(unrealizedPct, [
    [0, 100],
    [10, 80],
    [25, 55],
    [40, 30],
    [60, 5],
  ]);

  return { score, subScores: { consolidationHeadroom: score }, flags: [] };
}

// ---------------------------------------------------------------------------
// P6. Sustainability — weight 10%
// ---------------------------------------------------------------------------
function scoreP6(input, missing) {
  const read = makeReader(input, missing, "P6");
  const co2ePerTonKm = read("sustainability.co2ePerTonKm", 0);
  const benchmarkCo2ePerTonKm = read(
    "sustainability.modalMixAdjustedBenchmarkCo2ePerTonKm",
    co2ePerTonKm || 1
  );

  const ratio = benchmarkCo2ePerTonKm ? co2ePerTonKm / benchmarkCo2ePerTonKm : 1;
  // Same shape as P2's cost ratio: at-benchmark carbon intensity is
  // "adequate" (60), not "good" — cleaner-than-benchmark earns real credit.
  const score = clamp(60 - (ratio - 1) * 150, 0, 100);

  return { score, subScores: { carbonIntensityVsBenchmark: score }, flags: [] };
}

const PILLAR_WEIGHTS = { p1: 0.25, p2: 0.2, p3: 0.2, p4: 0.15, p5: 0.1, p6: 0.1 };

// Every field any pillar's reader touches, for the completeness denominator.
// Kept in sync manually with the read() calls above — see algorithm.md §6.
const REQUIRED_FIELDS = [
  "capacity.avgFillRatePct",
  "cost.costPerTonKm",
  "cost.benchmarkCostPerTonKm",
  "service.onTimeDeliveryPct",
  "service.orderCycleTimeCv",
  "deadhead.emptyMilePct",
  "network.unrealizedConsolidationPct",
  "sustainability.co2ePerTonKm",
  "sustainability.modalMixAdjustedBenchmarkCo2ePerTonKm",
];

function getByPath(obj, path) {
  return path.split(".").reduce((v, p) => (v == null ? undefined : v[p]), obj);
}

function tierFor(plnes) {
  if (plnes >= 85) return "Excellent";
  if (plnes >= 70) return "Efficient";
  if (plnes >= 50) return "Adequate";
  if (plnes >= 30) return "Underperforming";
  return "Critical — intervention needed";
}

function confidenceFor(completeness) {
  if (completeness >= 0.9) return "High";
  if (completeness >= 0.7) return "Medium";
  return "Low";
}

function computeScore(input) {
  const missing = [];
  const p1 = scoreP1(input, missing);
  const p2 = scoreP2(input, missing);
  const p3 = scoreP3(input, missing);
  const p4 = scoreP4(input, missing);
  const p5 = scoreP5(input, missing);
  const p6 = scoreP6(input, missing);

  const plnes =
    PILLAR_WEIGHTS.p1 * p1.score +
    PILLAR_WEIGHTS.p2 * p2.score +
    PILLAR_WEIGHTS.p3 * p3.score +
    PILLAR_WEIGHTS.p4 * p4.score +
    PILLAR_WEIGHTS.p5 * p5.score +
    PILLAR_WEIGHTS.p6 * p6.score;

  const explicitlyMissing = REQUIRED_FIELDS.filter((f) => MISSING.has(getByPath(input, f)));
  const completeness = 1 - explicitlyMissing.length / REQUIRED_FIELDS.length;

  return {
    algorithm: ALGORITHM_NAME,
    version: ALGORITHM_VERSION,
    plnes: Math.round(plnes * 10) / 10,
    tier: tierFor(plnes),
    confidence: confidenceFor(completeness),
    completeness: Math.round(completeness * 100) / 100,
    pillars: {
      p1_capacityUtilization: { weight: PILLAR_WEIGHTS.p1, ...p1 },
      p2_costEfficiency: { weight: PILLAR_WEIGHTS.p2, ...p2 },
      p3_serviceReliability: { weight: PILLAR_WEIGHTS.p3, ...p3 },
      p4_emptyMileRatio: { weight: PILLAR_WEIGHTS.p4, ...p4 },
      p5_networkDensity: { weight: PILLAR_WEIGHTS.p5, ...p5 },
      p6_sustainability: { weight: PILLAR_WEIGHTS.p6, ...p6 },
    },
    missingFields: explicitlyMissing,
  };
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`${result.algorithm} v${result.version}`);
  lines.push(
    `PLNES: ${result.plnes} — ${result.tier} (confidence: ${result.confidence}, ${Math.round(result.completeness * 100)}% complete)`
  );
  lines.push("");
  for (const [key, pillar] of Object.entries(result.pillars)) {
    lines.push(`${key}  weight=${pillar.weight}  score=${Math.round(pillar.score * 10) / 10}`);
    for (const [sub, val] of Object.entries(pillar.subScores)) {
      lines.push(`  - ${sub}: ${Math.round(val * 10) / 10}`);
    }
    if (pillar.flags.length) lines.push(`  ! flags: ${pillar.flags.join(", ")}`);
  }
  if (result.missingFields.length) {
    lines.push("");
    lines.push(`Missing/unknown inputs (${result.missingFields.length}):`);
    for (const f of result.missingFields) lines.push(`  - ${f}`);
  }
  return lines.join("\n");
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: node score.js <input.json>   (or '-' to read JSON from stdin)");
    process.exit(1);
  }
  const raw = arg === "-" ? fs.readFileSync(0, "utf-8") : fs.readFileSync(arg, "utf-8");
  const input = JSON.parse(raw);
  const result = computeScore(input);

  console.log(printHumanReadable(result));
  console.log("");
  console.log("--- JSON ---");
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { computeScore, ALGORITHM_NAME, ALGORITHM_VERSION };
