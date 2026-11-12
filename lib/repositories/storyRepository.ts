import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { projectModel } from "@/lib/models/project";
import { storyModel, type StoryShape } from "@/lib/models/story";
import { ownedQuery } from "@/lib/repositories/ownership";
import { JobError } from "@/lib/pipeline/types";
import {
  generatedStorySchema,
  type GeneratedStory,
  type StoryRecord,
  type StoryStatus,
} from "@/lib/validation/story";

type StoryDoc = StoryShape & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: StoryDoc): StoryRecord {
  const generated = generatedStorySchema.parse({
    title: doc.title,
    synopsis: doc.synopsis,
    structure: doc.structure,
    screenplay: doc.screenplay,
  });
  return {
    ...generated,
    id: doc._id.toString(),
    clerkUserId: doc.clerkUserId,
    projectId: doc.projectId.toString(),
    productionRunId: doc.productionRunId.toString(),
    status: doc.status,
    version: doc.version,
    provider: doc.provider || "",
    model: doc.model || "",
    fallbackFrom: doc.fallbackFrom || null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function models() {
  const connection = await connectDB();
  return { Story: storyModel(connection), Project: projectModel(connection) };
}

export type StoryDraft = GeneratedStory & {
  clerkUserId: string;
  projectId: string;
  productionRunId: string;
  provider?: string;
  model?: string;
  fallbackFrom?: string | null;
};

export const storyRepository = {
  async upsertAwaiting(input: StoryDraft): Promise<StoryRecord> {
    const { Story, Project } = await models();
    const existing = await Story.findOne({
      clerkUserId: input.clerkUserId,
      productionRunId: input.productionRunId,
    }).lean<StoryDoc | null>();
    if (existing?.status === "approved") {
      throw new JobError("This story is already approved.", "story_approved", false);
    }
    const doc = await Story.findOneAndUpdate(
      { clerkUserId: input.clerkUserId, productionRunId: input.productionRunId },
      {
        clerkUserId: input.clerkUserId,
        projectId: input.projectId,
        productionRunId: input.productionRunId,
        title: input.title,
        synopsis: input.synopsis,
        structure: input.structure,
        screenplay: input.screenplay,
        provider: input.provider || "",
        model: input.model || "",
        fallbackFrom: input.fallbackFrom || null,
        status: "awaiting_approval" satisfies StoryStatus,
        version: existing?.version ?? 1,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean<StoryDoc | null>();
    if (!doc) throw new JobError("The story could not be saved.", "story_save_failed", true);
    await Project.updateOne(ownedQuery(input.clerkUserId, input.projectId), {
      currentStoryId: doc._id,
    });
    return toRecord(doc);
  },

  async findOwned(clerkUserId: string, id: string): Promise<StoryRecord | null> {
    const { Story } = await models();
    const doc = await Story.findOne(ownedQuery(clerkUserId, id)).lean<StoryDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async findForRun(clerkUserId: string, productionRunId: string): Promise<StoryRecord | null> {
    const { Story } = await models();
    const doc = await Story.findOne({ clerkUserId, productionRunId }).lean<StoryDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async markApproved(clerkUserId: string, id: string): Promise<StoryRecord | null> {
    const { Story } = await models();
    const current = await Story.findOne(ownedQuery(clerkUserId, id)).lean<StoryDoc | null>();
    if (!current) return null;
    if (current.status === "approved") return toRecord(current);
    if (current.status !== "awaiting_approval") return null;
    const doc = await Story.findOneAndUpdate(
      { ...ownedQuery(clerkUserId, id), status: "awaiting_approval" },
      { status: "approved" },
      { new: true }
    ).lean<StoryDoc | null>();
    return doc ? toRecord(doc) : null;
  },
};
