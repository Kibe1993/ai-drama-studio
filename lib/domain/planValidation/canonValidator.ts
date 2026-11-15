import type { SeasonPlan } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { RichValidationFinding } from "@/lib/validation/seasonPlanValidation";
import { makeFindingId } from "@/lib/validation/seasonPlanValidation";

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

const DEATH_KEYWORDS = /\b(die|dies|died|dead|death|deceased|killed|murder|fatal|perish)\b/i;
const RESURRECTION_EXPLANATIONS = /\b(resurrect|revive|ghost|spirit|vision|flashback|memory|dream|hallucinat|afterlife|undead|zombie|clone|alternate|parallel|time\s*travel)\b/i;

export interface CanonSummary {
  characterNames: Set<string>;
  characterRoles: Map<string, string>;
  characterMotivations: Map<string, string[]>;
  characterBackgrounds: Map<string, string>;
  worldRules: string[];
  locations: Set<string>;
  confirmedFacts: string[];
  hiddenInformation: string[];
  characterKnowledge: Map<string, string[]>;
  relationshipDynamics: string[];
  boundaries: string[];
  mustRemainConsistent: string[];
}

export function extractCanonSummary(bible: StoryBibleContent): CanonSummary {
  const characterNames = new Set<string>();
  const characterRoles = new Map<string, string>();
  const characterMotivations = new Map<string, string[]>();
  const characterBackgrounds = new Map<string, string>();
  const characterKnowledge = new Map<string, string[]>();

  for (const char of bible.characters.characters) {
    const norm = normalize(char.name);
    characterNames.add(norm);
    characterRoles.set(norm, char.storyRole);
    characterMotivations.set(norm, char.motivations);
    characterBackgrounds.set(norm, char.background);
  }

  for (const knowledge of bible.canon.characterKnowledge) {
    characterKnowledge.set(normalize(knowledge.characterName), knowledge.knows);
  }

  const locations = new Set(
    bible.world.geographyAndLocations.map((l) => normalize(l.name))
  );

  return {
    characterNames,
    characterRoles,
    characterMotivations,
    characterBackgrounds,
    worldRules: bible.world.rules,
    locations,
    confirmedFacts: bible.canon.confirmedFacts,
    hiddenInformation: bible.canon.hiddenInformation,
    characterKnowledge,
    relationshipDynamics: bible.characters.relationshipDynamics,
    boundaries: bible.guidelines.boundaries,
    mustRemainConsistent: bible.guidelines.mustRemainConsistent,
  };
}

