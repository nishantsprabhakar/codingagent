#!/usr/bin/env node
/**
 * Nishant Real Estate Investment Score (NREIS) — reference implementation, v1.0.
 * Developed by Nishant Prabhakar.
 *
 * This is a literal implementation of reference/algorithm.md. If you change a
 * weight or formula here, bump the version and update that document too —
 * they must never drift apart.
 *
 * Usage:
 *   node score.js <input.json>
 *   node score.js -   (reads JSON from stdin)
 *
 * Input schema: see example-input.json for a fully-populated example, and
 * reference/algorithm.md section 4-6 for what each field means and how
 * missing/"unknown" values are handled.
 */

"use strict";

const fs = require("fs");

const ALGORITHM_NAME = "Nishant Real Estate Investment Score (NREIS)";
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

/** Likert 1-5 (fractional allowed) -> 0-100, per algorithm.md section 5. */
function likertToScore(value) {
  return lerp(value, [
    [1, 10],
    [2, 35],
    [3, 60],
    [4, 80],
    [5, 100],
  ]);
}

const ESG_RATING_MAP = { certified: 90, partial: 65, none: 50 };

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

function scoreP1(input, missing) {
  const read = makeReader(input, missing, "P1");
  const dealCapRate = read("income.dealCapRatePct", 0);
  const submarketMedianCapRate = read("income.submarketMedianCapRatePct", dealCapRate || 1);
  const occupancyPct = read("income.occupancyPct", 0);
  const waleYears = read("income.waleYears", 0);
  const tenantCreditQuality = read("income.tenantCreditQualityRubric", 3);

  const spreadPct = submarketMedianCapRate ? (dealCapRate - submarketMedianCapRate) / submarketMedianCapRate : 0;
  const a = clamp(70 + spreadPct * 100, 0, 100);

  const b = lerp(occupancyPct, [
    [60, 20],
    [80, 50],
    [92, 85],
    [100, 100],
  ]);

  const waleLerp = lerp(waleYears, [
    [0, 20],
    [2, 45],
    [5, 75],
    [8, 92],
    [12, 100],
  ]);
  const c = clamp(0.7 * waleLerp + 0.3 * likertToScore(tenantCreditQuality), 0, 100);

  const score = 0.35 * a + 0.4 * b + 0.25 * c;
  return { score, subScores: { capRateVsComp: a, occupancy: b, waleAndTenantCredit: c }, flags: [] };
}

function scoreP2(input, missing) {
  const read = makeReader(input, missing, "P2");
  const noiGrowthTrend = read("growth.noiGrowthTrendPctPerYear", 0);
  const inPlaceRent = read("growth.inPlaceRentPsf", 0);
  const marketRent = read("growth.marketRentPsf", inPlaceRent || 0);

  const a = lerp(noiGrowthTrend, [
    [0, 20],
    [3, 50],
    [6, 75],
    [10, 90],
    [15, 100],
  ]);

  const gapPct = inPlaceRent ? ((marketRent - inPlaceRent) / inPlaceRent) * 100 : 0;
  const bRaw = lerp(gapPct, [
    [-10, 30],
    [0, 50],
    [10, 70],
    [25, 90],
    [40, 97],
  ]);
  const implausibleGap = gapPct > 35;
  const b = implausibleGap ? Math.min(bRaw, 80) : bRaw;

  const score = 0.55 * a + 0.45 * b;
  return {
    score,
    subScores: { noiGrowthTrend: a, markToMarketRentUpside: b },
    flags: implausibleGap ? ["implausible_mark_to_market_gap"] : [],
  };
}

function scoreP3(input, missing) {
  const read = makeReader(input, missing, "P3");
  const vacancyTrend = read("location.vacancyTrendPtsPerYear", 0);
  const popJobGrowth = read("location.populationJobGrowthPct", 0);
  const supplyPipelinePct = read("location.newSupplyPipelinePctOfStock", 0);

  const a = lerp(vacancyTrend, [
    [-3, 95],
    [-1, 80],
    [0, 60],
    [1, 40],
    [3, 15],
  ]);

  const b = lerp(popJobGrowth, [
    [-1, 20],
    [0, 40],
    [1.5, 65],
    [3, 85],
    [5, 100],
  ]);

  const c = lerp(supplyPipelinePct, [
    [0, 95],
    [3, 80],
    [6, 55],
    [10, 30],
    [15, 10],
  ]);

  const score = 0.35 * a + 0.3 * b + 0.35 * c;
  return { score, subScores: { vacancyTrend: a, populationJobGrowth: b, supplyPipelineRisk: c }, flags: [] };
}

function scoreP4(input, missing) {
  const read = makeReader(input, missing, "P4");
  const buildingClassRubric = read("physical.buildingClassRubric", 3);
  const deferredCapexPct = read("physical.deferredCapexPctOfPrice", 0);
  const esgRating = read("physical.esgRating", "none");

  const a = likertToScore(buildingClassRubric);

  const b = lerp(deferredCapexPct, [
    [0, 100],
    [2, 85],
    [5, 60],
    [10, 30],
    [20, 5],
  ]);

  const c = ESG_RATING_MAP[esgRating] ?? 50;

  const score = 0.45 * a + 0.4 * b + 0.15 * c;
  return { score, subScores: { buildingClassAndAge: a, deferredCapexNeed: b, esgModifier: c }, flags: [] };
}

