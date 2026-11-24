import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./server";
import { connectDB } from "@/lib/db/connect";

interface ServerEntry {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  connected: boolean;
}

const serverPool = new Map<string, ServerEntry>();
let dbConnected = false;

async function ensureDb(): Promise<void> {
  if (!dbConnected) {
    await connectDB();
    dbConnected = true;
  }
}

function createSessionId(): string {
  return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function getOrCreateServer(clerkUserId: string): Promise<ServerEntry> {
  await ensureDb();

  let entry = serverPool.get(clerkUserId);
  if (entry) return entry;

  const server = createMcpServer(clerkUserId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: createSessionId,
    enableJsonResponse: false,
  });

  entry = { server, transport, connected: false };
  serverPool.set(clerkUserId, entry);

  await server.connect(transport);
  entry.connected = true;

  return entry;
}

export async function handleMcpRequest(
  request: Request,
  clerkUserId: string,
): Promise<Response> {
  const entry = await getOrCreateServer(clerkUserId);
  return entry.transport.handleRequest(request);
}

export function getPoolSize(): number {
  return serverPool.size;
}