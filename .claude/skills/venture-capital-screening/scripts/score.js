#!/usr/bin/env node
/**
 * Prabhakar Startup Traction Score (PSTS) — reference implementation, v1.0.
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

const ALGORITHM_NAME = "Prabhakar Startup Traction Score (PSTS)";
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
  const domainExpertise = read("team.domainExpertiseRubric", 3);
  const priorStartupExperience = read("team.priorStartupExperienceRubric", 3);
  const teamCompleteness = read("team.teamCompletenessRubric", 3);

  const teamAvg = (domainExpertise + priorStartupExperience + teamCompleteness) / 3;
  const score = likertToScore(teamAvg);

  return {
    score,
    subScores: {
      domainExpertise: likertToScore(domainExpertise),
      priorStartupExperience: likertToScore(priorStartupExperience),
      teamCompleteness: likertToScore(teamCompleteness),
      teamAverageRubric: teamAvg,
    },
    flags: [],
  };
}

function scoreP2(input, missing) {
  const read = makeReader(input, missing, "P2");
  const tamUsdMillions = read("market.tamUsdMillions", 0);
  const whyNowTiming = read("market.whyNowTimingRubric", 3);

  const a = lerp(tamUsdMillions, [
    [50, 10],
    [100, 20],
    [500, 50],
    [1000, 75],
    [3000, 90],
    [10000, 100],
  ]);
  const b = likertToScore(whyNowTiming);

  const score = 0.55 * a + 0.45 * b;
  return { score, subScores: { tamSize: a, whyNowTiming: b }, flags: [] };
}

function scoreP3(input, missing) {
  const read = makeReader(input, missing, "P3");
  const momGrowthRatePct = read("traction.momGrowthRatePct", 0);
  const retentionCohortQuality = read("traction.retentionCohortQualityRubric", 3);

  const a = lerp(momGrowthRatePct, [
    [0, 15],
    [5, 45],
    [10, 70],
    [15, 90],
    [25, 100],
  ]);
  const b = likertToScore(retentionCohortQuality);

  const score = 0.55 * a + 0.45 * b;
  return { score, subScores: { momGrowth: a, retentionCohortQuality: b }, flags: [] };
}

function scoreP4(input, missing) {
  const read = makeReader(input, missing, "P4");
  const differentiation = read("product.differentiationRubric", 3);
  const score = likertToScore(differentiation);
  return { score, subScores: { productDifferentiation: score }, flags: [] };
}

function scoreP5(input, missing, unitEconDataAvailable) {
  if (!unitEconDataAvailable) {
    // Genuinely too early to have unit economics — neutral, non-penalizing
    // score, and these fields are excluded from the completeness calc
    // entirely (see computeScore / algorithm.md section 6).
    return {
      score: 60,
      subScores: { ltvCacRatio: "n/a", burnMultiple: "n/a" },
      flags: ["unit_economics_not_applicable_pre_revenue"],
    };
  }

  const read = makeReader(input, missing, "P5");
  const ltvCacRatio = read("unitEconomics.ltvCacRatio", 1);
  const burnMultiple = read("unitEconomics.burnMultiple", 2);

  const a = lerp(ltvCacRatio, [
    [0.5, 10],
    [1, 25],
    [2, 55],
    [3, 80],
    [4, 95],
    [5, 100],
  ]);
  const b = lerp(burnMultiple, [
    [0.5, 100],
    [1, 90],
    [1.5, 75],
    [2, 55],
    [3, 35],
    [5, 10],
  ]);

  const score = 0.5 * a + 0.5 * b;
  return { score, subScores: { ltvCacRatio: a, burnMultiple: b }, flags: [] };
}

function scoreP6(input, missing) {
  const read = makeReader(input, missing, "P6");
  const askMultiple = read("roundTerms.askValuationToTractionMultiple", 0);
  const stageBenchmarkMultiple = read("roundTerms.stageBenchmarkMultiple", askMultiple || 1);
  const capTableCleanliness = read("roundTerms.capTableCleanlinessRubric", 3);
  const optionPoolPct = read("roundTerms.optionPoolPct", 0);
  const recommendedPoolPct = read("roundTerms.recommendedOptionPoolPctForStage", optionPoolPct || 1);

  const premiumPct = stageBenchmarkMultiple
    ? (askMultiple - stageBenchmarkMultiple) / stageBenchmarkMultiple
    : 0;
  const a = clamp(70 - premiumPct * 100, 0, 100);
  const b = likertToScore(capTableCleanliness);
  const ratio = recommendedPoolPct ? optionPoolPct / recommendedPoolPct : 0;
  const c = lerp(ratio, [
    [0.4, 15],
    [0.7, 50],
    [1.0, 85],
    [1.25, 100],
  ]);

  const score = 0.4 * a + 0.35 * b + 0.25 * c;
  return {
    score,
    subScores: { valuationReasonableness: a, capTableCleanliness: b, optionPoolAdequacy: c },
    flags: [],
  };
}

const PILLAR_WEIGHTS = { p1: 0.25, p2: 0.2, p3: 0.2, p4: 0.15, p5: 0.1, p6: 0.1 };

// Every field any pillar's reader touches, for the completeness denominator.
// Kept in sync manually with the read() calls above — see algorithm.md section 6.
const REQUIRED_FIELDS = [
  "team.domainExpertiseRubric",
  "team.priorStartupExperienceRubric",
  "team.teamCompletenessRubric",
  "market.tamUsdMillions",
  "market.whyNowTimingRubric",
  "traction.momGrowthRatePct",
  "traction.retentionCohortQualityRubric",
  "product.differentiationRubric",
  "unitEconomics.ltvCacRatio",
  "unitEconomics.burnMultiple",
  "roundTerms.askValuationToTractionMultiple",
  "roundTerms.stageBenchmarkMultiple",
  "roundTerms.capTableCleanlinessRubric",
  "roundTerms.optionPoolPct",
  "roundTerms.recommendedOptionPoolPctForStage",
];

// These two fields are dropped from the completeness denominator entirely
// when unitEconomics.dataAvailable is explicitly false — a pre-revenue
// company that genuinely can't measure these yet shouldn't be penalized on
// completeness for it. See algorithm.md section 6.
const UNIT_ECON_CONDITIONAL_FIELDS = ["unitEconomics.ltvCacRatio", "unitEconomics.burnMultiple"];

function getByPath(obj, path) {
  return path.split(".").reduce((v, p) => (v == null ? undefined : v[p]), obj);
}

function tierFor(psts) {
  if (psts >= 80) return "Fast-track to partner meeting";
  if (psts >= 65) return "Strong — proceed to diligence";
  if (psts >= 50) return "Promising — needs one more data point";
  if (psts >= 35) return "Pass for now — revisit at next milestone";
  return "Pass";
}

function confidenceFor(completeness) {
  if (completeness >= 0.9) return "High";
  if (completeness >= 0.7) return "Medium";
  return "Low";
}

function computeScore(input) {
  const missing = [];
  const unitEconDataAvailable = !(input.unitEconomics && input.unitEconomics.dataAvailable === false);

  const p1 = scoreP1(input, missing);
  const p2 = scoreP2(input, missing);
  const p3 = scoreP3(input, missing);
  const p4 = scoreP4(input, missing);
  const p5 = scoreP5(input, missing, unitEconDataAvailable);
  const p6 = scoreP6(input, missing);

  const psts =
    PILLAR_WEIGHTS.p1 * p1.score +
    PILLAR_WEIGHTS.p2 * p2.score +
    PILLAR_WEIGHTS.p3 * p3.score +
    PILLAR_WEIGHTS.p4 * p4.score +
    PILLAR_WEIGHTS.p5 * p5.score +
    PILLAR_WEIGHTS.p6 * p6.score;

  const effectiveRequiredFields = unitEconDataAvailable
    ? REQUIRED_FIELDS
    : REQUIRED_FIELDS.filter((f) => !UNIT_ECON_CONDITIONAL_FIELDS.includes(f));

  const explicitlyMissing = effectiveRequiredFields.filter((f) => MISSING.has(getByPath(input, f)));
  const completeness = 1 - explicitlyMissing.length / effectiveRequiredFields.length;

  return {
    algorithm: ALGORITHM_NAME,
    version: ALGORITHM_VERSION,
    psts: Math.round(psts * 10) / 10,
    tier: tierFor(psts),
    confidence: confidenceFor(completeness),
    completeness: Math.round(completeness * 100) / 100,
    unitEconomicsDataAvailable: unitEconDataAvailable,
    pillars: {
      p1_founderAndTeamQuality: { weight: PILLAR_WEIGHTS.p1, ...p1 },
      p2_marketOpportunity: { weight: PILLAR_WEIGHTS.p2, ...p2 },
      p3_tractionAndPmfSignals: { weight: PILLAR_WEIGHTS.p3, ...p3 },
      p4_productAndTechDifferentiation: { weight: PILLAR_WEIGHTS.p4, ...p4 },
      p5_unitEconomicsTrajectory: { weight: PILLAR_WEIGHTS.p5, ...p5 },
      p6_roundTermsAndDilution: { weight: PILLAR_WEIGHTS.p6, ...p6 },
    },
    missingFields: explicitlyMissing,
  };
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`${result.algorithm} v${result.version}`);
  lines.push(
    `PSTS: ${result.psts} — ${result.tier} (confidence: ${result.confidence}, ${Math.round(result.completeness * 100)}% complete)`
  );
  if (!result.unitEconomicsDataAvailable) {
    lines.push("Note: unit economics marked not-yet-applicable (pre-revenue) — P5 scored neutral, excluded from completeness denominator.");
  }
  lines.push("");
  for (const [key, pillar] of Object.entries(result.pillars)) {
    lines.push(`${key}  weight=${pillar.weight}  score=${Math.round(pillar.score * 10) / 10}`);
    for (const [sub, val] of Object.entries(pillar.subScores)) {
      const display = typeof val === "number" ? Math.round(val * 10) / 10 : val;
      lines.push(`  - ${sub}: ${display}`);
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
