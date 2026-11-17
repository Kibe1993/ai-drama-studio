import { describe, expect, it } from "vitest";
import { canonStateSchema } from "@/lib/validation/narrativeControl";
import type { CanonState, NarrativeFact } from "@/lib/validation/narrativeControl";
import { makeFinding, dedupeFindings, type NarrativeFinding } from "@/lib/domain/narrativeControl/findings";
import { agreementFindings, draftConsistencyFindings } from "@/lib/domain/narrativeControl/agreement";
import { validateKnowledge } from "@/lib/domain/narrativeControl/implication";
import type { StoryStructure } from "@/lib/validation/story";

const projectId = "p".repeat(24);

function minimalCanon(overrides: Partial<CanonState> = {}): CanonState {
  return canonStateSchema.parse({
    schemaVersion: 1,
    projectId,
    version: 1,
    basedOnBibleVersion: 1,
    basedOnPlanVersion: 0,
    entities: [],
    relationships: [],
    events: [],
    threads: [],
    facts: [],
    knowledge: [],
    rules: [],
    resolvedFindingSignatures: [],
    revisionLog: [],
    ...overrides,
  });
}

function protectedFact(statement: string, subjectEntityIds: string[] = []): NarrativeFact {
  return {
    id: `fact:${statement.slice(0, 20)}`,
    key: statement.slice(0, 40),
    statement,
    classification: "ESTABLISHED_CANON",
    protected: true,
    subjectEntityIds,
    value: "",
    rolePhrase: "",
    literalKind: "none",
    audienceRevealEpisode: null,
    certainPatterns: [],
    suspectedPatterns: [],
    forbiddenLiterals: [],
  };
}

describe("finding identity includes sceneNumber", () => {
  it("gives different IDs to otherwise-identical findings at different scenes", () => {
    const base = {
      algorithm: "agreement",
      severity: "ERROR" as const,
      category: "canon",
      episode: 1,
      evidence: "The screenplay denies the fact.",
      expected: "Kofi is her brother.",
      actual: "Kofi is not her brother.",
      explanation: "The screenplay denies the protected fact.",
    };
    const atScene3 = makeFinding({ ...base, sceneNumber: 3 });
    const atScene7 = makeFinding({ ...base, sceneNumber: 7 });
    expect(atScene3.id).not.toBe(atScene7.id);
  });

  it("preserves same-content findings at different scenes through dedupeFindings", () => {
    const base = {
      algorithm: "agreement",
      severity: "ERROR" as const,
      category: "canon",
      episode: 1,
      evidence: "The screenplay denies the fact.",
      expected: "Kofi is her brother.",
      actual: "Kofi is not her brother.",
      explanation: "The screenplay denies the protected fact.",
    };
    const findings: NarrativeFinding[] = [
      makeFinding({ ...base, sceneNumber: 3 }),
      makeFinding({ ...base, sceneNumber: 7 }),
      makeFinding({ ...base, sceneNumber: 12 }),
    ];
    const deduped = dedupeFindings(findings);
    expect(deduped).toHaveLength(3);
  });

  it("still deduplicates truly identical findings", () => {
    const base = {
      algorithm: "agreement",
      severity: "ERROR" as const,
      category: "canon",
      episode: 1,
      sceneNumber: 3,
      evidence: "The screenplay denies the fact.",
      expected: "Kofi is her brother.",
      actual: "Kofi is not her brother.",
      explanation: "The screenplay denies the protected fact.",
    };
    const findings: NarrativeFinding[] = [
      makeFinding(base),
      makeFinding(base),
      makeFinding(base),
    ];
    const deduped = dedupeFindings(findings);
    expect(deduped).toHaveLength(1);
  });
});

describe("character identity validator uses aliases", () => {
  it("collects aliases from canon entities for name matching", () => {
    const canon = minimalCanon({
      entities: [
        {
          id: "character:amara",
          kind: "character",
          name: "Amara Okafor",
          aliases: ["Amara", "Mara"],
          description: "Journalist.",
          role: "protagonist",
          motivations: [],
          goals: [],
          firstIntroductionEpisode: null,
          firstAppearanceEpisode: null,
          appearances: [],
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
        },
      ],
      facts: [
        protectedFact("Amara is a journalist returning to her coastal hometown.", ["character:amara"]),
      ],
    });

    const findings = agreementFindings({
      canon,
      episode: 1,
      synopsis: "Amara is a journalist returning to her coastal hometown.",
      acts: "",
      screenplayText: "Mara is not a journalist. She hates the coast.",
      endingText: "",
      requireCanonCoverage: false,
    });

    expect(findings.some((f) => f.category === "canon" && f.explanation.includes("denies"))).toBe(true);
  });
});

