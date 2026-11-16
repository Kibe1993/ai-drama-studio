import { Schema, type Connection, type Model } from "mongoose";

const validationFindingSchema = new Schema(
  {
    category: { type: String, required: true },
    severity: { type: String, enum: ["warning", "error"], required: true },
    episodeNumber: { type: Number, min: 1 },
    message: { type: String, required: true, maxlength: 600 },
  },
  { _id: false }
);

const richValidationFindingSchema = new Schema(
  {
    findingId: { type: String, required: true, maxlength: 80 },
    category: { type: String, required: true },
    severity: { type: String, enum: ["blocking", "high", "medium", "low"], required: true },
    episodeNumber: { type: Number, min: 1, max: 100 },
    affectedField: { type: String, maxlength: 200 },
    affectedEvent: { type: String, maxlength: 200 },
    message: { type: String, required: true, maxlength: 600 },
    explanation: { type: String, maxlength: 1000 },
    evidence: { type: [String], default: [] },
    whyItMatters: { type: String, maxlength: 500 },
    recommendation: { type: String, maxlength: 600 },
    requiresHumanReview: { type: Boolean, default: false },
    source: { type: String, enum: ["deterministic", "ai_reasoning"], default: "deterministic" },
    canonIssueType: { type: String },
  },
  { _id: false }
);

const repairAttemptSchema = new Schema(
  {
    attempt: { type: Number, required: true, min: 1, max: 5 },
    findingId: { type: String, required: true, maxlength: 80 },
    episodeNumber: { type: Number, min: 1, max: 100 },
    provider: { type: String, default: "" },
    model: { type: String, default: "" },
    status: { type: String, enum: ["success", "failed", "skipped"], default: "failed" },
    message: { type: String, required: true, maxlength: 500 },
    repairedAt: { type: String, required: true },
  },
  { _id: false }
);

const aiReasoningMetadataSchema = new Schema(
  {
    available: { type: Boolean, required: true },
    provider: { type: String, default: "" },
    model: { type: String, default: "" },
    fallbackFrom: { type: String, default: null },
    findingCount: { type: Number, default: 0 },
    error: { type: String, maxlength: 300 },
    latencyMs: { type: Number, min: 0 },
  },
  { _id: false }
);

const validationResultSchema = new Schema(
  {
    passed: { type: Boolean, required: true },
    overallSeverity: { type: String, enum: ["blocking", "high", "medium", "low"], default: "low" },
    findings: { type: [richValidationFindingSchema], default: [] },
    deterministicFindingCount: { type: Number, default: 0 },
    aiFindingCount: { type: Number, default: 0 },
    aiReasoning: { type: aiReasoningMetadataSchema, default: null },
    repairHistory: { type: [repairAttemptSchema], default: [] },
    validatorVersion: { type: String, default: "2.0" },
    validatedAt: { type: String, required: true },
    bibleVersion: { type: Number, min: 0 },
    planVersion: { type: Number, min: 1 },
  },
  { _id: false }
);

const revisionEpisodeChangeSchema = new Schema(
  {
    episodeNumber: { type: Number, required: true, min: 1, max: 100 },
    changedFields: { type: [String], default: [] },
  },
  { _id: false }
);

const revisionRoundSummarySchema = new Schema(
  {
    round: { type: Number, required: true, min: 1 },
    actionsApplied: { type: Number, default: 0, min: 0 },
    actionsRejected: { type: Number, default: 0, min: 0 },
    actionsFailed: { type: Number, default: 0, min: 0 },
    stopReason: { type: String, default: "" },
  },
  { _id: false }
);

const revisionHistoryEntrySchema = new Schema(
  {
    entryId: { type: String, required: true, maxlength: 80 },
    timestamp: { type: String, required: true },
    source: { type: String, enum: ["auto_revalidation", "manual_edit", "rollback"], required: true },
    fromVersion: { type: Number, required: true, min: 1 },
    toVersion: { type: Number, required: true, min: 1 },
    reason: { type: String, default: "" },
    stopReason: { type: String, default: "" },
    totalRounds: { type: Number, default: 0, min: 0 },
    totalRevisionsApplied: { type: Number, default: 0, min: 0 },
    totalRevisionsRejected: { type: Number, default: 0, min: 0 },
    rounds: { type: [revisionRoundSummarySchema], default: [] },
    episodeChanges: { type: [revisionEpisodeChangeSchema], default: [] },
    findingsBefore: { type: Number, default: 0, min: 0 },
    findingsAfter: { type: Number, default: 0, min: 0 },
    blockingResolved: { type: Boolean, default: false },
    reviewStatus: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: String, default: null },
    reviewNotes: { type: String, default: null },
  },
  { _id: false }
);

