import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { RichValidationFinding } from "@/lib/validation/seasonPlanValidation";
import { makeFindingId } from "@/lib/validation/seasonPlanValidation";

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

export interface PlanEvent {
  id: string;
  episodeNumber: number;
  narrativePosition: number;
  description: string;
  participatingCharacters: string[];
  location: string | null;
  revealedInformation: string[];
  consequences: string[];
  dependencies: string[];
}

const FLASHBACK_INDICATORS = /\b(flashback|memory|recall|remember|years? ago|previously|back then|in the past|vision|dream|hallucinat)\b/i;
const PARALLEL_INDICATORS = /\b(parallel|alternate|meanwhile|simultaneously|elsewhere|another timeline|another reality)\b/i;

function isNonLinear(text: string): boolean {
  return FLASHBACK_INDICATORS.test(text) || PARALLEL_INDICATORS.test(text);
}

export function extractEvents(plan: SeasonPlan): PlanEvent[] {
  const events: PlanEvent[] = [];
  for (const ep of plan.episodeProgression) {
    for (let i = 0; i < ep.importantEvents.length; i++) {
      const desc = ep.importantEvents[i]!;
      events.push({
        id: `ep${ep.episodeNumber}-ev${i + 1}`,
        episodeNumber: ep.episodeNumber,
        narrativePosition: i,
        description: desc,
        participatingCharacters: extractCharacterNames(desc, ep),
        location: extractLocation(desc, ep),
        revealedInformation: ep.informationRevealed,
        consequences: ep.consequences,
        dependencies: [],
      });
    }
    for (let i = 0; i < ep.informationRevealed.length; i++) {
      const info = ep.informationRevealed[i]!;
      const eventId = `ep${ep.episodeNumber}-rev${i + 1}`;
      if (!events.some((e) => e.id === eventId)) {
        events.push({
          id: eventId,
          episodeNumber: ep.episodeNumber,
          narrativePosition: 100 + i,
          description: info,
          participatingCharacters: extractCharacterNames(info, ep),
          location: null,
          revealedInformation: [info],
          consequences: [],
          dependencies: [],
        });
      }
    }
  }
  return events;
}

function extractCharacterNames(text: string, ep: EpisodePlanItem): string[] {
  const names: string[] = [];
  const allText = ep.characterDevelopment + " " + text;
  for (const arc of ep.characterArcChanges) {
    if (allText.toLowerCase().includes(arc.name.toLowerCase())) {
      names.push(arc.name);
    }
  }
  for (const rel of ep.relationshipChanges) {
    if (allText.toLowerCase().includes(rel.from.toLowerCase())) names.push(rel.from);
    if (allText.toLowerCase().includes(rel.to.toLowerCase())) names.push(rel.to);
  }
  return [...new Set(names)];
}

function extractLocation(text: string, ep: EpisodePlanItem): string | null {
  for (const loc of ep.locationChanges) {
    if (text.toLowerCase().includes(loc.name.toLowerCase())) return loc.name;
  }
  return null;
}

function detectCycles(events: PlanEvent[], dependencies: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string): void {
    if (recursionStack.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      if (cycleStart >= 0) {
        cycles.push([...path.slice(cycleStart), nodeId]);
      }
      return;
    }
    if (visited.has(nodeId)) return;

    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);

    const deps = dependencies.get(nodeId);
    if (deps) {
      for (const dep of deps) {
        dfs(dep);
      }
    }

    path.pop();
    recursionStack.delete(nodeId);
  }

  for (const event of events) {
    dfs(event.id);
  }

  return cycles;
}

