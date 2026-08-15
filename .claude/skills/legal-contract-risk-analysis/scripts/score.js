#!/usr/bin/env node
/**
 * Nishant Legal Risk Score (NLRS) — reference implementation, v1.0.
 * Developed by Nishant Prabhakar.
 *
 * Scores an enterprise B2B SaaS subscription/services agreement from the
 * customer's (licensee's) side, for pre-signature legal risk triage.
 *
 * This tool assists legal risk triage. It is NOT legal advice, does NOT
 * replace attorney review of the actual contract, and must NEVER be the
 * sole basis for a sign/no-sign decision on a material contract.
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

const ALGORITHM_NAME = "Nishant Legal Risk Score (NLRS)";
const ALGORITHM_VERSION = "1.0";
const NOT_LEGAL_ADVICE_NOTICE =
  "This tool assists legal risk triage. It is NOT legal advice, does NOT replace attorney review of the actual contract, and must NEVER be the sole basis for a sign/no-sign decision on a material contract.";

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

const CARVE_OUT_CATEGORIES = [
  "ip_infringement",
  "gross_negligence_willful_misconduct",
  "confidentiality_breach",
  "data_breach_security_incident",
  "indemnification_obligations",
];

function scoreP1(input, missing) {
  const read = makeReader(input, missing, "P1");
  const capMultiple = read("liabilityIndemnification.liabilityCapMultipleOfACV", 0);
  const carveOuts = read("liabilityIndemnification.carveOutsFromCap", []);
  const mutualityRubric = read("liabilityIndemnification.indemnificationMutualityRubric", 3);

  const a =
    capMultiple === "uncapped"
      ? 100
      : lerp(Number(capMultiple) || 0, [
          [0, 10],
          [0.5, 30],
          [1, 55],
          [2, 75],
          [3, 90],
          [5, 100],
        ]);

  const carveOutList = Array.isArray(carveOuts) ? carveOuts : [];
  const matchedCount = CARVE_OUT_CATEGORIES.filter((c) => carveOutList.includes(c)).length;
  const b = (matchedCount / CARVE_OUT_CATEGORIES.length) * 100;

  const c = likertToScore(mutualityRubric);

  const score = 0.4 * a + 0.35 * b + 0.25 * c;
  return {
    score,
    subScores: { liabilityCapLevel: a, capCarveOutCoverage: b, indemnificationMutuality: c },
    flags: [],
  };
}

function scoreP2(input, missing) {
  const read = makeReader(input, missing, "P2");
  const customerCanTerminateForConvenience = read("terminationExit.customerTerminationForConvenience", false);
  const noticeDays = read("terminationExit.customerTerminationNoticeDays", 90);
  const cureDays = read("terminationExit.terminationForCauseCureDays", 45);
  const windDownRubric = read("terminationExit.postTerminationObligationsRubric", 3);

  const a = customerCanTerminateForConvenience
    ? lerp(Number(noticeDays) || 0, [
        [0, 100],
        [30, 90],
        [60, 75],
        [90, 60],
        [180, 40],
      ])
    : 30;

  const b = lerp(Number(cureDays) || 0, [
    [0, 100],
    [15, 85],
    [30, 70],
    [45, 55],
    [60, 40],
    [90, 20],
  ]);

  const c = likertToScore(windDownRubric);

  const score = 0.35 * a + 0.3 * b + 0.35 * c;
  return {
    score,
    subScores: { terminationForConvenience: a, terminationForCauseCurePeriod: b, postTerminationWindDown: c },
    flags: [],
  };
}

function scoreP3(input, missing) {
  const read = makeReader(input, missing, "P3");
  const ipOwnershipRubric = read("ipConfidentiality.ipOwnershipClarityRubric", 3);
  const licenseScopeRubric = read("ipConfidentiality.licenseScopeRubric", 3);
  const confidentialityTermYears = read("ipConfidentiality.confidentialityTermYears", 0);
  const carveOutsPresent = read("ipConfidentiality.standardConfidentialityCarveOutsPresent", false);

  const a = likertToScore(ipOwnershipRubric);
  const b = likertToScore(licenseScopeRubric);

  let c =
    confidentialityTermYears === "perpetual"
      ? 100
      : lerp(Number(confidentialityTermYears) || 0, [
          [0, 20],
          [1, 40],
          [2, 60],
          [3, 75],
          [5, 90],
        ]);
  if (!carveOutsPresent) c = clamp(c - 15, 0, 100);

  const score = 0.4 * a + 0.3 * b + 0.3 * c;
  return {
    score,
    subScores: { ipOwnershipClarity: a, licenseScopeFit: b, confidentialityTerm: c },
    flags: carveOutsPresent ? [] : ["no_standard_confidentiality_carveouts"],
  };
}

const DISPUTE_MECHANISM_MAP = {
  litigation_only: 50,
  arbitration_binding: 75,
  med_arb_tiered: 80,
  arbitration_with_injunctive_relief_carveout: 90,
};

function scoreP4(input, missing) {
  const read = makeReader(input, missing, "P4");
  const mechanism = read("disputeResolution.disputeResolutionMechanism", "litigation_only");
  const venueRubric = read("disputeResolution.venueGoverningLawFavorabilityRubric", 3);
  const waiverMutualityRubric = read("disputeResolution.waiverMutualityRubric", 3);

  const a = DISPUTE_MECHANISM_MAP[mechanism] ?? 50;
  const b = likertToScore(venueRubric);
  const c = likertToScore(waiverMutualityRubric);

  const score = 0.35 * a + 0.35 * b + 0.3 * c;
  return {
    score,
    subScores: { disputeResolutionMechanism: a, venueGoverningLawFavorability: b, waiverMutuality: c },
    flags: [],
  };
}

function scoreP5(input, missing) {
  const read = makeReader(input, missing, "P5");
  const netPaymentDays = read("commercialPerformance.netPaymentDays", 30);
  const slaRubric = read("commercialPerformance.slaRemedySpecificityRubric", 3);
  const priceCapPct = read("commercialPerformance.annualPriceIncreaseCapPct", 10);

  const a = lerp(Number(netPaymentDays) || 0, [
    [15, 40],
    [30, 70],
    [45, 85],
    [60, 95],
    [90, 100],
  ]);
  const b = likertToScore(slaRubric);
  const c =
    priceCapPct === "uncapped"
      ? 15
      : lerp(Number(priceCapPct) || 0, [
          [0, 100],
          [3, 85],
          [5, 70],
          [7, 55],
          [10, 40],
        ]);

  const score = 0.3 * a + 0.4 * b + 0.3 * c;
  return {
    score,
    subScores: { paymentTerms: a, slaRemedySpecificity: b, priceEscalationCap: c },
    flags: [],
  };
}

const FINANCIAL_STABILITY_MAP = {
  financial_distress_signals_present: 15,
  private_early_stage_or_vc_backed: 50,
  private_stable_profitable: 75,
  public_large_cap: 95,
};

const ASSIGNMENT_RESTRICTION_MAP = {
  vendor_can_assign_freely: 20,
  vendor_can_assign_to_affiliate_or_successor_no_consent: 45,
  notice_required_no_consent: 60,
  consent_required_not_unreasonably_withheld: 85,
  consent_required_sole_discretion: 95,
};

function scoreP6(input, missing) {
  const read = makeReader(input, missing, "P6");
  const stabilityTier = read("counterpartyCompliance.counterpartyFinancialStabilityTier", "private_early_stage_or_vc_backed");
  const complianceRubric = read("counterpartyCompliance.complianceRepsAdequacyRubric", 3);
  const assignmentRestriction = read("counterpartyCompliance.assignmentChangeOfControlRestriction", "notice_required_no_consent");

  const a = FINANCIAL_STABILITY_MAP[stabilityTier] ?? 50;
  const b = likertToScore(complianceRubric);
  const c = ASSIGNMENT_RESTRICTION_MAP[assignmentRestriction] ?? 60;

  const score = 0.4 * a + 0.35 * b + 0.25 * c;
  return {
    score,
    subScores: { counterpartyFinancialStability: a, complianceRepsAdequacy: b, assignmentChangeOfControlRestriction: c },
    flags: [],
  };
}

const PILLAR_WEIGHTS = { p1: 0.25, p2: 0.2, p3: 0.15, p4: 0.1, p5: 0.15, p6: 0.15 };

// Every field any pillar's reader touches, for the completeness denominator.
// Kept in sync manually with the read() calls above — see algorithm.md section 6.
const REQUIRED_FIELDS = [
  "liabilityIndemnification.liabilityCapMultipleOfACV",
  "liabilityIndemnification.carveOutsFromCap",
  "liabilityIndemnification.indemnificationMutualityRubric",
  "terminationExit.customerTerminationForConvenience",
  "terminationExit.customerTerminationNoticeDays",
  "terminationExit.terminationForCauseCureDays",
  "terminationExit.postTerminationObligationsRubric",
  "ipConfidentiality.ipOwnershipClarityRubric",
  "ipConfidentiality.licenseScopeRubric",
  "ipConfidentiality.confidentialityTermYears",
  "ipConfidentiality.standardConfidentialityCarveOutsPresent",
  "disputeResolution.disputeResolutionMechanism",
  "disputeResolution.venueGoverningLawFavorabilityRubric",
  "disputeResolution.waiverMutualityRubric",
  "commercialPerformance.netPaymentDays",
  "commercialPerformance.slaRemedySpecificityRubric",
  "commercialPerformance.annualPriceIncreaseCapPct",
  "counterpartyCompliance.counterpartyFinancialStabilityTier",
  "counterpartyCompliance.complianceRepsAdequacyRubric",
  "counterpartyCompliance.assignmentChangeOfControlRestriction",
];

function getByPath(obj, path) {
  return path.split(".").reduce((v, p) => (v == null ? undefined : v[p]), obj);
}

function tierFor(nlrs) {
  if (nlrs >= 80) return "Standard terms — proceed";
  if (nlrs >= 65) return "Acceptable, minor flags — proceed with redlines";
  if (nlrs >= 50) return "Elevated risk — negotiate before signing";
  if (nlrs >= 35) return "High risk — requires escalation";
  return "Severe risk — do not sign without GC/executive sign-off";
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

  const nlrs =
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
    notice: NOT_LEGAL_ADVICE_NOTICE,
    nlrs: Math.round(nlrs * 10) / 10,
    tier: tierFor(nlrs),
    confidence: confidenceFor(completeness),
    completeness: Math.round(completeness * 100) / 100,
    pillars: {
      p1_liabilityAndIndemnificationExposure: { weight: PILLAR_WEIGHTS.p1, ...p1 },
      p2_terminationAndExitRights: { weight: PILLAR_WEIGHTS.p2, ...p2 },
      p3_ipAndConfidentialityTerms: { weight: PILLAR_WEIGHTS.p3, ...p3 },
      p4_disputeResolutionAndGoverningLaw: { weight: PILLAR_WEIGHTS.p4, ...p4 },
      p5_commercialAndPerformanceTerms: { weight: PILLAR_WEIGHTS.p5, ...p5 },
      p6_counterpartyAndComplianceRisk: { weight: PILLAR_WEIGHTS.p6, ...p6 },
    },
    missingFields: explicitlyMissing,
  };
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`${result.algorithm} v${result.version}`);
  lines.push(result.notice);
  lines.push("");
  lines.push(`NLRS: ${result.nlrs} — ${result.tier} (confidence: ${result.confidence}, ${Math.round(result.completeness * 100)}% complete)`);
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
