import type { EpisodePlan, EpisodeValidation, EpisodeValidationFinding } from "@/lib/validation/casna";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import type { SeasonPlan } from "@/lib/validation/seasonPlan";
import type { ScreenplayScene } from "@/lib/validation/story";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import { minimumScenesForDuration } from "@/lib/providers/llm/budget";

/**
 * CASNA Stage H: validate a completed screenplay against the approved canon,
 * the Season Plan, the episode-specific plan, previous approved episodes, the
 * Continuity Ledger, and the requested duration/format.
 *
 * The checks are deterministic. They cannot judge literary quality, but they do
 * catch the failure modes that break a serialized story: incomplete episodes,
 * invented or resurrected characters, canon contradictions, repeated scenes,
 * and endings that ignore the approved plan. Findings are structured so the
 * caller can repair only what is affected.
 */

export type PreviousEpisode = {
  episodeNumber: number;
  title: string;
  synopsis: string;
  screenplay: ScreenplayScene[];
};

export type ScreenplayValidationInput = {
  episodeNumber: number;
  seriesTitle: string;
  story: { title: string; synopsis: string; screenplay: ScreenplayScene[] };
  targetDurationSeconds: number;
  bible: StoryBibleContent | null;
  seasonPlan: SeasonPlan | null;
  episodePlan: EpisodePlan | null;
  ledger: ContinuityLedger | null;
  previousEpisodes: PreviousEpisode[];
};

const MAX_REPETITION = 0.4;
const STOPWORDS = new Set([
  "the", "and", "that", "with", "have", "this", "from", "they", "will", "what",
  "when", "then", "them", "than", "there", "their", "into", "about", "after",
  "before", "because", "while", "where", "which", "would", "could", "should",
  "does", "your", "you", "for", "his", "her", "she", "him", "its", "are", "was",
]);

