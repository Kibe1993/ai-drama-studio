import { describe, it, expect, beforeEach } from "vitest";
import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { RichValidationFinding } from "@/lib/validation/seasonPlanValidation";
import { resetFindingIdCounter } from "@/lib/validation/seasonPlanValidation";
import {
  DOMAIN_PRIORITY,
  AUTO_APPLICABLE_ACTIONS,
  DEFAULT_MAX_ROUNDS,
  REVISION_ACTION_TYPES,
  SAFETY_CONSTRAINTS,

} from "@/lib/validation/revisionPlan";
import { diagnoseFindings } from "@/lib/domain/planValidation/findingDiagnoser";
import {
  planRevisions,
  getAutoApplicableActions,
  getActionsRequiringApproval,
  getActionsByDomain,
  hasExceededMaxRounds,
  shouldStopRevising,
  resetActionCounter,
} from "@/lib/domain/planValidation/revisionPlanner";

// ---------------------------------------------------------------------------
// Fixtures — reuse the same pattern from the Milestone 1 tests
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
      socialStructuresAndCultures: ["Modern urban society"],
      historyAndPastEvents: ["Mara's past encounter with the phantom"],
      rules: ["The phantom appears only to Mara"],
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
          motivations: ["Expose the conspiracy"],
          fearsAndWeaknesses: ["Losing her sanity"],
          abilitiesAndLimitations: ["Keen investigative skills"],
          relationships: [
            { characterName: "Dr. Miriam Vale", relationship: "Adversary", tensionOrChange: "Mutual distrust" },
          ],
          secrets: ["The full truth about her past"],
          developmentPotential: "Mara must confront her past",
        },
        {
          name: "Dr. Miriam Vale",
          storyRole: "antagonist",
          roleDescription: "A researcher at the secret facility",
          physicalDescription: "Composed, clinical",
          personality: "Brilliant, guarded, morally ambiguous",
          background: "Lead researcher at the underground facility",
          motivations: ["Protect her research"],
          fearsAndWeaknesses: ["Exposure of her work"],
          abilitiesAndLimitations: ["Scientific expertise"],
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
      majorConflicts: ["Mara vs. the conspiracy"],
      longTermDirection: "Mara exposes the facility and confronts the phantom.",
      subplots: ["Vale's ethical struggle"],
      unresolvedMysteries: ["The true nature of the phantom"],
      potentialFutureRevelations: ["The phantom is a side effect of the experiments"],
      majorNarrativeQuestions: ["Will Mara expose the facility?"],
      serializedEndingGuidance: "Mara confronts the phantom in the season finale.",
    },
    guidelines: {
      mainThemes: ["Truth", "Conspiracy"],
      secondaryThemes: ["Ethics"],
      storytellingStyle: "Atmospheric thriller",
      boundaries: ["The phantom is real, not a hallucination"],
      mustRemainConsistent: ["Mara is a former detective"],
    },
    canon: {
      confirmedFacts: ["Mara is a former police detective"],
      proposedDetails: [],
      unresolvedQuestions: ["The nature of the phantom"],
      hiddenInformation: ["The experiments' side effects"],
      characterKnowledge: [
        { characterName: "Mara Voss", knows: ["People are disappearing"], believes: ["The phantom is connected"] },
        { characterName: "Dr. Miriam Vale", knows: ["The experiments cause visions"], believes: ["The research is justified"] },
      ],
      audienceKnowledge: ["People are disappearing"],
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
    centralConflictOrMystery: "What is the phantom?",
    mainCharacterObjectives: "Mara seeks the truth.",
    overallCharacterDevelopment: "Mara goes from haunted to empowered.",
    majorStoryDevelopments: ["The phantom appears"],
    beginningDirection: "Establish Mara's investigation.",
    middleDirection: "Mara narrows in on the facility.",
    endingDirection: "Mara confronts the phantom.",
    episodeProgression: episodes,
    importantRevelations: ["The phantom is a side effect"],
    relationshipChanges: ["Mara and Vale form an alliance"],
    consequencesCarriedBetween: ["Mara's growing understanding"],
    setupAndPayoff: ["Episode 2: The phantom appears briefly"],
    unresolvedQuestions: ["The full extent of the experiments"],
    intendedSeasonConclusion: "Mara exposes the facility.",
  };
}

function makeFinding(overrides: Partial<RichValidationFinding> & Pick<RichValidationFinding, "findingId" | "category" | "severity" | "message">): RichValidationFinding {
  return { source: "deterministic", requiresHumanReview: false, ...overrides };
}

