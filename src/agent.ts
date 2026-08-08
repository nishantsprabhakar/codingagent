/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { chatCompletion } from "./llm";
import { TOOLS, TOOL_DEFINITIONS } from "./tools";
import { UPDATE_TASKS_DEFINITION } from "./tools/tasks";
import { PermissionManager } from "./permissions";
import { gatherProjectContext } from "./projectContext";
import { loadSession, saveSession, deleteSession, createSessionId, deriveTitle, pickMostRecentSessionId } from "./session";
import { McpManager } from "./mcp";
import { loadGlobalInstructions, saveGlobalInstructions } from "./globalSettings";
import type { ChatMessage, ToolContext, Reporter, LlmConfig, TaskItem, HistoryItem, ToolCallRequest } from "./types";

const MAX_TOOL_ITERATIONS = 30;

/** Tool calls whose `path` argument should surface in the "Created Files" panel. */
const FILE_PRODUCING_TOOLS = new Set(["write_file", "edit_file", "create_docx", "create_pptx", "create_xlsx"]);

function systemPrompt(root: string, projectContext: string, globalInstructions: string): string {
  return [
    "You are a terminal-based AI coding agent operating on a real project directory.",
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
    "- For any spreadsheet that's a model rather than a static table (financial models, running totals, anything",
    "  someone would want to audit or change an input and have it recalculate), use live formulas — a cell value",
    "  starting with '=' in create_xlsx — instead of computing the numbers yourself and writing them as literals.",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
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
  private sessionId: string;
  private sessionTitle = "New chat";

  constructor(
    root: string,
    private llmConfig: LlmConfig,
    private permissions: PermissionManager,
    private reporter: Reporter,
    sessionId?: string
  ) {
    this.ctx = { root };
    this.projectContext = gatherProjectContext(root);
    this.sysMessage = {
      role: "system",
      content: systemPrompt(root, this.projectContext, loadGlobalInstructions()),
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

  /**
   * Saves new global instructions (applied to every project) and rebuilds the
   * system prompt in place, so the change takes effect on the very next
   * message without needing to restart or switch folders.
   */
  setGlobalInstructions(text: string): void {
    saveGlobalInstructions(text);
    this.sysMessage = { role: "system", content: systemPrompt(this.ctx.root, this.projectContext, text) };
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

  async handleUserMessage(userText: string): Promise<void> {
    if (this.messages.length === 1) this.sessionTitle = deriveTitle(userText);
    this.messages.push({ role: "user", content: userText });
    this.historyLog.push({ type: "user", text: userText });

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      let result;
      try {
        this.reporter.thinking(true);
        result = await chatCompletion(
          this.messages,
          [...TOOL_DEFINITIONS, UPDATE_TASKS_DEFINITION, ...this.mcpManager.getToolDefinitions()],
          this.llmConfig,
          (chunk) => this.reporter.assistantDelta(chunk)
        );
      } catch (err: any) {
        this.reporter.thinking(false);
        const message = err.message ?? String(err);
        this.reporter.error(message);
        this.historyLog.push({ type: "error", text: message });
        this.persist();
        return;
      }
      this.reporter.thinking(false);

      if (result.toolCalls.length === 0) {
        const text = result.content ?? "(no response)";
        this.messages.push({ role: "assistant", content: text });
        this.historyLog.push({ type: "assistant", text });
        this.reporter.assistantDeltaEnd(text, true);
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

      const outputs = await this.runToolCalls(result.toolCalls);
      for (let i = 0; i < result.toolCalls.length; i++) {
        this.messages.push({
          role: "tool",
          tool_call_id: result.toolCalls[i].id,
          name: result.toolCalls[i].name,
          content: outputs[i],
        });
      }
      this.persist();
    }

    const message = `Stopped after ${MAX_TOOL_ITERATIONS} tool calls without a final response.`;
    this.reporter.error(message);
    this.historyLog.push({ type: "error", text: message });
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

  /** Surfaces a file the agent just wrote/edited/generated in the "Created Files" panel, most-recent first. */
  private trackFile(relPath: string): void {
    const existing = this.createdFiles.indexOf(relPath);
    if (existing !== -1) this.createdFiles.splice(existing, 1);
    this.createdFiles.unshift(relPath);
    this.reporter.files(this.createdFiles);
  }

  private recordTool(id: string, name: string, label: string, args: unknown, output: string, ok: boolean): string {
    this.reporter.toolResult(id, output, ok);
    this.historyLog.push({ type: "tool", id, name, label, args, output, ok });
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

  private async executeToolCall(id: string, name: string, rawArgs: string): Promise<string> {
    let args: any;
    try {
      args = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
      const message = `Invalid JSON arguments for ${name}: ${rawArgs}`;
      this.reporter.toolCall(id, name, name, {});
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
      this.reporter.toolCall(id, name, label, args);
      return this.recordTool(id, name, label, args, `Unknown tool: ${name}`, false);
    }

    let label: string;
    try {
      label = tool.describe(args);
    } catch (err: any) {
      const message = `Tool ${name} rejected its arguments: ${err.message ?? err}`;
      this.reporter.toolCall(id, name, name, args);
      return this.recordTool(id, name, name, args, message, false);
    }
    this.reporter.toolCall(id, name, label, args);

    if (tool.mutating) {
      const preview = tool.preview ? await safePreview(tool, args, this.ctx) : undefined;

      let allowed: boolean;
      try {
        allowed = await this.permissions.confirm(name, label, preview);
      } catch (err: any) {
        const message = `Permission check failed for ${name}: ${err.message ?? err}`;
        return this.recordTool(id, name, label, args, message, false);
      }
      if (!allowed) {
        return this.recordTool(id, name, label, args, "User denied permission for this action.", false);
      }
    }

    try {
      const result = await tool.run(args, this.ctx);
      if (result.ok && FILE_PRODUCING_TOOLS.has(name) && typeof args.path === "string") {
        this.trackFile(args.path);
      }
      return this.recordTool(id, name, label, args, result.output, result.ok);
    } catch (err: any) {
      const message = `Tool ${name} threw an error: ${err.message ?? err}`;
      return this.recordTool(id, name, label, args, message, false);
    }
  }

  private async executeMcpTool(id: string, name: string, args: any): Promise<string> {
    const label = `mcp: ${name.replace(/^mcp__/, "").replace(/__/, " · ")}`;
    this.reporter.toolCall(id, name, label, args);

    // MCP tools are arbitrary third-party code we can't introspect the safety
    // of — always confirm, same as run_shell_command.
    let allowed: boolean;
    try {
      allowed = await this.permissions.confirm(name, label, JSON.stringify(args, null, 2));
    } catch (err: any) {
      return this.recordTool(id, name, label, args, `Permission check failed: ${err.message ?? err}`, false);
    }
    if (!allowed) {
      return this.recordTool(id, name, label, args, "User denied permission for this action.", false);
    }

    const result = await this.mcpManager.callTool(name, args);
    return this.recordTool(id, name, label, args, result.output, result.ok);
  }

  private handleUpdateTasks(id: string, args: any): string {
    const label = `update tasks (${Array.isArray(args.tasks) ? args.tasks.length : 0})`;
    this.reporter.toolCall(id, "update_tasks", label, args);

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
