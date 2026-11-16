import { z } from "zod";
import type { ExtractionResult } from "@/lib/validation/narrativeEngine";

const KNOWN_OBJECT_KEYS = new Set([
  "episodeNumber", "workingTitle", "narrativePurpose", "startingSituation",
  "mainObjective", "centralConflict", "majorStoryBeats", "informationRevealed",
  "characterDevelopment", "importantEvents", "consequences", "storyContribution",
  "endingOrCliffhanger", "unresolvedThreads", "continuityRequirements",
  "characterArcChanges", "relationshipChanges", "objectChanges", "locationChanges",
  "seasonObjective", "centralConflictOrMystery", "mainCharacterObjectives",
  "overallCharacterDevelopment", "majorStoryDevelopments", "beginningDirection",
  "middleDirection", "endingDirection", "episodeProgression", "importantRevelations",
  "consequencesCarriedBetween", "setupAndPayoff", "unresolvedQuestions",
  "intendedSeasonConclusion", "episodeOutlines",
  "identity", "world", "characters", "narrative", "guidelines", "canon",
  "title", "genres", "subgenres", "centralPremise", "narrativeConcept",
  "toneAndAtmosphere", "targetAudience", "centralConflict",
  "description", "geographyAndLocations", "socialStructuresAndCultures",
  "historyAndPastEvents", "rules", "definingSystems",
  "name", "storyRole", "roleDescription", "physicalDescription", "personality",
  "background", "motivations", "fearsAndWeaknesses", "abilitiesAndLimitations",
  "relationships", "secrets", "developmentPotential", "relationshipDynamics",
  "mainStoryline", "majorConflicts", "longTermDirection", "subplots",
  "unresolvedMysteries", "potentialFutureRevelations", "majorNarrativeQuestions",
  "serializedEndingGuidance", "mainThemes", "secondaryThemes", "storytellingStyle",
  "boundaries", "mustRemainConsistent", "confirmedFacts", "proposedDetails",
  "hiddenInformation", "characterKnowledge", "audienceKnowledge",
  "characterName", "knows", "believes", "change", "from", "to",
  "storyFunction", "limitations", "consequences", "tensionOrChange",
]);

function filterObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    const filtered = value
      .filter((item) => typeof item !== "string" || !KNOWN_OBJECT_KEYS.has(item))
      .map((item) => filterObjectKeys(item));
    return filtered;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = filterObjectKeys(val);
    }
    return result;
  }
  return value;
}

export function extractStructuredNarrativeData<T>(
  raw: unknown,
  schema: z.ZodType<T>,
): ExtractionResult<T> {
  const result = schema.safeParse(raw);
  if (result.success) {
    const data = filterObjectKeys(result.data) as T;
    return { success: true, data, errors: [] };
  }
  return {
    success: false,
    errors: result.error.issues.map((issue: z.ZodIssue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  };
}

export function buildIncompleteValidationResult(
  extraction: ExtractionResult<unknown>,
): {
    valid: boolean;
    complete: boolean;
    findings: Array<{
      code: string;
      severity: "error" | "warning" | "info";
      episode: number;
      message: string;
      evidence?: string;
    }>;
    summary: { errors: number; warnings: number; info: number };
  } {
  const errors = extraction.errors.map((e) => ({
    code: "EXTRACTION_ERROR",
    severity: "error" as const,
    episode: 0,
    message: `Extraction error at ${e.path}: ${e.message}`,
    evidence: e.message,
  }));
  return {
    valid: false,
    complete: false,
    findings: errors,
    summary: {
      errors: errors.length,
      warnings: 0,
      info: 0,
    },
  };
}