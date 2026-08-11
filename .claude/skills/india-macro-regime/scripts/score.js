#!/usr/bin/env node
/**
 * Nishant India Macro Regime Index (NIMRI) — reference implementation, v1.0.
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
 * reference/algorithm.md sections 4-6 for what each field means and how
 * missing/"unknown" values are handled.
 */

"use strict";

const fs = require("fs");

const ALGORITHM_NAME = "Nishant India Macro Regime Index (NIMRI)";
const ALGORITHM_VERSION = "1.0";

function clamp(x, lo, hi) {
  return Math.min(Math.max(x, lo), hi);
}

/** Piecewise-linear interpolation. anchors: array of [x, y] pairs sorted by x.
 * y need not be monotonic — a tent-shaped curve is just a lerp whose anchors
 * rise then fall (see algorithm.md P2/P3 for real examples). */
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
  const gdpYoy = read("growth.realGdpYoyPct", 6.5);
  const iipYoy = read("growth.iipYoyPct", 0);
  const manufacturingPmi = read("growth.manufacturingPmi", 50);
  const servicesPmi = read("growth.servicesPmi", 50);

  const a = lerp(gdpYoy, [
    [-2, 5],
    [0, 20],
    [3, 35],
    [6.5, 60],
    [9, 85],
    [12, 100],
  ]);
  const b = lerp(iipYoy, [
    [-6, 5],
    [0, 25],
    [4, 55],
    [7, 75],
    [10, 90],
    [14, 100],
  ]);
  const compositePmi = (manufacturingPmi + servicesPmi) / 2;
  const c = clamp(50 + (compositePmi - 50) * 3, 0, 100);

  const score = 0.4 * a + 0.25 * b + 0.35 * c;
  return {
    score,
    subScores: { gdpVsTrend: a, iipYoy: b, compositePmi: c },
    flags: [],
  };
}

function scoreP2(input, missing) {
  const read = makeReader(input, missing, "P2");
  const cpiYoy = read("inflation.cpiYoyPct", 4);
  const repoRate = read("inflation.repoRatePct", cpiYoy + 1.5);
  const realRepoRate = repoRate - cpiYoy;

  const a = lerp(cpiYoy, [
    [0, 20],
    [2, 55],
    [4, 100],
    [6, 55],
    [8, 20],
    [12, 5],
  ]);
  const b = lerp(realRepoRate, [
    [-3, 25],
    [0, 55],
    [1.5, 90],
    [3, 70],
    [5, 45],
    [8, 15],
  ]);

  const score = 0.6 * a + 0.4 * b;
  return {
    score,
    subScores: { cpiVsTarget: a, realRepoRate: b },
    flags: [],
  };
}

function scoreP3(input, missing) {
  const read = makeReader(input, missing, "P3");
  const cad = read("externalSector.cadPctOfGdp", 1.25);
  const fxMonths = read("externalSector.fxReserveMonthsImportCover", 9);
  const inrVol = read("externalSector.inrRealizedVolPct", 8);

  const a = lerp(cad, [
    [-3, 65],
    [0, 90],
    [1.25, 100],
    [2.5, 75],
    [4, 45],
    [6, 15],
  ]);
  const b = lerp(fxMonths, [
    [3, 10],
    [6, 40],
    [9, 80],
    [12, 95],
    [15, 100],
  ]);
  const c = lerp(inrVol, [
    [2, 100],
    [5, 80],
    [8, 55],
    [12, 30],
    [18, 10],
  ]);

  const score = 0.4 * a + 0.35 * b + 0.25 * c;
  return {
    score,
    subScores: { cad: a, fxReserveAdequacy: b, inrVolatility: c },
    flags: [],
  };
}

