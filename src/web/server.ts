/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as QRCode from "qrcode";
import { WebSocketServer, WebSocket } from "ws";
import { Agent } from "../agent";
import { PermissionManager, type PermissionDecision } from "../permissions";
import { resolveInRoot } from "../tools/paths";
import { WebSocketReporter, createConfirmFn } from "./reporter";
import { loadRecentFolders, addRecentFolder } from "../recentFolders";
import { saveLastModel } from "../preferences";
import { loadGlobalInstructions } from "../globalSettings";
import { loadApiKey, saveApiKey, clearApiKey, maskApiKey, API_KEY_PROVIDERS, type ApiKeyProvider } from "../apiKeys";
import { listOpenRouterModels, GROQ_MODELS, GEMINI_MODELS, CEREBRAS_MODELS, MISTRAL_MODELS } from "../providers/openrouterModels";
import { listSessions } from "../session";
import type { ClientMessage, ServerMessage } from "./protocol";
import type { LlmConfig } from "../types";

const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
const IGNORED_ENTRIES = new Set(["node_modules", ".git", "dist", "build"]);
const MAX_TREE_ENTRIES = 500;
const MAX_FILE_BYTES = 300_000;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/**
 * Node's http server listens on all interfaces by default (no host passed to
 * .listen()), so this is purely about *telling* the user how to reach it from
 * another device on the same network — a phone can't use "localhost".
 */
function getLanAddresses(): string[] {
  const results: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) results.push(addr.address);
    }
  }
  return results;
}

