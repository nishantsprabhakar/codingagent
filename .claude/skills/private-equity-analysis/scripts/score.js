#!/usr/bin/env node
/**
 * Prabhakar Deal Quality Index (PDQI) — reference implementation, v1.0.
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

const ALGORITHM_NAME = "Prabhakar Deal Quality Index (PDQI)";
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
  const revenueCagr = read("financials.revenueCagr3yr", 0);
  const companyMargin = read("financials.ebitdaMargin", 0);
  const sectorMedianMargin = read("financials.sectorMedianEbitdaMargin", companyMargin);
  const marginTrend = read("financials.marginTrendPtsPerYear", 0);
  const recurringPct = read("financials.recurringRevenuePct", 0);
  const avgContractYears = read("financials.avgContractLengthYears", 0);
  const fcfToEbitda = read("financials.fcfToEbitda", 0);
  const ebitdaPositive = read("financials.ebitdaPositive", true);
  const yearsOfData = read("financials.yearsOfHistoricalData", 3);

  const a = lerp(revenueCagr, [
    [0, 10],
    [5, 40],
    [15, 75],
    [30, 95],
    [45, 100],
  ]);
  const hypergrowthGuard = revenueCagr >= 60 && yearsOfData < 2;
  const aEffective = hypergrowthGuard ? Math.min(a, 80) : a;

  const b = clamp(50 + (companyMargin - sectorMedianMargin) * 2, 0, 100);
  const c = clamp(50 + marginTrend * 10, 0, 100);
  let d = clamp(recurringPct, 0, 100);
  if (avgContractYears > 2) d = clamp(d + 10, 0, 100);
  let e = clamp(fcfToEbitda * 100, 0, 100);
  if (ebitdaPositive && fcfToEbitda < 0) e = Math.min(e, 30);

  const score = 0.35 * aEffective + 0.25 * b + 0.15 * c + 0.15 * d + 0.1 * e;
  return {
    score,
    subScores: { revenueCagr: aEffective, marginVsSector: b, marginTrend: c, revenueQuality: d, cashConversion: e },
    flags: hypergrowthGuard ? ["unverified_hypergrowth"] : [],
  };
}

function scoreP2(input, missing) {
  const read = makeReader(input, missing, "P2");
  const dealMultiple = read("valuation.entryMultiple", 0);
  const sectorMedianMultiple = read("valuation.sectorMedianMultiple", dealMultiple || 1);
  const leverage = read("valuation.netDebtToEbitda", 0);
  const sectorMedianLeverage = read("valuation.sectorMedianLeverage", leverage);
  const protections = read("valuation.structuralProtectionsRubric", 3);

  const premiumPct = sectorMedianMultiple ? (dealMultiple - sectorMedianMultiple) / sectorMedianMultiple : 0;
  const a = clamp(70 - premiumPct * 100, 0, 100);
  const b = clamp(100 - Math.max(0, leverage - sectorMedianLeverage) * 15, 0, 100);
  const c = likertToScore(protections);

  const score = 0.5 * a + 0.3 * b + 0.2 * c;
  return { score, subScores: { entryMultiple: a, leverage: b, structuralProtections: c }, flags: [] };
}

function scoreP3(input, missing) {
  const read = makeReader(input, missing, "P3");
  const tamGrowth = read("market.tamGrowthRatePct", 0);
  const shareTrend = read("market.marketShareTrend", "flat");
  const moat = read("market.competitiveMoat", {});
  const switchingCosts = MISSING.has(moat.switchingCosts) ? 3 : moat.switchingCosts;
  const ip = MISSING.has(moat.ip) ? 3 : moat.ip;
  const networkEffects = MISSING.has(moat.networkEffects) ? 3 : moat.networkEffects;
  const brandOrRegulatory = MISSING.has(moat.brandOrRegulatory) ? 3 : moat.brandOrRegulatory;

  const a = lerp(tamGrowth, [
    [0, 20],
    [5, 50],
    [10, 70],
    [20, 90],
    [30, 100],
  ]);
  const shareTrendMap = { losing_materially: 10, losing_slightly: 35, flat: 60, gaining_slightly: 80, gaining_materially: 100 };
  const b = shareTrendMap[shareTrend] ?? 60;
  const moatAvg = (switchingCosts + ip + networkEffects + brandOrRegulatory) / 4;
  const c = likertToScore(moatAvg);

  const score = 0.3 * a + 0.3 * b + 0.4 * c;
  return { score, subScores: { tamGrowth: a, marketShareTrend: b, competitiveMoat: c }, flags: [] };
}

function scoreP4(input, missing) {
  const read = makeReader(input, missing, "P4");
  const priorExits = read("management.priorSuccessfulExits", 0);
  const tenureYears = read("management.tenureYears", 0);
  const insiderOwnership = read("management.insiderOwnershipPctPostDeal", 0);
  const redFlags = read("management.governanceRedFlags", []);

  let a;
  if (priorExits >= 2) a = 95;
  else if (priorExits === 1 || tenureYears >= 5) a = 70;
  else if (tenureYears >= 2) a = 50;
  else a = 30;

  const b = lerp(insiderOwnership, [
    [5, 30],
    [15, 60],
    [30, 85],
    [45, 100],
  ]);

  const flagCount = Array.isArray(redFlags) ? redFlags.length : 0;
  const c = clamp(100 - flagCount * 15, 0, 100);

  const score = 0.4 * a + 0.3 * b + 0.3 * c;
  return { score, subScores: { teamTrackRecord: a, insiderOwnership: b, governance: c }, flags: Array.isArray(redFlags) ? redFlags : [] };
}

function scoreP5(input, missing) {
  const read = makeReader(input, missing, "P5");
  const levers = read("growth.evidencedExpansionLevers", []);
  const exitClarity = read("growth.exitPathClarityRubric", 3);

  const leverCount = Array.isArray(levers) ? levers.length : Number(levers) || 0;
  let a;
  if (leverCount >= 3) a = 90;
  else if (leverCount === 2) a = 70;
  else if (leverCount === 1) a = 45;
  else a = 20;

  const b = likertToScore(exitClarity);

  const score = 0.6 * a + 0.4 * b;
  return { score, subScores: { expansionOptionality: a, exitPathClarity: b }, flags: [] };
}

function scoreP6(input) {
  const risk = input.risk || {};
  const deductions = [];
  let score = 100;

  if (risk.top1CustomerPctOfRevenue > 20) {
    score -= 20;
    deductions.push("top1_customer_concentration");
  }
  if (risk.top3CustomerPctOfRevenue > 50) {
    score -= 15;
    deductions.push("top3_customer_concentration");
  }
  if (risk.materialUnresolvedRegulatoryOrLitigation) {
    score -= 20;
    deductions.push("regulatory_or_litigation");
  }
  if (risk.keyPersonDependencyNoSuccession) {
    score -= 15;
    deductions.push("key_person_dependency");
  }
  if (risk.highCyclicality) {
    score -= 15;
    deductions.push("high_cyclicality");
  }
  if (risk.fxOrGeographicConcentration) {
    score -= 10;
    deductions.push("fx_or_geographic_concentration");
  }

  return { score: clamp(score, 0, 100), subScores: {}, flags: deductions };
}

const PILLAR_WEIGHTS = { p1: 0.25, p2: 0.2, p3: 0.2, p4: 0.15, p5: 0.1, p6: 0.1 };

// Every field any pillar's reader touches, for the completeness denominator.
// Kept in sync manually with the read() calls above — see algorithm.md section 6.
const REQUIRED_FIELDS = [
  "financials.revenueCagr3yr",
  "financials.ebitdaMargin",
  "financials.sectorMedianEbitdaMargin",
  "financials.marginTrendPtsPerYear",
  "financials.recurringRevenuePct",
  "financials.avgContractLengthYears",
  "financials.fcfToEbitda",
  "valuation.entryMultiple",
  "valuation.sectorMedianMultiple",
  "valuation.netDebtToEbitda",
  "valuation.sectorMedianLeverage",
  "valuation.structuralProtectionsRubric",
  "market.tamGrowthRatePct",
  "market.marketShareTrend",
  "market.competitiveMoat.switchingCosts",
  "market.competitiveMoat.ip",
  "market.competitiveMoat.networkEffects",
  "market.competitiveMoat.brandOrRegulatory",
  "management.priorSuccessfulExits",
  "management.tenureYears",
  "management.insiderOwnershipPctPostDeal",
  "growth.evidencedExpansionLevers",
  "growth.exitPathClarityRubric",
];

function getByPath(obj, path) {
  return path.split(".").reduce((v, p) => (v == null ? undefined : v[p]), obj);
}

function tierFor(pdqi) {
  if (pdqi >= 80) return "Strong";
  if (pdqi >= 65) return "Attractive";
  if (pdqi >= 50) return "Conditional";
  if (pdqi >= 35) return "Weak";
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
  const p6 = scoreP6(input);

  const pdqi =
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
    pdqi: Math.round(pdqi * 10) / 10,
    tier: tierFor(pdqi),
    confidence: confidenceFor(completeness),
    completeness: Math.round(completeness * 100) / 100,
    pillars: {
      p1_financialPerformance: { weight: PILLAR_WEIGHTS.p1, ...p1 },
      p2_valuationAndTerms: { weight: PILLAR_WEIGHTS.p2, ...p2 },
      p3_marketAndCompetitivePosition: { weight: PILLAR_WEIGHTS.p3, ...p3 },
      p4_managementAndGovernance: { weight: PILLAR_WEIGHTS.p4, ...p4 },
      p5_growthAndExitPotential: { weight: PILLAR_WEIGHTS.p5, ...p5 },
      p6_riskFactors: { weight: PILLAR_WEIGHTS.p6, ...p6 },
    },
    missingFields: explicitlyMissing,
  };
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`${result.algorithm} v${result.version}`);
  lines.push(`PDQI: ${result.pdqi} — ${result.tier} (confidence: ${result.confidence}, ${Math.round(result.completeness * 100)}% complete)`);
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