export function validateCanonConsistency(
  plan: SeasonPlan,
  bible: StoryBibleContent | null,
): RichValidationFinding[] {
  const findings: RichValidationFinding[] = [];
  if (!bible) return findings;

  const canon = extractCanonSummary(bible);

  for (const ep of plan.episodeProgression) {
    const epText = [
      ep.characterDevelopment,
      ep.startingSituation,
      ep.centralConflict,
      ...ep.majorStoryBeats,
      ...ep.importantEvents,
    ].join(" ");

    for (const [charName, role] of canon.characterRoles) {
      if (role === "protagonist" || role === "antagonist") {
        const mentioned = epText.toLowerCase().includes(charName);
        if (!mentioned && ep.episodeNumber <= Math.ceil(plan.episodeProgression.length / 2)) {
          findings.push({
            findingId: makeFindingId("canon"),
            category: "canon_contradiction",
            severity: "low",
            episodeNumber: ep.episodeNumber,
            message: `Main character "${charName}" (${role}) is not referenced in episode ${ep.episodeNumber}.`,
            recommendation: `Consider involving "${charName}" or explicitly note their absence.`,
            requiresHumanReview: false,
            source: "deterministic",
          });
        }
      }
    }

    for (const arc of ep.characterArcChanges) {
      const normName = normalize(arc.name);
      if (DEATH_KEYWORDS.test(arc.change)) {

        for (const later of plan.episodeProgression) {
          if (later.episodeNumber <= ep.episodeNumber) continue;
          const laterText = [
            later.characterDevelopment,
            later.startingSituation,
            ...later.majorStoryBeats,
            ...later.importantEvents,
          ].join(" ");
          if (laterText.toLowerCase().includes(normName) &&
              !RESURRECTION_EXPLANATIONS.test(laterText)) {
            findings.push({
              findingId: makeFindingId("canon"),
              category: "unexplained_status_change",
              severity: "high",
              episodeNumber: later.episodeNumber,
              affectedField: "characterDevelopment",
              message: `Character "${arc.name}" appears in episode ${later.episodeNumber} but was killed/dead in episode ${ep.episodeNumber} without an explained resurrection.`,
              canonIssueType: "UNEXPLAINED_STATUS_CHANGE",
              explanation: `Episode ${ep.episodeNumber} records: "${arc.change}". Episode ${later.episodeNumber} features the character without explanation.`,
              whyItMatters: "Dead characters reappearing without explanation breaks narrative continuity.",
              recommendation: `Add an explicit explanation in episode ${later.episodeNumber} for how "${arc.name}" returns.`,
              evidence: [arc.change],
              requiresHumanReview: true,
              source: "deterministic",
            });
            break;
          }
        }
      }
    }

    for (const rule of canon.worldRules) {
      const normRule = normalize(rule);
      const ruleKeywords = normRule.split(/\s+/).filter((w) => w.length > 4).slice(0, 5);
      if (ruleKeywords.length < 2) continue;
      const epLower = epText.toLowerCase();
      const contradicts = ruleKeywords.every((kw) => epLower.includes(kw)) &&
        /\b(not|cannot|never|impossible|forbidden|prohibited|unable)\b/.test(normRule) &&
        !/\b(not|cannot|never|impossible|forbidden|prohibited|unable)\b/.test(epLower);
      if (contradicts) {
        findings.push({
          findingId: makeFindingId("canon"),
          category: "world_rule_violation",
          severity: "high",
          episodeNumber: ep.episodeNumber,
          message: `Episode ${ep.episodeNumber} may contradict world rule: "${rule}".`,
          canonIssueType: "WORLD_RULE_VIOLATION",
          recommendation: "Review the episode against the established world rule.",
          requiresHumanReview: true,
          source: "deterministic",
        });
      }
    }

    for (const fact of canon.confirmedFacts) {
      const normFact = normalize(fact);
      if (normFact.length < 20) continue;
      const factKey = normFact.split(/\s+/).filter((w) => w.length > 4).slice(0, 4);
      if (factKey.length < 2) continue;
      const epLower = epText.toLowerCase();
      if (factKey.every((kw) => epLower.includes(kw))) {
        const factNegated = /\b(not|never|no longer|false|wrong|lie|deceit)\b/.test(normFact);
        const epNegated = /\b(not|never|no longer|false|wrong|lie|deceit)\b/.test(epLower);
        if (factNegated !== epNegated && factNegated) {
          findings.push({
            findingId: makeFindingId("canon"),
            category: "canon_contradiction",
            severity: "high",
            episodeNumber: ep.episodeNumber,
            message: `Episode ${ep.episodeNumber} may contradict a confirmed canon fact.`,
            canonIssueType: "CANON_CONTRADICTION",
            explanation: `Confirmed fact: "${fact}"`,
            recommendation: "Align the episode with the confirmed fact or provide an explicit explanation.",
            evidence: [fact],
            requiresHumanReview: true,
            source: "deterministic",
          });
        }
      }
    }

    for (const boundary of canon.boundaries) {
      const normBoundary = normalize(boundary);
      const boundaryKeywords = normBoundary.split(/\s+/).filter((w) => w.length > 4).slice(0, 4);
      if (boundaryKeywords.length < 2) continue;
      const epLower = epText.toLowerCase();
      if (boundaryKeywords.every((kw) => epLower.includes(kw))) {
        const hasViolation = /\b(must not|never|cannot|should not|do not)\b/.test(normBoundary) &&
          !/\b(must not|never|cannot|should not|do not)\b/.test(epLower);
        if (hasViolation) {
          findings.push({
            findingId: makeFindingId("canon"),
            category: "world_rule_violation",
            severity: "medium",
            episodeNumber: ep.episodeNumber,
            message: `Episode ${ep.episodeNumber} may violate a narrative boundary: "${boundary}".`,
            canonIssueType: "WORLD_RULE_VIOLATION",
            recommendation: "Review the episode against the established boundary.",
            requiresHumanReview: false,
            source: "deterministic",
          });
        }
      }
    }
  }

  return findings;
}