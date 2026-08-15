#!/usr/bin/env node
/**
 * Nishant Vendor Risk Score (NVRS) — reference implementation, v1.0.
 * Developed by Nishant Prabhakar.
 *
 * This is a literal implementation of reference/algorithm.md. If you change a
 * weight or formula here, bump the version and update that document too —
 * they must never drift apart.
 *
 * Convention: higher NVRS = lower risk / safer vendor (same convention as
 * this library's credit-risk-analysis NCRS — a high score is the vendor
 * equivalent of an investment-grade rating, not a high-risk warning).
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

const ALGORITHM_NAME = "Nishant Vendor Risk Score (NVRS)";
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

/** Reversed Likert: for rubrics where a HIGHER value means MORE exposure/
 * criticality (worse). Used only for P1a, P1b, P5a — see algorithm.md section 5. */
function reverseLikertToScore(value) {
  return likertToScore(6 - value);
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
  // Conservative (worst-case) fallbacks: assume maximal sensitivity/breadth when unknown.
  const sensitivity = read("dataAccess.dataSensitivityRubric", 5);
  const breadth = read("dataAccess.accessBreadthRubric", 5);

  const a = reverseLikertToScore(sensitivity);
  const b = reverseLikertToScore(breadth);

  const score = 0.55 * a + 0.45 * b;
  return { score, subScores: { dataSensitivity: a, accessBreadth: b }, flags: [] };
}

function scoreP2(input, missing) {
  const read = makeReader(input, missing, "P2");
  const certStatus = read("securityPosture.certificationStatusRubric", 1);
  const monthsSinceCert = read("securityPosture.monthsSinceLastCertAudit", 36);
  const monthsSincePentest = read("securityPosture.monthsSincePentest", 36);

  const securityPosture = input.securityPosture || {};
  const incidentFlags = securityPosture.confirmedIncidentFlags;
  const incidentCount = Array.isArray(incidentFlags) ? incidentFlags.length : 0;

  const a = likertToScore(certStatus);
  const b = lerp(monthsSinceCert, [
    [0, 100],
    [6, 90],
    [12, 75],
    [18, 55],
    [24, 35],
    [36, 10],
  ]);
  const c = lerp(monthsSincePentest, [
    [0, 100],
    [6, 90],
    [12, 70],
    [18, 50],
    [24, 30],
    [36, 10],
  ]);
  const d = clamp(100 - incidentCount * 20, 0, 100);

  const score = 0.3 * a + 0.2 * b + 0.25 * c + 0.25 * d;
  return {
    score,
    subScores: { certificationStatus: a, certAuditRecency: b, pentestRecency: c, incidentHistory: d },
    flags: Array.isArray(incidentFlags) ? incidentFlags : [],
  };
}

function scoreP3(input, missing) {
  const read = makeReader(input, missing, "P3");
  const bcpDr = read("businessContinuity.bcpDrMaturityRubric", 1);
  const slaUptime = read("businessContinuity.slaUptimeCommitmentPct", 95);
  const slaBreaches = read("businessContinuity.slaBreachesTrailing12moCount", 6);
  const financialStability = read("businessContinuity.financialStabilityRubric", 1);

  const a = likertToScore(bcpDr);
  const b = lerp(slaUptime, [
    [95, 10],
    [99.0, 30],
    [99.5, 55],
    [99.9, 80],
    [99.95, 90],
    [99.99, 100],
  ]);
  const c = lerp(slaBreaches, [
    [0, 100],
    [1, 75],
    [2, 50],
    [3, 30],
    [4, 15],
    [6, 5],
  ]);
  const d = likertToScore(financialStability);

  const score = 0.3 * a + 0.2 * b + 0.25 * c + 0.25 * d;
  return {
    score,
    subScores: { bcpDrMaturity: a, slaUptimeCommitment: b, slaTrackRecord: c, financialStability: d },
    flags: [],
  };
}