describe("word-boundary matching prevents false positives", () => {
  it("does not match a short name inside a common word", () => {
    const canon = minimalCanon({
      entities: [
        {
          id: "character:dan",
          kind: "character",
          name: "Dan",
          aliases: [],
          description: "A driver.",
          role: "supporting",
          motivations: [],
          goals: [],
          firstIntroductionEpisode: null,
          firstAppearanceEpisode: null,
          appearances: [],
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
        },
      ],
      facts: [
        protectedFact("Dan is a driver.", ["character:dan"]),
      ],
    });

    const findings = agreementFindings({
      canon,
      episode: 1,
      synopsis: "Dan is a driver.",
      acts: "",
      screenplayText: "The danger on the road was clear. Dan drove carefully.",
      endingText: "",
      requireCanonCoverage: false,
    });

    const denialFindings = findings.filter((f) => f.category === "canon" && f.explanation.includes("denies"));
    expect(denialFindings).toHaveLength(0);
  });
});

describe("samePassage detects near-duplicate scene descriptions", () => {
  const structure: StoryStructure = {
    act1: {
      introduction: "A woman arrives.",
      mainCharacters: "Jane.",
      setting: "A house.",
      initialSituation: "Jane moves in.",
      incitingIncident: "She finds a clue.",
    },
    act2: {
      risingTension: "Jane investigates.",
      obstacles: "The house resists.",
      characterDecisions: "Jane pushes forward.",
      turningPoint: "Jane finds the ledger.",
    },
    act3: {
      climax: "Jane confronts the truth.",
      resolution: "The house reveals its secret.",
      finalOutcome: "Jane's fate is uncertain.",
    },
  };

  it("flags scenes where action repeats the visual description with only punctuation differences", () => {
    const description = "Dust motes dance in shafts of early light through the abandoned house, and a single framed photograph hangs crooked on the wall.";
    const findings = draftConsistencyFindings({
      episode: 1,
      title: "The House",
      synopsis: "Jane inherits a house with a secret.",
      acts: structure,
      scenes: [
        {
          sceneNumber: 1,
          heading: "INT. HOUSE - DAY",
          visualDescription: description,
          action: description + ".",
          dialogue: "Jane: What is this place?",
        },
      ],
    });
    expect(findings.some((f) => f.algorithm === "scene_action")).toBe(true);
  });

  it("flags scenes where action is a near-verbatim copy with a trivial suffix", () => {
    const description = "Dust motes dance in shafts of early light through the abandoned house, and a single framed photograph hangs crooked on the wall.";
    const findings = draftConsistencyFindings({
      episode: 1,
      title: "The House",
      synopsis: "Jane inherits a house with a secret.",
      acts: structure,
      scenes: [
        {
          sceneNumber: 1,
          heading: "INT. HOUSE - DAY",
          visualDescription: description,
          action: description + " The room is still.",
          dialogue: "Jane: What is this place?",
        },
      ],
    });
    expect(findings.some((f) => f.algorithm === "scene_action")).toBe(true);
  });

  it("does not flag scenes where action adds a distinct dramatic event", () => {
    const findings = draftConsistencyFindings({
      episode: 1,
      title: "The House",
      synopsis: "Jane inherits a house with a secret.",
      acts: structure,
      scenes: [
        {
          sceneNumber: 1,
          heading: "INT. HOUSE - DAY",
          visualDescription: "Dust motes dance in shafts of early light through the abandoned house, and a single framed photograph hangs crooked on the wall.",
          action: "Jane crosses the room and picks up the photograph. The frame cracks in her hand, revealing a hidden note behind it.",
          dialogue: "Jane: What is this place?",
        },
      ],
    });
    expect(findings.some((f) => f.algorithm === "scene_action")).toBe(false);
  });
});

describe("knowledge validator resolves speaker aliases", () => {
  it("attributes spoken lines to the canonical entity when the speaker uses an alias", () => {
    const canon = minimalCanon({
      entities: [
        {
          id: "character:amara",
          kind: "character",
          name: "Amara Okafor",
          aliases: ["Amara", "Mara"],
          description: "Journalist.",
          role: "protagonist",
          motivations: [],
          goals: [],
          firstIntroductionEpisode: null,
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
        },
      ],
      facts: [
        {
          id: "fact:secret",
          key: "entity-childhood-name",
          statement: "The entity knows Amara's childhood name.",
          classification: "AUTHOR_TRUTH",
          protected: true,
          subjectEntityIds: ["character:amara"],
          value: "",
          rolePhrase: "",
          literalKind: "none",
          audienceRevealEpisode: 3,
          certainPatterns: [],
          suspectedPatterns: [],
          forbiddenLiterals: [],
        },
      ],
      knowledge: [],
    });

    const text = "Mara: The entity knows Amara's childhood name.";
    const findings = validateKnowledge(canon, 1, text);
    expect(findings.some((f) => f.severity === "ERROR")).toBe(true);
  });
});