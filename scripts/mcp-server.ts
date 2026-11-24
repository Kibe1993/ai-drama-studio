import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connectDB } from "@/lib/db/connect";
import { createMcpServer } from "@/lib/mcp/server";
import { log } from "@/lib/log";

async function main(): Promise<void> {
  const clerkUserId = process.env.MCP_ACTOR_USER_ID?.trim();
  if (!clerkUserId) {
    process.stderr.write(
      "MCP_ACTOR_USER_ID is required. Set it to the Clerk user ID that owns the projects you want to access.\n",
    );
    process.exit(1);
  }

  if (!process.env.MONGODB_URI) {
    process.stderr.write("MONGODB_URI is required.\n");
    process.exit(1);
  }

  log.info("mcp", "starting MCP server", { actor: clerkUserId });

  await connectDB();

  const server = createMcpServer(clerkUserId);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info("mcp", "MCP server connected via stdio");

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(`MCP server failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});