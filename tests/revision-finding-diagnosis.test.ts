import { describe, it, expect, beforeEach } from "vitest";
import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import type { RichValidationFinding } from "@/lib/validation/seasonPlanValidation";
import {
  toFindingDomain,
  FINDING_CLASSIFICATIONS,
  FINDING_DOMAINS,
  resetFindingIdCounter,
} from "@/lib/validation/seasonPlanValidation";
import {
  classifyFinding,
  classifyFindings,
  type ClassificationContext,
} from "@/lib/domain/planValidation/findingClassifier";
import {
  groupFindings,
  extractEntities,
  resetGroupCounter,
} from "@/lib/domain/planValidation/findingGrouper";
import {
  investigateFinding,
} from "@/lib/domain/planValidation/sourceInvestigator";
import {
  diagnoseFindings,
} from "@/lib/domain/planValidation/findingDiagnoser";

// ---------------------------------------------------------------------------
// Fixtures — based on the user's real validation error examples:
//   - Episodes 1–5 reference "Mara" (alias for "Mara Voss")
//   - Episodes 2–4 reference "Dr. Vale" (alias for "Dr. Miriam Vale")
//   - Episodes 3–6 reference locations not in the Bible
//   - Episode 2 foreshadowing has no payoff
// ---------------------------------------------------------------------------

function makeBible(): StoryBibleContent {
  return {
    identity: {
      title: "The Phantom Protocol",
      genres: ["Thriller", "Mystery"],
      subgenres: ["Psychological"],
      centralPremise: "A detective uncovers a conspiracy while haunted by a phantom from her past.",
      narrativeConcept: "Mara Voss investigates disappearances linked to a shadowy research facility.",
      toneAndAtmosphere: "Tense, atmospheric, suspenseful",
      targetAudience: "Adults who enjoy psychological thrillers",
      centralConflict: "Mara must expose the conspiracy before the phantom consumes her.",
    },
    world: {
      description: "A modern city with a hidden research facility operating beneath it.",
      geographyAndLocations: [
        { name: "Voss's Office", description: "Mara's private investigation office.", storyFunction: "Base of operations" },
        { name: "The Research Facility", description: "A secret underground lab.", storyFunction: "Antagonist's domain" },
      ],
      socialStructuresAndCultures: ["Modern urban society with a hidden scientific elite"],
      historyAndPastEvents: ["Mara's past encounter with the phantom", "The facility's experiments"],
      rules: ["The phantom appears only to Mara", "The facility's experiments have side effects"],
      definingSystems: [],
    },
    characters: {
      characters: [
        {
          name: "Mara Voss",
          storyRole: "protagonist",
          roleDescription: "A private detective haunted by a phantom",
          physicalDescription: "Sharp-eyed, guarded",
          personality: "Determined, skeptical, haunted",
          background: "Former police detective who left after a traumatic case",
          motivations: ["Expose the conspiracy", "Understand the phantom"],
          fearsAndWeaknesses: ["Losing her sanity", "The phantom's origin"],
          abilitiesAndLimitations: ["Keen investigative skills", "Cannot control the phantom visions"],
          relationships: [
            { characterName: "Dr. Miriam Vale", relationship: "Adversary turned reluctant ally", tensionOrChange: "Mutual distrust" },
          ],
          secrets: ["The full truth about her past with the phantom"],
          developmentPotential: "Mara must confront her past to solve the case",
        },
        {
          name: "Dr. Miriam Vale",
          storyRole: "antagonist",
          roleDescription: "A researcher at the secret facility",
          physicalDescription: "Composed, clinical",
          personality: "Brilliant, guarded, morally ambiguous",
          background: "Lead researcher at the underground facility",
          motivations: ["Protect her research", "Understand the phantom phenomenon"],
          fearsAndWeaknesses: ["Exposure of her work", "The experiments failing"],
          abilitiesAndLimitations: ["Scientific expertise", "Limited field experience"],
          relationships: [
            { characterName: "Mara Voss", relationship: "Reluctant ally", tensionOrChange: "Mutual distrust" },
          ],
          secrets: ["The true purpose of the experiments"],
          developmentPotential: "Vale must choose between science and ethics",
        },
      ],
      relationshipDynamics: ["Mara and Vale share a tense adversarial alliance"],
    },
    narrative: {
      mainStoryline: "Mara investigates disappearances that lead to Dr. Vale's secret facility.",
      majorConflicts: ["Mara vs. the conspiracy", "Mara vs. the phantom"],
      longTermDirection: "Mara exposes the facility and confronts the phantom.",
      subplots: ["Vale's ethical struggle over her research"],
      unresolvedMysteries: ["The true nature of the phantom"],
      potentialFutureRevelations: ["The phantom is a side effect of the experiments"],
      majorNarrativeQuestions: ["Will Mara expose the facility?", "What is the phantom?"],
      serializedEndingGuidance: "Mara confronts the phantom in the season finale.",
    },
    guidelines: {
      mainThemes: ["Truth", "Conspiracy", "Identity"],
      secondaryThemes: ["Ethics", "Memory"],
      storytellingStyle: "Atmospheric thriller with psychological depth",
      boundaries: ["The phantom is real, not a hallucination", "Mara is not insane"],
      mustRemainConsistent: ["Mara is a former detective", "The facility is underground"],
    },
    canon: {
      confirmedFacts: ["Mara is a former police detective", "The facility is underground"],
      proposedDetails: [],
      unresolvedQuestions: ["The nature of the phantom"],
      hiddenInformation: ["The experiments' side effects"],
      characterKnowledge: [
        { characterName: "Mara Voss", knows: ["People are disappearing"], believes: ["The phantom is connected"] },
        { characterName: "Dr. Miriam Vale", knows: ["The experiments cause visions"], believes: ["The research is justified"] },
      ],
      audienceKnowledge: ["People are disappearing", "Mara sees the phantom"],
    },
  };
}

