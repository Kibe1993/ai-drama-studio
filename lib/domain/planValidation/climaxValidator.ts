import type { SeasonPlan } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
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

export interface SeasonNarrativeContract {
  centralDramaticQuestion: string;
  mainConflict: string;
  intendedClimax: string;
  intendedResolution: string;
  keyCharacterTransformations: string[];
  majorRevelations: string[];
  requiredFinaleEvents: string[];
  deliberatelyUnresolvedQuestions: string[];
  futureSeasonHooks: string[];
}

export function deriveNarrativeContract(plan: SeasonPlan): SeasonNarrativeContract {
  const finale = plan.episodeProgression[plan.episodeProgression.length - 1];
  return {
    centralDramaticQuestion: plan.centralConflictOrMystery,
    mainConflict: plan.centralConflictOrMystery,
    intendedClimax: finale?.centralConflict ?? plan.endingDirection,
    intendedResolution: plan.intendedSeasonConclusion,
    keyCharacterTransformations: plan.episodeProgression.flatMap((ep) =>
      ep.characterArcChanges.map((arc) => `${arc.name}: ${arc.change}`)
    ),
    majorRevelations: plan.importantRevelations,
    requiredFinaleEvents: finale?.importantEvents ?? [],
    deliberatelyUnresolvedQuestions: plan.unresolvedQuestions,
    futureSeasonHooks: [],
  };
}

const FORESHADOW_INDICATORS = /\b(foreshadow|hint|suggest|allude|portend|ominous|premonit|glimpse|echo)/i;
const CLIMAX_INDICATORS = /\b(climax|final|ultimatum|confront|showdown|culminat|peak|apex)/i;
const RESOLUTION_INDICATORS = /\b(resolve|conclud|accept|complet|finish|end|closure|final)/i;

