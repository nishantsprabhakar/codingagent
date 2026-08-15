#!/usr/bin/env node
/**
 * Nishant Project Finance Score (NPFS) — reference implementation, v1.0.
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
 * missing/"unknown" values and conditional (N/A) fields are handled.
 */

"use strict";

const fs = require("fs");

const ALGORITHM_NAME = "Nishant Project Finance Score (NPFS)";
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
  const minDscr = read("dscr.minDscr", 0);
  const avgDscr = read("dscr.avgDscr", 0);

  const a = lerp(minDscr, [
    [1.0, 0],
    [1.1, 20],
    [1.2, 45],
    [1.3, 65],
    [1.5, 85],
    [1.75, 95],
    [2.0, 100],
  ]);
  const b = lerp(avgDscr, [
    [1.1, 0],
    [1.3, 30],
    [1.5, 55],
    [1.75, 75],
    [2.0, 90],
    [2.5, 100],
  ]);

  const score = 0.6 * a + 0.4 * b;
  return { score, subScores: { minDscr: a, avgDscr: b }, flags: [] };
}

function scoreP2(input, missing) {
  const read = makeReader(input, missing, "P2");
  const contractedPct = read("revenue.contractedRevenuePct", 0);
  const offtakerRubric = read("revenue.offtakerCreditQualityRubric", 3);

  const a = lerp(contractedPct, [
    [0, 10],
    [25, 30],
    [50, 50],
    [75, 75],
    [90, 90],
    [100, 100],
  ]);
  const b = likertToScore(offtakerRubric);

  const score = 0.6 * a + 0.4 * b;
  return { score, subScores: { contractedRevenuePct: a, offtakerCreditQuality: b }, flags: [] };
}

function scoreP3(input, missing) {
  const construction = input.construction || {};
  const isOperational = construction.isOperational === true;

  if (isOperational) {
    // Past completion: no completion risk remains. Neutral full score, not a
    // penalty and not missing data — mirrors NCRS's treatment of the cash
    // runway modifier and the unsecured-collateral case. See algorithm.md
    // section 4, P3.
    return {
      score: 100,
      subScores: { epcContractQuality: null, contingencyAdequacy: null, sponsorCompletionSupport: null },
      flags: ["operational_no_completion_risk"],
    };
  }

  const read = makeReader(input, missing, "P3");
  const epcRubric = read("construction.epcContractQualityRubric", 3);
  const contingencyPct = read("construction.contingencyPctOfHardCost", 0);
  const completionSupportRubric = read("construction.sponsorCompletionSupportRubric", 3);

  const a = likertToScore(epcRubric);
  const b = lerp(contingencyPct, [
    [0, 10],
    [5, 40],
    [10, 70],
    [15, 90],
    [20, 100],
  ]);
  const c = likertToScore(completionSupportRubric);

  const score = 0.4 * a + 0.3 * b + 0.3 * c;
  return { score, subScores: { epcContractQuality: a, contingencyAdequacy: b, sponsorCompletionSupport: c }, flags: [] };
}

function scoreP4(input, missing) {
  const read = makeReader(input, missing, "P4");
  const omRubric = read("operating.omContractQualityRubric", 3);
  const techRubric = read("operating.technologyTrackRecordRubric", 3);

  const operating = input.operating || {};
  const hasVolumeRisk = operating.hasMaterialResourceOrVolumeRisk === true;

  const a = likertToScore(omRubric);
  const b = likertToScore(techRubric);

  let c = 100; // default: no material resource/volume risk, neutral full score
  const flags = [];
  if (hasVolumeRisk) {
    flags.push("material_resource_or_volume_risk_applied");
    let cov = operating.resourceVolumeCoV;
    if (MISSING.has(cov)) {
      missing.push("P4: operating.resourceVolumeCoV (required because material resource/volume risk flagged)");
      cov = 0.5;
    }
    c = lerp(cov, [
      [0.0, 100],
      [0.05, 85],
      [0.1, 65],
      [0.2, 40],
      [0.35, 15],
    ]);
  }

  const score = 0.35 * a + 0.3 * b + 0.35 * c;
  return { score, subScores: { omContractQuality: a, technologyTrackRecord: b, resourceVolumeRisk: c }, flags };
}