function scoreP4(input, missing) {
  const read = makeReader(input, missing, "P4");
  const actualDeficit = read("fiscal.fiscalDeficitPctGdp", 4.5);
  const targetDeficit = read("fiscal.fiscalDeficitTargetPctGdp", actualDeficit);
  const capexRising = read("fiscal.capexShareRisingYoy", false);

  const overshootPts = actualDeficit - targetDeficit;
  const base = clamp(80 - overshootPts * 25, 0, 100);
  const qualityAdjustment = capexRising ? 10 : 0;
  const score = clamp(base + qualityAdjustment, 0, 100);

  return {
    score,
    subScores: { deficitVsTarget: base, qualityAdjustment },
    flags: capexRising ? ["capex_quality_bonus"] : [],
  };
}

function scoreP5(input, missing) {
  const read = makeReader(input, missing, "P5");
  const creditGrowth = read("credit.nonFoodCreditGrowthYoyPct", 12.5);
  const liquidityStance = read("credit.liquidityStance", "neutral");

  const a = lerp(creditGrowth, [
    [0, 15],
    [5, 40],
    [10, 75],
    [12.5, 95],
    [15, 95],
    [20, 65],
    [25, 35],
    [30, 15],
  ]);
  const liquidityMap = {
    deep_deficit: 15,
    deficit: 35,
    neutral: 60,
    comfortable_surplus: 90,
    excess_surplus: 70,
  };
  const b = liquidityMap[liquidityStance] ?? 60;

  const score = 0.6 * a + 0.4 * b;
  return {
    score,
    subScores: { creditGrowth: a, liquidityStance: b },
    flags: [],
  };
}

function scoreP6(input, missing) {
  const read = makeReader(input, missing, "P6");
  const netFpi = read("capitalFlows.netFpiTrailing3moUsdBn", 0);
  const netFdi = read("capitalFlows.netFdiTrailingQuarterUsdBn", 0);
  const riskPremiumBps = read("capitalFlows.sovereignRiskPremiumBps", null, true);
  const geoRubric = input.capitalFlows ? input.capitalFlows.geopoliticalPolicyRiskRubric : undefined;

  const a = lerp(netFpi, [
    [-15, 10],
    [-5, 30],
    [0, 55],
    [5, 75],
    [10, 90],
    [20, 100],
  ]);
  const b = lerp(netFdi, [
    [-2, 15],
    [0, 40],
    [3, 60],
    [6, 80],
    [10, 95],
    [15, 100],
  ]);

  let c;
  let riskPremiumSource;
  if (!MISSING.has(riskPremiumBps)) {
    c = lerp(riskPremiumBps, [
      [40, 100],
      [80, 80],
      [120, 55],
      [200, 30],
      [300, 10],
    ]);
    riskPremiumSource = "quantitative_cds_proxy";
  } else if (!MISSING.has(geoRubric)) {
    c = likertToScore(geoRubric);
    riskPremiumSource = "qualitative_policy_credibility_rubric";
  } else {
    c = 60;
    riskPremiumSource = "default_neutral_no_data";
  }

  const score = 0.45 * a + 0.35 * b + 0.2 * c;
  return {
    score,
    subScores: { netFpiFlows: a, netFdiFlows: b, riskPremium: c },
    flags: [riskPremiumSource],
  };
}

const PILLAR_WEIGHTS = { p1: 0.25, p2: 0.2, p3: 0.2, p4: 0.15, p5: 0.1, p6: 0.1 };

// Every field any pillar's reader touches, for the completeness denominator.
// Kept in sync manually with the read() calls above — see algorithm.md section 6.
// Note: capitalFlows.geopoliticalPolicyRiskRubric is intentionally excluded —
// it's an opt-in fallback for capitalFlows.sovereignRiskPremiumBps, not a
// separately required field (see algorithm.md section 4, P6).
const REQUIRED_FIELDS = [
  "growth.realGdpYoyPct",
  "growth.iipYoyPct",
  "growth.manufacturingPmi",
  "growth.servicesPmi",
  "inflation.cpiYoyPct",
  "inflation.repoRatePct",
  "externalSector.cadPctOfGdp",
  "externalSector.fxReserveMonthsImportCover",
  "externalSector.inrRealizedVolPct",
  "fiscal.fiscalDeficitPctGdp",
  "fiscal.fiscalDeficitTargetPctGdp",
  "fiscal.capexShareRisingYoy",
  "credit.nonFoodCreditGrowthYoyPct",
  "credit.liquidityStance",
  "capitalFlows.netFpiTrailing3moUsdBn",
  "capitalFlows.netFdiTrailingQuarterUsdBn",
  "capitalFlows.sovereignRiskPremiumBps",
];

