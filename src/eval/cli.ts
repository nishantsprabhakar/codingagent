#!/usr/bin/env node
/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Phase 13 eval CLI: `npm run eval [-- --repeats 3 --filter foo --provider groq --model llama-3.3-70b-versatile --api-key ...]`.
 * Isolates its environment (see runner.ts's isolateEvalEnvironment) before resolving anything else --
 * eval runs never silently inherit the interactive session's stored API keys or global instructions;
 * a run must declare its own provider/model/key (or use the free Kilo default).
 */
import * as path from "path";
import { isolateEvalEnvironment, runAll, buildReport } from "./runner";
import { discoverTasks } from "./tasks";
import { writeReportJson, formatReportTable } from "./report";
import { DEFAULT_MODEL } from "../types";
import type { LlmConfig, LlmProvider } from "../types";

const API_KEY_PROVIDERS: LlmProvider[] = ["groq", "openrouter", "gemini", "cerebras", "mistral"];
const API_KEY_ENV: Partial<Record<LlmProvider, string>> = {
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  mistral: "MISTRAL_API_KEY",
};

function printHelp(): void {
  console.log(`
Wrexlyn eval harness — runs the task corpus under evals/tasks/ through the real agent loop.

Usage: npm run eval -- [options]

Options:
  --tasks-dir <dir>   Directory of task fixtures (default: evals/tasks)
  --repeats <n>       Attempts per task, for reproducibility scoring (default: 3)
  --filter <text>     Only run tasks whose id or title contains this text
  --provider <name>   kilo (default, free, no key) | groq | openrouter | gemini | cerebras | mistral
  --model <name>      Defaults to the provider's own default model
  --api-key <key>     Explicit key -- eval runs never read the OS-backed secret store (isolated by design)
  --help              Show this message
`);
}

async function main(): Promise<void> {
  isolateEvalEnvironment(); // must run before any api-key/env resolution below

  const argv = process.argv.slice(2);
  let tasksDir = path.join(process.cwd(), "evals", "tasks");
  let repeats = 3;
  let filter: string | undefined;
  let provider: LlmProvider = "kilo";
  let model: string | undefined;
  let apiKey: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tasks-dir") tasksDir = path.resolve(argv[++i]);
    else if (arg === "--repeats") repeats = Math.max(1, Number(argv[++i]) || repeats);
    else if (arg === "--filter") filter = argv[++i];
    else if (arg === "--provider") {
      const value = argv[++i];
      if (value === "kilo" || API_KEY_PROVIDERS.includes(value as LlmProvider)) provider = value as LlmProvider;
    } else if (arg === "--model") model = argv[++i];
    else if (arg === "--api-key") apiKey = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    }
  }

  const envVar = API_KEY_ENV[provider];
  if (!apiKey && envVar) apiKey = process.env[envVar];
  if (API_KEY_PROVIDERS.includes(provider) && !apiKey) {
    console.error(`Provider "${provider}" needs an API key -- pass --api-key or set ${envVar}.`);
    process.exit(1);
  }

  const llmConfig: LlmConfig = { provider, model: model ?? DEFAULT_MODEL[provider], apiKey };

  const tasks = discoverTasks(tasksDir);
  if (!tasks.length) {
    console.error(`No tasks found under ${tasksDir}.`);
    process.exit(1);
  }

  const selectedCount = filter ? tasks.filter((t) => t.id.includes(filter) || t.title.includes(filter)).length : tasks.length;
  console.log(`Running ${selectedCount} task(s) × ${repeats} repeat(s) against ${provider} · ${llmConfig.model}...`);
  const results = await runAll(tasks, llmConfig, { repeats, filter, onProgress: (line) => console.log(line) });
  const report = buildReport(tasks, results, provider, llmConfig.model, repeats);

  console.log(formatReportTable(report));
  const resultsDir = path.join(process.cwd(), "evals", "results");
  const filePath = writeReportJson(report, resultsDir);
  console.log(`Full report written to ${filePath}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
