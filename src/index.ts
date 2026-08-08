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
import { loadLastModel } from "./preferences";
import { listSessions } from "./session";
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

const DEFAULT_MODEL: Record<LlmProvider, string> = {
  pollinations: "openai",
  groq: "llama-3.3-70b-versatile",
  openrouter: "inclusionai/ling-3.0-flash:free",
};

const API_KEY_ENV: Record<LlmProvider, string | null> = {
  pollinations: null,
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

interface CliOptions {
  root: string;
  llmConfig: LlmConfig;
  yolo: boolean;
  web: boolean;
  port: number;
}

function parseArgs(argv: string[]): CliOptions {
  let provider: LlmProvider = (process.env.AGENT_PROVIDER as LlmProvider) || "pollinations";
  let model: string | undefined = process.env.AGENT_MODEL;
  let apiKey: string | undefined;

  const options: CliOptions = {
    root: process.cwd(),
    llmConfig: { provider, model: DEFAULT_MODEL[provider] },
    yolo: false,
    web: false,
    port: 4390,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd") {
      options.root = path.resolve(argv[++i] ?? ".");
    } else if (arg === "--model") {
      model = argv[++i];
    } else if (arg === "--provider") {
      const value = argv[++i];
      if (value === "pollinations" || value === "groq" || value === "openrouter") provider = value;
    } else if (arg === "--api-key") {
      apiKey = argv[++i];
    } else if (arg === "--yolo") {
      options.yolo = true;
    } else if (arg === "--web") {
      options.web = true;
    } else if (arg === "--port") {
      options.port = Number(argv[++i]) || options.port;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  const envVar = API_KEY_ENV[provider];
  if (!apiKey && envVar) apiKey = process.env[envVar];

  // Explicit --model/env wins; otherwise fall back to whatever was last
  // chosen for this provider via the web UI's model picker, then the
  // hardcoded default.
  const resolvedModel = model || loadLastModel(provider) || DEFAULT_MODEL[provider];
  options.llmConfig = { provider, model: resolvedModel, apiKey };
  return options;
}

function printHelp(): void {
  console.log(`coding-agent — free AI coding agent

Usage: agent [options]

Options:
  --cwd <path>      Working directory the agent may read/write (default: current directory)
  --provider <name> "pollinations" (default, free, no key, but tool-calling requires a paid account as of 2026-07),
                    "groq", or "openrouter" (both free tier, need an API key, stronger models)
  --model <name>    Model to use (default: "openai" for pollinations, "llama-3.3-70b-versatile" for groq,
                    "inclusionai/ling-3.0-flash:free" for openrouter)
  --api-key <key>   API key for --provider groq/openrouter (or set GROQ_API_KEY / OPENROUTER_API_KEY)
  --yolo            Auto-approve all file writes / edits / shell commands (dangerous)
  --web             Serve the web UI instead of the terminal REPL
  --port <n>        Port for the web UI (default: 4390)
  --help            Show this help
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(options.root) || !fs.statSync(options.root).isDirectory()) {
    printError(`Working directory does not exist: ${options.root}`);
    process.exit(1);
  }

  const envVar = API_KEY_ENV[options.llmConfig.provider];
  if (envVar && !options.llmConfig.apiKey) {
    printError(`--provider ${options.llmConfig.provider} requires an API key: pass --api-key or set ${envVar}.`);
    process.exit(1);
  }

  if (options.web) {
    const { startWebServer } = await import("./web/server");
    startWebServer(options.root, options.llmConfig, options.yolo, options.port);
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
