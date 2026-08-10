/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import * as path from "path";
import { chatCompletion } from "./llm";
import { TOOLS, TOOL_DEFINITIONS } from "./tools";
import { UPDATE_TASKS_DEFINITION } from "./tools/tasks";
import { PermissionManager } from "./permissions";
import { gatherProjectContext } from "./projectContext";
import { loadSession, saveSession, deleteSession, createSessionId, deriveTitle, pickMostRecentSessionId } from "./session";
import { McpManager } from "./mcp";
import { loadGlobalInstructions, saveGlobalInstructions } from "./globalSettings";
import { gitStatusPorcelain, snapshotFile, restoreSnapshot, type FileSnapshot } from "./workspaceSnapshot";
import { appendTransaction, loadTransaction } from "./transactionLog";
import { detectProjectMemory, updateProjectMemory, formatProjectMemoryForPrompt } from "./projectMemory";
import { runVerification } from "./verification";
import { critiqueStep } from "./critic";
import { withIdleTimeout } from "./timeout";
import type {
  ChatMessage,
  ToolContext,
  Reporter,
  LlmConfig,
  TaskItem,
  HistoryItem,
  ToolCallRequest,
  RiskLevel,
  ActionLogEntry,
  TransactionRecord,
  TransactionOutcome,
  VerificationResult,
  ProjectMemory,
  ToolSpec,
} from "./types";

const MAX_TOOL_ITERATIONS = 30;
const MAX_REPAIR_ATTEMPTS = 3;
/** Hard cap on independent critique calls per turn — bounds latency/cost on a turn with many mutation rounds. */
const MAX_CRITIC_CALLS = 5;
const MAX_CRITIQUE_ACTION_CHARS = 800;
/** No chunk and no completion for this long means the provider is stuck, not just slow — give up rather than hang forever. */
const MODEL_IDLE_TIMEOUT_MS = 90_000;

/** Tool calls whose `path` argument should surface in the "Created Files" panel. */
const FILE_PRODUCING_TOOLS = new Set(["write_file", "edit_file", "create_docx", "create_pptx", "create_xlsx"]);

/** Extensions worth an automatic verification pass; touching only a generated document shouldn't trigger a test run. */
const CODE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|c|cpp|h|hpp|cs)$/i;

/** Shell commands that just inspect state — running a build/test suite after one of these would be pure noise. */
const READ_ONLY_ISH_SHELL = /^\s*(ls|dir|pwd|cat|type|echo|git\s+(status|log|diff|show|branch(\s|$)|remote)|node\s+-v|npm\s+-v|npx\s+--version|which|where)\b/i;