function scoreP4(input, missing) {
  const read = makeReader(input, missing, "P4");
  const dpaAdequacy = read("contractualCompliance.dpaAdequacyRubric", 1);
  const breachNotifHours = read("contractualCompliance.breachNotificationSlaHours", 336);
  const auditSubprocessor = read("contractualCompliance.auditSubprocessorGovernanceRubric", 1);

  const contractualCompliance = input.contractualCompliance || {};
  const gapFlags = contractualCompliance.regulatoryGapFlags;
  const gapCount = Array.isArray(gapFlags) ? gapFlags.length : 0;

  const a = likertToScore(dpaAdequacy);
  const b = lerp(breachNotifHours, [
    [24, 100],
    [48, 80],
    [72, 60],
    [120, 35],
    [168, 15],
    [336, 5],
  ]);
  const c = likertToScore(auditSubprocessor);
  const d = clamp(100 - gapCount * 20, 0, 100);

  const score = 0.3 * a + 0.25 * b + 0.25 * c + 0.2 * d;
  return {
    score,
    subScores: { dpaAdequacy: a, breachNotificationSla: b, auditSubprocessorGovernance: c, regulatoryScopeAlignment: d },
    flags: Array.isArray(gapFlags) ? gapFlags : [],
  };
}

function scoreP5(input, missing) {
  const read = makeReader(input, missing, "P5");
  // Conservative (worst-case) fallbacks: assume max criticality, no exit path, no redundancy.
  const criticality = read("concentrationCriticality.businessCriticalityRubric", 5);
  const exitFeasibility = read("concentrationCriticality.exitAlternativeFeasibilityRubric", 1);
  const redundancy = read("concentrationCriticality.redundancySpofRubric", 1);

  const a = reverseLikertToScore(criticality);
  const b = likertToScore(exitFeasibility);
  const c = likertToScore(redundancy);

  const score = 0.4 * a + 0.35 * b + 0.25 * c;
  return { score, subScores: { businessCriticality: a, exitAlternativeFeasibility: b, redundancy: c }, flags: [] };
}

function scoreP6(input, missing) {
  const read = makeReader(input, missing, "P6");
  const responsiveness = read("monitoringRemediation.questionnaireResponsivenessRubric", 1);
  const timeToRemediate = read("monitoringRemediation.avgTimeToRemediateDays", 365);
  const cadence = read("monitoringRemediation.monitoringCadenceRubric", 1);

  const monitoringRemediation = input.monitoringRemediation || {};
  const overdueFlags = monitoringRemediation.openOverdueFindingFlags;
  const overdueCount = Array.isArray(overdueFlags) ? overdueFlags.length : 0;

  const a = likertToScore(responsiveness);
  const b = lerp(timeToRemediate, [
    [7, 100],
    [30, 80],
    [60, 60],
    [90, 40],
    [180, 20],
    [365, 5],
  ]);
  const c = likertToScore(cadence);
  const d = clamp(100 - overdueCount * 15, 0, 100);

  const score = 0.25 * a + 0.3 * b + 0.25 * c + 0.2 * d;
  return {
    score,
    subScores: { responsiveness: a, timeToRemediate: b, monitoringCadence: c, openOverdueFindings: d },
    flags: Array.isArray(overdueFlags) ? overdueFlags : [],
  };
}

const PILLAR_WEIGHTS = { p1: 0.2, p2: 0.2, p3: 0.15, p4: 0.15, p5: 0.15, p6: 0.15 };

