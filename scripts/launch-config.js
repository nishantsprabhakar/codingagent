#!/usr/bin/env node
/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Interactive first-run setup for the Linux/macOS launcher (scripts/launch.sh) —
 * the terminal equivalent of launch.ps1's folder-picker/API-key dialogs on
 * Windows. Prompts go to stderr; the last thing printed to stdout is a set of
 * `KEY='value'` lines the calling shell script sources via `eval`.
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const root = path.join(__dirname, "..");
const configPath = path.join(root, "agent.config.json");

const args = process.argv.slice(2);
const resetFolder = args.includes("--reset-folder");
const resetApiKey = args.includes("--reset-api-key");

function loadConfig() {
  if (!fs.existsSync(configPath)) return { folder: null, provider: null, apiKey: undefined };
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    let apiKey = raw.apiKey;
    let provider = raw.provider ?? null;
    // Back-compat with the older groqApiKey-only config field (matches launch.ps1).
    if (apiKey === undefined && raw.groqApiKey !== undefined) {
      apiKey = raw.groqApiKey;
      provider = raw.groqApiKey ? "groq" : "";
    }
    return { folder: raw.folder ?? null, provider, apiKey };
  } catch {
    return { folder: null, provider: null, apiKey: undefined };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

// Deliberately not using rl.question() for this: calling it more than once
// against non-TTY/piped stdin (a redirected file, a pipe from another
// process) is unreliable in Node — the second call's callback can simply
// never fire, since it depends on internal line-buffering state left over
// from the first call. Pulling lines from the interface's async iterator
// instead works uniformly whether stdin is a real terminal or piped input.
const rl = readline.createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();

async function ask(query) {
  process.stderr.write(query);
  const { value, done } = await lines.next();
  return done ? "" : value;
}

async function main() {
  const config = loadConfig();
  if (resetFolder) config.folder = null;
  if (resetApiKey) {
    config.apiKey = undefined;
    config.provider = null;
  }

  while (!config.folder || !fs.existsSync(config.folder) || !fs.statSync(config.folder).isDirectory()) {
    console.error("Choose which folder the agent should work on.");
    const answer = (await ask("Project folder path: ")).trim();
    if (!answer) {
      console.error("A folder is required.\n");
      continue;
    }
    const resolved = path.resolve(answer);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      config.folder = resolved;
    } else {
      console.error(`Folder not found: ${resolved}\n`);
    }
  }

  if (config.apiKey === undefined) {
    console.error("");
    console.error(
      "Optional upgrade: the default free model (Pollinations) is small, and as of mid-2026 no longer " +
        "supports the tool-calling this agent depends on for free. Paste a free API key below from either:"
    );
    console.error("  Groq: https://console.groq.com/keys");
    console.error("  OpenRouter: https://openrouter.ai/keys");
    console.error("Leave this blank and press Enter to skip (re-run with --reset-api-key later to add one).");
    const key = (await ask("API key (or press Enter to skip): ")).trim();
    config.apiKey = key;
    config.provider = key.startsWith("sk-or-v1-") ? "openrouter" : key ? "groq" : "";
  }

  saveConfig(config);

  const shellQuote = (s) => `'${String(s ?? "").replace(/'/g, "'\\''")}'`;
  process.stdout.write(`FOLDER=${shellQuote(config.folder)}\n`);
  process.stdout.write(`PROVIDER=${shellQuote(config.provider || "")}\n`);
  process.stdout.write(`APIKEY=${shellQuote(config.apiKey || "")}\n`);
}

main()
  .catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    process.exitCode = 1;
  })
  .finally(() => rl.close());
