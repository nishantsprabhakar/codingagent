#!/usr/bin/env node
/**
 * Prabhakar Equity Signal Score (PESS) — reference implementation, v1.0.
 * Developed by Nishant Prabhakar.
 *
 * This is a literal implementation of reference/algorithm.md. If you change a
 * weight or formula here, bump the version and update that document too —
 * they must never drift apart.
 *
 * Peer-percentile inputs (anything ending in "Percentile") are NOT computed
 * by this script. Computing a real cross-sectional percentile requires a
 * real peer/sector universe, which is the analyst's job to source and rank
 * against *before* calling this script — see reference/algorithm.md section
 * 4 and 6. This script scores the already-computed percentile; it does not
 * infer one from a raw peer list.
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

const ALGORITHM_NAME = "Prabhakar Equity Signal Score (PESS)";
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

/**
 * Altman Z-Score — the real, established 1968 balance-sheet-strength formula
 * (Edward Altman), not a Prabhakar invention. Used here as one input into
 * P2 Quality: Z = 1.2A + 1.4B + 3.3C + 0.6D + 1.0E, where
 *   A = Working Capital / Total Assets
 *   B = Retained Earnings / Total Assets
 *   C = EBIT / Total Assets
 *   D = Market Value of Equity / Total Liabilities
 *   E = Sales / Total Assets
 * Standard bands: Z < 1.81 distress, 1.81-2.99 grey zone, > 2.99 safe zone.
 */
function altmanZScore(v) {
  const A = v.workingCapital / v.totalAssets;
  const B = v.retainedEarnings / v.totalAssets;
  const C = v.ebit / v.totalAssets;
  const D = v.marketValueEquity / v.totalLiabilities;
  const E = v.sales / v.totalAssets;
  return 1.2 * A + 1.4 * B + 3.3 * C + 0.6 * D + 1.0 * E;
}

/**
 * Beneish M-Score — the real, established 1999 earnings-manipulation
 * forensic-accounting formula (Messod Beneish), not a Prabhakar invention.
 * Takes the eight pre-computed ratio inputs (DSRI, GMI, AQI, SGI, DEPI,
 * SGAI, TATA, LVGI) — deriving those from two years of financial statements
 * is the analyst's job, same as sourcing a peer percentile. Standard
 * threshold: M > -1.78 flags elevated manipulation risk.
 */
function beneishMScore(v) {
  return (
    -4.84 +
    0.92 * v.dsri +
    0.528 * v.gmi +
    0.404 * v.aqi +
    0.892 * v.sgi +
    0.115 * v.depi -
    0.172 * v.sgai +
    4.679 * v.tata -
    0.327 * v.lvgi
  );
}

function scoreP1(input, missing) {
  const read = makeReader(input, missing, "P1");
  const blendedMultiplePercentile = read("valuation.blendedMultiplePercentile", 50);

  // Inverted: cheap (low percentile of multiple) scores high.
  const score = clamp(100 - blendedMultiplePercentile, 0, 100);
  return {
    score,
    subScores: { blendedValuationPercentile: blendedMultiplePercentile, invertedScore: score },
    flags: [],
  };
}

function scoreP2(input, missing) {
  const read = makeReader(input, missing, "P2");
  const roicPercentile = read("quality.roicPercentile", 50);
  const marginStabilityPercentile = read("quality.marginStabilityPercentile", 50);
  const zInputs = {
    workingCapital: read("quality.altmanZInputs.workingCapital", 0),
    totalAssets: read("quality.altmanZInputs.totalAssets", 1),
    retainedEarnings: read("quality.altmanZInputs.retainedEarnings", 0),
    ebit: read("quality.altmanZInputs.ebit", 0),
    marketValueEquity: read("quality.altmanZInputs.marketValueEquity", 0),
    totalLiabilities: read("quality.altmanZInputs.totalLiabilities", 1),
    sales: read("quality.altmanZInputs.sales", 0),
  };

  const a = clamp(roicPercentile, 0, 100);
  const b = clamp(marginStabilityPercentile, 0, 100);
  const z = altmanZScore(zInputs);
  const c = clamp(
    lerp(z, [
      [1.0, 10],
      [1.81, 40],
      [2.99, 70],
      [4.5, 90],
      [6.0, 100],
    ]),
    0,
    100
  );

  const score = 0.35 * a + 0.3 * b + 0.35 * c;
  return {
    score,
    subScores: { roicPercentile: a, marginStabilityPercentile: b, altmanZScore: z, altmanZBandScore: c },
    flags: [],
  };
}

