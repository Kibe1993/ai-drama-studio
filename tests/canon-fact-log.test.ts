import { describe, it, expect } from "vitest";
import {
  reduceCanon,
  reduceCanonIncremental,
  ReduceError,
  defaultFactualStatus,
  emptyDerivedCanonState,
  canonFactEntrySchema,
  type CanonFactEntry,
} from "@/lib/canon";
import type {
  CanonEntity,
  CanonRelationship,
  CanonEvent,
  CanonThread,
  NarrativeFact,
  KnowledgeEntry,
  WorldRule,
} from "@/lib/validation/narrativeControl";

const PROJECT = "proj-1";
const EXTRACTOR = "test-extractor";

function makeEntity(overrides: Partial<CanonEntity> & { id: string }): CanonEntity {
  return {
    kind: "character", name: "Alice", aliases: [], description: "The protagonist.",
    role: "protagonist", motivations: [], goals: [],
    firstIntroductionEpisode: 1, firstAppearanceEpisode: 1, appearances: [1],
    lifecycle: "active", arc: "", secrets: [], permitsNonlivingAppearance: false,
    endedEpisode: null, ownerId: null, locationId: null, properties: [], significance: "",
    transfers: [], modifications: [], locationRules: [],
    ...overrides,
  };
}

function makeFact(overrides: Partial<NarrativeFact> & { id: string }): NarrativeFact {
  return {
    key: "fact-key", statement: "A fact.", classification: "ESTABLISHED_CANON",
    protected: false, subjectEntityIds: [], value: "", rolePhrase: "",
    literalKind: "none", audienceRevealEpisode: null,
    certainPatterns: [], suspectedPatterns: [], forbiddenLiterals: [],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CanonEvent> & { id: string }): CanonEvent {
  return {
    description: "An event occurs.", participantIds: [], locationId: null,
    episode: 1, presentationEpisode: null, audienceEpisode: null,
    preconditions: [], triggers: [], consequences: [], causedBy: [],
    acknowledgement: "optional", contradictoryWith: [], requiresCause: false,
    ...overrides,
  };
}

function makeThread(overrides: Partial<CanonThread> & { id: string }): CanonThread {
  return {
    description: "An open question.", category: "mystery", status: "introduced",
    scope: "central", introducedEpisode: 1, setupEpisodes: [], developmentEpisodes: [],
    payoffEpisodes: [], intendedResolution: "", intendedSeason: null,
    carryForward: false, explanation: "", subjectEntityIds: [],
    ...overrides,
  };
}

function makeRelationship(overrides: Partial<CanonRelationship> & { id: string }): CanonRelationship {
  return {
    characterIds: ["char-1", "char-2"], relationshipType: "allies",
    initialState: "", currentState: "", introducedEpisode: 1, historical: false, changes: [],
    ...overrides,
  };
}

function makeKnowledge(overrides: Partial<KnowledgeEntry> & { id: string }): KnowledgeEntry {
  return {
    characterId: "char-1", factId: "fact-1", knownFromEpisode: 1,
    learnedVia: "", believes: true, certainty: "certain", supportingEventId: null,
    ...overrides,
  };
}

function makeRule(overrides: Partial<WorldRule> & { id: string }): WorldRule {
  return {
    description: "A world rule.", scope: "story", conditions: [], exceptions: [],
    establishedRef: "", approvalStatus: "approved", violationPatterns: [], canonicalInterval: null,
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<NonNullable<CanonFactEntry["evidence"]>> = {}): NonNullable<CanonFactEntry["evidence"]> {
  return {
    quote: "Alice dies.", sceneNumber: 3, episode: 2,
    episodeId: "ep-1", storyId: "story-1", storyVersion: 1, sourceHash: "sha256:abc123",
    ...overrides,
  };
}

function makeEntry(overrides: Partial<CanonFactEntry> & {
  id: string; sequence: number; kind: CanonFactEntry["kind"];
  operation: CanonFactEntry["operation"]; targetId: string; payload: unknown;
}): CanonFactEntry {
  return {
    projectId: PROJECT, episode: 1, sourceStoryId: "story-1", newClassification: null,
    evidence: makeEvidence(), narrativeMode: "present", assertionKind: "event",
    factualStatus: "established", asserterId: null, commitBatchId: null, reason: "test",
    extractor: EXTRACTOR, createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeSeedEntry(overrides: Partial<CanonFactEntry> & {
  id: string; sequence: number; kind: CanonFactEntry["kind"];
  operation: CanonFactEntry["operation"]; targetId: string; payload: unknown;
}): CanonFactEntry {
  return makeEntry({ episode: 0, sourceStoryId: null, evidence: null, ...overrides });
}

describe("Canon Fact Log — reduceCanon", () => {
  describe("empty log", () => {
    it("produces an empty state", () => {
      const state = reduceCanon(PROJECT, []);
      expect(state.entities).toEqual([]);
      expect(state.facts).toEqual([]);
      expect(state.subjective).toEqual([]);
      expect(state.sequence).toBe(0);
      expect(state.factCount).toBe(0);
    });

    it("emptyDerivedCanonState matches reduceCanon of empty", () => {
      expect(emptyDerivedCanonState(PROJECT)).toEqual(reduceCanon(PROJECT, []));
    });
  });

  describe("character death persists", () => {
    it("records deceased and the death survives subsequent episodes", () => {
      const state = reduceCanon(PROJECT, [
        makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "c-a", episode: 1, payload: makeEntity({ id: "c-a", lifecycle: "active" }) }),
        makeEntry({ id: "e2", sequence: 2, kind: "entity", operation: "modify", targetId: "c-a", episode: 3, payload: makeEntity({ id: "c-a", lifecycle: "deceased", endedEpisode: 3 }), evidence: makeEvidence({ quote: "Alice falls lifeless.", episode: 3, sceneNumber: 5 }) }),
        makeEntry({ id: "e3", sequence: 3, kind: "entity", operation: "add", targetId: "c-b", episode: 4, payload: makeEntity({ id: "c-b", name: "Bob" }) }),
      ]);
      const alice = state.entities.find((e) => e.id === "c-a");
      expect(alice!.lifecycle).toBe("deceased");
      expect(alice!.endedEpisode).toBe(3);
    });
  });

  describe("object transfer is tracked", () => {
    it("records transfer and new owner is reflected", () => {
      const state = reduceCanon(PROJECT, [
        makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "o-r", episode: 1, payload: makeEntity({ id: "o-r", kind: "object", name: "Relic", ownerId: "c-a" }) }),
        makeEntry({ id: "e2", sequence: 2, kind: "entity", operation: "modify", targetId: "o-r", episode: 2, payload: makeEntity({ id: "o-r", kind: "object", name: "Relic", ownerId: "c-b", transfers: [{ episode: 2, fromOwnerId: "c-a", toOwnerId: "c-b", eventId: "evt" }] }), evidence: makeEvidence({ quote: "Bob takes the relic.", episode: 2 }) }),
      ]);
      expect(state.entities[0]!.ownerId).toBe("c-b");
      expect(state.entities[0]!.transfers[0]!.toOwnerId).toBe("c-b");
    });
  });

  describe("location destruction is recorded", () => {
    it("records destroyed location and it persists", () => {
      const state = reduceCanon(PROJECT, [
        makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "l-h", episode: 1, payload: makeEntity({ id: "l-h", kind: "location", name: "House", lifecycle: "active" }) }),
        makeEntry({ id: "e2", sequence: 2, kind: "entity", operation: "modify", targetId: "l-h", episode: 3, payload: makeEntity({ id: "l-h", kind: "location", name: "House", lifecycle: "departed", endedEpisode: 3 }), evidence: makeEvidence({ quote: "The house burns.", episode: 3 }) }),
      ]);
      expect(state.entities[0]!.lifecycle).toBe("departed");
    });
  });

  describe("hidden truth with reveal episode", () => {
    it("stores hidden truth with audienceRevealEpisode", () => {
      const state = reduceCanon(PROJECT, [
        makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f-s", episode: 1, payload: makeFact({ id: "f-s", classification: "HIDDEN_TRUTH", protected: true, audienceRevealEpisode: 5, statement: "Alice is a spy." }), evidence: makeEvidence({ quote: "Alice checks her badge.", episode: 1 }) }),
      ]);
      expect(state.facts[0]!.classification).toBe("HIDDEN_TRUTH");
      expect(state.facts[0]!.audienceRevealEpisode).toBe(5);
    });
  });

  describe("retraction removes fact from active state", () => {
    it("retracts a fact", () => {
      const state = reduceCanon(PROJECT, [
        makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f-w", payload: makeFact({ id: "f-w" }) }),
        makeEntry({ id: "e2", sequence: 2, kind: "fact", operation: "retract", targetId: "f-w", episode: 2, payload: null }),
      ]);
      expect(state.facts).toHaveLength(0);
      expect(state.retracted).toContain("f-w");
    });
  });

  describe("modification updates entity", () => {
    it("modifies an entity", () => {
      const state = reduceCanon(PROJECT, [
        makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "c-a", payload: makeEntity({ id: "c-a", description: "Young." }) }),
        makeEntry({ id: "e2", sequence: 2, kind: "entity", operation: "modify", targetId: "c-a", episode: 3, payload: makeEntity({ id: "c-a", description: "Hardened.", motivations: ["Truth"] }) }),
      ]);
      expect(state.entities[0]!.description).toBe("Hardened.");
    });
  });

  describe("reinterpretation changes classification", () => {
    it("reinterprets provisional as established", () => {
      const state = reduceCanon(PROJECT, [
        makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f-m", payload: makeFact({ id: "f-m", classification: "PROVISIONAL" }) }),
        makeEntry({ id: "e2", sequence: 2, kind: "fact", operation: "reinterpret", targetId: "f-m", episode: 3, payload: null, newClassification: "ESTABLISHED_CANON" }),
      ]);
      expect(state.facts[0]!.classification).toBe("ESTABLISHED_CANON");
    });
  });

  describe("determinism", () => {
    it("same input → same output", () => {
      const e = [makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "c1", payload: makeEntity({ id: "c1" }) })];
      expect(reduceCanon(PROJECT, e)).toEqual(reduceCanon(PROJECT, e));
    });
    it("different input order → same output", () => {
      const e1 = makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "c1", payload: makeEntity({ id: "c1" }) });
      const e2 = makeEntry({ id: "e2", sequence: 2, kind: "fact", operation: "add", targetId: "f1", payload: makeFact({ id: "f1" }) });
      expect(reduceCanon(PROJECT, [e1, e2])).toEqual(reduceCanon(PROJECT, [e2, e1]));
    });
  });

  describe("sequence ordering", () => {
    it("processes by sequence, not input order", () => {
      const state = reduceCanon(PROJECT, [
        makeEntry({ id: "e2", sequence: 2, kind: "entity", operation: "modify", targetId: "c1", episode: 2, payload: makeEntity({ id: "c1", name: "Updated" }) }),
        makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "c1", episode: 1, payload: makeEntity({ id: "c1", name: "Original" }) }),
      ]);
      expect(state.entities[0]!.name).toBe("Updated");
    });
  });

  describe("idempotency", () => {
    it("duplicate entries (same id) applied once", () => {
      const base = makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "c1", payload: makeEntity({ id: "c1" }) });
      const state = reduceCanon(PROJECT, [base, { ...base }]);
      expect(state.entities).toHaveLength(1);
      expect(state.factCount).toBe(1);
    });
  });

  describe("seed facts (episode 0)", () => {
    it("episode 0 facts do not require evidence", () => {
      const state = reduceCanon(PROJECT, [
        makeSeedEntry({ id: "s1", sequence: 1, kind: "fact", operation: "add", targetId: "f-b", payload: makeFact({ id: "f-b", classification: "AUTHOR_TRUTH", statement: "Post-apocalyptic." }) }),
      ]);
      expect(state.facts[0]!.classification).toBe("AUTHOR_TRUTH");
    });
  });

  describe("multiple kinds coexist", () => {
    it("all 7 kinds in one log", () => {
      const state = reduceCanon(PROJECT, [
        makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "c1", payload: makeEntity({ id: "c1" }) }),
        makeEntry({ id: "e2", sequence: 2, kind: "relationship", operation: "add", targetId: "r1", payload: makeRelationship({ id: "r1" }) }),
        makeEntry({ id: "e3", sequence: 3, kind: "event", operation: "add", targetId: "ev1", payload: makeEvent({ id: "ev1" }) }),
        makeEntry({ id: "e4", sequence: 4, kind: "thread", operation: "add", targetId: "t1", payload: makeThread({ id: "t1" }) }),
        makeEntry({ id: "e5", sequence: 5, kind: "fact", operation: "add", targetId: "f1", payload: makeFact({ id: "f1" }) }),
        makeEntry({ id: "e6", sequence: 6, kind: "knowledge", operation: "add", targetId: "k1", payload: makeKnowledge({ id: "k1" }) }),
        makeEntry({ id: "e7", sequence: 7, kind: "rule", operation: "add", targetId: "ru1", payload: makeRule({ id: "ru1" }) }),
      ]);
      expect(state.entities).toHaveLength(1);
      expect(state.relationships).toHaveLength(1);
      expect(state.events).toHaveLength(1);
      expect(state.threads).toHaveLength(1);
      expect(state.facts).toHaveLength(1);
      expect(state.knowledge).toHaveLength(1);
      expect(state.rules).toHaveLength(1);
    });
  });

  describe("project filtering", () => {
    it("entries from other projects ignored", () => {
      const state = reduceCanon(PROJECT, [
        makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "c1", projectId: PROJECT, payload: makeEntity({ id: "c1" }) }),
        makeEntry({ id: "e2", sequence: 2, kind: "entity", operation: "add", targetId: "c2", projectId: "other", payload: makeEntity({ id: "c2" }) }),
      ]);
      expect(state.entities).toHaveLength(1);
    });
  });

  describe("incremental reduction", () => {
    it("applies only new entries", () => {
      const base = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "c1", payload: makeEntity({ id: "c1", name: "Alice" }) })]);
      const state = reduceCanonIncremental(base, [
        makeEntry({ id: "e2", sequence: 2, kind: "entity", operation: "modify", targetId: "c1", episode: 2, payload: makeEntity({ id: "c1", name: "Updated" }) }),
        makeEntry({ id: "e3", sequence: 3, kind: "fact", operation: "add", targetId: "f1", episode: 2, payload: makeFact({ id: "f1" }) }),
      ]);
      expect(state.entities[0]!.name).toBe("Updated");
      expect(state.facts).toHaveLength(1);
    });

    it("matches full reduction", () => {
      const baseE = [makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "c1", payload: makeEntity({ id: "c1" }) })];
      const newE = [makeEntry({ id: "e2", sequence: 2, kind: "entity", operation: "add", targetId: "c2", payload: makeEntity({ id: "c2" }) })];
      expect(reduceCanonIncremental(reduceCanon(PROJECT, baseE), newE)).toEqual(reduceCanon(PROJECT, [...baseE, ...newE]));
    });
  });

  describe("asOfEpisode tracking", () => {
    it("tracks highest episode", () => {
      const state = reduceCanon(PROJECT, [
        makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f1", episode: 1, payload: makeFact({ id: "f1" }) }),
        makeEntry({ id: "e2", sequence: 2, kind: "fact", operation: "add", targetId: "f2", episode: 5, payload: makeFact({ id: "f2" }) }),
      ]);
      expect(state.asOfEpisode).toBe(5);
    });
  });
});

