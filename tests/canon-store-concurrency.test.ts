import { describe, it, expect } from "vitest";
import { InMemoryCanonFactStore, CanonFactConflict } from "@/lib/canon/inMemoryStore";
import { defaultFactualStatus, type CanonFactEntry } from "@/lib/canon/schema";
import type { CanonEntity } from "@/lib/validation/narrativeControl";

const PROJECT = "proj-1";
const EXTRACTOR = "test-extractor";

function makeEntity(id: string): CanonEntity {
  return {
    id, kind: "character", name: id, aliases: [], description: "", role: "",
    motivations: [], goals: [], firstIntroductionEpisode: 1, firstAppearanceEpisode: 1,
    appearances: [1], lifecycle: "active", arc: "", secrets: [], permitsNonlivingAppearance: false,
    endedEpisode: null, ownerId: null, locationId: null, properties: [], significance: "",
    transfers: [], modifications: [], locationRules: [],
  };
}

function makeEvidence() {
  return {
    quote: "evidence", sceneNumber: 1, episode: 1, episodeId: "ep-1",
    storyId: "story-1", storyVersion: 1, sourceHash: "sha256:abc",
  };
}

type PartialEntry = Omit<CanonFactEntry, "sequence" | "projectId" | "createdAt">;

function makePartialEntry(id: string, targetId: string): PartialEntry {
  return {
    id, episode: 1, sourceStoryId: "story-1", operation: "add", kind: "entity",
    targetId, payload: makeEntity(targetId), newClassification: null,
    evidence: makeEvidence(), narrativeMode: "present", assertionKind: "event",
    factualStatus: defaultFactualStatus("present"), asserterId: null,
    commitBatchId: null, reason: "test", extractor: EXTRACTOR,
  };
}