function diagnose(findings: RichValidationFinding[], isSeasonFinale = false) {
  return diagnoseFindings({
    findings,
    plan: makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3), makeEpisode(4), makeEpisode(5), makeEpisode(6)]),
    bible: makeBible(),
    ledger: null,
    isSeasonFinale,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Revision Plan Types", () => {
  it("defines 9 revision action types", () => {
    expect(REVISION_ACTION_TYPES).toHaveLength(9);
    expect(REVISION_ACTION_TYPES).toContain("alias_resolution");
    expect(REVISION_ACTION_TYPES).toContain("canon_addition");
    expect(REVISION_ACTION_TYPES).toContain("episode_revision");
    expect(REVISION_ACTION_TYPES).toContain("investigate");
    expect(REVISION_ACTION_TYPES).toContain("preserve_intentional");
  });

  it("defines 11 safety constraints", () => {
    expect(SAFETY_CONSTRAINTS).toHaveLength(11);
    expect(SAFETY_CONSTRAINTS).toContain("smallest_possible_change");
    expect(SAFETY_CONSTRAINTS).toContain("no_canon_modification");
    expect(SAFETY_CONSTRAINTS).toContain("no_premise_change");
    expect(SAFETY_CONSTRAINTS).toContain("no_history_invention");
  });

  it("assigns character_identity_aliases the highest priority (1)", () => {
    expect(DOMAIN_PRIORITY.character_identity_aliases).toBe(1);
  });

  it("assigns minor domains the lowest priority (8)", () => {
    expect(DOMAIN_PRIORITY.location_continuity).toBe(8);
    expect(DOMAIN_PRIORITY.character_knowledge_motivations).toBe(8);
    expect(DOMAIN_PRIORITY.episode_contradictions).toBe(8);
  });

  it("follows the spec priority order", () => {
    expect(DOMAIN_PRIORITY.character_identity_aliases).toBeLessThan(DOMAIN_PRIORITY.character_continuity);
    expect(DOMAIN_PRIORITY.character_continuity).toBeLessThan(DOMAIN_PRIORITY.relationship_continuity);
    expect(DOMAIN_PRIORITY.relationship_continuity).toBeLessThan(DOMAIN_PRIORITY.narrative_progression);
    expect(DOMAIN_PRIORITY.narrative_progression).toBeLessThan(DOMAIN_PRIORITY.missing_setup);
    expect(DOMAIN_PRIORITY.missing_setup).toBeLessThan(DOMAIN_PRIORITY.unresolved_plot_threads);
    expect(DOMAIN_PRIORITY.unresolved_plot_threads).toBeLessThan(DOMAIN_PRIORITY.repeated_narrative_functions);
  });

  it("marks 5 action types as auto-applicable", () => {
    expect(AUTO_APPLICABLE_ACTIONS.size).toBe(5);
    expect(AUTO_APPLICABLE_ACTIONS.has("alias_resolution")).toBe(true);
    expect(AUTO_APPLICABLE_ACTIONS.has("canon_addition")).toBe(false);
    expect(AUTO_APPLICABLE_ACTIONS.has("investigate")).toBe(false);
  });

  it("defaults to 3 max rounds", () => {
    expect(DEFAULT_MAX_ROUNDS).toBe(3);
  });
});

// ---------------------------------------------------------------------------

describe("Revision Planner — action type determination", () => {
  beforeEach(() => {
    resetFindingIdCounter();
    resetActionCounter();
  });

  it("skips validator false positives (no action)", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "fp1", category: "reference_integrity", severity: "low", message: "Main character Mara Voss is not referenced in episode 1.", episodeNumber: 1 }),
    ]);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(plan.actions).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]!.classification).toBe("validator_false_positive");
  });

  it("creates preserve_intentional action for intentional creative decisions", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "int1", category: "narrative_integrity", severity: "medium", message: "Deliberately unresolved cliffhanger mystery.", episodeNumber: 6 }),
    ], true);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]!.type).toBe("preserve_intentional");
  });

  it("skips ambiguous findings requiring investigation", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "amb1", category: "setup_payoff", severity: "medium", message: "Episode 2 foreshadowing 'The phantom appears briefly' has no payoff.", episodeNumber: 2 }),
    ]);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(plan.skipped.length).toBeGreaterThanOrEqual(1);
    expect(plan.skipped.some((s) => s.classification === "ambiguous_requires_investigation")).toBe(true);
  });

  it("creates episode_revision action for genuine continuity errors", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "err1", category: "character_history_contradiction", severity: "blocking", message: "Episode 4 character history contradicts established canon.", episodeNumber: 4, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
    ]);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]!.type).toBe("episode_revision");
    expect(plan.actions[0]!.classification).toBe("genuine_continuity_error");
  });

  it("creates episode_revision action for genuine narrative problems", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "narr1", category: "premature_climax", severity: "high", message: "Episode 1 prematurely reaches the season's intended conclusion.", episodeNumber: 1 }),
    ]);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]!.type).toBe("episode_revision");
    expect(plan.actions[0]!.classification).toBe("genuine_narrative_problem");
  });

  it("creates canon_addition action for missing canon location findings", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "loc1", category: "unknown_entity_reference", severity: "medium", message: "Location 'Abandoned Warehouse' is not in the story bible.", episodeNumber: 3 }),
    ]);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]!.type).toBe("canon_addition");
  });
});

