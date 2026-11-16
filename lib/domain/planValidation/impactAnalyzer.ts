import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { GraphNode, GraphEdge } from "@/lib/validation/narrativeGraph";

/**
 * Cross-Episode Impact Analyzer — determines whether a revision to one episode
 * affects subsequent episodes and what kind of propagation is needed.
 *
 * The analyzer is a pure function: it takes the original episode, the revised
 * episode, and the season plan, and returns a structured impact report.
 * It never calls an LLM and never modifies anything.
 *
 * The analyzer uses both direct content comparison (what fields changed) and
 * the narrative dependency graph (if available) to identify downstream impacts.
 */

// ---------------------------------------------------------------------------
// Change detection types
// ---------------------------------------------------------------------------

export type ChangeType = "added" | "removed" | "modified";

export interface EpisodeChange {
  field: string;
  changeType: ChangeType;
  description: string;
}

// ---------------------------------------------------------------------------
// Impact types
// ---------------------------------------------------------------------------

export const IMPACT_TYPES = [
  "character_state",
  "event_consequence",
  "unresolved_thread",
  "setup_payoff",
  "information_reveal",
  "relationship",
  "ending_change",
] as const;
export type ImpactType = (typeof IMPACT_TYPES)[number];

export interface DownstreamImpact {
  episodeNumber: number;
  impactType: ImpactType;
  severity: "blocking" | "high" | "medium" | "low";
  description: string;
  requiresRevision: boolean;
}

// ---------------------------------------------------------------------------
// Impact report
// ---------------------------------------------------------------------------