function scoreP5(input, missing) {
  const read = makeReader(input, missing, "P5");
  const sponsorRubric = read("sponsor.sponsorExperienceCreditRubric", 3);
  const dsraMonths = read("sponsor.dsraMonthsCoverage", 0);
  const covenantRubric = read("sponsor.covenantPackageRubric", 3);

  const a = likertToScore(sponsorRubric);
  const b = lerp(dsraMonths, [
    [0, 10],
    [3, 40],
    [6, 65],
    [9, 85],
    [12, 100],
  ]);
  const c = likertToScore(covenantRubric);

  const score = 0.35 * a + 0.3 * b + 0.35 * c;
  return { score, subScores: { sponsorExperienceCredit: a, dsraCoverage: b, covenantPackage: c }, flags: [] };
}

function scoreP6(input, missing) {
  const read = makeReader(input, missing, "P6");
  const jurisdictionRubric = read("regulatory.jurisdictionRiskRubric", 3);
  const permittingRubric = read("regulatory.permittingStatusRubric", 3);
  const forceMajeureRubric = read("regulatory.forceMajeureProtectionRubric", 3);

  const a = likertToScore(jurisdictionRubric);
  const b = likertToScore(permittingRubric);
  const c = likertToScore(forceMajeureRubric);

  const score = 0.4 * a + 0.3 * b + 0.3 * c;
  return { score, subScores: { jurisdictionRisk: a, permittingStatus: b, forceMajeureProtection: c }, flags: [] };
}

const PILLAR_WEIGHTS = { p1: 0.3, p2: 0.2, p3: 0.15, p4: 0.15, p5: 0.12, p6: 0.08 };

// Unconditionally required fields, for the completeness denominator. Kept in
// sync manually with the read() calls above — see algorithm.md section 6.
// Three construction fields are required only if the project is NOT yet
// operational, and operating.resourceVolumeCoV is required only if material
// resource/volume risk is flagged — both are added to the denominator
// dynamically in computeScore() below, rather than listed here unconditionally.
const REQUIRED_FIELDS = [
  "dscr.minDscr",
  "dscr.avgDscr",
  "revenue.contractedRevenuePct",
  "revenue.offtakerCreditQualityRubric",
  "operating.omContractQualityRubric",
  "operating.technologyTrackRecordRubric",
  "sponsor.sponsorExperienceCreditRubric",
  "sponsor.dsraMonthsCoverage",
  "sponsor.covenantPackageRubric",
  "regulatory.jurisdictionRiskRubric",
  "regulatory.permittingStatusRubric",
  "regulatory.forceMajeureProtectionRubric",
];

function getByPath(obj, path) {
  return path.split(".").reduce((v, p) => (v == null ? undefined : v[p]), obj);
}

