import type {
  RichValidationFinding,
  FindingGroup,

  ValidationSeverity,
} from "@/lib/validation/seasonPlanValidation";
import { toFindingDomain, severityRank } from "@/lib/validation/seasonPlanValidation";

/**
 * Finding Grouper — merges related findings that share the same underlying
 * problem so the revision system performs one correction instead of several
 * redundant ones.
 *
 * Grouping criteria:
 * 1. Same FindingDomain (e.g., all character_identity_aliases findings)
 * 2. Same shared entity (character name, location, relationship pair)
 * 3. Same or adjacent episodes
 *
 * Deduplication:
 * - Findings with identical messages are collapsed
 * - Findings with the same findingId are collapsed
 */

function normalizeEntity(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const ENTITY_PATTERNS = [
  /character ["']([^"']+)["']/i,
  /character\s+(\w[\w\s]{1,78})/i,
  /location ["']([^"']+)["']/i,
  /location\s+(\w[\w\s]{1,118})/i,
  /references\s+(?:character|location)\s+["']?([^"'.]+)["']?/i,
  /unknown character\s+["']?([^"'.]+)["']?/i,
];

function extractSharedEntity(finding: RichValidationFinding): string | null {
  const sources = [finding.message, finding.affectedField, finding.affectedEvent].filter(
    (s): s is string => Boolean(s)
  );
  for (const source of sources) {
    for (const pattern of ENTITY_PATTERNS) {
      const match = source.match(pattern);
      if (match && match[1]) {
        return normalizeEntity(match[1].trim());
      }
    }
  }
  return null;
}

function areEpisodesAdjacent(episodesA: number[], episodesB: number[]): boolean {
  if (episodesA.length === 0 || episodesB.length === 0) return true;
  const all = [...episodesA, ...episodesB];
  const min = Math.min(...all);
  const max = Math.max(...all);
  return max - min <= 2;
}

function shouldMerge(
  finding: RichValidationFinding,
  group: FindingGroup,
): boolean {
  if (toFindingDomain(finding.category) !== group.domain) return false;

  const entity = extractSharedEntity(finding);

  if (group.sharedEntity && entity && normalizeEntity(group.sharedEntity) === normalizeEntity(entity)) {
    return true;
  }

  if (!group.sharedEntity && !entity) {
    const findingEpisodes = finding.episodeNumber ? [finding.episodeNumber] : [];
    if (areEpisodesAdjacent(findingEpisodes, group.affectedEpisodes)) {
      return true;
    }
  }

  return false;
}

function mergeSeverity(
  current: ValidationSeverity,
  candidate: ValidationSeverity,
): ValidationSeverity {
  return severityRank(candidate) > severityRank(current) ? candidate : current;
}

function deduplicateFindings(findings: RichValidationFinding[]): RichValidationFinding[] {
  const seen = new Set<string>();
  const result: RichValidationFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.findingId}:${normalizeEntity(finding.message)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }
  return result;
}

let groupCounter = 0;
function makeGroupId(): string {
  groupCounter += 1;
  return `grp-${groupCounter.toString(36).padStart(4, "0")}`;
}

export function resetGroupCounter(): void {
  groupCounter = 0;
}

export function groupFindings(
  findings: RichValidationFinding[],
): FindingGroup[] {
  const unique = deduplicateFindings(findings);
  const groups: FindingGroup[] = [];

  for (const finding of unique) {
    const domain = toFindingDomain(finding.category);
    const entity = extractSharedEntity(finding);
    const episodes = finding.episodeNumber ? [finding.episodeNumber] : [];

    const mergeTarget = groups.find((g) => shouldMerge(finding, g));

    if (mergeTarget) {
      mergeTarget.findingIds.push(finding.findingId);
      mergeTarget.findings.push(finding);
      mergeTarget.severity = mergeSeverity(mergeTarget.severity, finding.severity);
      for (const ep of episodes) {
        if (!mergeTarget.affectedEpisodes.includes(ep)) {
          mergeTarget.affectedEpisodes.push(ep);
        }
      }
      mergeTarget.affectedEpisodes.sort((a, b) => a - b);
    } else {
      groups.push({
        groupId: makeGroupId(),
        findingIds: [finding.findingId],
        domain,
        category: finding.category,
        severity: finding.severity,
        affectedEpisodes: episodes,
        sharedEntity: entity,
        findings: [finding],
      });
    }
  }

  return groups.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

export function extractEntities(findings: RichValidationFinding[]): Set<string> {
  const entities = new Set<string>();
  for (const finding of findings) {
    const entity = extractSharedEntity(finding);
    if (entity) entities.add(entity);
  }
  return entities;
}