import { describe, it, expect } from "vitest";
import {
  sha256Hex,
  stableStringify,
  computeSourceHash,

  computeEntryId,
} from "@/lib/domain/canonFactIdentity";
import {
  verifyEvidenceInScene,
  computeEvidencePosition,
  type EvidenceLocator,
} from "@/lib/domain/evidenceVerification";
import {
  classifyAssertion,
  inferNarrativeModeFromHeading,

} from "@/lib/domain/assertionClassification";
import {
  reconcileBatch,
  type PreparedFact,
} from "@/lib/domain/canonReconciliation";
import type { ScreenplayScene } from "@/lib/validation/story";
import type { CanonEntity } from "@/lib/validation/narrativeControl";
import { emptyDerivedCanonState } from "@/lib/canon/schema";
import { reduceCanon } from "@/lib/canon/reduce";

function makeScene(overrides: Partial<ScreenplayScene> = {}): ScreenplayScene {
  return {
    sceneNumber: 1,
    heading: "INT. LIVING ROOM - DAY",
    location: "Living Room",
    timeOfDay: "Day",
    charactersPresent: ["ALICE"],
    visualDescription: "Alice sits on the couch.",
    action: "Alice picks up a photo.",
    dialogue: [{ characterName: "ALICE", line: "I remember this day." }],
    ...overrides,
  };
}

function makeEntity(id: string): CanonEntity {
  return {
    id,
    kind: "character",
    name: id,
    aliases: [],
    description: "",
    role: "",
    motivations: [],
    goals: [],
    firstIntroductionEpisode: 1,
    firstAppearanceEpisode: 1,
    appearances: [1],
    lifecycle: "active",
    arc: "",
    secrets: [],
    permitsNonlivingAppearance: false,
    endedEpisode: null,
    ownerId: null,
    locationId: null,
    properties: [],
    significance: "",
    transfers: [],
    modifications: [],
    locationRules: [],
  };
}

function makeEvidence(overrides: Partial<PreparedFact["evidence"]> = {}): PreparedFact["evidence"] {
  return {
    quote: "Alice picks up a photo.",
    sceneNumber: 1,
    episode: 1,
    episodeId: "ep-1",
    storyId: "story-1",
    storyVersion: 1,
    sourceHash: "sha256:abc",
    ...overrides,
  };
}

function makePreparedFact(overrides: Partial<PreparedFact> = {}): PreparedFact {
  return {
    id: "fact-1",
    episode: 1,
    sourceStoryId: "story-1",
    kind: "entity",
    targetId: "c-alice",
    payload: makeEntity("c-alice"),
    evidence: makeEvidence(),
    narrativeMode: "present",
    assertionKind: "event",
    factualStatus: "established",
    asserterId: null,
    reason: "extraction",
    extractor: "test",
    evidencePosition: 1_000_000,
    sceneNumber: 1,
    ...overrides,
  };
}

