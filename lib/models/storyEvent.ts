import { Schema, type Connection, type Model } from "mongoose";

const StoryEventSchema = new Schema({
  clerkUserId: { type: String, required: true },
  projectId: { type: Schema.Types.ObjectId, required: true },
  productionRunId: { type: Schema.Types.ObjectId, required: true },
  episodeId: { type: Schema.Types.ObjectId, default: null },
  episodeNumber: { type: Number, default: 1 },
  storyId: { type: Schema.Types.ObjectId, required: true },
  sceneNumber: { type: Number, required: true, min: 1 },
  title: { type: String, required: true, maxlength: 160 },
  description: { type: String, required: true, maxlength: 1200 },
  characterNames: { type: [String], default: [] },
  locationName: { type: String, default: "", maxlength: 160 },
  status: { type: String, enum: ["pending_review", "approved"], default: "pending_review" },
}, { timestamps: true, collection: "storyEvents" });

StoryEventSchema.index({ clerkUserId: 1, productionRunId: 1, sceneNumber: 1 }, { unique: true });
StoryEventSchema.index({ clerkUserId: 1, projectId: 1, episodeNumber: 1, status: 1 });

export function storyEventModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.StoryEvent;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("StoryEvent", StoryEventSchema) as unknown as Model<Record<string, unknown>>;
}
