import { Schema, type Connection, type Model } from "mongoose";
import { MEDIA_ASSET_TYPES, MEDIA_REVIEW_STATUSES, MEDIA_VALIDATION_STATUSES } from "@/lib/validation/mediaAsset";

const MediaAssetSchema = new Schema({
  clerkUserId: { type: String, required: true },
  projectId: { type: Schema.Types.ObjectId, required: true },
  episodeId: { type: Schema.Types.ObjectId, default: null },
  sceneId: { type: Schema.Types.ObjectId, default: null },
  shotId: { type: String, default: null, maxlength: 120 },
  generationJobId: { type: Schema.Types.ObjectId, default: null },
  type: { type: String, enum: MEDIA_ASSET_TYPES, required: true },
  provider: { type: String, required: true, maxlength: 80 },
  model: { type: String, default: "", maxlength: 160 },
  idempotencyKey: { type: String, required: true, maxlength: 180 },
  storageProvider: { type: String, enum: ["local", "s3", "cloudinary"], required: true },
  storageKey: { type: String, required: true, maxlength: 500 },
  mimeType: { type: String, required: true, maxlength: 120 },
  fileName: { type: String, required: true, maxlength: 160 },
  byteSize: { type: Number, required: true, min: 1 },
  sha256: { type: String, required: true, match: /^[a-f\d]{64}$/ },
  durationSeconds: { type: Number, default: null, min: 0 },
  width: { type: Number, default: null, min: 1 },
  height: { type: Number, default: null, min: 1 },
  frameRate: { type: Number, default: null, min: 0 },
  metadata: { type: Schema.Types.Mixed, default: {} },
  validationStatus: { type: String, enum: MEDIA_VALIDATION_STATUSES, required: true },
  storageVerified: { type: Boolean, required: true, default: false },
  reviewStatus: { type: String, enum: MEDIA_REVIEW_STATUSES, default: "pending" },
}, { timestamps: true, collection: "mediaAssets" });

MediaAssetSchema.index({ clerkUserId: 1, idempotencyKey: 1 }, { unique: true });
MediaAssetSchema.index({ clerkUserId: 1, projectId: 1, type: 1, createdAt: -1 });
MediaAssetSchema.index({ clerkUserId: 1, generationJobId: 1, type: 1 });
MediaAssetSchema.index({ clerkUserId: 1, sceneId: 1 });

export function mediaAssetModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.MediaAsset;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("MediaAsset", MediaAssetSchema) as unknown as Model<Record<string, unknown>>;
}