describe("canonFactIdentity", () => {
  describe("stableStringify", () => {
    it("produces identical output for objects with keys in different order", () => {
      const a = { x: 1, y: 2, z: 3 };
      const b = { z: 3, y: 2, x: 1 };
      expect(stableStringify(a)).toBe(stableStringify(b));
    });

    it("handles nested objects", () => {
      const a = { outer: { c: 3, a: 1, b: 2 } };
      const b = { outer: { b: 2, a: 1, c: 3 } };
      expect(stableStringify(a)).toBe(stableStringify(b));
    });

    it("handles arrays (order preserved)", () => {
      expect(stableStringify([3, 1, 2])).toBe(stableStringify([3, 1, 2]));
      expect(stableStringify([3, 1, 2])).not.toBe(stableStringify([1, 2, 3]));
    });

    it("handles null and primitives", () => {
      expect(stableStringify(null)).toBe("null");
      expect(stableStringify(42)).toBe("42");
      expect(stableStringify("hi")).toBe('"hi"');
    });
  });

  describe("sha256Hex", () => {
    it("returns 64-character hex string", () => {
      const hash = sha256Hex("test");
      expect(hash).toMatch(/^[a-f\d]{64}$/);
    });

    it("is deterministic", () => {
      expect(sha256Hex("test")).toBe(sha256Hex("test"));
    });

    it("differs for different inputs", () => {
      expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
    });
  });

  describe("computeSourceHash", () => {
    it("is deterministic for same screenplay", () => {
      const screenplay = [makeScene()];
      expect(computeSourceHash(screenplay)).toBe(computeSourceHash(screenplay));
    });

    it("differs for different screenplays", () => {
      const a = [makeScene()];
      const b = [makeScene({ heading: "EXT. GARDEN - NIGHT" })];
      expect(computeSourceHash(a)).not.toBe(computeSourceHash(b));
    });
  });

  describe("computeEntryId", () => {
    it("is deterministic for same inputs", () => {
      const evidence = makeEvidence();
      const payload = makeEntity("c-1");
      const id1 = computeEntryId({
        episodeNumber: 1,
        sceneNumber: 1,
        kind: "entity",
        targetId: "c-1",
        payload,
        evidence,
      });
      const id2 = computeEntryId({
        episodeNumber: 1,
        sceneNumber: 1,
        kind: "entity",
        targetId: "c-1",
        payload,
        evidence,
      });
      expect(id1).toBe(id2);
    });

    it("differs for different targetId", () => {
      const evidence = makeEvidence();
      const payload = makeEntity("c-1");
      const id1 = computeEntryId({
        episodeNumber: 1,
        sceneNumber: 1,
        kind: "entity",
        targetId: "c-1",
        payload,
        evidence,
      });
      const id2 = computeEntryId({
        episodeNumber: 1,
        sceneNumber: 1,
        kind: "entity",
        targetId: "c-2",
        payload,
        evidence,
      });
      expect(id1).not.toBe(id2);
    });

    it("differs for different episode", () => {
      const evidence = makeEvidence();
      const payload = makeEntity("c-1");
      const id1 = computeEntryId({
        episodeNumber: 1,
        sceneNumber: 1,
        kind: "entity",
        targetId: "c-1",
        payload,
        evidence,
      });
      const id2 = computeEntryId({
        episodeNumber: 2,
        sceneNumber: 1,
        kind: "entity",
        targetId: "c-1",
        payload,
        evidence,
      });
      expect(id1).not.toBe(id2);
    });

    it("is stable across payload key reorderings", () => {
      const evidence = makeEvidence();
      const payloadA = makeEntity("c-1");
      const payloadB: CanonEntity = {
        ...payloadA,
        aliases: [],
        description: "",
        role: "",
        motivations: [],
        goals: [],
      };
      const id1 = computeEntryId({
        episodeNumber: 1,
        sceneNumber: 1,
        kind: "entity",
        targetId: "c-1",
        payload: payloadA,
        evidence,
      });
      const id2 = computeEntryId({
        episodeNumber: 1,
        sceneNumber: 1,
        kind: "entity",
        targetId: "c-1",
        payload: payloadB,
        evidence,
      });
      expect(id1).toBe(id2);
    });

    it("does not include storyVersion in the hash", () => {
      const evidenceV1 = makeEvidence({ storyVersion: 1 });
      const evidenceV2 = makeEvidence({ storyVersion: 2 });
      const payload = makeEntity("c-1");
      const id1 = computeEntryId({
        episodeNumber: 1,
        sceneNumber: 1,
        kind: "entity",
        targetId: "c-1",
        payload,
        evidence: evidenceV1,
      });
      const id2 = computeEntryId({
        episodeNumber: 1,
        sceneNumber: 1,
        kind: "entity",
        targetId: "c-1",
        payload,
        evidence: evidenceV2,
      });
      expect(id1).toBe(id2);
    });
  });
});