function makeEpisode(num: number, overrides?: Partial<EpisodePlanItem>): EpisodePlanItem {
  return {
    episodeNumber: num,
    workingTitle: `Episode ${num}`,
    narrativePurpose: `Advance the investigation in episode ${num}`,
    startingSituation: `The situation at the start of episode ${num}`,
    mainObjective: `The objective for episode ${num}`,
    centralConflict: `The conflict in episode ${num}`,
    majorStoryBeats: [`Beat 1 of episode ${num}`, `Beat 2 of episode ${num}`],
    informationRevealed: [],
    characterDevelopment: `Mara and Vale develop in episode ${num}`,
    importantEvents: [`Event in episode ${num}`],
    consequences: [`Consequence of episode ${num}`],
    storyContribution: `This episode advances the season by ${num}`,
    endingOrCliffhanger: `The ending of episode ${num}`,
    unresolvedThreads: [],
    continuityRequirements: `Must maintain continuity from episode ${num - 1}`,
    characterArcChanges: [],
    relationshipChanges: [],
    objectChanges: [],
    locationChanges: [],
    ...overrides,
  };
}

function makePlan(episodes: EpisodePlanItem[]): SeasonPlan {
  return {
    seasonObjective: "Mara exposes the facility and confronts the phantom.",
    centralConflictOrMystery: "What is the phantom and who is behind the disappearances?",
    mainCharacterObjectives: "Mara seeks the truth; Vale seeks to protect her research.",
    overallCharacterDevelopment: "Mara goes from haunted to empowered; Vale goes from guarded to ethical.",
    majorStoryDevelopments: ["The phantom appears", "The facility is discovered"],
    beginningDirection: "Establish Mara's investigation and the phantom.",
    middleDirection: "Mara narrows in on the facility.",
    endingDirection: "Mara confronts the phantom and exposes the facility.",
    episodeProgression: episodes,
    importantRevelations: ["The phantom is a side effect of the experiments"],
    relationshipChanges: ["Mara and Vale form a reluctant alliance"],
    consequencesCarriedBetween: ["Mara's growing understanding of the phantom"],
    setupAndPayoff: [
      "Episode 2: The phantom appears briefly — sets up the revelation of its origin",
      "Episode 6: The phantom's origin is revealed",
    ],
    unresolvedQuestions: ["The full extent of the experiments"],
    intendedSeasonConclusion: "Mara exposes the facility and confronts the phantom.",
  };
}

function makeLedger(): ContinuityLedger {
  return {
    events: [
      {
        episodeNumber: 1,
        event: "Mara begins investigating",
        consequence: "Mara is on the case",
        affectedCharacters: ["Mara Voss"],
        revealedInformation: ["People are disappearing"],
      },
    ],
    characterStates: [
      {
        name: "Mara Voss",
        currentLocation: "Voss's Office",
        currentObjective: "Investigate disappearances",
        knowledge: ["People are disappearing"],
        beliefs: ["The phantom is connected"],
        motivations: ["Expose the truth"],
        emotionalState: "Determined but haunted",
        physicalState: "Healthy",
        relationships: [
          { characterName: "Dr. Miriam Vale", relationship: "Adversary", tensionOrChange: "Mutual distrust" },
        ],
      },
    ],
    locationStates: [
      { name: "Voss's Office", currentState: "Active", lastSeenEpisode: 1 },
      { name: "The Research Facility", currentState: "Operational", lastSeenEpisode: 1 },
    ],
    objectStates: [],
    revealedSecrets: [],
    unresolvedThreads: [
      { thread: "The nature of the phantom", introducedInEpisode: 1, status: "open" },
    ],
    consequences: ["Mara is now a target"],
    timelineNotes: "",
  };
}

function makeFinding(overrides: Partial<RichValidationFinding> & Pick<RichValidationFinding, "findingId" | "category" | "severity" | "message">): RichValidationFinding {
  return {
    source: "deterministic",
    requiresHumanReview: false,
    ...overrides,
  };
}

