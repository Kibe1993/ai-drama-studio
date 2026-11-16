import type { EpisodePlanItem, SeasonPlan } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { RevisionAction, SafetyConstraint } from "@/lib/validation/revisionPlan";

/**
 * Revision Safety Checker — verifies that a proposed episode revision
 * satisfies the safety constraints attached to the revision action.
 *
 * The safety checker is a pure function: it takes the original episode,
 * the revised episode, and the safety constraints, and returns a list
 * of violations (empty if the revision is safe).
 *
 * The executor uses the safety checker to reject unsafe revisions before
 * applying them to the plan.
 */

export interface SafetyViolation {
  constraint: SafetyConstraint;
  message: string;
}

export interface SafetyCheckResult {
  passed: boolean;
  violations: SafetyViolation[];
}

// ---------------------------------------------------------------------------
// Individual safety checks
// ---------------------------------------------------------------------------

function checkEpisodeNumberPreserved(
  original: EpisodePlanItem,
  revised: EpisodePlanItem,
): SafetyViolation | null {
  if (original.episodeNumber !== revised.episodeNumber) {
    return {
      constraint: "smallest_possible_change",
      message: `Episode number changed from ${original.episodeNumber} to ${revised.episodeNumber}. The episode number must be preserved.`,
    };
  }
  return null;
}

function checkWorkingTitlePreserved(
  original: EpisodePlanItem,
  revised: EpisodePlanItem,
): SafetyViolation | null {
  if (original.workingTitle !== revised.workingTitle) {
    return {
      constraint: "smallest_possible_change",
      message: `Working title changed from "${original.workingTitle}" to "${revised.workingTitle}". Only change the title if the finding is about the title.`,
    };
  }
  return null;
}

function checkSmallestPossibleChange(
  original: EpisodePlanItem,
  revised: EpisodePlanItem,
): SafetyViolation | null {
  const originalFields = Object.keys(original) as (keyof EpisodePlanItem)[];
  let changedCount = 0;
  for (const field of originalFields) {
    if (JSON.stringify(original[field]) !== JSON.stringify(revised[field])) {
      changedCount += 1;
    }
  }
  if (changedCount > 6) {
    return {
      constraint: "smallest_possible_change",
      message: `Revision changed ${changedCount} fields. This is too many for a targeted correction — the revision should be smaller.`,
    };
  }
  return null;
}

function checkNoFullRewrite(
  original: EpisodePlanItem,
  revised: EpisodePlanItem,
): SafetyViolation | null {
  const fields: (keyof EpisodePlanItem)[] = [
    "majorStoryBeats", "informationRevealed", "importantEvents",
    "consequences", "characterDevelopment", "startingSituation",
    "mainObjective", "centralConflict", "endingOrCliffhanger",
  ];
  let fullyRewrittenCount = 0;
  for (const field of fields) {
    const orig = JSON.stringify(original[field]);
    const rev = JSON.stringify(revised[field]);
    if (orig !== rev) fullyRewrittenCount += 1;
  }
  if (fullyRewrittenCount >= 7) {
    return {
      constraint: "no_full_rewrite",
      message: `Revision rewrote ${fullyRewrittenCount} of ${fields.length} major fields. This is a full rewrite, not a targeted correction.`,
    };
  }
  return null;
}

function checkNoCharacterRemoval(
  original: EpisodePlanItem,
  revised: EpisodePlanItem,
): SafetyViolation | null {
  const originalChars = new Set(
    original.characterArcChanges.map((c) => c.name.toLowerCase()),
  );
  const revisedChars = new Set(
    revised.characterArcChanges.map((c) => c.name.toLowerCase()),
  );
  for (const name of originalChars) {
    if (!revisedChars.has(name)) {
      return {
        constraint: "no_character_removal",
        message: `Character "${name}" was removed from characterArcChanges. Characters should not be removed for name mismatches — correct the name instead.`,
      };
    }
  }
  return null;
}

