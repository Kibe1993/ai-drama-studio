import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { projectModel } from "@/lib/models/project";
import { episodeModel } from "@/lib/models/episode";
import { storyModel, type StoryShape } from "@/lib/models/story";
import { ownedQuery } from "@/lib/repositories/ownership";
import { JobError } from "@/lib/pipeline/types";
import {
  generatedStorySchema,
  type GeneratedStory,
  type SceneRepairRecord,
  type StoryRecord,
  type StoryStatus,
} from "@/lib/validation/story";
import {
  episodeCanonSummarySchema,
  episodePlanSchema,
  episodeValidationSchema,
  type EpisodeCanonSummary,
  type EpisodePlan,
  type EpisodeValidation,
} from "@/lib/validation/casna";

type StoryDoc = StoryShape & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  episodeId?: mongoose.Types.ObjectId | null;
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
    productionRunId: doc.productionRunId?.toString() ?? null,
    episodeId: doc.episodeId?.toString() ?? null,
    status: doc.status,
    version: doc.version,
    provider: doc.provider || "",
    model: doc.model || "",
    fallbackFrom: doc.fallbackFrom || null,
    plan: parsePlan(doc.plan),
    validationFindings: parseValidation(doc.validationFindings),
    canonSummary: parseCanon(doc.canonSummary),
    repairHistory: parseRepairHistory(doc.repairHistory),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function parsePlan(raw: unknown): EpisodePlan | null {
  const parsed = episodePlanSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseValidation(raw: unknown): EpisodeValidation | null {
  const parsed = episodeValidationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseCanon(raw: unknown): EpisodeCanonSummary | null {
  const parsed = episodeCanonSummarySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseRepairHistory(raw: unknown): SceneRepairRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is SceneRepairRecord =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as SceneRepairRecord).attempt === "number" &&
      Array.isArray((entry as SceneRepairRecord).sceneNumbers)
  );
}

async function models() {
  const connection = await connectDB();
  return { Story: storyModel(connection), Project: projectModel(connection), Episode: episodeModel(connection) };
}

export type StoryDraft = GeneratedStory & {
  clerkUserId: string;
  projectId: string;
  productionRunId: string;
  episodeId?: string | null;
  provider?: string;
  model?: string;
  fallbackFrom?: string | null;
  /** CASNA Stage F: the episode plan the screenplay was generated from. */
  plan?: EpisodePlan | null;
  /** CASNA Stage H: structured screenplay validation findings. */
  validationFindings?: EpisodeValidation | null;
  /** CASNA Stage H: bounded scene-repair attempts. */
  repairHistory?: SceneRepairRecord[];
};

/** A project-level story draft: the creative artifact of the guided workflow. */
export type ProjectStoryDraft = GeneratedStory & {
  clerkUserId: string;
  projectId: string;
  provider?: string;
  model?: string;
  fallbackFrom?: string | null;
};

