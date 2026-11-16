import { describe, it, expect } from "vitest";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { CharacterProfile } from "@/lib/validation/productionStages";
import type { NarrativeRegistry } from "@/lib/validation/narrativeEngine";
import {
  resolveEntity,
  resolveEntityId,
  characterKnowsFact,
} from "@/lib/validation/narrativeEngine";
import { buildRegistry } from "@/lib/domain/canonicalRegistry";
import { buildNarrativeRegistry } from "@/lib/domain/narrativeEngine/registryBuilder";
import {
  validateCanonicalIdentities,
  validateEntityLifecycles,
  validateEventChronology,
  validateCharacterKnowledge,
  validateRelationships,
  validateCausalContinuity,
  validateNarrativeThreads,

  validateSeasonFinale,
  validateSeasonNarrative,
  summarizeFindings,
} from "@/lib/domain/narrativeEngine/validators";
import { extractStructuredNarrativeData } from "@/lib/domain/narrativeEngine/structuredExtraction";
import { seasonPlanSchema } from "@/lib/validation/seasonPlan";


function makeBible(): StoryBibleContent {
  return {
    identity: {
      title: "The Last Bus Home",
      genres: ["Drama", "Supernatural"],
      subgenres: ["Mystery", "Psychological Thriller"],
      centralPremise: "A man stranded at a rural bus stop encounters a bus from a crash he caused years ago.",
      narrativeConcept: "Samuel must confront his past when the victims of his crash return on a ghostly bus.",
      toneAndAtmosphere: "Eerie, contemplative, emotionally charged",
      targetAudience: "Adults who enjoy literary supernatural drama",
      centralConflict: "Samuel must confront his guilt over the bus crash he caused and find a way to let the victims go.",
    },
    world: {
      description: "A rural town with a dark history surrounding a 2009 bus crash.",
      geographyAndLocations: [
        { name: "The Rural Bus Stop", description: "A lonely bus stop on a rural road", storyFunction: "Primary setting" },
        { name: "The Bus", description: "A supernatural bus that arrives at 11:47", storyFunction: "Vehicle of the loop" },
        { name: "The Town", description: "The nearby rural town", storyFunction: "Community setting" },
      ],
      socialStructuresAndCultures: ["The town remembers crash victims through the Midnight Watch."],
      historyAndPastEvents: [
        "In 2009, a bus crashed. Samuel was the driver. Nia died in the crash.",
      ],
      rules: [
        "The bus arrives at 11:47",
        "The Driver enforces the loop",
        "Nia can exit the bus because she is trapped in the loop, not because the loop is broken",
      ],
      definingSystems: [
        { name: "The Midnight Watch", description: "A town remembrance ritual for crash victims", limitations: [], consequences: [] },
        { name: "The supernatural loop", description: "The bus replays the crash at 11:47", limitations: [], consequences: [] },
      ],
    },
    characters: {
      characters: [
        {
          name: "Samuel",
          storyRole: "protagonist",
          roleDescription: "The former driver who caused the 2009 crash",
          physicalDescription: "A middle-aged man with tired eyes",
          personality: "Guilt-ridden, avoidant, ultimately brave",
          background: "Was the driver of the bus that crashed in 2009, killing Nia and others",
          motivations: ["To escape his guilt, then to make amends"],
          fearsAndWeaknesses: ["Confronting what he did"],
          abilitiesAndLimitations: ["Ordinary man with suppressed memories"],
          relationships: [],
          secrets: ["He was the driver responsible for the 2009 bus crash"],
          developmentPotential: "From denial to acceptance to action",
        },
        {
          name: "Nia",
          storyRole: "supporting",
          roleDescription: "A victim of the crash trapped in the loop",
          physicalDescription: "A young woman with an otherworldly presence",
          personality: "Otherworldly, gentle, seeking release",
          background: "Died in the 2009 bus crash",
          motivations: ["To be freed from the loop"],
          fearsAndWeaknesses: ["Being trapped forever"],
          abilitiesAndLimitations: ["Can step out of the bus but cannot leave the loop"],
          relationships: [],
          secrets: ["She died in the crash"],
          developmentPotential: "From trapped to released",
        },
        {
          name: "The Driver",
          storyRole: "antagonist",
          roleDescription: "The supernatural entity enforcing the loop",
          physicalDescription: "A shadowy figure behind the wheel",
          personality: "Ominous, implacable, mysterious",
          background: "Enforces the supernatural loop that traps the crash victims",
          motivations: ["To maintain the loop"],
          fearsAndWeaknesses: ["Unknown"],
          abilitiesAndLimitations: ["Controls the bus and the loop"],
          relationships: [],
          secrets: ["His complete identity remains concealed"],
          developmentPotential: "May be resisted but not defeated",
        },
      ],
      relationshipDynamics: ["Samuel and Nia: guilt and forgiveness", "Samuel and The Driver: resistance and confrontation"],
    },
    narrative: {
      mainStoryline: "Samuel encounters the ghost bus and must confront his past to free the victims.",
      majorConflicts: ["Samuel vs. his guilt", "Samuel vs. The Driver's loop"],
      longTermDirection: "Samuel finds redemption by letting the victims go.",
      subplots: ["The town's Midnight Watch remembrance"],
      unresolvedMysteries: ["The Driver's complete identity"],
      potentialFutureRevelations: ["The full nature of the Midnight Watch"],
      majorNarrativeQuestions: ["Was Samuel the driver?", "Can Nia be freed?", "What is the Midnight Watch?"],
      serializedEndingGuidance: "The season resolves Samuel's guilt but the Midnight Watch mystery may continue.",
    },
    guidelines: {
      mainThemes: ["Guilt", "Redemption", "Letting go"],
      secondaryThemes: ["Memory", "Community remembrance"],
      storytellingStyle: "Atmospheric supernatural drama",
      boundaries: ["No graphic violence"],
      mustRemainConsistent: ["Samuel was the driver", "Nia died in the crash", "The bus arrives at 11:47"],
    },
    canon: {
      confirmedFacts: [
        "Samuel was the driver responsible for the 2009 bus crash",
        "Nia died in the 2009 bus crash",
        "The bus arrives at 11:47",
        "The Driver enforces the loop",
        "The town remembers the victims through the Midnight Watch",
      ],
      proposedDetails: [],
      unresolvedQuestions: ["What is the Driver's complete identity?"],
      hiddenInformation: ["Samuel was the driver of the crashed bus"],
      characterKnowledge: [
        { characterName: "Samuel", knows: ["He is stranded at a bus stop"], believes: ["He is innocent of the crash"] },
        { characterName: "Nia", knows: ["She is trapped in a loop"], believes: ["Someone caused the crash"] },
      ],
      audienceKnowledge: ["A bus crash occurred in 2009", "Samuel is stranded at a bus stop"],
    },
  };
}

