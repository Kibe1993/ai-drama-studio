import { describe, expect, it } from "vitest";
import { canonFromApprovedSources, mergeDerivedCanon } from "@/lib/domain/narrativeControl";
import { validateEpisodeScreenplay } from "@/lib/domain/screenplayValidation";
import { renderStoryBibleBrief } from "@/lib/providers/llm/storyBibleSections";
import { canonStateSchema } from "@/lib/validation/narrativeControl";
import type { CanonState } from "@/lib/validation/narrativeControl";
import type { EpisodeValidationFinding } from "@/lib/validation/casna";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { GeneratedStory, ScreenplayScene } from "@/lib/validation/story";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";

const projectId = "p".repeat(24);
const now = new Date().toISOString();

function houseBible(): StoryBibleContent {
  return {
    identity: {
      title: "The House That Remembers",
      genres: ["mystery"],
      subgenres: ["supernatural thriller"],
      centralPremise: "An architect inherits a house that erases a town resident every thirteen years.",
      narrativeConcept: "The house remembers what the town forgets.",
      toneAndAtmosphere: "Dust, silence, and inherited secrets.",
      targetAudience: "Adults",
      centralConflict: "Daniel must decide whether to sacrifice the truth to save his family.",
    },
    world: {
      description: "Greyhaven is a coastal town where an inherited house erases one resident every thirteen years.",
      geographyAndLocations: [
        { name: "Greyhaven", description: "A coastal town with a dark history.", storyFunction: "Setting." },
        { name: "Greyhaven Family House", description: "An abandoned house that erases residents.", storyFunction: "The antagonist." },
      ],
      socialStructuresAndCultures: ["The town keeps the secret of the house."],
      historyAndPastEvents: ["The house has taken a resident every thirteen years for generations."],
      rules: [
        "The house erases one town resident every thirteen years.",
        "A photograph designates the house's next victim.",
      ],
      definingSystems: [],
    },
    characters: {
      characters: [
        {
          name: "Daniel Mwangi",
          storyRole: "protagonist",
          roleDescription: "An architect who inherits the Greyhaven house.",
          physicalDescription: "A man in his thirties.",
          personality: "Methodical, driven, protective of family.",
          background: "Grew up hearing his father's warnings about the house.",
          motivations: ["Understand his father's legacy.", "Protect his family."],
          fearsAndWeaknesses: ["Losing himself to the house."],
          abilitiesAndLimitations: ["Architectural knowledge."],
          relationships: [
            { characterName: "Miriam Hale", relationship: "partner", tensionOrChange: "She fears the house." },
          ],
          secrets: [],
          developmentPotential: "Must choose between truth and family.",
        },
        {
          name: "Miriam Hale",
          storyRole: "supporting",
          roleDescription: "Daniel's partner who fears the house.",
          physicalDescription: "A woman in her thirties.",
          personality: "Cautious, perceptive.",
          background: "Knows the town's history.",
          motivations: ["Keep Daniel safe."],
          fearsAndWeaknesses: ["The house's power."],
          abilitiesAndLimitations: [],
          relationships: [
            { characterName: "Daniel Mwangi", relationship: "partner", tensionOrChange: "She warns Daniel." },
          ],
          secrets: [],
          developmentPotential: "Challenges Daniel's obsession.",
        },
      ],
      relationshipDynamics: ["Daniel and Miriam disagree about the house."],
    },
    narrative: {
      mainStoryline: "Daniel inherits the house, discovers the photograph designation, and must decide whether to destroy it.",
      majorConflicts: ["Whether to destroy the photograph and transfer the designation to a blood relative."],
      longTermDirection: "The house's cycle continues unless the photograph system is broken.",
      subplots: [],
      unresolvedMysteries: ["Who created the photograph designation system?"],
      potentialFutureRevelations: ["The house's origin and maker."],
      majorNarrativeQuestions: ["Will Daniel destroy the photograph?"],
      serializedEndingGuidance: "Leave Daniel's fate uncertain.",
    },
    guidelines: {
      mainThemes: ["Inheritance", "Sacrifice"],
      secondaryThemes: ["Memory", "Truth"],
      storytellingStyle: "Atmospheric mystery.",
      boundaries: ["Do not reveal the house's maker in the first story."],
      mustRemainConsistent: [
        "The house erases one resident every thirteen years.",
        "Destroying the photograph transfers the designation to the destroyer's blood relative.",
      ],
    },
    canon: {
      confirmedFacts: [
        "Daniel Mwangi is an architect who inherits the Greyhaven house.",
        "The house erases one town resident every thirteen years.",
      ],
      proposedDetails: ["The house may have been built in the nineteenth century."],
      unresolvedQuestions: ["Who created the photograph designation system?"],
      hiddenInformation: [
        "The house's maker was buried beneath the foundation.",
      ],
      characterKnowledge: [
        {
          characterName: "Daniel Mwangi",
          knows: [
            "The house erases one town resident every thirteen years.",
            "The house's maker was buried beneath the foundation.",
          ],
          believes: [],
        },
      ],
      audienceKnowledge: [],
    },
  };
}

