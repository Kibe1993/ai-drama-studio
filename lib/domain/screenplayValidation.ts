import type { CanonState } from "@/lib/validation/narrativeControl";
import { agreementFindings, contradictionChanges, draftConsistencyFindings, evaluateProposal, type NarrativeFinding } from "@/lib/domain/narrativeControl";
import type { EpisodePlan, EpisodeValidation, EpisodeValidationCategory, EpisodeValidationFinding } from "@/lib/validation/casna";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import type { SeasonPlan } from "@/lib/validation/seasonPlan";
import type { ScreenplayScene, StoryStructure } from "@/lib/validation/story";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { CanonicalEntityRegistry } from "@/lib/validation/canonicalRegistry";
import { resolveSceneRange, type SceneRange } from "@/lib/providers/llm/budget";
import { resolveCanonicalId, hasAppearedBy, isIntroducedBy } from "@/lib/domain/canonicalRegistry";
import { continuityCheckFindings } from "@/lib/domain/continuityChecks";
import { createHash } from "node:crypto";

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
  registry?: CanonicalEntityRegistry;
  /** Application canon. When present, disclosure and lifecycle checks run against it. */
  canon?: CanonState | null;
  /** Act summaries. Compared with the synopsis and the screenplay when present. */
  structure?: StoryStructure | null;
  /** Episode scene policy. Duration is the fallback when this is omitted. */
  sceneRange?: SceneRange | null;
  /** A whole-story revision must still contain every protected established fact. */
  requireCanonCoverage?: boolean;
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

