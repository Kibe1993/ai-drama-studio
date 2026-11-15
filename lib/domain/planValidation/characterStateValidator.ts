import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { RichValidationFinding } from "@/lib/validation/seasonPlanValidation";
import { makeFindingId } from "@/lib/validation/seasonPlanValidation";

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

export interface CharacterState {
  name: string;
  status: "alive" | "dead" | "unknown";
  location: string | null;
  knowledge: Set<string>;
  relationships: Map<string, string>;
  motivations: string[];
  emotionalState: string | null;
  physicalState: string | null;
  lastSeenEpisode: number;
}

export function initializeCharacterStates(bible: StoryBibleContent | null): Map<string, CharacterState> {
  const states = new Map<string, CharacterState>();
  if (!bible) return states;

  for (const char of bible.characters.characters) {
    const normName = normalize(char.name);
    const relationships = new Map<string, string>();
    for (const rel of char.relationships) {
      relationships.set(normalize(rel.characterName), rel.relationship);
    }
    const knowledge = new Set<string>();
    for (const ck of bible.canon.characterKnowledge) {
      if (normalize(ck.characterName) === normName) {
        for (const k of ck.knows) knowledge.add(normalize(k));
      }
    }
    states.set(normName, {
      name: char.name,
      status: "alive",
      location: null,
      knowledge,
      relationships,
      motivations: char.motivations,
      emotionalState: null,
      physicalState: null,
      lastSeenEpisode: 0,
    });
  }
  return states;
}

export function applyEpisodeToStates(
  states: Map<string, CharacterState>,
  ep: EpisodePlanItem,
): CharacterState[] {
  const changes: CharacterState[] = [];

  for (const arc of ep.characterArcChanges) {
    const normName = normalize(arc.name);
    let state = states.get(normName);
    if (!state) {
      state = {
        name: arc.name,
        status: "unknown",
        location: null,
        knowledge: new Set(),
        relationships: new Map(),
        motivations: [],
        emotionalState: null,
        physicalState: null,
        lastSeenEpisode: 0,
      };
      states.set(normName, state);
    }
    state.lastSeenEpisode = ep.episodeNumber;

    const changeLower = arc.change.toLowerCase();
    if (/\b(die|dies|died|dead|death|deceased|killed|murder|fatal)\b/.test(changeLower)) {
      state.status = "dead";
    } else if (/\b(alive|survive|recover|resurrect|revive)\b/.test(changeLower)) {
      state.status = "alive";
    }
    if (/\b(anger|furious|enrage)\b/.test(changeLower)) state.emotionalState = "angry";
    else if (/\b(sad|grief|mourning|depress)\b/.test(changeLower)) state.emotionalState = "sad";
    else if (/\b(happy|joy|elat|triumph)\b/.test(changeLower)) state.emotionalState = "happy";
    else if (/\b(fear|afraid|terrified|panic)\b/.test(changeLower)) state.emotionalState = "fearful";

    changes.push(state);
  }

  for (const rel of ep.relationshipChanges) {
    const fromNorm = normalize(rel.from);
    const toNorm = normalize(rel.to);
    let fromState = states.get(fromNorm);
    if (!fromState) {
      fromState = {
        name: rel.from, status: "unknown", location: null, knowledge: new Set(),
        relationships: new Map(), motivations: [], emotionalState: null, physicalState: null,
        lastSeenEpisode: 0,
      };
      states.set(fromNorm, fromState);
    }
    fromState.relationships.set(toNorm, rel.change);
    fromState.lastSeenEpisode = ep.episodeNumber;
  }

  for (const loc of ep.locationChanges) {

    for (const arc of ep.characterArcChanges) {
      const state = states.get(normalize(arc.name));
      if (state && loc.change.toLowerCase().includes(arc.name.toLowerCase())) {
        state.location = loc.name;
      }
    }
  }

  for (const info of ep.informationRevealed) {
    const normInfo = normalize(info);
    for (const state of states.values()) {
      if (ep.characterDevelopment.toLowerCase().includes(state.name.toLowerCase())) {
        state.knowledge.add(normInfo);
      }
    }
  }

  return changes;
}

