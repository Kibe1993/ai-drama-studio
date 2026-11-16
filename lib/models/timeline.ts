import { Schema, type Connection, type Model } from "mongoose";

const TimelineClipSchema = new Schema({
  assetId: { type: Schema.Types.ObjectId, required: true },
  startSeconds: { type: Number, default: 0, min: 0 },
  durationSeconds: { type: Number, required: true, min: 0.1 },
  audioOffsetSeconds: { type: Number, default: 0 },
  transition: { type: String, default: "", maxlength: 60 },
  optional: { type: Boolean, default: false },
}, { _id: false });

const TimelineTrackSchema = new Schema({
  kind: { type: String, enum: ["video", "dialogue", "narration", "music", "sfx", "subtitle"], required: true },
  clips: { type: [TimelineClipSchema], default: [] },
}, { _id: false });

const ValidationResultSchema = new Schema({
  missingAssets: { type: [String], default: [] },
  overlaps: { type: [Schema.Types.Mixed], default: [] },
  brokenReferences: { type: [String], default: [] },
  durationMismatch: { type: Boolean, default: false },
  warnings: { type: [String], default: [] },
}, { _id: false });

const TimelineSchema = new Schema({
  clerkUserId: { type: String, required: true },
  projectId: { type: Schema.Types.ObjectId, required: true },
  episodeId: { type: Schema.Types.ObjectId, required: true },
  tracks: { type: [TimelineTrackSchema], default: [] },
  aspectRatio: { type: String, default: "16:9", maxlength: 10 },
  outputResolution: { type: String, default: "1920x1080", maxlength: 20 },
  frameRate: { type: Number, default: 30, min: 1 },
  episodeTargetDurationSeconds: { type: Number, default: null, min: 0 },
  status: { type: String, enum: ["draft", "under_review", "approved", "stale"], default: "draft" },
  validation: { type: ValidationResultSchema, default: {} },
  idempotencyKey: { type: String, required: true, maxlength: 180 },
  sourceCanonVersion: { type: Number, default: null },
  canonStale: { type: Boolean, default: false },
  canonStaleReason: { type: String, default: "", maxlength: 600 },
}, { timestamps: true, collection: "timelines" });

TimelineSchema.index({ clerkUserId: 1, episodeId: 1 }, { unique: true });
TimelineSchema.index({ clerkUserId: 1, projectId: 1, status: 1 });

export function timelineModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.Timeline;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("Timeline", TimelineSchema) as unknown as Model<Record<string, unknown>>;
}