export function startWebServer(initialRoot: string, llmConfig: LlmConfig, yolo: boolean, port: number): void {
  let currentRoot = initialRoot;
  let currentModel = llmConfig.model;
  let currentApiKey = llmConfig.apiKey;
  addRecentFolder(currentRoot);

  const httpServer = http.createServer((req, res) => {
    try {
      handleHttp(req, res, currentRoot, llmConfig.provider, port);
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Internal error: ${err.message ?? err}`);
    }
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    const send = (msg: ServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    const sendInit = () => {
      send({
        type: "init",
        root: currentRoot,
        provider: llmConfig.provider,
        model: currentModel,
        yolo,
        recentFolders: loadRecentFolders(),
        sessionId: agent.getSessionId(),
        sessionTitle: agent.getSessionTitle(),
      });
    };
    const sendSessions = () => {
      send({ type: "sessions", sessions: listSessions(currentRoot), activeId: agent.getSessionId() });
    };

    const pending = new Map<string, (decision: PermissionDecision) => void>();
    const reporter = new WebSocketReporter(send);
    const confirmFn = createConfirmFn(send, pending);
    const permissions = new PermissionManager(yolo, confirmFn);
    let agent = new Agent(currentRoot, { ...llmConfig, model: currentModel, apiKey: currentApiKey }, permissions, reporter);
    agent.connectMcp().catch((err) => console.error("[coding-agent] MCP connect error:", err));

    sendInit();
    sendSessions();
    agent.replayCurrentState();

    ws.on("message", async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      try {
        if (msg.type === "user_message") {
          await agent.handleUserMessage(msg.text);
          sendSessions();
        } else if (msg.type === "permission_response") {
          const resolve = pending.get(msg.id);
          if (resolve) {
            pending.delete(msg.id);
            resolve(msg.decision);
          }
        } else if (msg.type === "switch_folder") {
          const target = path.resolve(msg.path);
          if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
            reporter.error(`Folder not found: ${target}`);
            return;
          }
          await agent.dispose();
          currentRoot = target;
          addRecentFolder(currentRoot);
          agent = new Agent(currentRoot, { ...llmConfig, model: currentModel, apiKey: currentApiKey }, permissions, reporter);
          agent.connectMcp().catch((err) => console.error("[coding-agent] MCP connect error:", err));
          sendInit();
          sendSessions();
          agent.replayCurrentState();
        } else if (msg.type === "switch_model") {
          const model = msg.model?.trim();
          if (!model) {
            reporter.error("No model specified.");
            return;
          }
          currentModel = model;
          agent.setModel(model);
          saveLastModel(llmConfig.provider, model);
          send({ type: "model_changed", model });
        } else if (msg.type === "new_session") {
          agent.startNewSession();
          sendInit();
          sendSessions();
          agent.replayCurrentState();
        } else if (msg.type === "switch_session") {
          agent.switchSession(msg.id);
          sendInit();
          sendSessions();
          agent.replayCurrentState();
        } else if (msg.type === "delete_session") {
          const wasActive = msg.id === agent.getSessionId();
          agent.deleteSession(msg.id);
          if (wasActive) {
            agent.startNewSession();
            sendInit();
            agent.replayCurrentState();
          }
          sendSessions();
        } else if (msg.type === "list_sessions") {
          sendSessions();
        } else if (msg.type === "update_global_instructions") {
          agent.setGlobalInstructions(msg.text);
          send({ type: "settings_saved", which: "instructions" });
        } else if (msg.type === "update_mcp_config") {
          const mcpPath = path.join(currentRoot, "mcp.json");
          fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers: msg.mcpServers }, null, 2), "utf-8");
          const toolCount = await agent.reloadMcp();
          send({ type: "mcp_reloaded", toolCount });
        } else if (msg.type === "rollback_request") {
          const { ok, restored } = agent.rollbackTransaction(msg.transactionId);
          send({ type: "rollback_result", transactionId: msg.transactionId, ok, restored });
        } else if (msg.type === "update_api_key") {
          const key = msg.apiKey?.trim();
          if (!key) {
            reporter.error("No API key provided.");
            return;
          }
          saveApiKey(msg.provider, key);
          if (msg.provider === llmConfig.provider) currentApiKey = key;
          send({ type: "settings_saved", which: "api_keys" });
        } else if (msg.type === "clear_api_key") {
          clearApiKey(msg.provider);
          if (msg.provider === llmConfig.provider) currentApiKey = undefined;
          send({ type: "settings_saved", which: "api_keys" });
        }
      } catch (err: any) {
        // A single bad request/response should never take the whole server
        // down — surface it to this client and keep the connection alive.
        console.error("[coding-agent] error handling message:", err);
        reporter.thinking(false);
        reporter.error(`Internal error: ${err.message ?? err}`);
      }
    });

    ws.on("close", () => {
      for (const resolve of pending.values()) resolve("deny");
      pending.clear();
      agent.dispose().catch(() => {});
    });
  });

  httpServer.listen(port, () => {
    console.log(`\nWrexlyn web UI running at http://localhost:${port}`);
    for (const addr of getLanAddresses()) {
      console.log(`  also reachable on your network at: http://${addr}:${port}  (e.g. from a phone on the same Wi-Fi)`);
    }
    console.log(`root: ${currentRoot}`);
    console.log(
      `model: ${llmConfig.provider} · ${currentModel}${yolo ? "  (yolo mode: all actions auto-approved)" : ""}\n`
    );
    if (API_KEY_PROVIDERS.includes(llmConfig.provider as ApiKeyProvider) && !llmConfig.apiKey) {
      console.log(`(no API key set for ${llmConfig.provider} yet — add one from Settings > API Keys in the web UI)\n`);
    }
  });
}

function handleHttp(req: http.IncomingMessage, res: http.ServerResponse, root: string, provider: string, port: number): void {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/tree") return handleTree(url, res, root);
  if (url.pathname === "/api/file") return handleFile(url, res, root);
  if (url.pathname === "/api/download") return handleDownload(url, res, root);
  if (url.pathname === "/api/upload" && req.method === "POST") return handleUpload(req, url, res, root);
  if (url.pathname === "/api/models") return void handleModels(res, provider);
  if (url.pathname === "/api/browse") return handleBrowse(url, res);
  if (url.pathname === "/api/browse/mkdir" && req.method === "POST") return handleMkdir(req, res);
  if (url.pathname === "/api/global-instructions") return handleGlobalInstructions(res);
  if (url.pathname === "/api/mcp-config") return handleMcpConfig(res, root);
  if (url.pathname === "/api/api-keys") return handleApiKeys(res);
  if (url.pathname === "/api/lan-info") return handleLanInfo(res, port);
  if (url.pathname === "/api/lan-qrcode") return void handleLanQrCode(res, port);

  serveStatic(url.pathname, res);
}

function handleLanInfo(res: http.ServerResponse, port: number): void {
  sendJson(res, 200, { port, addresses: getLanAddresses() });
}

/** SVG QR code encoding this machine's LAN URL, for scan-to-connect from a phone on the same network. */
async function handleLanQrCode(res: http.ServerResponse, port: number): Promise<void> {
  const [address] = getLanAddresses();
  if (!address) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("No LAN address found");
    return;
  }
  try {
    const svg = await QRCode.toString(`http://${address}:${port}`, { type: "svg", margin: 1, width: 220 });
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" });
    res.end(svg);
  } catch (err: any) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end(`Failed to generate QR code: ${err.message ?? err}`);
  }
}

