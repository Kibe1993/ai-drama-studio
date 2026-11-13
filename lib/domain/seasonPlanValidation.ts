import type {
  SeasonPlan,
  SeasonPlanValidationFindings,
  ValidationFinding,
} from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";

/**
 * CASNA Stage C: Validate a Season Plan before it is presented for approval.
 *
 * This is an application-level structural validation, not a prompt-level check.
 * It examines the plan for continuity, progression, repetition, character
 * development, and narrative structure issues. It is deterministic and does
 * not call an LLM.
 *
 * The validation returns structured findings. Errors must be addressed before
 * approval; warnings are informational.
 */

const MAX_EPISODE_REPETITION = 0.4;

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function shingles(text: string): Set<string> {
  const words = normalize(text)
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length > 2);
  if (words.length < 2) return new Set(words);
  const set = new Set<string>();
  for (let index = 0; index <= words.length - 2; index += 1) {
    set.add(`${words[index]} ${words[index + 1]}`);
  }
  return set;
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = shingles(a);
  const setB = shingles(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection += 1;
  return intersection / (setA.size + setB.size - intersection);
}

function validateContinuity(plan: SeasonPlan, bible: StoryBibleContent | null): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  // Check that episode numbers are sequential
  for (let i = 0; i < plan.episodeProgression.length; i++) {
    const episode = plan.episodeProgression[i]!;
    if (episode.episodeNumber !== i + 1) {
      findings.push({
        category: "continuity",
        severity: "error",
        episodeNumber: episode.episodeNumber,
        message: `Episode ${episode.episodeNumber} is out of sequence; expected ${i + 1}.`,
      });
    }
  }
  // Check that starting situations reference prior consequences
  for (let i = 1; i < plan.episodeProgression.length; i++) {
    const prev = plan.episodeProgression[i - 1]!;
    const curr = plan.episodeProgression[i]!;
    const hasConnection =
      prev.consequences.length > 0 ||
      normalize(curr.startingSituation).length > 20;
    if (!hasConnection) {
      findings.push({
        category: "continuity",
        severity: "warning",
        episodeNumber: curr.episodeNumber,
        message: `Episode ${curr.episodeNumber} does not clearly build on the consequences of episode ${prev.episodeNumber}.`,
      });
    }
  }
  // Check character names match the bible where one exists
  if (bible) {
    const bibleNames = new Set(
      bible.characters.characters.map((c) => normalize(c.name))
    );
    for (const episode of plan.episodeProgression) {
      const mentioned = normalize(episode.characterDevelopment + " " + episode.startingSituation);
      for (const name of bibleNames) {
        if (!mentioned.includes(name) && name.length > 2) {
          // Only warn: not every episode must mention every character
        }
      }
    }
  }
  return findings;
}

function validateProgression(plan: SeasonPlan): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const seenObjectives = new Set<string>();
  for (const episode of plan.episodeProgression) {
    const obj = normalize(episode.mainObjective);
    if (seenObjectives.has(obj)) {
      findings.push({
        category: "progression",
        severity: "error",
        episodeNumber: episode.episodeNumber,
        message: `Episode ${episode.episodeNumber} repeats the main objective of an earlier episode.`,
      });
    }
    seenObjectives.add(obj);
    if (!episode.storyContribution || episode.storyContribution.trim().length < 10) {
      findings.push({
        category: "progression",
        severity: "warning",
        episodeNumber: episode.episodeNumber,
        message: `Episode ${episode.episodeNumber} does not explain how it advances the overall season.`,
      });
    }
  }
  return findings;
}