export const storyRepository = {
  async upsertAwaiting(input: StoryDraft): Promise<StoryRecord> {
    const { Story, Project, Episode } = await models();
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
        episodeId: input.episodeId ?? null,
        title: input.title,
        synopsis: input.synopsis,
        structure: input.structure,
        screenplay: input.screenplay,
        provider: input.provider || "",
        model: input.model || "",
        fallbackFrom: input.fallbackFrom || null,
        plan: input.plan ?? null,
        validationFindings: input.validationFindings ?? null,
        canonSummary: null,
        repairHistory: input.repairHistory ?? [],
        status: "awaiting_approval" satisfies StoryStatus,
        version: existing?.version ?? 1,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean<StoryDoc | null>();
    if (!doc) throw new JobError("The story could not be saved.", "story_save_failed", true);
    await Project.updateOne(ownedQuery(input.clerkUserId, input.projectId), {
      currentStoryId: doc._id,
    });
    if (input.episodeId) {
      await Episode.updateOne(
        { clerkUserId: input.clerkUserId, projectId: input.projectId, _id: input.episodeId },
        { currentStoryId: doc._id, status: "story_review" }
      );
    }
    return toRecord(doc);
  },

  async findOwned(clerkUserId: string, id: string): Promise<StoryRecord | null> {
    const { Story } = await models();
    const doc = await Story.findOne(ownedQuery(clerkUserId, id)).lean<StoryDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  /**
   * Persist a new project-level story draft. A fresh document is written on
   * every generation so `Project.currentStoryId` changes and any Story Bible
   * approved from the previous draft is flagged for review.
   */
  async upsertProjectDraft(input: ProjectStoryDraft): Promise<StoryRecord> {
    const { Story, Project } = await models();
    const latest = await Story.findOne({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
      productionRunId: null,
    })
      .sort({ version: -1 })
      .lean<StoryDoc | null>();
    const created = await Story.create({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
      productionRunId: null,
      episodeId: null,
      title: input.title,
      synopsis: input.synopsis,
      structure: input.structure,
      screenplay: input.screenplay,
      provider: input.provider || "",
      model: input.model || "",
      fallbackFrom: input.fallbackFrom || null,
      status: "awaiting_approval" satisfies StoryStatus,
      version: (latest?.version ?? 0) + 1,
    });
    const doc = created.toObject() as unknown as StoryDoc;
    await Project.updateOne(ownedQuery(input.clerkUserId, input.projectId), {
      currentStoryId: doc._id,
    });
    return toRecord(doc);
  },

  async findProjectDraft(clerkUserId: string, projectId: string): Promise<StoryRecord | null> {
    const { Story } = await models();
    const doc = await Story.findOne({ clerkUserId, projectId, productionRunId: null })
      .sort({ version: -1 })
      .lean<StoryDoc | null>();
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

  /**
   * Save a creator's manual screenplay revision. Only an unapproved episode can
   * be edited; the conditional filter makes a concurrent approval win instead of
   * overwriting approved canon.
   */
  async updateScreenplay(
    clerkUserId: string,
    id: string,
    input: {
      title?: string;
      synopsis?: string;
      screenplay: GeneratedStory["screenplay"];
      validationFindings: EpisodeValidation | null;
      expectedUpdatedAt?: string;
    }
  ): Promise<StoryRecord | null> {
    const { Story } = await models();
    const filter: Record<string, unknown> = {
      ...ownedQuery(clerkUserId, id),
      status: "awaiting_approval" satisfies StoryStatus,
    };
    if (input.expectedUpdatedAt) {
      const updatedAt = new Date(input.expectedUpdatedAt);
      if (!Number.isNaN(updatedAt.getTime())) filter.updatedAt = updatedAt;
    }
    const patch: Record<string, unknown> = {
      screenplay: input.screenplay,
      validationFindings: input.validationFindings,
    };
    if (input.title !== undefined) patch.title = input.title;
    if (input.synopsis !== undefined) patch.synopsis = input.synopsis;
    const doc = await Story.findOneAndUpdate(filter, { $set: patch }, { new: true }).lean<StoryDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  /**
   * Atomically undo an approval when a later step of the same approval operation
   * fails. Canon must never be partly applied to an episode that is not approved.
   */
  async revertApproval(clerkUserId: string, id: string): Promise<StoryRecord | null> {
    const { Story } = await models();
    const doc = await Story.findOneAndUpdate(
      { ...ownedQuery(clerkUserId, id), status: "approved" },
      { status: "awaiting_approval" },
      { new: true }
    ).lean<StoryDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  /** Persist the authoritative canon summary produced at approval time. */
  async saveCanonSummary(
    clerkUserId: string,
    id: string,
    summary: EpisodeCanonSummary
  ): Promise<StoryRecord | null> {
    const { Story } = await models();
    const doc = await Story.findOneAndUpdate(
      ownedQuery(clerkUserId, id),
      { canonSummary: summary },
      { new: true }
    ).lean<StoryDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  /**
   * The most recent episode screenplay that is a draft, used to surface proposed
   * developments. Drafts never reach the Continuity Ledger; this is read-only.
   */
  async findLatestAwaitingEpisode(
    clerkUserId: string,
    projectId: string
  ): Promise<StoryRecord | null> {
    const { Story } = await models();
    const doc = await Story.findOne({
      clerkUserId,
      projectId,
      status: "awaiting_approval",
      productionRunId: { $type: "objectId" },
    })
      .sort({ updatedAt: -1 })
      .lean<StoryDoc | null>();
    return doc ? toRecord(doc) : null;
  },
};