/**
 * Lists the subdirectories of `path` for the "choose a project folder"
 * browser — deliberately not sandboxed to any project root, since its whole
 * purpose is picking where a project root should be. An empty/missing path
 * means "show the top level": drive letters on Windows, the home directory
 * elsewhere.
 */
function handleBrowse(url: URL, res: http.ServerResponse): void {
  let target = url.searchParams.get("path") || "";
  if (!target && process.platform !== "win32") target = os.homedir();

  if (!target) {
    const drives: Array<{ name: string; path: string; isDir: boolean }> = [];
    for (let i = 65; i <= 90; i++) {
      const letter = String.fromCharCode(i);
      const drivePath = `${letter}:\\`;
      if (fs.existsSync(drivePath)) drives.push({ name: `${letter}:`, path: drivePath, isDir: true });
    }
    return sendJson(res, 200, { path: null, parent: null, entries: drives, isDriveList: true });
  }

  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    return sendJson(res, 404, { error: `Not a directory: ${target}` });
  }

  let entries: Array<{ name: string; path: string; isDir: boolean }>;
  try {
    entries = fs
      .readdirSync(target, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, path: path.join(target, e.name), isDir: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err: any) {
    return sendJson(res, 403, { error: `Cannot read directory: ${err.message ?? err}` });
  }

  const normalized = path.resolve(target);
  const parentDir = path.dirname(normalized);
  const atRoot = parentDir === normalized; // "C:\\" or "/" — dirname of a root is itself
  const parent = atRoot ? (process.platform === "win32" ? "" : null) : parentDir;

  sendJson(res, 200, { path: normalized, parent, entries, isDriveList: false });
}

function handleMkdir(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let parentPath: string, name: string;
    try {
      const parsed = JSON.parse(body);
      parentPath = parsed.parentPath;
      name = parsed.name;
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON body" });
    }
    if (!parentPath || !name || typeof name !== "string") {
      return sendJson(res, 400, { error: "parentPath and name are required" });
    }
    if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
      return sendJson(res, 400, { error: "Invalid folder name" });
    }
    if (!fs.existsSync(parentPath) || !fs.statSync(parentPath).isDirectory()) {
      return sendJson(res, 400, { error: `Parent folder not found: ${parentPath}` });
    }
    const newPath = path.join(parentPath, name);
    if (fs.existsSync(newPath)) {
      return sendJson(res, 409, { error: "A file or folder with that name already exists" });
    }
    try {
      fs.mkdirSync(newPath);
      sendJson(res, 200, { path: newPath });
    } catch (err: any) {
      sendJson(res, 500, { error: err.message ?? String(err) });
    }
  });
}

function handleGlobalInstructions(res: http.ServerResponse): void {
  sendJson(res, 200, { text: loadGlobalInstructions() });
}

/** Never returns raw keys — just whether one is set and a masked hint, so the client can never leak/log a real key. */
function handleApiKeys(res: http.ServerResponse): void {
  const providers = API_KEY_PROVIDERS;
  const result: Record<string, { set: boolean; masked: string | null }> = {};
  for (const provider of providers) {
    const key = loadApiKey(provider);
    result[provider] = { set: !!key, masked: key ? maskApiKey(key) : null };
  }
  sendJson(res, 200, result);
}

function handleMcpConfig(res: http.ServerResponse, root: string): void {
  const mcpPath = path.join(root, "mcp.json");
  if (!fs.existsSync(mcpPath)) return sendJson(res, 200, { mcpServers: {} });
  try {
    const parsed = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    sendJson(res, 200, { mcpServers: parsed.mcpServers ?? {} });
  } catch (err: any) {
    sendJson(res, 200, { mcpServers: {}, error: `Failed to parse mcp.json: ${err.message ?? err}` });
  }
}