describe("Narrative mode / assertion / factual status separation", () => {
  describe("defaultFactualStatus", () => {
    it("present and flashback default to established", () => {
      expect(defaultFactualStatus("present")).toBe("established");
      expect(defaultFactualStatus("flashback")).toBe("established");
    });
    it("dream, vision, speculation, lie default to not_established", () => {
      expect(defaultFactualStatus("dream")).toBe("not_established");
      expect(defaultFactualStatus("vision")).toBe("not_established");
      expect(defaultFactualStatus("speculation")).toBe("not_established");
      expect(defaultFactualStatus("lie")).toBe("not_established");
    });
  });

  describe("present + established → objective reality", () => {
    it("establishes content", () => {
      const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f1", narrativeMode: "present", factualStatus: "established", payload: makeFact({ id: "f1" }) })]);
      expect(state.facts).toHaveLength(1);
      expect(state.subjective).toHaveLength(0);
    });
  });

  describe("flashback + established → historical objective reality", () => {
    it("establishes historical events", () => {
      const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f1", episode: 3, narrativeMode: "flashback", factualStatus: "established", payload: makeFact({ id: "f1", statement: "Alice met Bob." }), evidence: makeEvidence({ episode: 3, quote: "FLASHBACK: handshake." }) })]);
      expect(state.facts).toHaveLength(1);
      expect(state.subjective).toHaveLength(0);
    });
  });

  describe("lie — content NOT established, statement event IS", () => {
    it("lie content does NOT enter objective reality", () => {
      const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f-lie", episode: 2, narrativeMode: "lie", assertionKind: "character_statement", factualStatus: "not_established", payload: makeFact({ id: "f-lie", statement: "Alice was at home." }), evidence: makeEvidence({ episode: 2, quote: "Alice: I was home." }) })]);
      expect(state.facts).toHaveLength(0);
      expect(state.subjective).toHaveLength(1);
      expect(state.subjective[0]!.assertionKind).toBe("character_statement");
      expect(state.subjective[0]!.narrativeMode).toBe("lie");
    });

    it("the act of lying IS established as an event", () => {
      const state = reduceCanon(PROJECT, [
        makeEntry({ id: "e1", sequence: 1, kind: "event", operation: "add", targetId: "ev-lie", episode: 2, narrativeMode: "present", factualStatus: "established", payload: makeEvent({ id: "ev-lie", description: "Alice claims she was home.", episode: 2 }), evidence: makeEvidence({ episode: 2, quote: "Alice: I was home." }) }),
        makeEntry({ id: "e2", sequence: 2, kind: "fact", operation: "add", targetId: "f-lie", episode: 2, narrativeMode: "lie", assertionKind: "character_statement", factualStatus: "not_established", payload: makeFact({ id: "f-lie", statement: "Alice was at home." }), evidence: makeEvidence({ episode: 2, quote: "Alice: I was home." }) }),
      ]);
      expect(state.events).toHaveLength(1);
      expect(state.facts).toHaveLength(0);
      expect(state.subjective).toHaveLength(1);
    });
  });

  describe("dream — content NOT established, experience preserved", () => {
    it("dream content does NOT enter objective reality", () => {
      const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f-d", episode: 2, narrativeMode: "dream", assertionKind: "character_experience", factualStatus: "not_established", payload: makeFact({ id: "f-d", statement: "Alice can fly." }), evidence: makeEvidence({ episode: 2, quote: "Alice floats." }) })]);
      expect(state.facts).toHaveLength(0);
      expect(state.subjective).toHaveLength(1);
      expect(state.subjective[0]!.narrativeMode).toBe("dream");
    });

    it("dream occurrence IS established as event", () => {
      const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "event", operation: "add", targetId: "ev-d", episode: 2, narrativeMode: "present", factualStatus: "established", payload: makeEvent({ id: "ev-d", description: "Alice dreams.", episode: 2 }), evidence: makeEvidence({ episode: 2, quote: "Alice tosses." }) })]);
      expect(state.events).toHaveLength(1);
    });
  });

  describe("vision — content NOT established, experience preserved", () => {
    it("vision content does NOT enter objective reality", () => {
      const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f-v", episode: 2, narrativeMode: "vision", assertionKind: "character_experience", factualStatus: "not_established", payload: makeFact({ id: "f-v", statement: "The god speaks." }), evidence: makeEvidence({ episode: 2, quote: "Blinding light." }) })]);
      expect(state.facts).toHaveLength(0);
      expect(state.subjective).toHaveLength(1);
    });
  });

  describe("speculation — belief preserved, suspected event NOT established", () => {
    it("speculated content does NOT enter objective reality", () => {
      const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f-s", episode: 2, narrativeMode: "speculation", assertionKind: "character_belief", factualStatus: "not_established", payload: makeFact({ id: "f-s", statement: "Bob is the traitor." }), evidence: makeEvidence({ episode: 2, quote: "Alice thinks: Bob?" }) })]);
      expect(state.facts).toHaveLength(0);
      expect(state.subjective).toHaveLength(1);
      expect(state.subjective[0]!.assertionKind).toBe("character_belief");
    });

    it("character belief IS established as knowledge", () => {
      const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "knowledge", operation: "add", targetId: "k-b", episode: 2, narrativeMode: "present", assertionKind: "character_belief", factualStatus: "established", payload: makeKnowledge({ id: "k-b", certainty: "suspected" }), evidence: makeEvidence({ episode: 2, quote: "Alice thinks: Bob?" }) })]);
      expect(state.knowledge).toHaveLength(1);
      expect(state.knowledge[0]!.certainty).toBe("suspected");
    });
  });

  describe("mode independence", () => {
    it("present + not_established → subjective (unreliable narrator)", () => {
      const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f1", narrativeMode: "present", factualStatus: "not_established", payload: makeFact({ id: "f1" }) })]);
      expect(state.facts).toHaveLength(0);
      expect(state.subjective).toHaveLength(1);
    });

    it("dream + established → objective (dream occurred)", () => {
      const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "event", operation: "add", targetId: "ev1", narrativeMode: "dream", factualStatus: "established", payload: makeEvent({ id: "ev1", episode: 2 }), evidence: makeEvidence({ episode: 2, quote: "Alice sleeps." }) })]);
      expect(state.events).toHaveLength(1);
      expect(state.subjective).toHaveLength(0);
    });
  });
});

