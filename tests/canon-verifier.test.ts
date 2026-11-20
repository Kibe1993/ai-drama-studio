import { describe, it, expect } from "vitest";
import { emptyDerivedCanonState, type DerivedCanonState } from "@/lib/canon/schema";
import { derivedToCanonState } from "@/lib/canon/bridge";
import { verifyAgainstCanonLog } from "@/lib/canon/verifier";
import { validateEpisodeScreenplay } from "@/lib/domain/screenplayValidation";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import {
  NARRATIVE_CONTROL_SCHEMA_VERSION,
  type CanonEntity,
  type NarrativeFact,
  type KnowledgeEntry,
  type WorldRule,
  type CanonEvent,
  type CanonThread,
} from "@/lib/validation/narrativeControl";
import type { ScreenplayScene } from "@/lib/validation/story";

const PROJECT = "proj-verifier";

function makeEntity(overrides: Partial<CanonEntity> & { id: string }): CanonEntity {
  return {
    kind: "character",
    name: "Alice",
    aliases: [],
    description: "The protagonist.",
    role: "protagonist",
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
    ...overrides,
  };
}

function makeFact(overrides: Partial<NarrativeFact> & { id: string }): NarrativeFact {
  return {
    key: "fact-key",
    statement: "A fact.",
    classification: "ESTABLISHED_CANON",
    protected: false,
    subjectEntityIds: [],
    value: "",
    rolePhrase: "",
    literalKind: "none",
    audienceRevealEpisode: null,
    certainPatterns: [],
    suspectedPatterns: [],
    forbiddenLiterals: [],
    ...overrides,
  };
}

function makeKnowledge(overrides: Partial<KnowledgeEntry> & { id: string }): KnowledgeEntry {
  return {
    characterId: "char-1",
    factId: "fact-1",
    knownFromEpisode: 1,
    learnedVia: "",
    believes: true,
    certainty: "certain",
    supportingEventId: null,
    ...overrides,
  };
}

