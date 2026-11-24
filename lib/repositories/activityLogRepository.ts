import { connectDB } from "@/lib/db/connect";
import { activityLogModel } from "@/lib/models/activityLog";
import { isObjectId } from "@/lib/repositories/ownership";

export type ActivityLogRecord = {
  id: string;
  clerkUserId: string;
  projectId: string | null;
  actorType: "human" | "assistant";
  actorId: string;
  assistantName: string | null;
  tool: string;
  operation: string;
  target: string;
  result: "success" | "failure" | "pending";
  details: Record<string, unknown>;
  createdAt: string;
};

type ActivityDoc = Record<string, unknown>;

function toRecord(doc: ActivityDoc): ActivityLogRecord {
  return {
    id: String(doc._id),
    clerkUserId: String(doc.clerkUserId),
    projectId: doc.projectId ? String(doc.projectId) : null,
    actorType: doc.actorType as "human" | "assistant",
    actorId: String(doc.actorId),
    assistantName: (doc.assistantName as string | null) ?? null,
    tool: String(doc.tool),
    operation: String(doc.operation),
    target: String(doc.target),
    result: doc.result as "success" | "failure" | "pending",
    details: (doc.details as Record<string, unknown>) ?? {},
    createdAt: (doc.createdAt as Date).toISOString(),
  };
}

export const activityLogRepository = {
  async insert(entry: Omit<ActivityLogRecord, "id" | "createdAt">): Promise<void> {
    try {
      const conn = await connectDB();
      const ActivityLog = activityLogModel(conn);
      await ActivityLog.create(entry);
    } catch {
      // Fire-and-forget: don't let logging failures break tool calls
    }
  },

  async list(clerkUserId: string, options?: { projectId?: string; tool?: string; limit?: number }): Promise<ActivityLogRecord[]> {
    const conn = await connectDB();
    const ActivityLog = activityLogModel(conn);
    const query: Record<string, unknown> = { clerkUserId };
    if (options?.projectId && isObjectId(options.projectId)) query.projectId = options.projectId;
    if (options?.tool) query.tool = options.tool;
    const docs = await ActivityLog.find(query).sort({ createdAt: -1 }).limit(options?.limit ?? 50).lean<ActivityDoc[]>();
    return docs.map(toRecord);
  },
};