describe("Strict vs migration operation semantics", () => {
  describe("strict mode (default)", () => {
    it("add on existing target throws", () => {
      expect(() => reduceCanon(PROJECT, [
        makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "c1", payload: makeEntity({ id: "c1" }) }),
        makeEntry({ id: "e2", sequence: 2, kind: "entity", operation: "add", targetId: "c1", payload: makeEntity({ id: "c1" }) }),
      ])).toThrow(ReduceError);
    });

    it("modify on missing target throws", () => {
      expect(() => reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "modify", targetId: "c-x", payload: makeEntity({ id: "c-x" }) })])).toThrow(ReduceError);
    });

    it("retract on missing target throws", () => {
      expect(() => reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "retract", targetId: "f-x", payload: null })])).toThrow(ReduceError);
    });

    it("reinterpret on missing target throws", () => {
      expect(() => reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "reinterpret", targetId: "f-x", payload: null, newClassification: "ESTABLISHED_CANON" })])).toThrow(ReduceError);
    });

    it("ReduceError carries diagnostics", () => {
      try {
        reduceCanon(PROJECT, [
          makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "c1", payload: makeEntity({ id: "c1" }) }),
          makeEntry({ id: "e2", sequence: 2, kind: "entity", operation: "add", targetId: "c1", payload: makeEntity({ id: "c1" }) }),
        ]);
      } catch (e) {
        expect(e).toBeInstanceOf(ReduceError);
        const re = e as ReduceError;
        expect(re.entrySequence).toBe(2);
        expect(re.targetId).toBe("c1");
        expect(re.operation).toBe("add");
      }
    });
  });

  describe("migration mode", () => {
    it("add on existing replaces", () => {
      const state = reduceCanon(PROJECT, [
        makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "c1", payload: makeEntity({ id: "c1", name: "Orig" }) }),
        makeEntry({ id: "e2", sequence: 2, kind: "entity", operation: "add", targetId: "c1", payload: makeEntity({ id: "c1", name: "New" }) }),
      ], "migration");
      expect(state.entities[0]!.name).toBe("New");
    });

    it("modify on missing adds", () => {
      const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "modify", targetId: "c-n", payload: makeEntity({ id: "c-n" }) })], "migration");
      expect(state.entities).toHaveLength(1);
    });

    it("retract on missing is no-op", () => {
      const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "retract", targetId: "f-x", payload: null })], "migration");
      expect(state.retracted).toContain("f-x");
    });

    it("reinterpret on missing is no-op", () => {
      expect(() => reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "reinterpret", targetId: "f-x", payload: null, newClassification: "ESTABLISHED_CANON" })], "migration")).not.toThrow();
    });
  });
});