describe("evidenceVerification", () => {
  describe("computeEvidencePosition", () => {
    it("produces deterministic ordering", () => {
      const a: EvidenceLocator = {
        sceneNumber: 1,
        elementType: "heading",
        elementIndex: 0,
        charStart: 0,
        charEnd: 10,
      };
      const b: EvidenceLocator = {
        sceneNumber: 1,
        elementType: "action",
        elementIndex: 0,
        charStart: 0,
        charEnd: 10,
      };
      expect(computeEvidencePosition(a)).toBeLessThan(computeEvidencePosition(b));
    });

    it("scene 2 positions are greater than scene 1", () => {
      const s1: EvidenceLocator = {
        sceneNumber: 1,
        elementType: "dialogue",
        elementIndex: 19,
        charStart: 999,
        charEnd: 1000,
      };
      const s2: EvidenceLocator = {
        sceneNumber: 2,
        elementType: "heading",
        elementIndex: 0,
        charStart: 0,
        charEnd: 10,
      };
      expect(computeEvidencePosition(s1)).toBeLessThan(computeEvidencePosition(s2));
    });
  });

  describe("verifyEvidenceInScene", () => {
    it("finds quote in heading", () => {
      const scene = makeScene();
      const result = verifyEvidenceInScene(scene, "INT. LIVING ROOM - DAY");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.locator.elementType).toBe("heading");
        expect(result.locator.elementIndex).toBe(0);
      }
    });

    it("finds quote in action", () => {
      const scene = makeScene();
      const result = verifyEvidenceInScene(scene, "Alice picks up a photo.");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.locator.elementType).toBe("action");
      }
    });

    it("finds quote in dialogue", () => {
      const scene = makeScene();
      const result = verifyEvidenceInScene(scene, "I remember this day.");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.locator.elementType).toBe("dialogue");
        expect(result.locator.elementIndex).toBe(0);
      }
    });

    it("finds quote in visualDescription", () => {
      const scene = makeScene();
      const result = verifyEvidenceInScene(scene, "Alice sits on the couch.");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.locator.elementType).toBe("visualDescription");
      }
    });

    it("returns quote_not_found when quote is absent", () => {
      const scene = makeScene();
      const result = verifyEvidenceInScene(scene, "This text does not appear.");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("quote_not_found");
      }
    });

    it("returns quote_ambiguous when quote appears multiple times", () => {
      const scene = makeScene({
        action: "Alice picks up a photo. Then Alice picks up a photo. again.",
        visualDescription: "Alice picks up a photo. is shown.",
      });
      const result = verifyEvidenceInScene(scene, "Alice picks up a photo.");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("quote_ambiguous");
        expect(result.occurrences.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("finds quote in second dialogue line", () => {
      const scene = makeScene({
        dialogue: [
          { characterName: "ALICE", line: "Hello." },
          { characterName: "BOB", line: "Goodbye." },
        ],
      });
      const result = verifyEvidenceInScene(scene, "Goodbye.");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.locator.elementType).toBe("dialogue");
        expect(result.locator.elementIndex).toBe(1);
      }
    });
  });
});