// ---------------------------------------------------------------------------

describe("Revision Planner — priority ordering", () => {
  beforeEach(() => {
    resetFindingIdCounter();
    resetActionCounter();
  });

  it("sorts actions by domain priority (highest priority first)", () => {
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "p1", category: "unknown_entity_reference", severity: "medium", message: "Location 'X' is not in the story bible.", episodeNumber: 3 }),
      makeFinding({ findingId: "p2", category: "canon_contradiction", severity: "blocking", message: "Direct canon contradiction.", episodeNumber: 4, canonIssueType: "CANON_CONTRADICTION" }),
      makeFinding({ findingId: "p3", category: "premature_climax", severity: "high", message: "Premature climax in episode 1.", episodeNumber: 1 }),
    ];
    const diagnoses = diagnose(findings);
    const plan = planRevisions({ diagnoses, round: 1 });

    const priorities = plan.actions.map((a) => a.priority);
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1]!);
    }
  });

  it("resolves priority ties by severity (blocking before high)", () => {
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "t1", category: "canon_contradiction", severity: "high", message: "High severity canon contradiction.", episodeNumber: 2, canonIssueType: "CANON_CONTRADICTION" }),
      makeFinding({ findingId: "t2", category: "character_history_contradiction", severity: "blocking", message: "Blocking character history contradiction.", episodeNumber: 3, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
    ];
    const diagnoses = diagnose(findings);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(plan.actions[0]!.classification).toBe("genuine_continuity_error");
  });
});

// ---------------------------------------------------------------------------

describe("Revision Planner — safety constraints", () => {
  beforeEach(() => {
    resetFindingIdCounter();
    resetActionCounter();
  });

  it("attaches correct safety constraints to episode_revision actions", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "s1", category: "character_history_contradiction", severity: "blocking", message: "Character history contradiction.", episodeNumber: 1, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
    ]);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(plan.actions[0]!.type).toBe("episode_revision");
    const constraints = plan.actions[0]!.safetyConstraints;
    expect(constraints).toContain("smallest_possible_change");
    expect(constraints).toContain("no_canon_modification");
    expect(constraints).toContain("preserve_dialogue");
    expect(constraints).toContain("preserve_scene_order");
    expect(constraints).toContain("preserve_motivations");
    expect(constraints).toContain("no_full_rewrite");
  });

  it("attaches no_history_invention to canon_addition actions", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "s2", category: "unknown_entity_reference", severity: "medium", message: "Location 'New Place' is not in the story bible.", episodeNumber: 1 }),
    ]);
    const plan = planRevisions({ diagnoses, round: 1 });
    const constraints = plan.actions[0]!.safetyConstraints;
    expect(constraints).toContain("no_history_invention");
    expect(constraints).toContain("no_premise_change");
  });

  it("attaches no_premise_change and no_rule_weakening to canon_correction actions", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "s3", category: "canon_contradiction", severity: "blocking", message: "Canon contradiction.", episodeNumber: 1, canonIssueType: "CANON_CONTRADICTION" }),
    ]);
    const plan = planRevisions({ diagnoses, round: 1 });
    const constraints = plan.actions[0]!.safetyConstraints;
    expect(constraints).toContain("no_premise_change");
    expect(constraints).toContain("no_rule_weakening");
  });
});

// ---------------------------------------------------------------------------

