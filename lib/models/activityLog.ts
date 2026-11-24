import { Schema, type Connection, type Model } from "mongoose";

const ACTOR_TYPES = ["human", "assistant"] as const;
const OPERATION_TYPES = ["read", "write", "approve", "reject", "generate", "validate", "repair", "cancel"] as const;
const RESULT_TYPES = ["success", "failure", "pending"] as const;

const ActivityLogSchema = new Schema(
  {
    clerkUserId: { type: String, required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, default: null, index: true },
    actorType: { type: String, enum: ACTOR_TYPES, required: true },
    actorId: { type: String, required: true },
    assistantName: { type: String, default: null },
    tool: { type: String, required: true },
    operation: { type: String, enum: OPERATION_TYPES, required: true },
    target: { type: String, required: true },
    result: { type: String, enum: RESULT_TYPES, required: true },
    details: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: "activitylogs" }
);

ActivityLogSchema.index({ clerkUserId: 1, projectId: 1, createdAt: -1 });
ActivityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export function activityLogModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.StudioActivityLog;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("StudioActivityLog", ActivityLogSchema) as unknown as Model<Record<string, unknown>>;
}