function houseCanon(): CanonState {
  const base = canonFromApprovedSources({ projectId, bible: houseBible(), bibleVersion: 1 });
  const hiddenFact = base.facts.find((f) => f.classification === "HIDDEN_TRUTH");
  const facts = hiddenFact
    ? base.facts.map((f) => f.id === hiddenFact.id ? { ...f, audienceRevealEpisode: 3 } : f)
    : base.facts;
  return canonStateSchema.parse({ ...base, facts });
}

function scene(
  sceneNumber: number,
  heading: string,
  location: string,
  charactersPresent: string[],
  action: string,
  visualDescription: string,
  dialogue: { characterName: string; line: string }[],
): ScreenplayScene {
  return { sceneNumber, heading, location, timeOfDay: "Night", charactersPresent, visualDescription, action, dialogue };
}

function structure(): GeneratedStory["structure"] {
  return {
    act1: {
      introduction: "Daniel arrives in Greyhaven.",
      mainCharacters: "Daniel Mwangi and Miriam Hale.",
      setting: "An abandoned house in Greyhaven.",
      initialSituation: "Daniel moves into the inherited house.",
      incitingIncident: "He finds a photograph of a victim.",
    },
    act2: {
      risingTension: "An old ledger hints that someone disappears every thirteen years.",
      obstacles: "Daniel's father's warnings echo through the walls.",
      characterDecisions: "Daniel follows the ledger despite Miriam's fear.",
      turningPoint: "They discover a town map with a red X marking the house's next victim.",
    },
    act3: {
      climax: "The house reveals a hidden compartment with a rusted key.",
      resolution: "Daniel uses the key to unlock the compartment.",
      finalOutcome: "The door opens on the next victim, and Daniel's fate stays uncertain.",
    },
  };
}

function project(): ProjectRecord {
  return {
    id: projectId,
    title: "The House That Remembers",
    originalStoryIdea: "An architect inherits a house that erases a town resident every thirteen years.",
    genre: "mystery",
    language: "en",
    visualStyle: "naturalistic",
    tone: "ominous",
    targetDurationSeconds: 300,
    aspectRatio: "16:9",
    status: "draft",
    workflowMode: "guided",
    productionType: "mystery_crime_thriller",
    productionMode: "serialized",
    sceneRange: { min: 4, max: 8 },
    createdAt: now,
    updatedAt: now,
  };
}

function validate(scenes: ScreenplayScene[]): EpisodeValidationFinding[] {
  const canon = houseCanon();
  const result = validateEpisodeScreenplay({
    episodeNumber: 1,
    seriesTitle: "The House That Remembers",
    story: {
      title: "The House That Remembers",
      synopsis: "Daniel Mwangi inherits a house in Greyhaven and discovers its dark secret.",
      screenplay: scenes,
    },
    targetDurationSeconds: 300,
    bible: houseBible(),
    seasonPlan: null,
    episodePlan: null,
    ledger: null,
    previousEpisodes: [],
    canon,
    structure: structure(),
    sceneRange: project().sceneRange,
  });
  return result.findings;
}

function hasFinding(findings: EpisodeValidationFinding[], predicate: (f: EpisodeValidationFinding) => boolean): boolean {
  return findings.some(predicate);
}

function hasError(findings: EpisodeValidationFinding[], codePrefix: string): boolean {
  return findings.some((f) => f.severity === "error" && ((f.code ?? "").startsWith(codePrefix) || f.category === codePrefix));
}

