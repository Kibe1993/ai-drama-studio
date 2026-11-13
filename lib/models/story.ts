import { Schema, Types, type Connection, type Model } from "mongoose";
import { STORY_STATUSES } from "@/lib/validation/story";

export type StoryShape = {
  clerkUserId: string;
  projectId: Types.ObjectId;
  /**
   * Provenance for an episode screenplay. `null` marks the project-level story
   * draft of the guided workflow, which exists before any production run.
   */
  productionRunId: Types.ObjectId | null;
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
  /** CASNA Stage F: the episode plan the screenplay was generated from. */
  plan: Record<string, unknown> | null;
  /** CASNA Stage H: structured screenplay validation findings. */
  validationFindings: Record<string, unknown> | null;
  /** CASNA Stage I: canon summary produced on approval. */
  canonSummary: Record<string, unknown> | null;
  /** CASNA Stage H: bounded scene-repair attempts. */
  repairHistory: Record<string, unknown>[];
};

const StorySchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    productionRunId: { type: Schema.Types.ObjectId, default: null },
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
    plan: { type: Schema.Types.Mixed, default: null },
    validationFindings: { type: Schema.Types.Mixed, default: null },
    canonSummary: { type: Schema.Types.Mixed, default: null },
    repairHistory: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true, collection: "stories" }
);

// Only episode screenplays are bound to a run. The partial filter keeps the
// uniqueness guarantee for real runs while allowing many project-level drafts.
StorySchema.index(
  { productionRunId: 1 },
  { unique: true, partialFilterExpression: { productionRunId: { $type: "objectId" } } }
);
StorySchema.index({ clerkUserId: 1, projectId: 1 });
StorySchema.index({ projectId: 1, version: 1 });
StorySchema.index({ clerkUserId: 1, projectId: 1, productionRunId: 1, version: -1 });

export function storyModel(connection: Connection): Model<StoryShape> {
  return (
    (connection.models.StudioStory as Model<StoryShape> | undefined) ??
    connection.model<StoryShape>("StudioStory", StorySchema)
  );
}
