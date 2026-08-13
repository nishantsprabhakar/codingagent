/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import * as path from "path";
import type { ToolDefinition, ToolExecResult } from "./types";
import { redact } from "./errors";

// The SDK's subpath exports (package.json "exports" map) aren't resolvable
// under this project's CommonJS/"Node" moduleResolution without switching the
// whole project to NodeNext (which would require explicit .js extensions on
// every relative import elsewhere). require() sidesteps TS's module
// resolution for just these two lines; the interfaces below give the rest of
// this file normal type safety for how we actually use them.
interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
}

interface McpClient {
  connect(transport: McpTransport): Promise<void>;
  listTools(): Promise<{ tools: McpTool[] }>;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<McpToolResult>;
}

interface McpTransport {
  close(): Promise<void>;
}

interface McpClientConstructor {
  new (info: { name: string; version: string }): McpClient;
}

interface StdioTransportConstructor {
  new (params: { command: string; args?: string[]; env?: Record<string, string> }): McpTransport;
}

const { Client } = require("@modelcontextprotocol/sdk/client") as { Client: McpClientConstructor };
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js") as {
  StdioClientTransport: StdioTransportConstructor;
};

interface McpServerConfig {
  command: string;
  args?: string[];
  /** Literal env vars for this server — values are used as-is, never interpolated from the parent process. */
  env?: Record<string, string>;
  /**
   * Names of parent-process env vars this server is explicitly allowed to receive (values pulled
   * live from `process.env` at connect time, not hardcoded into mcp.json). Absent by default — a
   * server config that names nothing here gets none of the app's own secrets (see
   * buildMcpServerEnv() for the full rationale). The underlying SDK transport always adds its own
   * small OS-appropriate base allowlist (PATH, etc.) on top of whatever this produces.
   */
  envPassthrough?: string[];
}

interface McpConfigFile {
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * Computes the env object passed to an MCP server's child process — the one thing this module
 * owns and can audit, rather than relying on the @modelcontextprotocol/sdk transport's own
 * implicit default-env behavior (which is safe today but is a third-party dependency's internal
 * choice, not something this codebase asserts or tests). Deliberately NOT `process.env` wholesale:
 * a server gets literal `config.env` values plus, for each name in `config.envPassthrough`, that
 * name's CURRENT value from `parentEnv` — nothing else, so a server config can't accidentally (or
 * a compromised mcp.json can't silently) see e.g. GROQ_API_KEY unless it's explicitly named.
 * Returns undefined (not {}) when there's truly nothing to add, so the transport's own default
 * merge behavior is unchanged from before this existed.
 */
export function buildMcpServerEnv(config: McpServerConfig, parentEnv: NodeJS.ProcessEnv): Record<string, string> | undefined {
  const result: Record<string, string> = { ...(config.env ?? {}) };
  for (const name of config.envPassthrough ?? []) {
    const value = parentEnv[name];
    if (value !== undefined) result[name] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Tool names exposed to the model are namespaced mcp__<server>__<tool> to avoid colliding with built-ins. */
const NAMESPACE_PREFIX = "mcp__";

interface ConnectedServer {
  name: string;
  client: McpClient;
  transport: McpTransport;
}

/**
 * Connects to MCP servers configured in <root>/mcp.json (the standard MCP
 * config shape most editors and AI tool clients use:
 * {"mcpServers": {"name": {"command", "args"}}}), merges their tools into
 * the agent's tool list, and routes calls back to the right server. A
 * server that fails to start is skipped, not fatal.
 */
export class McpManager {
  private servers: ConnectedServer[] = [];
  private definitions: ToolDefinition[] = [];

  getToolDefinitions(): ToolDefinition[] {
    return this.definitions;
  }

  isMcpTool(name: string): boolean {
    return name.startsWith(NAMESPACE_PREFIX);
  }

  hasServers(): boolean {
    return this.servers.length > 0;
  }

  /** Connects to every configured server in parallel; logs (via `log`) rather than throwing on a per-server failure. */
  async connectAll(root: string, log: (message: string) => void): Promise<void> {
    const config = loadMcpConfig(root);
    if (!config?.mcpServers) return;

    await Promise.all(
      Object.entries(config.mcpServers).map(async ([serverName, serverConfig]) => {
        try {
          const toolCount = await this.connectOne(serverName, serverConfig);
          log(`Connected MCP server "${serverName}" (${toolCount} tool${toolCount === 1 ? "" : "s"})`);
        } catch (err: any) {
          // A spawn/handshake failure can echo back the command/args/env it was given — redact
          // this server's own configured secrets (its `env`/`envPassthrough` values) before ever
          // surfacing the message, since those are exactly the kind of thing that could appear here.
          const serverSecrets = Object.values(buildMcpServerEnv(serverConfig, process.env) ?? {});
          log(`Failed to connect MCP server "${serverName}": ${redact(err.message ?? String(err), serverSecrets)}`);
        }
      })
    );
  }

  private async connectOne(serverName: string, config: McpServerConfig): Promise<number> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: buildMcpServerEnv(config, process.env),
    });
    const client = new Client({ name: "coding-agent", version: "0.1.0" });
    await client.connect(transport);

    const { tools } = await client.listTools();
    for (const tool of tools) {
      this.definitions.push({
        type: "function",
        function: {
          name: `${NAMESPACE_PREFIX}${serverName}__${tool.name}`,
          description: `[MCP: ${serverName}] ${tool.description ?? tool.name}`,
          parameters: tool.inputSchema ?? { type: "object", properties: {} },
        },
      });
    }

    this.servers.push({ name: serverName, client, transport });
    return tools.length;
  }

  async callTool(namespacedName: string, args: unknown): Promise<ToolExecResult> {
    const rest = namespacedName.slice(NAMESPACE_PREFIX.length);
    const sepIdx = rest.indexOf("__");
    if (sepIdx === -1) return { ok: false, output: `Malformed MCP tool name: ${namespacedName}` };

    const serverName = rest.slice(0, sepIdx);
    const toolName = rest.slice(sepIdx + 2);
    const server = this.servers.find((s) => s.name === serverName);
    if (!server) return { ok: false, output: `No connected MCP server named "${serverName}"` };

    try {
      const result = await server.client.callTool({ name: toolName, arguments: (args as Record<string, unknown>) ?? {} });
      return { ok: !result.isError, output: extractTextContent(result) };
    } catch (err: any) {
      return { ok: false, output: `MCP tool call failed: ${redact(err.message ?? String(err))}` };
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.servers.map((s) => s.transport.close().catch(() => {})));
  }
}

function extractTextContent(result: McpToolResult): string {
  if (!Array.isArray(result?.content)) return JSON.stringify(result ?? null);
  const textParts = result.content.filter((c) => c.type === "text" && c.text).map((c) => c.text as string);
  return textParts.length ? textParts.join("\n") : JSON.stringify(result.content);
}

function loadMcpConfig(root: string): McpConfigFile | null {
  const filePath = path.join(root, "mcp.json");
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err: any) {
    console.error(`[coding-agent] warning: failed to parse mcp.json: ${err.message ?? err}`);
    return null;
  }
}
