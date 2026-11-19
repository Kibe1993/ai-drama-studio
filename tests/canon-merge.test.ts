import { describe, expect, it } from "vitest";
import { canonStateSchema, type CanonState, type CanonEntity, type CanonRelationship, type KnowledgeEntry, type CanonThread } from "@/lib/validation/narrativeControl";
import { mergeDerivedCanon } from "@/lib/domain/narrativeControl/canonResolution";

const projectId = "p".repeat(24);

function makeCanon(overrides: Partial<CanonState> = {}): CanonState {
  return canonStateSchema.parse({
    schemaVersion: 1, projectId, version: 1, basedOnBibleVersion: 1, basedOnPlanVersion: 0,
    entities: [], relationships: [], events: [], threads: [], facts: [], knowledge: [], rules: [],
    resolvedFindingSignatures: [], revisionLog: [],
    ...overrides,
  });
}

function charEntity(id: string, name: string, description = "", overrides: Partial<CanonEntity> = {}): CanonEntity {
  return {
    id, kind: "character", name, aliases: [], description, role: "",
    motivations: [], goals: [], firstIntroductionEpisode: null, firstAppearanceEpisode: null,
    appearances: [], lifecycle: "unknown", arc: "", secrets: [],
    permitsNonlivingAppearance: false, endedEpisode: null, ownerId: null, locationId: null,
    properties: [], significance: "", transfers: [], modifications: [], locationRules: [],
    ...overrides,
  };
}

function relationship(id: string, type: string, state = ""): CanonRelationship {
  return {
    id, characterIds: ["char:a", "char:b"], relationshipType: type,
    initialState: state, currentState: state, introducedEpisode: 1, historical: false, changes: [],
  };
}

function knowledgeEntry(id: string, characterId: string, factId: string, certainty: "certain" | "suspected" = "certain"): KnowledgeEntry {
  return { id, characterId, factId, knownFromEpisode: 1, learnedVia: "", believes: true, certainty, supportingEventId: null };
}

function thread(id: string, status: CanonThread["status"] = "active"): CanonThread {
  return {
    id, description: id, category: "mystery", status, scope: "secondary",
    introducedEpisode: 1, setupEpisodes: [], developmentEpisodes: [], payoffEpisodes: [],
    intendedResolution: "", intendedSeason: null, carryForward: false, explanation: "", subjectEntityIds: [],
  };
}

