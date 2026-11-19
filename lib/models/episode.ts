import { Schema, type Connection, type Model } from "mongoose";
import { EPISODE_STATUSES } from "@/lib/validation/episode";

const EpisodeSchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    episodeNumber: { type: Number, required: true, min: 1 },
    title: { type: String, required: true, maxlength: 120 },
    premise: { type: String, default: "", maxlength: 3000 },
    targetDurationSeconds: { type: Number, required: true },
    status: { type: String, enum: EPISODE_STATUSES, default: "draft" },
    currentStoryId: { type: Schema.Types.ObjectId, default: null },
    baseSnapshotVersion: { type: Number, default: 0, min: 0 },
    basePlanVersion: { type: Number, default: 0, min: 0 },
    timelineId: { type: Schema.Types.ObjectId, default: null },
    renderAssetId: { type: Schema.Types.ObjectId, default: null },
    canonExtractionStatus: {
      type: String,
      enum: [
        "extraction_pending",
        "extraction_processing",
        "canon_committed",
        "canon_committed_with_issues",
        "extraction_failed",
      ],
      default: null,
      index: true,
    },
    canonExtractionError: { type: String, default: null },
  },
  { timestamps: true, collection: "episodes" }
);

EpisodeSchema.index({ clerkUserId: 1, projectId: 1, episodeNumber: 1 }, { unique: true });
EpisodeSchema.index({ clerkUserId: 1, projectId: 1, status: 1 });

export function episodeModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.StudioEpisode;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("StudioEpisode", EpisodeSchema) as unknown as Model<Record<string, unknown>>;
}