describe("assertionClassification", () => {
  describe("inferNarrativeModeFromHeading", () => {
    it("detects flashback", () => {
      expect(inferNarrativeModeFromHeading("FLASHBACK - 1999")).toBe("flashback");
    });

    it("detects dream", () => {
      expect(inferNarrativeModeFromHeading("DREAM SEQUENCE")).toBe("dream");
    });

    it("detects vision", () => {
      expect(inferNarrativeModeFromHeading("VISION OF THE FUTURE")).toBe("vision");
    });

    it("returns null for normal heading", () => {
      expect(inferNarrativeModeFromHeading("INT. LIVING ROOM - DAY")).toBeNull();
    });
  });

  describe("classifyAssertion", () => {
    it("dialogue → character_statement + not_established (always)", () => {
      const result = classifyAssertion({
        elementType: "dialogue",
        narrativeMode: "present",
        eventType: "concrete",
      });
      expect(result.assertionKind).toBe("character_statement");
      expect(result.factualStatus).toBe("not_established");
      expect(result.issue).toBeUndefined();
    });

    it("dialogue → character_statement + not_established even in flashback", () => {
      const result = classifyAssertion({
        elementType: "dialogue",
        narrativeMode: "flashback",
        eventType: "concrete",
      });
      expect(result.assertionKind).toBe("character_statement");
      expect(result.factualStatus).toBe("not_established");
    });

    it("concrete + present → event + established", () => {
      const result = classifyAssertion({
        elementType: "action",
        narrativeMode: "present",
        eventType: "concrete",
      });
      expect(result.assertionKind).toBe("event");
      expect(result.factualStatus).toBe("established");
      expect(result.issue).toBeUndefined();
    });

    it("concrete + flashback → event + established", () => {
      const result = classifyAssertion({
        elementType: "action",
        narrativeMode: "flashback",
        eventType: "concrete",
      });
      expect(result.assertionKind).toBe("event");
      expect(result.factualStatus).toBe("established");
    });

    it("perceptual → character_experience + not_established", () => {
      const result = classifyAssertion({
        elementType: "action",
        narrativeMode: "present",
        eventType: "perceptual",
      });
      expect(result.assertionKind).toBe("character_experience");
      expect(result.factualStatus).toBe("not_established");
      expect(result.issue).toBeUndefined();
    });

    it("ambiguous event type → character_experience + not_established + issue", () => {
      const result = classifyAssertion({
        elementType: "action",
        narrativeMode: "present",
        eventType: "ambiguous",
      });
      expect(result.assertionKind).toBe("character_experience");
      expect(result.factualStatus).toBe("not_established");
      expect(result.issue).toBeDefined();
      expect(result.issue!.code).toBe("ambiguous_event_type");
    });

    it("missing eventType defaults to ambiguous", () => {
      const result = classifyAssertion({
        elementType: "action",
        narrativeMode: "present",
      });
      expect(result.assertionKind).toBe("character_experience");
      expect(result.factualStatus).toBe("not_established");
      expect(result.issue).toBeDefined();
    });

    it("dream mode → character_experience + not_established + issue", () => {
      const result = classifyAssertion({
        elementType: "action",
        narrativeMode: "dream",
        eventType: "concrete",
      });
      expect(result.assertionKind).toBe("character_experience");
      expect(result.factualStatus).toBe("not_established");
      expect(result.issue).toBeDefined();
      expect(result.issue!.code).toBe("ambiguous_narrative_mode");
    });

    it("vision mode → character_experience + not_established + issue", () => {
      const result = classifyAssertion({
        elementType: "visualDescription",
        narrativeMode: "vision",
        eventType: "concrete",
      });
      expect(result.factualStatus).toBe("not_established");
      expect(result.issue!.code).toBe("ambiguous_narrative_mode");
    });

    it("lie mode → character_experience + not_established + issue", () => {
      const result = classifyAssertion({
        elementType: "action",
        narrativeMode: "lie",
        eventType: "concrete",
      });
      expect(result.factualStatus).toBe("not_established");
      expect(result.issue!.code).toBe("ambiguous_narrative_mode");
    });
  });
});