/** Speaker-labeled text so knowledge checks can attribute a line to a character. */
function spokenSceneText(scene: ScreenplayScene): string {
  return [
    scene.heading,
    scene.action,
    scene.visualDescription,
    ...scene.dialogue.map((line) => `${line.characterName}: ${line.line}`),
  ].join("\n");
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
 * Whether a character name is referenced in scene context text. Matches the
 * full name or any significant part (first/last, length >= 3) so "Elder Grey"
 * is found when the scene says "Grey" or "Elder".
 */
function nameReferencedInContext(normalizedName: string, context: string): boolean {
  if (normalizedName && context.includes(normalizedName)) return true;
  const parts = normalizedName.split(" ").filter((p) => p.length >= 3);
  return parts.some((part) => context.includes(part));
}

/**
 * Characters introduced within the current screenplay. A character is
 * introduced when they appear in `charactersPresent` and their name is
 * referenced in the scene's action or visual description, giving the
 * audience enough context to identify them. This is distinct from being
 * approved as a permanent canonical entity.
 */
function currentEpisodeIntroductions(screenplay: ScreenplayScene[]): { names: Set<string>; byName: Map<string, number> } {
  const names = new Set<string>();
  const byName = new Map<string, number>();
  for (const scene of screenplay) {
    const context = normalize(`${scene.action} ${scene.visualDescription}`);
    for (const name of scene.charactersPresent) {
      const normalized = normalize(name);
      if (byName.has(normalized)) continue;
      if (nameReferencedInContext(normalized, context)) {
        names.add(normalized);
        byName.set(normalized, scene.sceneNumber);
      }
    }
  }
  return { names, byName };
}

/**
 * Characters that appear in `charactersPresent` of any scene, even if not
 * formally described in the scene text. Used to distinguish "present but
 * undescribed" (warning) from "not present at all" (error).
 */
function currentEpisodePresence(screenplay: ScreenplayScene[]): { names: Set<string>; byName: Map<string, number> } {
  const names = new Set<string>();
  const byName = new Map<string, number>();
  for (const scene of screenplay) {
    for (const name of scene.charactersPresent) {
      const normalized = normalize(name);
      if (!names.has(normalized)) {
        names.add(normalized);
        byName.set(normalized, scene.sceneNumber);
      }
    }
  }
  return { names, byName };
}

/**
 * Screenplays commonly use first-name-only speaker labels ("Daniel" for
 * "Daniel Mwangi"). resolveIdentity deliberately does not match first-name-only
 * references because that is ambiguous for canon resolution. For the character
 * introduction check we use a more lenient matching: exact, first-name, or
 * last-name match against any established character name.
 */
function speakerIsEstablished(speaker: string, establishedNames: Set<string>): boolean {
  const normalized = normalize(speaker);
  if (establishedNames.has(normalized)) return true;
  const parts = normalized.split(" ").filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  for (const name of establishedNames) {
    if (name === normalized) return true;
    const nameParts = name.split(" ").filter((p) => p.length > 0);
    if (nameParts.length === 0) continue;
    if (first.length >= 3 && nameParts[0] === first) return true;
    if (parts.length === 1 && last.length >= 4 && nameParts[nameParts.length - 1] === last) return true;
  }
  return false;
}

function findingId(category: string, message: string, sceneNumber?: number): string {
  return createHash("sha256")
    .update([category, message.slice(0, 200), String(sceneNumber ?? "")].join("|"))
    .digest("hex")
    .slice(0, 16);
}

function dedupeEpisodeFindings(findings: EpisodeValidationFinding[]): EpisodeValidationFinding[] {
  const seen = new Set<string>();
  const unique: EpisodeValidationFinding[] = [];
  for (const finding of findings) {
    const id = finding.id ?? findingId(finding.category, finding.message, finding.sceneNumber);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(finding.id ? finding : { ...finding, id });
  }
  return unique;
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
  if (input.registry) {
    for (const character of input.bible?.characters.characters ?? []) {
      const canonicalId = resolveCanonicalId(input.registry, character.name, "character");
      if (canonicalId && (hasAppearedBy(input.registry, canonicalId, input.episodeNumber) ||
          isIntroducedBy(input.registry, canonicalId, input.episodeNumber))) {
        add(character.name);
        for (const alias of input.registry.entities.find((e) => e.canonicalId === canonicalId)?.aliases ?? []) {
          add(alias.name);
        }
      }
    }
  } else {
    for (const character of input.bible?.characters.characters ?? []) add(character.name);
    for (const entity of input.canon?.entities ?? []) {
      if (entity.kind !== "character") continue;
      add(entity.name);
      for (const alias of entity.aliases) add(alias);
    }
  }
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

function wasIntroducedByPlan(
  name: string,
  planText: string,
  registry?: CanonicalEntityRegistry,
  episodeNumber?: number,
): boolean {
  if (registry && episodeNumber) {
    const canonicalId = resolveCanonicalId(registry, name, "character");
    if (canonicalId) {
      return isIntroducedBy(registry, canonicalId, episodeNumber);
    }
  }
  if (!planText) return false;
  return normalize(planText).includes(normalize(name));
}

export function validateEpisodeScreenplay(
  input: ScreenplayValidationInput
): EpisodeValidation {
  const findings: EpisodeValidationFinding[] = [];
  const screenplay = input.story.screenplay;
  const range = resolveSceneRange(input.targetDurationSeconds, input.sceneRange);
  const fullText = screenplay.map(sceneText).join(" ");

  // -- Completeness -------------------------------------------------------
  if (screenplay.length < range.min || screenplay.length > range.max) {
    findings.push({
      category: "completeness",
      severity: "error",
      code: "scene_count",
      evidence: `${screenplay.length} scenes`,
      message: `The screenplay has ${screenplay.length} scene${screenplay.length === 1 ? "" : "s"} but this episode requires ${range.min}–${range.max}.`,
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
  const castIsKnown = Boolean(input.bible) || (input.ledger?.characterStates.length ?? 0) > 0 || input.previousEpisodes.length > 0 || Boolean(input.registry);
  const currentIntroduced = currentEpisodeIntroductions(screenplay);
  const currentPresent = currentEpisodePresence(screenplay);
  if (castIsKnown) for (const name of speakingNames(screenplay)) {
    if (speakerIsEstablished(name, established.names)) continue;
    if (wasIntroducedByPlan(name, established.planText, input.registry, input.episodeNumber)) continue;
    if (speakerIsEstablished(name, currentIntroduced.names)) continue;
    const sceneNumber = firstSceneWithSpeaker(screenplay, name);
    if (speakerIsEstablished(name, currentPresent.names)) {
      findings.push({
        id: findingId("canon", `speaker-not-described:${name}`, sceneNumber),
        category: "canon",
        severity: "warning",
        sceneNumber,
        message: `"${name}" appears in this episode but is not described in any scene. Introduce the character through scene action or visual description before they speak.`,
      });
      continue;
    }
    findings.push({
      id: findingId("canon", `speaker-not-introduced:${name}`, sceneNumber),
      category: "canon",
      severity: "error",
      sceneNumber,
      message: `"${name}" speaks in this episode but is not introduced by the Story Bible, the Season Plan, a previous episode, the Continuity Ledger, or the current screenplay.`,
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
  if (input.ledger) {
    for (const finding of continuityCheckFindings(input.ledger, screenplay)) {
      findings.push(finding);
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

  const draftFindings = draftConsistencyFindings({
    episode: input.episodeNumber,
    title: input.story.title,
    synopsis: input.story.synopsis,
    acts: input.structure ?? null,
    scenes: screenplay.map((scene) => ({
      sceneNumber: scene.sceneNumber,
      heading: scene.heading,
      visualDescription: scene.visualDescription,
      action: scene.action,
      dialogue: scene.dialogue.map((line) => `${line.characterName}: ${line.line}`).join("\n"),
    })),
  });
  for (const finding of draftFindings) {
    const mapped = toEpisodeFinding(finding);
    if (mapped) findings.push(mapped);
  }

  let narrativeCanonVersion: number | undefined;
  let narrativeValidationLayers: EpisodeValidation["narrativeValidationLayers"];
  let narrativeDecision: EpisodeValidation["narrativeDecision"];
  if (input.canon) {
    const actText = input.structure ? actSummary(input.structure) : "";
    const spoken = screenplay.map(spokenSceneText).join("\n");
    const proposedContent = [input.story.synopsis, actText, spoken].filter(Boolean).join("\n");
    const decision = evaluateProposal({
      canon: input.canon,
      episode: input.episodeNumber,
      provider: "application",
      scenes: screenplay.map((scene) => ({
        sceneNumber: scene.sceneNumber,
        charactersPresent: scene.charactersPresent,
        location: scene.location,
        text: spokenSceneText(scene),
      })),
      response: {
        taskId: `screenplay-${input.episodeNumber}`,
        projectId: input.canon.projectId,
        narrativeVersion: input.canon.version,
        proposedContent,
        proposedChanges: contradictionChanges(input.canon, input.episodeNumber, proposedContent),
        newEntities: [],
        newFacts: [],
        modifiedFacts: [],
        dependencies: [],
        uncertainties: [],
      },
    });
    narrativeCanonVersion = decision.canonVersion;
    narrativeValidationLayers = decision.layers;
    narrativeDecision = decision.decision;
    for (const finding of decision.findings) {
      const mapped = toEpisodeFinding(finding);
      if (mapped) findings.push(mapped);
    }
    const agreements = agreementFindings({
      canon: input.canon,
      episode: input.episodeNumber,
      synopsis: input.story.synopsis,
      acts: actText,
      screenplayText: spoken,
      endingText: screenplay.slice(-2).map(spokenSceneText).join("\n"),
      requireCanonCoverage: input.requireCanonCoverage === true,
    });
    if (agreements.some((finding) => finding.requiresCanonAuthorization)) {
      narrativeDecision = "needs_authorization";
    }
    for (const finding of agreements) {
      const mapped = toEpisodeFinding(finding);
      if (mapped) findings.push(mapped);
    }
    if (narrativeDecision === "approve" && findings.some((finding) => finding.severity === "error")) {
      narrativeDecision = "reject";
    }
  }

  const uniqueFindings = dedupeEpisodeFindings(findings);
  return {
    passed: !uniqueFindings.some((finding) => finding.severity === "error"),
    findings: uniqueFindings,
    validatedAt: new Date().toISOString(),
    ...(narrativeCanonVersion !== undefined
      ? { narrativeCanonVersion, narrativeValidationLayers, narrativeDecision }
      : {}),
  };
}

function actSummary(structure: StoryStructure): string {
  const { act1, act2, act3 } = structure;
  return [
    act1.initialSituation,
    act1.incitingIncident,
    act2.turningPoint,
    act3.climax,
    act3.finalOutcome,
  ].join(" ");
}

function toEpisodeFinding(finding: NarrativeFinding): EpisodeValidationFinding | null {
  if (finding.severity === "INFO") return null;
  return {
    category: episodeCategory(finding.category),
    severity: finding.severity === "ERROR" ? "error" : "warning",
    code: finding.algorithm.slice(0, 80),
    ...(finding.evidence.trim() ? { evidence: finding.evidence.slice(0, 400) } : {}),
    ...(finding.sceneNumber ? { sceneNumber: finding.sceneNumber } : {}),
    message: finding.explanation.slice(0, 600),
    id: finding.id,
    title: finding.title.slice(0, 120),
    ...(finding.expected.trim() ? { expected: finding.expected.slice(0, 400) } : {}),
    ...(finding.actual.trim() ? { actual: finding.actual.slice(0, 400) } : {}),
    ...(finding.suggestedCorrection.trim() ? { suggestedCorrection: finding.suggestedCorrection.slice(0, 600) } : {}),
    confidence: finding.confidence,
    ...(finding.affectedAct ? { affectedAct: finding.affectedAct } : {}),
    requiresCanonAuthorization: finding.requiresCanonAuthorization,
    automaticRepairSafe: finding.automaticRepairSafe,
    resolutionStatus: "open",
  };
}

function episodeCategory(category: string): EpisodeValidationCategory {
  if (category === "knowledge") return "knowledge";
  if (category === "canon" || category === "world_rule" || category === "object" || category === "identity") return "canon";
  if (category === "structural") return "structure";
  return "continuity";
}