function makeRule(overrides: Partial<WorldRule> & { id: string }): WorldRule {
  return {
    description: "A world rule.",
    scope: "",
    conditions: [],
    exceptions: [],
    approvalStatus: "approved",
    violationPatterns: [],
    establishedRef: "",
    canonicalInterval: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CanonEvent> & { id: string }): CanonEvent {
  return {
    description: "An event.",
    participantIds: [],
    locationId: null,
    episode: 1,
    presentationEpisode: null,
    audienceEpisode: null,
    preconditions: [],
    triggers: [],
    consequences: [],
    causedBy: [],
    acknowledgement: "optional",
    contradictoryWith: [],
    requiresCause: false,
    ...overrides,
  };
}

function makeThread(overrides: Partial<CanonThread> & { id: string }): CanonThread {
  return {
    description: "A thread.",
    category: "mystery",
    status: "introduced",
    scope: "central",
    introducedEpisode: 1,
    setupEpisodes: [],
    developmentEpisodes: [],
    payoffEpisodes: [],
    intendedResolution: "",
    intendedSeason: null,
    carryForward: false,
    explanation: "",
    subjectEntityIds: [],
    ...overrides,
  };
}

function scene(overrides: Partial<ScreenplayScene> & { sceneNumber: number }): ScreenplayScene {
  return {
    heading: "INT. ROOM - DAY",
    location: "Room",
    timeOfDay: "Day",
    charactersPresent: [],
    visualDescription: "",
    action: "",
    dialogue: [],
    ...overrides,
  };
}

function derivedState(overrides: Partial<DerivedCanonState>): DerivedCanonState {
  return {
    ...emptyDerivedCanonState(PROJECT),
    sequence: 1,
    ...overrides,
  };
}

describe("derivedToCanonState bridge", () => {
  it("copies all shared collections by reference", () => {
    const entities = [makeEntity({ id: "char-1", name: "Alice" })];
    const facts = [makeFact({ id: "fact-1", statement: "Alice is the hero." })];
    const rules = [makeRule({ id: "rule-1", description: "No magic." })];
    const events = [makeEvent({ id: "event-1" })];
    const threads = [makeThread({ id: "thread-1" })];
    const knowledge = [makeKnowledge({ id: "know-1" })];

    const derived = derivedState({ entities, facts, rules, events, threads, knowledge });
    const canon = derivedToCanonState(derived);

    expect(canon.entities).toBe(entities);
    expect(canon.facts).toBe(facts);
    expect(canon.rules).toBe(rules);
    expect(canon.events).toBe(events);
    expect(canon.threads).toBe(threads);
    expect(canon.knowledge).toBe(knowledge);
  });

  it("maps sequence to version", () => {
    const derived = derivedState({ sequence: 42 });
    const canon = derivedToCanonState(derived);
    expect(canon.version).toBe(42);
  });

  it("defaults snapshot-only fields to empty arrays", () => {
    const canon = derivedToCanonState(derivedState({}));
    expect(canon.resolvedFindingSignatures).toEqual([]);
    expect(canon.revisionLog).toEqual([]);
  });

  it("uses the narrative control schema version", () => {
    const canon = derivedToCanonState(derivedState({}));
    expect(canon.schemaVersion).toBe(NARRATIVE_CONTROL_SCHEMA_VERSION);
  });

  it("passes through basedOnBibleVersion and basedOnPlanVersion", () => {
    const canon = derivedToCanonState(derivedState({}), {
      basedOnBibleVersion: 3,
      basedOnPlanVersion: 7,
    });
    expect(canon.basedOnBibleVersion).toBe(3);
    expect(canon.basedOnPlanVersion).toBe(7);
  });

  it("defaults basedOnBibleVersion and basedOnPlanVersion to 0", () => {
    const canon = derivedToCanonState(derivedState({}));
    expect(canon.basedOnBibleVersion).toBe(0);
    expect(canon.basedOnPlanVersion).toBe(0);
  });

  it("preserves projectId", () => {
    const canon = derivedToCanonState(derivedState({}));
    expect(canon.projectId).toBe(PROJECT);
  });
});

describe("verifyAgainstCanonLog", () => {
  function canonWithSecret(): DerivedCanonState {
    const samuel = makeEntity({
      id: "character:samuel",
      name: "Samuel",
      aliases: ["Sam"],
      firstIntroductionEpisode: 1,
      firstAppearanceEpisode: 1,
      appearances: [1, 2, 3, 4, 5],
    });
    return derivedState({
      sequence: 5,
      entities: [samuel],
      facts: [
        makeFact({
          id: "fact-driver",
          key: "accident.driver",
          statement: "Samuel was the driver who caused the accident.",
          classification: "AUTHOR_TRUTH",
          protected: true,
          subjectEntityIds: [samuel.id],
          value: "Samuel",
          rolePhrase: "driver",
          audienceRevealEpisode: 4,
          certainPatterns: ["i was driving", "i caused the crash"],
          suspectedPatterns: ["might have been driving"],
        }),
      ],
      knowledge: [
        makeKnowledge({
          id: "know-suspect",
          characterId: samuel.id,
          factId: "fact-driver",
          knownFromEpisode: 3,
          certainty: "suspected",
          learnedVia: "A clue.",
        }),
        makeKnowledge({
          id: "know-certain",
          characterId: samuel.id,
          factId: "fact-driver",
          knownFromEpisode: 4,
          certainty: "certain",
          learnedVia: "He remembers.",
        }),
      ],
    });
  }

  it("approves a clean screenplay that does not contradict canon", () => {
    const canonLog = canonWithSecret();
    const result = verifyAgainstCanonLog({
      episodeNumber: 2,
      synopsis: "Samuel waits at the bus stop and thinks about his past.",
      screenplay: [
        scene({
          sceneNumber: 1,
          heading: "EXT. BUS STOP - NIGHT",
          location: "Bus stop",
          timeOfDay: "Night",
          charactersPresent: ["Samuel"],
          visualDescription: "Rain on an empty road.",
          action: "Samuel stares at the headlights.",
          dialogue: [{ characterName: "Samuel", line: "What a night." }],
        }),
      ],
      canonState: canonLog,
    });
    expect(result.passed).toBe(true);
    expect(result.decision).toBe("approve");
    expect(result.canonVersion).toBe(5);
    expect(result.layers).toContain("structural");
  });

  it("rejects a screenplay that reveals a protected secret too early", () => {
    const canonLog = canonWithSecret();
    const result = verifyAgainstCanonLog({
      episodeNumber: 1,
      synopsis: "Samuel confesses everything immediately.",
      screenplay: [
        scene({
          sceneNumber: 1,
          heading: "EXT. BUS STOP - NIGHT",
          location: "Bus stop",
          timeOfDay: "Night",
          charactersPresent: ["Samuel"],
          visualDescription: "Rain on an empty road.",
          action: "Samuel stares at the headlights.",
          dialogue: [{ characterName: "Samuel", line: "I caused the crash. I was driving." }],
        }),
      ],
      canonState: canonLog,
    });
    expect(result.passed).toBe(false);
    expect(result.decision).toBe("reject");
    expect(result.findings.some((f) => f.severity === "ERROR")).toBe(true);
  });

  it("rejects a screenplay where a dead character appears", () => {
    const deadChar = makeEntity({
      id: "character:marcus",
      name: "Marcus",
      firstIntroductionEpisode: 1,
      firstAppearanceEpisode: 1,
      appearances: [1],
      lifecycle: "deceased",
      endedEpisode: 2,
    });
    const canonLog = derivedState({
      sequence: 3,
      entities: [deadChar],
      facts: [],
    });
    const result = verifyAgainstCanonLog({
      episodeNumber: 5,
      synopsis: "Marcus returns from the dead.",
      screenplay: [
        scene({
          sceneNumber: 1,
          charactersPresent: ["Marcus"],
          action: "Marcus walks in.",
          dialogue: [{ characterName: "Marcus", line: "I'm back." }],
        }),
      ],
      canonState: canonLog,
    });
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.severity === "ERROR")).toBe(true);
  });

  it("rejects a screenplay that violates a world rule", () => {
    const rule = makeRule({
      id: "rule-bus",
      description: "The supernatural bus appears only at 11:47 PM.",
      scope: "the bus stop",
      violationPatterns: ["bus arrives at noon", "bus arrives at midnight"],
    });
    const canonLog = derivedState({
      sequence: 2,
      rules: [rule],
    });
    const result = verifyAgainstCanonLog({
      episodeNumber: 3,
      synopsis: "The bus arrives at noon.",
      screenplay: [
        scene({
          sceneNumber: 1,
          action: "The bus arrives at noon.",
          dialogue: [],
        }),
      ],
      canonState: canonLog,
    });
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.severity === "ERROR")).toBe(true);
  });

  it("rejects a screenplay where a thread payoff is recorded before its setup", () => {
    const thread = makeThread({
      id: "thread-mystery",
      description: "Who was driving?",
      status: "resolved",
      introducedEpisode: 1,
      setupEpisodes: [5],
      payoffEpisodes: [2],
    });
    const canonLog = derivedState({
      sequence: 2,
      threads: [thread],
    });
    const result = verifyAgainstCanonLog({
      episodeNumber: 2,
      synopsis: "The mystery is fully resolved.",
      screenplay: [
        scene({
          sceneNumber: 1,
          action: "The detective explains who was driving the bus.",
          dialogue: [],
        }),
      ],
      canonState: canonLog,
    });
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.severity === "ERROR")).toBe(true);
  });

  it("returns needs_authorization when a finding requires canon authorization", () => {
    const samuel = makeEntity({
      id: "character:samuel",
      name: "Samuel",
      firstIntroductionEpisode: 1,
      firstAppearanceEpisode: 1,
      appearances: [1, 2, 3, 4, 5],
    });
    const protectedFact = makeFact({
      id: "fact-secret",
      key: "secret.identity",
      statement: "Samuel's real name is classified.",
      classification: "AUTHOR_TRUTH",
      protected: true,
      subjectEntityIds: [samuel.id],
      audienceRevealEpisode: 5,
      certainPatterns: ["his real name is"],
    });
    const canonLog = derivedState({
      sequence: 3,
      entities: [samuel],
      facts: [protectedFact],
    });
    const result = verifyAgainstCanonLog({
      episodeNumber: 2,
      synopsis: "Someone reveals Samuel's real name.",
      screenplay: [
        scene({
          sceneNumber: 1,
          charactersPresent: ["Samuel"],
          action: "A stranger reveals Samuel's real name is John.",
          dialogue: [{ characterName: "Stranger", line: "His real name is John." }],
        }),
      ],
      canonState: canonLog,
      requireCanonCoverage: true,
    });
    expect(result.decision).not.toBe("approve");
  });

  it("handles an empty canon state gracefully", () => {
    const canonLog = emptyDerivedCanonState(PROJECT);
    const result = verifyAgainstCanonLog({
      episodeNumber: 1,
      synopsis: "A normal episode.",
      screenplay: [
        scene({
          sceneNumber: 1,
          action: "Nothing happens.",
          dialogue: [],
        }),
      ],
      canonState: canonLog,
    });
    expect(result.canonVersion).toBe(0);
    expect(result.layers).toContain("structural");
  });

  it("includes deterministic layer when entities and facts are present", () => {
    const canonLog = canonWithSecret();
    const result = verifyAgainstCanonLog({
      episodeNumber: 2,
      synopsis: "Samuel waits.",
      screenplay: [
        scene({
          sceneNumber: 1,
          charactersPresent: ["Samuel"],
          action: "Samuel waits.",
          dialogue: [],
        }),
      ],
      canonState: canonLog,
    });
    expect(result.layers).toContain("deterministic");
  });
});
describe("validateEpisodeScreenplay integration", () => {
  function canonWithSecret(): DerivedCanonState {
    const samuel = makeEntity({
      id: "character:samuel",
      name: "Samuel",
      aliases: ["Sam"],
      firstIntroductionEpisode: 1,
      firstAppearanceEpisode: 1,
      appearances: [1, 2, 3, 4, 5],
    });
    return derivedState({
      sequence: 5,
      entities: [samuel],
      facts: [
        makeFact({
          id: "fact-driver",
          key: "accident.driver",
          statement: "Samuel was the driver who caused the accident.",
          classification: "AUTHOR_TRUTH",
          protected: true,
          subjectEntityIds: [samuel.id],
          value: "Samuel",
          rolePhrase: "driver",
          audienceRevealEpisode: 4,
          certainPatterns: ["i was driving", "i caused the crash"],
          suspectedPatterns: ["might have been driving"],
        }),
      ],
      knowledge: [
        makeKnowledge({
          id: "know-certain",
          characterId: samuel.id,
          factId: "fact-driver",
          knownFromEpisode: 4,
          certainty: "certain",
          learnedVia: "He remembers.",
        }),
      ],
    });
  }

  it("uses the canon-log verifier when canonLogState is present", () => {
    const canonLog = canonWithSecret();
    const result = validateEpisodeScreenplay({
      episodeNumber: 1,
      seriesTitle: "The Last Bus",
      story: {
        title: "The stop",
        synopsis: "Samuel confesses everything immediately.",
        screenplay: [
          scene({
            sceneNumber: 1,
            charactersPresent: ["Samuel"],
            action: "Samuel stares at the headlights.",
            dialogue: [{ characterName: "Samuel", line: "I caused the crash. I was driving." }],
          }),
        ],
      },
      targetDurationSeconds: 60,
      bible: null,
      seasonPlan: null,
      episodePlan: null,
      ledger: null,
      previousEpisodes: [],
      canonLogState: canonLog,
    });
    expect(result.passed).toBe(false);
    expect(result.narrativeCanonVersion).toBe(5);
    expect(result.narrativeValidationLayers).toContain("deterministic");
  });

  it("skips shallow continuity checks when canonLogState is present", () => {
    const canonLog = canonWithSecret();
    const ledger: ContinuityLedger = {
      events: [],
      characterStates: [],
      locationStates: [],
      objectStates: [],
      revealedSecrets: [],
      unresolvedThreads: [],
      consequences: ["A very specific unique consequence that is never mentioned."],
      timelineNotes: "",
    };
    const result = validateEpisodeScreenplay({
      episodeNumber: 2,
      seriesTitle: "The Last Bus",
      story: {
        title: "The stop",
        synopsis: "Samuel waits at the bus stop and thinks about his past.",
        screenplay: [
          scene({
            sceneNumber: 1,
            charactersPresent: ["Samuel"],
            action: "Samuel waits.",
            dialogue: [{ characterName: "Samuel", line: "What a night." }],
          }),
        ],
      },
      targetDurationSeconds: 60,
      bible: null,
      seasonPlan: null,
      episodePlan: null,
      ledger,
      previousEpisodes: [],
      canonLogState: canonLog,
    });
    // The shallow continuity check would warn about the consequence not being
    // carried. With the verifier active, that warning is skipped.
    expect(result.findings.some((f) => f.category === "continuity" && f.message.includes("consequence"))).toBe(false);
  });

  it("falls back to legacy canon path when canonLogState is absent", () => {
    const canonLog = canonWithSecret();
    const bridged = derivedToCanonState(canonLog);
    const result = validateEpisodeScreenplay({
      episodeNumber: 1,
      seriesTitle: "The Last Bus",
      story: {
        title: "The stop",
        synopsis: "Samuel confesses everything immediately.",
        screenplay: [
          scene({
            sceneNumber: 1,
            charactersPresent: ["Samuel"],
            action: "Samuel stares at the headlights.",
            dialogue: [{ characterName: "Samuel", line: "I caused the crash. I was driving." }],
          }),
        ],
      },
      targetDurationSeconds: 60,
      bible: null,
      seasonPlan: null,
      episodePlan: null,
      ledger: null,
      previousEpisodes: [],
      canon: bridged,
    });
    expect(result.passed).toBe(false);
    expect(result.narrativeCanonVersion).toBe(5);
  });
});