export function validateTemporalContinuity(plan: SeasonPlan): RichValidationFinding[] {
  const findings: RichValidationFinding[] = [];
  const events = extractEvents(plan);

  if (events.length === 0) return findings;

  const dependencies = new Map<string, Set<string>>();
  for (const event of events) {
    dependencies.set(event.id, new Set(event.dependencies));
  }

  for (let i = 0; i < plan.episodeProgression.length; i++) {
    const ep = plan.episodeProgression[i]!;
    const epText = ep.startingSituation + " " + ep.narrativePurpose;

    if (i > 0 && !isNonLinear(epText)) {
      const prev = plan.episodeProgression[i - 1]!;
      const prevConsequences = new Set(prev.consequences.map(normalize));
      const currStarting = normalize(ep.startingSituation);

      if (prevConsequences.size > 0 && currStarting.length > 20) {
        const consequenceKeywords = new Set<string>();
        for (const c of prevConsequences) {
          for (const w of c.split(/\s+/).filter((w) => w.length > 5)) {
            consequenceKeywords.add(w);
          }
        }
        const startingWords = new Set(currStarting.split(/\s+/).filter((w) => w.length > 5));
        let overlap = 0;
        for (const w of startingWords) if (consequenceKeywords.has(w)) overlap += 1;
        if (overlap === 0 && prev.consequences.length > 0) {
          findings.push({
            findingId: makeFindingId("temp"),
            category: "temporal_continuity",
            severity: "medium",
            episodeNumber: ep.episodeNumber,
            message: `Episode ${ep.episodeNumber} does not clearly follow from episode ${prev.episodeNumber}'s consequences.`,
            explanation: `Episode ${prev.episodeNumber} establishes consequences that are not reflected in episode ${ep.episodeNumber}'s starting situation.`,
            recommendation: `Connect the starting situation to the previous episode's consequences.`,
            requiresHumanReview: false,
            source: "deterministic",
          });
        }
      }
    }
  }

  for (let i = 0; i < plan.episodeProgression.length; i++) {
    const ep = plan.episodeProgression[i]!;
    for (const info of ep.informationRevealed) {
      const normInfo = normalize(info);
      for (let j = 0; j < i; j++) {
        const earlier = plan.episodeProgression[j]!;
        const earlierText = normalize(
          earlier.startingSituation + " " +
          earlier.characterDevelopment + " " +
          earlier.majorStoryBeats.join(" ")
        );
        if (normInfo.length > 20 && earlierText.includes(normInfo.slice(0, 30))) {
          findings.push({
            findingId: makeFindingId("temp"),
            category: "temporal_continuity",
            severity: "medium",
            episodeNumber: ep.episodeNumber,
            affectedField: "informationRevealed",
            message: `Episode ${ep.episodeNumber} reveals information that was already established in episode ${earlier.episodeNumber}.`,
            explanation: "Information should be revealed at the appropriate time, not re-revealed.",
            recommendation: "Remove the duplicate revelation or frame it as a reminder.",
            requiresHumanReview: false,
            source: "deterministic",
          });
          break;
        }
        if (normInfo.length > 10 && earlier.informationRevealed.some((r) => normalize(r).includes(normInfo.slice(0, 30)))) {
          findings.push({
            findingId: makeFindingId("temp"),
            category: "temporal_continuity",
            severity: "medium",
            episodeNumber: ep.episodeNumber,
            affectedField: "informationRevealed",
            message: `Episode ${ep.episodeNumber} reveals information that was already revealed in episode ${earlier.episodeNumber}.`,
            explanation: "Information should be revealed at the appropriate time, not re-revealed.",
            recommendation: "Remove the duplicate revelation or frame it as a reminder.",
            requiresHumanReview: false,
            source: "deterministic",
          });
          break;
        }
      }
    }
  }

  for (let i = 0; i < plan.episodeProgression.length; i++) {
    const ep = plan.episodeProgression[i]!;
    for (const obj of ep.objectChanges) {
      const normName = normalize(obj.name);
      const isIntroduced = obj.condition.toLowerCase().includes("introduce") ||
        obj.condition.toLowerCase().includes("discover") ||
        obj.condition.toLowerCase().includes("find");
      if (!isIntroduced) continue;
      for (let j = 0; j < i; j++) {
        const earlier = plan.episodeProgression[j]!;
        const earlierText = normalize(
          earlier.startingSituation + " " +
          earlier.majorStoryBeats.join(" ") + " " +
          earlier.importantEvents.join(" ")
        );
        if (earlierText.includes(normName)) {
          findings.push({
            findingId: makeFindingId("temp"),
            category: "temporal_continuity",
            severity: "medium",
            episodeNumber: ep.episodeNumber,
            affectedField: "objectChanges",
            message: `Object "${obj.name}" is introduced in episode ${ep.episodeNumber} but already appeared in episode ${earlier.episodeNumber}.`,
            explanation: "Objects should be introduced before they appear.",
            recommendation: `Move the introduction to episode ${earlier.episodeNumber} or earlier.`,
            requiresHumanReview: false,
            source: "deterministic",
          });
          break;
        }
      }
    }
  }

  const cycles = detectCycles(events, dependencies);
  for (const cycle of cycles) {
    findings.push({
      findingId: makeFindingId("temp"),
      category: "cyclic_dependency",
      severity: "blocking",
      message: `Cyclic event dependency detected: ${cycle.join(" → ")}.`,
      explanation: "Events cannot depend on each other cyclically.",
      recommendation: "Break the cycle by removing one dependency.",
      requiresHumanReview: true,
      source: "deterministic",
    });
  }

  return findings;
}

export function isFlashback(text: string): boolean {
  return FLASHBACK_INDICATORS.test(text);
}

export function isParallelTimeline(text: string): boolean {
  return PARALLEL_INDICATORS.test(text);
}