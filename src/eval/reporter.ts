/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * A headless Reporter for eval runs -- no-ops for everything except the two signals the harness
 * actually needs: the final transactionSummary (the realistic outcome/confidence) and error() (the
 * only signal distinguishing an infra-level failure from a genuine "the model made no changes"
 * no-op, since transactionSummary never fires for either the no-op or an early-turn forced failure --
 * see docs/architecture/2026-08-phase13-eval-harness.md).
 */
import type { Reporter, TaskItem, HistoryItem, VerificationResult, TransactionOutcome } from "../types";

export interface EvalCapturedResult {
  outcome: TransactionOutcome;
  confidence: number;
  transactionId: string | null;
  errorMessage: string | null;
}

/** Starts as the sentinel a genuine no-op turn would leave in place -- never left `undefined`. */
export function freshCapturedResult(): EvalCapturedResult {
  return { outcome: "no_changes", confidence: 100, transactionId: null, errorMessage: null };
}

export class EvalReporter implements Reporter {
  constructor(private captured: EvalCapturedResult, private onProgress?: (line: string) => void) {}

  toolCall(_id: string, name: string, label: string): void {
    this.onProgress?.(`  ${label || name}`);
  }
  toolResult(): void {}
  error(text: string): void {
    this.captured.errorMessage = text;
  }
  thinking(): void {}
  tasks(_tasks: TaskItem[]): void {}
  history(_items: HistoryItem[]): void {}
  files(_files: string[]): void {}
  assistantDelta(): void {}
  assistantDeltaEnd(): void {}
  verification(_result: VerificationResult): void {}
  critique(): void {}
  transactionSummary(transactionId: string, confidence: number, outcome: TransactionOutcome): void {
    this.captured.transactionId = transactionId;
    this.captured.confidence = confidence;
    this.captured.outcome = outcome;
  }
}