describe("Revision Planner — human approval", () => {
  beforeEach(() => {
    resetFindingIdCounter();
    resetActionCounter();
  });

  it("requires human approval for canon_addition actions", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "h1", category: "unknown_entity_reference", severity: "medium", message: "Location 'New Place' is not in the story bible.", episodeNumber: 1 }),
    ]);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(plan.actions[0]!.requiresHumanApproval).toBe(true);
    expect(plan.requiresHumanApproval).toBe(true);
  });

  it("does not require human approval for episode_revision of genuine errors", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "h2", category: "canon_contradiction", severity: "blocking", message: "Canon contradiction.", episodeNumber: 1, canonIssueType: "CANON_CONTRADICTION" }),
    ]);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(plan.actions[0]!.requiresHumanApproval).toBe(false);
  });

  it("requires human approval when any action requires it", () => {
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "h3", category: "canon_contradiction", severity: "blocking", message: "Canon contradiction.", episodeNumber: 1, canonIssueType: "CANON_CONTRADICTION" }),
      makeFinding({ findingId: "h4", category: "unknown_entity_reference", severity: "medium", message: "Location 'New Place' is not in the story bible.", episodeNumber: 2 }),
    ];
    const diagnoses = diagnose(findings);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(plan.requiresHumanApproval).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("Revision Planner — auto-apply and round limiting", () => {
  beforeEach(() => {
    resetFindingIdCounter();
    resetActionCounter();
  });

  it("can auto-apply when there are auto-applicable actions within round limit", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "a1", category: "canon_contradiction", severity: "blocking", message: "Canon contradiction.", episodeNumber: 1, canonIssueType: "CANON_CONTRADICTION" }),
    ]);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(plan.canAutoApply).toBe(true);
  });

  it("cannot auto-apply when all actions require human approval", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "a2", category: "unknown_entity_reference", severity: "medium", message: "Location 'New Place' is not in the story bible.", episodeNumber: 1 }),
    ]);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(plan.canAutoApply).toBe(false);
  });

  it("cannot auto-apply when round exceeds max rounds", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "a3", category: "canon_contradiction", severity: "blocking", message: "Canon contradiction.", episodeNumber: 1, canonIssueType: "CANON_CONTRADICTION" }),
    ]);
    const plan = planRevisions({ diagnoses, round: 4, maxRounds: 3 });
    expect(plan.canAutoApply).toBe(false);
    expect(hasExceededMaxRounds(plan)).toBe(true);
  });

  it("respects custom maxRounds", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "a4", category: "canon_contradiction", severity: "blocking", message: "Canon contradiction.", episodeNumber: 1, canonIssueType: "CANON_CONTRADICTION" }),
    ]);
    const plan = planRevisions({ diagnoses, round: 5, maxRounds: 5 });
    expect(plan.maxRounds).toBe(5);
    expect(hasExceededMaxRounds(plan)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("Revision Planner — utility functions", () => {
  beforeEach(() => {
    resetFindingIdCounter();
    resetActionCounter();
  });

  it("getAutoApplicableActions returns only auto-applicable actions", () => {
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "u1", category: "canon_contradiction", severity: "blocking", message: "Canon contradiction.", episodeNumber: 1, canonIssueType: "CANON_CONTRADICTION" }),
      makeFinding({ findingId: "u2", category: "unknown_entity_reference", severity: "medium", message: "Location 'New Place' is not in the story bible.", episodeNumber: 2 }),
    ];
    const diagnoses = diagnose(findings);
    const plan = planRevisions({ diagnoses, round: 1 });
    const autoActions = getAutoApplicableActions(plan);
    expect(autoActions.every((a) => !a.requiresHumanApproval)).toBe(true);
    expect(autoActions.every((a) => AUTO_APPLICABLE_ACTIONS.has(a.type))).toBe(true);
  });

  it("getActionsRequiringApproval returns only actions needing approval", () => {
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "u3", category: "canon_contradiction", severity: "blocking", message: "Canon contradiction.", episodeNumber: 1, canonIssueType: "CANON_CONTRADICTION" }),
      makeFinding({ findingId: "u4", category: "unknown_entity_reference", severity: "medium", message: "Location 'New Place' is not in the story bible.", episodeNumber: 2 }),
    ];
    const diagnoses = diagnose(findings);
    const plan = planRevisions({ diagnoses, round: 1 });
    const approvalActions = getActionsRequiringApproval(plan);
    expect(approvalActions.every((a) => a.requiresHumanApproval)).toBe(true);
    expect(approvalActions.length).toBeGreaterThan(0);
  });

  it("getActionsByDomain filters by domain", () => {
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "u5", category: "canon_contradiction", severity: "blocking", message: "Canon contradiction.", episodeNumber: 1, canonIssueType: "CANON_CONTRADICTION" }),
      makeFinding({ findingId: "u6", category: "premature_climax", severity: "high", message: "Premature climax.", episodeNumber: 2 }),
    ];
    const diagnoses = diagnose(findings);
    const plan = planRevisions({ diagnoses, round: 1 });
    const narrativeActions = getActionsByDomain(plan, "narrative_progression");
    expect(narrativeActions.every((a) => a.domain === "narrative_progression")).toBe(true);
  });

  it("shouldStopRevising returns true when max rounds exceeded", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "u7", category: "canon_contradiction", severity: "blocking", message: "Canon contradiction.", episodeNumber: 1, canonIssueType: "CANON_CONTRADICTION" }),
    ]);
    const plan = planRevisions({ diagnoses, round: 5, maxRounds: 3 });
    expect(shouldStopRevising(plan)).toBe(true);
  });

  it("shouldStopRevising returns true when no actions", () => {
    const plan = planRevisions({ diagnoses: [], round: 1 });
    expect(shouldStopRevising(plan)).toBe(true);
  });

  it("shouldStopRevising returns false when auto-applicable actions exist", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "u8", category: "canon_contradiction", severity: "blocking", message: "Canon contradiction.", episodeNumber: 1, canonIssueType: "CANON_CONTRADICTION" }),
    ]);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(shouldStopRevising(plan)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("Revision Planner — end-to-end with real-world scenarios", () => {
  beforeEach(() => {
    resetFindingIdCounter();
    resetActionCounter();
  });

  it("plans revisions for a mixed finding set", () => {
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "mix1", category: "unknown_entity_reference", severity: "high", message: "Episode 1 references character 'Mara' who is not in the story bible.", episodeNumber: 1 }),
      makeFinding({ findingId: "mix2", category: "unknown_entity_reference", severity: "medium", message: "Location 'Abandoned Warehouse' is not in the story bible.", episodeNumber: 3 }),
      makeFinding({ findingId: "mix3", category: "setup_payoff", severity: "medium", message: "Episode 2 foreshadowing 'The phantom appears briefly' has no payoff.", episodeNumber: 2 }),
      makeFinding({ findingId: "mix4", category: "reference_integrity", severity: "low", message: "Main character Mara Voss is not referenced in episode 1.", episodeNumber: 1 }),
      makeFinding({ findingId: "mix5", category: "canon_contradiction", severity: "blocking", message: "Episode 4 contradicts established canon.", episodeNumber: 4, canonIssueType: "CANON_CONTRADICTION" }),
    ];

    const diagnoses = diagnose(findings);
    const plan = planRevisions({ diagnoses, round: 1 });

    expect(plan.round).toBe(1);
    expect(plan.maxRounds).toBe(3);
    expect(plan.totalActions).toBeGreaterThan(0);
    expect(plan.actions.length + plan.skipped.length).toBe(diagnoses.length);

    const actionTypes = plan.actions.map((a) => a.type);
    expect(actionTypes).toContain("canon_addition");
    expect(actionTypes).toContain("canon_correction");

    const skipClassifications = plan.skipped.map((s) => s.classification);
    expect(skipClassifications).toContain("validator_false_positive");

    expect(plan.requiresHumanApproval).toBe(true);
  });

  it("produces a valid plan ID and timestamp", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "pid1", category: "canon_contradiction", severity: "blocking", message: "Canon contradiction.", episodeNumber: 1, canonIssueType: "CANON_CONTRADICTION" }),
    ]);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(plan.planId).toBeTruthy();
    expect(plan.planId).toContain("r1");
    expect(plan.createdAt).toBeTruthy();
  });

  it("produces correction guidance with root cause and recommendation", () => {
    const diagnoses = diagnose([
      makeFinding({ findingId: "cg1", category: "canon_contradiction", severity: "blocking", message: "Canon contradiction.", episodeNumber: 1, canonIssueType: "CANON_CONTRADICTION" }),
    ]);
    const plan = planRevisions({ diagnoses, round: 1 });
    expect(plan.actions[0]!.correctionGuidance).toContain("Root cause:");
    expect(plan.actions[0]!.correctionGuidance).toContain("Recommended correction:");
  });

  it("produces actions with unique action IDs", () => {
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "uid1", category: "canon_contradiction", severity: "blocking", message: "Canon contradiction A.", episodeNumber: 1, canonIssueType: "CANON_CONTRADICTION" }),
      makeFinding({ findingId: "uid2", category: "premature_climax", severity: "high", message: "Premature climax B.", episodeNumber: 2 }),
    ];
    const diagnoses = diagnose(findings);
    const plan = planRevisions({ diagnoses, round: 1 });
    const actionIds = plan.actions.map((a) => a.actionId);
    expect(new Set(actionIds).size).toBe(actionIds.length);
  });

  it("handles empty diagnoses gracefully", () => {
    const plan = planRevisions({ diagnoses: [], round: 1 });
    expect(plan.actions).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.totalActions).toBe(0);
    expect(plan.canAutoApply).toBe(false);
    expect(shouldStopRevising(plan)).toBe(true);
  });
});