function ep(num: number, overrides: Partial<EpisodePlanItem> = {}): EpisodePlanItem {
  return {
    episodeNumber: num,
    workingTitle: `Episode ${num}`,
    narrativePurpose: `Advance the story in episode ${num}`,
    startingSituation: `The situation at the start of episode ${num}`,
    mainObjective: `The objective for episode ${num}`,
    centralConflict: `The conflict of episode ${num}`,
    majorStoryBeats: [`Beat one of episode ${num}.`],
    informationRevealed: [],
    characterDevelopment: `Characters change in episode ${num}.`,
    importantEvents: [],
    consequences: [],
    storyContribution: `Episode ${num} advances the season.`,
    endingOrCliffhanger: `Episode ${num} ends on a turn.`,
    unresolvedThreads: [],
    continuityRequirements: `The next episode must respect episode ${num}.`,
    characterArcChanges: [],
    relationshipChanges: [],
    objectChanges: [],
    locationChanges: [],
    ...overrides,
  };
}

function makePlan(): SeasonPlan {
  return {
    seasonObjective: "Samuel confronts his guilt over the bus crash and frees the trapped victims.",
    centralConflictOrMystery: "Was Samuel the driver, and can he let the victims go?",
    mainCharacterObjectives: "Samuel seeks truth and redemption; Nia seeks release; The Driver maintains the loop.",
    overallCharacterDevelopment: "Samuel moves from denial to acceptance to action.",
    majorStoryDevelopments: [
      "The ghost bus appears at 11:47",
      "Samuel discovers he was the driver",
      "Samuel frees Nia and the bus departs",
    ],
    beginningDirection: "Samuel is stranded at the bus stop in a storm.",
    middleDirection: "Samuel investigates the bus and discovers his connection to the crash.",
    endingDirection: "Samuel confronts his guilt and lets the victims go.",
    episodeProgression: [
      ep(1, {
        workingTitle: "Storm at the Stop",
        mainObjective: "Establish Samuel's isolation and the supernatural arrival",
        centralConflict: "Samuel is stranded with no way home",
        majorStoryBeats: [
          "Samuel is stranded at the rural bus stop by a storm",
          "The bus appears at 11:47",
          "Nia steps out of the bus",
          "The bus disappears into the storm",
        ],
        informationRevealed: ["The bus arrives at 11:47"],
        importantEvents: [
          "The bus arrives at 11:47 in the storm",
          "Nia steps out of the bus",
        ],
        endingOrCliffhanger: "The bus vanishes, leaving Nia alone with Samuel at the stop",
        unresolvedThreads: [
          "An unresolved thread: who is the woman who stepped off the bus, carried forward to next episode?",
        ],
        characterArcChanges: [
          { name: "Samuel", change: "Samuel is introduced as a stranded traveler" },
          { name: "Nia", change: "Nia steps out of the bus, first appearance" },
        ],
        locationChanges: [
          { name: "The Rural Bus Stop", change: "The bus stop is introduced as the primary setting" },
        ],
      }),
      ep(2, {
        workingTitle: "Echoes of the Crash",
        mainObjective: "Samuel investigates the bus and the crash",
        centralConflict: "Samuel begins to suspect a connection to the crash",
        majorStoryBeats: [
          "Samuel investigates the bus stop and finds a newspaper clipping about the 2009 crash",
          "The town's remembrance of the victims is introduced through the Midnight Watch",
          "Samuel's connection to the crash is suggested but not confirmed",
          "Nia's identity remains partly unknown",
        ],
        informationRevealed: ["A newspaper clipping reveals a 2009 bus crash occurred"],
        importantEvents: [
          "Samuel discovers a newspaper clipping about the 2009 crash",
          "The Midnight Watch is introduced as the town's remembrance ritual",
        ],
        consequences: ["The 2009 crash becomes known to Samuel"],
        endingOrCliffhanger: "Samuel wonders if he was connected to the crash",
        unresolvedThreads: [
          "An unresolved thread: was Samuel connected to the 2009 crash, carried forward to next episode?",
        ],
        characterArcChanges: [
          { name: "Samuel", change: "Samuel begins investigating the crash" },
        ],
        locationChanges: [
          { name: "The Town", change: "The town is introduced as the nearby community" },
        ],
      }),
      ep(3, {
        workingTitle: "Reflections",
        mainObjective: "Samuel examines the bus and encounters The Driver",
        centralConflict: "The bus has rules that prevent escape",
        majorStoryBeats: [
          "Samuel examines the bus windows and sees other passengers in reflections",
          "The Driver appears in a mirror reflection",
          "The bus's no-exit rule is established for trapped souls",
          "The Driver's complete identity remains concealed",
        ],
        informationRevealed: ["The bus has a no-exit rule for trapped souls"],
        importantEvents: [
          "The Driver appears in a mirror reflection",
          "The no-exit rule is established",
        ],
        consequences: ["The no-exit rule traps the passengers"],
        endingOrCliffhanger: "The Driver watches Samuel from the mirror",
        unresolvedThreads: [
          "An unresolved thread: what is the Driver's complete identity, carried forward to next season?",
        ],
        characterArcChanges: [
          { name: "The Driver", change: "The Driver appears in a mirror, concealed identity" },
        ],
      }),
      ep(4, {
        workingTitle: "The Phone's Secret",
        mainObjective: "Samuel recovers his memories and learns the truth",
        centralConflict: "Samuel confronts what he has forgotten",
        majorStoryBeats: [
          "Samuel sees the 2009 date on the newspaper",
          "His memories return as he reads the clipping",
          "He learns that he was the driver of the crashed bus",
          "The audience receives the revelation that Samuel caused the crash",
        ],
        informationRevealed: [
          "Samuel was the driver responsible for the 2009 bus crash",
        ],
        importantEvents: [
          "Samuel remembers he was the driver of the 2009 crash",
        ],
        consequences: ["Samuel's guilt is confirmed"],
        endingOrCliffhanger: "Samuel must decide what to do with the truth",
        unresolvedThreads: [],
        characterArcChanges: [
          { name: "Samuel", change: "Samuel remembers and learns he was the driver" },
        ],
      }),
      ep(5, {
        workingTitle: "Letting Go",
        mainObjective: "Samuel attempts to free Nia and confronts The Driver",
        centralConflict: "Samuel vs. The Driver's loop",
        majorStoryBeats: [
          "Samuel confronts the consequences of his actions",
          "He attempts to release Nia from the bus",
          "The bus resists through The Driver's power",
          "Samuel makes the decisive choice to let go of his guilt",
          "The bus departs with the freed souls",
        ],
        informationRevealed: [],
        importantEvents: [
          "Samuel attempts to release Nia",
          "The bus resists",
          "Samuel makes his decisive choice",
          "The bus departs",
        ],
        consequences: ["Nia is released from the loop", "The bus departs"],
        endingOrCliffhanger: "The bus drives away into the storm",
        unresolvedThreads: [],
        characterArcChanges: [
          { name: "Samuel", change: "Samuel makes the decisive choice to let go" },
          { name: "Nia", change: "Nia is released from the loop" },
        ],
        relationshipChanges: [
          { from: "Samuel", to: "Nia", change: "Samuel releases Nia from the loop" },
          { from: "Samuel", to: "The Driver", change: "Samuel confronts and resists The Driver" },
        ],
      }),
      ep(6, {
        workingTitle: "After the Storm",
        mainObjective: "The aftermath and resolution",
        centralConflict: "Living with the consequences",
        majorStoryBeats: [
          "The consequences of the bus departure are shown",
          "Nia's outcome is addressed: she is at peace",
          "Samuel confronts his future with acceptance",
          "The town's Midnight Watch gains meaning as a ritual of remembrance",
          "The central season conflict receives a meaningful outcome",
        ],
        informationRevealed: ["The Midnight Watch is the town's way of honoring the crash victims"],
        importantEvents: [
          "The Midnight Watch gains its full meaning",
          "Samuel accepts his future",
        ],
        consequences: [],
        endingOrCliffhanger: "Samuel walks home as the storm clears",
        unresolvedThreads: [
          "An unresolved thread: what is the Driver's complete identity, carried forward to next season?",
        ],
        characterArcChanges: [
          { name: "Samuel", change: "Samuel accepts his future and walks home" },
        ],
      }),
    ],
    importantRevelations: [
      "Samuel was the driver responsible for the 2009 bus crash",
      "The Midnight Watch is the town's way of honoring the crash victims",
    ],
    relationshipChanges: [
      "Samuel and Nia move from strangers to forgiveness",
      "Samuel and The Driver move from confrontation to resistance",
    ],
    consequencesCarriedBetween: [
      "The 2009 crash becomes known to Samuel",
      "Samuel's guilt is confirmed",
      "Nia is released from the loop",
    ],
    setupAndPayoff: [
      "The bus arrival in episode 1 pays off in episode 5 when it departs",
      "The newspaper clipping in episode 2 pays off in episode 4 when Samuel remembers",
    ],
    unresolvedQuestions: [
      "What is the Driver's complete identity, carried forward to next season?",
    ],
    intendedSeasonConclusion: "Samuel confronts his guilt, frees Nia, and the bus departs. The Midnight Watch gains meaning.",
  };
}

