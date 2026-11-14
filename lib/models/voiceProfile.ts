import { Schema, type Connection, type Model } from "mongoose";

const VoiceProfileSchema = new Schema({
  clerkUserId: { type: String, required: true },
  projectId: { type: Schema.Types.ObjectId, required: true },
  canonicalEntityId: { type: Schema.Types.ObjectId, required: true },
  voiceDescription: { type: String, default: "", maxlength: 500 },
  preferredProvider: { type: String, default: "", maxlength: 80 },
  voiceIdentifier: { type: String, default: "", maxlength: 160 },
  language: { type: String, default: "en", maxlength: 20 },
  accent: { type: String, default: "", maxlength: 80 },
  speakingStyle: { type: String, default: "", maxlength: 300 },
  emotionalCharacteristics: { type: String, default: "", maxlength: 400 },
  status: { type: String, enum: ["draft", "approved"], default: "draft" },
  idempotencyKey: { type: String, required: true, maxlength: 180 },
}, { timestamps: true, collection: "voiceProfiles" });

VoiceProfileSchema.index({ clerkUserId: 1, canonicalEntityId: 1, status: 1 });
VoiceProfileSchema.index(
  { clerkUserId: 1, canonicalEntityId: 1 },
  { unique: true, partialFilterExpression: { status: "approved" } }
);

export function voiceProfileModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.VoiceProfile;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("VoiceProfile", VoiceProfileSchema) as unknown as Model<Record<string, unknown>>;
}