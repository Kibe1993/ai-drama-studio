import {
  canonFactEntrySchema,
  type CanonFactEntry,
  type DerivedCanonState,
} from "@/lib/canon/schema";
import { reduceCanon, type ReduceMode } from "@/lib/canon/reduce";
import { CanonFactConflict } from "@/lib/canon/store";

export { CanonFactConflict };

export class InMemoryCanonFactStore {
  private readonly entries = new Map<string, CanonFactEntry[]>();
  private readonly batchIndex = new Map<string, CanonFactEntry[]>();
  private readonly idIndex = new Map<string, Set<string>>();
  private readonly locks = new Map<
    string,
    { jobId: string; fencingToken: number; expiresAt: Date }
  >();

  private projectKey(projectId: string): string {
    return projectId;
  }

  getLatestSequence(projectId: string): number {
    const entries = this.entries.get(this.projectKey(projectId)) ?? [];
    if (entries.length === 0) return 0;
    return Math.max(...entries.map((e) => e.sequence));
  }

  append(input: {
    projectId: string;
    expectedSequence: number;
    entry: Omit<CanonFactEntry, "sequence" | "projectId" | "createdAt">;
  }): CanonFactEntry {
    const key = this.projectKey(input.projectId);
    const current = this.getLatestSequence(input.projectId);
    if (current + 1 !== input.expectedSequence) {
      throw new CanonFactConflict(
        `Expected next sequence ${input.expectedSequence} but current latest is ${current}.`,
      );
    }

    const ids = this.idIndex.get(key) ?? new Set<string>();
    if (ids.has(input.entry.id)) {
      throw new CanonFactConflict(`Canon fact id "${input.entry.id}" already exists.`);
    }

    const entry: CanonFactEntry = canonFactEntrySchema.parse({
      ...input.entry,
      projectId: input.projectId,
      sequence: input.expectedSequence,
      createdAt: new Date(),
    });

    ids.add(entry.id);
    this.idIndex.set(key, ids);
    const entries = this.entries.get(key) ?? [];
    entries.push(entry);
    this.entries.set(key, entries);
    return entry;
  }

  appendBatch(input: {
    projectId: string;
    expectedSequence: number;
    commitBatchId: string;
    entries: Omit<CanonFactEntry, "sequence" | "projectId" | "createdAt" | "commitBatchId">[];
    fencing?: { projectId: string; jobId: string; fencingToken: number };
  }): CanonFactEntry[] {
    const key = this.projectKey(input.projectId);
    const batchKey = `${key}:${input.commitBatchId}`;

    if (input.fencing) {
      const lock = this.locks.get(key);
      if (
        !lock ||
        lock.jobId !== input.fencing.jobId ||
        lock.fencingToken !== input.fencing.fencingToken ||
        lock.expiresAt < new Date()
      ) {
        throw new CanonFactConflict(
          "Canon lock fencing verification failed: lock not held or token stale.",
        );
      }
    }

    const existing = this.batchIndex.get(batchKey);
    if (existing) {
      if (existing.length !== input.entries.length) {
        throw new CanonFactConflict(
          `commitBatchId "${input.commitBatchId}" exists with ${existing.length} entries but retry supplies ${input.entries.length}.`,
        );
      }
      for (let i = 0; i < existing.length; i += 1) {
        if (existing[i].id !== input.entries[i].id) {
          throw new CanonFactConflict(
            `commitBatchId "${input.commitBatchId}" entry ${i} has id "${existing[i].id}" but retry supplies "${input.entries[i].id}".`,
          );
        }
      }
      return existing;
    }

    const current = this.getLatestSequence(input.projectId);
    if (current + 1 !== input.expectedSequence) {
      throw new CanonFactConflict(
        `Expected next sequence ${input.expectedSequence} but current latest is ${current}.`,
      );
    }

    const ids = this.idIndex.get(key) ?? new Set<string>();
    const projectEntries = this.entries.get(key) ?? [];
    const results: CanonFactEntry[] = [];
    let sequence = input.expectedSequence;
    const now = new Date();

    for (const partial of input.entries) {
      if (ids.has(partial.id)) {
        throw new CanonFactConflict(`Canon fact id "${partial.id}" already exists.`);
      }
      const entry: CanonFactEntry = canonFactEntrySchema.parse({
        ...partial,
        projectId: input.projectId,
        sequence,
        commitBatchId: input.commitBatchId,
        createdAt: now,
      });
      ids.add(entry.id);
      projectEntries.push(entry);
      results.push(entry);
      sequence += 1;
    }

    this.idIndex.set(key, ids);
    this.entries.set(key, projectEntries);
    this.batchIndex.set(batchKey, results);
    return results;
  }

  list(projectId: string): CanonFactEntry[] {
    return [...(this.entries.get(this.projectKey(projectId)) ?? [])];
  }

  setLock(
    projectId: string,
    lock: { jobId: string; fencingToken: number; expiresAt: Date },
  ): void {
    this.locks.set(this.projectKey(projectId), lock);
  }

  clearLock(projectId: string): void {
    this.locks.delete(this.projectKey(projectId));
  }

  latestState(projectId: string, mode?: ReduceMode): DerivedCanonState {
    return reduceCanon(projectId, this.list(projectId), mode);
  }
}