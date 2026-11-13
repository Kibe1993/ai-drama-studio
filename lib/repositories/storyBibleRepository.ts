import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { storyBibleModel } from "@/lib/models/storyBible";
import { projectModel } from "@/lib/models/project";
import { ownedQuery } from "@/lib/repositories/ownership";
import { storyBibleContentSchema, type StoryBibleDraft, type StoryBibleRecord, type StoryBibleSnapshot } from "@/lib/validation/storyBible";

type SnapshotDoc = Omit<StoryBibleSnapshot, "createdAt"> & { createdAt: Date };
type BibleDoc = {
  _id: mongoose.Types.ObjectId;
  clerkUserId: string;
  projectId: mongoose.Types.ObjectId;
  premise?: string;
  worldRules?: string[];
  themes?: string[];
  boundaries?: string[];
  canonFacts?: string[];
  content?: unknown;
  sourceIdea?: string;
  creativeDirection?: string;
  creatorDecisions?: string[];
  generationStatus?: StoryBibleRecord["generationStatus"];
  generationJobId?: string | null;
  generationError?: string | null;
  approvedVersion?: number;
  draftRevision?: number;
  basedOnStoryId?: mongoose.Types.ObjectId | null;
  approvedSnapshot?: SnapshotDoc | null;
  approvedSnapshots?: SnapshotDoc[];
  createdAt: Date;
  updatedAt: Date;
};

function parseSnapshot(snapshot: SnapshotDoc): StoryBibleSnapshot {
  return {
    ...snapshot,
    content: snapshot.content ? storyBibleContentSchema.parse(snapshot.content) : undefined,
    createdAt: new Date(snapshot.createdAt).toISOString(),
  };
}

