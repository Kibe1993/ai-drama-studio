import { createHash } from "node:crypto";
import { z } from "zod";
import {
  characterStateSchema,
  continuityLocationStateSchema,
  continuityObjectStateSchema,
  unresolvedThreadSchema,
} from "@/lib/validation/continuityLedger";

const text = (max: number) => z.string().trim().min(1).max(max);
const list = (maxItems: number, maxLen: number) => z.array(text(maxLen)).max(maxItems);

/**
 * CASNA Stage F: the episode-specific plan that is generated before a
 * screenplay. It is derived from the approved Season Plan's episode entry and
 * augmented with what the episode inherits from the Continuity Ledger and the
 * previous approved episode. It is validated against the Season Plan before the
 * screenplay is written, and stored on the story draft as proposed content that
 * only becomes canon when the episode is approved.
 */
export const episodePlanSchema = z.object({
  episodeNumber: z.number().int().positive().max(100),
  workingTitle: text(120),
  narrativePurpose: text(600),
  /** The approved Season Plan version this episode plan was derived from. */
  sourcePlanVersion: z.number().int().min(1),
  /** What the episode inherits from earlier approved episodes and the ledger. */
  inheritsFrom: list(8, 400),
  intendsToAchieve: text(600),
  /** Proposed developments. Not canon until the episode is approved. */
  newDevelopments: list(8, 400),
  characterChanges: list(6, 400),
  informationRevealed: list(8, 400),
  consequencesCreated: list(8, 400),
  seasonAdvance: text(600),
  carryForward: text(600),
  continuityRequirements: text(600),
  unresolvedThreads: list(6, 400),
  /** Structured canon deltas proposed for this episode (from the approved plan). */
  characterArcChanges: z
    .array(z.object({ name: text(80), change: text(400) }))
    .max(8)
    .optional(),
  relationshipChanges: z
    .array(z.object({ from: text(80), to: text(80), change: text(300) }))
    .max(6)
    .optional(),
  objectChanges: z
    .array(z.object({ name: text(120), ownership: text(200), condition: text(300) }))
    .max(6)
    .optional(),
  locationChanges: z
    .array(z.object({ name: text(120), change: text(300) }))
    .max(6)
    .optional(),
});

export type EpisodePlan = z.infer<typeof episodePlanSchema>;

export const EPISODE_PLAN_CATEGORIES = [
  "completeness",
  "canon",
  "continuity",
  "progression",
  "repetition",
  "structure",
  "duration",
  "timeline",
  "knowledge",
  "quality",
] as const;

export type EpisodeValidationCategory = (typeof EPISODE_PLAN_CATEGORIES)[number];

export const FINDING_RESOLUTION_STATUSES = [
  "open",
  "revision_requested",
  "resolved",
  "accepted_as_intentional",
  "recheck_required",
] as const;

export type FindingResolutionStatus = (typeof FINDING_RESOLUTION_STATUSES)[number];

export const findingResolutionSchema = z.object({
  status: z.enum(FINDING_RESOLUTION_STATUSES),
  note: z.string().trim().max(1000).optional(),
  resolvedAt: z.string().trim().min(1).max(40).optional(),
});

export type FindingResolution = z.infer<typeof findingResolutionSchema>;

export const episodeValidationFindingSchema = z.object({
  category: z.enum(EPISODE_PLAN_CATEGORIES),
  severity: z.enum(["warning", "error"]),
  sceneNumber: z.number().int().positive().optional(),
  message: text(600),
  /** Validator that produced the finding, when narrative control supplied it. */
  code: z.string().trim().min(1).max(80).optional(),
  /** Quoted proposal text that triggered the finding. */
  evidence: z.string().trim().min(1).max(400).optional(),
  /** Stable finding identifier (16-char hex hash from the narrative control system). */
  id: z.string().trim().min(1).max(40).optional(),
  /** Short human-readable title summarising the finding. */
  title: z.string().trim().min(1).max(120).optional(),
  /** The narrative requirement the validator expected to hold. */
  expected: z.string().trim().min(1).max(400).optional(),
  /** The narrative content the validator actually observed. */
  actual: z.string().trim().min(1).max(400).optional(),
  /** Suggested correction the creator or model can apply. */
  suggestedCorrection: z.string().trim().min(1).max(600).optional(),
  /** Confidence level of the finding. */
  confidence: z.enum(["high", "medium", "low"]).optional(),
  /** Which act (1, 2, or 3) the finding affects, when known. */
  affectedAct: z.number().int().min(1).max(3).optional(),
  /** When true, the creator cannot accept this as intentional — it must be fixed. */
  requiresCanonAuthorization: z.boolean().optional(),
  /** When true, the system can attempt automatic repair without human guidance. */
  automaticRepairSafe: z.boolean().optional(),
  /** Current resolution status. Absent (treated as "open") on legacy findings. */
  resolutionStatus: z.enum(FINDING_RESOLUTION_STATUSES).optional(),
  /** Creator's explanation when accepting as intentional. */
  resolutionNote: z.string().trim().max(1000).optional(),
  /** ISO timestamp of the last resolution status change. */
  resolvedAt: z.string().trim().min(1).max(40).optional(),
});

