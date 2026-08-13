/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Pure derivation of a transaction's outcome from its accumulated VerificationContract. No I/O, no
 * model calls — a deterministic function of evidence already collected by verification.ts,
 * documentQuality.ts (via ToolQualityGateResult), and critic.ts. Kept separate from agent.ts so it's
 * unit-testable without an Agent, an LLM, or a filesystem.
 */
import type { TransactionOutcome, VerificationContract, VerificationCheckEntry } from "./types";

export interface DerivedOutcome {
  outcome: TransactionOutcome;
  /** The outcome-based score before convergence.ts's repair-round/NCP adjustment (see computeConvergenceScore). */
  confidenceBase: number;
}

/** deterministic + quality_gate checks are "authoritative": objective, non-LLM evidence. critic is not — it's an independent LLM opinion, real signal but not proof the same way a build/test run is. */
function isAuthoritative(c: VerificationCheckEntry): boolean {
  return c.source === "deterministic" || c.source === "quality_gate";
}

/**
 * `mutatingHappened`/`allDenied`/`forced` describe what *actions* were taken this turn, not the
 * quality of the evidence about them, so they short-circuit before the contract is even inspected —
 * same preconditions finalizeTransaction() has always checked first.
 *
 * The confidence-base ladder below is intentionally NOT monotonic in one place: a critic-only
 * failure (55) scores below a plain "nothing ran" unverified (60). That's deliberate — the model is
 * always asked to fix a failing critique immediately, in the same turn; reaching finalizeTransaction()
 * with an unresolved critic failure still on the books is a known, reported problem the model didn't
 * (or couldn't) clear, which is worse than having no signal about the turn at all.
 */
export function deriveOutcome(
  contract: VerificationContract,
  mutatingHappened: boolean,
  allDenied: boolean,
  forced?: TransactionOutcome
): DerivedOutcome {
  if (forced && mutatingHappened) return { outcome: forced, confidenceBase: 40 };
  if (!mutatingHappened) return { outcome: "no_changes", confidenceBase: 100 };
  if (allDenied) return { outcome: "blocked", confidenceBase: 20 };

  const authoritative = contract.checks.filter(isAuthoritative);
  const critic = contract.checks.filter((c) => c.source === "critic");

  const ranAuthoritative = authoritative.length > 0;
  const authoritativePassed = authoritative.filter((c) => c.ok).length;
  const authoritativeFailed = authoritative.length - authoritativePassed;
  const ranCritic = critic.length > 0;
  const criticFailed = critic.some((c) => !c.ok);

  if (ranAuthoritative && authoritativeFailed > 0 && authoritativePassed === 0) {
    // every applicable deterministic/quality check failed — no passing check offsets it.
    return { outcome: "failed", confidenceBase: 40 };
  }
  if (ranAuthoritative && authoritativeFailed > 0) {
    // some passed, some failed in the same turn — a real mixed result, not a clean pass or a total loss.
    return { outcome: "partially_verified", confidenceBase: 65 };
  }
  if (ranAuthoritative && criticFailed) {
    // every deterministic/quality check passed, but the independent reviewer still flagged a concern.
    return { outcome: "partially_verified", confidenceBase: 70 };
  }
  if (ranAuthoritative) {
    const ranTest = authoritative.some((c) => /^test/i.test(c.name));
    return { outcome: "verified", confidenceBase: ranTest ? 100 : 90 };
  }
  // No deterministic/quality check was applicable this turn — critic is the only possible signal.
  if (ranCritic && !criticFailed) {
    return { outcome: "reviewed", confidenceBase: 80 };
  }
  if (ranCritic) {
    return { outcome: "partially_verified", confidenceBase: 55 };
  }
  return { outcome: "unverified", confidenceBase: 60 };
}