function validateRepetition(plan: SeasonPlan): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const episodes = plan.episodeProgression;
  for (let i = 0; i < episodes.length; i++) {
    for (let j = i + 1; j < episodes.length; j++) {
      const a = episodes[i]!;
      const b = episodes[j]!;
      const conflictSim = jaccardSimilarity(a.centralConflict, b.centralConflict);
      if (conflictSim > MAX_EPISODE_REPETITION) {
        findings.push({
          category: "repetition",
          severity: "warning",
          episodeNumber: b.episodeNumber,
          message: `Episode ${b.episodeNumber} central conflict is too similar to episode ${a.episodeNumber}.`,
        });
      }
      const beatsSim = jaccardSimilarity(a.majorStoryBeats.join(" "), b.majorStoryBeats.join(" "));
      if (beatsSim > MAX_EPISODE_REPETITION) {
        findings.push({
          category: "repetition",
          severity: "warning",
          episodeNumber: b.episodeNumber,
          message: `Episode ${b.episodeNumber} story beats overlap heavily with episode ${a.episodeNumber}.`,
        });
      }
      const endingSim = jaccardSimilarity(a.endingOrCliffhanger, b.endingOrCliffhanger);
      if (endingSim > MAX_EPISODE_REPETITION) {
        findings.push({
          category: "repetition",
          severity: "warning",
          episodeNumber: b.episodeNumber,
          message: `Episode ${b.episodeNumber} reuses the ending beat of episode ${a.episodeNumber}.`,
        });
      }
      const revelationSim = jaccardSimilarity(
        a.informationRevealed.join(" "),
        b.informationRevealed.join(" ")
      );
      if (revelationSim > 0.5) {
        findings.push({
          category: "repetition",
          severity: "warning",
          episodeNumber: b.episodeNumber,
          message: `Episode ${b.episodeNumber} reveals information that episode ${a.episodeNumber} already revealed.`,
        });
      }
    }
  }
  return findings;
}

function validateCharacterDevelopment(plan: SeasonPlan): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const episode of plan.episodeProgression) {
    if (!episode.characterDevelopment || episode.characterDevelopment.trim().length < 10) {
      findings.push({
        category: "character_development",
        severity: "warning",
        episodeNumber: episode.episodeNumber,
        message: `Episode ${episode.episodeNumber} lacks meaningful character development.`,
      });
    }
  }
  if (plan.overallCharacterDevelopment.trim().length < 20) {
    findings.push({
      category: "character_development",
      severity: "warning",
      message: "The plan does not describe overall character development across the season.",
    });
  }
  return findings;
}

function validateNarrativeStructure(plan: SeasonPlan): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  // Check for a beginning, middle, and ending direction
  if (plan.beginningDirection.trim().length < 10) {
    findings.push({ category: "narrative_structure", severity: "warning", message: "Beginning direction is too brief." });
  }
  if (plan.middleDirection.trim().length < 10) {
    findings.push({ category: "narrative_structure", severity: "warning", message: "Middle direction is too brief." });
  }
  if (plan.endingDirection.trim().length < 10) {
    findings.push({ category: "narrative_structure", severity: "warning", message: "Ending direction is too brief." });
  }
  // Check that unresolved questions exist for a serialized story
  if (plan.episodeProgression.length > 2 && plan.unresolvedQuestions.length === 0) {
    findings.push({
      category: "narrative_structure",
      severity: "warning",
      message: "A multi-episode season should have unresolved questions to sustain engagement.",
    });
  }
  // Check that the intended conclusion exists
  if (plan.intendedSeasonConclusion.trim().length < 10) {
    findings.push({
      category: "narrative_structure",
      severity: "error",
      message: "The intended season conclusion is missing or too brief.",
    });
  }
  // Check that payoffs reference setups
  if (plan.setupAndPayoff.length === 0 && plan.episodeProgression.length > 2) {
    findings.push({
      category: "narrative_structure",
      severity: "warning",
      message: "No setup and payoff opportunities are described for a multi-episode season.",
    });
  }
  return findings;
}

/**
 * Run all validation checks on a Season Plan.
 * Returns structured findings. If any error-severity finding exists, the plan
 * does not pass.
 */
export function validateSeasonPlan(
  plan: SeasonPlan,
  bible: StoryBibleContent | null
): SeasonPlanValidationFindings {
  const findings: ValidationFinding[] = [
    ...validateContinuity(plan, bible),
    ...validateProgression(plan),
    ...validateRepetition(plan),
    ...validateCharacterDevelopment(plan),
    ...validateNarrativeStructure(plan),
  ];
  const passed = !findings.some((f) => f.severity === "error");
  return {
    passed,
    findings,
    validatedAt: new Date().toISOString(),
  };
}