export function validateClimaxAndResolution(
  plan: SeasonPlan,
  _bible: StoryBibleContent | null,
): RichValidationFinding[] {
  const findings: RichValidationFinding[] = [];
  const episodes = plan.episodeProgression;
  if (episodes.length < 2) return findings;

  const contract = deriveNarrativeContract(plan);
  const finale = episodes[episodes.length - 1]!;
  const finaleText = normalize(
    finale.centralConflict + " " +
    finale.endingOrCliffhanger + " " +
    finale.importantEvents.join(" ")
  );
  const conclusionNorm = normalize(plan.intendedSeasonConclusion);

  const earlyEpisodeCount = Math.max(1, Math.floor(episodes.length / 3));
  const earlyEpisodes = episodes.slice(0, earlyEpisodeCount);

  for (const early of earlyEpisodes) {
    const earlyText = normalize(
      early.endingOrCliffhanger + " " +
      early.centralConflict + " " +
      early.importantEvents.join(" ")
    );

    if (early.episodeNumber === finale.episodeNumber) continue;

    const conclusionSim = jaccardSimilarity(earlyText, conclusionNorm);
    const finaleSim = jaccardSimilarity(earlyText, finaleText);

    const isForeshadowing = FORESHADOW_INDICATORS.test(early.endingOrCliffhanger) ||
      FORESHADOW_INDICATORS.test(early.centralConflict);

    if (conclusionSim > 0.1 && !isForeshadowing) {
      const earlyExecutesResolution = RESOLUTION_INDICATORS.test(earlyText) &&
        !FORESHADOW_INDICATORS.test(earlyText);
      if (earlyExecutesResolution) {
        findings.push({
          findingId: makeFindingId("climax"),
          category: "premature_climax",
          severity: "blocking",
          episodeNumber: early.episodeNumber,
          message: `Episode ${early.episodeNumber} prematurely executes the season's intended conclusion.`,
          explanation: `The intended conclusion is: "${plan.intendedSeasonConclusion.slice(0, 100)}". Episode ${early.episodeNumber} appears to deliver this resolution instead of the finale (episode ${finale.episodeNumber}).`,
          whyItMatters: "A premature climax robs the finale of its dramatic impact and breaks the season's narrative arc.",
          recommendation: `Revise episode ${early.episodeNumber} to set up rather than execute the season's conclusion. Move the resolution to the finale.`,
          evidence: [early.endingOrCliffhanger, plan.intendedSeasonConclusion],
          requiresHumanReview: true,
          source: "deterministic",
        });
      }
    }

    if (finaleSim > 0.4 && !isForeshadowing) {
      const earlyExecutesClimax = CLIMAX_INDICATORS.test(earlyText);
      if (earlyExecutesClimax) {
        findings.push({
          findingId: makeFindingId("climax"),
          category: "premature_climax",
          severity: "high",
          episodeNumber: early.episodeNumber,
          message: `Episode ${early.episodeNumber} prematurely reaches the season's climax.`,
          explanation: `The climax should occur in the finale (episode ${finale.episodeNumber}), not episode ${early.episodeNumber}.`,
          whyItMatters: "Reaching the climax early deflates the season's tension.",
          recommendation: `Move the climactic confrontation to the finale or reframe episode ${early.episodeNumber} as a precursor.`,
          evidence: [early.centralConflict, finale.centralConflict],
          requiresHumanReview: true,
          source: "deterministic",
        });
      }
    }

    for (const revelation of contract.majorRevelations) {
      const revelationNorm = normalize(revelation);
      if (revelationNorm.length < 20) continue;
      const revelationKeywords = revelationNorm.split(/\s+/).filter((w) => w.length > 5).slice(0, 4);
      if (revelationKeywords.length < 2) continue;
      const earlyHasRevelation = revelationKeywords.every((kw) => earlyText.includes(kw));
      const isPlannedEarly = plan.importantRevelations.some((r) =>
        normalize(r).includes(revelationNorm.slice(0, 20)) &&
        epIndexOfRevelation(r, plan) <= early.episodeNumber
      );
      if (earlyHasRevelation && !isPlannedEarly && !isForeshadowing) {
        findings.push({
          findingId: makeFindingId("climax"),
          category: "premature_climax",
          severity: "high",
          episodeNumber: early.episodeNumber,
          affectedField: "importantRevelations",
          message: `A major season-level revelation is disclosed in episode ${early.episodeNumber} before its planned discovery.`,
          explanation: `The revelation "${revelation.slice(0, 80)}" should be reserved for a later episode.`,
          recommendation: "Move the revelation to a later episode or reframe it as foreshadowing.",
          evidence: [revelation],
          requiresHumanReview: true,
          source: "deterministic",
        });
      }
    }
  }

  if (plan.intendedSeasonConclusion.trim().length < 10) {
    findings.push({
      findingId: makeFindingId("climax"),
      category: "climax_resolution",
      severity: "blocking",
      message: "The intended season conclusion is missing or too brief.",
      recommendation: "Provide a substantive intended season conclusion.",
      requiresHumanReview: false,
      source: "deterministic",
    });
  }

  const finaleAddressesConflict = jaccardSimilarity(
    finale.centralConflict,
    plan.centralConflictOrMystery
  ) > 0.1 ||
    normalize(finale.centralConflict + " " + finale.endingOrCliffhanger)
      .split(/\s+/)
      .filter((w) => w.length > 5)
      .some((w) => normalize(plan.centralConflictOrMystery).includes(w));

  if (!finaleAddressesConflict && episodes.length > 2) {
    findings.push({
      findingId: makeFindingId("climax"),
      category: "climax_resolution",
      severity: "high",
      episodeNumber: finale.episodeNumber,
      message: "The finale does not clearly address the season's central conflict or mystery.",
      explanation: `Central conflict: "${plan.centralConflictOrMystery.slice(0, 80)}"`,
      recommendation: "Ensure the finale confronts and resolves the central conflict.",
      requiresHumanReview: true,
      source: "deterministic",
    });
  }

  if (episodes.length > 2 && plan.unresolvedQuestions.length === 0) {
    findings.push({
      findingId: makeFindingId("climax"),
      category: "narrative_integrity",
      severity: "medium",
      message: "A multi-episode season should have unresolved questions to sustain engagement.",
      recommendation: "Add unresolved questions or mark some threads as deliberately open.",
      requiresHumanReview: false,
      source: "deterministic",
    });
  }

  if (plan.setupAndPayoff.length === 0 && episodes.length > 2) {
    findings.push({
      findingId: makeFindingId("climax"),
      category: "narrative_integrity",
      severity: "medium",
      message: "No setup and payoff opportunities are described for a multi-episode season.",
      recommendation: "Describe key setup-payoff pairs.",
      requiresHumanReview: false,
      source: "deterministic",
    });
  }

  return findings;
}

function epIndexOfRevelation(revelation: string, plan: SeasonPlan): number {
  const norm = normalize(revelation);
  for (const ep of plan.episodeProgression) {
    if (ep.informationRevealed.some((r) => normalize(r).includes(norm.slice(0, 20)))) {
      return ep.episodeNumber;
    }
  }
  return Infinity;
}