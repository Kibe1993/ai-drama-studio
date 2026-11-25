import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@/lib/mcp/server";
import { isExposed, requiresApproval } from "./toolRegistry";
import type { McpToolSchema } from "./types";

export type McpToolResult = {
  name: string;
  args: Record<string, unknown>;
  result: string;
  status: "success" | "error";
  requiresApproval: boolean;
};

export class McpToolExecutor {
  private client: Client | null = null;
  private initialized = false;

  async initialize(clerkUserId: string): Promise<void> {
    if (this.initialized) return;
    const server = createMcpServer(clerkUserId);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    this.client = new Client({ name: "assistant", version: "1.0.0" });
    await this.client.connect(clientTransport);
    this.initialized = true;
  }

  async listExposedTools(): Promise<McpToolSchema[]> {
    if (!this.client) return [];
    const result = await this.client.listTools();
    return result.tools
      .filter((t) => isExposed(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
      }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (!this.client) {
      return { name, args, result: "MCP client not initialized", status: "error", requiresApproval: false };
    }
    try {
      const result = await this.client.callTool({ name, arguments: args });
      const textParts = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      return {
        name,
        args,
        result: textParts || JSON.stringify(result),
        status: "success",
        requiresApproval: requiresApproval(name),
      };
    } catch (cause) {
      return {
        name,
        args,
        result: cause instanceof Error ? cause.message : "Tool execution failed",
        status: "error",
        requiresApproval: requiresApproval(name),
      };
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this.initialized = false;
  }
}

const executorPool = new Map<string, McpToolExecutor>();

export async function getToolExecutor(clerkUserId: string): Promise<McpToolExecutor> {
  let executor = executorPool.get(clerkUserId);
  if (!executor) {
    executor = new McpToolExecutor();
    await executor.initialize(clerkUserId);
    executorPool.set(clerkUserId, executor);
  }
  return executor;
}