describe("canonReconciliation", () => {
  const PROJECT = "proj-1";

  it("empty facts → empty committed and empty issues", () => {
    const result = reconcileBatch({
      projectId: PROJECT,
      baseState: emptyDerivedCanonState(PROJECT),
      facts: [],
    });
    expect(result.committed).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
  });

  it("new entity → add operation", () => {
    const fact = makePreparedFact();
    const result = reconcileBatch({
      projectId: PROJECT,
      baseState: emptyDerivedCanonState(PROJECT),
      facts: [fact],
    });
    expect(result.committed).toHaveLength(1);
    expect(result.committed[0]!.operation).toBe("add");
    expect(result.issues).toHaveLength(0);
  });

  it("existing entity → modify operation", () => {
    const baseState = reduceCanon(PROJECT, [
      {
        id: "fact-1",
        sequence: 1,
        projectId: PROJECT,
        episode: 1,
        sourceStoryId: "story-1",
        operation: "add",
        kind: "entity",
        targetId: "c-alice",
        payload: makeEntity("c-alice"),
        newClassification: null,
        evidence: makeEvidence(),
        narrativeMode: "present",
        assertionKind: "event",
        factualStatus: "established",
        asserterId: null,
        commitBatchId: null,
        reason: "seed",
        extractor: "test",
        createdAt: new Date(),
      },
    ]);

    const fact = makePreparedFact({
      payload: { ...makeEntity("c-alice"), lifecycle: "deceased", endedEpisode: 1 },
    });
    const result = reconcileBatch({
      projectId: PROJECT,
      baseState,
      facts: [fact],
    });
    expect(result.committed).toHaveLength(1);
    expect(result.committed[0]!.operation).toBe("modify");
    expect(result.issues).toHaveLength(0);
  });

  it("duplicate add → issue (strict mode)", () => {
    const baseState = reduceCanon(PROJECT, [
      {
        id: "seed-1",
        sequence: 1,
        projectId: PROJECT,
        episode: 1,
        sourceStoryId: "story-1",
        operation: "add",
        kind: "entity",
        targetId: "c-alice",
        payload: makeEntity("c-alice"),
        newClassification: null,
        evidence: makeEvidence(),
        narrativeMode: "present",
        assertionKind: "event",
        factualStatus: "established",
        asserterId: null,
        commitBatchId: null,
        reason: "seed",
        extractor: "test",
        createdAt: new Date(),
      },
    ]);

    const fact = makePreparedFact({
      id: "fact-dup",
      payload: makeEntity("c-alice"),
    });
    const result = reconcileBatch({
      projectId: PROJECT,
      baseState,
      facts: [fact],
    });
    expect(result.committed).toHaveLength(1);
    expect(result.committed[0]!.operation).toBe("modify");
  });

  it("facts sorted by (sceneNumber, evidencePosition, targetId)", () => {
    const facts = [
      makePreparedFact({
        id: "f-b",
        targetId: "c-b",
        sceneNumber: 1,
        evidencePosition: 2_000_000,
      }),
      makePreparedFact({
        id: "f-a",
        targetId: "c-a",
        sceneNumber: 1,
        evidencePosition: 1_000_000,
      }),
      makePreparedFact({
        id: "f-c",
        targetId: "c-c",
        sceneNumber: 2,
        evidencePosition: 1_000_000,
      }),
    ];
    const result = reconcileBatch({
      projectId: PROJECT,
      baseState: emptyDerivedCanonState(PROJECT),
      facts,
    });
    expect(result.committed.map((f) => f.id)).toEqual(["f-a", "f-b", "f-c"]);
  });

  it("failed fact does not update working state", () => {
    const fact1 = makePreparedFact({
      id: "f-ok",
      targetId: "c-alice",
      kind: "entity",
      payload: makeEntity("c-alice"),
    });
    const fact2 = makePreparedFact({
      id: "f-bad",
      targetId: "c-bob",
      kind: "entity",
      payload: makeEntity("c-bob"),
      sceneNumber: 1,
      evidencePosition: 1_500_000,
    });

    const result = reconcileBatch({
      projectId: PROJECT,
      baseState: emptyDerivedCanonState(PROJECT),
      facts: [fact1, fact2],
    });
    expect(result.committed).toHaveLength(2);
    expect(result.issues).toHaveLength(0);
  });

  it("not_established facts are subjective and do not conflict", () => {
    const fact1 = makePreparedFact({
      id: "f-sub1",
      targetId: "c-alice",
      factualStatus: "not_established",
      assertionKind: "character_belief",
      narrativeMode: "speculation",
    });
    const fact2 = makePreparedFact({
      id: "f-sub2",
      targetId: "c-alice",
      factualStatus: "not_established",
      assertionKind: "character_belief",
      narrativeMode: "speculation",
      evidencePosition: 1_500_000,
    });

    const result = reconcileBatch({
      projectId: PROJECT,
      baseState: emptyDerivedCanonState(PROJECT),
      facts: [fact1, fact2],
    });
    expect(result.committed).toHaveLength(2);
    expect(result.issues).toHaveLength(0);
  });
});