describe("Evidence and provenance requirements", () => {
  it("screenplay-derived fact without evidence fails validation", () => {
    expect(() => canonFactEntrySchema.parse({
      id: "e1", sequence: 1, projectId: PROJECT, episode: 1, sourceStoryId: "s1",
      operation: "add", kind: "fact", targetId: "f1", payload: makeFact({ id: "f1" }),
      evidence: null, narrativeMode: "present", assertionKind: "event", factualStatus: "established",
      extractor: EXTRACTOR, createdAt: new Date(),
    })).toThrow(/evidence/);
  });

  it("seed fact without evidence passes", () => {
    expect(() => canonFactEntrySchema.parse({
      id: "s1", sequence: 1, projectId: PROJECT, episode: 0, sourceStoryId: null,
      operation: "add", kind: "fact", targetId: "f1", payload: makeFact({ id: "f1" }),
      evidence: null, narrativeMode: "present", assertionKind: "event", factualStatus: "established",
      extractor: EXTRACTOR, createdAt: new Date(),
    })).not.toThrow();
  });

  it("evidence without sourceHash fails", () => {
    expect(() => canonFactEntrySchema.parse({
      id: "e1", sequence: 1, projectId: PROJECT, episode: 1, sourceStoryId: "s1",
      operation: "add", kind: "fact", targetId: "f1", payload: makeFact({ id: "f1" }),
      evidence: { quote: "t", sceneNumber: 1, episode: 1, storyId: "s1", storyVersion: 1 },
      narrativeMode: "present", assertionKind: "event", factualStatus: "established",
      extractor: EXTRACTOR, createdAt: new Date(),
    })).toThrow();
  });

  it("evidence without storyVersion fails", () => {
    expect(() => canonFactEntrySchema.parse({
      id: "e1", sequence: 1, projectId: PROJECT, episode: 1, sourceStoryId: "s1",
      operation: "add", kind: "fact", targetId: "f1", payload: makeFact({ id: "f1" }),
      evidence: { quote: "t", sceneNumber: 1, episode: 1, storyId: "s1", sourceHash: "sha:abc" },
      narrativeMode: "present", assertionKind: "event", factualStatus: "established",
      extractor: EXTRACTOR, createdAt: new Date(),
    })).toThrow();
  });

  it("add without payload fails", () => {
    expect(() => canonFactEntrySchema.parse({
      id: "e1", sequence: 1, projectId: PROJECT, episode: 1, sourceStoryId: "s1",
      operation: "add", kind: "fact", targetId: "f1", payload: null,
      evidence: makeEvidence(), narrativeMode: "present", assertionKind: "event", factualStatus: "established",
      extractor: EXTRACTOR, createdAt: new Date(),
    })).toThrow(/payload/);
  });
});

