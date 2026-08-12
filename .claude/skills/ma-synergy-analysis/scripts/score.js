#!/usr/bin/env node
/**
 * Nishant M&A Synergy & Integration Score (NMSI) — reference implementation, v1.0.
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

const ALGORITHM_NAME = "Nishant M&A Synergy & Integration Score (NMSI)";
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
  const claimedRevenueSynergy = read("revenueSynergy.claimedAnnualRevenueSynergy", 0);
  const targetRevenue = read("revenueSynergy.targetStandaloneRevenue", 0);
  const adjacencyRubric = read("revenueSynergy.marketAdjacencyRubric", 3);
  const priorCaptureRate = read("revenueSynergy.priorDealsRevenueSynergyCaptureRatePct", 50);

  const pct = targetRevenue > 0 ? (claimedRevenueSynergy / targetRevenue) * 100 : 0;
  const a = lerp(pct, [
    [0, 50],
    [3, 75],
    [6, 90],
    [12, 60],
    [20, 30],
    [30, 10],
  ]);
  const b = likertToScore(adjacencyRubric);
  const c = clamp(priorCaptureRate, 0, 100);

  const score = 0.4 * a + 0.35 * b + 0.25 * c;
  return {
    score,
    subScores: { revenueSynergyPctOfTargetRevenue: a, marketAdjacencyCredibility: b, priorDealCaptureRate: c },
    flags: [],
  };
}

function scoreP2(input, missing) {
  const read = makeReader(input, missing, "P2");
  const claimedCostSynergy = read("costSynergy.claimedAnnualCostSynergy", 0);
  const targetCostBase = read("costSynergy.targetCostBase", 0);
  const itemizedCoveragePct = read("costSynergy.itemizedSynergyCoveragePct", 0);
  const thirdPartyValidated = input.costSynergy ? !!input.costSynergy.thirdPartyValidated : false;
  const overlapPct = read("costSynergy.headcountOrFacilitiesOverlapPct", 0);

  const pct = targetCostBase > 0 ? (claimedCostSynergy / targetCostBase) * 100 : 0;
  const a = lerp(pct, [
    [0, 40],
    [5, 70],
    [12, 90],
    [20, 70],
    [35, 40],
    [50, 10],
  ]);
  let b = clamp(itemizedCoveragePct, 0, 100);
  if (thirdPartyValidated) b = clamp(b + 10, 0, 100);
  const c = lerp(overlapPct, [
    [0, 30],
    [10, 55],
    [20, 75],
    [35, 90],
    [50, 100],
  ]);

  const score = 0.35 * a + 0.4 * b + 0.25 * c;
  return {
    score,
    subScores: { costSynergyPctOfCostBase: a, itemizedCoverage: b, overlapMagnitude: c },
    flags: thirdPartyValidated ? ["third_party_validated"] : [],
  };
}

function scoreP3(input, missing) {
  const read = makeReader(input, missing, "P3");
  const retentionCoveragePct = read("culturalFit.keyLeaderRetentionCoveragePct", 0);
  const trackRecord = read("culturalFit.acquirerIntegrationTrackRecord", "adhoc");
  const culturalDistanceRubric = read("culturalFit.culturalDistanceRubric", 3);

  const a = clamp(retentionCoveragePct, 0, 100);
  const trackRecordMap = { none: 30, adhoc: 50, dedicated_pmi: 75, dedicated_pmi_plus_advisor: 95 };
  const b = trackRecordMap[trackRecord] ?? 50;
  const c = likertToScore(culturalDistanceRubric);

  const score = 0.35 * a + 0.3 * b + 0.35 * c;
  return {
    score,
    subScores: { keyLeaderRetentionCoverage: a, acquirerIntegrationTrackRecord: b, culturalDistance: c },
    flags: [],
  };
}

function scoreP4(input, missing) {
  const read = makeReader(input, missing, "P4");
  const dealValue = read("integrationComplexity.dealValue", 0);
  const acquirerEnterpriseValue = read("integrationComplexity.acquirerEnterpriseValue", dealValue > 0 ? dealValue / 0.15 : 1);
  const systemsComplexityRubric = read("integrationComplexity.systemsIntegrationComplexityRubric", 3);
  const regulatoryComplexityRubric = read("integrationComplexity.regulatoryAntitrustComplexityRubric", 3);

  const pct = acquirerEnterpriseValue > 0 ? (dealValue / acquirerEnterpriseValue) * 100 : 15;
  const a = lerp(pct, [
    [5, 95],
    [15, 75],
    [30, 50],
    [50, 25],
    [75, 10],
  ]);
  const b = likertToScore(systemsComplexityRubric);
  const c = likertToScore(regulatoryComplexityRubric);

  const score = 0.35 * a + 0.35 * b + 0.3 * c;
  return {
    score,
    subScores: { relativeDealSize: a, systemsIntegrationComplexity: b, regulatoryAntitrustComplexity: c },
    flags: [],
  };
}

function scoreP5(input, missing) {
  const read = makeReader(input, missing, "P5");
  const dealMultiple = read("dealStructure.entryEvEbitdaMultiple", 0);
  const comparableMedianMultiple = read("dealStructure.comparableTransactionMedianMultiple", dealMultiple || 1);
  const leverage = read("dealStructure.proFormaNetDebtToEbitda", 0);
  const sectorMedianLeverage = read("dealStructure.sectorMedianLeverage", leverage);
  const earnoutRubric = read("dealStructure.earnoutStructureQualityRubric", 3);

  const premiumPct = comparableMedianMultiple ? (dealMultiple - comparableMedianMultiple) / comparableMedianMultiple : 0;
  const a = clamp(70 - premiumPct * 100, 0, 100);
  const b = clamp(100 - Math.max(0, leverage - sectorMedianLeverage) * 15, 0, 100);
  const c = likertToScore(earnoutRubric);

  const score = 0.4 * a + 0.3 * b + 0.3 * c;
  return {
    score,
    subScores: { entryMultipleVsComps: a, proFormaLeverage: b, earnoutStructureQuality: c },
    flags: [],
  };
}

function scoreP6(input, missing) {
  const read = makeReader(input, missing, "P6");
  const imoQuality = read("governance.imoQuality", "adhoc");
  const workstreams = read("governance.day1Day100EvidencedWorkstreams", []);
  const retentionDesignRubric = read("governance.retentionPackageDesignQualityRubric", 3);

  const imoMap = { none: 30, adhoc: 50, dedicated_imo: 75, dedicated_imo_plus_advisor: 95 };
  const a = imoMap[imoQuality] ?? 50;

  const workstreamCount = Array.isArray(workstreams) ? workstreams.length : Number(workstreams) || 0;
  let b;
  if (workstreamCount >= 5) b = 90;
  else if (workstreamCount >= 3) b = 70;
  else if (workstreamCount >= 1) b = 45;
  else b = 20;

  const c = likertToScore(retentionDesignRubric);

  const score = 0.4 * a + 0.35 * b + 0.25 * c;
  return {
    score,
    subScores: { imoQuality: a, day1Day100PlanSpecificity: b, retentionPackageDesignQuality: c },
    flags: [],
  };
}

const PILLAR_WEIGHTS = { p1: 0.2, p2: 0.2, p3: 0.15, p4: 0.2, p5: 0.15, p6: 0.1 };

// Every field any pillar's reader touches, for the completeness denominator.
// Kept in sync manually with the read() calls above — see algorithm.md section 6.
const REQUIRED_FIELDS = [
  "revenueSynergy.claimedAnnualRevenueSynergy",
  "revenueSynergy.targetStandaloneRevenue",
  "revenueSynergy.marketAdjacencyRubric",
  "revenueSynergy.priorDealsRevenueSynergyCaptureRatePct",
  "costSynergy.claimedAnnualCostSynergy",
  "costSynergy.targetCostBase",
  "costSynergy.itemizedSynergyCoveragePct",
  "costSynergy.headcountOrFacilitiesOverlapPct",
  "culturalFit.keyLeaderRetentionCoveragePct",
  "culturalFit.acquirerIntegrationTrackRecord",
  "culturalFit.culturalDistanceRubric",
  "integrationComplexity.dealValue",
  "integrationComplexity.acquirerEnterpriseValue",
  "integrationComplexity.systemsIntegrationComplexityRubric",
  "integrationComplexity.regulatoryAntitrustComplexityRubric",
  "dealStructure.entryEvEbitdaMultiple",
  "dealStructure.comparableTransactionMedianMultiple",
  "dealStructure.proFormaNetDebtToEbitda",
  "dealStructure.sectorMedianLeverage",
  "dealStructure.earnoutStructureQualityRubric",
  "governance.imoQuality",
  "governance.day1Day100EvidencedWorkstreams",
  "governance.retentionPackageDesignQualityRubric",
];

function getByPath(obj, path) {
  return path.split(".").reduce((v, p) => (v == null ? undefined : v[p]), obj);
}

function tierFor(nmsi) {
  if (nmsi >= 80) return "High-conviction synergy case";
  if (nmsi >= 65) return "Credible, but verify weak links";
  if (nmsi >= 50) return "Conditional — proceed only with mitigants";
  if (nmsi >= 35) return "Weak — synergy case needs rework";
  return "Synergy math likely won't materialize";
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

  const nmsi =
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
    nmsi: Math.round(nmsi * 10) / 10,
    tier: tierFor(nmsi),
    confidence: confidenceFor(completeness),
    completeness: Math.round(completeness * 100) / 100,
    pillars: {
      p1_revenueSynergyRealism: { weight: PILLAR_WEIGHTS.p1, ...p1 },
      p2_costSynergyRealism: { weight: PILLAR_WEIGHTS.p2, ...p2 },
      p3_culturalAndOrganizationalFit: { weight: PILLAR_WEIGHTS.p3, ...p3 },
      p4_integrationComplexity: { weight: PILLAR_WEIGHTS.p4, ...p4 },
      p5_valuationAndDealStructureDiscipline: { weight: PILLAR_WEIGHTS.p5, ...p5 },
      p6_executionGovernance: { weight: PILLAR_WEIGHTS.p6, ...p6 },
    },
    missingFields: explicitlyMissing,
  };
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`${result.algorithm} v${result.version}`);
  lines.push(`NMSI: ${result.nmsi} — ${result.tier} (confidence: ${result.confidence}, ${Math.round(result.completeness * 100)}% complete)`);
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
