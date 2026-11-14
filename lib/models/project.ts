import { Schema, Types, type Connection, type Model } from "mongoose";
import {
  ASPECT_RATIOS,
  GENRES,
  LANGUAGES,
  PROJECT_STATUSES,
  PRODUCTION_MODES,
  PRODUCTION_TYPES,
  VISUAL_STYLES,
  WORKFLOW_MODES,
} from "@/lib/domain/projectCatalog";

const genreIds = GENRES.map((item) => item.id);
const languageIds = LANGUAGES.map((item) => item.id);
const styleIds = VISUAL_STYLES.map((item) => item.id);
const ratioIds = ASPECT_RATIOS.map((item) => item.id);
const productionTypeIds = PRODUCTION_TYPES.map((item) => item.id);
const productionModeIds = PRODUCTION_MODES.map((item) => item.id);

export type ProjectShape = {
  clerkUserId: string;
  title: string;
  originalStoryIdea: string;
  genre: (typeof genreIds)[number];
  language: (typeof languageIds)[number];
  visualStyle: (typeof styleIds)[number];
  tone: string;
  targetDurationSeconds: number;
  aspectRatio: (typeof ratioIds)[number];
  status: (typeof PROJECT_STATUSES)[number];
  workflowMode: (typeof WORKFLOW_MODES)[number];
  productionType: (typeof productionTypeIds)[number];
  productionMode: (typeof productionModeIds)[number];
  thumbnailAssetId?: Types.ObjectId | null;
  currentStoryId?: Types.ObjectId | null;
  idempotencyKey?: string | null;
};

const ProjectSchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    title: { type: String, required: true, maxlength: 120 },
    originalStoryIdea: { type: String, default: "", maxlength: 8000 },
    genre: { type: String, enum: genreIds, required: true },
    language: { type: String, enum: languageIds, required: true },
    visualStyle: { type: String, enum: styleIds, required: true },
    tone: { type: String, default: "dramatic", maxlength: 80 },
    targetDurationSeconds: { type: Number, required: true },
    aspectRatio: { type: String, enum: ratioIds, required: true },
    status: { type: String, enum: PROJECT_STATUSES, default: "draft" },
    workflowMode: { type: String, enum: WORKFLOW_MODES, default: "guided" },
    productionType: { type: String, enum: productionTypeIds, default: "fictional_drama" },
    productionMode: { type: String, enum: productionModeIds, default: "standalone" },
    thumbnailAssetId: { type: Schema.Types.ObjectId, default: null },
    currentStoryId: { type: Schema.Types.ObjectId, default: null },
    idempotencyKey: { type: String, default: null },
    costLimitCents: { type: Number, default: null, min: 0 },
  },
  { timestamps: true, collection: "projects" }
);

ProjectSchema.index({ clerkUserId: 1, updatedAt: -1, _id: -1 });
ProjectSchema.index({ clerkUserId: 1, status: 1 });
ProjectSchema.index(
  { clerkUserId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  }
);

export function projectModel(connection: Connection): Model<ProjectShape> {
  return (
    (connection.models.StudioProject as Model<ProjectShape> | undefined) ??
    connection.model<ProjectShape>("StudioProject", ProjectSchema)
  );
}