function toRecord(doc: BibleDoc): StoryBibleRecord {
  return {
    id: doc._id.toString(),
    clerkUserId: doc.clerkUserId,
    projectId: doc.projectId.toString(),
    premise: doc.premise ?? "",
    worldRules: doc.worldRules ?? [],
    themes: doc.themes ?? [],
    boundaries: doc.boundaries ?? [],
    canonFacts: doc.canonFacts ?? [],
    content: doc.content == null ? undefined : storyBibleContentSchema.parse(doc.content),
    sourceIdea: doc.sourceIdea ?? "",
    creativeDirection: doc.creativeDirection ?? "",
    creatorDecisions: doc.creatorDecisions ?? [],
    approvedVersion: doc.approvedVersion ?? 0,
    draftRevision: doc.draftRevision ?? 0,
    basedOnStoryId: doc.basedOnStoryId?.toString() ?? null,
    approvedSnapshot: doc.approvedSnapshot ? parseSnapshot(doc.approvedSnapshot) : null,
    approvedSnapshots: (doc.approvedSnapshots ?? []).map(parseSnapshot),
    generationStatus: doc.generationStatus ?? "idle",
    generationJobId: doc.generationJobId ?? null,
    generationError: doc.generationError ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function models() {
  const connection = await connectDB();
  return { Bible: storyBibleModel(connection), Project: projectModel(connection) };
}

export const storyBibleRepository = {
  async findOwned(clerkUserId: string, projectId: string): Promise<StoryBibleRecord | null> {
    const { Bible, Project } = await models();
    if (!(await Project.exists(ownedQuery(clerkUserId, projectId)))) return null;
    const doc = await Bible.findOne({ clerkUserId, projectId }).lean<BibleDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async findApproved(clerkUserId: string, projectId: string): Promise<StoryBibleSnapshot | null> {
    return (await this.findOwned(clerkUserId, projectId))?.approvedSnapshot ?? null;
  },

  async findApprovedVersion(clerkUserId: string, projectId: string, version: number): Promise<StoryBibleSnapshot | null> {
    const bible = await this.findOwned(clerkUserId, projectId);
    return bible?.approvedSnapshots.find((snapshot) => snapshot.version === version) ?? null;
  },

  async saveDraft(clerkUserId: string, projectId: string, input: StoryBibleDraft): Promise<StoryBibleRecord | null> {
    const { Bible, Project } = await models();
    if (!(await Project.exists(ownedQuery(clerkUserId, projectId)))) return null;
    const set: Record<string, unknown> = {
      premise: input.premise,
      worldRules: input.worldRules,
      themes: input.themes,
      boundaries: input.boundaries,
      canonFacts: input.canonFacts,
      generationStatus: "idle",
      generationJobId: null,
      generationError: null,
    };
    if (input.content !== undefined) {
      set.content = input.content;
    } else {
      // Older clients know only the original five fields. Keep the richer Bible
      // synchronized when those clients edit a record that already has content.
      const previous = await Bible.findOne({ clerkUserId, projectId }).lean<BibleDoc | null>();
      if (previous?.content != null) {
        const parsed = storyBibleContentSchema.safeParse(previous.content);
        if (parsed.success) {
          const content = parsed.data;
          set.content = storyBibleContentSchema.parse({
            ...content,
            identity: { ...content.identity, centralPremise: input.premise },
            world: { ...content.world, rules: input.worldRules.slice(0, 16) },
            guidelines: {
              ...content.guidelines,
              mainThemes: input.themes.slice(0, 8),
              secondaryThemes: input.themes.slice(8, 18),
              boundaries: input.boundaries.slice(0, 16),
            },
            canon: { ...content.canon, confirmedFacts: input.canonFacts.slice(0, 40) },
          });
        }
      }
    }
    if (input.sourceIdea !== undefined) set.sourceIdea = input.sourceIdea;
    if (input.creativeDirection !== undefined) set.creativeDirection = input.creativeDirection;
    if (input.creatorDecisions !== undefined) set.creatorDecisions = input.creatorDecisions;
    const doc = await Bible.findOneAndUpdate(
      { clerkUserId, projectId },
      { $set: set, $setOnInsert: { clerkUserId, projectId }, $inc: { draftRevision: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean<BibleDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async beginGeneration(clerkUserId: string, projectId: string, expectedDraftRevision: number, jobId: string): Promise<StoryBibleRecord | null> {
    const { Bible, Project } = await models();
    if (!(await Project.exists(ownedQuery(clerkUserId, projectId)))) return null;
    const doc = await Bible.findOneAndUpdate(
      { clerkUserId, projectId, draftRevision: expectedDraftRevision, generationStatus: { $nin: ["queued", "processing"] } },
      { $set: { generationStatus: "queued", generationJobId: jobId, generationError: null } },
      { new: true }
    ).lean<BibleDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async markGenerationProcessing(clerkUserId: string, projectId: string, jobId: string): Promise<boolean> {
    const { Bible } = await models();
    const result = await Bible.updateOne(
      { clerkUserId, projectId, generationJobId: jobId, generationStatus: { $in: ["queued", "processing"] } },
      { $set: { generationStatus: "processing" } }
    );
    return result.matchedCount === 1;
  },

  async completeGeneration(input: {
    clerkUserId: string;
    projectId: string;
    jobId: string;
    expectedDraftRevision: number;
    draft: StoryBibleDraft;
  }): Promise<StoryBibleRecord | null> {
    const { Bible } = await models();
    const { draft, ...identity } = input;
    const doc = await Bible.findOneAndUpdate(
      {
        clerkUserId: identity.clerkUserId,
        projectId: identity.projectId,
        generationJobId: identity.jobId,
        draftRevision: identity.expectedDraftRevision,
        generationStatus: { $in: ["queued", "processing"] },
      },
      {
        $set: {
          premise: draft.premise,
          worldRules: draft.worldRules,
          themes: draft.themes,
          boundaries: draft.boundaries,
          canonFacts: draft.canonFacts,
          content: draft.content,
          sourceIdea: draft.sourceIdea,
          creativeDirection: draft.creativeDirection,
          creatorDecisions: draft.creatorDecisions,
          generationStatus: "idle",
          generationError: null,
        },
        $inc: { draftRevision: 1 },
      },
      { new: true }
    ).lean<BibleDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async failGeneration(clerkUserId: string, projectId: string, jobId: string, safeMessage: string): Promise<void> {
    const { Bible } = await models();
    await Bible.updateOne(
      { clerkUserId, projectId, generationJobId: jobId },
      { $set: { generationStatus: "failed", generationError: safeMessage.slice(0, 300) } }
    );
  },

  async approve(clerkUserId: string, projectId: string, expectedVersion: number, expectedDraftRevision: number): Promise<StoryBibleRecord | null> {
    const { Bible, Project } = await models();
    const project = await Project.findOne(ownedQuery(clerkUserId, projectId))
      .select({ currentStoryId: 1 })
      .lean<{ currentStoryId?: mongoose.Types.ObjectId | null } | null>();
    if (!project) return null;
    const filter = {
      clerkUserId,
      projectId,
      approvedVersion: expectedVersion,
      draftRevision: expectedDraftRevision,
      generationStatus: { $nin: ["queued", "processing"] },
    };
    const current = await Bible.findOne(filter).lean<BibleDoc | null>();
    if (!current) return null;
    const state: StoryBibleDraft = {
      premise: current.premise ?? "",
      worldRules: current.worldRules ?? [],
      themes: current.themes ?? [],
      boundaries: current.boundaries ?? [],
      canonFacts: current.canonFacts ?? [],
      content: current.content == null ? undefined : storyBibleContentSchema.parse(current.content),
      sourceIdea: current.sourceIdea ?? "",
      creativeDirection: current.creativeDirection ?? "",
      creatorDecisions: current.creatorDecisions ?? [],
    };
    const createdAt = new Date();
    const snapshot = { ...state, version: expectedVersion + 1, createdAt };
    const doc = await Bible.findOneAndUpdate(
      filter,
      {
        $set: {
          approvedVersion: expectedVersion + 1,
          approvedSnapshot: snapshot,
          basedOnStoryId: project.currentStoryId ?? null,
        },
        $push: { approvedSnapshots: snapshot },
      },
      { new: true }
    ).lean<BibleDoc | null>();
    return doc ? toRecord(doc) : null;
  },
};
