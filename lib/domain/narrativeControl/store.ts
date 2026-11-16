import type { CanonState } from "@/lib/validation/narrativeControl";
import { canonStateSchema } from "@/lib/validation/narrativeControl";
import { invalidateContextCache } from "@/lib/domain/narrativeControl/context";

export class VersionConflict extends Error {
  readonly code = "version_conflict";
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "VersionConflict";
  }
}

/**
 * Optimistic versions. A commit fails when another revision landed first.
 * Older versions stay readable. Rollback copies an old version forward.
 */
export class InMemoryCanonStore {
  private readonly versions = new Map<string, CanonState[]>();

  latest(projectId: string): CanonState | null {
    const history = this.versions.get(projectId) ?? [];
    return history[history.length - 1] ?? null;
  }

  history(projectId: string): CanonState[] {
    return [...(this.versions.get(projectId) ?? [])];
  }

  at(projectId: string, version: number): CanonState | null {
    return (this.versions.get(projectId) ?? []).find((state) => state.version === version) ?? null;
  }

  commit(projectId: string, expectedVersion: number, draft: CanonState, reason: string): CanonState {
    const current = this.latest(projectId);
    const actual = current?.version ?? 0;
    if (actual !== expectedVersion) {
      throw new VersionConflict(`Canon version ${expectedVersion} is stale. The current version is ${actual}.`);
    }
    const next = canonStateSchema.parse({
      ...structuredClone(draft),
      projectId,
      version: actual + 1,
      revisionLog: [
        ...(current?.revisionLog ?? draft.revisionLog),
        { version: actual + 1, reason, changeIds: ["commit"] },
      ],
    });
    const history = this.versions.get(projectId) ?? [];
    history.push(next);
    this.versions.set(projectId, history);
    invalidateContextCache(projectId);
    return next;
  }

  rollback(projectId: string, expectedVersion: number, targetVersion: number, reason: string): CanonState {
    const target = this.at(projectId, targetVersion);
    if (!target) throw new VersionConflict(`Canon version ${targetVersion} does not exist.`);
    return this.commit(projectId, expectedVersion, target, reason);
  }
}