// Core fields required unconditionally, for the completeness denominator.
// Kept in sync manually with the read() calls above — see algorithm.md section 6.
// Three fields are opt-in flag arrays (confirmedIncidentFlags, regulatoryGapFlags,
// openOverdueFindingFlags) and are NOT included here — they default to "nothing
// found" when omitted, by design, and never count against completeness.
const REQUIRED_FIELDS = [
  "dataAccess.dataSensitivityRubric",
  "dataAccess.accessBreadthRubric",
  "securityPosture.certificationStatusRubric",
  "securityPosture.monthsSinceLastCertAudit",
  "securityPosture.monthsSincePentest",
  "businessContinuity.bcpDrMaturityRubric",
  "businessContinuity.slaUptimeCommitmentPct",
  "businessContinuity.slaBreachesTrailing12moCount",
  "businessContinuity.financialStabilityRubric",
  "contractualCompliance.dpaAdequacyRubric",
  "contractualCompliance.breachNotificationSlaHours",
  "contractualCompliance.auditSubprocessorGovernanceRubric",
  "concentrationCriticality.businessCriticalityRubric",
  "concentrationCriticality.exitAlternativeFeasibilityRubric",
  "concentrationCriticality.redundancySpofRubric",
  "monitoringRemediation.questionnaireResponsivenessRubric",
  "monitoringRemediation.avgTimeToRemediateDays",
  "monitoringRemediation.monitoringCadenceRubric",
];

function getByPath(obj, path) {
  return path.split(".").reduce((v, p) => (v == null ? undefined : v[p]), obj);
}

function tierFor(score) {
  if (score >= 85) return { tier: "Tier 1 — Low Risk", implication: "Standard onboarding; standard annual reassessment cadence; no compensating controls required beyond baseline contract terms" };
  if (score >= 70) return { tier: "Tier 2 — Moderate Risk", implication: "Standard onboarding with minor compensating controls targeted at the weakest pillar; annual reassessment" };
  if (score >= 50) return { tier: "Tier 3 — Elevated Risk", implication: "Enhanced due diligence and negotiated compensating controls required before onboarding/renewal; semi-annual reassessment; sign-off from business owner and security/GRC required" };
  if (score >= 30) return { tier: "Tier 4 — High Risk", implication: "Onboarding/renewal requires security-leadership or GRC-committee sign-off; mandatory compensating controls before go-live; quarterly reassessment" };
  return { tier: "Tier 5 — Critical Risk", implication: "No-go recommended absent extraordinary compensating controls; if proceeding, requires executive/board-level risk acceptance, continuous monitoring, a binding remediation plan, and a documented exit plan" };
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

  const nvrs =
    PILLAR_WEIGHTS.p1 * p1.score +
    PILLAR_WEIGHTS.p2 * p2.score +
    PILLAR_WEIGHTS.p3 * p3.score +
    PILLAR_WEIGHTS.p4 * p4.score +
    PILLAR_WEIGHTS.p5 * p5.score +
    PILLAR_WEIGHTS.p6 * p6.score;

  const explicitlyMissing = REQUIRED_FIELDS.filter((f) => MISSING.has(getByPath(input, f)));
  const totalRequiredFields = REQUIRED_FIELDS.length;

  const completeness = 1 - explicitlyMissing.length / totalRequiredFields;
  const tierInfo = tierFor(nvrs);

  return {
    algorithm: ALGORITHM_NAME,
    version: ALGORITHM_VERSION,
    nvrs: Math.round(nvrs * 10) / 10,
    tier: tierInfo.tier,
    implication: tierInfo.implication,
    confidence: confidenceFor(completeness),
    completeness: Math.round(completeness * 100) / 100,
    pillars: {
      p1_dataAccessAndSensitivity: { weight: PILLAR_WEIGHTS.p1, ...p1 },
      p2_securityPostureAndCertifications: { weight: PILLAR_WEIGHTS.p2, ...p2 },
      p3_businessContinuityAndResilience: { weight: PILLAR_WEIGHTS.p3, ...p3 },
      p4_contractualAndComplianceControls: { weight: PILLAR_WEIGHTS.p4, ...p4 },
      p5_concentrationAndCriticality: { weight: PILLAR_WEIGHTS.p5, ...p5 },
      p6_monitoringAndRemediationTrackRecord: { weight: PILLAR_WEIGHTS.p6, ...p6 },
    },
    missingFields: explicitlyMissing,
  };
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`${result.algorithm} v${result.version}`);
  lines.push(
    `NVRS: ${result.nvrs} — ${result.tier} (confidence: ${result.confidence}, ${Math.round(result.completeness * 100)}% complete)`
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
