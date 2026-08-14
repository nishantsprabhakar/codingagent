/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import * as path from "path";
import type { EvalReport } from "./types";

export function writeReportJson(report: EvalReport, resultsDir: string): string {
  fs.mkdirSync(resultsDir, { recursive: true });
  const filePath = path.join(resultsDir, `${report.generatedAt}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf-8");
  return filePath;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function formatReportTable(report: EvalReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`Wrexlyn eval report — ${report.provider} · ${report.model}, ${report.repeats} repeat(s) per task`);
  lines.push(`${report.taskCount} task(s), ${report.totalRuns} run(s) total`);
  lines.push("");
  lines.push(
    `  Required-check (deterministic test) pass rate: ${pct(report.deterministicPassRate)}   ` +
      `Verified rate: ${pct(report.verifiedRate)}   Reproducibility: ${pct(report.reproducibilityRate)}`
  );
  lines.push("");
  lines.push("  Task                          Difficulty  Pass    Verified  Reproducible");
  lines.push("  ----                          ----------  ----    --------  ------------");
  for (const t of report.tasks) {
    const name = t.title.length > 28 ? t.title.slice(0, 27) + "…" : t.title.padEnd(29);
    lines.push(
      `  ${name.padEnd(30)}${t.difficulty.padEnd(12)}${`${t.passCount}/${t.repeats}`.padEnd(8)}${`${t.verifiedCount}/${t.repeats}`.padEnd(10)}${t.reproducible ? "yes" : "no"}`
    );
  }
  lines.push("");
  return lines.join("\n");
}
