import { Schema, type Connection, type Model } from "mongoose";

export type ProjectMemoryShape = {
  clerkUserId: string;
  projectId: Schema.Types.ObjectId;
  category: string;
  key: string;
  value: string;
  source: string;
  status: string;
  conversationId: Schema.Types.ObjectId | null;
  messageIds: Schema.Types.ObjectId[];
};

const ProjectMemorySchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    category: {
      type: String,
      enum: ["identity", "story", "development", "technical"],
      required: true,
    },
    key: { type: String, required: true },
    value: { type: String, required: true },
    source: {
      type: String,
      enum: ["user_decision", "assistant_proposal", "mcp_result", "canon", "correction"],
      required: true,
    },
    status: {
      type: String,
      enum: ["confirmed", "proposed", "rejected", "superseded"],
      default: "proposed",
    },
    conversationId: { type: Schema.Types.ObjectId, default: null },
    messageIds: [{ type: Schema.Types.ObjectId }],
  },
  { timestamps: true, collection: "projectMemories" }
);

ProjectMemorySchema.index({ clerkUserId: 1, projectId: 1, category: 1, key: 1 });
ProjectMemorySchema.index({ clerkUserId: 1, projectId: 1, status: 1 });
ProjectMemorySchema.index({ value: "text" });

export function projectMemoryModel(connection: Connection): Model<ProjectMemoryShape> {
  return (
    (connection.models.StudioProjectMemory as Model<ProjectMemoryShape> | undefined) ??
    connection.model<ProjectMemoryShape>("StudioProjectMemory", ProjectMemorySchema)
  );
}