#!/usr/bin/env node
/**
 * Nishant Asset Viability Score (NAVS) — reference implementation, v1.0.
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

const ALGORITHM_NAME = "Nishant Asset Viability Score (NAVS)";
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

// Approximate industry-aggregate probability-of-success base rates by current
// development stage. These are historical averages across the industry, not a
// claim about this specific asset — see algorithm.md section 1 and section 8.
const STAGE_BASE_SCORE = {
  preclinical: 8,
  phase1: 52,
  phase2: 29,
  phase3: 58,
  filed: 90,
};

const MODALITY_ADJUSTMENT = {
  well_precedented: 10,
  novel_no_precedent: -15,
  standard: 0,
};

function scoreP1(input, missing) {
  const read = makeReader(input, missing, "P1");
  const stage = read("clinical.developmentStage", "phase1");
  const modality = read("clinical.modalityPrecedent", "standard");

  const baseStageScore = STAGE_BASE_SCORE[stage] ?? STAGE_BASE_SCORE.phase1;
  const modalityAdjustment = MODALITY_ADJUSTMENT[modality] ?? 0;

  const score = clamp(baseStageScore + modalityAdjustment, 0, 100);
  return {
    score,
    subScores: { baseStageScore, modalityAdjustment },
    flags: [],
  };
}

function scoreP2(input, missing) {
  const read = makeReader(input, missing, "P2");
  const effectSize = read("efficacy.effectSizeRelativePctVsSoc", 0);
  const significant = read("efficacy.statisticallySignificant", false);
  const controlled = read("efficacy.controlledRandomizedDesign", false);

  const raw = lerp(effectSize, [
    [0, 15],
    [15, 45],
    [35, 70],
    [60, 90],
    [90, 100],
  ]);
  const notYetEvidence = !significant || !controlled;
  const score = notYetEvidence ? Math.min(raw, 50) : raw;

  return {
    score,
    subScores: { rawEffectSizeScore: raw, effective: score },
    flags: notYetEvidence ? ["not_statistically_significant_or_uncontrolled"] : [],
  };
}

function scoreP3(input, missing) {
  const read = makeReader(input, missing, "P3");
  const candidateAe = read("safety.candidateGrade3PlusAEsPct", 0);
  const socAe = read("safety.socGrade3PlusAEsPct", candidateAe || 1);

  const ratio = socAe > 0 ? candidateAe / socAe : 1;
  const score = lerp(ratio, [
    [0.25, 95],
    [0.5, 85],
    [0.75, 70],
    [1.0, 55],
    [1.5, 30],
    [2.0, 10],
  ]);

  return { score, subScores: { relativeAeRatio: ratio, safetyScore: score }, flags: [] };
}

function scoreP4(input, missing) {
  const read = makeReader(input, missing, "P4");
  const rubric = read("mechanism.targetValidationRubric", 3);
  const score = likertToScore(rubric);
  return { score, subScores: { targetValidation: score }, flags: [] };
}

function scoreP5(input, missing) {
  const read = makeReader(input, missing, "P5");
  const competitorCount = read("competitive.phase2PlusCompetitorCount", 0);
  const population = read("competitive.addressablePatientPopulation", 0);
  const pricingPowerRubric = read("competitive.pricingPowerRubric", 3);

  const a = lerp(competitorCount, [
    [0, 100],
    [2, 75],
    [5, 50],
    [10, 25],
    [15, 10],
  ]);

  const marketSizeScore = lerp(population, [
    [5000, 60],
    [50000, 75],
    [500000, 90],
    [2000000, 70],
  ]);
  const pricingPowerScore = likertToScore(pricingPowerRubric);
  const b = 0.5 * marketSizeScore + 0.5 * pricingPowerScore;

  const score = 0.4 * a + 0.6 * b;
  return {
    score,
    subScores: {
      competitiveDensity: a,
      marketSizeScore,
      pricingPowerScore,
      populationAndPricingJoint: b,
    },
    flags: [],
  };
}

function scoreP6(input) {
  const designations = input.regulatory?.designationsHeld;
  const patentYears = input.regulatory?.patentRunwayYearsPostLaunch;
  const ipConcern = input.regulatory?.unresolvedIpDisputeOrFtoConcern;

  const designationCount = Array.isArray(designations) ? designations.length : 0;
  const designationBonus = Math.min(30, designationCount * 10);

  let patentModifier;
  if (MISSING.has(patentYears)) {
    patentModifier = 0;
  } else if (patentYears < 5) {
    patentModifier = -20;
  } else if (patentYears <= 10) {
    patentModifier = 0;
  } else {
    patentModifier = 10;
  }

  const ipPenalty = ipConcern ? 25 : 0;

  const score = clamp(60 + designationBonus - ipPenalty + patentModifier, 0, 100);
  const flags = [];
  if (ipConcern) flags.push("unresolved_ip_or_fto_concern");

  return {
    score,
    subScores: { designationBonus, patentModifier, ipPenalty },
    flags,
  };
}

const PILLAR_WEIGHTS = { p1: 0.25, p2: 0.2, p3: 0.15, p4: 0.15, p5: 0.15, p6: 0.1 };

// Every field any pillar's reader touches, for the completeness denominator.
// Kept in sync manually with the read() calls above — see algorithm.md section 6.
const REQUIRED_FIELDS = [
  "clinical.developmentStage",
  "clinical.modalityPrecedent",
  "efficacy.effectSizeRelativePctVsSoc",
  "efficacy.statisticallySignificant",
  "efficacy.controlledRandomizedDesign",
  "safety.candidateGrade3PlusAEsPct",
  "safety.socGrade3PlusAEsPct",
  "mechanism.targetValidationRubric",
  "competitive.phase2PlusCompetitorCount",
  "competitive.addressablePatientPopulation",
  "competitive.pricingPowerRubric",
  "regulatory.designationsHeld",
  "regulatory.patentRunwayYearsPostLaunch",
  "regulatory.unresolvedIpDisputeOrFtoConcern",
];

function getByPath(obj, path) {
  return path.split(".").reduce((v, p) => (v == null ? undefined : v[p]), obj);
}

function tierFor(navs) {
  if (navs >= 80) return "Fast-track";
  if (navs >= 65) return "Advance";
  if (navs >= 50) return "Monitor";
  if (navs >= 35) return "Deprioritize";
  return "Discontinue";
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

  const navs =
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
    navs: Math.round(navs * 10) / 10,
    tier: tierFor(navs),
    confidence: confidenceFor(completeness),
    completeness: Math.round(completeness * 100) / 100,
    pillars: {
      p1_clinicalStageAndPos: { weight: PILLAR_WEIGHTS.p1, ...p1 },
      p2_efficacySignalStrength: { weight: PILLAR_WEIGHTS.p2, ...p2 },
      p3_safetyAndTolerability: { weight: PILLAR_WEIGHTS.p3, ...p3 },
      p4_targetMechanismValidation: { weight: PILLAR_WEIGHTS.p4, ...p4 },
      p5_competitiveAndCommercialPosition: { weight: PILLAR_WEIGHTS.p5, ...p5 },
      p6_regulatoryAndIpRisk: { weight: PILLAR_WEIGHTS.p6, ...p6 },
    },
    missingFields: explicitlyMissing,
  };
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`${result.algorithm} v${result.version}`);
  lines.push(`NAVS: ${result.navs} — ${result.tier} (confidence: ${result.confidence}, ${Math.round(result.completeness * 100)}% complete)`);
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
