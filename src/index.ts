#!/usr/bin/env node
/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { Agent } from "./agent";
import { PermissionManager, type ConfirmFn } from "./permissions";
import { printBanner, printError, ConsoleReporter, color } from "./ui";
import { loadLastModel, loadCustomBaseUrl } from "./preferences";
import { loadApiKey, API_KEY_PROVIDERS, type ApiKeyProvider } from "./apiKeys";
import { describeActiveBackend } from "./secretStore";
import { listSessions } from "./session";
import { DEFAULT_MODEL } from "./types";
import type { LlmConfig, LlmProvider } from "./types";

// Last-resort safety net: modern Node terminates the whole process on an
// unhandled rejection by default, which would otherwise let one bad tool
// call or API response take down the entire session/server.
process.on("unhandledRejection", (reason) => {
  printError(`Unhandled error (recovered): ${reason instanceof Error ? reason.message : String(reason)}`);
});
process.on("uncaughtException", (err) => {
  printError(`Unexpected error (recovered): ${err.message ?? err}`);
});

const API_KEY_ENV: Record<LlmProvider, string | null> = {
  pollinations: null,
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  mistral: "MISTRAL_API_KEY",
  custom: null, // optional for "custom" — many local model servers need none
};

interface CliOptions {
  root: string;
  llmConfig: LlmConfig;
  yolo: boolean;
  web: boolean;
  port: number;
  lan: boolean;
}