describe("mergeDerivedCanon", () => {
  it("merges relationships by ID", () => {
    const stored = makeCanon({ relationships: [relationship("rel:1", "friend", "close")] });
    const derived = makeCanon({
      basedOnBibleVersion: 2,
      relationships: [relationship("rel:1", "friend", "close"), relationship("rel:2", "rival", "tense")],
    });
    const merged = mergeDerivedCanon(stored, derived);
    expect(merged.state.relationships).toHaveLength(2);
    expect(merged.state.relationships.some((r) => r.id === "rel:2")).toBe(true);
  });

  it("does not overwrite existing relationships", () => {
    const stored = makeCanon({ relationships: [relationship("rel:1", "friend", "close")] });
    const derived = makeCanon({
      basedOnBibleVersion: 2,
      relationships: [relationship("rel:1", "rival", "tense")],
    });
    const merged = mergeDerivedCanon(stored, derived);
    expect(merged.state.relationships).toHaveLength(1);
    expect(merged.state.relationships[0]!.relationshipType).toBe("friend");
    expect(merged.state.relationships[0]!.currentState).toBe("close");
  });

  it("merges character knowledge without duplicating", () => {
    const stored = makeCanon({ knowledge: [knowledgeEntry("k:1", "char:a", "fact:1")] });
    const derived = makeCanon({
      basedOnBibleVersion: 2,
      knowledge: [knowledgeEntry("k:1", "char:a", "fact:1"), knowledgeEntry("k:2", "char:b", "fact:1")],
    });
    const merged = mergeDerivedCanon(stored, derived);
    expect(merged.state.knowledge).toHaveLength(2);
    expect(merged.state.knowledge.some((k) => k.id === "k:2")).toBe(true);
  });

  it("does not transfer knowledge between characters", () => {
    const stored = makeCanon({ knowledge: [knowledgeEntry("k:1", "char:a", "fact:1", "certain")] });
    const derived = makeCanon({
      basedOnBibleVersion: 2,
      knowledge: [knowledgeEntry("k:1", "char:b", "fact:1", "certain")],
    });
    const merged = mergeDerivedCanon(stored, derived);
    const entry = merged.state.knowledge.find((k) => k.id === "k:1");
    expect(entry?.characterId).toBe("char:a");
  });

  it("merges threads and preserves lifecycle status", () => {
    const stored = makeCanon({ threads: [thread("t:1", "resolved")] });
    const derived = makeCanon({
      basedOnBibleVersion: 2,
      threads: [thread("t:1", "active"), thread("t:2", "active")],
    });
    const merged = mergeDerivedCanon(stored, derived);
    expect(merged.state.threads).toHaveLength(2);
    const t1 = merged.state.threads.find((t) => t.id === "t:1");
    expect(t1?.status).toBe("resolved");
  });

  it("updates entity descriptions from newer Bible versions", () => {
    const stored = makeCanon({
      basedOnBibleVersion: 1,
      entities: [charEntity("char:a", "Alice", "Old description")],
    });
    const derived = makeCanon({
      basedOnBibleVersion: 2,
      entities: [charEntity("char:a", "Alice", "Updated description")],
    });
    const merged = mergeDerivedCanon(stored, derived);
    const alice = merged.state.entities.find((e) => e.id === "char:a");
    expect(alice?.description).toBe("Updated description");
  });

  it("does not overwrite entity identity (name, kind) from newer Bible", () => {
    const stored = makeCanon({
      basedOnBibleVersion: 1,
      entities: [charEntity("char:a", "Alice", "Description")],
    });
    const derived = makeCanon({
      basedOnBibleVersion: 2,
      entities: [charEntity("char:a", "Alicia", "New description")],
    });
    const merged = mergeDerivedCanon(stored, derived);
    const ent = merged.state.entities.find((e) => e.id === "char:a");
    expect(ent?.name).toBe("Alice");
    expect(ent?.description).toBe("New description");
  });

  it("does not overwrite protected facts", () => {
    const stored = makeCanon({
      facts: [{
        id: "fact:1", key: "test", statement: "The sky is blue.",
        classification: "ESTABLISHED_CANON", protected: true,
        subjectEntityIds: [], value: "", rolePhrase: "", literalKind: "none",
        audienceRevealEpisode: null, certainPatterns: [], suspectedPatterns: [], forbiddenLiterals: [],
      }],
    });
    const derived = makeCanon({
      basedOnBibleVersion: 2,
      facts: [{
        id: "fact:1", key: "test", statement: "The sky is blue.",
        classification: "ESTABLISHED_CANON", protected: true,
        subjectEntityIds: [], value: "green", rolePhrase: "", literalKind: "none",
        audienceRevealEpisode: null, certainPatterns: [], suspectedPatterns: [], forbiddenLiterals: [],
      }],
    });
    const merged = mergeDerivedCanon(stored, derived);
    expect(merged.state.facts).toHaveLength(1);
  });

  it("merges events without duplicating", () => {
    const stored = makeCanon({
      events: [{
        id: "evt:1", description: "The incident.", participantIds: [], locationId: null,
        episode: 1, presentationEpisode: null, audienceEpisode: null,
        preconditions: [], triggers: [], consequences: [], causedBy: [],
        acknowledgement: "optional", contradictoryWith: [], requiresCause: false,
      }],
    });
    const derived = makeCanon({
      basedOnBibleVersion: 2,
      events: [{
        id: "evt:1", description: "The incident.", participantIds: [], locationId: null,
        episode: 1, presentationEpisode: null, audienceEpisode: null,
        preconditions: [], triggers: [], consequences: [], causedBy: [],
        acknowledgement: "optional", contradictoryWith: [], requiresCause: false,
      }, {
        id: "evt:2", description: "The aftermath.", participantIds: [], locationId: null,
        episode: 2, presentationEpisode: null, audienceEpisode: null,
        preconditions: [], triggers: [], consequences: [], causedBy: [],
        acknowledgement: "optional", contradictoryWith: [], requiresCause: false,
      }],
    });
    const merged = mergeDerivedCanon(stored, derived);
    expect(merged.state.events).toHaveLength(2);
  });

  it("updates entity motivations and arc from newer Bible", () => {
    const stored = makeCanon({
      basedOnBibleVersion: 1,
      entities: [charEntity("char:a", "Alice", "Desc", { motivations: ["old"], arc: "old arc" })],
    });
    const derived = makeCanon({
      basedOnBibleVersion: 2,
      entities: [charEntity("char:a", "Alice", "Desc", { motivations: ["new motivation"], arc: "new arc" })],
    });
    const merged = mergeDerivedCanon(stored, derived);
    const alice = merged.state.entities.find((e) => e.id === "char:a");
    expect(alice?.motivations).toEqual(["new motivation"]);
    expect(alice?.arc).toBe("new arc");
  });
});