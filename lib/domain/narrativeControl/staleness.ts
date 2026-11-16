export interface VersionedArtifact {
  id: string;
  kind:
    | "story_draft"
    | "story_bible"
    | "season_plan"
    | "episode_plan"
    | "screenplay"
    | "scene"
    | "shot"
    | "audio"
    | "video"
    | "timeline";
  sourceCanonVersion: number | null;
  dependsOnFactIds: string[];
}

export interface StaleArtifact {
  id: string;
  kind: VersionedArtifact["kind"];
  sourceCanonVersion: number | null;
  currentCanonVersion: number;
  reason: string;
  factIds: string[];
}

export function provenanceIsStale(sourceCanonVersion: number | null | undefined, currentCanonVersion: number): boolean {
  return typeof sourceCanonVersion === "number" && sourceCanonVersion < currentCanonVersion;
}

export function canonProvenance(version: number | null): {
  sourceCanonVersion: number | null;
  canonStale: boolean;
  canonStaleReason: string;
} {
  return { sourceCanonVersion: version, canonStale: false, canonStaleReason: "" };
}

/**
 * Mark downstream artifacts stale. Nothing is deleted or regenerated here.
 */
export function markStaleArtifacts(input: {
  currentCanonVersion: number;
  changedFactIds: string[];
  artifacts: VersionedArtifact[];
}): StaleArtifact[] {
  return input.artifacts.flatMap((artifact) => {
    if (artifact.sourceCanonVersion === null) return [];
    if (artifact.sourceCanonVersion >= input.currentCanonVersion) return [];
    const overlap = artifact.dependsOnFactIds.filter((factId) => input.changedFactIds.includes(factId));
    if (artifact.dependsOnFactIds.length > 0 && overlap.length === 0) return [];
    return [{
      id: artifact.id,
      kind: artifact.kind,
      sourceCanonVersion: artifact.sourceCanonVersion,
      currentCanonVersion: input.currentCanonVersion,
      factIds: overlap,
      reason: overlap.length > 0
        ? `Canon version ${input.currentCanonVersion} changed ${overlap.join(", ")} after this ${artifact.kind} was made from version ${artifact.sourceCanonVersion}.`
        : `This ${artifact.kind} was made from canon version ${artifact.sourceCanonVersion}. The approved canon is now version ${input.currentCanonVersion}.`,
    }];
  });
}
