import { describe, expect, it } from "vitest";
import { canonFromApprovedSources } from "@/lib/domain/narrativeControl";
import { validateEpisodeScreenplay } from "@/lib/domain/screenplayValidation";
import type { EpisodeValidation, EpisodeValidationFinding } from "@/lib/validation/casna";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { GeneratedStory, ScreenplayScene, StoryStructure } from "@/lib/validation/story";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";

const projectId = "p".repeat(24);
const now = new Date().toISOString();

function houseBible(): StoryBibleContent {
  return {
    identity: {
      title: "The House That Remembers",
      genres: ["mystery"],
      subgenres: ["supernatural thriller"],
      centralPremise: "An architect inherits a house that erases a town resident every thirteen years, and must decide whether to sacrifice the truth to save his family.",
      narrativeConcept: "The house remembers what the town forgets.",
      toneAndAtmosphere: "Dust, silence, and inherited secrets.",
      targetAudience: "Adults",
      centralConflict: "Daniel must decide whether to sacrifice the truth to save his family or let the house consume him.",
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
        "Destroying the photograph prevents the erasure but transfers the designation to the destroyer's blood relative.",
        "Only a blood relative of the designated victim may safely destroy the photograph.",
      ],
      definingSystems: [
        {
          name: "Photograph Designation",
          description: "A framed photograph identifies the next victim.",
          limitations: ["The photograph cannot be removed from the house."],
          consequences: ["Destroying the photograph transfers the designation to the destroyer's blood relative."],
        },
      ],
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
            { characterName: "Miriam", relationship: "partner", tensionOrChange: "She fears the house." },
            { characterName: "Ruth", relationship: "family", tensionOrChange: "Ruth never lived in Greyhaven." },
          ],
          secrets: [],
          developmentPotential: "Must choose between truth and family.",
        },
        {
          name: "Miriam",
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
        {
          name: "Ruth",
          storyRole: "supporting",
          roleDescription: "A family member who never lived in Greyhaven.",
          physicalDescription: "",
          personality: "Gentle, distant.",
          background: "Connected to Daniel's family but outside Greyhaven.",
          motivations: [],
          fearsAndWeaknesses: [],
          abilitiesAndLimitations: [],
          relationships: [
            { characterName: "Daniel Mwangi", relationship: "family", tensionOrChange: "She appears in the photograph." },
          ],
          secrets: [],
          developmentPotential: "Her identity is tied to the photograph.",
        },
      ],
      relationshipDynamics: ["Daniel and Miriam disagree about the house.", "Ruth is connected to Daniel through family."],
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
        "A photograph designates the house's next victim.",
        "Ruth never lived in Greyhaven.",
        "Destroying the photograph transfers the designation to the destroyer's blood relative.",
      ],
      proposedDetails: [],
      unresolvedQuestions: ["Who created the photograph designation system?"],
      hiddenInformation: [
        "The house's maker and origin are unknown to all characters.",
      ],
      characterKnowledge: [
        { characterName: "Daniel Mwangi", knows: ["His father warned him about the house."], believes: [] },
        { characterName: "Miriam", knows: ["The house takes one of us every thirteen years."], believes: [] },
      ],
      audienceKnowledge: [],
    },
  };
}

function houseStory(): GeneratedStory {
  const description = "Dust motes dance in shafts of early light through the abandoned Greyhaven house, and a single framed photograph hangs crooked on the wall.";
  const scene = (sceneNumber: number, heading: string, location: string, dialogue: { characterName: string; line: string }[]): ScreenplayScene => ({
    sceneNumber,
    heading,
    location,
    timeOfDay: "Night",
    charactersPresent: dialogue.map((line) => line.characterName),
    visualDescription: description,
    action: description,
    dialogue,
  });
  return {
    title: "The House That Remembers",
    synopsis: "When architect Daniel Mwangi inherits an abandoned house in Greyhaven, the house erases a town resident every thirteen years. He must decide whether to sacrifice the truth to save his family or let the house consume him.",
    structure: {
      act1: {
        introduction: "Daniel arrives in Greyhaven.",
        mainCharacters: "Daniel Mwangi, Miriam, and Ruth.",
        setting: "An abandoned house in Greyhaven.",
        initialSituation: "Daniel moves into the inherited house.",
        incitingIncident: "He finds a photograph of Ruth, who never lived in Greyhaven.",
      },
      act2: {
        risingTension: "An old ledger hints that someone disappears every thirteen years.",
        obstacles: "Daniel's father's warnings echo through the walls.",
        characterDecisions: "Daniel follows the ledger despite Miriam's fear.",
        turningPoint: "They discover a town map with a red X marking the house's next victim.",
      },
      act3: {
        climax: "The house reveals a hidden compartment with a rusted key.",
        resolution: "Daniel uses the key to unlock the compartment and triggers the countdown.",
        finalOutcome: "The door opens on the next victim, and Daniel's fate stays uncertain.",
      },
    },
    screenplay: [
      scene(1, "INT. GREYHAVEN FAMILY HOUSE - LIVING ROOM - DAWN", "Greyhaven Family House", [
        { characterName: "Daniel", line: "Ruth? She never came to Greyhaven." },
        { characterName: "Miriam", line: "It's a house, Daniel. Not a museum." },
      ]),
      scene(2, "INT. GREYHAVEN FAMILY HOUSE - STUDY - AFTERNOON", "Greyhaven Family House", [
        { characterName: "Miriam", line: "Every thirteen years it takes one of us." },
      ]),
      scene(3, "EXT. GREYHAVEN FAMILY HOUSE - FRONT YARD - SUNSET", "Greyhaven Family House", [
        { characterName: "Daniel", line: "This key was in my father's desk." },
      ]),
      scene(4, "INT. GREYHAVEN FAMILY HOUSE - BASEMENT - MIDNIGHT", "Greyhaven Family House", [
        { characterName: "Daniel", line: "Here goes nothing." },
      ]),
      scene(5, "INT. GREYHAVEN FAMILY HOUSE - SECRET CHAMBER - MIDNIGHT", "Greyhaven Family House", [
        { characterName: "Daniel", line: "Ruth, I'm sorry." },
      ]),
      scene(6, "EXT. GREYHAVEN FAMILY HOUSE - FRONT YARD - DAWN", "Greyhaven Family House", [
        { characterName: "Daniel", line: "Not again." },
      ]),
    ],
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
    sceneRange: { min: 6, max: 8 },
    createdAt: now,
    updatedAt: now,
  };
}