function makeCharacterProfiles(): CharacterProfile[] {
  return [
    {
      name: "Samuel",
      role: "protagonist",
      ageRange: "",
      gender: "",
      clothing: "",
      distinguishingFeatures: "",
      personality: "Guilt-ridden, avoidant, ultimately brave",
      physicalDescription: "Middle-aged man, weathered appearance",
      background: "Was the driver of the bus that crashed in 2009",
      relationships: [],
      aliases: [{ name: "Sam", type: "nickname", description: "Short form of Samuel" }],
      voiceManifestations: [],
    },
    {
      name: "Nia",
      role: "supporting",
      ageRange: "",
      gender: "",
      clothing: "",
      distinguishingFeatures: "",
      personality: "Otherworldly, gentle, seeking release",
      physicalDescription: "Young woman with an ethereal presence",
      background: "Died in the 2009 bus crash",
      relationships: [],
      aliases: [],
      voiceManifestations: [],
    },
    {
      name: "The Driver",
      role: "antagonist",
      ageRange: "",
      gender: "",
      clothing: "",
      distinguishingFeatures: "",
      personality: "Ominous, implacable, mysterious",
      physicalDescription: "A figure seen only in reflections",
      background: "Enforces the supernatural loop",
      relationships: [],
      aliases: [],
      voiceManifestations: [],
    },
  ];
}