function normalize(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function words(value: string): Set<string> {
  return new Set(tokens(value).filter((word) => word.length > 4));
}

/**
 * Word bigrams. Repetition checks use shingles rather than single words so
 * "the same scene with synonyms" still looks similar.
 */
function shingles(value: string): Set<string> {
  const parts = tokens(value);
  if (parts.length < 2) return new Set(parts);
  const set = new Set<string>();
  for (let index = 0; index <= parts.length - 2; index += 1) {
    set.add(`${parts[index]} ${parts[index + 1]}`);
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function sceneText(scene: ScreenplayScene): string {
  return [scene.heading, scene.action, scene.visualDescription, ...scene.dialogue.map((line) => line.line)].join(" ");
}

function speakingNames(screenplay: ScreenplayScene[]): string[] {
  const names = new Set<string>();
  for (const scene of screenplay) {
    for (const line of scene.dialogue) names.add(line.characterName.trim());
  }
  return [...names];
}

function presentNames(screenplay: ScreenplayScene[]): string[] {
  const names = new Set<string>();
  for (const scene of screenplay) {
    for (const name of scene.charactersPresent) names.add(name.trim());
  }
  return [...names];
}

function firstSceneWithSpeaker(screenplay: ScreenplayScene[], name: string): number | undefined {
  return screenplay.find((scene) =>
    scene.dialogue.some((line) => normalize(line.characterName) === normalize(name))
  )?.sceneNumber;
}

function firstSceneWithCharacter(screenplay: ScreenplayScene[], name: string): number | undefined {
  return screenplay.find((scene) =>
    scene.charactersPresent.some((present) => normalize(present) === normalize(name))
  )?.sceneNumber;
}

/**
 * Characters the story has already introduced through approved material: the
 * Story Bible, the Continuity Ledger, previous approved episodes, or the
 * approved Season Plan episode entry.
 */
function establishedCharacters(input: ScreenplayValidationInput): {
  names: Set<string>;
  planText: string;
} {
  const names = new Set<string>();
  const add = (name: string | undefined | null) => {
    const normalized = normalize(name ?? "");
    if (normalized) names.add(normalized);
  };
  for (const character of input.bible?.characters.characters ?? []) add(character.name);
  for (const state of input.ledger?.characterStates ?? []) add(state.name);
  for (const episode of input.previousEpisodes) {
    for (const scene of episode.screenplay) {
      for (const name of scene.charactersPresent) add(name);
      for (const line of scene.dialogue) add(line.characterName);
    }
  }
  const planText = input.episodePlan
    ? [
        input.episodePlan.workingTitle,
        input.episodePlan.narrativePurpose,
        ...input.episodePlan.newDevelopments,
        ...input.episodePlan.characterChanges,
        ...input.episodePlan.consequencesCreated,
      ].join(" ")
    : "";
  return { names, planText };
}

function wasIntroducedByPlan(name: string, planText: string): boolean {
  if (!planText) return false;
  return normalize(planText).includes(normalize(name));
}

export function validateEpisodeScreenplay(
  input: ScreenplayValidationInput
): EpisodeValidation {
  const findings: EpisodeValidationFinding[] = [];
  const screenplay = input.story.screenplay;
  const minimum = minimumScenesForDuration(input.targetDurationSeconds);
  const fullText = screenplay.map(sceneText).join(" ");

  // -- Completeness -------------------------------------------------------
  if (screenplay.length < minimum) {
    findings.push({
      category: "completeness",
      severity: "error",
      message: `The screenplay has ${screenplay.length} scene${screenplay.length === 1 ? "" : "s"} but a ${input.targetDurationSeconds}-second episode needs at least ${minimum}. The episode is incomplete.`,
    });
  }
  const numbers = screenplay.map((scene) => scene.sceneNumber);
  const expected = screenplay.map((_, index) => index + 1);
  if (numbers.some((number, index) => number !== expected[index])) {
    findings.push({
      category: "completeness",
      severity: "error",
      message: "The screenplay scene numbers are not a complete 1..n sequence.",
    });
  }
  const dialogueScenes = screenplay.filter((scene) => scene.dialogue.length > 0).length;
  if (screenplay.length > 1 && dialogueScenes === 0) {
    findings.push({
      category: "completeness",
      severity: "warning",
      message: "The screenplay contains no dialogue at all.",
    });
  }
  if (input.story.synopsis.trim().length < 40) {
    findings.push({
      category: "completeness",
      severity: "warning",
      message: "The episode synopsis is too short to serve as its authoritative summary.",
    });
  }

  // -- Canon -------------------------------------------------------------
  const established = establishedCharacters(input);
  for (const name of speakingNames(screenplay)) {
    if (established.names.has(normalize(name))) continue;
    if (wasIntroducedByPlan(name, established.planText)) continue;
    findings.push({
      category: "canon",
      severity: "error",
      sceneNumber: firstSceneWithSpeaker(screenplay, name),
      message: `"${name}" speaks in this episode but is not introduced by the Story Bible, the Season Plan, a previous episode, or the Continuity Ledger.`,
    });
  }
  const deadCharacters = new Set(
    (input.ledger?.characterStates ?? [])
      .filter((state) => /\b(dead|deceased|killed|died)\b/i.test(state.physicalState))
      .map((state) => normalize(state.name))
  );
  for (const name of presentNames(screenplay)) {
    if (!deadCharacters.has(normalize(name))) continue;
    findings.push({
      category: "canon",
      severity: "error",
      sceneNumber: firstSceneWithCharacter(screenplay, name),
      message: `"${name}" appears in this episode but the Continuity Ledger records them as dead.`,
    });
  }
  if (input.bible) {
    const bibleNames = new Set(
      input.bible.characters.characters.map((character) => normalize(character.name))
    );
    if (bibleNames.size > 0) {
      const present = presentNames(screenplay).map(normalize);
      if (!present.some((name) => bibleNames.has(name))) {
        findings.push({
          category: "canon",
          severity: "warning",
          message: "None of the Story Bible's main characters appear in this episode.",
        });
      }
    }
  }

  // -- Continuity --------------------------------------------------------
  const consequenceText = (input.ledger?.consequences ?? []).join(" ");
  if (consequenceText.trim()) {
    const overlap = jaccard(words(consequenceText), words(fullText));
    if (overlap === 0) {
      findings.push({
        category: "continuity",
        severity: "warning",
        message: "The episode does not visibly carry any active consequence from the Continuity Ledger.",
      });
    }
  }

  // -- Repetition --------------------------------------------------------
  for (const previous of input.previousEpisodes) {
    if (normalize(previous.title) === normalize(input.story.title)) {
      findings.push({
        category: "repetition",
        severity: "warning",
        message: `This episode reuses the title of episode ${previous.episodeNumber}.`,
      });
    }
    const synopsisOverlap = jaccard(shingles(previous.synopsis), shingles(input.story.synopsis));
    if (synopsisOverlap > MAX_REPETITION) {
      findings.push({
        category: "repetition",
        severity: "warning",
        message: `The episode synopsis repeats episode ${previous.episodeNumber} too closely.`,
      });
    }
    for (const scene of screenplay) {
      const current = shingles(sceneText(scene));
      const closest = previous.screenplay
        .map((previousScene) => jaccard(current, shingles(sceneText(previousScene))))
        .reduce((max, value) => Math.max(max, value), 0);
      if (closest > MAX_REPETITION) {
        findings.push({
          category: "repetition",
          severity: "warning",
          sceneNumber: scene.sceneNumber,
          message: `Scene ${scene.sceneNumber} repeats a development from episode ${previous.episodeNumber}.`,
        });
      }
    }
  }

  // A season can also repeat itself at the structural level: the same
  // cliffhanger, or a "revelation" that was already revealed.
  const previousItem = input.seasonPlan?.episodeProgression.find(
    (item) => item.episodeNumber === input.episodeNumber - 1
  );
  if (previousItem) {
    const ending = screenplay.slice(-2).map(sceneText).join(" ");
    if (jaccard(shingles(previousItem.endingOrCliffhanger), shingles(ending)) > MAX_REPETITION) {
      findings.push({
        category: "repetition",
        severity: "warning",
        message: `The episode ends on the same beat as episode ${previousItem.episodeNumber}.`,
      });
    }
  }
  const earlierRevelations = (input.seasonPlan?.episodeProgression ?? [])
    .filter((item) => item.episodeNumber < input.episodeNumber)
    .flatMap((item) => item.informationRevealed);
  for (const revealed of input.episodePlan?.informationRevealed ?? []) {
    const repeat = earlierRevelations.find(
      (earlier) => jaccard(shingles(earlier), shingles(revealed)) > 0.6
    );
    if (repeat) {
      findings.push({
        category: "repetition",
        severity: "warning",
        message: `The episode re-reveals information an earlier episode already established: "${revealed}".`,
      });
      break;
    }
  }

  // -- Structure ---------------------------------------------------------
  if (input.episodePlan) {
    const endingWords = words(input.episodePlan.carryForward);
    if (endingWords.size > 0) {
      const lastTwo = screenplay.slice(-2).map(sceneText).join(" ");
      if (jaccard(endingWords, words(lastTwo)) === 0) {
        findings.push({
          category: "structure",
          severity: "warning",
          message: "The episode ending does not visibly deliver the planned cliffhanger or continuity requirement.",
        });
      }
    }
    if (input.episodePlan.informationRevealed.length > 0) {
      const revealed = words(input.episodePlan.informationRevealed.join(" "));
      if (revealed.size > 0 && jaccard(revealed, words(fullText)) === 0) {
        findings.push({
          category: "structure",
          severity: "warning",
          message: "The episode does not deliver any of the information the approved plan says it reveals.",
        });
      }
    }
  } else if (input.seasonPlan) {
    findings.push({
      category: "structure",
      severity: "warning",
      message: "This episode has no episode-specific plan; it was not written against the approved Season Plan.",
    });
  }

  return {
    passed: !findings.some((finding) => finding.severity === "error"),
    findings,
    validatedAt: new Date().toISOString(),
  };
}