describe("InMemoryCanonFactStore — concurrency and idempotency", () => {
  describe("expectedSequence protection", () => {
    it("first append requires expectedSequence=1", () => {
      const store = new InMemoryCanonFactStore();
      const entry = makePartialEntry("e1", "c1");
      expect(() => store.append({ projectId: PROJECT, expectedSequence: 1, entry })).not.toThrow();
    });

    it("wrong expectedSequence throws CanonFactConflict", () => {
      const store = new InMemoryCanonFactStore();
      const entry = makePartialEntry("e1", "c1");
      expect(() => store.append({ projectId: PROJECT, expectedSequence: 5, entry })).toThrow(CanonFactConflict);
    });

    it("expectedSequence=0 on empty store throws", () => {
      const store = new InMemoryCanonFactStore();
      const entry = makePartialEntry("e1", "c1");
      expect(() => store.append({ projectId: PROJECT, expectedSequence: 0, entry })).toThrow(CanonFactConflict);
    });

    it("second append requires expectedSequence=2", () => {
      const store = new InMemoryCanonFactStore();
      store.append({ projectId: PROJECT, expectedSequence: 1, entry: makePartialEntry("e1", "c1") });
      expect(() => store.append({ projectId: PROJECT, expectedSequence: 2, entry: makePartialEntry("e2", "c2") })).not.toThrow();
    });

    it("stale expectedSequence throws", () => {
      const store = new InMemoryCanonFactStore();
      store.append({ projectId: PROJECT, expectedSequence: 1, entry: makePartialEntry("e1", "c1") });
      expect(() => store.append({ projectId: PROJECT, expectedSequence: 1, entry: makePartialEntry("e2", "c2") })).toThrow(CanonFactConflict);
    });
  });

  describe("concurrent append attempts", () => {
    it("two concurrent appends with same expectedSequence: one succeeds, one fails", () => {
      const store = new InMemoryCanonFactStore();
      const entry1 = makePartialEntry("e1", "c1");
      const entry2 = makePartialEntry("e2", "c2");

      const result1 = store.append({ projectId: PROJECT, expectedSequence: 1, entry: entry1 });
      expect(result1.sequence).toBe(1);

      expect(() => store.append({ projectId: PROJECT, expectedSequence: 1, entry: entry2 })).toThrow(CanonFactConflict);
      expect(store.getLatestSequence(PROJECT)).toBe(1);
      expect(store.list(PROJECT)).toHaveLength(1);
    });

    it("concurrent appends with different expectedSequence: only the correct one succeeds", () => {
      const store = new InMemoryCanonFactStore();
      const entry1 = makePartialEntry("e1", "c1");
      const entry2 = makePartialEntry("e2", "c2");
      const entry3 = makePartialEntry("e3", "c3");

      store.append({ projectId: PROJECT, expectedSequence: 1, entry: entry1 });
      expect(() => store.append({ projectId: PROJECT, expectedSequence: 1, entry: entry2 })).toThrow(CanonFactConflict);
      store.append({ projectId: PROJECT, expectedSequence: 2, entry: entry3 });

      expect(store.list(PROJECT)).toHaveLength(2);
      expect(store.getLatestSequence(PROJECT)).toBe(2);
    });
  });

  describe("duplicate id rejection", () => {
    it("appending a fact with an existing id throws", () => {
      const store = new InMemoryCanonFactStore();
      store.append({ projectId: PROJECT, expectedSequence: 1, entry: makePartialEntry("e1", "c1") });
      expect(() => store.append({ projectId: PROJECT, expectedSequence: 2, entry: makePartialEntry("e1", "c2") })).toThrow(CanonFactConflict);
    });
  });

  describe("commitBatchId idempotency", () => {
    it("retrying the same commitBatchId returns existing facts without duplicates", () => {
      const store = new InMemoryCanonFactStore();
      const batchEntries = [
        { ...makePartialEntry("b1", "c1"), commitBatchId: undefined },
        { ...makePartialEntry("b2", "c2"), commitBatchId: undefined },
        { ...makePartialEntry("b3", "c3"), commitBatchId: undefined },
      ];

      const result1 = store.appendBatch({
        projectId: PROJECT, expectedSequence: 1, commitBatchId: "batch-001",
        entries: batchEntries,
      });
      expect(result1).toHaveLength(3);
      expect(result1[0]!.sequence).toBe(1);
      expect(result1[1]!.sequence).toBe(2);
      expect(result1[2]!.sequence).toBe(3);

      const result2 = store.appendBatch({
        projectId: PROJECT, expectedSequence: 1, commitBatchId: "batch-001",
        entries: batchEntries,
      });
      expect(result2).toHaveLength(3);
      expect(result2).toEqual(result1);
      expect(store.list(PROJECT)).toHaveLength(3);
    });

    it("different commitBatchId with correct expectedSequence succeeds", () => {
      const store = new InMemoryCanonFactStore();
      const batch1 = [{ ...makePartialEntry("b1", "c1"), commitBatchId: undefined }];
      const batch2 = [{ ...makePartialEntry("b2", "c2"), commitBatchId: undefined }];

      const r1 = store.appendBatch({ projectId: PROJECT, expectedSequence: 1, commitBatchId: "batch-A", entries: batch1 });
      expect(r1).toHaveLength(1);

      const r2 = store.appendBatch({ projectId: PROJECT, expectedSequence: 2, commitBatchId: "batch-B", entries: batch2 });
      expect(r2).toHaveLength(1);
      expect(store.list(PROJECT)).toHaveLength(2);
    });

    it("retry with stale expectedSequence still returns existing batch (idempotent)", () => {
      const store = new InMemoryCanonFactStore();
      const batchEntries = [{ ...makePartialEntry("b1", "c1"), commitBatchId: undefined }];

      store.appendBatch({ projectId: PROJECT, expectedSequence: 1, commitBatchId: "batch-X", entries: batchEntries });

      const result = store.appendBatch({ projectId: PROJECT, expectedSequence: 99, commitBatchId: "batch-X", entries: batchEntries });
      expect(result).toHaveLength(1);
      expect(store.list(PROJECT)).toHaveLength(1);
    });

    it("batch with wrong expectedSequence and no existing batch throws", () => {
      const store = new InMemoryCanonFactStore();
      const batchEntries = [{ ...makePartialEntry("b1", "c1"), commitBatchId: undefined }];
      expect(() => store.appendBatch({ projectId: PROJECT, expectedSequence: 5, commitBatchId: "batch-Y", entries: batchEntries })).toThrow(CanonFactConflict);
    });
  });

  describe("batch atomicity", () => {
    it("all facts in a batch get sequential sequence numbers", () => {
      const store = new InMemoryCanonFactStore();
      const batchEntries = [
        { ...makePartialEntry("b1", "c1"), commitBatchId: undefined },
        { ...makePartialEntry("b2", "c2"), commitBatchId: undefined },
        { ...makePartialEntry("b3", "c3"), commitBatchId: undefined },
      ];
      const result = store.appendBatch({ projectId: PROJECT, expectedSequence: 1, commitBatchId: "batch-seq", entries: batchEntries });
      expect(result.map((e) => e.sequence)).toEqual([1, 2, 3]);
    });

    it("batch after existing facts continues from latest sequence", () => {
      const store = new InMemoryCanonFactStore();
      store.append({ projectId: PROJECT, expectedSequence: 1, entry: makePartialEntry("e1", "c1") });
      store.append({ projectId: PROJECT, expectedSequence: 2, entry: makePartialEntry("e2", "c2") });

      const batchEntries = [
        { ...makePartialEntry("b1", "c3"), commitBatchId: undefined },
        { ...makePartialEntry("b2", "c4"), commitBatchId: undefined },
      ];
      const result = store.appendBatch({ projectId: PROJECT, expectedSequence: 3, commitBatchId: "batch-cont", entries: batchEntries });
      expect(result.map((e) => e.sequence)).toEqual([3, 4]);
    });

    it("batch with duplicate id within itself throws", () => {
      const store = new InMemoryCanonFactStore();
      const batchEntries = [
        { ...makePartialEntry("dup", "c1"), commitBatchId: undefined },
        { ...makePartialEntry("dup", "c2"), commitBatchId: undefined },
      ];
      expect(() => store.appendBatch({ projectId: PROJECT, expectedSequence: 1, commitBatchId: "batch-dup", entries: batchEntries })).toThrow(CanonFactConflict);
    });
  });

  describe("multi-project isolation", () => {
    it("sequences are independent per project", () => {
      const store = new InMemoryCanonFactStore();
      store.append({ projectId: "proj-A", expectedSequence: 1, entry: makePartialEntry("a1", "c1") });
      store.append({ projectId: "proj-B", expectedSequence: 1, entry: makePartialEntry("b1", "c1") });
      store.append({ projectId: "proj-A", expectedSequence: 2, entry: makePartialEntry("a2", "c2") });

      expect(store.getLatestSequence("proj-A")).toBe(2);
      expect(store.getLatestSequence("proj-B")).toBe(1);
      expect(store.list("proj-A")).toHaveLength(2);
      expect(store.list("proj-B")).toHaveLength(1);
    });
  });

  describe("latestState integration", () => {
    it("latestState reduces all entries", () => {
      const store = new InMemoryCanonFactStore();
      store.append({ projectId: PROJECT, expectedSequence: 1, entry: makePartialEntry("e1", "c1") });
      store.append({ projectId: PROJECT, expectedSequence: 2, entry: makePartialEntry("e2", "c2") });

      const state = store.latestState(PROJECT);
      expect(state.entities).toHaveLength(2);
      expect(state.sequence).toBe(2);
      expect(state.factCount).toBe(2);
    });

    it("latestState with migration mode", () => {
      const store = new InMemoryCanonFactStore();
      store.append({ projectId: PROJECT, expectedSequence: 1, entry: makePartialEntry("e1", "c1") });
      store.append({ projectId: PROJECT, expectedSequence: 2, entry: makePartialEntry("e2", "c1") });

      expect(() => store.latestState(PROJECT)).toThrow();
      expect(() => store.latestState(PROJECT, "migration")).not.toThrow();
    });
  });

  describe("commitBatchId content verification on retry", () => {
    it("retry with different entry count throws CanonFactConflict", () => {
      const store = new InMemoryCanonFactStore();
      const originalBatch = [
        { ...makePartialEntry("b1", "c1"), commitBatchId: undefined },
        { ...makePartialEntry("b2", "c2"), commitBatchId: undefined },
        { ...makePartialEntry("b3", "c3"), commitBatchId: undefined },
      ];

      store.appendBatch({
        projectId: PROJECT, expectedSequence: 1, commitBatchId: "batch-cv-1",
        entries: originalBatch,
      });

      const retryWithFewer = [
        { ...makePartialEntry("b1", "c1"), commitBatchId: undefined },
        { ...makePartialEntry("b2", "c2"), commitBatchId: undefined },
      ];
      expect(() => store.appendBatch({
        projectId: PROJECT, expectedSequence: 1, commitBatchId: "batch-cv-1",
        entries: retryWithFewer,
      })).toThrow(CanonFactConflict);
    });

    it("retry with same count but different entry ids throws CanonFactConflict", () => {
      const store = new InMemoryCanonFactStore();
      const originalBatch = [
        { ...makePartialEntry("b1", "c1"), commitBatchId: undefined },
        { ...makePartialEntry("b2", "c2"), commitBatchId: undefined },
      ];

      store.appendBatch({
        projectId: PROJECT, expectedSequence: 1, commitBatchId: "batch-cv-2",
        entries: originalBatch,
      });

      const retryWithDifferentIds = [
        { ...makePartialEntry("b1", "c1"), commitBatchId: undefined },
        { ...makePartialEntry("DIFFERENT", "c2"), commitBatchId: undefined },
      ];
      expect(() => store.appendBatch({
        projectId: PROJECT, expectedSequence: 1, commitBatchId: "batch-cv-2",
        entries: retryWithDifferentIds,
      })).toThrow(CanonFactConflict);
    });

    it("retry with identical content returns existing facts", () => {
      const store = new InMemoryCanonFactStore();
      const batch = [
        { ...makePartialEntry("b1", "c1"), commitBatchId: undefined },
        { ...makePartialEntry("b2", "c2"), commitBatchId: undefined },
      ];

      const result1 = store.appendBatch({
        projectId: PROJECT, expectedSequence: 1, commitBatchId: "batch-cv-3",
        entries: batch,
      });

      const result2 = store.appendBatch({
        projectId: PROJECT, expectedSequence: 99, commitBatchId: "batch-cv-3",
        entries: batch,
      });

      expect(result2).toEqual(result1);
      expect(store.list(PROJECT)).toHaveLength(2);
    });

    it("retry with reordered entries throws CanonFactConflict", () => {
      const store = new InMemoryCanonFactStore();
      const originalBatch = [
        { ...makePartialEntry("b1", "c1"), commitBatchId: undefined },
        { ...makePartialEntry("b2", "c2"), commitBatchId: undefined },
      ];

      store.appendBatch({
        projectId: PROJECT, expectedSequence: 1, commitBatchId: "batch-cv-4",
        entries: originalBatch,
      });

      const reordered = [
        { ...makePartialEntry("b2", "c2"), commitBatchId: undefined },
        { ...makePartialEntry("b1", "c1"), commitBatchId: undefined },
      ];
      expect(() => store.appendBatch({
        projectId: PROJECT, expectedSequence: 1, commitBatchId: "batch-cv-4",
        entries: reordered,
      })).toThrow(CanonFactConflict);
    });
  });
});