async function parseArgs(argv: string[]): Promise<CliOptions> {
  let provider: LlmProvider = (process.env.AGENT_PROVIDER as LlmProvider) || "pollinations";
  let model: string | undefined = process.env.AGENT_MODEL;
  let apiKey: string | undefined;
  let baseUrl: string | undefined = process.env.AGENT_BASE_URL;

  const options: CliOptions = {
    root: process.cwd(),
    llmConfig: { provider, model: DEFAULT_MODEL[provider] },
    yolo: false,
    web: false,
    port: 4390,
    lan: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd") {
      options.root = path.resolve(argv[++i] ?? ".");
    } else if (arg === "--model") {
      model = argv[++i];
    } else if (arg === "--provider") {
      const value = argv[++i];
      if (value === "pollinations" || API_KEY_PROVIDERS.includes(value as ApiKeyProvider)) provider = value as LlmProvider;
    } else if (arg === "--api-key") {
      apiKey = argv[++i];
    } else if (arg === "--base-url") {
      baseUrl = argv[++i];
    } else if (arg === "--yolo") {
      options.yolo = true;
    } else if (arg === "--web") {
      options.web = true;
    } else if (arg === "--port") {
      options.port = Number(argv[++i]) || options.port;
    } else if (arg === "--lan") {
      options.lan = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  const envVar = API_KEY_ENV[provider];
  if (!apiKey && envVar) apiKey = process.env[envVar];
  // Explicit --api-key, then the env var, then whatever was saved via the web UI's Settings > API Keys tab.
  if (!apiKey && API_KEY_PROVIDERS.includes(provider as ApiKeyProvider)) apiKey = (await loadApiKey(provider as ApiKeyProvider)) ?? undefined;

  // Explicit --model/env wins; otherwise fall back to whatever was last
  // chosen for this provider via the web UI's model picker, then the
  // hardcoded default.
  const resolvedModel = model || loadLastModel(provider) || DEFAULT_MODEL[provider];
  // Same fallback chain for "custom"'s endpoint: explicit --base-url/env wins, else whatever was saved via the
  // web UI's Settings > API Keys > Custom / Local Model row.
  if (provider === "custom" && !baseUrl) baseUrl = loadCustomBaseUrl() ?? undefined;
  options.llmConfig = { provider, model: resolvedModel, apiKey, baseUrl: provider === "custom" ? baseUrl : undefined };
  return options;
}

function printHelp(): void {
  console.log(`Wrexlyn — free AI coding agent, created by Nishant Prabhakar

Usage: agent [options]

Options:
  --cwd <path>      Working directory the agent may read/write (default: current directory)
  --provider <name> "pollinations" (default, free, no key, but tool-calling requires a paid account as of 2026-07),
                    "groq", "openrouter", "gemini", "cerebras", "mistral" (all free tier, need an API key), or
                    "custom" (any OpenAI-compatible chat-completions API — a provider not listed here, or a local
                    model server like Ollama/LM Studio/llama.cpp; needs --base-url, --api-key is optional)
  --model <name>    Model to use (default depends on --provider — see DEFAULT_MODEL in index.ts, or just omit this
                    and pick a model from the web UI's model picker)
  --api-key <key>   API key for the chosen --provider (or set GROQ_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY /
                    CEREBRAS_API_KEY / MISTRAL_API_KEY, or save one once via the web UI's Settings > API Keys tab)
  --base-url <url>  Full chat-completions endpoint URL for --provider custom, e.g.
                    http://localhost:11434/v1/chat/completions (Ollama) or http://localhost:1234/v1/chat/completions
                    (LM Studio). Or set AGENT_BASE_URL, or save one via Settings > API Keys > Custom / Local Model.
  --yolo            Auto-approve all file writes / edits / shell commands (dangerous)
  --web             Serve the web UI instead of the terminal REPL
  --port <n>        Port for the web UI (default: 4390)
  --lan             Bind the web UI to all network interfaces so another device (e.g. a phone) on the same
                    network can reach it (default: local-only, bound to 127.0.0.1). Every connection — local
                    or LAN — still requires the auth token printed at startup, or a paired QR-code link.
  --help            Show this help
`);
}

async function main(): Promise<void> {
  const options = await parseArgs(process.argv.slice(2));

  if (!fs.existsSync(options.root) || !fs.statSync(options.root).isDirectory()) {
    printError(`Working directory does not exist: ${options.root}`);
    process.exit(1);
  }

  const envVar = API_KEY_ENV[options.llmConfig.provider];
  if (envVar && !options.llmConfig.apiKey && !options.web) {
    // The web UI can't be reached to fix this without starting first — the CLI REPL has no such fallback,
    // so failing fast here with a clear message beats a confusing runtime error on the first message.
    printError(`--provider ${options.llmConfig.provider} requires an API key: pass --api-key or set ${envVar}.`);
    process.exit(1);
  }
  if (options.llmConfig.provider === "custom" && !options.llmConfig.baseUrl && !options.web) {
    printError(`--provider custom requires an endpoint: pass --base-url, set AGENT_BASE_URL, or configure one via the web UI's Settings > API Keys > Custom / Local Model first.`);
    process.exit(1);
  }

  if (options.web) {
    const { startWebServer } = await import("./web/server");
    startWebServer(options.root, options.llmConfig, options.yolo, options.port, options.lan);
    return;
  }

  await runRepl(options);
}

async function runRepl(options: CliOptions): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, resolve));

  const confirmFn: ConfirmFn = async (toolName, label, risk, preview) => {
    if (preview) console.log(color.dim(preview));
    const riskTag = risk === "high" ? " " + color.red("[HIGH RISK — this cannot become an 'always allow']") : "";
    const alwaysOption = risk === "high" ? "" : " / [a]lways";
    const answer = (await ask(`Allow "${label}"?${riskTag} [y]es${alwaysOption} for ${toolName} / [n]o: `))
      .trim()
      .toLowerCase();
    if (risk !== "high" && (answer === "a" || answer === "always")) return "always";
    if (answer === "y" || answer === "yes") return "once";
    return "deny";
  };

  const permissions = new PermissionManager(options.yolo, confirmFn);
  const reporter = new ConsoleReporter();
  let agent = new Agent(options.root, options.llmConfig, permissions, reporter);
  agent.connectMcp().catch((err) => printError(`MCP connect error: ${err.message ?? err}`));
  agent.replayCurrentState();

  printBanner(options.root, `${options.llmConfig.provider} · ${options.llmConfig.model}`);
  console.log(`API key storage: ${await describeActiveBackend()}\n`);
  if (options.yolo) {
    console.log("(yolo mode: all actions auto-approved)\n");
  }

  const promptLoop = () => {
    rl.question("you> ", async (input) => {
      const line = input.trim();

      if (line === "/exit" || line === "/quit") {
        await agent.dispose();
        rl.close();
        return;
      }
      if (line === "/reset" || line === "/new") {
        agent.startNewSession();
        console.log("(started a new chat)\n");
        promptLoop();
        return;
      }
      if (line === "/sessions") {
        const sessions = listSessions(options.root);
        if (!sessions.length) {
          console.log("(no saved chats yet)\n");
        } else {
          for (const s of sessions) {
            const marker = s.id === agent.getSessionId() ? color.cyan("* ") : "  ";
            console.log(`${marker}${color.dim(s.id)}  ${s.title}`);
          }
          console.log("");
        }
        promptLoop();
        return;
      }
      if (line.startsWith("/switch")) {
        const id = line.slice(7).trim();
        if (id) {
          agent.switchSession(id);
          agent.replayCurrentState();
          console.log(`(switched to chat "${agent.getSessionTitle()}")\n`);
        } else {
          console.log("(usage: /switch <session-id> — see /sessions for ids)\n");
        }
        promptLoop();
        return;
      }
      if (line.startsWith("/cwd")) {
        const target = line.slice(4).trim();
        if (target) {
          const resolved = path.resolve(target);
          if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
            await agent.dispose();
            options.root = resolved;
            agent = new Agent(options.root, options.llmConfig, permissions, reporter);
            agent.connectMcp().catch((err) => printError(`MCP connect error: ${err.message ?? err}`));
            agent.replayCurrentState();
            console.log(`(working directory set to ${resolved})\n`);
          } else {
            console.log(`(no such directory: ${resolved})\n`);
          }
        } else {
          console.log(`(current working directory: ${options.root})\n`);
        }
        promptLoop();
        return;
      }
      if (line.startsWith("/mcp-auth")) {
        const server = line.slice("/mcp-auth".length).trim();
        if (!server) {
          console.log("(usage: /mcp-auth <server-name> — see mcp.json for configured server names)\n");
        } else {
          console.log(`(connecting to "${server}" — if sign-in is needed, a browser window will open)`);
          const result = await agent.authorizeMcpServer(server, (url) => {
            console.log(`(if a browser didn't open automatically, sign in here: ${url})`);
          });
          console.log(`(${result.ok ? "" : "failed: "}${result.message})\n`);
        }
        promptLoop();
        return;
      }
      if (line.startsWith("/parallel")) {
        const rest = line.slice("/parallel".length).trim();
        const match = rest.match(/^(\d+)\s+([\s\S]+)$/);
        if (!match) {
          console.log("(usage: /parallel <n> <task text> — n must be 2-4)\n");
          promptLoop();
          return;
        }
        const n = Math.max(2, Math.min(4, parseInt(match[1], 10)));
        const task = match[2];
        console.log(`(starting ${n} isolated attempts — each auto-approves its own actions in its own worktree)\n`);
        try {
          await agent.startParallelRun(task, n, (attemptIndex, event) => {
            if (event.type === "tool_call") {
              console.log(color.dim(`  [attempt ${attemptIndex + 1}] ${event.label || event.name}`));
            } else if (event.type === "transaction_summary") {
              console.log(color.dim(`  [attempt ${attemptIndex + 1}] outcome: ${event.outcome} (confidence ${event.confidence})`));
            }
          });
          const status = agent.getParallelRunStatus();
          if (!status || !status.attempts.length) {
            console.log("(no attempts to show)\n");
          } else {
            console.log("\nResults:");
            for (const a of status.attempts) {
              const detail =
                a.status === "done"
                  ? `outcome: ${a.outcome}, confidence: ${a.confidence}, ${a.changedFileCount ?? 0} file(s) changed`
                  : a.status === "error"
                    ? `error: ${a.errorMessage}`
                    : "still running";
              console.log(`  ${a.index + 1}. ${a.steeringNote} — ${detail}`);
            }
            const pick = (await ask("\nType 1-N to merge that attempt, or 'skip' to discard all: ")).trim();
            const idx = parseInt(pick, 10) - 1;
            if (!isNaN(idx) && status.attempts.some((a) => a.index === idx)) {
              const result = await agent.pickParallelRunAttempt(idx);
              console.log(`(${result.ok ? "" : "failed: "}${result.message})\n`);
            } else {
              await agent.cancelParallelRun();
              console.log("(discarded all attempts)\n");
            }
          }
        } catch (err: any) {
          console.log(`(${err.message ?? err})\n`);
        }
        promptLoop();
        return;
      }
      if (!line) {
        promptLoop();
        return;
      }

      await agent.handleUserMessage(line);
      promptLoop();
    });
  };

  promptLoop();
}

main().catch((err) => {
  printError(err.message ?? String(err));
  process.exit(1);
});
