import { Schema, type Connection, type Model } from "mongoose";
import {
  AUDIO_SEGMENT_KINDS,
  AUDIO_SEGMENT_STATUSES,
  AUDIO_SPEAKER_TYPES,
} from "@/lib/validation/audioSegment";

const AudioSegmentSchema = new Schema({
  clerkUserId: { type: String, required: true },
  projectId: { type: Schema.Types.ObjectId, required: true },
  episodeId: { type: Schema.Types.ObjectId, default: null },
  runId: { type: Schema.Types.ObjectId, required: true },
  storyId: { type: Schema.Types.ObjectId, required: true },
  sceneNumber: { type: Number, required: true, min: 1, max: 50 },
  sequence: { type: Number, required: true, min: 0, max: 999 },
  speakerType: { type: String, enum: AUDIO_SPEAKER_TYPES, required: true },
  speakerName: { type: String, required: true, maxlength: 160 },
  canonicalEntityId: { type: Schema.Types.ObjectId, default: null },
  voiceProfileId: { type: Schema.Types.ObjectId, default: null },
  voiceIdentifier: { type: String, required: true, maxlength: 160 },
  text: { type: String, required: true, maxlength: 500 },
  kind: { type: String, enum: AUDIO_SEGMENT_KINDS, required: true },
  status: { type: String, enum: AUDIO_SEGMENT_STATUSES, required: true, default: "pending" },
  mediaAssetId: { type: Schema.Types.ObjectId, default: null },
  durationSeconds: { type: Number, default: null, min: 0 },
  error: { type: String, default: null, maxlength: 500 },
  attempts: { type: Number, default: 0, min: 0 },
  idempotencyKey: { type: String, required: true, maxlength: 180 },
  sourceCanonVersion: { type: Number, default: null },
  canonStale: { type: Boolean, default: false },
  canonStaleReason: { type: String, default: "", maxlength: 600 },
}, { timestamps: true, collection: "audioSegments" });

AudioSegmentSchema.index({ clerkUserId: 1, runId: 1, sceneNumber: 1, sequence: 1 }, { unique: true });
AudioSegmentSchema.index({ clerkUserId: 1, runId: 1, status: 1 });
AudioSegmentSchema.index({ clerkUserId: 1, projectId: 1, episodeId: 1 });
AudioSegmentSchema.index({ clerkUserId: 1, idempotencyKey: 1 }, { unique: true });

export function audioSegmentModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.AudioSegment;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("AudioSegment", AudioSegmentSchema) as unknown as Model<Record<string, unknown>>;
}