function scoreP3(input, missing) {
  const read = makeReader(input, missing, "P3");
  const revenueGrowthPercentile = read("growth.revenueGrowthPercentile", 50);
  const epsGrowthPercentile = read("growth.epsGrowthPercentile", 50);
  const growthQualityFlag = read("growth.growthQualityFlag", false);

  const base = 0.5 * clamp(revenueGrowthPercentile, 0, 100) + 0.5 * clamp(epsGrowthPercentile, 0, 100);
  const score = clamp(growthQualityFlag ? base - 15 : base, 0, 100);
  return {
    score,
    subScores: { revenueGrowthPercentile, epsGrowthPercentile, base },
    flags: growthQualityFlag ? ["acquisition_or_oneoff_driven_growth"] : [],
  };
}

function scoreP4(input, missing) {
  const read = makeReader(input, missing, "P4");
  const priceMomentumPercentile = read("momentum.priceMomentumPercentile", 50);
  const estimateRevisionPercentile = read("momentum.estimateRevisionPercentile", 50);

  const a = clamp(priceMomentumPercentile, 0, 100);
  const b = clamp(estimateRevisionPercentile, 0, 100);
  const score = 0.6 * a + 0.4 * b;
  return { score, subScores: { priceMomentum12m1mPercentile: a, estimateRevisionPercentile: b }, flags: [] };
}

function scoreP5(input, missing) {
  const read = makeReader(input, missing, "P5");
  const insiderTrendRubric = read("ownership.insiderTrendRubric", 3);
  const institutionalOwnershipTrend = read("ownership.institutionalOwnershipTrend", "flat");
  const shortInterestPctFloat = read("ownership.shortInterestPctFloat", 0);

  const a = likertToScore(insiderTrendRubric);
  const trendMap = { decreasing: 20, flat: 55, increasing: 85 };
  const b = trendMap[institutionalOwnershipTrend] ?? 55;
  const c = clamp(
    lerp(shortInterestPctFloat, [
      [0, 65],
      [5, 60],
      [10, 50],
      [20, 35],
      [30, 20],
    ]),
    0,
    100
  );

  const score = 0.4 * a + 0.3 * b + 0.3 * c;
  return {
    score,
    subScores: { insiderTrend: a, institutionalOwnershipTrend: b, shortInterestInverse: c },
    flags: [],
  };
}

function scoreP6(input, missing) {
  const read = makeReader(input, missing, "P6");
  const leverage = read("risk.netDebtToEbitda", 0);
  const sectorMedianLeverage = read("risk.sectorMedianLeverage", leverage);
  const beta = read("risk.beta", 1);
  const sectorMedianBeta = read("risk.sectorMedianBeta", beta);
  const materialPendingLitigation = read("risk.materialPendingLitigation", false);
  const mInputs = {
    dsri: read("risk.beneishInputs.dsri", 1),
    gmi: read("risk.beneishInputs.gmi", 1),
    aqi: read("risk.beneishInputs.aqi", 1),
    sgi: read("risk.beneishInputs.sgi", 1),
    depi: read("risk.beneishInputs.depi", 1),
    sgai: read("risk.beneishInputs.sgai", 1),
    tata: read("risk.beneishInputs.tata", 0),
    lvgi: read("risk.beneishInputs.lvgi", 1),
  };

  const deductions = [];
  let score = 100;

  const leverageDeduction = clamp(Math.max(0, leverage - sectorMedianLeverage) * 10, 0, 25);
  if (leverageDeduction > 0) {
    score -= leverageDeduction;
    deductions.push(`leverage_above_sector_norm(-${Math.round(leverageDeduction * 10) / 10})`);
  }

  const mScore = beneishMScore(mInputs);
  if (mScore > -1.78) {
    score -= 25;
    deductions.push("beneish_mscore_manipulation_risk(-25)");
  }

  const volDeduction = clamp(Math.max(0, beta - sectorMedianBeta) * 20, 0, 15);
  if (volDeduction > 0) {
    score -= volDeduction;
    deductions.push(`elevated_beta_vs_sector(-${Math.round(volDeduction * 10) / 10})`);
  }

  if (materialPendingLitigation) {
    score -= 20;
    deductions.push("material_pending_litigation_or_regulatory(-20)");
  }

  return {
    score: clamp(score, 0, 100),
    subScores: { beneishMScore: mScore, leverage, beta },
    flags: deductions,
  };
}

