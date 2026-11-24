import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getActivityLog } from "@/lib/mcp/activityLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const authResult = await auth();
  if (!authResult.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const tool = url.searchParams.get("tool") ?? undefined;

  const entries = getActivityLog(authResult.userId, { projectId, limit, tool });
  return NextResponse.json({ entries });
}