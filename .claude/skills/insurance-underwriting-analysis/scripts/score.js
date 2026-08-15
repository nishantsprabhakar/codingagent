#!/usr/bin/env node
/**
 * Nishant Insurance Underwriting Score (NIUS) — reference implementation, v1.0.
 * Developed by Nishant Prabhakar.
 *
 * Scores a COMMERCIAL PROPERTY (P&C) risk submission for underwriting/pricing
 * purposes. Not tuned for general liability, professional liability (E&O/D&O),
 * or personal lines — see reference/algorithm.md section 1 and section 8.
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

const ALGORITHM_NAME = "Nishant Insurance Underwriting Score (NIUS)";
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
  const lossRatioPct = read("lossHistory.lossRatio5yrPct", 100);
  const frequencyTrendPctPerYear = read("lossHistory.frequencyTrendPctPerYear", 0);
  const largeLossCount = read("lossHistory.largeLossCountTrailing5yr", 3);
  const hasCatLoss = read("lossHistory.hasCatLossTrailing5yr", true);

  const a = lerp(lossRatioPct, [
    [20, 100],
    [40, 85],
    [60, 65],
    [80, 40],
    [100, 20],
    [120, 5],
  ]);

  const b = lerp(frequencyTrendPctPerYear, [
    [-15, 95],
    [-5, 80],
    [0, 60],
    [10, 35],
    [25, 10],
  ]);

  const c = clamp(95 - 20 * Math.min(largeLossCount, 3) - (hasCatLoss ? 15 : 0), 0, 100);

  const score = 0.4 * a + 0.3 * b + 0.3 * c;
  return {
    score,
    subScores: { lossRatio5yr: a, frequencyTrend: b, largeOrCatLossPresence: c },
    flags: hasCatLoss ? ["catastrophic_loss_in_history"] : [],
  };
}

function scoreP2(input, missing) {
  const read = makeReader(input, missing, "P2");
  const constructionClassRubric = read("exposure.constructionClassRubric", 3);
  const occupancyHazardRubric = read("exposure.occupancyHazardRubric", 3);
  const protectionClassPPC = read("exposure.protectionClassPPC", 6);
  const catExposureZoneRubric = read("exposure.catExposureZoneRubric", 3);

  const a = likertToScore(constructionClassRubric);
  const b = likertToScore(occupancyHazardRubric);

  const c = lerp(protectionClassPPC, [
    [1, 100],
    [3, 85],
    [5, 65],
    [7, 40],
    [10, 15],
  ]);

  const d = likertToScore(catExposureZoneRubric);

  const score = 0.3 * a + 0.25 * b + 0.25 * c + 0.2 * d;
  return {
    score,
    subScores: {
      constructionClass: a,
      occupancyHazard: b,
      protectionClass: c,
      catExposureZone: d,
    },
    flags: [],
  };
}

function scoreP3(input, missing) {
  const read = makeReader(input, missing, "P3");
  const financialStabilityRubric = read("financialMoralHazard.financialStabilityRubric", 3);
  const priorNonRenewals = read("financialMoralHazard.priorNonRenewalsCancellations5yr", 4);
  const litigationHistoryRubric = read("financialMoralHazard.litigationHistoryRubric", 3);

  const a = likertToScore(financialStabilityRubric);

  const b = lerp(priorNonRenewals, [
    [0, 95],
    [1, 65],
    [2, 40],
    [3, 20],
    [4, 5],
  ]);

  const c = likertToScore(litigationHistoryRubric);

  const score = 0.4 * a + 0.3 * b + 0.3 * c;
  return {
    score,
    subScores: {
      financialStability: a,
      priorNonRenewalsCancellations: b,
      litigationHistory: c,
    },
    flags: [],
  };
}

function scoreP4(input, missing) {
  const read = makeReader(input, missing, "P4");
  const safetyProgramRubric = read("riskManagement.safetyProgramRubric", 3);
  const lossControlImplementedPct = read("riskManagement.lossControlRecsImplementedPct", 0);
  const businessContinuityRubric = read("riskManagement.businessContinuityRubric", 3);

  const a = likertToScore(safetyProgramRubric);

  const b = lerp(lossControlImplementedPct, [
    [0, 20],
    [50, 50],
    [75, 70],
    [90, 90],
    [100, 100],
  ]);

  const c = likertToScore(businessContinuityRubric);

  const score = 0.35 * a + 0.4 * b + 0.25 * c;
  return {
    score,
    subScores: {
      safetyProgramMaturity: a,
      lossControlRecsImplemented: b,
      businessContinuityPlanning: c,
    },
    flags: [],
  };
}

function scoreP5(input, missing) {
  const read = makeReader(input, missing, "P5");
  const requestedLimitUsd = read("coverageLimits.requestedLimitUSD", 0);
  const pmlUsd = read("coverageLimits.pmlUSD", requestedLimitUsd || 1);
  const retentionPctOfTiv = read("coverageLimits.retentionPctOfTIV", 0);
  const layeringStructureRubric = read("coverageLimits.layeringStructureRubric", 3);

  const limitToPmlRatio = pmlUsd ? requestedLimitUsd / pmlUsd : 0;
  const aRaw = lerp(limitToPmlRatio, [
    [0.5, 15],
    [0.75, 40],
    [0.9, 60],
    [1.0, 80],
    [1.15, 95],
    [1.5, 100],
  ]);
  const overInsured = limitToPmlRatio > 2.0;
  const a = overInsured ? Math.min(aRaw, 90) : aRaw;

  const b = lerp(retentionPctOfTiv, [
    [0.1, 30],
    [0.5, 55],
    [1, 75],
    [2, 90],
    [5, 100],
  ]);

  const c = likertToScore(layeringStructureRubric);

  const score = 0.4 * a + 0.3 * b + 0.3 * c;
  return {
    score,
    subScores: {
      requestedLimitVsPml: a,
      retentionLevel: b,
      layeringAndReinsuranceStructure: c,
    },
    flags: overInsured ? ["requested_limit_far_exceeds_pml"] : [],
  };
}

function scoreP6(input, missing) {
  const read = makeReader(input, missing, "P6");
  const quotedRatePct = read("marketPricing.quotedRatePct", 0);
  const indicatedRatePct = read("marketPricing.indicatedRatePct", quotedRatePct || 1);
  const competitiveMarketRubric = read("marketPricing.competitiveMarketRubric", 3);
  const accountRetentionValueRubric = read("marketPricing.accountRetentionValueRubric", 3);

  const rateAdequacyPct = indicatedRatePct ? ((quotedRatePct - indicatedRatePct) / indicatedRatePct) * 100 : 0;
  const a = lerp(rateAdequacyPct, [
    [-20, 10],
    [-10, 30],
    [0, 60],
    [10, 85],
    [20, 100],
  ]);

  const b = likertToScore(competitiveMarketRubric);
  const c = likertToScore(accountRetentionValueRubric);

  const score = 0.45 * a + 0.25 * b + 0.3 * c;
  return {
    score,
    subScores: {
      rateAdequacy: a,
      competitiveMarketConditions: b,
      accountRetentionValue: c,
    },
    flags: rateAdequacyPct < -15 ? ["rate_likely_inadequate"] : [],
  };
}

const PILLAR_WEIGHTS = { p1: 0.25, p2: 0.25, p3: 0.15, p4: 0.15, p5: 0.1, p6: 0.1 };

// Every field any pillar's reader touches, for the completeness denominator.
// Kept in sync manually with the read() calls above — see algorithm.md section 6.
const REQUIRED_FIELDS = [
  "lossHistory.lossRatio5yrPct",
  "lossHistory.frequencyTrendPctPerYear",
  "lossHistory.largeLossCountTrailing5yr",
  "lossHistory.hasCatLossTrailing5yr",
  "exposure.constructionClassRubric",
  "exposure.occupancyHazardRubric",
  "exposure.protectionClassPPC",
  "exposure.catExposureZoneRubric",
  "financialMoralHazard.financialStabilityRubric",
  "financialMoralHazard.priorNonRenewalsCancellations5yr",
  "financialMoralHazard.litigationHistoryRubric",
  "riskManagement.safetyProgramRubric",
  "riskManagement.lossControlRecsImplementedPct",
  "riskManagement.businessContinuityRubric",
  "coverageLimits.requestedLimitUSD",
  "coverageLimits.pmlUSD",
  "coverageLimits.retentionPctOfTIV",
  "coverageLimits.layeringStructureRubric",
  "marketPricing.quotedRatePct",
  "marketPricing.indicatedRatePct",
  "marketPricing.competitiveMarketRubric",
  "marketPricing.accountRetentionValueRubric",
];

function getByPath(obj, path) {
  return path.split(".").reduce((v, p) => (v == null ? undefined : v[p]), obj);
}

function tierFor(nius) {
  if (nius >= 85) return "Preferred — bind at preferred terms";
  if (nius >= 70) return "Standard — bind at standard terms";
  if (nius >= 55) return "Standard with conditions — bind with required risk-management conditions and/or rate load";
  if (nius >= 40) return "Substandard — refer to senior underwriter; bind only with substantial mitigants";
  return "Decline — do not bind at current terms";
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

  const nius =
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
    nius: Math.round(nius * 10) / 10,
    tier: tierFor(nius),
    confidence: confidenceFor(completeness),
    completeness: Math.round(completeness * 100) / 100,
    pillars: {
      p1_lossHistoryAndExperience: { weight: PILLAR_WEIGHTS.p1, ...p1 },
      p2_exposureQuality: { weight: PILLAR_WEIGHTS.p2, ...p2 },
      p3_financialStrengthAndMoralHazard: { weight: PILLAR_WEIGHTS.p3, ...p3 },
      p4_riskManagementAndControls: { weight: PILLAR_WEIGHTS.p4, ...p4 },
      p5_coverageAndLimitsAdequacy: { weight: PILLAR_WEIGHTS.p5, ...p5 },
      p6_marketAndPricingContext: { weight: PILLAR_WEIGHTS.p6, ...p6 },
    },
    missingFields: explicitlyMissing,
  };
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`${result.algorithm} v${result.version}`);
  lines.push(`NIUS: ${result.nius} — ${result.tier} (confidence: ${result.confidence}, ${Math.round(result.completeness * 100)}% complete)`);
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