function scoreP5(input, missing) {
  const read = makeReader(input, missing, "P5");
  const ltvPct = read("structure.ltvPct", 0);
  const noiUsd = read("structure.noiUSD", 0);
  const loanAmountUsd = read("structure.loanAmountUSD", noiUsd || 1);
  const goingInCapRate = read("structure.goingInCapRatePct", 0);
  const costOfDebtPct = read("structure.costOfDebtPct", goingInCapRate);

  const a = lerp(ltvPct, [
    [45, 100],
    [55, 85],
    [65, 65],
    [70, 50],
    [80, 25],
    [90, 5],
  ]);

  const debtYieldPct = loanAmountUsd ? (noiUsd / loanAmountUsd) * 100 : 0;
  const b = lerp(debtYieldPct, [
    [5, 15],
    [8, 40],
    [9, 60],
    [10, 80],
    [12, 95],
    [15, 100],
  ]);

  const spreadPts = goingInCapRate - costOfDebtPct;
  const c = lerp(spreadPts, [
    [-2, 10],
    [0, 30],
    [1, 55],
    [2, 75],
    [3, 90],
    [4, 100],
  ]);

  const score = 0.35 * a + 0.35 * b + 0.3 * c;
  return { score, subScores: { ltv: a, debtYield: b, capRateToCostOfDebtSpread: c }, flags: [] };
}

function scoreP6(input, missing) {
  const read = makeReader(input, missing, "P6");
  const liquidityRubric = read("exit.assetClassLiquidityRubric", 3);
  const exitCapRateDeltaBps = read("exit.exitCapRateDeltaBps", 0);

  const a = likertToScore(liquidityRubric);

  const b = lerp(exitCapRateDeltaBps, [
    [-100, 20],
    [-50, 40],
    [0, 65],
    [50, 85],
    [100, 95],
    [150, 100],
  ]);

  const score = 0.55 * a + 0.45 * b;
  return { score, subScores: { assetClassLiquidity: a, exitCapRateExpansionRisk: b }, flags: [] };
}

const PILLAR_WEIGHTS = { p1: 0.25, p2: 0.2, p3: 0.2, p4: 0.15, p5: 0.1, p6: 0.1 };

// Every field any pillar's reader touches, for the completeness denominator.
// Kept in sync manually with the read() calls above — see algorithm.md section 6.
const REQUIRED_FIELDS = [
  "income.dealCapRatePct",
  "income.submarketMedianCapRatePct",
  "income.occupancyPct",
  "income.waleYears",
  "income.tenantCreditQualityRubric",
  "growth.noiGrowthTrendPctPerYear",
  "growth.inPlaceRentPsf",
  "growth.marketRentPsf",
  "location.vacancyTrendPtsPerYear",
  "location.populationJobGrowthPct",
  "location.newSupplyPipelinePctOfStock",
  "physical.buildingClassRubric",
  "physical.deferredCapexPctOfPrice",
  "physical.esgRating",
  "structure.ltvPct",
  "structure.noiUSD",
  "structure.loanAmountUSD",
  "structure.goingInCapRatePct",
  "structure.costOfDebtPct",
  "exit.assetClassLiquidityRubric",
  "exit.exitCapRateDeltaBps",
];

function getByPath(obj, path) {
  return path.split(".").reduce((v, p) => (v == null ? undefined : v[p]), obj);
}

function tierFor(nreis) {
  if (nreis >= 80) return "Core — pursue aggressively";
  if (nreis >= 65) return "Core-plus — attractive";
  if (nreis >= 50) return "Value-add — proceed with plan";
  if (nreis >= 35) return "Opportunistic/high-risk — proceed only with strong mitigants";
  return "Pass";
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

  const nreis =
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
    nreis: Math.round(nreis * 10) / 10,
    tier: tierFor(nreis),
    confidence: confidenceFor(completeness),
    completeness: Math.round(completeness * 100) / 100,
    pillars: {
      p1_incomeQuality: { weight: PILLAR_WEIGHTS.p1, ...p1 },
      p2_growthPotential: { weight: PILLAR_WEIGHTS.p2, ...p2 },
      p3_locationAndMarket: { weight: PILLAR_WEIGHTS.p3, ...p3 },
      p4_physicalAssetQuality: { weight: PILLAR_WEIGHTS.p4, ...p4 },
      p5_dealStructureAndLeverage: { weight: PILLAR_WEIGHTS.p5, ...p5 },
      p6_exitAndLiquidityRisk: { weight: PILLAR_WEIGHTS.p6, ...p6 },
    },
    missingFields: explicitlyMissing,
  };
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`${result.algorithm} v${result.version}`);
  lines.push(`NREIS: ${result.nreis} — ${result.tier} (confidence: ${result.confidence}, ${Math.round(result.completeness * 100)}% complete)`);
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