function classifyFinding(finding: EpisodeValidationFinding): string {
  return `[${finding.severity.toUpperCase()}] ${finding.code ?? finding.category}${finding.sceneNumber ? ` (scene ${finding.sceneNumber})` : ""}: ${finding.message}`;
}

describe("House That Remembers — validation diagnostic", () => {
  const bible = houseBible();
  const canon = canonFromApprovedSources({ projectId, bible, bibleVersion: 1 });
  const story = houseStory();
  const validation = validateEpisodeScreenplay({
    episodeNumber: 1,
    seriesTitle: "The House That Remembers",
    story: { title: story.title, synopsis: story.synopsis, screenplay: story.screenplay },
    targetDurationSeconds: 300,
    bible,
    seasonPlan: null,
    episodePlan: null,
    ledger: null,
    previousEpisodes: [],
    canon,
    structure: story.structure,
    sceneRange: project().sceneRange,
    requireCanonCoverage: true,
  });

  it("dumps all findings for analysis", () => {
    const errors = validation.findings.filter((f) => f.severity === "error");
    const warnings = validation.findings.filter((f) => f.severity === "warning");
    console.log("\n=== VALIDATION SUMMARY ===");
    console.log(`Passed: ${validation.passed}`);
    console.log(`Total findings: ${validation.findings.length}`);
    console.log(`Errors: ${errors.length}`);
    console.log(`Warnings: ${warnings.length}`);
    console.log(`Narrative decision: ${validation.narrativeDecision ?? "none"}`);
    console.log(`Narrative layers: ${(validation.narrativeValidationLayers ?? []).join(", ")}`);

    console.log("\n=== BLOCKING FINDINGS (errors) ===");
    for (const finding of errors) {
      console.log(`\n--- ${finding.id ?? "no-id"} ---`);
      console.log(`Code: ${finding.code ?? "none"}`);
      console.log(`Category: ${finding.category}`);
      console.log(`Scene: ${finding.sceneNumber ?? "none"}`);
      console.log(`Message: ${finding.message}`);
      if (finding.title) console.log(`Title: ${finding.title}`);
      if (finding.evidence) console.log(`Evidence: ${finding.evidence}`);
      if (finding.expected) console.log(`Expected: ${finding.expected}`);
      if (finding.actual) console.log(`Actual: ${finding.actual}`);
      if (finding.suggestedCorrection) console.log(`Suggested: ${finding.suggestedCorrection}`);
      if (finding.confidence) console.log(`Confidence: ${finding.confidence}`);
      if (finding.requiresCanonAuthorization !== undefined) console.log(`Requires auth: ${finding.requiresCanonAuthorization}`);
      if (finding.automaticRepairSafe !== undefined) console.log(`Auto-repair safe: ${finding.automaticRepairSafe}`);
    }

    console.log("\n=== WARNINGS ===");
    for (const finding of warnings) {
      console.log(`\n--- ${finding.id ?? "no-id"} ---`);
      console.log(`Code: ${finding.code ?? "none"}`);
      console.log(`Category: ${finding.category}`);
      console.log(`Scene: ${finding.sceneNumber ?? "none"}`);
      console.log(`Message: ${finding.message}`);
    }

    console.log("\n=== CANON ENTITIES ===");
    for (const entity of canon.entities) {
      console.log(`  ${entity.id} (${entity.kind}): ${entity.name} — aliases: [${entity.aliases.join(", ")}]`);
    }

    console.log("\n=== CANON FACTS ===");
    for (const fact of canon.facts) {
      console.log(`  ${fact.id} [${fact.classification}] protected=${fact.protected}: ${fact.statement}`);
    }

    console.log("\n=== CANON RULES ===");
    for (const rule of canon.rules) {
      console.log(`  ${rule.id}: ${rule.description} (interval: ${JSON.stringify(rule.canonicalInterval)})`);
    }

    console.log("\n=== CANON KNOWLEDGE ===");
    for (const entry of canon.knowledge) {
      const character = canon.entities.find((e) => e.id === entry.characterId);
      const fact = canon.facts.find((f) => f.id === entry.factId);
      console.log(`  ${character?.name ?? entry.characterId} knows [${entry.certainty}]: ${fact?.statement ?? entry.factId}`);
    }

    expect(validation.findings.length).toBeGreaterThan(0);
  });

  it("groups findings by code", () => {
    const byCode = new Map<string, EpisodeValidationFinding[]>();
    for (const finding of validation.findings.filter((f) => f.severity === "error")) {
      const code = finding.code ?? finding.category;
      const group = byCode.get(code) ?? [];
      group.push(finding);
      byCode.set(code, group);
    }
    console.log("\n=== ERRORS GROUPED BY CODE ===");
    for (const [code, findings] of [...byCode.entries()].sort()) {
      console.log(`\n${code} (${findings.length} findings):`);
      for (const f of findings) {
        console.log(`  - scene ${f.sceneNumber ?? "?"}: ${f.message.slice(0, 120)}`);
      }
    }
    expect(byCode.size).toBeGreaterThan(0);
  });
});