function systemPrompt(root: string, projectContext: string, globalInstructions: string, projectMemoryBlock: string): string {
  return [
    "You are Wrexlyn, a terminal-based AI coding agent operating on a real project directory. Wrexlyn is your name",
    "and identity — when asked who or what you are, say you're Wrexlyn, created by Nishant Prabhakar, not the name",
    "of whatever underlying model happens to be answering the request. Only mention the specific underlying",
    "model/provider if the user asks directly and specifically about the technical backend (e.g. 'which model are",
    "you running on') — and even then answer plainly rather than volunteering it unprompted elsewhere.",
    "",
    "About Nishant Prabhakar (answer from these facts if asked for detail about him — don't invent anything beyond",
    "them): he is the creator of Wrexlyn. Professionally he is Senior Vice President at SKEGEN Asset Management (a",
    "Bharat Biotech Group platform), leading deep-tech and advanced-manufacturing investments under a USD 500",
    "million third-party strategy. His career spans The Rohatyn Group's Asia private equity platform (which",
    "incorporates the CVCI and JP Morgan Private Equity Asia legacy), Premji Invest, EISAF (the Edelweiss-CDPQ",
    "Special Asset Fund), and now SKEGEN. He has 11+ years in private equity and capital markets, has executed or",
    "managed USD 2B+ in transactions, has been exposed to USD 25B+ in institutional AUM, and has raised or",
    "contributed USD 1.6B+ in capital; he holds board observer and nominee director roles across growth and",
    "infrastructure assets, is an honorary advisor to a global high-performance computing company, and has NASA",
    "Quest LCROSS simulator and student satellite team experience. His investment focus covers buyouts, growth",
    "equity, mezzanine, and special-situations and venture investing across India, South-East Asia, and global",
    "markets, concentrated on AI infrastructure, quantum computing, aerospace, defence, and advanced manufacturing.",
    "He is a Computer Science graduate (9.80/10 CGPA, Academic Medal and Best Achiever Award), was on the IIM",
    "Indore Director's List, and holds a Private Equity and Venture Capital certification from Università Bocconi.",
    "He has authored four internationally published books: Capital in the Shadows, The Next Frontier, The Sovereign",
    "Stack, and The Compute Shift. More at nishantprabhakar.pages.dev.",
    `Your working directory (sandbox root) is: ${root}`,
    "",
    globalInstructions.trim()
      ? `The user has set the following global instructions, which apply across every project (not just this one) —` +
          ` follow them unless they conflict with a safety/tool constraint above:\n${globalInstructions.trim()}`
      : "",
    "",
    "You have tools to read/write/edit files, list directories, search file contents, run shell commands, generate",
    "Word/PowerPoint/Excel documents, extract text from PDFs (read_pdf), mark up an existing Word document with a",
    "real tracked change (redline_docx), and fetch pages from the internet (web_fetch). All file paths you pass to",
    "tools are relative to the working directory.",
    "- redline_docx only finds old_string when it sits within one simply-formatted run of text in the document; if",
    "  it reports the text wasn't found, don't fall back to silently rewriting the file with write_file instead —",
    "  that would lose the point of a reviewable tracked change. Tell the user it couldn't be located as a single",
    "  run and suggest a shorter or differently-scoped snippet.",
    "If any tools named mcp__<server>__<tool> are available, they come from user-configured MCP servers (see",
    "mcp.json) — use them the same way as any other tool when they fit the task.",
    "",
    "- Use web_fetch when you need current information, documentation, or an API reference you're not certain of —",
    "  don't guess at API shapes or library versions when you can look them up. It runs without a permission prompt",
    "  (it's read-only), so use it freely, but always tell the user what you looked up and where from.",
    "",
    projectContext ? `Project context (gathered automatically, may be incomplete — verify before relying on it):\n${projectContext}` : "",
    "",
    projectMemoryBlock,
    "",
    "Guidelines:",
    "- Investigate before editing: read relevant files (or grep/glob for them) before changing code you haven't seen.",
    "- Prefer edit_file for targeted changes; use write_file for new files or full rewrites.",
    "- Make the smallest change that correctly accomplishes the task. Don't add unrelated refactors.",
    "- Mutating actions (write_file, edit_file, run_shell_command) require user permission — the harness handles that; just call the tool.",
    "- Be concise in your final explanations; show, don't narrate excessively.",
    "- For anything with more than one real step, call update_tasks to lay out your plan up front, and again as each",
    "  task's status changes — the user sees this as a live checklist. Break the plan into small steps you can each",
    "  verify individually, rather than one big step you only check at the very end — a mistake caught after step 1",
    "  is cheap to fix; the same mistake discovered after step 5 has already been built on.",
    "",
    "V-Cycle runtime — this happens automatically, you don't need to invoke it, but you do need to cooperate with it:",
    "- Every action you take is risk-classified (low/medium/high) and mutating actions require the user's permission,",
    "  same as before. High-risk actions (recursive deletes, force pushes, DROP TABLE, etc.) always require a fresh",
    "  confirmation — the user can never pre-approve those as a standing 'always allow'.",
    "- After you finish a turn that touched code files or ran a non-trivial shell command, the harness automatically",
    "  runs whatever verification is available (typecheck/build/test/lint) and tells you the result. If it fails, you",
    "  will get a follow-up message describing the failure — treat that exactly like a real user report: diagnose the",
    "  actual root cause from the error text, don't just retry the same thing. You get up to a few automatic repair",
    "  rounds; if you're still stuck, say so plainly instead of declaring success.",
    "- Every mutating file change is snapshotted before it happens, so the user can revert a turn's changes if",
    "  verification ultimately fails — you don't need to build your own backup/undo mechanism.",
    "- After a round of mutating actions, an independent reviewer (a separate, fresh model call with no stake in the",
    "  outcome) checks whether that step actually accomplished its goal, not just whether it ran without erroring.",
    "  If it flags a problem you'll get a follow-up message describing what it found — treat it as a real, credible",
    "  report and fix the actual issue, not as noise to argue with or dismiss.",
    "",
    "Reliability discipline — this is what makes your output trustworthy no matter how capable the underlying model",
    "is. Treat every one of these as mandatory, not aspirational:",
    "- Never rely on memory alone for anything you're not fully certain of: an unfamiliar API, a library's current",
    "  version/signature, a framework convention, a fact that could be stale. Check it — grep/read the actual code",
    "  in this project, or web_fetch the real documentation. A wrong guess presented as fact is a worse outcome than",
    "  taking the extra step to look it up.",
    "- Never claim something is done, fixed, or working without having verified it with a tool call, not just by",
    "  re-reading your own reasoning. After writing or editing code, run something that would actually catch a",
    "  mistake: the project's build/typecheck/lint/test command if one exists (check package.json/README first), or",
    "  at minimum re-read the file you just wrote and check it against what you intended, line by line.",
    "- If a build/test/run command fails, or a tool call errors, that is your bug, not noise to route around. Read",
    "  the actual error text and fix the root cause. Never call the same tool again with the same arguments expecting",
    "  a different result — if your first attempt at something failed, change your approach, don't repeat it.",
    "- Before giving your final answer for anything that involved file changes, do one deliberate pass comparing what",
    "  you actually did (the tool results you got back) against what was literally asked — not what you intended to",
    "  do. Catch scope creep (unrelated changes you weren't asked for) and incompleteness (part of the request you",
    "  didn't get to) here, before the user has to.",
    "- State your actual confidence. If you're not sure a piece of code is correct — an API you're unsure about, a",
    "  library version, a syntax detail you didn't verify — say so explicitly in your final response instead of",
    "  presenting it as certain. A flagged uncertainty is useful; a confident wrong answer is not.",
    "",
    "Code quality — non-negotiable:",
    "- Never write placeholder code: no '// TODO', no '// rest of the code here', no '// ... implementation ...', no",
    "  stubbed-out functions. Every file you write must be complete and runnable as-is.",
    "- If a file is too large to write in one call, split it into multiple real, complete, working files instead of",
    "  truncating any single one.",
    "- Match language/framework conventions exactly (correct imports, correct syntax, correct file extensions).",
    "  Double-check import paths and package names against what you've actually seen in the project, not assumptions.",
    "- For create_docx/create_pptx/create_xlsx: write complete, real content (never a one-line placeholder body),",
    "  structure it with proper headings/sections/tables rather than one giant paragraph, and check the tool's",
    "  returned block/slide/sheet count against what you intended before telling the user it's done — the tools",
    "  apply consistent default styling (fonts, table borders, header shading) automatically, so focus your effort",
    "  on getting the content and structure right.",
    "- Actually use the formatting the user asks for instead of leaving everything as flat, uniform text — these",
    "  tools have real formatting features, not just plain paragraphs:",
    "  - Inline emphasis in any text field (docx and pptx): **bold**, _italic_, __underline__, ~~strikethrough~~,",
    "    combinable (e.g. **_bold italic_**). Use this for labels, warnings, key figures — anything the user asked",
    "    to stand out — instead of writing it as plain text and calling that 'formatted'.",
    "  - create_docx: `align` (left/center/right/justify) and `color` (hex) per heading/paragraph block; `ordered`",
    "    + per-item `level` (0-3) on bullets blocks for numbered and nested lists; an `image` block type for",
    "    figures/logos/screenshots (path relative to the working directory — check it exists via list_dir/glob",
    "    first); a `pagebreak` block type; a `toc` block type for a real, clickable, auto-updating table of",
    "    contents (put actual heading blocks before it — it has nothing to list otherwise) — use this for anything",
    "    long enough to need one (reports, specs), it's what makes a document feel genuinely professional rather",
    "    than a wall of text; per-cell `{text, align, bold}` in table headers/rows; a top-level `accentColor` (hex)",
    "    when the user specifies a brand/theme color instead of the default blue.",
    "  - create_pptx: `layout` per slide — 'section' for a divider slide between parts of the deck, 'two_column'",
    "    (with `columns`) for side-by-side comparisons, default 'title_bullets' otherwise; `image` and `table`",
    "    fields on any slide for figures/data (don't cram a table into bullet text as a wall of dashes); nested",
    "    bullets via per-item `level`; a top-level `accentColor` (hex). Slide design taste, not just mechanics:",
    "    pick one dominant color plus at most one supporting color and one accent — don't rely on the accentColor",
    "    alone to carry the whole slide; never add a decorative shape/stripe/underline purely for visual flourish",
    "    (a repeated geometric accent under every title is one of the most recognizable tells of an AI-generated",
    "    deck — the tool deliberately doesn't add one, don't add your own via extra bullets/notes either); keep a",
    "    real margin (don't fill x=0 to x=10) and real gaps between elements rather than packing a slide edge to",
    "    edge; put at most 5-6 bullets on one slide — split into more slides instead of shrinking text to fit; use",
    "    'section' slides to give a multi-part deck actual structure rather than one flat run of title_bullets.",
    "  - create_xlsx: header objects `{name, numberFormat, width, align}` — set numberFormat for anything that IS",
    "    money, a percentage, or a date ('$#,##0.00', '0.0%', 'yyyy-mm-dd') rather than leaving it as a bare number;",
    "    `merges` (e.g. ['A1:C1']) for a title spanning columns; `autoFilter` on sheets meant to be filtered/sorted",
    "    interactively; a top-level `accentColor` (hex). Live formula cells are written without a cached result —",
    "    Excel recalculates them automatically the moment the file opens, but mention this if the user asks why a",
    "    formula 'looks blank' in some other, non-Excel viewer.",
    "  - Before generating an image block/field, confirm the referenced file actually exists in the project (a",
    "    guessed path that doesn't exist fails the whole document) — read the directory first if you're not certain.",
    "- For any spreadsheet that's a model rather than a static table (financial models, running totals, anything",
    "  someone would want to audit or change an input and have it recalculate), use live formulas — a cell value",
    "  starting with '=' in create_xlsx — instead of computing the numbers yourself and writing them as literals.",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
}

function createTransactionId(): string {
  return `tx_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The file a mutating tool call actually writes to — redline_docx may target output_path instead of path. */
function fileTargetPath(args: any): string | undefined {
  if (typeof args?.output_path === "string") return args.output_path;
  if (typeof args?.path === "string") return args.path;
  return undefined;
}

function safeReadFile(root: string, relPath: string): string {
  try {
    return fs.readFileSync(path.join(root, relPath), "utf-8");
  } catch {
    return "";
  }
}

/** Whether this turn's mutating actions are worth spending time verifying at all. */
function shouldVerify(actions: ActionLogEntry[]): boolean {
  return actions.some((a) => {
    if (!a.ok) return false;
    if (a.name === "run_shell_command") {
      const cmd = typeof (a.args as any)?.command === "string" ? ((a.args as any).command as string) : "";
      return cmd.trim() !== "" && !READ_ONLY_ISH_SHELL.test(cmd);
    }
    const p = a.fileSnapshot?.path;
    return !!p && CODE_FILE_RE.test(p);
  });
}

function summarizeVerification(v: VerificationResult): string {
  return v.checks
    .map((c) => `- ${c.name}: ${c.ok ? "PASSED" : "FAILED"}${c.ok ? "" : `\n${c.output.slice(0, 1500)}`}`)
    .join("\n");
}

export class Agent {
  private messages: ChatMessage[] = [];
  private historyLog: HistoryItem[] = [];
  private tasks: TaskItem[] = [];
  private createdFiles: string[] = [];
  private ctx: ToolContext;
  private mcpManager = new McpManager();
  private sysMessage: ChatMessage;
  private projectContext: string;
  private projectMemory: ProjectMemory;
  private sessionId: string;
  private sessionTitle = "New chat";

  /** The audit-trail record for the turn currently being processed by handleUserMessage; null between turns. */
  private currentTransaction: TransactionRecord | null = null;
  /** True once a mutating action has run since the transaction's verification state was last computed. */
  private needsVerification = false;
  /** Content signature of touched files after the last repair attempt, to detect a repair loop making no progress. */
  private lastRepairSignature: string | null = null;

  constructor(
    root: string,
    private llmConfig: LlmConfig,
    private permissions: PermissionManager,
    private reporter: Reporter,
    sessionId?: string
  ) {
    this.ctx = { root };
    this.projectContext = gatherProjectContext(root);
    this.projectMemory = detectProjectMemory(root);
    this.sysMessage = {
      role: "system",
      content: systemPrompt(root, this.projectContext, loadGlobalInstructions(), formatProjectMemoryForPrompt(this.projectMemory)),
    };
    this.sessionId = sessionId ?? pickMostRecentSessionId(root) ?? createSessionId();
    this.loadSessionData();
  }

  private loadSessionData(): void {
    const restored = loadSession(this.ctx.root, this.sessionId);
    if (restored) {
      this.messages = [this.sysMessage, ...restored.messages];
      this.historyLog = restored.historyLog;
      this.tasks = restored.tasks;
      this.createdFiles = restored.createdFiles;
      this.sessionTitle = restored.title;
    } else {
      this.messages = [this.sysMessage];
      this.historyLog = [];
      this.tasks = [];
      this.createdFiles = [];
      this.sessionTitle = "New chat";
    }
  }

  /** Pushes this session's history/tasks/files to the reporter — call after construction or a session switch. */
  replayCurrentState(): void {
    this.reporter.history(this.historyLog);
    this.reporter.tasks(this.tasks);
    this.reporter.files(this.createdFiles);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getSessionTitle(): string {
    return this.sessionTitle;
  }

  /** Loads a different (existing) session's history into this Agent without recreating it (keeps MCP connections alive). */
  switchSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.loadSessionData();
  }

  /** Starts a brand-new, empty session and returns its id. */
  startNewSession(): string {
    this.sessionId = createSessionId();
    this.messages = [this.sysMessage];
    this.historyLog = [];
    this.tasks = [];
    this.createdFiles = [];
    this.sessionTitle = "New chat";
    return this.sessionId;
  }

  deleteSession(sessionId: string): void {
    deleteSession(this.ctx.root, sessionId);
  }

  /** Switches the model for subsequent turns without losing conversation history. */
  setModel(model: string): void {
    this.llmConfig = { ...this.llmConfig, model };
  }

  getModel(): string {
    return this.llmConfig.model;
  }

  /** Switches the active provider (and its model/key) for subsequent turns, without losing conversation history or recreating the agent. */
  switchProvider(provider: LlmConfig["provider"], model: string, apiKey: string | undefined): void {
    this.llmConfig = { provider, model, apiKey };
  }

  getProvider(): LlmConfig["provider"] {
    return this.llmConfig.provider;
  }

  /**
   * Saves new global instructions (applied to every project) and rebuilds the
   * system prompt in place, so the change takes effect on the very next
   * message without needing to restart or switch folders.
   */
  setGlobalInstructions(text: string): void {
    saveGlobalInstructions(text);
    this.sysMessage = {
      role: "system",
      content: systemPrompt(this.ctx.root, this.projectContext, text, formatProjectMemoryForPrompt(this.projectMemory)),
    };
    this.messages[0] = this.sysMessage;
  }

  /** Connects any MCP servers configured in <root>/mcp.json. Safe to not await — runs in the background. */
  async connectMcp(): Promise<void> {
    await this.mcpManager.connectAll(this.ctx.root, (message) => console.error(`[coding-agent] ${message}`));
  }

  /**
   * Disconnects and reconnects every MCP server from the current mcp.json —
   * call this after the config file has been edited so the change takes
   * effect without a full restart. Returns the number of tools now available.
   */
  async reloadMcp(): Promise<number> {
    await this.mcpManager.closeAll();
    this.mcpManager = new McpManager();
    await this.connectMcp();
    return this.mcpManager.getToolDefinitions().length;
  }

  /** Releases MCP server subprocesses. Call when this Agent instance is done (e.g. on disconnect). */
  async dispose(): Promise<void> {
    await this.mcpManager.closeAll();
  }

  /** Reverts a past transaction's file changes using its stored pre-change snapshots. Never touches git. */
  rollbackTransaction(transactionId: string): { ok: boolean; restored: string[] } {
    const tx = loadTransaction(this.ctx.root, this.sessionId, transactionId);
    if (!tx) return { ok: false, restored: [] };

    const snapshots: FileSnapshot[] = tx.actions
      .filter((a) => a.ok && a.fileSnapshot)
      .map((a) => a.fileSnapshot as FileSnapshot);
    if (!snapshots.length) return { ok: false, restored: [] };

    const results = restoreSnapshot(this.ctx.root, snapshots);
    return { ok: results.every((r) => r.ok), restored: results.filter((r) => r.ok).map((r) => r.path) };
  }

  async handleUserMessage(userText: string): Promise<void> {
    if (this.messages.length === 1) this.sessionTitle = deriveTitle(userText);
    this.messages.push({ role: "user", content: userText });
    this.historyLog.push({ type: "user", text: userText });

    this.currentTransaction = {
      id: createTransactionId(),
      sessionId: this.sessionId,
      startedAt: Date.now(),
      intent: userText.length > 300 ? userText.slice(0, 300) + "…" : userText,
      gitStatusBefore: gitStatusPorcelain(this.ctx.root),
      actions: [],
      repairAttempts: 0,
      criticCalls: 0,
      outcome: "no_changes",
      confidence: 100,
    };
    this.needsVerification = false;
    this.lastRepairSignature = null;

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      let result;
      try {
        this.reporter.thinking(true);
        result = await withIdleTimeout(
          (heartbeat) =>
            chatCompletion(
              this.messages,
              [...TOOL_DEFINITIONS, UPDATE_TASKS_DEFINITION, ...this.mcpManager.getToolDefinitions()],
              this.llmConfig,
              (chunk) => {
                heartbeat();
                this.reporter.assistantDelta(chunk);
              }
            ),
          MODEL_IDLE_TIMEOUT_MS,
          "model call"
        );
      } catch (err: any) {
        this.reporter.thinking(false);
        const message = err.message ?? String(err);
        this.reporter.error(message);
        this.historyLog.push({ type: "error", text: message });
        this.finalizeTransaction("failed");
        this.persist();
        return;
      }
      this.reporter.thinking(false);

      if (result.toolCalls.length === 0) {
        const text = result.content ?? "(no response)";
        let verification: VerificationResult | undefined;
        let willRepair = false;

        const tx = this.currentTransaction!;
        if (this.needsVerification && shouldVerify(tx.actions)) {
          const touchedFiles = tx.actions.map((a) => a.fileSnapshot?.path).filter((p): p is string => !!p);
          verification = await runVerification(this.ctx.root, this.projectMemory, touchedFiles);
          tx.verification = verification;
          this.needsVerification = false;

          if (!verification.ok && verification.ranAny && tx.repairAttempts < MAX_REPAIR_ATTEMPTS) {
            const signature = touchedFiles.map((f) => safeReadFile(this.ctx.root, f)).join(" ");
            const stuck = signature !== "" && signature === this.lastRepairSignature;
            this.lastRepairSignature = signature;
            willRepair = !stuck;
          }
        } else if (this.needsVerification) {
          this.needsVerification = false; // no applicable check for what changed — nothing to run, don't re-check every round
        }

        this.messages.push({ role: "assistant", content: text });
        if (text.trim()) this.historyLog.push({ type: "assistant", text });
        this.reporter.assistantDeltaEnd(text, !willRepair);

        if (verification) {
          this.reporter.verification(verification);
          this.historyLog.push({ type: "verification", result: verification });
        }

        if (willRepair) {
          tx.repairAttempts++;
          this.messages.push({
            role: "user",
            content:
              `Automatic verification failed after your last changes:\n${summarizeVerification(verification!)}\n\n` +
              `Fix the root cause (repair attempt ${tx.repairAttempts}/${MAX_REPAIR_ATTEMPTS}). Don't repeat a ` +
              `command that already failed unchanged — diagnose why it failed first.`,
          });
          this.historyLog.push({
            type: "user",
            text: `(automatic) verification failed — requesting repair (${tx.repairAttempts}/${MAX_REPAIR_ATTEMPTS})`,
          });
          this.persist();
          continue;
        }

        this.finalizeTransaction();
        this.persist();
        return;
      }

      this.messages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
          extra_content: tc.extra,
        })),
      });

      // The model sometimes narrates its reasoning in the same turn it calls
      // tools (e.g. "I'll check the config first, then update it."). That text
      // used to be silently dropped here — only ever seen if a turn happened
      // to end without a tool call. Surface it now so intermediate thinking
      // is visible, not just final answers. isFinal=false: this doesn't end
      // the turn, the loop is about to run tool calls and go again.
      //
      // Always close out the streamed message when content is non-null (even
      // if it trims to whitespace) — the client only knows to open a live
      // bubble from seeing raw deltas, so it needs a matching close signal
      // for every one of those, not just the ones with "real" content. Only
      // whether we *persist* it to history depends on having real content.
      if (result.content) {
        if (result.content.trim()) this.historyLog.push({ type: "assistant", text: result.content });
        this.reporter.assistantDeltaEnd(result.content, false);
      }

      const actionsBefore = this.currentTransaction!.actions.length;
      const outputs = await this.runToolCalls(result.toolCalls);
      for (let i = 0; i < result.toolCalls.length; i++) {
        this.messages.push({
          role: "tool",
          tool_call_id: result.toolCalls[i].id,
          name: result.toolCalls[i].name,
          content: outputs[i],
        });
      }
      await this.critiqueRoundIfNeeded(actionsBefore);
      this.persist();
    }

    const message = `Stopped after ${MAX_TOOL_ITERATIONS} tool calls without a final response.`;
    this.reporter.error(message);
    this.historyLog.push({ type: "error", text: message });
    this.finalizeTransaction("failed");
    this.persist();
  }

  private persist(): void {
    // this.messages[0] is always the system prompt — persist everything after it.
    saveSession(
      this.ctx.root,
      this.sessionId,
      this.sessionTitle,
      this.messages.slice(1),
      this.historyLog,
      this.tasks,
      this.createdFiles
    );
  }

  /**
   * Closes out the current transaction: derives an outcome + evidence-based
   * confidence score from what actually happened this turn, persists the
   * audit record, and (unless nothing mutating happened) tells the reporter.
   * `forced` overrides the derived outcome for hard-stop paths (LLM error,
   * iteration budget exhausted) where there was no clean verification phase.
   */
  private finalizeTransaction(forced?: TransactionOutcome): void {
    const tx = this.currentTransaction;
    if (!tx) return;

    const mutatingHappened = tx.actions.length > 0;
    const allDenied = mutatingHappened && tx.actions.every((a) => !a.ok && /denied permission/i.test(a.output));

    let outcome: TransactionOutcome;
    let confidence: number;

    if (forced && mutatingHappened) {
      outcome = forced;
      confidence = 40;
    } else if (!mutatingHappened) {
      outcome = "no_changes";
      confidence = 100;
    } else if (allDenied) {
      outcome = "blocked";
      confidence = 20;
    } else if (tx.verification?.ranAny) {
      if (tx.verification.ok) {
        const ranTest = tx.verification.checks.some((c) => /^test/i.test(c.name));
        outcome = "verified";
        confidence = ranTest ? 100 : 80;
      } else {
        outcome = "failed";
        confidence = 40;
      }
    } else {
      outcome = "unverified_changes";
      confidence = 60;
    }

    tx.endedAt = Date.now();
    tx.gitStatusAfter = gitStatusPorcelain(this.ctx.root);
    tx.outcome = outcome;
    tx.confidence = confidence;
    appendTransaction(this.ctx.root, this.sessionId, tx);

    if (outcome !== "no_changes") {
      const rollbackAvailable = tx.actions.some((a) => a.ok && a.fileSnapshot);
      this.reporter.transactionSummary(tx.id, confidence, outcome, rollbackAvailable);
      this.historyLog.push({ type: "transaction_summary", transactionId: tx.id, confidence, outcome, rollbackAvailable });
    }

    this.learnFromActions(tx.actions);
    this.currentTransaction = null;
  }

  /**
   * Runs the independent per-step reviewer over whatever mutating actions
   * succeeded in the round that just finished (actions[actionsBefore:]).
   * Distinct from end-of-turn verification: this judges *intent*, not just
   * "did it run without erroring" — the two catch different failure modes.
   * Never throws and never blocks the turn; a FAIL just queues a follow-up
   * message for the model to address on its next iteration.
   */
  private async critiqueRoundIfNeeded(actionsBefore: number): Promise<void> {
    const tx = this.currentTransaction;
    if (!tx || tx.criticCalls >= MAX_CRITIC_CALLS) return;

    const roundActions = tx.actions.slice(actionsBefore).filter((a) => a.ok);
    if (!roundActions.length) return;

    const stepSummary = roundActions
      .map((a) => `- ${a.label}\n  result: ${a.output.slice(0, MAX_CRITIQUE_ACTION_CHARS)}`)
      .join("\n");

    tx.criticCalls++;
    const critique = await critiqueStep(this.llmConfig, tx.intent, stepSummary);

    this.reporter.critique(critique.pass, critique.reason);
    if (critique.reason) this.historyLog.push({ type: "critique", pass: critique.pass, reason: critique.reason });

    if (!critique.pass) {
      this.messages.push({
        role: "user",
        content:
          `An independent reviewer checked your last step and found a problem:\n${critique.reason}\n\n` +
          `Fix this before moving on (this doesn't count against your automatic build/test repair budget).`,
      });
      this.historyLog.push({ type: "user", text: `(automatic) independent review flagged an issue — requesting a fix` });
    }
  }

  /** Folds newly-observed facts (a test command that just worked, a command the user denied) into project memory. */
  private learnFromActions(actions: ActionLogEntry[]): void {
    const patch: Partial<ProjectMemory> = {};
    let changed = false;
    const blockedAdds: string[] = [];

    for (const a of actions) {
      if (a.name !== "run_shell_command") continue;
      const cmd = typeof (a.args as any)?.command === "string" ? ((a.args as any).command as string) : "";
      if (!cmd) continue;

      if (!a.ok && /denied permission/i.test(a.output)) {
        if (!this.projectMemory.blockedCommands?.includes(cmd)) blockedAdds.push(cmd);
        continue;
      }
      if (!a.ok) continue;

      if (!this.projectMemory.testCommand && /\btest\b/i.test(cmd)) {
        patch.testCommand = cmd;
        changed = true;
      } else if (!this.projectMemory.buildCommand && /\bbuild\b/i.test(cmd)) {
        patch.buildCommand = cmd;
        changed = true;
      } else if (!this.projectMemory.lintCommand && /\blint\b/i.test(cmd)) {
        patch.lintCommand = cmd;
        changed = true;
      }
    }

    if (blockedAdds.length) {
      patch.blockedCommands = [...(this.projectMemory.blockedCommands ?? []), ...blockedAdds].slice(-20);
      changed = true;
    }

    if (changed) {
      this.projectMemory = { ...this.projectMemory, ...patch };
      updateProjectMemory(this.ctx.root, patch);
    }
  }

  /** Surfaces a file the agent just wrote/edited/generated in the "Created Files" panel, most-recent first. */
  private trackFile(relPath: string): void {
    const existing = this.createdFiles.indexOf(relPath);
    if (existing !== -1) this.createdFiles.splice(existing, 1);
    this.createdFiles.unshift(relPath);
    this.reporter.files(this.createdFiles);
  }

  private recordTool(
    id: string,
    name: string,
    label: string,
    args: unknown,
    output: string,
    ok: boolean,
    risk: RiskLevel = "low",
    fileSnapshot?: FileSnapshot
  ): string {
    this.reporter.toolResult(id, output, ok);
    this.historyLog.push({ type: "tool", id, name, label, args, output, ok });
    if (risk !== "low" && this.currentTransaction) {
      this.currentTransaction.actions.push({
        toolCallId: id,
        name,
        label,
        args,
        risk,
        ok,
        output,
        timestamp: Date.now(),
        fileSnapshot,
      });
      if (ok) this.needsVerification = true;
    }
    return output;
  }

  /** A call is safe to run concurrently with its neighbors if it can never hit a permission prompt. */
  private isReadOnlyCall(name: string): boolean {
    if (name === "update_tasks") return true;
    if (this.mcpManager.isMcpTool(name)) return false; // arbitrary third-party code — always confirmed, so always sequential
    const tool = TOOLS[name];
    return tool ? !tool.mutating : false;
  }

  /**
   * Runs one turn's tool calls, batching consecutive read-only calls (e.g. a
   * model reading three files in a row) together via Promise.all for lower
   * latency, while keeping mutating calls — which may block on a permission
   * prompt — strictly sequential. Output order always matches call order,
   * regardless of which calls in a batch happen to resolve first.
   */
  private async runToolCalls(calls: ToolCallRequest[]): Promise<string[]> {
    const outputs: string[] = new Array(calls.length);
    let i = 0;
    while (i < calls.length) {
      if (this.isReadOnlyCall(calls[i].name)) {
        const start = i;
        while (i < calls.length && this.isReadOnlyCall(calls[i].name)) i++;
        const batch = calls.slice(start, i);
        const batchOutputs = await Promise.all(batch.map((c) => this.executeToolCall(c.id, c.name, c.arguments)));
        batchOutputs.forEach((out, j) => (outputs[start + j] = out));
      } else {
        outputs[i] = await this.executeToolCall(calls[i].id, calls[i].name, calls[i].arguments);
        i++;
      }
    }
    return outputs;
  }

  /** Falls back to "medium" for mutating tools / "low" for read-only ones when a tool doesn't classify its own risk. */
  private resolveRisk(tool: Pick<ToolSpec, "mutating" | "riskOf">, args: any): RiskLevel {
    if (tool.riskOf) {
      try {
        return tool.riskOf(args);
      } catch {
        // fall through to the default below
      }
    }
    return tool.mutating ? "medium" : "low";
  }

  private async executeToolCall(id: string, name: string, rawArgs: string): Promise<string> {
    let args: any;
    try {
      args = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
      const message = `Invalid JSON arguments for ${name}: ${rawArgs}`;
      this.reporter.toolCall(id, name, name, {}, "low");
      return this.recordTool(id, name, name, {}, message, false);
    }
    // Models occasionally emit "null" or a non-object as arguments; normalize
    // so describe()/preview()/run() can safely assume a plain object.
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      args = {};
    }

    if (name === "update_tasks") {
      return this.handleUpdateTasks(id, args);
    }

    if (this.mcpManager.isMcpTool(name)) {
      return this.executeMcpTool(id, name, args);
    }

    const tool = TOOLS[name];
    if (!tool) {
      const label = `unknown tool: ${name}`;
      this.reporter.toolCall(id, name, label, args, "low");
      return this.recordTool(id, name, label, args, `Unknown tool: ${name}`, false);
    }

    let label: string;
    try {
      label = tool.describe(args);
    } catch (err: any) {
      const message = `Tool ${name} rejected its arguments: ${err.message ?? err}`;
      this.reporter.toolCall(id, name, name, args, "low");
      return this.recordTool(id, name, name, args, message, false);
    }

    const risk = this.resolveRisk(tool, args);
    this.reporter.toolCall(id, name, label, args, risk);

    if (tool.mutating) {
      const preview = tool.preview ? await safePreview(tool, args, this.ctx) : undefined;

      let allowed: boolean;
      try {
        allowed = await this.permissions.confirm(name, label, risk, preview);
      } catch (err: any) {
        const message = `Permission check failed for ${name}: ${err.message ?? err}`;
        return this.recordTool(id, name, label, args, message, false, risk);
      }
      if (!allowed) {
        return this.recordTool(id, name, label, args, "User denied permission for this action.", false, risk);
      }
    }

    const target = tool.mutating ? fileTargetPath(args) : undefined;
    const fileSnapshot = target ? snapshotFile(this.ctx.root, target) : undefined;

    try {
      const result = await tool.run(args, this.ctx);
      if (result.ok && FILE_PRODUCING_TOOLS.has(name) && typeof args.path === "string") {
        this.trackFile(args.path);
      }
      return this.recordTool(id, name, label, args, result.output, result.ok, risk, fileSnapshot);
    } catch (err: any) {
      const message = `Tool ${name} threw an error: ${err.message ?? err}`;
      return this.recordTool(id, name, label, args, message, false, risk, fileSnapshot);
    }
  }

  private async executeMcpTool(id: string, name: string, args: any): Promise<string> {
    const label = `mcp: ${name.replace(/^mcp__/, "").replace(/__/, " · ")}`;
    const risk: RiskLevel = "medium";
    this.reporter.toolCall(id, name, label, args, risk);

    // MCP tools are arbitrary third-party code we can't introspect the safety
    // of — always confirm, same as run_shell_command.
    let allowed: boolean;
    try {
      allowed = await this.permissions.confirm(name, label, risk, JSON.stringify(args, null, 2));
    } catch (err: any) {
      return this.recordTool(id, name, label, args, `Permission check failed: ${err.message ?? err}`, false, risk);
    }
    if (!allowed) {
      return this.recordTool(id, name, label, args, "User denied permission for this action.", false, risk);
    }

    const result = await this.mcpManager.callTool(name, args);
    return this.recordTool(id, name, label, args, result.output, result.ok, risk);
  }

  private handleUpdateTasks(id: string, args: any): string {
    const label = `update tasks (${Array.isArray(args.tasks) ? args.tasks.length : 0})`;
    this.reporter.toolCall(id, "update_tasks", label, args, "low");

    if (!Array.isArray(args.tasks)) {
      return this.recordTool(id, "update_tasks", label, args, "tasks must be an array", false);
    }

    const validStatuses = new Set(["pending", "in_progress", "completed"]);
    const tasks: TaskItem[] = args.tasks
      .filter((t: any) => t && typeof t.subject === "string" && validStatuses.has(t.status))
      .map((t: any) => ({ subject: t.subject, status: t.status }));

    this.tasks = tasks;
    this.reporter.tasks(this.tasks);
    return this.recordTool(id, "update_tasks", label, args, `Task list updated (${tasks.length} tasks).`, true);
  }
}

async function safePreview(
  tool: { preview?: (args: any, ctx: ToolContext) => Promise<string> },
  args: any,
  ctx: ToolContext
): Promise<string | undefined> {
  try {
    return await tool.preview!(args, ctx);
  } catch {
    return undefined;
  }
}
