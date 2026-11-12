import { Schema, type Connection, type Model } from "mongoose";

const SnapshotSchema = new Schema(
  {
    version: { type: Number, required: true, min: 1 },
    premise: { type: String, required: true, maxlength: 2000 },
    worldRules: { type: [String], default: [] },
    themes: { type: [String], default: [] },
    boundaries: { type: [String], default: [] },
    canonFacts: { type: [String], default: [] },
    content: { type: Schema.Types.Mixed, default: undefined },
    sourceIdea: { type: String, default: "", maxlength: 8000 },
    creativeDirection: { type: String, default: "", maxlength: 4000 },
    creatorDecisions: { type: [String], default: [] },
    createdAt: { type: Date, required: true },
  },
  { _id: false }
);

const StoryBibleSchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    premise: { type: String, default: "", maxlength: 2000 },
    worldRules: { type: [String], default: [] },
    themes: { type: [String], default: [] },
    boundaries: { type: [String], default: [] },
    canonFacts: { type: [String], default: [] },
    content: { type: Schema.Types.Mixed, default: null },
    sourceIdea: { type: String, default: "", maxlength: 8000 },
    creativeDirection: { type: String, default: "", maxlength: 4000 },
    creatorDecisions: { type: [String], default: [] },
    generationStatus: { type: String, enum: ["idle", "queued", "processing", "failed"], default: "idle" },
    generationJobId: { type: String, default: null },
    generationError: { type: String, default: null, maxlength: 300 },
    approvedVersion: { type: Number, default: 0, min: 0 },
    draftRevision: { type: Number, default: 0, min: 0 },
    approvedSnapshot: { type: SnapshotSchema, default: null },
    approvedSnapshots: { type: [SnapshotSchema], default: [] },
  },
  { timestamps: true, collection: "storyBibles" }
);

StoryBibleSchema.index({ clerkUserId: 1, projectId: 1 }, { unique: true });

export function storyBibleModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.StudioStoryBible;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("StudioStoryBible", StoryBibleSchema) as unknown as Model<Record<string, unknown>>;
}
