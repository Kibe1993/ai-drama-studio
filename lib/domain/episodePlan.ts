import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import type { EpisodePlan, EpisodeValidation, EpisodeValidationFinding } from "@/lib/validation/casna";
import type { EpisodePlanItem, SeasonPlan } from "@/lib/validation/seasonPlan";

/**
 * CASNA Stage F: build the episode-specific plan for the next episode.
 *
 * The approved Season Plan already defines the episode's purpose, beats,
 * revelations, and consequences. This function binds that entry to what the
 * episode actually inherits: the ledger's established consequences, open
 * threads, and the previous approved episode's ending. Everything it produces is
 * a *proposal* — it becomes canon only when the creator approves the screenplay.
 *
 * Returns null when the approved plan does not cover the requested episode.
 */
export function deriveEpisodePlan(input: {
  plan: SeasonPlan & { version: number };
  ledger: ContinuityLedger | null;
  previousEpisode: { episodeNumber: number; title: string; synopsis: string } | null;
  episodeNumber: number;
}): EpisodePlan | null {
  const { plan, ledger, previousEpisode, episodeNumber } = input;
  const item = plan.episodeProgression.find((entry) => entry.episodeNumber === episodeNumber);
  if (!item) return null;

  const inheritsFrom: string[] = [];
  if (previousEpisode) {
    inheritsFrom.push(
      `Episode ${previousEpisode.episodeNumber} ("${previousEpisode.title}") ended: ${lastSentence(previousEpisode.synopsis)}`
    );
  }
  const previousPlanItem = plan.episodeProgression.find(
    (entry) => entry.episodeNumber === episodeNumber - 1
  );
  if (previousPlanItem && !previousEpisode) {
    inheritsFrom.push(`Planned ending of episode ${previousPlanItem.episodeNumber}: ${previousPlanItem.endingOrCliffhanger}`);
  }
  for (const consequence of ledger?.consequences.slice(-4) ?? []) {
    inheritsFrom.push(`Active consequence: ${consequence}`);
  }
  for (const thread of ledger?.unresolvedThreads.filter((entry) => entry.status !== "resolved").slice(-4) ?? []) {
    inheritsFrom.push(`Open thread from episode ${thread.introducedInEpisode}: ${thread.thread}`);
  }

  return {
    episodeNumber,
    workingTitle: item.workingTitle,
    narrativePurpose: item.narrativePurpose,
    sourcePlanVersion: plan.version,
    inheritsFrom: inheritList(inheritsFrom),
    intendsToAchieve: item.mainObjective,
    newDevelopments: item.majorStoryBeats,
    characterChanges: [item.characterDevelopment],
    informationRevealed: item.informationRevealed,
    consequencesCreated: item.consequences,
    seasonAdvance: item.storyContribution,
    carryForward: item.continuityRequirements,
    continuityRequirements: item.continuityRequirements,
    unresolvedThreads: item.unresolvedThreads,
    characterArcChanges: item.characterArcChanges ?? [],
    relationshipChanges: item.relationshipChanges ?? [],
    objectChanges: item.objectChanges ?? [],
    locationChanges: item.locationChanges ?? [],
  };
}

/**
 * Validate an episode plan against the approved Season Plan before a screenplay
 * is written (Stage F). Errors block generation; warnings are advisory.
 */
export function validateEpisodePlan(input: {
  episodePlan: EpisodePlan;
  plan: SeasonPlan & { version: number };
  previousEpisode: { episodeNumber: number } | null;
}): EpisodeValidation {
  const { episodePlan, plan, previousEpisode } = input;
  const findings: EpisodeValidationFinding[] = [];

  const item = plan.episodeProgression.find(
    (entry) => entry.episodeNumber === episodePlan.episodeNumber
  );
  if (!item) {
    findings.push({
      category: "structure",
      severity: "error",
      message: `The approved Season Plan has no episode ${episodePlan.episodeNumber}.`,
    });
  } else {
    if (normalize(item.narrativePurpose) !== normalize(episodePlan.narrativePurpose)) {
      findings.push({
        category: "structure",
        severity: "error",
        message: `Episode ${episodePlan.episodeNumber} does not follow the approved narrative purpose.`,
      });
    }
    if (normalize(item.mainObjective) !== normalize(episodePlan.intendsToAchieve)) {
      findings.push({
        category: "progression",
        severity: "error",
        message: `Episode ${episodePlan.episodeNumber} does not follow the approved episode objective.`,
      });
    }
    const index = plan.episodeProgression.indexOf(item);
    if (index !== episodePlan.episodeNumber - 1) {
      findings.push({
        category: "continuity",
        severity: "error",
        message: `Episode ${episodePlan.episodeNumber} is out of sequence in the approved plan.`,
      });
    }
  }

  if (episodePlan.sourcePlanVersion !== plan.version) {
    findings.push({
      category: "continuity",
      severity: "error",
      message: "The episode plan was derived from an outdated Season Plan version.",
    });
  }

  if (episodePlan.episodeNumber > 1) {
    if (!previousEpisode) {
      findings.push({
        category: "continuity",
        severity: "error",
        message: `Episode ${episodePlan.episodeNumber} requires the previous approved episode before it can be planned.`,
      });
    }
    if (episodePlan.inheritsFrom.length === 0) {
      findings.push({
        category: "continuity",
        severity: "error",
        message: "The episode plan does not say what it inherits from earlier episodes.",
      });
    }
  }

  if (!episodePlan.continuityRequirements.trim()) {
    findings.push({
      category: "continuity",
      severity: "error",
      message: "The episode plan does not state its continuity requirements for the next episode.",
    });
  }

  if (episodePlan.consequencesCreated.length === 0) {
    findings.push({
      category: "progression",
      severity: "warning",
      message: "The episode plan creates no consequences for later episodes.",
    });
  }

  if (episodePlan.newDevelopments.length === 0) {
    findings.push({
      category: "progression",
      severity: "warning",
      message: "The episode plan introduces no new story developments.",
    });
  }

  return {
    passed: !findings.some((finding) => finding.severity === "error"),
    findings,
    validatedAt: new Date().toISOString(),
  };
}

/** The episode entry for a number, or null. Exported for services and tests. */
export function planEpisodeItem(
  plan: SeasonPlan,
  episodeNumber: number
): EpisodePlanItem | null {
  return plan.episodeProgression.find((entry) => entry.episodeNumber === episodeNumber) ?? null;
}

function inheritList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalize(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= 8) break;
  }
  return result;
}

function lastSentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 400) return trimmed;
  const match = trimmed.match(/[^.!?]+[.!?]\s*$/);
  return (match?.[0] ?? trimmed.slice(-400)).trim();
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
