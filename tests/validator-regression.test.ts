import { describe, expect, it } from "vitest";
import { canonStateSchema } from "@/lib/validation/narrativeControl";
import type { CanonState, NarrativeFact } from "@/lib/validation/narrativeControl";
import { makeFinding, dedupeFindings, type NarrativeFinding } from "@/lib/domain/narrativeControl/findings";
import { agreementFindings, draftConsistencyFindings } from "@/lib/domain/narrativeControl/agreement";
import { validateKnowledge } from "@/lib/domain/narrativeControl/implication";
import { validateEpisodeScreenplay } from "@/lib/domain/screenplayValidation";
import { canonFromApprovedSources } from "@/lib/domain/narrativeControl";
import type { StoryStructure, ScreenplayScene } from "@/lib/validation/story";
import type { StoryBibleContent } from "@/lib/validation/storyBible";

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
describe("current-episode character introductions", () => {
  function bibleWithDaniel(): StoryBibleContent {
    return {
      identity: {
        title: "Test",
        genres: ["drama"],
        subgenres: [],
        centralPremise: "A test story.",
        narrativeConcept: "Testing.",
        toneAndAtmosphere: "Neutral.",
        targetAudience: "Adults",
        centralConflict: "Test conflict.",
      },
      world: {
        description: "A test world.",
        geographyAndLocations: [
          { name: "Town", description: "A town.", storyFunction: "Setting." },
          { name: "Harbor", description: "A harbor.", storyFunction: "Location." },
        ],
        socialStructuresAndCultures: [],
        historyAndPastEvents: [],
        rules: [],
        definingSystems: [],
      },
      characters: {
        characters: [
          {
            name: "Daniel Mwangi",
            storyRole: "protagonist",
            roleDescription: "A man.",
            physicalDescription: "",
            personality: "Brave.",
            background: "A background.",
            motivations: [],
            fearsAndWeaknesses: [],
            abilitiesAndLimitations: [],
            relationships: [],
            secrets: [],
            developmentPotential: "",
          },
        ],
        relationshipDynamics: [],
      },
      narrative: {
        mainStoryline: "Test.",
        majorConflicts: [],
        longTermDirection: "Test.",
        subplots: [],
        unresolvedMysteries: [],
        potentialFutureRevelations: [],
        majorNarrativeQuestions: [],
        serializedEndingGuidance: "",
      },
      guidelines: {
        mainThemes: [],
        secondaryThemes: [],
        storytellingStyle: "Neutral.",
        boundaries: [],
        mustRemainConsistent: [],
      },
      canon: {
        confirmedFacts: [],
        proposedDetails: [],
        unresolvedQuestions: [],
        hiddenInformation: [],
        characterKnowledge: [],
        audienceKnowledge: [],
      },
    };
  }

  function scene(n: number, heading: string, location: string, present: string[], action: string, dialogue: { characterName: string; line: string }[]): ScreenplayScene {
    return {
      sceneNumber: n,
      heading,
      location,
      timeOfDay: "Day",
      charactersPresent: present,
      visualDescription: action,
      action,
      dialogue,
    };
  }

  function structure(): StoryStructure {
    return {
      act1: { introduction: "Intro.", mainCharacters: "Cast.", setting: "Town.", initialSituation: "Start.", incitingIncident: "Event." },
      act2: { risingTension: "Tension.", obstacles: "Obstacle.", characterDecisions: "Decision.", turningPoint: "Turn." },
      act3: { climax: "Climax.", resolution: "Resolution.", finalOutcome: "Outcome." },
    };
  }

  function validate(bible: StoryBibleContent, screenplay: ScreenplayScene[]) {
    const canon = canonFromApprovedSources({ projectId, bible, bibleVersion: 1 });
    return validateEpisodeScreenplay({
      episodeNumber: 1,
      seriesTitle: "Test",
      story: { title: "Test", synopsis: "A test story with enough text for validation.", screenplay },
      targetDurationSeconds: 180,
      bible,
      seasonPlan: null,
      episodePlan: null,
      ledger: null,
      previousEpisodes: [],
      canon,
      structure: structure(),
      sceneRange: { min: 3, max: 8 },
    });
  }

  it("accepts Elder Grey when properly introduced in the screenplay", () => {
    const bible = bibleWithDaniel();
    const screenplay = [
      scene(1, "INT. HARBOR - DAY", "Harbor", ["Daniel Mwangi", "Elder Grey"],
        "Daniel Mwangi walks into the harbor. Elder Grey, an elderly councilman, waits by the dock.",
        [{ characterName: "Daniel", line: "Good morning." }]),
      scene(2, "INT. HARBOR - DAY", "Harbor", ["Daniel Mwangi", "Elder Grey"],
        "Elder Grey gestures toward the sea.",
        [{ characterName: "Elder Grey", line: "The house takes one of us every thirteen years." }]),
      scene(3, "EXT. TOWN - NIGHT", "Town", ["Daniel Mwangi"],
        "Daniel walks home through the dark streets.",
        [{ characterName: "Daniel", line: "What have I done?" }]),
    ];
    const result = validate(bible, screenplay);
    const notIntroduced = result.findings.filter(
      (f) => f.severity === "error" && f.code === "canon" && f.message.includes("Elder Grey") && f.message.includes("not introduced"),
    );
    expect(notIntroduced).toHaveLength(0);
  });

  it("allows a newly introduced supporting character to speak after introduction", () => {
    const bible = bibleWithDaniel();
    const screenplay = [
      scene(1, "INT. TAVERN - DAY", "Town", ["Daniel Mwangi", "Captain Lyle"],
        "Daniel enters the tavern. Captain Lyle, a weathered sailor, sits at the bar nursing a drink.",
        [{ characterName: "Daniel", line: "I'm looking for information." }]),
      scene(2, "INT. TAVERN - DAY", "Town", ["Daniel Mwangi", "Captain Lyle"],
        "Captain Lyle looks up from his drink.",
        [{ characterName: "Captain Lyle", line: "Information costs." }]),
      scene(3, "EXT. TOWN - NIGHT", "Town", ["Daniel Mwangi"],
        "Daniel leaves the tavern.",
        [{ characterName: "Daniel", line: "Interesting man." }]),
    ];
    const result = validate(bible, screenplay);
    const notIntroduced = result.findings.filter(
      (f) => f.severity === "error" && f.message.includes("Captain Lyle") && f.message.includes("not introduced"),
    );
    expect(notIntroduced).toHaveLength(0);
  });

  it("detects a character appearing without introduction as a warning, not an error", () => {
    const bible = bibleWithDaniel();
    const screenplay = [
      scene(1, "INT. TAVERN - DAY", "Town", ["Daniel Mwangi", "Stranger"],
        "Daniel enters the tavern and looks around.",
        [{ characterName: "Daniel", line: "Hello." }, { characterName: "Stranger", line: "Hi." }]),
      scene(2, "EXT. TOWN - DAY", "Town", ["Daniel Mwangi"],
        "Daniel walks outside.",
        [{ characterName: "Daniel", line: "Odd." }]),
      scene(3, "EXT. TOWN - NIGHT", "Town", ["Daniel Mwangi"],
        "Daniel goes home.",
        [{ characterName: "Daniel", line: "Done." }]),
    ];
    const result = validate(bible, screenplay);
    const strangerFindings = result.findings.filter((f) => f.message.includes("Stranger"));
    expect(strangerFindings.length).toBeGreaterThan(0);
    expect(strangerFindings.every((f) => f.severity === "warning")).toBe(true);
  });

  it("reports an error for a speaker not present in any scene", () => {
    const bible = bibleWithDaniel();
    const screenplay = [
      scene(1, "INT. TAVERN - DAY", "Town", ["Daniel Mwangi"],
        "Daniel enters the tavern.",
        [{ characterName: "Daniel", line: "Hello." }, { characterName: "Ghost", line: "Boo." }]),
      scene(2, "EXT. TOWN - DAY", "Town", ["Daniel Mwangi"],
        "Daniel walks outside.",
        [{ characterName: "Daniel", line: "Odd." }]),
      scene(3, "EXT. TOWN - NIGHT", "Town", ["Daniel Mwangi"],
        "Daniel goes home.",
        [{ characterName: "Daniel", line: "Done." }]),
    ];
    const result = validate(bible, screenplay);
    const ghostFindings = result.findings.filter(
      (f) => f.severity === "error" && f.message.includes("Ghost") && f.message.includes("not introduced"),
    );
    expect(ghostFindings.length).toBeGreaterThan(0);
  });

  it("does not mistake an existing canonical character for a new character", () => {
    const bible = bibleWithDaniel();
    const screenplay = [
      scene(1, "INT. HARBOR - DAY", "Harbor", ["Daniel Mwangi"],
        "Daniel Mwangi arrives at the harbor.",
        [{ characterName: "Daniel Mwangi", line: "I'm here." }]),
      scene(2, "INT. HARBOR - DAY", "Harbor", ["Daniel Mwangi"],
        "Daniel looks at the sea.",
        [{ characterName: "Daniel", line: "The water is calm." }]),
      scene(3, "EXT. TOWN - NIGHT", "Town", ["Daniel Mwangi"],
        "Daniel walks home.",
        [{ characterName: "Daniel", line: "Done." }]),
    ];
    const result = validate(bible, screenplay);
    const danielFindings = result.findings.filter(
      (f) => f.message.includes("Daniel") && (f.message.includes("not introduced") || f.message.includes("not described")),
    );
    expect(danielFindings).toHaveLength(0);
  });

  it("does not automatically add an introduced character to approved canon", () => {
    const bible = bibleWithDaniel();
    const screenplay = [
      scene(1, "INT. HARBOR - DAY", "Harbor", ["Daniel Mwangi", "Elder Grey"],
        "Daniel Mwangi walks into the harbor. Elder Grey, an elderly councilman, waits by the dock.",
        [{ characterName: "Daniel", line: "Good morning." }]),
      scene(2, "INT. HARBOR - DAY", "Harbor", ["Daniel Mwangi", "Elder Grey"],
        "Elder Grey speaks.",
        [{ characterName: "Elder Grey", line: "Beware the house." }]),
      scene(3, "EXT. TOWN - NIGHT", "Town", ["Daniel Mwangi"],
        "Daniel walks home.",
        [{ characterName: "Daniel", line: "What have I done?" }]),
    ];
    const canon = canonFromApprovedSources({ projectId, bible, bibleVersion: 1 });
    const canonBefore = canon.entities.map((e) => e.name);
    validate(bible, screenplay);
    const canonAfter = canonFromApprovedSources({ projectId, bible, bibleVersion: 1 }).entities.map((e) => e.name);
    expect(canonAfter).toEqual(canonBefore);
    expect(canonAfter).not.toContain("Elder Grey");
  });
});
describe("speaker-specific and audience-specific knowledge validation", () => {
  function characterEntity(id: string, name: string, aliases: string[] = []) {
    return {
      id, kind: "character" as const, name, aliases,
      description: "", role: "supporting", motivations: [], goals: [],
      firstIntroductionEpisode: null, firstAppearanceEpisode: 1, appearances: [1],
      lifecycle: "active" as const, arc: "", secrets: [],
      permitsNonlivingAppearance: false, endedEpisode: null,
      ownerId: null, locationId: null, properties: [], significance: "",
      transfers: [], modifications: [], locationRules: [],
    };
  }

  function hiddenFact(id: string, statement: string, subjectIds: string[] = [], revealEpisode: number | null = null): NarrativeFact {
    return {
      id, key: id, statement, classification: "HIDDEN_TRUTH", protected: true,
      subjectEntityIds: subjectIds, value: "", rolePhrase: "", literalKind: "none",
      audienceRevealEpisode: revealEpisode, certainPatterns: [], suspectedPatterns: [],
      forbiddenLiterals: [],
    };
  }

  function canonWithSecret(overrides: Partial<CanonState> = {}): CanonState {
    return canonStateSchema.parse({
      schemaVersion: 1, projectId, version: 1, basedOnBibleVersion: 1, basedOnPlanVersion: 0,
      entities: [
        characterEntity("char:a", "Alice"),
        characterEntity("char:b", "Bob"),
      ],
      relationships: [], events: [], threads: [],
      facts: [hiddenFact("fact:secret", "The treasure is buried under the oak tree.", ["char:a"], 3)],
      knowledge: [
        { id: "k:a", characterId: "char:a", factId: "fact:secret", knownFromEpisode: 1, learnedVia: "Backstory", believes: true, certainty: "certain" as const, supportingEventId: null },
      ],
      rules: [], resolvedFindingSignatures: [], revisionLog: [],
      ...overrides,
    });
  }

  it("allows a character who knows a secret to discuss it when audience disclosure is permitted", () => {
    const canon = canonWithSecret({
      facts: [hiddenFact("fact:secret", "The treasure is buried under the oak tree.", ["char:a"], null)],
    });
    const text = "Alice: The treasure is buried under the oak tree.";
    const findings = validateKnowledge(canon, 1, text);
    const speakerErrors = findings.filter((f) => f.algorithm.includes("speaker_knowledge") && f.severity === "ERROR");
    expect(speakerErrors).toHaveLength(0);
  });

  it("flags a character who does not know a secret confidently revealing it", () => {
    const canon = canonWithSecret();
    const text = "Bob: The treasure is buried under the oak tree.";
    const findings = validateKnowledge(canon, 1, text);
    const speakerErrors = findings.filter((f) => f.algorithm.includes("speaker_knowledge") && f.severity === "ERROR");
    expect(speakerErrors.length).toBeGreaterThan(0);
    expect(speakerErrors.some((f) => f.explanation.includes("Bob"))).toBe(true);
  });

  it("rejects a concealed fact revealed to the audience before its permitted episode", () => {
    const canon = canonWithSecret();
    const text = "Alice: The treasure is buried under the oak tree.";
    const findings = validateKnowledge(canon, 1, text);
    const disclosureErrors = findings.filter((f) => f.algorithm.includes("audience_disclosure") && f.severity === "ERROR");
    expect(disclosureErrors.length).toBeGreaterThan(0);
  });

  it("allows speculation about a concealed fact without a confirmed-disclosure error", () => {
    const canon = canonWithSecret();
    const text = "Bob: Maybe the treasure is buried under the oak tree, perhaps.";
    const findings = validateKnowledge(canon, 1, text);
    const disclosureErrors = findings.filter((f) => f.algorithm.includes("audience_disclosure") && f.severity === "ERROR");
    expect(disclosureErrors).toHaveLength(0);
  });

  it("does not treat an already-disclosed fact as hidden", () => {
    const canon = canonWithSecret({
      facts: [hiddenFact("fact:secret", "The treasure is buried under the oak tree.", ["char:a"], 1)],
    });
    const text = "Alice: The treasure is buried under the oak tree.";
    const findings = validateKnowledge(canon, 1, text);
    const disclosureErrors = findings.filter((f) => f.algorithm.includes("audience_disclosure") && f.severity === "ERROR");
    expect(disclosureErrors).toHaveLength(0);
  });

  it("evaluates two characters with different knowledge records independently", () => {
    const canon = canonStateSchema.parse({
      schemaVersion: 1, projectId, version: 1, basedOnBibleVersion: 1, basedOnPlanVersion: 0,
      entities: [characterEntity("char:a", "Alice"), characterEntity("char:b", "Bob")],
      relationships: [], events: [], threads: [],
      facts: [hiddenFact("fact:secret", "The treasure is buried under the oak tree.", [], null)],
      knowledge: [
        { id: "k:a", characterId: "char:a", factId: "fact:secret", knownFromEpisode: 1, learnedVia: "Backstory", believes: true, certainty: "certain" as const, supportingEventId: null },
      ],
      rules: [], resolvedFindingSignatures: [], revisionLog: [],
    });
    const aliceText = "Alice: The treasure is buried under the oak tree.";
    const bobText = "Bob: The treasure is buried under the oak tree.";
    const aliceFindings = validateKnowledge(canon, 1, aliceText);
    const bobFindings = validateKnowledge(canon, 1, bobText);
    const aliceSpeaker = aliceFindings.filter((f) => f.algorithm.includes("speaker_knowledge") && f.severity === "ERROR");
    const bobSpeaker = bobFindings.filter((f) => f.algorithm.includes("speaker_knowledge") && f.severity === "ERROR");
    expect(aliceSpeaker).toHaveLength(0);
    expect(bobSpeaker.length).toBeGreaterThan(0);
  });

  it("never infers a character's knowledge from another character's knowledge", () => {
    const canon = canonWithSecret();
    const text = "Bob: The treasure is buried under the oak tree.";
    const findings = validateKnowledge(canon, 1, text);
    const bobErrors = findings.filter((f) => f.entityId === "char:b" && f.algorithm.includes("speaker_knowledge"));
    expect(bobErrors.length).toBeGreaterThan(0);
    const aliceErrors = findings.filter((f) => f.entityId === "char:a" && f.algorithm.includes("speaker_knowledge"));
    expect(aliceErrors).toHaveLength(0);
  });

  it("keeps audience knowledge and character knowledge distinct after Bible projection", () => {
    const bible: StoryBibleContent = {
      identity: {
        title: "Test", genres: ["drama"], subgenres: [],
        centralPremise: "Test.", narrativeConcept: "Test.", toneAndAtmosphere: "Test.",
        targetAudience: "Adults", centralConflict: "Test.",
      },
      world: {
        description: "Test.",
        geographyAndLocations: [
          { name: "Town", description: "A town.", storyFunction: "Setting." },
          { name: "Place", description: "A place.", storyFunction: "Place." },
        ],
        socialStructuresAndCultures: [], historyAndPastEvents: [], rules: [], definingSystems: [],
      },
      characters: {
        characters: [{
          name: "Alice", storyRole: "protagonist" as const, roleDescription: "A person.",
          physicalDescription: "", personality: "Brave.", background: "A background.",
          motivations: [], fearsAndWeaknesses: [], abilitiesAndLimitations: [],
          relationships: [], secrets: [], developmentPotential: "",
        }],
        relationshipDynamics: [],
      },
      narrative: {
        mainStoryline: "Test.", majorConflicts: [], longTermDirection: "Test.",
        subplots: [], unresolvedMysteries: [], potentialFutureRevelations: [],
        majorNarrativeQuestions: [], serializedEndingGuidance: "",
      },
      guidelines: {
        mainThemes: [], secondaryThemes: [], storytellingStyle: "Neutral.",
        boundaries: [], mustRemainConsistent: [],
      },
      canon: {
        confirmedFacts: [], proposedDetails: [], unresolvedQuestions: [],
        hiddenInformation: ["The treasure location is secret."],
        characterKnowledge: [{ characterName: "Alice", knows: ["The treasure is under the oak."], believes: [] }],
        audienceKnowledge: ["The town exists."],
      },
    };
    const canon = canonFromApprovedSources({ projectId, bible, bibleVersion: 1 });
    const audienceFacts = canon.facts.filter((f) => f.classification === "AUDIENCE_KNOWLEDGE");
    const characterFacts = canon.facts.filter((f) => f.classification === "CHARACTER_KNOWLEDGE");
    const hiddenFacts = canon.facts.filter((f) => f.classification === "HIDDEN_TRUTH");
    expect(audienceFacts.length).toBeGreaterThan(0);
    expect(audienceFacts.some((f) => f.statement.includes("town exists"))).toBe(true);
    expect(characterFacts.length).toBeGreaterThan(0);
    expect(characterFacts.some((f) => f.statement.includes("treasure is under the oak"))).toBe(true);
    expect(hiddenFacts.some((f) => f.statement.includes("treasure location is secret"))).toBe(true);
    expect(audienceFacts.every((f) => f.classification === "AUDIENCE_KNOWLEDGE")).toBe(true);
    expect(characterFacts.every((f) => f.classification === "CHARACTER_KNOWLEDGE")).toBe(true);
  });
});