const PILLAR_WEIGHTS = { p1: 0.2, p2: 0.2, p3: 0.2, p4: 0.15, p5: 0.1, p6: 0.15 };

// Every field any pillar's reader touches, for the completeness denominator.
// Kept in sync manually with the read() calls above — see algorithm.md section 6.
const REQUIRED_FIELDS = [
  "valuation.blendedMultiplePercentile",
  "quality.roicPercentile",
  "quality.marginStabilityPercentile",
  "quality.altmanZInputs.workingCapital",
  "quality.altmanZInputs.totalAssets",
  "quality.altmanZInputs.retainedEarnings",
  "quality.altmanZInputs.ebit",
  "quality.altmanZInputs.marketValueEquity",
  "quality.altmanZInputs.totalLiabilities",
  "quality.altmanZInputs.sales",
  "growth.revenueGrowthPercentile",
  "growth.epsGrowthPercentile",
  "growth.growthQualityFlag",
  "momentum.priceMomentumPercentile",
  "momentum.estimateRevisionPercentile",
  "ownership.insiderTrendRubric",
  "ownership.institutionalOwnershipTrend",
  "ownership.shortInterestPctFloat",
  "risk.netDebtToEbitda",
  "risk.sectorMedianLeverage",
  "risk.beta",
  "risk.sectorMedianBeta",
  "risk.materialPendingLitigation",
  "risk.beneishInputs.dsri",
  "risk.beneishInputs.gmi",
  "risk.beneishInputs.aqi",
  "risk.beneishInputs.sgi",
  "risk.beneishInputs.depi",
  "risk.beneishInputs.sgai",
  "risk.beneishInputs.tata",
  "risk.beneishInputs.lvgi",
];

function getByPath(obj, path) {
  return path.split(".").reduce((v, p) => (v == null ? undefined : v[p]), obj);
}

function tierFor(pess) {
  if (pess >= 80) return "Top decile / High conviction";
  if (pess >= 65) return "Attractive";
  if (pess >= 50) return "Neutral / Hold";
  if (pess >= 35) return "Weak / Avoid new positions";
  return "Red flag / Exit review";
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

  const pess =
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
    pess: Math.round(pess * 10) / 10,
    tier: tierFor(pess),
    confidence: confidenceFor(completeness),
    completeness: Math.round(completeness * 100) / 100,
    pillars: {
      p1_valuation: { weight: PILLAR_WEIGHTS.p1, ...p1 },
      p2_quality: { weight: PILLAR_WEIGHTS.p2, ...p2 },
      p3_growth: { weight: PILLAR_WEIGHTS.p3, ...p3 },
      p4_momentum: { weight: PILLAR_WEIGHTS.p4, ...p4 },
      p5_ownershipAndSentiment: { weight: PILLAR_WEIGHTS.p5, ...p5 },
      p6_riskAndRedFlags: { weight: PILLAR_WEIGHTS.p6, ...p6 },
    },
    missingFields: explicitlyMissing,
  };
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`${result.algorithm} v${result.version}`);
  lines.push(`PESS: ${result.pess} — ${result.tier} (confidence: ${result.confidence}, ${Math.round(result.completeness * 100)}% complete)`);
  lines.push("");
  for (const [key, pillar] of Object.entries(result.pillars)) {
    lines.push(`${key}  weight=${pillar.weight}  score=${Math.round(pillar.score * 10) / 10}`);
    for (const [sub, val] of Object.entries(pillar.subScores)) {
      if (val === undefined) continue;
      lines.push(`  - ${sub}: ${typeof val === "number" ? Math.round(val * 1000) / 1000 : val}`);
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