function checkPreserveSceneOrder(
  original: EpisodePlanItem,
  revised: EpisodePlanItem,
): SafetyViolation | null {
  if (original.majorStoryBeats.length !== revised.majorStoryBeats.length) {
    return {
      constraint: "preserve_scene_order",
      message: `Story beat count changed from ${original.majorStoryBeats.length} to ${revised.majorStoryBeats.length}. Scene order should be preserved.`,
    };
  }
  return null;
}

function checkNoCanonModification(
  original: EpisodePlanItem,
  revised: EpisodePlanItem,
  bible: StoryBibleContent | null,
): SafetyViolation | null {
  if (!bible) return null;
  const bibleChars = new Set(bible.characters.characters.map((c) => c.name.toLowerCase()));
  const revisedChars = revised.characterArcChanges.map((c) => c.name.toLowerCase());
  for (const charName of revisedChars) {
    if (!bibleChars.has(charName)) {
      const originalChars = new Set(original.characterArcChanges.map((c) => c.name.toLowerCase()));
      if (!originalChars.has(charName)) {
        return {
          constraint: "no_canon_modification",
          message: `Revision introduces new character "${charName}" not in the Story Bible canon. New characters require human approval.`,
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main safety check function
// ---------------------------------------------------------------------------

export function checkRevisionSafety(
  original: EpisodePlanItem,
  revised: EpisodePlanItem,
  action: RevisionAction,
  bible: StoryBibleContent | null,
): SafetyCheckResult {
  const violations: SafetyViolation[] = [];
  const constraints = new Set(action.safetyConstraints);

  const episodeNumberViolation = checkEpisodeNumberPreserved(original, revised);
  if (episodeNumberViolation) violations.push(episodeNumberViolation);

  const titleViolation = checkWorkingTitlePreserved(original, revised);
  if (titleViolation) violations.push(titleViolation);

  if (constraints.has("smallest_possible_change")) {
    const violation = checkSmallestPossibleChange(original, revised);
    if (violation) violations.push(violation);
  }

  if (constraints.has("no_full_rewrite")) {
    const violation = checkNoFullRewrite(original, revised);
    if (violation) violations.push(violation);
  }

  if (constraints.has("no_character_removal")) {
    const violation = checkNoCharacterRemoval(original, revised);
    if (violation) violations.push(violation);
  }

  if (constraints.has("preserve_scene_order")) {
    const violation = checkPreserveSceneOrder(original, revised);
    if (violation) violations.push(violation);
  }

  if (constraints.has("no_canon_modification")) {
    const violation = checkNoCanonModification(original, revised, bible);
    if (violation) violations.push(violation);
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

// ---------------------------------------------------------------------------
// Plan-level isolation check — verifies only the targeted episode changed
// ---------------------------------------------------------------------------

export function checkPlanIsolation(
  originalPlan: SeasonPlan,
  revisedPlan: SeasonPlan,
  targetEpisodeNumber: number,
): SafetyCheckResult {
  const violations: SafetyViolation[] = [];

  for (const originalEp of originalPlan.episodeProgression) {
    if (originalEp.episodeNumber === targetEpisodeNumber) continue;
    const revisedEp = revisedPlan.episodeProgression.find(
      (e) => e.episodeNumber === originalEp.episodeNumber,
    );
    if (!revisedEp) {
      violations.push({
        constraint: "smallest_possible_change",
        message: `Episode ${originalEp.episodeNumber} was removed from the plan. Only episode ${targetEpisodeNumber} should be affected.`,
      });
      continue;
    }
    if (JSON.stringify(originalEp) !== JSON.stringify(revisedEp)) {
      violations.push({
        constraint: "smallest_possible_change",
        message: `Episode ${originalEp.episodeNumber} was modified. Only episode ${targetEpisodeNumber} should be affected.`,
      });
    }
  }

  if (originalPlan.seasonObjective !== revisedPlan.seasonObjective) {
    violations.push({
      constraint: "no_premise_change",
      message: "Season objective was modified. Episode revision should not change season-level fields.",
    });
  }

  if (originalPlan.intendedSeasonConclusion !== revisedPlan.intendedSeasonConclusion) {
    violations.push({
      constraint: "no_premise_change",
      message: "Intended season conclusion was modified. Episode revision should not change season-level fields.",
    });
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}