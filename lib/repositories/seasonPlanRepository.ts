import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { seasonPlanModel } from "@/lib/models/seasonPlan";
import { projectModel } from "@/lib/models/project";
import { ownedQuery } from "@/lib/repositories/ownership";
import { JobError } from "@/lib/pipeline/types";
import {
  seasonPlanSchema,
  seasonPlanValidationFindingsSchema,
  type SeasonPlan,
  type SeasonPlanRecord,
  type SeasonPlanStatus,
  type SeasonPlanValidationFindings,
} from "@/lib/validation/seasonPlan";
import {
  seasonPlanValidationResultSchema,
  type SeasonPlanValidationResult,
} from "@/lib/validation/seasonPlanValidation";

type PlanDoc = {
  _id: mongoose.Types.ObjectId;
  clerkUserId: string;
  projectId: mongoose.Types.ObjectId;
  seasonObjective: string;
  centralConflictOrMystery: string;
  mainCharacterObjectives: string;
  overallCharacterDevelopment: string;
  majorStoryDevelopments: string[];
  beginningDirection: string;
  middleDirection: string;
  endingDirection: string;
  episodeProgression: unknown[];
  importantRevelations: string[];
  relationshipChanges: string[];
  consequencesCarriedBetween: string[];
  setupAndPayoff: string[];
  unresolvedQuestions: string[];
  intendedSeasonConclusion: string;
  basedOnBibleVersion: number;
  basedOnBibleFingerprint: string;
  version: number;
  status: SeasonPlanStatus;
  provider: string;
  model: string;
  fallbackFrom: string | null;
  validationFindings: unknown;
  validationResult: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: PlanDoc): SeasonPlanRecord {
  const parsed = seasonPlanSchema.parse({
    seasonObjective: doc.seasonObjective,
    centralConflictOrMystery: doc.centralConflictOrMystery,
    mainCharacterObjectives: doc.mainCharacterObjectives,
    overallCharacterDevelopment: doc.overallCharacterDevelopment,
    majorStoryDevelopments: doc.majorStoryDevelopments ?? [],
    beginningDirection: doc.beginningDirection,
    middleDirection: doc.middleDirection,
    endingDirection: doc.endingDirection,
    episodeProgression: doc.episodeProgression ?? [],
    importantRevelations: doc.importantRevelations ?? [],
    relationshipChanges: doc.relationshipChanges ?? [],
    consequencesCarriedBetween: doc.consequencesCarriedBetween ?? [],
    setupAndPayoff: doc.setupAndPayoff ?? [],
    unresolvedQuestions: doc.unresolvedQuestions ?? [],
    intendedSeasonConclusion: doc.intendedSeasonConclusion,
  });
  return {
    ...parsed,
    id: doc._id.toString(),
    clerkUserId: doc.clerkUserId,
    projectId: doc.projectId.toString(),
    basedOnBibleVersion: doc.basedOnBibleVersion,
    basedOnBibleFingerprint: doc.basedOnBibleFingerprint,
    version: doc.version,
    status: doc.status,
    provider: doc.provider || "",
    model: doc.model || "",
    fallbackFrom: doc.fallbackFrom ?? null,
    validationFindings: parseValidationFindings(doc.validationFindings),
    validationResult: parseValidationResult(doc.validationResult),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function parseValidationFindings(raw: unknown): SeasonPlanValidationFindings | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = seasonPlanValidationFindingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseValidationResult(raw: unknown): SeasonPlanValidationResult | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = seasonPlanValidationResultSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function models() {
  const connection = await connectDB();
  return { Plan: seasonPlanModel(connection), Project: projectModel(connection) };
}

export type SeasonPlanDraft = SeasonPlan & {
  clerkUserId: string;
  projectId: string;
  basedOnBibleVersion: number;
  basedOnBibleFingerprint: string;
  provider?: string;
  model?: string;
  fallbackFrom?: string | null;
};

export const seasonPlanRepository = {
  /** Insert a new plan version with awaiting_approval status. */
  async insert(input: SeasonPlanDraft): Promise<SeasonPlanRecord> {
    const { Plan, Project } = await models();
    if (!(await Project.exists(ownedQuery(input.clerkUserId, input.projectId)))) {
      throw new JobError("Project not found for season plan.", "not_found", false);
    }
    const latest = await Plan.findOne({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
    })
      .sort({ version: -1 })
      .lean<{ version: number } | null>();
    const doc = await Plan.create({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
      seasonObjective: input.seasonObjective,
      centralConflictOrMystery: input.centralConflictOrMystery,
      mainCharacterObjectives: input.mainCharacterObjectives,
      overallCharacterDevelopment: input.overallCharacterDevelopment,
      majorStoryDevelopments: input.majorStoryDevelopments,
      beginningDirection: input.beginningDirection,
      middleDirection: input.middleDirection,
      endingDirection: input.endingDirection,
      episodeProgression: input.episodeProgression,
      importantRevelations: input.importantRevelations,
      relationshipChanges: input.relationshipChanges,
      consequencesCarriedBetween: input.consequencesCarriedBetween,
      setupAndPayoff: input.setupAndPayoff,
      unresolvedQuestions: input.unresolvedQuestions,
      intendedSeasonConclusion: input.intendedSeasonConclusion,
      basedOnBibleVersion: input.basedOnBibleVersion,
      basedOnBibleFingerprint: input.basedOnBibleFingerprint,
      version: (latest?.version ?? 0) + 1,
      status: "awaiting_approval" satisfies SeasonPlanStatus,
      provider: input.provider || "",
      model: input.model || "",
      fallbackFrom: input.fallbackFrom ?? null,
      validationFindings: null,
    });
    return toRecord(doc.toObject() as unknown as PlanDoc);
  },

  /** Find the latest plan for a project (any status). */
  async findLatest(clerkUserId: string, projectId: string): Promise<SeasonPlanRecord | null> {
    const { Plan, Project } = await models();
    if (!(await Project.exists(ownedQuery(clerkUserId, projectId)))) return null;
    const doc = await Plan.findOne({ clerkUserId, projectId })
      .sort({ version: -1 })
      .lean<PlanDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  /** Find the latest approved plan. */
  async findApproved(clerkUserId: string, projectId: string): Promise<SeasonPlanRecord | null> {
    const { Plan, Project } = await models();
    if (!(await Project.exists(ownedQuery(clerkUserId, projectId)))) return null;
    const doc = await Plan.findOne({ clerkUserId, projectId, status: "approved" })
      .sort({ version: -1 })
      .lean<PlanDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  /** Mark a plan as approved. Only awaiting_approval plans can be approved. */
  async markApproved(clerkUserId: string, planId: string): Promise<SeasonPlanRecord | null> {
    const { Plan } = await models();
    const doc = await Plan.findOneAndUpdate(
      { clerkUserId, _id: planId, status: "awaiting_approval" },
      { $set: { status: "approved" } },
      { new: true }
    ).lean<PlanDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  /** Save validation findings on a plan. */
  async saveValidationFindings(
    clerkUserId: string,
    planId: string,
    findings: SeasonPlanValidationFindings
  ): Promise<SeasonPlanRecord | null> {
    const { Plan } = await models();
    const doc = await Plan.findOneAndUpdate(
      { clerkUserId, _id: planId },
      { $set: { validationFindings: findings } },
      { new: true }
    ).lean<PlanDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  /** Save the rich validation result on a plan. */
  async saveValidationResult(
    clerkUserId: string,
    planId: string,
    result: SeasonPlanValidationResult
  ): Promise<SeasonPlanRecord | null> {
    const { Plan } = await models();
    const doc = await Plan.findOneAndUpdate(
      { clerkUserId, _id: planId },
      { $set: { validationResult: result } },
      { new: true }
    ).lean<PlanDoc | null>();
    return doc ? toRecord(doc) : null;
  },
};
