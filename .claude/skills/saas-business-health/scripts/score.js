#!/usr/bin/env node
/**
 * Nishant SaaS Health Score (NSHS) — reference implementation, v1.0.
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

const ALGORITHM_NAME = "Nishant SaaS Health Score (NSHS)";
const ALGORITHM_VERSION = "1.0";

function clamp(x, lo, hi) {
  return Math.min(Math.max(x, lo), hi);
}

/** Piecewise-linear interpolation. anchors: array of [x, y] pairs sorted ascending by x. */
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
  const nrr = read("retention.nrr", 100);
  const grr = read("retention.grr", 100);

  const a = lerp(nrr, [
    [80, 10],
    [90, 30],
    [100, 55],
    [110, 75],
    [120, 90],
    [130, 100],
  ]);
  const b = lerp(grr, [
    [80, 10],
    [85, 35],
    [90, 55],
    [95, 75],
    [98, 90],
    [100, 100],
  ]);

  const score = 0.6 * a + 0.4 * b;
  return { score, subScores: { nrr: a, grr: b }, flags: [] };
}

function scoreP2(input, missing) {
  const read = makeReader(input, missing, "P2");
  const arrGrowth = read("growth.arrGrowthYoyPct", 0);
  const fcfMargin = read("growth.fcfMarginPct", 0);
  const cacPayback = read("growth.cacPaybackMonths", 48);

  const ruleOf40 = arrGrowth + fcfMargin;
  const a = lerp(ruleOf40, [
    [-20, 0],
    [0, 15],
    [20, 35],
    [30, 55],
    [40, 75],
    [55, 90],
    [70, 100],
  ]);
  const b = lerp(cacPayback, [
    [6, 100],
    [12, 85],
    [18, 65],
    [24, 45],
    [36, 20],
    [48, 5],
  ]);

  const score = 0.6 * a + 0.4 * b;
  return { score, subScores: { ruleOf40, ruleOf40Score: a, cacPaybackScore: b }, flags: [] };
}

function scoreP3(input, missing) {
  const read = makeReader(input, missing, "P3");
  const ltvToCac = read("unitEconomics.ltvToCac", 0);
  const grossMargin = read("unitEconomics.grossMarginPct", 0);

  const a = lerp(ltvToCac, [
    [1, 10],
    [2, 35],
    [3, 60],
    [4, 80],
    [5, 90],
    [6, 100],
  ]);
  const b = lerp(grossMargin, [
    [50, 10],
    [60, 35],
    [70, 60],
    [75, 75],
    [80, 90],
    [85, 100],
  ]);

  const score = 0.55 * a + 0.45 * b;
  return { score, subScores: { ltvToCac: a, grossMargin: b }, flags: [] };
}

function scoreP4(input, missing) {
  const read = makeReader(input, missing, "P4");
  const logoChurn = read("churn.annualizedLogoChurnPct", 20);
  const cohortRubric = read("churn.cohortRetentionCurveRubric", 3);

  const a = lerp(logoChurn, [
    [0, 100],
    [2, 95],
    [5, 80],
    [10, 55],
    [15, 30],
    [20, 10],
  ]);
  const b = likertToScore(cohortRubric);

  const score = 0.55 * a + 0.45 * b;
  return { score, subScores: { logoChurn: a, cohortCurveHealth: b }, flags: [] };
}

function scoreP5(input, missing) {
  const capitalEfficiency = input.capitalEfficiency || {};
  const isFcfPositive = capitalEfficiency.isFcfPositive === true;

  const flags = [];
  let a, b;
  if (isFcfPositive) {
    flags.push("fcf_positive_full_credit_applied");
    a = 100;
    b = 100;
  } else {
    let burnMultiple = capitalEfficiency.burnMultiple;
    if (MISSING.has(burnMultiple)) {
      missing.push("P5: capitalEfficiency.burnMultiple (required because not FCF-positive)");
      burnMultiple = 3.0;
    }
    let runwayMonths = capitalEfficiency.runwayMonths;
    if (MISSING.has(runwayMonths)) {
      missing.push("P5: capitalEfficiency.runwayMonths (required because not FCF-positive)");
      runwayMonths = 0;
    }
    a = lerp(burnMultiple, [
      [0, 100],
      [0.5, 90],
      [1.0, 75],
      [1.5, 55],
      [2.0, 35],
      [3.0, 10],
    ]);
    b = lerp(runwayMonths, [
      [6, 10],
      [12, 40],
      [18, 60],
      [24, 80],
      [36, 95],
      [48, 100],
    ]);
  }

  const score = 0.6 * a + 0.4 * b;
  return { score, subScores: { burnMultiple: a, runway: b }, flags };
}

function scoreP6(input, missing) {
  const read = makeReader(input, missing, "P6");
  const founderMarketFit = read("qualitative.founderMarketFitRubric", 3);
  const productMoat = read("qualitative.productMoatRubric", 3);
  const concentration = read("qualitative.top10CustomerConcentrationPct", 50);

  const qualitative = input.qualitative || {};
  const redFlags = qualitative.governanceRedFlags;
  const flagCount = Array.isArray(redFlags) ? redFlags.length : 0;

  const a = likertToScore(founderMarketFit);
  const b = likertToScore(productMoat);
  const c = lerp(concentration, [
    [0, 100],
    [10, 85],
    [20, 60],
    [35, 35],
    [50, 10],
  ]);
  const d = clamp(100 - flagCount * 15, 0, 100);

  const score = 0.3 * a + 0.3 * b + 0.2 * c + 0.2 * d;
  return {
    score,
    subScores: { founderMarketFit: a, productMoat: b, customerConcentration: c, governance: d },
    flags: Array.isArray(redFlags) ? redFlags : [],
  };
}

