#!/usr/bin/env node
/**
 * Nishant Credit Risk Score (NCRS) — reference implementation, v1.0.
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

const ALGORITHM_NAME = "Nishant Credit Risk Score (NCRS)";
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
  const netDebtToEbitda = read("leverage.netDebtToEbitda", 0);
  const sectorMedianLeverage = read("leverage.sectorMedianLeverage", netDebtToEbitda);
  const debtToEquity = read("leverage.debtToEquity", 0);

  const a = clamp(100 - Math.max(0, netDebtToEbitda - sectorMedianLeverage) * 12, 0, 100);
  const b = lerp(debtToEquity, [
    [0.5, 100],
    [1.0, 80],
    [2.0, 50],
    [3.0, 25],
    [4.0, 5],
  ]);

  const score = 0.6 * a + 0.4 * b;
  return { score, subScores: { netDebtToEbitdaVsSector: a, debtToEquity: b }, flags: [] };
}

function scoreP2(input, missing) {
  const read = makeReader(input, missing, "P2");
  const interestCoverage = read("coverage.ebitdaToInterestExpense", 0);
  const dscr = read("coverage.fcfToTotalDebtService", 0);

  const a = lerp(interestCoverage, [
    [1.0, 5],
    [1.5, 20],
    [3.0, 55],
    [6.0, 85],
    [10.0, 100],
  ]);
  const b = lerp(dscr, [
    [0.8, 5],
    [1.0, 25],
    [1.25, 50],
    [2.0, 80],
    [3.0, 100],
  ]);

  const score = 0.55 * a + 0.45 * b;
  return { score, subScores: { interestCoverage: a, debtServiceCoverage: b }, flags: [] };
}

function scoreP3(input, missing) {
  const read = makeReader(input, missing, "P3");
  const currentRatio = read("liquidity.currentRatio", 0);
  const quickRatio = read("liquidity.quickRatio", 0);

  const liquidity = input.liquidity || {};
  const isCashFlowNegative = liquidity.isCashFlowNegative === true;

  const a = lerp(currentRatio, [
    [0.5, 10],
    [1.0, 40],
    [1.5, 70],
    [2.0, 90],
    [3.0, 100],
  ]);
  const b = lerp(quickRatio, [
    [0.3, 10],
    [0.7, 40],
    [1.0, 70],
    [1.5, 90],
    [2.0, 100],
  ]);
  const ratioScore = 0.5 * a + 0.5 * b;

  let runwayScore = 100; // default: strong liquidity credit when not cash-flow-negative
  const flags = [];
  if (isCashFlowNegative) {
    flags.push("cash_flow_negative_runway_applied");
    let runwayMonths = liquidity.cashRunwayMonths;
    if (MISSING.has(runwayMonths)) {
      missing.push("P3: liquidity.cashRunwayMonths (required because cash-flow-negative)");
      runwayMonths = 0;
    }
    runwayScore = lerp(runwayMonths, [
      [0, 0],
      [3, 15],
      [6, 35],
      [12, 65],
      [24, 90],
      [36, 100],
    ]);
  }

  const score = 0.7 * ratioScore + 0.3 * runwayScore;
  return { score, subScores: { currentRatio: a, quickRatio: b, cashRunway: runwayScore }, flags };
}

function scoreP4(input, missing) {
  const read = makeReader(input, missing, "P4");
  const ebitdaMargin = read("profitability.ebitdaMargin", 0);
  const sectorMedianEbitdaMargin = read("profitability.sectorMedianEbitdaMargin", ebitdaMargin);
  const marginCoV = read("profitability.marginCoefficientOfVariation3to5yr", 0);

  const a = clamp(50 + (ebitdaMargin - sectorMedianEbitdaMargin) * 2.5, 0, 100);
  const b = lerp(marginCoV, [
    [0, 100],
    [0.1, 85],
    [0.25, 60],
    [0.5, 30],
    [0.75, 10],
  ]);

  const score = 0.55 * a + 0.45 * b;
  return { score, subScores: { marginVsSector: a, marginStability: b }, flags: [] };
}

function scoreP5(input, missing) {
  const read = makeReader(input, missing, "P5");
  const cyclicalityRubric = read("industry.cyclicalityRubric", 3);

  const score = likertToScore(cyclicalityRubric);
  return { score, subScores: { industryCyclicality: score }, flags: [] };
}

function scoreP6(input, missing) {
  const read = makeReader(input, missing, "P6");
  const managementQualityRubric = read("qualitative.managementQualityRubric", 3);

  const qualitative = input.qualitative || {};
  const isSecuredLending = qualitative.isSecuredLending === true;

  let collateralQualityRubric = qualitative.collateralQualityRubric;
  let collateralScore;
  if (isSecuredLending) {
    if (MISSING.has(collateralQualityRubric)) {
      missing.push("P6: qualitative.collateralQualityRubric (required because secured lending)");
      collateralQualityRubric = 3;
    }
    collateralScore = likertToScore(collateralQualityRubric);
  } else {
    // Unsecured by design: neutral credit, not penalized. See algorithm.md section 4 (P6).
    collateralScore = 60;
  }

  const redFlags = qualitative.governanceRedFlags;
  const flagCount = Array.isArray(redFlags) ? redFlags.length : 0;
  const governanceScore = clamp(100 - flagCount * 15, 0, 100);

  const managementScore = likertToScore(managementQualityRubric);

  const score = 0.4 * managementScore + 0.3 * collateralScore + 0.3 * governanceScore;
  return {
    score,
    subScores: { managementQuality: managementScore, collateralQuality: collateralScore, governance: governanceScore },
    flags: Array.isArray(redFlags) ? redFlags : [],
  };
}

const PILLAR_WEIGHTS = { p1: 0.25, p2: 0.2, p3: 0.15, p4: 0.15, p5: 0.1, p6: 0.15 };

// Core fields required unconditionally, for the completeness denominator.
// Kept in sync manually with the read() calls above — see algorithm.md section 6.
// Two fields are *conditionally* required (cashRunwayMonths only if cash-flow-negative;
// collateralQualityRubric only if secured lending) and are added to the denominator
// dynamically in computeScore() below, rather than listed here unconditionally.
const REQUIRED_FIELDS = [
  "leverage.netDebtToEbitda",
  "leverage.sectorMedianLeverage",
  "leverage.debtToEquity",
  "coverage.ebitdaToInterestExpense",
  "coverage.fcfToTotalDebtService",
  "liquidity.currentRatio",
  "liquidity.quickRatio",
  "profitability.ebitdaMargin",
  "profitability.sectorMedianEbitdaMargin",
  "profitability.marginCoefficientOfVariation3to5yr",
  "industry.cyclicalityRubric",
  "qualitative.managementQualityRubric",
];

function getByPath(obj, path) {
  return path.split(".").reduce((v, p) => (v == null ? undefined : v[p]), obj);
}

function ratingBandFor(score) {
  if (score >= 85) return { band: "AAA/AA-equivalent", indicativeSpreadBpsOverRiskFree: "50-100" };
  if (score >= 70) return { band: "A/BBB-equivalent (Investment Grade)", indicativeSpreadBpsOverRiskFree: "100-250" };
  if (score >= 50) return { band: "BB/B-equivalent (High Yield)", indicativeSpreadBpsOverRiskFree: "250-600" };
  if (score >= 30) return { band: "CCC-equivalent (Substantial Risk)", indicativeSpreadBpsOverRiskFree: "600-1000" };
  return { band: "CC/C-equivalent (Distressed)", indicativeSpreadBpsOverRiskFree: "1000-2000+" };
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

  const ncrs =
    PILLAR_WEIGHTS.p1 * p1.score +
    PILLAR_WEIGHTS.p2 * p2.score +
    PILLAR_WEIGHTS.p3 * p3.score +
    PILLAR_WEIGHTS.p4 * p4.score +
    PILLAR_WEIGHTS.p5 * p5.score +
    PILLAR_WEIGHTS.p6 * p6.score;

  const liquidity = input.liquidity || {};
  const qualitative = input.qualitative || {};
  const isCashFlowNegative = liquidity.isCashFlowNegative === true;
  const isSecuredLending = qualitative.isSecuredLending === true;

  let explicitlyMissing = REQUIRED_FIELDS.filter((f) => MISSING.has(getByPath(input, f)));
  let totalRequiredFields = REQUIRED_FIELDS.length;

  totalRequiredFields += 1;
  if (isCashFlowNegative) {
    if (MISSING.has(liquidity.cashRunwayMonths)) explicitlyMissing.push("liquidity.cashRunwayMonths");
  }
  totalRequiredFields += 1;
  if (isSecuredLending) {
    if (MISSING.has(qualitative.collateralQualityRubric)) explicitlyMissing.push("qualitative.collateralQualityRubric");
  }

  const completeness = 1 - explicitlyMissing.length / totalRequiredFields;
  const rating = ratingBandFor(ncrs);

  return {
    algorithm: ALGORITHM_NAME,
    version: ALGORITHM_VERSION,
    ncrs: Math.round(ncrs * 10) / 10,
    ratingBand: rating.band,
    indicativeSpreadBpsOverRiskFree: rating.indicativeSpreadBpsOverRiskFree,
    confidence: confidenceFor(completeness),
    completeness: Math.round(completeness * 100) / 100,
    pillars: {
      p1_leverage: { weight: PILLAR_WEIGHTS.p1, ...p1 },
      p2_coverage: { weight: PILLAR_WEIGHTS.p2, ...p2 },
      p3_liquidity: { weight: PILLAR_WEIGHTS.p3, ...p3 },
      p4_profitabilityAndStability: { weight: PILLAR_WEIGHTS.p4, ...p4 },
      p5_industryAndCyclicalityRisk: { weight: PILLAR_WEIGHTS.p5, ...p5 },
      p6_qualitativeAndGovernance: { weight: PILLAR_WEIGHTS.p6, ...p6 },
    },
    missingFields: explicitlyMissing,
  };
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`${result.algorithm} v${result.version}`);
  lines.push(
    `NCRS: ${result.ncrs} — ${result.ratingBand} (indicative spread: +${result.indicativeSpreadBpsOverRiskFree} bps over risk-free benchmark; confidence: ${result.confidence}, ${Math.round(result.completeness * 100)}% complete)`
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

module.exports = { computeScore, ratingBandFor, ALGORITHM_NAME, ALGORITHM_VERSION };