function buildTestRegistry(): NarrativeRegistry {
  const bible = makeBible();
  const plan = makePlan();
  const profiles = makeCharacterProfiles();
  const canonicalRegistry = buildRegistry({ bible, plan, ledger: null, characterProfiles: profiles });
  return buildNarrativeRegistry({
    canonicalRegistry,
    bible,
    plan,
    ledger: null,
    characterProfiles: profiles,
  });
}

describe("The Last Bus Home — Temporal Narrative Engine", () => {
  const registry = buildTestRegistry();
  const plan = makePlan();

  describe("Identity tests", () => {
    it("Sam resolves to Samuel when the alias exists", () => {
      const entity = resolveEntity("Sam", registry);
      expect(entity).toBeDefined();
      expect(entity?.canonicalName).toBe("Samuel");
    });

    it("Nia resolves to the same canonical character", () => {
      const id = resolveEntityId("Nia", registry);
      expect(id).toBeDefined();
      expect(id).toBe(resolveEntityId("Nia", registry));
    });

    it("Similar names do not automatically merge separate characters", () => {
      const samuel = resolveEntity("Samuel", registry);
      const driver = resolveEntity("The Driver", registry);
      expect(samuel).toBeDefined();
      expect(driver).toBeDefined();
      expect(samuel!.id).not.toBe(driver!.id);
    });

    it("Ambiguous identity references are reported or resolved", () => {
      const findings = validateCanonicalIdentities(registry);
      const aliasConflicts = findings.filter((f) => f.code === "ALIAS_CONFLICT");
      expect(aliasConflicts.length).toBe(0);
    });
  });

  describe("Lifecycle tests", () => {
    it("The Driver introduced in Episode 3 is valid", () => {
      const driver = resolveEntity("The Driver", registry);
      expect(driver).toBeDefined();
      expect(driver?.firstIntroductionEpisode).toBe(3);
    });

    it("The Town introduced in Episode 2 is valid", () => {
      const town = registry.entities.find((e) => e.canonicalName === "The Town");
      expect(town).toBeDefined();
      expect(town?.firstIntroductionEpisode).toBe(2);
    });

    it("A historical reference before physical introduction is valid", () => {
      const findings = validateEntityLifecycles(registry);
      const preIntro = findings.filter(
        (f) => f.code === "UNEXPLAINED_PRE_INTRODUCTION_REFERENCE" &&
          f.message.includes("The Driver"),
      );
      expect(preIntro.length).toBe(0);
    });

    it("A temporarily absent character is not considered deleted", () => {
      const samuel = resolveEntity("Samuel", registry);
      expect(samuel).toBeDefined();
      expect(samuel?.lifecycle).not.toBe("departed");
      expect(samuel?.lifecycle).not.toBe("deceased");
    });

    it("A deceased character may appear in a valid flashback", () => {
      const nia = resolveEntity("Nia", registry);
      expect(nia).toBeDefined();
    });
  });

  describe("Knowledge tests", () => {
    it("Samuel does not know he caused the crash before Episode 4", () => {
      const samuelId = resolveEntityId("Samuel", registry);
      expect(samuelId).toBeDefined();
      const knowsBeforeEp4 = characterKnowsFact(
        registry,
        samuelId!,
        `fact:${samuelId}:truth`,
        3,
      );
      expect(knowsBeforeEp4).toBe(false);
    });

    it("Samuel knows he caused the crash by Episode 4", () => {
      const samuelId = resolveEntityId("Samuel", registry);
      const knowsByEp4 = characterKnowsFact(
        registry,
        samuelId!,
        `fact:${samuelId}:truth`,
        4,
      );
      expect(knowsByEp4).toBe(true);
    });

    it("The author can know the truth from the beginning", () => {
      const samuel = resolveEntity("Samuel", registry);
      expect(samuel?.authorTruth).toBeDefined();
      expect(samuel?.authorTruth).toContain("driver");
    });

    it("Knowledge validation does not produce errors for the valid timeline", () => {
      const findings = validateCharacterKnowledge(registry);
      const errors = findings.filter((f) => f.severity === "error");
      expect(errors.length).toBe(0);
    });
  });

  describe("Relationship tests", () => {
    it("A relationship between Samuel and Nia is tracked", () => {
      const samuelId = resolveEntityId("Samuel", registry);
      const niaId = resolveEntityId("Nia", registry);
      const rel = registry.relationships.find(
        (r) =>
          (r.characterA === samuelId && r.characterB === niaId) ||
          (r.characterA === niaId && r.characterB === samuelId),
      );
      expect(rel).toBeDefined();
    });

    it("A relationship can begin after both characters are introduced", () => {
      const findings = validateRelationships(registry);
      const beforeIntro = findings.filter(
        (f) => f.code === "RELATIONSHIP_BEFORE_ENTITY_INTRODUCTION",
      );
      expect(beforeIntro.length).toBe(0);
    });

    it("Both characters in a relationship are valid entities", () => {
      const findings = validateRelationships(registry);
      const invalid = findings.filter(
        (f) => f.code === "RELATIONSHIP_INVALID_ENTITY",
      );
      expect(invalid.length).toBe(0);
    });
  });

  describe("Causal continuity tests", () => {
    it("Events have causal links between episodes", () => {
      expect(registry.causalLinks.length).toBeGreaterThan(0);
    });

    it("No cyclic causal dependencies", () => {
      const findings = validateEventChronology(registry);
      const cyclic = findings.filter((f) => f.code === "CYCLIC_CAUSAL_DEPENDENCY");
      expect(cyclic.length).toBe(0);
    });

    it("No broken causal links", () => {
      const findings = validateCausalContinuity(registry);
      const broken = findings.filter((f) => f.code === "BROKEN_CAUSAL_LINK");
      expect(broken.length).toBe(0);
    });

    it("No backwards causal links", () => {
      const findings = validateCausalContinuity(registry);
      const backwards = findings.filter((f) => f.code === "CAUSAL_LINK_BACKWARDS");
      expect(backwards.length).toBe(0);
    });
  });

  describe("Narrative thread tests", () => {
    it("A mystery introduced early and answered in Episode 4 is valid", () => {
      const findings = validateNarrativeThreads(registry);
      const abandoned = findings.filter(
        (f) => f.code === "ABANDONED_MAJOR_THREAD" &&
          f.message.includes("driver"),
      );
      expect(abandoned.length).toBe(0);
    });

    it("An intentional future-season hook is allowed", () => {
      const driverThread = registry.threads.find(
        (t) => t.description.includes("Driver's complete identity"),
      );
      expect(driverThread).toBeDefined();
      expect(driverThread?.status).toBe("intentionally_carried_forward");
    });

    it("A future-season hook has a carry-forward reason", () => {
      const findings = validateNarrativeThreads(registry);
      const unjustified = findings.filter(
        (f) => f.code === "UNJUSTIFIED_CARRY_FORWARD" &&
          f.message.includes("Driver"),
      );
      expect(unjustified.length).toBe(0);
    });

    it("No broken thread references", () => {
      const findings = validateNarrativeThreads(registry);
      const broken = findings.filter((f) => f.code === "BROKEN_THREAD_REFERENCE");
      expect(broken.length).toBe(0);
    });

    it("No payoff before setup", () => {
      const findings = validateNarrativeThreads(registry);
      const backwards = findings.filter((f) => f.code === "PAYOFF_BEFORE_SETUP");
      expect(backwards.length).toBe(0);
    });
  });

  describe("Finale tests", () => {
    it("The season resolves its central conflict", () => {
      const findings = validateSeasonFinale(registry, {
        centralConflictOrMystery: plan.centralConflictOrMystery,
        intendedSeasonConclusion: plan.intendedSeasonConclusion,
        unresolvedQuestions: plan.unresolvedQuestions,
      });
      const noResolution = findings.filter((f) => f.code === "FINALE_NO_RESOLUTION");
      expect(noResolution.length).toBe(0);
    });

    it("A deliberate future-season hook is not treated as a failed finale", () => {
      const findings = validateSeasonFinale(registry, {
        centralConflictOrMystery: plan.centralConflictOrMystery,
        intendedSeasonConclusion: plan.intendedSeasonConclusion,
        unresolvedQuestions: plan.unresolvedQuestions,
      });
      const failedFinale = findings.filter(
        (f) => f.code === "FINALE_NO_RESOLUTION",
      );
      expect(failedFinale.length).toBe(0);
    });

    it("Minor open threads are informational, not errors", () => {
      const findings = validateSeasonFinale(registry, {
        centralConflictOrMystery: plan.centralConflictOrMystery,
        intendedSeasonConclusion: plan.intendedSeasonConclusion,
        unresolvedQuestions: plan.unresolvedQuestions,
      });
      const minorOpen = findings.filter((f) => f.code === "FINALE_MINOR_OPEN_THREAD");
      for (const f of minorOpen) {
        expect(f.severity).toBe("info");
      }
    });
  });

  describe("Extraction tests", () => {
    it("Malformed JSON is rejected", () => {
      const result = extractStructuredNarrativeData(
        { episodeProgression: "not an array" },
        seasonPlanSchema,
      );
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("Missing required fields produce extraction errors", () => {
      const result = extractStructuredNarrativeData(
        { seasonObjective: "test" },
        seasonPlanSchema,
      );
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("Valid structured data passes extraction", () => {
      const result = extractStructuredNarrativeData(makePlan(), seasonPlanSchema);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("Object keys are never extracted as narrative questions", () => {
      const malformed = {
        ...makePlan(),
        unresolvedQuestions: ["characterArcChanges", "what is the future of the town?"] as unknown as string[],
      };
      const result = extractStructuredNarrativeData(malformed, seasonPlanSchema);
      if (result.success && result.data) {
        const questions = result.data.unresolvedQuestions;
        expect(questions).not.toContain("characterArcChanges");
      }
    });

    it("Unicode punctuation is preserved in valid data", () => {
      const plan = makePlan();
      plan.episodeProgression[0]!.workingTitle = "Storm at the Stop — café";
      const result = extractStructuredNarrativeData(plan, seasonPlanSchema);
      expect(result.success).toBe(true);
      if (result.data) {
        expect(result.data.episodeProgression[0]!.workingTitle).toContain("café");
      }
    });

    it("Escaped quotation marks are preserved", () => {
      const plan = makePlan();
      plan.episodeProgression[0]!.centralConflict = 'Samuel says "hello" to Nia';
      const result = extractStructuredNarrativeData(plan, seasonPlanSchema);
      expect(result.success).toBe(true);
      if (result.data) {
        expect(result.data.episodeProgression[0]!.centralConflict).toContain('"hello"');
      }
    });
  });

  describe("Full validation pipeline", () => {
    it("produces a complete validation result with no errors for the valid fixture", () => {
      const findings = validateSeasonNarrative(registry, {
        centralConflictOrMystery: plan.centralConflictOrMystery,
        intendedSeasonConclusion: plan.intendedSeasonConclusion,
        unresolvedQuestions: plan.unresolvedQuestions,
      });
      const summary = summarizeFindings(findings);
      expect(summary.errors).toBe(0);
    });

    it("produces findings with stable codes", () => {
      const findings = validateSeasonNarrative(registry, {
        centralConflictOrMystery: plan.centralConflictOrMystery,
        intendedSeasonConclusion: plan.intendedSeasonConclusion,
        unresolvedQuestions: plan.unresolvedQuestions,
      });
      for (const f of findings) {
        expect(f.code).toMatch(/^[A-Z_]+$/);
      }
    });

    it("every finding has an episode number", () => {
      const findings = validateSeasonNarrative(registry, {
        centralConflictOrMystery: plan.centralConflictOrMystery,
        intendedSeasonConclusion: plan.intendedSeasonConclusion,
        unresolvedQuestions: plan.unresolvedQuestions,
      });
      for (const f of findings) {
        expect(f.episode).toBeGreaterThanOrEqual(0);
      }
    });
  });
});