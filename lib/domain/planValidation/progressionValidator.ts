import type { SeasonPlan } from "@/lib/validation/seasonPlan";
import type { RichValidationFinding } from "@/lib/validation/seasonPlanValidation";
import { makeFindingId } from "@/lib/validation/seasonPlanValidation";

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

const MAX_REPETITION = 0.4;

export function validateEpisodeProgression(plan: SeasonPlan): RichValidationFinding[] {
  const findings: RichValidationFinding[] = [];
  const episodes = plan.episodeProgression;

  const seenObjectives = new Set<string>();
  for (const ep of episodes) {
    const obj = normalize(ep.mainObjective);
    if (seenObjectives.has(obj)) {
      findings.push({
        findingId: makeFindingId("prog"),
        category: "episode_progression",
        severity: "high",
        episodeNumber: ep.episodeNumber,
        message: `Episode ${ep.episodeNumber} repeats the main objective of an earlier episode.`,
        recommendation: "Give each episode a distinct main objective.",
        requiresHumanReview: false,
        source: "deterministic",
      });
    }
    seenObjectives.add(obj);
  }

  for (const ep of episodes) {
    if (ep.storyContribution.trim().length < 10) {
      findings.push({
        findingId: makeFindingId("prog"),
        category: "narrative_progression",
        severity: "medium",
        episodeNumber: ep.episodeNumber,
        message: `Episode ${ep.episodeNumber} does not explain how it advances the overall season.`,
        recommendation: "Describe the episode's contribution to the season arc.",
        requiresHumanReview: false,
        source: "deterministic",
      });
    }
  }

  for (let i = 0; i < episodes.length; i++) {
    for (let j = i + 1; j < episodes.length; j++) {
      const a = episodes[i]!;
      const b = episodes[j]!;
      const conflictSim = jaccardSimilarity(a.centralConflict, b.centralConflict);
      if (conflictSim > MAX_REPETITION) {
        findings.push({
          findingId: makeFindingId("prog"),
          category: "episode_differentiation",
          severity: "medium",
          episodeNumber: b.episodeNumber,
          message: `Episode ${b.episodeNumber} central conflict is too similar to episode ${a.episodeNumber}.`,
          recommendation: "Differentiate the central conflict.",
          requiresHumanReview: false,
          source: "deterministic",
        });
      }
      const beatsSim = jaccardSimilarity(a.majorStoryBeats.join(" "), b.majorStoryBeats.join(" "));
      if (beatsSim > MAX_REPETITION) {
        findings.push({
          findingId: makeFindingId("prog"),
          category: "episode_differentiation",
          severity: "medium",
          episodeNumber: b.episodeNumber,
          message: `Episode ${b.episodeNumber} story beats overlap heavily with episode ${a.episodeNumber}.`,
          recommendation: "Diversify the story beats.",
          requiresHumanReview: false,
          source: "deterministic",
        });
      }
      const endingSim = jaccardSimilarity(a.endingOrCliffhanger, b.endingOrCliffhanger);
      if (endingSim > MAX_REPETITION) {
        findings.push({
          findingId: makeFindingId("prog"),
          category: "episode_differentiation",
          severity: "medium",
          episodeNumber: b.episodeNumber,
          message: `Episode ${b.episodeNumber} reuses the ending beat of episode ${a.episodeNumber}.`,
          recommendation: "Create a distinct ending for each episode.",
          requiresHumanReview: false,
          source: "deterministic",
        });
      }
    }
  }

  if (episodes.length >= 3) {
    const third = Math.ceil(episodes.length / 3);
    const opening = episodes.slice(0, third);
    const middle = episodes.slice(third, episodes.length - third);
    const finale = episodes.slice(episodes.length - third);

    const beginningHasContent = plan.beginningDirection.trim().length >= 10;
    const middleHasContent = plan.middleDirection.trim().length >= 10;
    const endingHasContent = plan.endingDirection.trim().length >= 10;

    if (!beginningHasContent) {
      findings.push({
        findingId: makeFindingId("prog"),
        category: "narrative_progression",
        severity: "medium",
        message: "Beginning direction is too brief for a multi-episode season.",
        recommendation: "Describe how the season opens.",
        requiresHumanReview: false,
        source: "deterministic",
      });
    }
    if (!middleHasContent) {
      findings.push({
        findingId: makeFindingId("prog"),
        category: "narrative_progression",
        severity: "medium",
        message: "Middle direction is too brief for a multi-episode season.",
        recommendation: "Describe how the season complicates and escalates.",
        requiresHumanReview: false,
        source: "deterministic",
      });
    }
    if (!endingHasContent) {
      findings.push({
        findingId: makeFindingId("prog"),
        category: "narrative_progression",
        severity: "medium",
        message: "Ending direction is too brief for a multi-episode season.",
        recommendation: "Describe how the season resolves.",
        requiresHumanReview: false,
        source: "deterministic",
      });
    }

    if (middle.length > 0) {
      const openingStakes = opening.reduce((sum, ep) => sum + ep.majorStoryBeats.length, 0);
      const middleStakes = middle.reduce((sum, ep) => sum + ep.majorStoryBeats.length, 0);
      if (middleStakes < openingStakes * 0.5) {
        findings.push({
          findingId: makeFindingId("prog"),
          category: "conflict_escalation",
          severity: "medium",
          message: "The middle episodes have fewer story beats than the opening, suggesting declining stakes.",
          recommendation: "Escalate the conflict in the middle episodes.",
          requiresHumanReview: false,
          source: "deterministic",
        });
      }
    }

    if (finale.length > 0) {
      const finaleEp = finale[finale.length - 1]!;
      const earlyFinaleSim = opening.some((open) =>
        jaccardSimilarity(open.endingOrCliffhanger, finaleEp.endingOrCliffhanger) > 0.5
      );
      if (earlyFinaleSim) {
        findings.push({
          findingId: makeFindingId("prog"),
          category: "conflict_escalation",
          severity: "medium",
          message: "An early episode's ending resembles the season finale's ending.",
          recommendation: "Differentiate the finale from early episodes.",
          requiresHumanReview: false,
          source: "deterministic",
        });
      }
    }
  }

  for (const ep of episodes) {
    if (ep.consequences.length === 0 && ep.episodeNumber < episodes.length) {
      findings.push({
        findingId: makeFindingId("prog"),
        category: "narrative_progression",
        severity: "medium",
        episodeNumber: ep.episodeNumber,
        message: `Episode ${ep.episodeNumber} creates no consequences for subsequent episodes.`,
        recommendation: "Add consequences that carry forward to later episodes.",
        requiresHumanReview: false,
        source: "deterministic",
      });
    }
  }

  return findings;
}

export function validateCharacterDevelopment(plan: SeasonPlan): RichValidationFinding[] {
  const findings: RichValidationFinding[] = [];

  for (const ep of plan.episodeProgression) {
    if (ep.characterDevelopment.trim().length < 10) {
      findings.push({
        findingId: makeFindingId("chardev"),
        category: "character_development",
        severity: "medium",
        episodeNumber: ep.episodeNumber,
        message: `Episode ${ep.episodeNumber} lacks meaningful character development.`,
        recommendation: "Describe how characters develop in this episode.",
        requiresHumanReview: false,
        source: "deterministic",
      });
    }
  }

  if (plan.overallCharacterDevelopment.trim().length < 20) {
    findings.push({
      findingId: makeFindingId("chardev"),
      category: "character_development",
      severity: "medium",
      message: "The plan does not describe overall character development across the season.",
      recommendation: "Describe the season-wide character arcs.",
      requiresHumanReview: false,
      source: "deterministic",
    });
  }

  return findings;
}