const episodePlanItemSchema = new Schema(
  {
    episodeNumber: { type: Number, required: true, min: 1, max: 100 },
    workingTitle: { type: String, required: true, maxlength: 120 },
    narrativePurpose: { type: String, required: true, maxlength: 600 },
    startingSituation: { type: String, required: true, maxlength: 800 },
    mainObjective: { type: String, required: true, maxlength: 600 },
    centralConflict: { type: String, required: true, maxlength: 600 },
    majorStoryBeats: { type: [String], default: [], validate: (v: unknown[]) => v.length <= 10 },
    informationRevealed: { type: [String], default: [], validate: (v: unknown[]) => v.length <= 8 },
    characterDevelopment: { type: String, required: true, maxlength: 800 },
    importantEvents: { type: [String], default: [], validate: (v: unknown[]) => v.length <= 8 },
    consequences: { type: [String], default: [], validate: (v: unknown[]) => v.length <= 8 },
    storyContribution: { type: String, required: true, maxlength: 600 },
    endingOrCliffhanger: { type: String, required: true, maxlength: 600 },
    unresolvedThreads: { type: [String], default: [], validate: (v: unknown[]) => v.length <= 6 },
    continuityRequirements: { type: String, required: true, maxlength: 600 },
    characterArcChanges: {
      type: [{ name: { type: String, maxlength: 80 }, change: { type: String, maxlength: 400 } }],
      default: [],
      validate: (v: unknown[]) => v.length <= 8,
    },
    relationshipChanges: {
      type: [{
        from: { type: String, maxlength: 80 },
        to: { type: String, maxlength: 80 },
        change: { type: String, maxlength: 300 },
      }],
      default: [],
      validate: (v: unknown[]) => v.length <= 6,
    },
    objectChanges: {
      type: [{
        name: { type: String, maxlength: 120 },
        ownership: { type: String, maxlength: 200 },
        condition: { type: String, maxlength: 300 },
      }],
      default: [],
      validate: (v: unknown[]) => v.length <= 6,
    },
    locationChanges: {
      type: [{ name: { type: String, maxlength: 120 }, change: { type: String, maxlength: 300 } }],
      default: [],
      validate: (v: unknown[]) => v.length <= 6,
    },
  },
  { _id: false }
);

const SeasonPlanSchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    seasonObjective: { type: String, required: true, maxlength: 1200 },
    centralConflictOrMystery: { type: String, required: true, maxlength: 1000 },
    mainCharacterObjectives: { type: String, required: true, maxlength: 1000 },
    overallCharacterDevelopment: { type: String, required: true, maxlength: 1000 },
    majorStoryDevelopments: { type: [String], default: [] },
    beginningDirection: { type: String, required: true, maxlength: 800 },
    middleDirection: { type: String, required: true, maxlength: 800 },
    endingDirection: { type: String, required: true, maxlength: 800 },
    episodeProgression: { type: [episodePlanItemSchema], default: [] },
    importantRevelations: { type: [String], default: [] },
    relationshipChanges: { type: [String], default: [] },
    consequencesCarriedBetween: { type: [String], default: [] },
    setupAndPayoff: { type: [String], default: [] },
    unresolvedQuestions: { type: [String], default: [] },
    intendedSeasonConclusion: { type: String, required: true, maxlength: 1000 },
    basedOnBibleVersion: { type: Number, required: true, min: 0 },
    basedOnBibleFingerprint: { type: String, required: true, maxlength: 40 },
    version: { type: Number, default: 1, min: 1 },
    status: { type: String, enum: ["awaiting_approval", "approved", "failed", "rejected"], default: "awaiting_approval" },
    provider: { type: String, default: "" },
    model: { type: String, default: "" },
    fallbackFrom: { type: String, default: null },
    validationFindings: {
      type: {
        passed: { type: Boolean, required: true },
        findings: { type: [validationFindingSchema], default: [] },
        validatedAt: { type: String, required: true },
      },
      default: null,
    },
    validationResult: {
      type: validationResultSchema,
      default: null,
    },
    revisionHistory: {
      type: [revisionHistoryEntrySchema],
      default: [],
    },
  },
  { timestamps: true, collection: "seasonPlans" }
);

SeasonPlanSchema.index({ clerkUserId: 1, projectId: 1, version: -1 });

export function seasonPlanModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.StudioSeasonPlan;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("StudioSeasonPlan", SeasonPlanSchema) as unknown as Model<Record<string, unknown>>;
}
