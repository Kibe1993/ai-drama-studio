import { auth } from "@clerk/nextjs/server";
import { handleMcpRequest } from "@/lib/mcp/httpServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveUserId(request: Request): Promise<string | null> {
  const authResult = await auth();
  if (authResult.userId) return authResult.userId;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const envToken = process.env.MCP_AUTH_TOKEN?.trim();
    const envUser = process.env.MCP_ACTOR_USER_ID?.trim();
    if (envToken && envUser && token === envToken) {
      return envUser;
    }
  }

  return null;
}

export async function POST(request: Request): Promise<Response> {
  const userId = await resolveUserId(request);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    return await handleMcpRequest(request, userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function GET(request: Request): Promise<Response> {
  const userId = await resolveUserId(request);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    return await handleMcpRequest(request, userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const userId = await resolveUserId(request);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    return await handleMcpRequest(request, userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}