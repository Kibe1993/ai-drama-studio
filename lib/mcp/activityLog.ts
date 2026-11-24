import { z } from "zod";
import { activityLogRepository } from "@/lib/repositories/activityLogRepository";

export interface ActivityEntry {
  id: string;
  timestamp: string;
  tool: string;
  clerkUserId: string;
  projectId: string | null;
  detail: string;
  result: "success" | "error";
  assistantName: string | null;
}

const activityLog: ActivityEntry[] = [];
const MAX_ENTRIES = 1000;

export function logActivity(
  tool: string,
  clerkUserId: string,
  projectId: string | null,
  detail: string,
  result: "success" | "error",
  assistantName: string | null = null,
): void {
  const entry: ActivityEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date().toISOString(),
    tool,
    clerkUserId,
    projectId,
    detail,
    result,
    assistantName,
  };
  activityLog.unshift(entry);
  if (activityLog.length > MAX_ENTRIES) {
    activityLog.length = MAX_ENTRIES;
  }
  void activityLogRepository.insert({
    clerkUserId,
    projectId,
    actorType: "assistant",
    actorId: clerkUserId,
    assistantName,
    tool,
    operation: tool.includes(".") ? "write" : "read",
    target: tool.split(".")[0] ?? "unknown",
    result: result === "success" ? "success" : "failure",
    details: { detail },
  });
}

export function getActivityLog(
  clerkUserId: string,
  options?: {
    projectId?: string;
    limit?: number;
    tool?: string;
  },
): ActivityEntry[] {
  let entries = activityLog.filter((e) => e.clerkUserId === clerkUserId);
  if (options?.projectId) {
    entries = entries.filter((e) => e.projectId === options.projectId);
  }
  if (options?.tool) {
    entries = entries.filter((e) => e.tool === options.tool);
  }
  return entries.slice(0, options?.limit ?? 50);
}

export async function getActivityLogFromDb(
  clerkUserId: string,
  options?: {
    projectId?: string;
    limit?: number;
    tool?: string;
  },
): Promise<ActivityEntry[]> {
  const records = await activityLogRepository.list(clerkUserId, options);
  return records.map((r) => ({
    id: r.id,
    timestamp: r.createdAt,
    tool: r.tool,
    clerkUserId: r.clerkUserId,
    projectId: r.projectId,
    detail: String(r.details.detail ?? ""),
    result: r.result === "success" ? "success" : "error",
    assistantName: r.assistantName,
  }));
}

export const activityQuerySchema = z.object({
  projectId: z.string().optional().describe("Filter by project ID"),
  limit: z.number().int().min(1).max(200).default(50).describe("Maximum entries to return"),
  tool: z.string().optional().describe("Filter by tool name"),
});