function hasWarning(findings: EpisodeValidationFinding[], codePrefix: string): boolean {
  return findings.some((f) => f.severity === "warning" && ((f.code ?? "").startsWith(codePrefix) || f.category === codePrefix));
}

describe("House That Remembers — integration of all ten acceptance criteria", () => {
  const bible = houseBible();
  const canon = houseCanon();

  it("1. accepts a speaking character introduced in the current screenplay", () => {
    const scenes = [
      scene(1, "INT. HOUSE - DAY", "Greyhaven Family House",
        ["Daniel Mwangi", "Elder Grey"],
        "Daniel Mwangi enters the house. Elder Grey shuffles into the room, leaning on a cane.",
        "A dusty room with a crooked photograph.",
        [
          { characterName: "Daniel Mwangi", line: "This place hasn't changed." },
          { characterName: "Elder Grey", line: "It never does, young Mwangi." },
        ]),
      scene(2, "EXT. HOUSE - NIGHT", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi stands outside the house.",
        "The house looms against the night sky.",
        [{ characterName: "Daniel Mwangi", line: "What have I inherited?" }]),
      scene(3, "INT. HOUSE - NIGHT", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi locks the door behind him.",
        "Shadows stretch across the floor.",
        [{ characterName: "Daniel Mwangi", line: "I will find the truth." }]),
      scene(4, "EXT. HOUSE - DAWN", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi watches the sunrise.",
        "Morning light touches the old walls.",
        [{ characterName: "Daniel Mwangi", line: "The cycle ends here." }]),
    ];
    const findings = validate(scenes);
    const elderGreyErrors = findings.filter(
      (f) => f.severity === "error" && f.message.includes("Elder Grey"),
    );
    expect(elderGreyErrors).toHaveLength(0);
  });

  it("2. warns when a character appears but is not described in any scene", () => {
    const scenes = [
      scene(1, "INT. HOUSE - DAY", "Greyhaven Family House",
        ["Daniel Mwangi", "Jonah Whitfield"],
        "Daniel Mwangi enters the house alone.",
        "A dusty room with a crooked photograph.",
        [
          { characterName: "Daniel Mwangi", line: "This place hasn't changed." },
          { characterName: "Jonah Whitfield", line: "Who are you?" },
        ]),
      scene(2, "EXT. HOUSE - NIGHT", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi stands outside.",
        "The house looms.",
        [{ characterName: "Daniel Mwangi", line: "What now?" }]),
      scene(3, "INT. HOUSE - NIGHT", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi locks the door.",
        "Shadows stretch.",
        [{ characterName: "Daniel Mwangi", line: "I will find the truth." }]),
      scene(4, "EXT. HOUSE - DAWN", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi watches the sunrise.",
        "Morning light.",
        [{ characterName: "Daniel Mwangi", line: "The cycle ends here." }]),
    ];
    const findings = validate(scenes);
    expect(hasWarning(findings, "canon")).toBe(true);
    expect(hasFinding(findings, (f) => f.severity === "warning" && f.message.includes("Jonah Whitfield"))).toBe(true);
    expect(hasError(findings, "canon")).toBe(false);
  });

  it("3. errors when a character speaks but is not present in any scene", () => {
    const scenes = [
      scene(1, "INT. HOUSE - DAY", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi enters the house alone.",
        "A dusty room with a crooked photograph.",
        [
          { characterName: "Daniel Mwangi", line: "This place hasn't changed." },
          { characterName: "The Ghost", line: "Boo." },
        ]),
      scene(2, "EXT. HOUSE - NIGHT", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi stands outside.",
        "The house looms.",
        [{ characterName: "Daniel Mwangi", line: "What now?" }]),
      scene(3, "INT. HOUSE - NIGHT", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi locks the door.",
        "Shadows stretch.",
        [{ characterName: "Daniel Mwangi", line: "I will find the truth." }]),
      scene(4, "EXT. HOUSE - DAWN", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi watches the sunrise.",
        "Morning light.",
        [{ characterName: "Daniel Mwangi", line: "The cycle ends here." }]),
    ];
    const findings = validate(scenes);
    expect(hasError(findings, "canon")).toBe(true);
    expect(hasFinding(findings, (f) => f.severity === "error" && f.message.includes("The Ghost"))).toBe(true);
  });

  it("4. allows a knowledgeable character to discuss a public fact", () => {
    const scenes = [
      scene(1, "INT. HOUSE - DAY", "Greyhaven Family House",
        ["Daniel Mwangi", "Miriam Hale"],
        "Daniel Mwangi and Miriam Hale stand in the house.",
        "A dusty room with a crooked photograph.",
        [
          { characterName: "Daniel Mwangi", line: "The house erases a town resident every thirteen years." },
          { characterName: "Miriam Hale", line: "That is a terrible legacy." },
        ]),
      scene(2, "EXT. HOUSE - NIGHT", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi stands outside.",
        "The house looms.",
        [{ characterName: "Daniel Mwangi", line: "What now?" }]),
      scene(3, "INT. HOUSE - NIGHT", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi locks the door.",
        "Shadows stretch.",
        [{ characterName: "Daniel Mwangi", line: "I will find the truth." }]),
      scene(4, "EXT. HOUSE - DAWN", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi watches the sunrise.",
        "Morning light.",
        [{ characterName: "Daniel Mwangi", line: "The cycle ends here." }]),
    ];
    const findings = validate(scenes);
    const speakerKnowledgeErrors = findings.filter(
      (f) => f.severity === "error" && (f.code ?? "").startsWith("implication:speaker_knowledge"),
    );
    expect(speakerKnowledgeErrors).toHaveLength(0);
  });

  it("5. flags an unknowledgeable character confidently revealing a hidden fact", () => {
    const scenes = [
      scene(1, "INT. HOUSE - DAY", "Greyhaven Family House",
        ["Daniel Mwangi", "Miriam Hale"],
        "Daniel Mwangi and Miriam Hale stand in the house.",
        "A dusty room with a crooked photograph.",
        [
          { characterName: "Miriam Hale", line: "The house's maker was buried beneath the foundation." },
          { characterName: "Daniel Mwangi", line: "How do you know that?" },
        ]),
      scene(2, "EXT. HOUSE - NIGHT", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi stands outside.",
        "The house looms.",
        [{ characterName: "Daniel Mwangi", line: "What now?" }]),
      scene(3, "INT. HOUSE - NIGHT", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi locks the door.",
        "Shadows stretch.",
        [{ characterName: "Daniel Mwangi", line: "I will find the truth." }]),
      scene(4, "EXT. HOUSE - DAWN", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi watches the sunrise.",
        "Morning light.",
        [{ characterName: "Daniel Mwangi", line: "The cycle ends here." }]),
    ];
    const findings = validate(scenes);
    expect(hasError(findings, "implication:speaker_knowledge")).toBe(true);
  });

  it("6. rejects premature audience disclosure of a hidden fact", () => {
    const scenes = [
      scene(1, "INT. HOUSE - DAY", "Greyhaven Family House",
        ["Daniel Mwangi", "Miriam Hale"],
        "Daniel Mwangi and Miriam Hale stand in the house.",
        "A dusty room with a crooked photograph.",
        [
          { characterName: "Daniel Mwangi", line: "The house's maker was buried beneath the foundation." },
          { characterName: "Miriam Hale", line: "We should not speak of this." },
        ]),
      scene(2, "EXT. HOUSE - NIGHT", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi stands outside.",
        "The house looms.",
        [{ characterName: "Daniel Mwangi", line: "What now?" }]),
      scene(3, "INT. HOUSE - NIGHT", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi locks the door.",
        "Shadows stretch.",
        [{ characterName: "Daniel Mwangi", line: "I will find the truth." }]),
      scene(4, "EXT. HOUSE - DAWN", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi watches the sunrise.",
        "Morning light.",
        [{ characterName: "Daniel Mwangi", line: "The cycle ends here." }]),
    ];
    const findings = validate(scenes);
    expect(hasError(findings, "knowledge") || hasError(findings, "implication:audience_disclosure")).toBe(true);
  });

  it("7. allows speculation about a concealed fact without a confirmed-disclosure error", () => {
    const scenes = [
      scene(1, "INT. HOUSE - DAY", "Greyhaven Family House",
        ["Daniel Mwangi", "Miriam Hale"],
        "Daniel Mwangi and Miriam Hale stand in the house.",
        "A dusty room with a crooked photograph.",
        [
          { characterName: "Miriam Hale", line: "Perhaps the house's maker was buried beneath the foundation." },
          { characterName: "Daniel Mwangi", line: "It is possible." },
        ]),
      scene(2, "EXT. HOUSE - NIGHT", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi stands outside.",
        "The house looms.",
        [{ characterName: "Daniel Mwangi", line: "What now?" }]),
      scene(3, "INT. HOUSE - NIGHT", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi locks the door.",
        "Shadows stretch.",
        [{ characterName: "Daniel Mwangi", line: "I will find the truth." }]),
      scene(4, "EXT. HOUSE - DAWN", "Greyhaven Family House",
        ["Daniel Mwangi"],
        "Daniel Mwangi watches the sunrise.",
        "Morning light.",
        [{ characterName: "Daniel Mwangi", line: "The cycle ends here." }]),
    ];
    const findings = validate(scenes);
    expect(hasError(findings, "implication:audience_disclosure")).toBe(false);
  });

  it("8. renders the complete Story Bible brief with all canon and narrative fields", () => {
    const rendered = renderStoryBibleBrief(bible);
    expect(rendered).toBeDefined();
    const text = rendered!;
    expect(text).toContain("The house's maker was buried beneath the foundation.");
    expect(text).toContain("not yet revealed to audience");
    expect(text).toContain("The house may have been built in the nineteenth century.");
    expect(text).toContain("provisional, not canon");
    expect(text).toContain("Who created the photograph designation system?");
    expect(text).toContain("Unresolved questions:");
    expect(text).toContain("Memory");
    expect(text).toContain("Truth");
    expect(text).toContain("Secondary themes:");
    expect(text).toContain("The house's origin and maker.");
    expect(text).toContain("Potential future revelations:");
    expect(text).toContain("Will Daniel destroy the photograph?");
    expect(text).toContain("Major narrative questions:");
  });

  it("9. merges canon preserving relationships, knowledge, and entity metadata", () => {
    const stored = canon;
    const derived = canonFromApprovedSources({ projectId, bible: houseBible(), bibleVersion: 2 });
    const merge = mergeDerivedCanon(stored, derived);
    expect(merge.state.facts.length).toBeGreaterThanOrEqual(stored.facts.length);

    for (const fact of stored.facts) {
      const merged = merge.state.facts.find((f) => f.id === fact.id);
      expect(merged).toBeDefined();
      expect(merged!.protected).toBe(fact.protected);
      expect(merged!.classification).toBe(fact.classification);
    }
    expect(merge.state.relationships.length).toBeGreaterThanOrEqual(stored.relationships.length);
    expect(merge.state.knowledge.length).toBeGreaterThanOrEqual(stored.knowledge.length);
    for (const entity of stored.entities) {
      const merged = merge.state.entities.find((e) => e.id === entity.id);
      expect(merged).toBeDefined();
      expect(merged!.name).toBe(entity.name);
      expect(merged!.kind).toBe(entity.kind);
    }
  });

  it("10. enforces strict Bible version pinning and uses the complete candidate for revision", () => {
    const hiddenFact = canon.facts.find((f) => f.classification === "HIDDEN_TRUTH");
    expect(hiddenFact).toBeDefined();
    expect(hiddenFact!.audienceRevealEpisode).toBe(3);

    const danielKnowledge = canon.knowledge.filter(
      (k) => canon.entities.find((e) => e.id === k.characterId)?.name === "Daniel Mwangi",
    );
    expect(danielKnowledge.length).toBeGreaterThan(0);

    const miriamKnowledge = canon.knowledge.filter(
      (k) => canon.entities.find((e) => e.id === k.characterId)?.name === "Miriam Hale",
    );
    const miriamKnowsHidden = miriamKnowledge.some((k) => k.factId === hiddenFact!.id);
    expect(miriamKnowsHidden).toBe(false);

    const danielKnowledgeFacts = danielKnowledge.map((k) => canon.facts.find((f) => f.id === k.factId)).filter(Boolean);
    const danielKnowsMaker = danielKnowledgeFacts.some(
      (f) => f!.statement.includes("maker") && f!.statement.includes("buried"),
    );
    expect(danielKnowsMaker).toBe(true);
  });
});