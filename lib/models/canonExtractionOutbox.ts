import { Schema, type Connection, type Model } from "mongoose";

export const OUTBOX_STATUSES = [
  "pending",
  "dispatched",
  "completed",
  "failed",
] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export type CanonExtractionOutboxShape = {
  clerkUserId: string;
  projectId: string;
  episodeId: string;
  storyId: string;
  commitBatchId: string;
  status: OutboxStatus;
  error: string | null;
  createdAt: Date;
  dispatchedAt: Date | null;
  completedAt: Date | null;
};

const canonExtractionOutboxSchema = new Schema(
  {
    clerkUserId: { type: String, required: true, trim: true, index: true },
    projectId: { type: String, required: true, trim: true, index: true },
    episodeId: { type: String, required: true, trim: true },
    storyId: { type: String, required: true, trim: true },
    commitBatchId: { type: String, required: true, trim: true },
    status: { type: String, enum: OUTBOX_STATUSES, required: true, default: "pending" },
    error: { type: String, default: null },
    createdAt: { type: Date, required: true, default: Date.now },
    dispatchedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "canonExtractionOutbox" },
);

canonExtractionOutboxSchema.index(
  { clerkUserId: 1, projectId: 1, episodeId: 1, commitBatchId: 1 },
  { unique: true },
);
canonExtractionOutboxSchema.index({ status: 1, createdAt: 1 });

export function canonExtractionOutboxModel(
  connection: Connection,
): Model<CanonExtractionOutboxShape> {
  return (
    (connection.models.StudioCanonExtractionOutbox as
      | Model<CanonExtractionOutboxShape>
      | undefined) ??
    connection.model<CanonExtractionOutboxShape>(
      "StudioCanonExtractionOutbox",
      canonExtractionOutboxSchema,
    )
  );
}