async function handleModels(res: http.ServerResponse, provider: string): Promise<void> {
  try {
    if (provider === "groq") return sendJson(res, 200, { models: GROQ_MODELS });
    if (provider === "openrouter") return sendJson(res, 200, { models: await listOpenRouterModels() });
    if (provider === "gemini") return sendJson(res, 200, { models: GEMINI_MODELS });
    if (provider === "cerebras") return sendJson(res, 200, { models: CEREBRAS_MODELS });
    if (provider === "mistral") return sendJson(res, 200, { models: MISTRAL_MODELS });
    return sendJson(res, 200, {
      models: [],
      note: "Pollinations doesn't support model selection for tool-calling.",
    });
  } catch (err: any) {
    sendJson(res, 502, { error: `Failed to fetch model list: ${err.message ?? err}` });
  }
}

function handleTree(url: URL, res: http.ServerResponse, root: string): void {
  const relPath = url.searchParams.get("path") || ".";
  let dirPath: string;
  try {
    dirPath = resolveInRoot(root, relPath);
  } catch (err: any) {
    return sendJson(res, 400, { error: err.message });
  }

  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return sendJson(res, 404, { error: "not a directory" });
  }

  const entries = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((e) => !IGNORED_ENTRIES.has(e.name) && !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_TREE_ENTRIES)
    .map((e) => ({ name: e.name, isDir: e.isDirectory() }));

  sendJson(res, 200, { path: relPath, entries });
}

function handleFile(url: URL, res: http.ServerResponse, root: string): void {
  const relPath = url.searchParams.get("path");
  if (!relPath) return sendJson(res, 400, { error: "missing path" });

  let filePath: string;
  try {
    filePath = resolveInRoot(root, relPath);
  } catch (err: any) {
    return sendJson(res, 400, { error: err.message });
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendJson(res, 404, { error: "file not found" });
  }

  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    return sendJson(res, 200, {
      path: relPath,
      truncated: true,
      content: `(file too large to preview: ${stat.size} bytes)`,
    });
  }

  const buf = fs.readFileSync(filePath);
  if (isBinaryBuffer(buf)) {
    return sendJson(res, 200, { path: relPath, truncated: false, binary: true, content: null });
  }
  sendJson(res, 200, { path: relPath, truncated: false, binary: false, content: buf.toString("utf-8") });
}

/** Git's own heuristic: a NUL byte in the first few KB means "don't treat this as text". */
function isBinaryBuffer(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8000);
  return sample.includes(0);
}

function handleDownload(url: URL, res: http.ServerResponse, root: string): void {
  const relPath = url.searchParams.get("path");
  if (!relPath) return sendJson(res, 400, { error: "missing path" });

  let filePath: string;
  try {
    filePath = resolveInRoot(root, relPath);
  } catch (err: any) {
    return sendJson(res, 400, { error: err.message });
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendJson(res, 404, { error: "file not found" });
  }

  const filename = path.basename(filePath);
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  fs.createReadStream(filePath).pipe(res);
}

function handleUpload(req: http.IncomingMessage, url: URL, res: http.ServerResponse, root: string): void {
  const relPath = url.searchParams.get("path");
  if (!relPath) return sendJson(res, 400, { error: "missing path" });

  let filePath: string;
  try {
    filePath = resolveInRoot(root, relPath);
  } catch (err: any) {
    return sendJson(res, 400, { error: err.message });
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let aborted = false;

  req.on("data", (chunk: Buffer) => {
    if (aborted) return;
    totalBytes += chunk.length;
    if (totalBytes > MAX_UPLOAD_BYTES) {
      aborted = true;
      sendJson(res, 413, { error: `File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB upload limit` });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    if (aborted) return;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, Buffer.concat(chunks));
      sendJson(res, 200, { ok: true, path: relPath, bytes: totalBytes });
    } catch (err: any) {
      sendJson(res, 500, { error: err.message ?? String(err) });
    }
  });

  req.on("error", (err) => {
    if (!aborted) sendJson(res, 500, { error: err.message });
  });
}

function serveStatic(pathname: string, res: http.ServerResponse): void {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  if (safePath.includes("..")) {
    res.writeHead(400).end("bad path");
    return;
  }

  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    return;
  }

  const ext = path.extname(filePath);
  // This app iterates on public/ frequently; without this, browsers can keep
  // serving a stale cached app.js/background.js/style.css after a restart.
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
