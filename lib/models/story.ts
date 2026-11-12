import { Schema, Types, type Connection, type Model } from "mongoose";
import { STORY_STATUSES } from "@/lib/validation/story";

export type StoryShape = {
  clerkUserId: string;
  projectId: Types.ObjectId;
  productionRunId: Types.ObjectId;
  episodeId?: Types.ObjectId | null;
  title: string;
  synopsis: string;
  structure: Record<string, unknown>;
  screenplay: Record<string, unknown>[];
  status: (typeof STORY_STATUSES)[number];
  version: number;
  provider: string;
  model: string;
  fallbackFrom: string | null;
};

const StorySchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    productionRunId: { type: Schema.Types.ObjectId, required: true },
    episodeId: { type: Schema.Types.ObjectId, default: null },
    title: { type: String, required: true, maxlength: 120 },
    synopsis: { type: String, required: true, maxlength: 1200 },
    structure: { type: Schema.Types.Mixed, required: true },
    screenplay: { type: [Schema.Types.Mixed], required: true },
    status: { type: String, enum: STORY_STATUSES, required: true },
    version: { type: Number, required: true, min: 1 },
    provider: { type: String, default: "" },
    model: { type: String, default: "" },
    fallbackFrom: { type: String, default: null },
  },
  { timestamps: true, collection: "stories" }
);

StorySchema.index({ productionRunId: 1 }, { unique: true });
StorySchema.index({ clerkUserId: 1, projectId: 1 });
StorySchema.index({ projectId: 1, version: 1 });

export function storyModel(connection: Connection): Model<StoryShape> {
  return (
    (connection.models.StudioStory as Model<StoryShape> | undefined) ??
    connection.model<StoryShape>("StudioStory", StorySchema)
  );
}