function classificationContext(overrides?: Partial<Omit<ClassificationContext, "finding" | "domain">>): Omit<ClassificationContext, "finding" | "domain"> {
  return {
    hasSubsequentEpisodes: true,
    isSeasonFinale: false,
    knownAliases: new Set<string>(),
    bibleCharacterNames: new Set(["mara voss", "dr. miriam vale"]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Finding Classification", () => {
  describe("toFindingDomain", () => {
    it("maps all 25 validation categories to one of 13 finding domains", () => {
      const categories: RichValidationFinding["category"][] = [
        "structural", "reference_integrity", "relationship_integrity", "episode_indexing",
        "canon_contradiction", "unknown_entity_reference", "world_rule_violation",
        "character_history_contradiction", "unexplained_status_change", "temporal_continuity",
        "cyclic_dependency", "character_state", "knowledge_chronology", "episode_progression",
        "narrative_progression", "conflict_escalation", "episode_differentiation", "setup_payoff",
        "climax_resolution", "premature_climax", "narrative_integrity", "continuity",
        "progression", "repetition", "character_development", "narrative_structure",
      ];
      for (const category of categories) {
        const domain = toFindingDomain(category);
        expect(FINDING_DOMAINS).toContain(domain);
      }
    });

    it("maps reference_integrity and unknown_entity_reference to character_identity_aliases", () => {
      expect(toFindingDomain("reference_integrity")).toBe("character_identity_aliases");
      expect(toFindingDomain("unknown_entity_reference")).toBe("character_identity_aliases");
    });

    it("maps setup_payoff to missing_setup", () => {
      expect(toFindingDomain("setup_payoff")).toBe("missing_setup");
    });

    it("maps temporal_continuity and cyclic_dependency to timeline_chronology", () => {
      expect(toFindingDomain("temporal_continuity")).toBe("timeline_chronology");
      expect(toFindingDomain("cyclic_dependency")).toBe("timeline_chronology");
    });
  });

  describe("classifyFinding — all 6 classification types", () => {
    it("classifies a blocking canon contradiction as genuine_continuity_error", () => {
      const finding = makeFinding({
        findingId: "f-001",
        category: "canon_contradiction",
        severity: "blocking",
        message: "Episode 4 contradicts established canon: Mara is stated to be a doctor but canon establishes her as a detective.",
        canonIssueType: "CANON_CONTRADICTION",
      });
      const result = classifyFinding(finding, classificationContext());
      expect(result.classification).toBe("genuine_continuity_error");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("classifies a high-severity premature climax as genuine_narrative_problem", () => {
      const finding = makeFinding({
        findingId: "f-002",
        category: "premature_climax",
        severity: "high",
        message: "Episode 1 prematurely reaches the season's intended conclusion.",
      });
      const result = classifyFinding(finding, classificationContext());
      expect(result.classification).toBe("genuine_narrative_problem");
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it("classifies a low-severity 'not referenced in episode' finding as validator_false_positive", () => {
      const finding = makeFinding({
        findingId: "f-003",
        category: "reference_integrity",
        severity: "low",
        message: "Main character Mara Voss is not referenced in episode 1.",
      });
      const result = classifyFinding(finding, classificationContext());
      expect(result.classification).toBe("validator_false_positive");
    });

    it("classifies a medium-severity 'not in the story bible' location finding as missing_canon_information", () => {
      const finding = makeFinding({
        findingId: "f-004",
        category: "unknown_entity_reference",
        severity: "medium",
        message: "Location 'Abandoned Warehouse' is not in the story bible.",
      });
      const result = classifyFinding(finding, classificationContext());
      expect(result.classification).toBe("missing_canon_information");
    });

    it("classifies a cliffhanger unresolved thread as intentional_creative_decision", () => {
      const finding = makeFinding({
        findingId: "f-005",
        category: "narrative_integrity",
        severity: "medium",
        message: "Unresolved thread: The phantom's identity remains a mystery — deliberately unresolved cliffhanger.",
      });
      const result = classifyFinding(finding, classificationContext({ isSeasonFinale: true }));
      expect(result.classification).toBe("intentional_creative_decision");
    });

    it("classifies an unknown character with known aliases as ambiguous_requires_investigation", () => {
      const finding = makeFinding({
        findingId: "f-006",
        category: "unknown_entity_reference",
        severity: "high",
        message: "Episode 1 references character 'Mara' who is not in the story bible.",
      });
      const result = classifyFinding(finding, classificationContext({
        knownAliases: new Set(["mara"]),
      }));
      expect(result.classification).toBe("ambiguous_requires_investigation");
    });

    it("classifies a missing payoff with subsequent episodes as ambiguous_requires_investigation", () => {
      const finding = makeFinding({
        findingId: "f-007",
        category: "setup_payoff",
        severity: "medium",
        message: "Episode 2 foreshadowing 'The phantom appears briefly' has no payoff.",
      });
      const result = classifyFinding(finding, classificationContext({ hasSubsequentEpisodes: true }));
      expect(result.classification).toBe("ambiguous_requires_investigation");
    });

    it("defaults to ambiguous_requires_investigation when no heuristic matches", () => {
      const finding = makeFinding({
        findingId: "f-008",
        category: "episode_differentiation",
        severity: "medium",
        message: "Episodes 3 and 4 have similar narrative beats.",
      });
      const result = classifyFinding(finding, classificationContext());
      expect(result.classification).toBe("ambiguous_requires_investigation");
      expect(result.confidence).toBe(0.5);
    });
  });

  describe("classifyFindings — batch classification", () => {
    it("classifies multiple findings and returns one result per finding", () => {
      const findings = [
        makeFinding({ findingId: "f-a", category: "canon_contradiction", severity: "blocking", message: "Contradicts canon." }),
        makeFinding({ findingId: "f-b", category: "reference_integrity", severity: "low", message: "Not referenced in episode 2." }),
      ];
      const results = classifyFindings(findings, classificationContext());
      expect(results).toHaveLength(2);
      expect(results[0]!.findingId).toBe("f-a");
      expect(results[1]!.findingId).toBe("f-b");
    });
  });

  describe("Classification confidence values are within [0, 1]", () => {
    it("produces valid confidence for every classification type", () => {
      const findings: RichValidationFinding[] = [
        makeFinding({ findingId: "c1", category: "canon_contradiction", severity: "blocking", message: "Canon contradiction.", canonIssueType: "CANON_CONTRADICTION" }),
        makeFinding({ findingId: "c2", category: "premature_climax", severity: "high", message: "Premature climax." }),
        makeFinding({ findingId: "c3", category: "reference_integrity", severity: "low", message: "Not referenced in episode 1." }),
        makeFinding({ findingId: "c4", category: "unknown_entity_reference", severity: "medium", message: "Location 'X' not in the story bible." }),
        makeFinding({ findingId: "c5", category: "narrative_integrity", severity: "medium", message: "Deliberately unresolved cliffhanger." }),
        makeFinding({ findingId: "c6", category: "episode_differentiation", severity: "medium", message: "Similar episodes." }),
      ];
      const results = classifyFindings(findings, classificationContext({ isSeasonFinale: true }));
      for (const result of results) {
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
        expect(FINDING_CLASSIFICATIONS).toContain(result.classification);
      }
    });
  });
});

// ---------------------------------------------------------------------------

describe("Finding Grouper", () => {
  beforeEach(() => {
    resetGroupCounter();
  });

  describe("extractEntities", () => {
    it("extracts character names from finding messages", () => {
      const findings = [
        makeFinding({ findingId: "g1", category: "unknown_entity_reference", severity: "high", message: "Episode 1 references character 'Mara' who is not in the story bible." }),
        makeFinding({ findingId: "g2", category: "unknown_entity_reference", severity: "high", message: "Episode 2 references character 'Dr. Vale' who is not in the story bible." }),
      ];
      const entities = extractEntities(findings);
      expect(entities.size).toBeGreaterThanOrEqual(1);
      expect([...entities].some((e) => e.includes("mara"))).toBe(true);
    });

    it("extracts location names from finding messages", () => {
      const findings = [
        makeFinding({ findingId: "g3", category: "unknown_entity_reference", severity: "medium", message: "Location 'Abandoned Warehouse' is not in the story bible." }),
      ];
      const entities = extractEntities(findings);
      expect(entities.size).toBeGreaterThanOrEqual(1);
    });

    it("returns an empty set when no entities are found", () => {
      const findings = [
        makeFinding({ findingId: "g4", category: "episode_differentiation", severity: "medium", message: "Episodes are too similar." }),
      ];
      const entities = extractEntities(findings);
      expect(entities.size).toBe(0);
    });
  });

  describe("groupFindings — merging and deduplication", () => {
    it("groups findings that share the same entity and domain", () => {
      const findings = [
        makeFinding({ findingId: "g5", category: "unknown_entity_reference", severity: "high", message: "Episode 1 references character 'Mara' who is not in the story bible.", episodeNumber: 1 }),
        makeFinding({ findingId: "g6", category: "unknown_entity_reference", severity: "high", message: "Episode 2 references character 'Mara' who is not in the story bible.", episodeNumber: 2 }),
        makeFinding({ findingId: "g7", category: "unknown_entity_reference", severity: "high", message: "Episode 3 references character 'Mara' who is not in the story bible.", episodeNumber: 3 }),
      ];
      const groups = groupFindings(findings);
      expect(groups).toHaveLength(1);
      expect(groups[0]!.findingIds).toHaveLength(3);
      expect(groups[0]!.affectedEpisodes).toEqual([1, 2, 3]);
      expect(groups[0]!.domain).toBe("character_identity_aliases");
    });

    it("does not group findings from different domains", () => {
      const findings = [
        makeFinding({ findingId: "g8", category: "unknown_entity_reference", severity: "high", message: "Episode 1 references character 'Mara'.", episodeNumber: 1 }),
        makeFinding({ findingId: "g9", category: "setup_payoff", severity: "medium", message: "Episode 2 foreshadowing has no payoff.", episodeNumber: 2 }),
      ];
      const groups = groupFindings(findings);
      expect(groups).toHaveLength(2);
      expect(groups[0]!.domain).not.toBe(groups[1]!.domain);
    });

    it("deduplicates findings with the same findingId and message", () => {
      const findings = [
        makeFinding({ findingId: "dup", category: "canon_contradiction", severity: "blocking", message: "Same contradiction.", episodeNumber: 1 }),
        makeFinding({ findingId: "dup", category: "canon_contradiction", severity: "blocking", message: "Same contradiction.", episodeNumber: 1 }),
      ];
      const groups = groupFindings(findings);
      expect(groups).toHaveLength(1);
      expect(groups[0]!.findings).toHaveLength(1);
    });

    it("merges severity to the highest when grouping", () => {
      const findings = [
        makeFinding({ findingId: "g10", category: "unknown_entity_reference", severity: "low", message: "Episode 1 references character 'Mara'.", episodeNumber: 1 }),
        makeFinding({ findingId: "g11", category: "unknown_entity_reference", severity: "blocking", message: "Episode 2 references character 'Mara'.", episodeNumber: 2 }),
      ];
      const groups = groupFindings(findings);
      expect(groups).toHaveLength(1);
      expect(groups[0]!.severity).toBe("blocking");
    });

    it("sorts groups by severity (highest first)", () => {
      const findings = [
        makeFinding({ findingId: "g12", category: "setup_payoff", severity: "low", message: "Minor setup issue.", episodeNumber: 1 }),
        makeFinding({ findingId: "g13", category: "canon_contradiction", severity: "blocking", message: "Major canon contradiction.", episodeNumber: 2 }),
        makeFinding({ findingId: "g14", category: "episode_differentiation", severity: "medium", message: "Similar episodes.", episodeNumber: 3 }),
      ];
      const groups = groupFindings(findings);
      expect(groups[0]!.severity).toBe("blocking");
      expect(groups[groups.length - 1]!.severity).toBe("low");
    });

    it("handles findings without episode numbers", () => {
      const findings = [
        makeFinding({ findingId: "g15", category: "structural", severity: "high", message: "Plan structure is invalid." }),
      ];
      const groups = groupFindings(findings);
      expect(groups).toHaveLength(1);
      expect(groups[0]!.affectedEpisodes).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------

describe("Source Investigator", () => {
  it("retrieves affected episode plans", () => {
    const plan = makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3), makeEpisode(4), makeEpisode(5), makeEpisode(6)]);
    const groups = groupFindings([
      makeFinding({ findingId: "i1", category: "unknown_entity_reference", severity: "high", message: "Episode 3 references character 'Mara'.", episodeNumber: 3 }),
    ]);
    const evidence = investigateFinding({ group: groups[0]!, plan, bible: makeBible(), ledger: null });
    expect(evidence.affectedEpisodePlans).toHaveLength(1);
    expect(evidence.affectedEpisodePlans[0]!.episodeNumber).toBe(3);
  });

  it("retrieves previous and subsequent episode plans", () => {
    const plan = makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3), makeEpisode(4), makeEpisode(5), makeEpisode(6)]);
    const groups = groupFindings([
      makeFinding({ findingId: "i2", category: "unknown_entity_reference", severity: "high", message: "Episode 3 references character 'Mara'.", episodeNumber: 3 }),
    ]);
    const evidence = investigateFinding({ group: groups[0]!, plan, bible: null, ledger: null });
    expect(evidence.previousEpisodePlans.map((e) => e.episodeNumber)).toEqual([1, 2]);
    expect(evidence.subsequentEpisodePlans.map((e) => e.episodeNumber)).toEqual([4, 5, 6]);
  });

  it("includes the bible summary and season objective", () => {
    const plan = makePlan([makeEpisode(1)]);
    const bible = makeBible();
    const groups = groupFindings([
      makeFinding({ findingId: "i3", category: "canon_contradiction", severity: "blocking", message: "Contradiction.", episodeNumber: 1 }),
    ]);
    const evidence = investigateFinding({ group: groups[0]!, plan, bible, ledger: null });
    expect(evidence.bibleSummary).toContain("The Phantom Protocol");
    expect(evidence.seasonObjective).toBe(plan.seasonObjective);
  });

  it("projects character and location records from the bible", () => {
    const plan = makePlan([makeEpisode(1)]);
    const bible = makeBible();
    const groups = groupFindings([
      makeFinding({ findingId: "i4", category: "unknown_entity_reference", severity: "medium", message: "Location 'Abandoned Warehouse' not in the story bible.", episodeNumber: 1 }),
    ]);
    const evidence = investigateFinding({ group: groups[0]!, plan, bible, ledger: null });
    expect(evidence.characterRecords).toContain("Mara Voss");
    expect(evidence.characterRecords).toContain("Dr. Miriam Vale");
    expect(evidence.locationRecords).toContain("Voss's Office");
    expect(evidence.locationRecords).toContain("The Research Facility");
  });

  it("projects relevant ledger character states matching the entity", () => {
    const plan = makePlan([makeEpisode(1)]);
    const ledger = makeLedger();
    const groups = groupFindings([
      makeFinding({ findingId: "i5", category: "character_history_contradiction", severity: "high", message: "Episode 1 character 'Mara Voss' history contradicts canon.", episodeNumber: 1 }),
    ]);
    const evidence = investigateFinding({ group: groups[0]!, plan, bible: null, ledger });
    expect(evidence.ledgerCharacterStates.length).toBeGreaterThan(0);
    expect(evidence.ledgerCharacterStates[0]!).toContain("Mara Voss");
  });

  it("projects ledger events for the affected episodes", () => {
    const plan = makePlan([makeEpisode(1), makeEpisode(2)]);
    const ledger = makeLedger();
    const groups = groupFindings([
      makeFinding({ findingId: "i6", category: "continuity", severity: "high", message: "Continuity break in episode 1.", episodeNumber: 1 }),
    ]);
    const evidence = investigateFinding({ group: groups[0]!, plan, bible: null, ledger });
    expect(evidence.ledgerEvents.length).toBeGreaterThan(0);
    expect(evidence.ledgerEvents[0]!).toContain("Ep1");
  });

  it("projects unresolved ledger threads", () => {
    const plan = makePlan([makeEpisode(1)]);
    const ledger = makeLedger();
    const groups = groupFindings([
      makeFinding({ findingId: "i7", category: "narrative_integrity", severity: "medium", message: "Unresolved thread: The phantom.", episodeNumber: 1 }),
    ]);
    const evidence = investigateFinding({ group: groups[0]!, plan, bible: null, ledger });
    expect(evidence.ledgerUnresolvedThreads.length).toBeGreaterThan(0);
  });

  it("includes setup/payoff records and important revelations from the plan", () => {
    const plan = makePlan([makeEpisode(1)]);
    const groups = groupFindings([
      makeFinding({ findingId: "i8", category: "setup_payoff", severity: "medium", message: "Missing payoff for setup.", episodeNumber: 1 }),
    ]);
    const evidence = investigateFinding({ group: groups[0]!, plan, bible: null, ledger: null });
    expect(evidence.setupPayoffRecords).toHaveLength(plan.setupAndPayoff.length);
    expect(evidence.importantRevelations).toHaveLength(plan.importantRevelations.length);
  });

  it("returns a default bible summary when bible is null", () => {
    const plan = makePlan([makeEpisode(1)]);
    const groups = groupFindings([
      makeFinding({ findingId: "i9", category: "structural", severity: "high", message: "Structure issue.", episodeNumber: 1 }),
    ]);
    const evidence = investigateFinding({ group: groups[0]!, plan, bible: null, ledger: null });
    expect(evidence.bibleSummary).toBe("No Story Bible available.");
    expect(evidence.characterRecords).toEqual([]);
    expect(evidence.locationRecords).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("Finding Diagnoser — end-to-end", () => {
  beforeEach(() => {
    resetFindingIdCounter();
    resetGroupCounter();
  });

  it("produces a diagnosis for every finding group", () => {
    const plan = makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3), makeEpisode(4), makeEpisode(5), makeEpisode(6)]);
    const bible = makeBible();
    const ledger = makeLedger();

    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "d1", category: "canon_contradiction", severity: "blocking", message: "Episode 4 contradicts canon.", episodeNumber: 4, canonIssueType: "CANON_CONTRADICTION" }),
      makeFinding({ findingId: "d2", category: "premature_climax", severity: "high", message: "Episode 1 prematurely reaches the climax.", episodeNumber: 1 }),
    ];

    const diagnoses = diagnoseFindings({ findings, plan, bible, ledger, isSeasonFinale: false });
    expect(diagnoses.length).toBeGreaterThan(0);
    for (const diagnosis of diagnoses) {
      expect(diagnosis.groupId).toBeTruthy();
      expect(diagnosis.findingIds.length).toBeGreaterThan(0);
      expect(FINDING_CLASSIFICATIONS).toContain(diagnosis.classification);
      expect(diagnosis.rootCause).toBeTruthy();
      expect(diagnosis.classificationConfidence).toBeGreaterThan(0);
      expect(diagnosis.classificationConfidence).toBeLessThanOrEqual(1);
    }
  });

  it("marks genuine continuity errors as requiring revision", () => {
    const plan = makePlan([makeEpisode(1), makeEpisode(2)]);
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "d3", category: "canon_contradiction", severity: "blocking", message: "Direct canon contradiction.", episodeNumber: 1, canonIssueType: "CANON_CONTRADICTION" }),
    ];
    const diagnoses = diagnoseFindings({ findings, plan, bible: makeBible(), ledger: null, isSeasonFinale: false });
    expect(diagnoses).toHaveLength(1);
    expect(diagnoses[0]!.classification).toBe("genuine_continuity_error");
    expect(diagnoses[0]!.revisionNecessary).toBe(true);
    expect(diagnoses[0]!.recommendedCorrection).toBeTruthy();
  });

  it("marks validator false positives as not requiring revision", () => {
    const plan = makePlan([makeEpisode(1), makeEpisode(2)]);
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "d4", category: "reference_integrity", severity: "low", message: "Main character Mara Voss is not referenced in episode 1.", episodeNumber: 1 }),
    ];
    const diagnoses = diagnoseFindings({ findings, plan, bible: makeBible(), ledger: null, isSeasonFinale: false });
    expect(diagnoses).toHaveLength(1);
    expect(diagnoses[0]!.classification).toBe("validator_false_positive");
    expect(diagnoses[0]!.revisionNecessary).toBe(false);
    expect(diagnoses[0]!.recommendedCorrection).toBeNull();
  });

  it("marks intentional creative decisions as requiring human approval", () => {
    const plan = makePlan([makeEpisode(1), makeEpisode(2)]);
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "d5", category: "narrative_integrity", severity: "medium", message: "Unresolved thread: deliberately unresolved cliffhanger mystery.", episodeNumber: 2 }),
    ];
    const diagnoses = diagnoseFindings({ findings, plan, bible: makeBible(), ledger: null, isSeasonFinale: true });
    expect(diagnoses).toHaveLength(1);
    expect(diagnoses[0]!.classification).toBe("intentional_creative_decision");
    expect(diagnoses[0]!.requiresHumanApproval).toBe(true);
    expect(diagnoses[0]!.revisionNecessary).toBe(false);
  });

  it("identifies downstream effects for character identity corrections", () => {
    const plan = makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3), makeEpisode(4)]);
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "d6", category: "unknown_entity_reference", severity: "high", message: "Episode 1 references character 'Mara' who is not in the story bible.", episodeNumber: 1 }),
    ];
    const diagnoses = diagnoseFindings({ findings, plan, bible: makeBible(), ledger: null, isSeasonFinale: false });
    expect(diagnoses).toHaveLength(1);
    expect(diagnoses[0]!.domain).toBe("character_identity_aliases");
    expect(diagnoses[0]!.potentialDownstreamEffects.length).toBeGreaterThan(0);
  });

  it("returns an empty array for no findings", () => {
    const plan = makePlan([makeEpisode(1)]);
    const diagnoses = diagnoseFindings({ findings: [], plan, bible: null, ledger: null, isSeasonFinale: false });
    expect(diagnoses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// User's real-world error scenarios
// ---------------------------------------------------------------------------

describe("Real-world validation error scenarios", () => {
  beforeEach(() => {
    resetFindingIdCounter();
    resetGroupCounter();
  });

  describe("Scenario 1: Character alias (Mara → Mara Voss)", () => {
    it("groups all 'Mara' references across episodes 1–5 into one group", () => {
      const findings: RichValidationFinding[] = [
        makeFinding({ findingId: "alias-1", category: "unknown_entity_reference", severity: "high", message: "Episode 1 references character 'Mara' who is not in the story bible.", episodeNumber: 1 }),
        makeFinding({ findingId: "alias-2", category: "unknown_entity_reference", severity: "high", message: "Episode 2 references character 'Mara' who is not in the story bible.", episodeNumber: 2 }),
        makeFinding({ findingId: "alias-3", category: "unknown_entity_reference", severity: "high", message: "Episode 3 references character 'Mara' who is not in the story bible.", episodeNumber: 3 }),
        makeFinding({ findingId: "alias-4", category: "unknown_entity_reference", severity: "high", message: "Episode 4 references character 'Mara' who is not in the story bible.", episodeNumber: 4 }),
        makeFinding({ findingId: "alias-5", category: "unknown_entity_reference", severity: "high", message: "Episode 5 references character 'Mara' who is not in the story bible.", episodeNumber: 5 }),
      ];
      const groups = groupFindings(findings);
      expect(groups).toHaveLength(1);
      expect(groups[0]!.findingIds).toHaveLength(5);
      expect(groups[0]!.affectedEpisodes).toEqual([1, 2, 3, 4, 5]);
      expect(groups[0]!.domain).toBe("character_identity_aliases");
    });

    it("classifies the alias as ambiguous when aliases are known", () => {
      const finding = makeFinding({
        findingId: "alias-classify",
        category: "unknown_entity_reference",
        severity: "high",
        message: "Episode 1 references character 'Mara' who is not in the story bible.",
      });
      const result = classifyFinding(finding, classificationContext({
        knownAliases: new Set(["mara"]),
      }));
      expect(result.classification).toBe("ambiguous_requires_investigation");
    });

    it("diagnoses the alias and requires human approval", () => {
      const plan = makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3), makeEpisode(4), makeEpisode(5), makeEpisode(6)]);
      const findings: RichValidationFinding[] = [
        makeFinding({ findingId: "alias-dx-1", category: "unknown_entity_reference", severity: "high", message: "Episode 1 references character 'Mara' who is not in the story bible.", episodeNumber: 1 }),
        makeFinding({ findingId: "alias-dx-2", category: "unknown_entity_reference", severity: "high", message: "Episode 2 references character 'Mara' who is not in the story bible.", episodeNumber: 2 }),
      ];
      const diagnoses = diagnoseFindings({ findings, plan, bible: makeBible(), ledger: null, isSeasonFinale: false });
      expect(diagnoses).toHaveLength(1);
      expect(diagnoses[0]!.domain).toBe("character_identity_aliases");
      expect(diagnoses[0]!.requiresHumanApproval).toBe(true);
    });
  });

  describe("Scenario 2: Unknown location (Abandoned Warehouse)", () => {
    it("classifies a location not in the bible as missing_canon_information", () => {
      const finding = makeFinding({
        findingId: "loc-1",
        category: "unknown_entity_reference",
        severity: "medium",
        message: "Location 'Abandoned Warehouse' is not in the story bible.",
        episodeNumber: 3,
      });
      const result = classifyFinding(finding, classificationContext());
      expect(result.classification).toBe("missing_canon_information");
    });

    it("diagnoses the location and provides a correction recommendation", () => {
      const plan = makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3), makeEpisode(4)]);
      const findings: RichValidationFinding[] = [
        makeFinding({ findingId: "loc-dx-1", category: "unknown_entity_reference", severity: "medium", message: "Location 'Abandoned Warehouse' is not in the story bible.", episodeNumber: 3 }),
      ];
      const diagnoses = diagnoseFindings({ findings, plan, bible: makeBible(), ledger: null, isSeasonFinale: false });
      expect(diagnoses).toHaveLength(1);
      expect(diagnoses[0]!.classification).toBe("missing_canon_information");
      expect(diagnoses[0]!.recommendedCorrection).toContain("abandoned warehouse");
      expect(diagnoses[0]!.recommendedCorrection).toContain("location");
    });
  });

  describe("Scenario 3: Missing payoff for foreshadowing", () => {
    it("classifies a missing payoff with subsequent episodes as ambiguous", () => {
      const finding = makeFinding({
        findingId: "payoff-1",
        category: "setup_payoff",
        severity: "medium",
        message: "Episode 2 foreshadowing 'The phantom appears briefly' has no payoff.",
        episodeNumber: 2,
      });
      const result = classifyFinding(finding, classificationContext({ hasSubsequentEpisodes: true }));
      expect(result.classification).toBe("ambiguous_requires_investigation");
    });

    it("diagnoses the missing payoff and searches subsequent episodes", () => {
      const plan = makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3), makeEpisode(4), makeEpisode(5), makeEpisode(6)]);
      const findings: RichValidationFinding[] = [
        makeFinding({ findingId: "payoff-dx-1", category: "setup_payoff", severity: "medium", message: "Episode 2 foreshadowing 'The phantom appears briefly' has no payoff.", episodeNumber: 2 }),
      ];
      const diagnoses = diagnoseFindings({ findings, plan, bible: makeBible(), ledger: null, isSeasonFinale: false });
      expect(diagnoses).toHaveLength(1);
      expect(diagnoses[0]!.sourceEvidence.subsequentEpisodePlans.length).toBeGreaterThan(0);
      expect(diagnoses[0]!.sourceEvidence.subsequentEpisodePlans.map((e) => e.episodeNumber)).toContain(3);
    });
  });

  describe("Scenario 4: Main characters not referenced in early episodes", () => {
    it("classifies 'not referenced in episode' findings as validator false positives", () => {
      const findings: RichValidationFinding[] = [
        makeFinding({ findingId: "notref-1", category: "reference_integrity", severity: "low", message: "Main character Mara Voss is not referenced in episode 1.", episodeNumber: 1 }),
        makeFinding({ findingId: "notref-2", category: "reference_integrity", severity: "low", message: "Main character Dr. Miriam Vale is not referenced in episode 1.", episodeNumber: 1 }),
      ];
      const results = classifyFindings(findings, classificationContext());
      expect(results.every((r) => r.classification === "validator_false_positive")).toBe(true);
    });

    it("diagnoses false positives as not requiring revision", () => {
      const plan = makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3)]);
      const findings: RichValidationFinding[] = [
        makeFinding({ findingId: "notref-dx-1", category: "reference_integrity", severity: "low", message: "Main character Mara Voss is not referenced in episode 1.", episodeNumber: 1 }),
      ];
      const diagnoses = diagnoseFindings({ findings, plan, bible: makeBible(), ledger: null, isSeasonFinale: false });
      expect(diagnoses).toHaveLength(1);
      expect(diagnoses[0]!.revisionNecessary).toBe(false);
      expect(diagnoses[0]!.recommendedCorrection).toBeNull();
    });
  });

  describe("Scenario 5: Full mixed finding set", () => {
    it("diagnoses a realistic mix of findings from all categories", () => {
      const plan = makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3), makeEpisode(4), makeEpisode(5), makeEpisode(6)]);
      const bible = makeBible();
      const ledger = makeLedger();

      const findings: RichValidationFinding[] = [
        // Character alias issues
        makeFinding({ findingId: "mix-1", category: "unknown_entity_reference", severity: "high", message: "Episode 1 references character 'Mara' who is not in the story bible.", episodeNumber: 1 }),
        makeFinding({ findingId: "mix-2", category: "unknown_entity_reference", severity: "high", message: "Episode 2 references character 'Dr. Vale' who is not in the story bible.", episodeNumber: 2 }),
        // Location issues
        makeFinding({ findingId: "mix-3", category: "unknown_entity_reference", severity: "medium", message: "Location 'Abandoned Warehouse' is not in the story bible.", episodeNumber: 3 }),
        // Missing payoff
        makeFinding({ findingId: "mix-4", category: "setup_payoff", severity: "medium", message: "Episode 2 foreshadowing 'The phantom appears briefly' has no payoff.", episodeNumber: 2 }),
        // False positive
        makeFinding({ findingId: "mix-5", category: "reference_integrity", severity: "low", message: "Main character Mara Voss is not referenced in episode 1.", episodeNumber: 1 }),
        // Genuine continuity error
        makeFinding({ findingId: "mix-6", category: "canon_contradiction", severity: "blocking", message: "Episode 4 contradicts established canon: Mara is stated as a doctor.", episodeNumber: 4, canonIssueType: "CANON_CONTRADICTION" }),
      ];

      const diagnoses = diagnoseFindings({ findings, plan, bible, ledger, isSeasonFinale: false });

      expect(diagnoses.length).toBeGreaterThan(0);

      const classifications = diagnoses.map((d) => d.classification);
      expect(classifications).toContain("genuine_continuity_error");
      expect(classifications).toContain("validator_false_positive");

      const genuineError = diagnoses.find((d) => d.classification === "genuine_continuity_error");
      expect(genuineError?.revisionNecessary).toBe(true);
      expect(genuineError?.recommendedCorrection).toBeTruthy();

      const falsePositive = diagnoses.find((d) => d.classification === "validator_false_positive");
      expect(falsePositive?.revisionNecessary).toBe(false);
    });
  });
});