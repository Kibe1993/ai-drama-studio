import { Schema, type Connection, type Model } from "mongoose";

const graphNodeSchema = new Schema(
  {
    id: { type: String, required: true, maxlength: 120 },
    type: {
      type: String,
      required: true,
      enum: [
        "story_event",
        "clue",
        "revelation",
        "character",
        "character_knowledge",
        "location",
        "object",
        "episode",
        "scene",
        "decision",
        "consequence",
        "unresolved_thread",
        "mystery",
        "secret",
        "turning_point",
        "setup",
        "payoff",
      ],
    },
    label: { type: String, required: true, maxlength: 200 },
    description: { type: String, required: true, maxlength: 800 },
    status: {
      type: String,
      required: true,
      enum: [
        "proposed",
        "approved_plan",
        "introduced",
        "established_canon",
        "resolved",
        "superseded",
        "rejected",
      ],
    },
    episodeNumber: { type: Number, min: 1, max: 100 },
    sceneNumber: { type: Number, min: 1, max: 200 },
    metadata: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const graphEdgeSchema = new Schema(
  {
    from: { type: String, required: true, maxlength: 120 },
    to: { type: String, required: true, maxlength: 120 },
    type: {
      type: String,
      required: true,
      enum: [
        "depends_on",
        "establishes",
        "reveals",
        "resolves",
        "contradicts",
        "supersedes",
        "introduces",
        "develops",
        "payoff_of",
        "consequence_of",
        "clue_for",
        "setup_for",
        "knowledge_from",
      ],
    },
    description: { type: String, required: true, maxlength: 400 },
  },
  { _id: false }
);

const NarrativeGraphSchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    nodes: { type: [graphNodeSchema], default: [] },
    edges: { type: [graphEdgeSchema], default: [] },
    asOfEpisode: { type: Number, required: true, min: 0, default: 0 },
    basedOnPlanVersion: { type: Number, required: true, min: 0 },
    version: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true, collection: "narrativeGraphs" }
);

NarrativeGraphSchema.index({ clerkUserId: 1, projectId: 1, version: -1 });

export function narrativeGraphModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.StudioNarrativeGraph;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("StudioNarrativeGraph", NarrativeGraphSchema) as unknown as Model<Record<string, unknown>>;
}