describe("10-category representation mapping", () => {
  it("event: kind=event with episode chronology", () => {
    const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "event", operation: "add", targetId: "ev1", episode: 3, payload: makeEvent({ id: "ev1", episode: 3 }), evidence: makeEvidence({ episode: 3 }) })]);
    expect(state.events[0]!.episode).toBe(3);
  });

  it("state_change: entity + modify for lifecycle", () => {
    const state = reduceCanon(PROJECT, [
      makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "c1", payload: makeEntity({ id: "c1", lifecycle: "active" }) }),
      makeEntry({ id: "e2", sequence: 2, kind: "entity", operation: "modify", targetId: "c1", episode: 4, payload: makeEntity({ id: "c1", lifecycle: "deceased", endedEpisode: 4 }), evidence: makeEvidence({ episode: 4 }) }),
    ]);
    expect(state.entities[0]!.lifecycle).toBe("deceased");
  });

  it("knowledge: kind=knowledge with acquisition timing", () => {
    const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "knowledge", operation: "add", targetId: "k1", episode: 3, payload: makeKnowledge({ id: "k1", knownFromEpisode: 3, certainty: "certain" }), evidence: makeEvidence({ episode: 3 }) })]);
    expect(state.knowledge[0]!.knownFromEpisode).toBe(3);
  });

  it("relationship: with changes[] chronology", () => {
    const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "relationship", operation: "add", targetId: "r1", payload: makeRelationship({ id: "r1", changes: [{ episode: 3, previousState: "allies", newState: "enemies", eventId: null }] }) })]);
    expect(state.relationships[0]!.changes[0]!.episode).toBe(3);
  });

  it("reveal: HIDDEN_TRUTH + audienceRevealEpisode", () => {
    const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f1", payload: makeFact({ id: "f1", classification: "HIDDEN_TRUTH", audienceRevealEpisode: 5 }) })]);
    expect(state.facts[0]!.classification).toBe("HIDDEN_TRUTH");
    expect(state.facts[0]!.audienceRevealEpisode).toBe(5);
  });

  it("object: entity.kind=object + ownerId", () => {
    const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "o1", payload: makeEntity({ id: "o1", kind: "object", ownerId: "c1" }) })]);
    expect(state.entities[0]!.kind).toBe("object");
  });

  it("location: entity.kind=location", () => {
    const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "entity", operation: "add", targetId: "l1", payload: makeEntity({ id: "l1", kind: "location" }) })]);
    expect(state.entities[0]!.kind).toBe("location");
  });

  it("thread: with chronology episodes", () => {
    const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "thread", operation: "add", targetId: "t1", payload: makeThread({ id: "t1", setupEpisodes: [1, 2], payoffEpisodes: [5] }) })]);
    expect(state.threads[0]!.payoffEpisodes).toEqual([5]);
  });

  it("rule: with conditions", () => {
    const state = reduceCanon(PROJECT, [makeEntry({ id: "e1", sequence: 1, kind: "rule", operation: "add", targetId: "ru1", payload: makeRule({ id: "ru1", conditions: ["Spell cast."] }) })]);
    expect(state.rules[0]!.conditions).toEqual(["Spell cast."]);
  });

  it("seed: episode=0 + AUTHOR_TRUTH", () => {
    const state = reduceCanon(PROJECT, [makeSeedEntry({ id: "s1", sequence: 1, kind: "fact", operation: "add", targetId: "fs", payload: makeFact({ id: "fs", classification: "AUTHOR_TRUTH" }) })]);
    expect(state.facts[0]!.classification).toBe("AUTHOR_TRUTH");
  });
});
describe("Subjective fact lifecycle — preservation and non-erasure", () => {
  it("asserterId is preserved in subjective facts", () => {
    const state = reduceCanon(PROJECT, [
      makeEntry({
        id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f-lie",
        episode: 2, narrativeMode: "lie", assertionKind: "character_statement",
        factualStatus: "not_established", asserterId: "char-alice",
        payload: makeFact({ id: "f-lie", statement: "I was at home." }),
        evidence: makeEvidence({ episode: 2, sceneNumber: 7, quote: "Alice: I was home." }),
      }),
    ]);
    expect(state.subjective).toHaveLength(1);
    expect(state.subjective[0]!.asserterId).toBe("char-alice");
  });

  it("sceneNumber is preserved from evidence in subjective facts", () => {
    const state = reduceCanon(PROJECT, [
      makeEntry({
        id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f-dream",
        episode: 3, narrativeMode: "dream", assertionKind: "character_experience",
        factualStatus: "not_established", asserterId: "char-bob",
        payload: makeFact({ id: "f-dream", statement: "Bob can fly." }),
        evidence: makeEvidence({ episode: 3, sceneNumber: 12, quote: "Bob floats." }),
      }),
    ]);
    expect(state.subjective).toHaveLength(1);
    expect(state.subjective[0]!.sceneNumber).toBe(12);
    expect(state.subjective[0]!.episode).toBe(3);
  });

  it("sceneNumber is null when evidence is absent (seed subjective)", () => {
    const state = reduceCanon(PROJECT, [
      makeSeedEntry({
        id: "s1", sequence: 1, kind: "fact", operation: "add", targetId: "f-seed",
        narrativeMode: "speculation", assertionKind: "character_belief",
        factualStatus: "not_established", asserterId: "char-carol",
        payload: makeFact({ id: "f-seed", statement: "Carol suspects the king." }),
      }),
    ]);
    expect(state.subjective).toHaveLength(1);
    expect(state.subjective[0]!.sceneNumber).toBeNull();
    expect(state.subjective[0]!.asserterId).toBe("char-carol");
  });

  it("asserterId is null when not provided", () => {
    const state = reduceCanon(PROJECT, [
      makeEntry({
        id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f-v",
        episode: 2, narrativeMode: "vision", assertionKind: "character_experience",
        factualStatus: "not_established",
        payload: makeFact({ id: "f-v", statement: "A god speaks." }),
        evidence: makeEvidence({ episode: 2, quote: "Blinding light." }),
      }),
    ]);
    expect(state.subjective).toHaveLength(1);
    expect(state.subjective[0]!.asserterId).toBeNull();
  });

  it("later confirmation does NOT erase the original subjective assertion", () => {
    const state = reduceCanon(PROJECT, [
      makeEntry({
        id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f-lie",
        episode: 2, narrativeMode: "lie", assertionKind: "character_statement",
        factualStatus: "not_established", asserterId: "char-alice",
        payload: makeFact({ id: "f-lie", statement: "Alice was at home." }),
        evidence: makeEvidence({ episode: 2, sceneNumber: 3, quote: "Alice: I was home." }),
      }),
      makeEntry({
        id: "e2", sequence: 2, kind: "fact", operation: "add", targetId: "f-truth",
        episode: 5, narrativeMode: "present", assertionKind: "event",
        factualStatus: "established",
        payload: makeFact({ id: "f-truth", statement: "Alice was at the harbor." }),
        evidence: makeEvidence({ episode: 5, sceneNumber: 1, quote: "Camera shows Alice at harbor." }),
      }),
    ]);
    expect(state.facts).toHaveLength(1);
    expect(state.facts[0]!.id).toBe("f-truth");
    expect(state.subjective).toHaveLength(1);
    expect(state.subjective[0]!.entryId).toBe("e1");
    expect(state.subjective[0]!.targetId).toBe("f-lie");
    expect(state.subjective[0]!.narrativeMode).toBe("lie");
    expect(state.subjective[0]!.asserterId).toBe("char-alice");
    expect(state.subjective[0]!.sceneNumber).toBe(3);
  });

  it("multiple subjective assertions from different characters coexist", () => {
    const state = reduceCanon(PROJECT, [
      makeEntry({
        id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f-suspect-a",
        episode: 2, narrativeMode: "speculation", assertionKind: "character_belief",
        factualStatus: "not_established", asserterId: "char-alice",
        payload: makeFact({ id: "f-suspect-a", statement: "Alice suspects Bob." }),
        evidence: makeEvidence({ episode: 2, sceneNumber: 1, quote: "Alice: Bob?" }),
      }),
      makeEntry({
        id: "e2", sequence: 2, kind: "fact", operation: "add", targetId: "f-suspect-b",
        episode: 3, narrativeMode: "speculation", assertionKind: "character_belief",
        factualStatus: "not_established", asserterId: "char-carol",
        payload: makeFact({ id: "f-suspect-b", statement: "Carol suspects Dave." }),
        evidence: makeEvidence({ episode: 3, sceneNumber: 4, quote: "Carol: Dave?" }),
      }),
    ]);
    expect(state.subjective).toHaveLength(2);
    expect(state.subjective[0]!.asserterId).toBe("char-alice");
    expect(state.subjective[1]!.asserterId).toBe("char-carol");
    expect(state.subjective[0]!.sceneNumber).toBe(1);
    expect(state.subjective[1]!.sceneNumber).toBe(4);
  });

  it("subjective assertion with modify operation is preserved", () => {
    const state = reduceCanon(PROJECT, [
      makeEntry({
        id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f-dream",
        episode: 2, narrativeMode: "dream", assertionKind: "character_experience",
        factualStatus: "not_established", asserterId: "char-alice",
        payload: makeFact({ id: "f-dream", statement: "Alice dreams of flying." }),
        evidence: makeEvidence({ episode: 2, sceneNumber: 5, quote: "Alice floats." }),
      }),
      makeEntry({
        id: "e2", sequence: 2, kind: "fact", operation: "modify", targetId: "f-dream",
        episode: 4, narrativeMode: "dream", assertionKind: "character_experience",
        factualStatus: "not_established", asserterId: "char-alice",
        payload: makeFact({ id: "f-dream", statement: "Alice dreams of flying again." }),
        evidence: makeEvidence({ episode: 4, sceneNumber: 2, quote: "Alice floats again." }),
      }),
    ]);
    expect(state.subjective).toHaveLength(2);
    expect(state.subjective[0]!.sceneNumber).toBe(5);
    expect(state.subjective[1]!.sceneNumber).toBe(2);
  });

  it("retract and reinterpret do not create subjective entries", () => {
    const state = reduceCanon(PROJECT, [
      makeEntry({
        id: "e1", sequence: 1, kind: "fact", operation: "add", targetId: "f1",
        payload: makeFact({ id: "f1" }),
      }),
      makeEntry({
        id: "e2", sequence: 2, kind: "fact", operation: "retract", targetId: "f1",
        episode: 2, narrativeMode: "lie", assertionKind: "character_statement",
        factualStatus: "not_established", payload: null,
        evidence: makeEvidence({ episode: 2, quote: "Retraction." }),
      }),
      makeEntry({
        id: "e3", sequence: 3, kind: "fact", operation: "reinterpret", targetId: "f1",
        episode: 3, narrativeMode: "speculation", assertionKind: "character_belief",
        factualStatus: "not_established", payload: null, newClassification: "ESTABLISHED_CANON",
        evidence: makeEvidence({ episode: 3, quote: "Reinterpretation." }),
      }),
    ]);
    expect(state.subjective).toHaveLength(0);
  });
});