const PILLAR_WEIGHTS = { p1: 0.25, p2: 0.15, p3: 0.15, p4: 0.15, p5: 0.15, p6: 0.15 };

// Core fields required unconditionally, for the completeness denominator.
// Kept in sync manually with the read() calls above — see algorithm.md section 6.
// Two fields are *conditionally* required (burnMultiple and runwayMonths, only
// if not FCF-positive) and are added to the denominator dynamically in
// computeScore() below, rather than listed here unconditionally.
const REQUIRED_FIELDS = [
  "retention.nrr",
  "retention.grr",
  "growth.arrGrowthYoyPct",
  "growth.fcfMarginPct",
  "growth.cacPaybackMonths",
  "unitEconomics.ltvToCac",
  "unitEconomics.grossMarginPct",
  "churn.annualizedLogoChurnPct",
  "churn.cohortRetentionCurveRubric",
  "qualitative.founderMarketFitRubric",
  "qualitative.productMoatRubric",
  "qualitative.top10CustomerConcentrationPct",
];

function getByPath(obj, path) {
  return path.split(".").reduce((v, p) => (v == null ? undefined : v[p]), obj);
}

function tierFor(score) {
  if (score >= 85) return { tier: "Tier 1 — Best-in-Class", implication: "Top-decile SaaS health; premium multiple defensible, minimal structuring needed" };
  if (score >= 70) return { tier: "Tier 2 — Strong / Fundable", implication: "Healthy, fundable business; standard growth-stage terms apply" };
  if (score >= 50) return { tier: "Tier 3 — Developing / Watch", implication: "Mixed signals; proceed with structure or targeted diligence on the weak pillar(s) before committing" };
  if (score >= 30) return { tier: "Tier 4 — Weak / At-Risk", implication: "Material weakness in retention, economics, or cash runway; restructure terms, re-price, or pass" };
  return { tier: "Tier 5 — Distressed / Unfundable", implication: "Broken retention, unit economics, or runway; not investable as-is — turnaround/workout territory" };
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

  const nshs =
    PILLAR_WEIGHTS.p1 * p1.score +
    PILLAR_WEIGHTS.p2 * p2.score +
    PILLAR_WEIGHTS.p3 * p3.score +
    PILLAR_WEIGHTS.p4 * p4.score +
    PILLAR_WEIGHTS.p5 * p5.score +
    PILLAR_WEIGHTS.p6 * p6.score;

  const capitalEfficiency = input.capitalEfficiency || {};
  const isFcfPositive = capitalEfficiency.isFcfPositive === true;

  let explicitlyMissing = REQUIRED_FIELDS.filter((f) => MISSING.has(getByPath(input, f)));
  let totalRequiredFields = REQUIRED_FIELDS.length;

  totalRequiredFields += 1;
  totalRequiredFields += 1;
  if (!isFcfPositive) {
    if (MISSING.has(capitalEfficiency.burnMultiple)) explicitlyMissing.push("capitalEfficiency.burnMultiple");
    if (MISSING.has(capitalEfficiency.runwayMonths)) explicitlyMissing.push("capitalEfficiency.runwayMonths");
  }

  const completeness = 1 - explicitlyMissing.length / totalRequiredFields;
  const tierInfo = tierFor(nshs);

  return {
    algorithm: ALGORITHM_NAME,
    version: ALGORITHM_VERSION,
    nshs: Math.round(nshs * 10) / 10,
    tier: tierInfo.tier,
    implication: tierInfo.implication,
    confidence: confidenceFor(completeness),
    completeness: Math.round(completeness * 100) / 100,
    pillars: {
      p1_revenueRetentionAndExpansion: { weight: PILLAR_WEIGHTS.p1, ...p1 },
      p2_growthEfficiency: { weight: PILLAR_WEIGHTS.p2, ...p2 },
      p3_unitEconomics: { weight: PILLAR_WEIGHTS.p3, ...p3 },
      p4_churnAndCohortRetentionQuality: { weight: PILLAR_WEIGHTS.p4, ...p4 },
      p5_capitalEfficiencyAndBurn: { weight: PILLAR_WEIGHTS.p5, ...p5 },
      p6_qualitativeAndGovernance: { weight: PILLAR_WEIGHTS.p6, ...p6 },
    },
    missingFields: explicitlyMissing,
  };
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`${result.algorithm} v${result.version}`);
  lines.push(
    `NSHS: ${result.nshs} — ${result.tier} (confidence: ${result.confidence}, ${Math.round(result.completeness * 100)}% complete)`
  );
  lines.push(`Implication: ${result.implication}`);
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

module.exports = { computeScore, tierFor, ALGORITHM_NAME, ALGORITHM_VERSION };
