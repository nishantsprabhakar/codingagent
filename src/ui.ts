/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { Reporter, TaskItem, HistoryItem } from "./types";

const CODES = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function wrap(code: string, text: string): string {
  return `${code}${text}${CODES.reset}`;
}

export const color = {
  dim: (s: string) => wrap(CODES.dim, s),
  bold: (s: string) => wrap(CODES.bold, s),
  red: (s: string) => wrap(CODES.red, s),
  green: (s: string) => wrap(CODES.green, s),
  yellow: (s: string) => wrap(CODES.yellow, s),
  blue: (s: string) => wrap(CODES.blue, s),
  magenta: (s: string) => wrap(CODES.magenta, s),
  cyan: (s: string) => wrap(CODES.cyan, s),
};

export function printBanner(root: string, model: string): void {
  console.log(color.bold(color.cyan("\nWrexlyn")) + color.dim(" — free AI coding agent"));
  console.log(color.dim(`root: ${root}`));
  console.log(color.dim(`model: ${model}`));
  console.log(color.dim("commands: /new  /sessions  /switch <id>  /cwd <path>  /exit\n"));
}

export function printToolCall(label: string): void {
  console.log(color.magenta(`\n> ${label}`));
}

export function printToolResult(output: string, ok: boolean): void {
  const lines = output.split("\n");
  const preview = lines.length > 25 ? lines.slice(0, 25).join("\n") + `\n${color.dim(`... (${lines.length - 25} more lines)`)}` : output;
  console.log(colorizeDiffish(preview, ok));
}

/** Lightly colorizes unified-diff-style +/- prefixed lines produced by fs tool previews. */
function colorizeDiffish(text: string, ok: boolean): string {
  return text
    .split("\n")
    .map((line) => {
      if (line.startsWith("+")) return color.green(line);
      if (line.startsWith("-")) return color.red(line);
      return ok ? color.dim(line) : color.red(line);
    })
    .join("\n");
}

export function printAssistantPrefix(): void {
  process.stdout.write(color.bold(color.blue("\nagent> ")));
}

export function printError(text: string): void {
  console.error(color.red(`error: ${text}`));
}

const TASK_GLYPH: Record<TaskItem["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
};

export function printTasks(tasks: TaskItem[]): void {
  if (!tasks.length) return;
  console.log(color.bold("\ntasks:"));
  for (const t of tasks) {
    const glyph = t.status === "completed" ? color.green(TASK_GLYPH[t.status]) : color.dim(TASK_GLYPH[t.status]);
    console.log(`  ${glyph} ${t.status === "completed" ? color.dim(t.subject) : t.subject}`);
  }
  console.log("");
}

export function printHistory(items: HistoryItem[]): void {
  if (!items.length) return;
  console.log(color.dim(`\n(resuming previous session — ${items.length} prior turn item(s))\n`));
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Console implementation of the Reporter interface used by the CLI REPL. */
export class ConsoleReporter implements Reporter {
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;
  private streaming = false;

  toolCall(_id: string, _name: string, label: string, _args: unknown): void {
    this.stopSpinner();
    this.streaming = false; // a tool call ends any in-progress streamed line without a trailing newline printed for it
    printToolCall(label);
  }

  toolResult(_id: string, output: string, ok: boolean): void {
    printToolResult(output, ok);
  }

  assistantDelta(chunk: string): void {
    this.stopSpinner();
    if (!this.streaming) {
      this.streaming = true;
      printAssistantPrefix();
    }
    process.stdout.write(chunk);
  }

  assistantDeltaEnd(fullText: string, _isFinal: boolean): void {
    if (this.streaming) {
      process.stdout.write("\n\n");
    } else if (fullText) {
      // Nothing streamed (e.g. a provider that returned no delta content at all) — print the
      // authoritative final text directly rather than silently losing it.
      printAssistantPrefix();
      process.stdout.write(fullText + "\n\n");
    }
    this.streaming = false;
  }

  error(text: string): void {
    this.stopSpinner();
    if (this.streaming) process.stdout.write("\n");
    this.streaming = false;
    printError(text);
  }

  thinking(isThinking: boolean): void {
    if (isThinking) this.startSpinner();
    else this.stopSpinner();
  }

  tasks(tasks: TaskItem[]): void {
    printTasks(tasks);
  }

  history(items: HistoryItem[]): void {
    printHistory(items);
  }

  files(_files: string[]): void {
    // The CLI already shows each write/edit as a tool call; a separate file list adds no new information here.
  }

  private startSpinner(): void {
    if (this.spinnerTimer) return;
    this.spinnerTimer = setInterval(() => {
      process.stdout.write(`\r${color.cyan(SPINNER_FRAMES[this.spinnerFrame])} thinking...`);
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
    }, 80);
  }

  private stopSpinner(): void {
    if (!this.spinnerTimer) return;
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = null;
    process.stdout.write("\r\x1b[K");
  }
}