export function validateCharacterStateContinuity(
  plan: SeasonPlan,
  bible: StoryBibleContent | null,
): RichValidationFinding[] {
  const findings: RichValidationFinding[] = [];
  const states = initializeCharacterStates(bible);

  for (const ep of plan.episodeProgression) {
    for (const info of ep.informationRevealed) {
      const normInfo = normalize(info);
      const infoKeywords = normInfo.split(/\s+/).filter((w) => w.length > 5).slice(0, 4);
      if (infoKeywords.length < 2) continue;

      for (const [charName, state] of states) {
        if (state.knowledge.has(normInfo)) continue;
        const epText = normalize(
          ep.characterDevelopment + " " +
          ep.startingSituation + " " +
          ep.majorStoryBeats.join(" ") + " " +
          ep.informationRevealed.join(" ")
        );
        if (epText.includes(charName) && epText.includes(normInfo.slice(0, 20))) {
          for (const earlier of plan.episodeProgression) {
            if (earlier.episodeNumber >= ep.episodeNumber) break;
            const earlierText = normalize(
              earlier.characterDevelopment + " " +
              earlier.startingSituation + " " +
              earlier.majorStoryBeats.join(" ")
            );
            const earlierTextClean = earlierText.replace(/'/g, "");
            if (earlierText.includes(charName) &&
                infoKeywords.every((kw) => earlierTextClean.includes(kw.replace(/'/g, "")))) {
              findings.push({
                findingId: makeFindingId("char"),
                category: "knowledge_chronology",
                severity: "high",
                episodeNumber: earlier.episodeNumber,
                affectedField: "characterDevelopment",
                message: `Character "${state.name}" appears to know information in episode ${earlier.episodeNumber} that is only revealed in episode ${ep.episodeNumber}.`,
                explanation: `Information "${info}" is revealed in episode ${ep.episodeNumber} but the character acts on it earlier.`,
                whyItMatters: "Characters cannot act on information they have not yet learned.",
                recommendation: `Move the revelation to episode ${earlier.episodeNumber} or remove the character's knowledge from that episode.`,
                evidence: [info],
                requiresHumanReview: true,
                source: "deterministic",
              });
              break;
            }
          }
        }
      }
    }

    const changes = applyEpisodeToStates(states, ep);

    for (const state of changes) {
      if (state.status === "dead") {
        for (const later of plan.episodeProgression) {
          if (later.episodeNumber <= ep.episodeNumber) continue;
          const laterText = normalize(
            later.characterDevelopment + " " +
            later.startingSituation + " " +
            later.majorStoryBeats.join(" ")
          );
          if (laterText.includes(normalize(state.name))) {
            const hasExplanation = /\b(resurrect|revive|ghost|spirit|vision|flashback|memory|dream|clone|alternate|parallel)\b/i
              .test(laterText);
            if (!hasExplanation) {
              findings.push({
                findingId: makeFindingId("char"),
                category: "character_state",
                severity: "high",
                episodeNumber: later.episodeNumber,
                affectedField: "characterDevelopment",
                message: `Character "${state.name}" is active in episode ${later.episodeNumber} but was dead since episode ${ep.episodeNumber}.`,
                canonIssueType: "UNEXPLAINED_STATUS_CHANGE",
                explanation: `The character died in episode ${ep.episodeNumber} but appears in episode ${later.episodeNumber} without explanation.`,
                whyItMatters: "Dead characters appearing without explanation breaks narrative continuity.",
                recommendation: `Provide an explicit explanation for "${state.name}"'s return in episode ${later.episodeNumber}.`,
                requiresHumanReview: true,
                source: "deterministic",
              });
              break;
            }
          }
        }
      }
    }

    for (const rel of ep.relationshipChanges) {
      const fromNorm = normalize(rel.from);
      const toNorm = normalize(rel.to);
      const fromState = states.get(fromNorm);
      if (fromState) {
        const existingRel = fromState.relationships.get(toNorm);
        if (existingRel) {
          const trustPattern = /\b(trust|ally|friend|support)\b/i;
          const distrustPattern = /\b(distrust|enemy|betray|oppose|adversar)\b/i;
          const wasTrusting = trustPattern.test(existingRel);
          const nowDistrusting = distrustPattern.test(rel.change);
          const wasDistrusting = distrustPattern.test(existingRel);
          const nowTrusting = trustPattern.test(rel.change);

          if ((wasTrusting && nowDistrusting) || (wasDistrusting && nowTrusting)) {
            const hasCause = ep.majorStoryBeats.some((beat) =>
              /\b(betray|discover|learn|reveal|confront|argument|fight|conflict|save|help|protect)\b/i.test(beat)
            );
            if (!hasCause) {
              findings.push({
                findingId: makeFindingId("char"),
                category: "character_state",
                severity: "medium",
                episodeNumber: ep.episodeNumber,
                affectedField: "relationshipChanges",
                message: `Relationship between "${rel.from}" and "${rel.to}" changes from "${existingRel}" to "${rel.change}" in episode ${ep.episodeNumber} without a clear cause.`,
                explanation: "Relationship changes should be motivated by story events.",
                recommendation: "Add a story beat that explains the relationship change.",
                requiresHumanReview: false,
                source: "deterministic",
              });
            }
          }
        }
      }
    }
  }

  return findings;
}