function ratingBandFor(score) {
  if (score >= 85)
    return {
      band: "AA/A-equivalent (Strong Investment Grade)",
      indicativeSpreadBpsOverBenchmark: "100-175",
      financingFeasibility: "Fully bankable; institutional (pension/insurance) long-tenor debt at tight pricing, high leverage achievable",
    };
  if (score >= 70)
    return {
      band: "BBB-equivalent (Investment Grade)",
      indicativeSpreadBpsOverBenchmark: "175-275",
      financingFeasibility: "Bankable on standard project-finance bank/institutional debt at market-standard leverage and tenor",
    };
  if (score >= 50)
    return {
      band: "BB/B-equivalent (Sub-Investment Grade)",
      indicativeSpreadBpsOverBenchmark: "275-450",
      financingFeasibility: "Financeable with tighter structuring (higher DSRA, lower leverage, shorter tenor, added guarantees); club deal or ECA/DFI support may be needed",
    };
  if (score >= 30)
    return {
      band: "CCC-equivalent (Weak)",
      indicativeSpreadBpsOverBenchmark: "450-750",
      financingFeasibility: "Difficult on a pure non-recourse project-finance basis; likely needs sponsor recourse, credit enhancement (ECA/MLA/DFI guarantee), or restructuring before close",
    };
  return {
    band: "CC/C-equivalent (Distressed)",
    indicativeSpreadBpsOverBenchmark: "750-1500+",
    financingFeasibility: "Not financeable as structured; restructure, recapitalize, or abandon",
  };
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

  const npfs =
    PILLAR_WEIGHTS.p1 * p1.score +
    PILLAR_WEIGHTS.p2 * p2.score +
    PILLAR_WEIGHTS.p3 * p3.score +
    PILLAR_WEIGHTS.p4 * p4.score +
    PILLAR_WEIGHTS.p5 * p5.score +
    PILLAR_WEIGHTS.p6 * p6.score;

  const construction = input.construction || {};
  const operating = input.operating || {};
  const isOperational = construction.isOperational === true;
  const hasVolumeRisk = operating.hasMaterialResourceOrVolumeRisk === true;

  let explicitlyMissing = REQUIRED_FIELDS.filter((f) => MISSING.has(getByPath(input, f)));
  let totalRequiredFields = REQUIRED_FIELDS.length;

  if (!isOperational) {
    totalRequiredFields += 3;
    if (MISSING.has(construction.epcContractQualityRubric)) explicitlyMissing.push("construction.epcContractQualityRubric");
    if (MISSING.has(construction.contingencyPctOfHardCost)) explicitlyMissing.push("construction.contingencyPctOfHardCost");
    if (MISSING.has(construction.sponsorCompletionSupportRubric)) explicitlyMissing.push("construction.sponsorCompletionSupportRubric");
  }
  if (hasVolumeRisk) {
    totalRequiredFields += 1;
    if (MISSING.has(operating.resourceVolumeCoV)) explicitlyMissing.push("operating.resourceVolumeCoV");
  }

  const completeness = 1 - explicitlyMissing.length / totalRequiredFields;
  const rating = ratingBandFor(npfs);

  return {
    algorithm: ALGORITHM_NAME,
    version: ALGORITHM_VERSION,
    npfs: Math.round(npfs * 10) / 10,
    ratingBand: rating.band,
    indicativeSpreadBpsOverBenchmark: rating.indicativeSpreadBpsOverBenchmark,
    financingFeasibility: rating.financingFeasibility,
    confidence: confidenceFor(completeness),
    completeness: Math.round(completeness * 100) / 100,
    pillars: {
      p1_dscrProfile: { weight: PILLAR_WEIGHTS.p1, ...p1 },
      p2_revenueOfftakeCertainty: { weight: PILLAR_WEIGHTS.p2, ...p2 },
      p3_constructionCompletionRisk: { weight: PILLAR_WEIGHTS.p3, ...p3 },
      p4_operatingRisk: { weight: PILLAR_WEIGHTS.p4, ...p4 },
      p5_sponsorAndStructureQuality: { weight: PILLAR_WEIGHTS.p5, ...p5 },
      p6_regulatoryAndPoliticalRisk: { weight: PILLAR_WEIGHTS.p6, ...p6 },
    },
    missingFields: explicitlyMissing,
  };
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`${result.algorithm} v${result.version}`);
  lines.push(
    `NPFS: ${result.npfs} — ${result.ratingBand} (indicative spread: +${result.indicativeSpreadBpsOverBenchmark} bps over benchmark; confidence: ${result.confidence}, ${Math.round(result.completeness * 100)}% complete)`
  );
  lines.push(`Financing feasibility: ${result.financingFeasibility}`);
  lines.push("");
  for (const [key, pillar] of Object.entries(result.pillars)) {
    lines.push(`${key}  weight=${pillar.weight}  score=${Math.round(pillar.score * 10) / 10}`);
    for (const [sub, val] of Object.entries(pillar.subScores)) {
      lines.push(`  - ${sub}: ${val === null ? "n/a" : Math.round(val * 10) / 10}`);
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