export interface ImpactReport {
  sourceEpisodeNumber: number;
  changes: EpisodeChange[];
  downstreamImpacts: DownstreamImpact[];
  hasBlockingImpact: boolean;
  affectedEpisodeCount: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// Field comparison helpers
// ---------------------------------------------------------------------------

function normalize(value: unknown): string {
  return JSON.stringify(value);
}

function compareArrayField(
  fieldName: string,
  original: string[],
  revised: string[],
): EpisodeChange[] {
  const changes: EpisodeChange[] = [];
  const originalSet = new Set(original.map(normalize));
  const revisedSet = new Set(revised.map(normalize));

  for (const item of revised) {
    if (!originalSet.has(normalize(item))) {
      changes.push({
        field: fieldName,
        changeType: "added",
        description: `Added: "${item.slice(0, 100)}"`,
      });
    }
  }

  for (const item of original) {
    if (!revisedSet.has(normalize(item))) {
      changes.push({
        field: fieldName,
        changeType: "removed",
        description: `Removed: "${item.slice(0, 100)}"`,
      });
    }
  }

  return changes;
}

function compareStringField(
  fieldName: string,
  original: string,
  revised: string,
): EpisodeChange[] {
  if (original !== revised) {
    return [{
      field: fieldName,
      changeType: "modified",
      description: `Changed from "${original.slice(0, 80)}" to "${revised.slice(0, 80)}"`,
    }];
  }
  return [];
}

function compareArcChanges(
  original: EpisodePlanItem["characterArcChanges"],
  revised: EpisodePlanItem["characterArcChanges"],
): EpisodeChange[] {
  const changes: EpisodeChange[] = [];
  const originalNames = new Set(original.map((c) => c.name));
  const revisedNames = new Set(revised.map((c) => c.name));

  for (const arc of revised) {
    if (!originalNames.has(arc.name)) {
      changes.push({
        field: "characterArcChanges",
        changeType: "added",
        description: `Added arc change for "${arc.name}": ${arc.change.slice(0, 80)}`,
      });
    }
  }

  for (const arc of original) {
    if (!revisedNames.has(arc.name)) {
      changes.push({
        field: "characterArcChanges",
        changeType: "removed",
        description: `Removed arc change for "${arc.name}"`,
      });
    }
  }

  for (const origArc of original) {
    const revisedArc = revised.find((c) => c.name === origArc.name);
    if (revisedArc && origArc.change !== revisedArc.change) {
      changes.push({
        field: "characterArcChanges",
        changeType: "modified",
        description: `Modified arc change for "${origArc.name}"`,
      });
    }
  }

  return changes;
}

function compareRelationshipChanges(
  original: EpisodePlanItem["relationshipChanges"],
  revised: EpisodePlanItem["relationshipChanges"],
): EpisodeChange[] {
  const changes: EpisodeChange[] = [];
  const originalKeys = new Set(original.map((r) => `${r.from}|${r.to}`));
  const revisedKeys = new Set(revised.map((r) => `${r.from}|${r.to}`));

  for (const rel of revised) {
    if (!originalKeys.has(`${rel.from}|${rel.to}`)) {
      changes.push({
        field: "relationshipChanges",
        changeType: "added",
        description: `Added relationship change: ${rel.from} → ${rel.to}`,
      });
    }
  }

  for (const rel of original) {
    if (!revisedKeys.has(`${rel.from}|${rel.to}`)) {
      changes.push({
        field: "relationshipChanges",
        changeType: "removed",
        description: `Removed relationship change: ${rel.from} → ${rel.to}`,
      });
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Main change detection
// ---------------------------------------------------------------------------

export function detectChanges(
  original: EpisodePlanItem,
  revised: EpisodePlanItem,
): EpisodeChange[] {
  const changes: EpisodeChange[] = [];

  changes.push(...compareStringField("narrativePurpose", original.narrativePurpose, revised.narrativePurpose));
  changes.push(...compareStringField("startingSituation", original.startingSituation, revised.startingSituation));
  changes.push(...compareStringField("mainObjective", original.mainObjective, revised.mainObjective));
  changes.push(...compareStringField("centralConflict", original.centralConflict, revised.centralConflict));
  changes.push(...compareStringField("characterDevelopment", original.characterDevelopment, revised.characterDevelopment));
  changes.push(...compareStringField("storyContribution", original.storyContribution, revised.storyContribution));
  changes.push(...compareStringField("endingOrCliffhanger", original.endingOrCliffhanger, revised.endingOrCliffhanger));
  changes.push(...compareStringField("continuityRequirements", original.continuityRequirements, revised.continuityRequirements));

  changes.push(...compareArrayField("majorStoryBeats", original.majorStoryBeats, revised.majorStoryBeats));
  changes.push(...compareArrayField("informationRevealed", original.informationRevealed, revised.informationRevealed));
  changes.push(...compareArrayField("importantEvents", original.importantEvents, revised.importantEvents));
  changes.push(...compareArrayField("consequences", original.consequences, revised.consequences));
  changes.push(...compareArrayField("unresolvedThreads", original.unresolvedThreads, revised.unresolvedThreads));

  changes.push(...compareArcChanges(original.characterArcChanges, revised.characterArcChanges));
  changes.push(...compareRelationshipChanges(original.relationshipChanges, revised.relationshipChanges));

  return changes;
}

// ---------------------------------------------------------------------------
// Impact classification
// ---------------------------------------------------------------------------

function classifyChange(change: EpisodeChange): ImpactType | null {
  switch (change.field) {
    case "characterArcChanges":
    case "characterDevelopment":
      return "character_state";
    case "importantEvents":
    case "consequences":
      return "event_consequence";
    case "unresolvedThreads":
      return "unresolved_thread";
    case "informationRevealed":
      return "information_reveal";
    case "relationshipChanges":
      return "relationship";
    case "endingOrCliffhanger":
      return "ending_change";
    case "majorStoryBeats":
      if (change.description.toLowerCase().includes("setup") || change.description.toLowerCase().includes("payoff")) {
        return "setup_payoff";
      }
      return "event_consequence";
    default:
      return null;
  }
}

function severityForImpactType(
  impactType: ImpactType,
  changeType: ChangeType,
): "blocking" | "high" | "medium" | "low" {
  if (impactType === "ending_change" && changeType === "modified") return "high";
  if (impactType === "character_state" && changeType === "removed") return "blocking";
  if (impactType === "unresolved_thread" && changeType === "removed") return "high";
  if (impactType === "event_consequence" && changeType === "removed") return "high";
  if (impactType === "information_reveal" && changeType === "removed") return "high";
  if (impactType === "relationship" && changeType === "removed") return "high";
  if (changeType === "added") return "medium";
  return "low";
}

function requiresRevisionForImpact(severity: string): boolean {
  return severity === "blocking" || severity === "high";
}

// ---------------------------------------------------------------------------
// Downstream impact detection
// ---------------------------------------------------------------------------

function findDownstreamEpisodes(
  plan: SeasonPlan,
  sourceEpisodeNumber: number,
): EpisodePlanItem[] {
  return plan.episodeProgression.filter((ep) => ep.episodeNumber > sourceEpisodeNumber);
}

function episodeReferencesEntity(
  episode: EpisodePlanItem,
  change: EpisodeChange,
): boolean {
  const text = JSON.stringify(episode).toLowerCase();
  const desc = change.description.toLowerCase();
  const match = desc.match(/"([^"]+)"/);
  if (match && match[1]) {
    return text.includes(match[1].toLowerCase());
  }
  return false;
}

function findGraphDependents(
  nodes: GraphNode[],
  edges: GraphEdge[],
  sourceEpisodeNumber: number,
): Set<number> {
  const dependentEpisodes = new Set<number>();
  const sourceNodeIds = new Set(
    nodes
      .filter((n) => n.episodeNumber === sourceEpisodeNumber)
      .map((n) => n.id),
  );

  for (const edge of edges) {
    if (sourceNodeIds.has(edge.from)) {
      const targetNode = nodes.find((n) => n.id === edge.to);
      if (targetNode?.episodeNumber && targetNode.episodeNumber !== sourceEpisodeNumber) {
        dependentEpisodes.add(targetNode.episodeNumber);
      }
    }
  }

  return dependentEpisodes;
}

// ---------------------------------------------------------------------------
// Main impact analysis function
// ---------------------------------------------------------------------------

export interface AnalyzeImpactInput {
  originalEpisode: EpisodePlanItem;
  revisedEpisode: EpisodePlanItem;
  plan: SeasonPlan;
  graphNodes?: GraphNode[];
  graphEdges?: GraphEdge[];
}

export function analyzeImpact(input: AnalyzeImpactInput): ImpactReport {
  const { originalEpisode, revisedEpisode, plan } = input;
  const sourceEpisodeNumber = originalEpisode.episodeNumber;

  const changes = detectChanges(originalEpisode, revisedEpisode);

  if (changes.length === 0) {
    return {
      sourceEpisodeNumber,
      changes: [],
      downstreamImpacts: [],
      hasBlockingImpact: false,
      affectedEpisodeCount: 0,
      summary: `No changes detected in episode ${sourceEpisodeNumber}.`,
    };
  }

  const downstreamEpisodes = findDownstreamEpisodes(plan, sourceEpisodeNumber);
  const graphDependents = input.graphNodes && input.graphEdges
    ? findGraphDependents(input.graphNodes, input.graphEdges, sourceEpisodeNumber)
    : new Set<number>();

  const downstreamImpacts: DownstreamImpact[] = [];
  const impactedEpisodes = new Set<number>();

  for (const change of changes) {
    const impactType = classifyChange(change);
    if (!impactType) continue;

    const severity = severityForImpactType(impactType, change.changeType);
    const requiresRevision = requiresRevisionForImpact(severity);

    for (const episode of downstreamEpisodes) {
      const referenced = episodeReferencesEntity(episode, change);
      const isGraphDependent = graphDependents.has(episode.episodeNumber);

      if (!referenced && !isGraphDependent && severity === "low") continue;
      if (!referenced && !isGraphDependent && impactType !== "ending_change") continue;

      impactedEpisodes.add(episode.episodeNumber);
      downstreamImpacts.push({
        episodeNumber: episode.episodeNumber,
        impactType,
        severity,
        description: `Episode ${episode.episodeNumber} may be affected by ${change.changeType} to ${change.field}: ${change.description}`,
        requiresRevision,
      });
    }
  }

  const dedupedImpacts = deduplicateImpacts(downstreamImpacts);
  const hasBlockingImpact = dedupedImpacts.some((i) => i.severity === "blocking");

  const summary = changes.length === 0
    ? `No changes detected in episode ${sourceEpisodeNumber}.`
    : `Episode ${sourceEpisodeNumber} was revised with ${changes.length} change(s). ${dedupedImpacts.length} downstream impact(s) across ${impactedEpisodes.size} episode(s).${hasBlockingImpact ? " Blocking impacts detected." : ""}`;

  return {
    sourceEpisodeNumber,
    changes,
    downstreamImpacts: dedupedImpacts,
    hasBlockingImpact,
    affectedEpisodeCount: impactedEpisodes.size,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function deduplicateImpacts(impacts: DownstreamImpact[]): DownstreamImpact[] {
  const seen = new Set<string>();
  const result: DownstreamImpact[] = [];
  for (const impact of impacts) {
    const key = `${impact.episodeNumber}|${impact.impactType}|${impact.description}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(impact);
    }
  }
  return result.sort((a, b) => {
    if (a.episodeNumber !== b.episodeNumber) return a.episodeNumber - b.episodeNumber;
    const severityRank = { blocking: 4, high: 3, medium: 2, low: 1 };
    return severityRank[b.severity] - severityRank[a.severity];
  });
}

// ---------------------------------------------------------------------------
// Utility: check if any impacts require revision
// ---------------------------------------------------------------------------

export function getImpactsRequiringRevision(report: ImpactReport): DownstreamImpact[] {
  return report.downstreamImpacts.filter((i) => i.requiresRevision);
}

export function getBlockingImpacts(report: ImpactReport): DownstreamImpact[] {
  return report.downstreamImpacts.filter((i) => i.severity === "blocking");
}

export function hasImpact(report: ImpactReport): boolean {
  return report.changes.length > 0;
}