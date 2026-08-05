/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import * as path from "path";
import type { ToolDefinition, ToolExecResult } from "./types";

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
  env?: Record<string, string>;
}

interface McpConfigFile {
  mcpServers?: Record<string, McpServerConfig>;
}

/** Tool names exposed to the model are namespaced mcp__<server>__<tool> to avoid colliding with built-ins. */
const NAMESPACE_PREFIX = "mcp__";

interface ConnectedServer {
  name: string;
  client: McpClient;
  transport: McpTransport;
}

/**
 * Connects to MCP servers configured in <root>/mcp.json (same shape as Claude
 * Desktop / VS Code's config: {"mcpServers": {"name": {"command", "args"}}}),
 * merges their tools into the agent's tool list, and routes calls back to the
 * right server. A server that fails to start is skipped, not fatal.
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
          log(`Failed to connect MCP server "${serverName}": ${err.message ?? err}`);
        }
      })
    );
  }

  private async connectOne(serverName: string, config: McpServerConfig): Promise<number> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env,
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
      return { ok: false, output: `MCP tool call failed: ${err.message ?? err}` };
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
