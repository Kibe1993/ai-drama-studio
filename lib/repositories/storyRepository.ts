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
import { storyContractSchema, type StoryContract } from "@/lib/validation/storyContract";
import { canonSuggestionSchema, type CanonSuggestion } from "@/lib/validation/canonExtraction";
import type { PreparedFact } from "@/lib/domain/canonReconciliation";
import {
  episodeCanonSummarySchema,
  episodePlanSchema,
  episodeValidationSchema,
  mergeResolutions,
  normalizeFindingIds,
  type EpisodeCanonSummary,
  type EpisodePlan,
  type EpisodeValidation,
  type EpisodeValidationFinding,
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
    storyContract: parseContract(doc.storyContract),
    sourceCanonVersion: typeof doc.sourceCanonVersion === "number" ? doc.sourceCanonVersion : null,
    sourceBibleVersion: typeof doc.sourceBibleVersion === "number" ? doc.sourceBibleVersion : null,
    promptFingerprint: typeof doc.promptFingerprint === "string" ? doc.promptFingerprint : null,
    canonSummary: parseCanon(doc.canonSummary),
    canonSuggestions: parseCanonSuggestions(doc.canonSuggestions),
    repairHistory: parseRepairHistory(doc.repairHistory),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function parsePlan(raw: unknown): EpisodePlan | null {
  const parsed = episodePlanSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseContract(raw: unknown): StoryContract | null {
  const parsed = storyContractSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseValidation(raw: unknown): EpisodeValidation | null {
  const parsed = episodeValidationSchema.safeParse(raw);
  return parsed.success ? normalizeFindingIds(parsed.data) : null;
}

function parseCanon(raw: unknown): EpisodeCanonSummary | null {
  const parsed = episodeCanonSummarySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseCanonSuggestions(raw: unknown): CanonSuggestion | null {
  const parsed = canonSuggestionSchema.safeParse(raw);
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
  sourceCanonVersion?: number | null;
};

/** A project-level story draft: the creative artifact of the guided workflow. */
export type ProjectStoryDraft = GeneratedStory & {
  clerkUserId: string;
  projectId: string;
  provider?: string;
  model?: string;
  fallbackFrom?: string | null;
  validationFindings?: EpisodeValidation | null;
  sourceCanonVersion?: number | null;
  sourceBibleVersion?: number | null;
  promptFingerprint?: string | null;
  storyContract?: StoryContract | null;
};

export type CanonExtractionIssueRecord = {
  factId: string;
  code: string;
  message: string;
  fact: PreparedFact;
  status: "pending_review" | "accepting" | "accepted" | "rejected";
  resolvedAt: string | null;
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
        sourceCanonVersion: input.sourceCanonVersion ?? null,
        canonStale: false,
        canonStaleReason: "",
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
      validationFindings: input.validationFindings ?? null,
      sourceCanonVersion: input.sourceCanonVersion ?? null,
      sourceBibleVersion: input.sourceBibleVersion ?? null,
      promptFingerprint: input.promptFingerprint ?? null,
      storyContract: input.storyContract ?? null,
      canonStale: false,
      canonStaleReason: "",
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

  async recordCanonVersion(clerkUserId: string, id: string, version: number): Promise<void> {
    const { Story } = await models();
    await Story.updateOne(ownedQuery(clerkUserId, id), {
      $set: { sourceCanonVersion: version, canonStale: false, canonStaleReason: "" },
    });
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

  /** Persist advisory canon suggestions extracted post-hoc from the screenplay. */
  async saveCanonSuggestions(
    clerkUserId: string,
    id: string,
    suggestions: CanonSuggestion
  ): Promise<StoryRecord | null> {
    const { Story } = await models();
    const doc = await Story.findOneAndUpdate(
      ownedQuery(clerkUserId, id),
      { canonSuggestions: suggestions },
      { new: true }
    ).lean<StoryDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  /** Clear canon suggestions (e.g. after the creator has reviewed them). */
  async clearCanonSuggestions(
    clerkUserId: string,
    id: string
  ): Promise<StoryRecord | null> {
    const { Story } = await models();
    const doc = await Story.findOneAndUpdate(
      ownedQuery(clerkUserId, id),
      { canonSuggestions: null },
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

  /**
   * Update a single validation finding's resolution status. The finding is
   * matched by its `id` field (stable hash from the narrative control system).
   * Returns the updated story record, or null if the story or finding was not
   * found.
   */
  async updateFindingResolution(
    clerkUserId: string,
    storyId: string,
    findingId: string,
    resolution: { status: string; note?: string; resolvedAt: string },
  ): Promise<StoryRecord | null> {
    const { Story } = await models();
    const doc = await Story.findOne(ownedQuery(clerkUserId, storyId)).lean<StoryDoc | null>();
    if (!doc) return null;
    const validation = parseValidation(doc.validationFindings);
    if (!validation) return null;
    const findingExists = validation.findings.some((f) => f.id === findingId);
    if (!findingExists) return null;
    const updatedFindings = validation.findings.map((finding) => {
      if (finding.id !== findingId) return finding;
      return {
        ...finding,
        resolutionStatus: resolution.status as EpisodeValidationFinding["resolutionStatus"],
        ...(resolution.note ? { resolutionNote: resolution.note } : {}),
        resolvedAt: resolution.resolvedAt,
      };
    });
    const updated: EpisodeValidation = { ...validation, findings: updatedFindings };
    const result = await Story.findOneAndUpdate(
      {
        ...ownedQuery(clerkUserId, storyId),
        updatedAt: doc.updatedAt,
      },
      { $set: { validationFindings: updated } },
      { new: true },
    ).lean<StoryDoc | null>();
    return result ? toRecord(result) : null;
  },

  /**
   * Replace the validation findings on a story draft. Used after revalidation
   * runs. Carries forward any existing finding resolutions by matching on
   * finding `id`, then by `code + category + sceneNumber` as a fallback.
   */
  async updateValidationFindings(
    clerkUserId: string,
    storyId: string,
    validation: EpisodeValidation,
  ): Promise<StoryRecord | null> {
    const { Story } = await models();
    const existing = await Story.findOne(ownedQuery(clerkUserId, storyId)).lean<StoryDoc | null>();
    if (!existing) return null;
    const previousValidation = parseValidation(existing.validationFindings);
    const merged = previousValidation
      ? mergeResolutions(previousValidation, validation)
      : validation;
    const result = await Story.findOneAndUpdate(
      ownedQuery(clerkUserId, storyId),
      { $set: { validationFindings: merged } },
      { new: true },
    ).lean<StoryDoc | null>();
    return result ? toRecord(result) : null;
  },

  /**
   * Mark unapproved story drafts in a project as stale when the canon version
   * advances. Approved stories are left untouched — they are the source of
   * canon, not consumers of it. Returns the count of stories marked stale.
   */
  async markStaleByCanonVersion(
    clerkUserId: string,
    projectId: string,
    currentCanonVersion: number,
  ): Promise<number> {
    const { Story } = await models();
    const result = await Story.updateMany(
      {
        clerkUserId,
        projectId,
        status: { $ne: "approved" },
        sourceCanonVersion: { $type: "int", $lt: currentCanonVersion },
        canonStale: { $ne: true },
      },
      {
        $set: {
          canonStale: true,
          canonStaleReason: `Canon advanced to version ${currentCanonVersion} after this draft was generated.`,
        },
      },
    );
    return result.modifiedCount;
  },

  async saveCanonExtractionIssues(
    clerkUserId: string,
    storyId: string,
    issues: CanonExtractionIssueRecord[],
  ): Promise<StoryRecord | null> {
    const { Story } = await models();
    const doc = await Story.findOneAndUpdate(
      ownedQuery(clerkUserId, storyId),
      { $set: { canonExtractionIssues: { issues, generatedAt: new Date().toISOString() } } },
      { new: true },
    ).lean<StoryDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async getCanonExtractionIssues(
    clerkUserId: string,
    storyId: string,
  ): Promise<CanonExtractionIssueRecord[] | null> {
    const { Story } = await models();
    const doc = await Story.findOne(ownedQuery(clerkUserId, storyId))
      .select({ canonExtractionIssues: 1 })
      .lean<{ canonExtractionIssues: { issues: CanonExtractionIssueRecord[] } | null } | null>();
    if (!doc) return null;
    return doc.canonExtractionIssues?.issues ?? [];
  },

  async updateIssueStatus(
    clerkUserId: string,
    storyId: string,
    issueId: string,
    resolution: { status: "accepted" | "rejected"; resolvedAt: string },
  ): Promise<CanonExtractionIssueRecord | null> {
    const { Story } = await models();
    const doc = await Story.findOne(ownedQuery(clerkUserId, storyId)).lean<StoryDoc | null>();
    if (!doc) return null;
    const raw = doc.canonExtractionIssues as
      | { issues: CanonExtractionIssueRecord[] }
      | null;
    if (!raw || !Array.isArray(raw.issues)) return null;
    const issue = raw.issues.find((i) => i.factId === issueId);
    if (!issue) return null;
    if (issue.status !== "pending_review") return null;
    const updatedIssues = raw.issues.map((i) =>
      i.factId === issueId
        ? { ...i, status: resolution.status, resolvedAt: resolution.resolvedAt }
        : i,
    );
    await Story.updateOne(
      ownedQuery(clerkUserId, storyId),
      { $set: { "canonExtractionIssues.issues": updatedIssues } },
    );
    return { ...issue, status: resolution.status, resolvedAt: resolution.resolvedAt };
  },

  async claimIssue(
    clerkUserId: string,
    storyId: string,
    issueId: string,
  ): Promise<CanonExtractionIssueRecord | null> {
    const { Story } = await models();
    const result = await Story.findOneAndUpdate(
      {
        ...ownedQuery(clerkUserId, storyId),
        "canonExtractionIssues.issues": {
          $elemMatch: { factId: issueId, status: "pending_review" },
        },
      },
      {
        $set: {
          "canonExtractionIssues.issues.$[issue].status": "accepting",
        },
      },
      {
        arrayFilters: [{ "issue.factId": issueId, "issue.status": "pending_review" }],
        new: true,
      },
    ).lean<StoryDoc | null>();

    if (!result) return null;
    const raw = result.canonExtractionIssues as
      | { issues: CanonExtractionIssueRecord[] }
      | null;
    if (!raw || !Array.isArray(raw.issues)) return null;
    return raw.issues.find((i) => i.factId === issueId) ?? null;
  },

  async finalizeIssue(
    clerkUserId: string,
    storyId: string,
    issueId: string,
    resolution: { status: "accepted" | "rejected"; resolvedAt: string },
  ): Promise<CanonExtractionIssueRecord | null> {
    const { Story } = await models();
    const result = await Story.findOneAndUpdate(
      {
        ...ownedQuery(clerkUserId, storyId),
        "canonExtractionIssues.issues": {
          $elemMatch: { factId: issueId, status: "accepting" },
        },
      },
      {
        $set: {
          "canonExtractionIssues.issues.$[issue].status": resolution.status,
          "canonExtractionIssues.issues.$[issue].resolvedAt": resolution.resolvedAt,
        },
      },
      {
        arrayFilters: [{ "issue.factId": issueId, "issue.status": "accepting" }],
        new: true,
      },
    ).lean<StoryDoc | null>();

    if (!result) return null;
    const raw = result.canonExtractionIssues as
      | { issues: CanonExtractionIssueRecord[] }
      | null;
    if (!raw || !Array.isArray(raw.issues)) return null;
    return raw.issues.find((i) => i.factId === issueId) ?? null;
  },

  async rollbackIssue(
    clerkUserId: string,
    storyId: string,
    issueId: string,
  ): Promise<CanonExtractionIssueRecord | null> {
    const { Story } = await models();
    const result = await Story.findOneAndUpdate(
      {
        ...ownedQuery(clerkUserId, storyId),
        "canonExtractionIssues.issues": {
          $elemMatch: { factId: issueId, status: "accepting" },
        },
      },
      {
        $set: {
          "canonExtractionIssues.issues.$[issue].status": "pending_review",
        },
      },
      {
        arrayFilters: [{ "issue.factId": issueId, "issue.status": "accepting" }],
        new: true,
      },
    ).lean<StoryDoc | null>();

    if (!result) return null;
    const raw = result.canonExtractionIssues as
      | { issues: CanonExtractionIssueRecord[] }
      | null;
    if (!raw || !Array.isArray(raw.issues)) return null;
    return raw.issues.find((i) => i.factId === issueId) ?? null;
  },
};
