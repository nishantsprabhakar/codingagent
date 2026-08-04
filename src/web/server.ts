import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { Agent } from "../agent";
import { PermissionManager, type PermissionDecision } from "../permissions";
import { resolveInRoot } from "../tools/paths";
import { WebSocketReporter, createConfirmFn } from "./reporter";
import type { ClientMessage, ServerMessage } from "./protocol";
import type { LlmConfig } from "../types";

const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
const IGNORED_ENTRIES = new Set(["node_modules", ".git", "dist", "build"]);
const MAX_TREE_ENTRIES = 500;
const MAX_FILE_BYTES = 300_000;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export function startWebServer(root: string, llmConfig: LlmConfig, yolo: boolean, port: number): void {
  const httpServer = http.createServer((req, res) => {
    try {
      handleHttp(req, res, root);
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

    const pending = new Map<string, (decision: PermissionDecision) => void>();
    const reporter = new WebSocketReporter(send);
    const confirmFn = createConfirmFn(send, pending);
    const permissions = new PermissionManager(yolo, confirmFn);
    const agent = new Agent(root, llmConfig, permissions, reporter);
    agent.connectMcp().catch((err) => console.error("[coding-agent] MCP connect error:", err));

    send({ type: "init", root, provider: llmConfig.provider, model: llmConfig.model, yolo });

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
        } else if (msg.type === "permission_response") {
          const resolve = pending.get(msg.id);
          if (resolve) {
            pending.delete(msg.id);
            resolve(msg.decision);
          }
        } else if (msg.type === "reset") {
          agent.reset();
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
    console.log(`\ncoding-agent web UI running at http://localhost:${port}`);
    console.log(`root: ${root}`);
    console.log(
      `model: ${llmConfig.provider} · ${llmConfig.model}${yolo ? "  (yolo mode: all actions auto-approved)" : ""}\n`
    );
  });
}

function handleHttp(req: http.IncomingMessage, res: http.ServerResponse, root: string): void {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/tree") return handleTree(url, res, root);
  if (url.pathname === "/api/file") return handleFile(url, res, root);

  serveStatic(url.pathname, res);
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

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    sendJson(res, 200, { path: relPath, truncated: false, content });
  } catch {
    sendJson(res, 200, { path: relPath, truncated: false, content: "(binary file, cannot preview)" });
  }
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
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