export type EpisodeValidationFinding = z.infer<typeof episodeValidationFindingSchema>;

export const episodeValidationSchema = z.object({
  passed: z.boolean(),
  findings: z.array(episodeValidationFindingSchema),
  validatedAt: z.string().trim().min(1).max(40),
  narrativeCanonVersion: z.number().int().nonnegative().optional(),
  narrativeValidationLayers: z.array(z.enum(["structural", "deterministic", "semantic", "regression"])).max(4).optional(),
  narrativeDecision: z.enum(["approve", "reject", "needs_authorization"]).optional(),
});

export type EpisodeValidation = z.infer<typeof episodeValidationSchema>;

/**
 * Compute a stable finding ID from category, message, and scene number.
 * Used to normalize legacy findings that were persisted without an `id`.
 */
export function stableFindingId(category: string, message: string, sceneNumber?: number): string {
  return createHash("sha256")
    .update([category, message.slice(0, 200), String(sceneNumber ?? "")].join("|"))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Ensure every finding in an EpisodeValidation has a stable `id`.
 * Findings that already have an `id` are preserved unchanged.
 * Findings without an `id` receive one computed from their category,
 * message, and scene number. This normalizes legacy findings loaded
 * from MongoDB so they can be resolved by ID.
 */
export function normalizeFindingIds(validation: EpisodeValidation): EpisodeValidation {
  const findings = validation.findings.map((f) =>
    f.id ? f : { ...f, id: stableFindingId(f.category, f.message, f.sceneNumber) },
  );
  return { ...validation, findings };
}

/**
 * Returns true when a finding blocks story approval. A finding blocks approval
 * when it is an error that has not been accepted as intentional AND does not
 * require canon authorization (which means the creator cannot override it).
 */
export function isBlockingFinding(finding: EpisodeValidationFinding): boolean {
  if (finding.severity !== "error") return false;
  const status = finding.resolutionStatus ?? "open";
  if (status === "accepted_as_intentional") return false;
  if (status === "resolved") return false;
  return true;
}

/**
 * Returns true when the creator is permitted to accept a finding as an
 * intentional creative choice. Findings that require canon authorization
 * cannot be overridden by the creator.
 */
export function canAcceptAsIntentional(finding: EpisodeValidationFinding): boolean {
  return !finding.requiresCanonAuthorization;
}

/**
 * Returns true when every error-severity finding in the validation is either
 * resolved or accepted as intentional (and thus does not block approval).
 */
export function validationPassesForApproval(validation: EpisodeValidation): boolean {
  return validation.findings.every((finding) => !isBlockingFinding(finding));
}

/**
 * Carry forward creator resolutions from a previous validation to a new one.
 * Findings are matched by stable `id` first, then by `code + category +
 * sceneNumber` as a fallback. This lets a creator's "accepted as intentional"
 * decision survive a revalidation that re-detects the same issue.
 */
export function mergeResolutions(
  previous: EpisodeValidation,
  next: EpisodeValidation,
): EpisodeValidation {
  const resolutionById = new Map<string, EpisodeValidationFinding>();
  const resolutionByKey = new Map<string, EpisodeValidationFinding>();
  for (const finding of previous.findings) {
    const status = finding.resolutionStatus;
    if (!status || status === "open") continue;
    if (finding.id) resolutionById.set(finding.id, finding);
    const key = `${finding.code ?? ""}:${finding.category}:${finding.sceneNumber ?? 0}`;
    resolutionByKey.set(key, finding);
  }
  const mergedFindings = next.findings.map((finding) => {
    if (finding.id && resolutionById.has(finding.id)) {
      const prev = resolutionById.get(finding.id)!;
      return { ...finding, resolutionStatus: prev.resolutionStatus, resolutionNote: prev.resolutionNote, resolvedAt: prev.resolvedAt };
    }
    const key = `${finding.code ?? ""}:${finding.category}:${finding.sceneNumber ?? 0}`;
    if (resolutionByKey.has(key)) {
      const prev = resolutionByKey.get(key)!;
      return { ...finding, resolutionStatus: prev.resolutionStatus, resolutionNote: prev.resolutionNote, resolvedAt: prev.resolvedAt };
    }
    return finding;
  });
  return { ...next, findings: mergedFindings };
}

/**
 * CASNA Stage I: the authoritative summary of an approved episode. It is built
 * from the approved Season Plan entry for the episode plus the approved
 * screenplay, and becomes the only source the Continuity Ledger is updated from.
 */
export const episodeCanonSummarySchema = z.object({
  episodeNumber: z.number().int().positive().max(100),
  title: text(120),
  summary: text(2000),
  events: z
    .array(
      z.object({
        event: text(400),
        consequence: text(400),
        affectedCharacters: list(8, 80),
        revealedInformation: list(6, 300),
      })
    )
    .max(10),
  characterStates: z.array(characterStateSchema).max(24),
  locationStates: z.array(continuityLocationStateSchema).max(18),
  objectStates: z.array(continuityObjectStateSchema).max(18).default([]),
  revealedSecrets: list(10, 400),
  unresolvedThreads: z.array(unresolvedThreadSchema).max(16),
  consequences: list(10, 400),
});

export type EpisodeCanonSummary = z.infer<typeof episodeCanonSummarySchema>;