function getByPath(obj, path) {
  return path.split(".").reduce((v, p) => (v == null ? undefined : v[p]), obj);
}

const REGIME_TILTS = {
  "Expansion / Goldilocks":
    "Overweight equities, tilt toward cyclicals and small/mid-caps; risk-on across the book.",
  "Moderate Growth / Balanced Expansion":
    "Balanced allocation with a modest equity overweight; favor quality large-caps over high-beta names.",
  "Slowdown / Caution":
    "Trim cyclicals and small-caps, rotate toward quality large-caps and defensive sectors (IT, pharma, FMCG), raise cash buffer.",
  "Stress / Contraction":
    "Underweight equities; overweight defensives, duration (long-dated G-secs), and gold.",
  "Crisis / Deep Contraction":
    "Capital preservation: maximum defensive posture — gold, cash, and sovereign duration overweight; minimal equity exposure; consider INR hedges on residual foreign-asset exposure.",
};

function regimeFor(nimri) {
  if (nimri >= 80) return "Expansion / Goldilocks";
  if (nimri >= 65) return "Moderate Growth / Balanced Expansion";
  if (nimri >= 50) return "Slowdown / Caution";
  if (nimri >= 30) return "Stress / Contraction";
  return "Crisis / Deep Contraction";
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

  const nimri =
    PILLAR_WEIGHTS.p1 * p1.score +
    PILLAR_WEIGHTS.p2 * p2.score +
    PILLAR_WEIGHTS.p3 * p3.score +
    PILLAR_WEIGHTS.p4 * p4.score +
    PILLAR_WEIGHTS.p5 * p5.score +
    PILLAR_WEIGHTS.p6 * p6.score;

  const explicitlyMissing = REQUIRED_FIELDS.filter((f) => MISSING.has(getByPath(input, f)));
  const completeness = 1 - explicitlyMissing.length / REQUIRED_FIELDS.length;

  const regime = regimeFor(nimri);

  return {
    algorithm: ALGORITHM_NAME,
    version: ALGORITHM_VERSION,
    nimri: Math.round(nimri * 10) / 10,
    regime,
    assetAllocationTilt: REGIME_TILTS[regime],
    confidence: confidenceFor(completeness),
    completeness: Math.round(completeness * 100) / 100,
    pillars: {
      p1_growthMomentum: { weight: PILLAR_WEIGHTS.p1, ...p1 },
      p2_inflationAndMonetaryStance: { weight: PILLAR_WEIGHTS.p2, ...p2 },
      p3_externalSectorHealth: { weight: PILLAR_WEIGHTS.p3, ...p3 },
      p4_fiscalHealth: { weight: PILLAR_WEIGHTS.p4, ...p4 },
      p5_creditAndLiquidity: { weight: PILLAR_WEIGHTS.p5, ...p5 },
      p6_capitalFlowsAndMarketConfidence: { weight: PILLAR_WEIGHTS.p6, ...p6 },
    },
    missingFields: explicitlyMissing,
  };
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`${result.algorithm} v${result.version}`);
  lines.push(
    `NIMRI: ${result.nimri} — ${result.regime} (confidence: ${result.confidence}, ${Math.round(result.completeness * 100)}% complete)`
  );
  lines.push(`Tilt: ${result.assetAllocationTilt}`);
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
