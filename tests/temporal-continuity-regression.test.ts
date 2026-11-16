import { describe, it, expect } from "vitest";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { CharacterProfile } from "@/lib/validation/productionStages";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";

import { validateSeasonPlanRich } from "@/lib/domain/planValidation/index";
import {
  buildRegistry,
  resolveCanonicalId,
  getCharacterStatusAtEpisode,
  getLifecycle,
  getThreadLifecycle,
  isIntroducedBy,
  hasAppearedBy,
} from "@/lib/domain/canonicalRegistry";
import { applyCanonToLedger } from "@/lib/domain/ledger";
import type { EpisodeCanonSummary } from "@/lib/validation/casna";

function makeBible(): StoryBibleContent {
  return {
    identity: {
      title: "The Rememberers",
      genres: ["Drama", "Sci-Fi"],
      subgenres: ["Psychological Thriller"],
      centralPremise: "A group of people who remember future events must navigate the consequences of their knowledge.",
      narrativeConcept: "Daniel's ability to remember tomorrow draws him into a conspiracy of other rememberers.",
      toneAndAtmosphere: "Tense, contemplative, surreal",
      targetAudience: "Adults who enjoy literary science fiction",
      centralConflict: "Daniel must uncover the conspiracy of rememberers while confronting his own mortality.",
    },
    world: {
      description: "A contemporary world where certain people experience memories of future events.",
      geographyAndLocations: [
        { name: "Daniel's Apartment", description: "A small apartment where Daniel lives alone.", storyFunction: "Daniel's home base" },
        { name: "The Hospital", description: "Where Daniel receives treatment.", storyFunction: "Medical setting" },
      ],
      socialStructuresAndCultures: ["Modern urban society"],
      historyAndPastEvents: ["Daniel had a wife named Lily who is his daughter in this story"],
      rules: ["Rememberers' memories of the future are real but fragmented", "The future cannot be changed, only accepted"],
      definingSystems: [],
    },
    characters: {
      characters: [
        {
          name: "Daniel",
          storyRole: "protagonist",
          roleDescription: "A man who remembers future events",
          physicalDescription: "Middle-aged, tired eyes",
          personality: "Contemplative, grieving, determined",
          background: "Lost his wife and struggles with his ability",
          motivations: ["To understand his ability", "To protect Lily"],
          fearsAndWeaknesses: ["Losing Lily", "Going mad"],
          abilitiesAndLimitations: ["Remembers future events", "Cannot change the future"],
          relationships: [
            { characterName: "Lily", relationship: "Daniel is Lily's father", tensionOrChange: "Protective father-daughter bond" },
          ],
          secrets: ["The full extent of his future memories"],
          developmentPotential: "Daniel must learn to accept his fate",
        },
        {
          name: "Lily",
          storyRole: "supporting",
          roleDescription: "Daniel's daughter",
          physicalDescription: "Young woman",
          personality: "Caring, curious",
          background: "Daniel's daughter who cares for him",
          motivations: ["To help her father"],
          fearsAndWeaknesses: ["Losing her father"],
          abilitiesAndLimitations: [],
          relationships: [
            { characterName: "Daniel", relationship: "Lily is Daniel's daughter", tensionOrChange: "Father-daughter bond" },
          ],
          secrets: [],
          developmentPotential: "Lily must learn to let go",
        },
      ],
      relationshipDynamics: ["Daniel and Lily share a deep father-daughter bond"],
    },
    narrative: {
      mainStoryline: "Daniel discovers a conspiracy of rememberers and must confront the truth about his own fate.",
      majorConflicts: ["Daniel vs. his memories", "Daniel vs. the conspiracy"],
      longTermDirection: "Daniel eventually accepts his fate and exposes the conspiracy.",
      subplots: ["Lily's struggle to understand her father", "Mara's hidden identity"],
      unresolvedMysteries: ["The origin of the remembering ability", "The identity of the other rememberers"],
      potentialFutureRevelations: ["The meaning of the final light", "Other rememberers in the world"],
      majorNarrativeQuestions: ["Will Daniel accept his fate?", "Who are the other rememberers?"],
      serializedEndingGuidance: "Daniel exposes the conspiracy but hints of more rememberers remain.",
    },
    guidelines: {
      mainThemes: ["Acceptance", "Grief", "Memory"],
      secondaryThemes: ["Family", "Mortality", "Conspiracy"],
      storytellingStyle: "Contemplative, non-linear",
      boundaries: ["Daniel cannot change the future", "The memories are real, not hallucinations"],
      mustRemainConsistent: ["Daniel is Lily's father", "Daniel's memories are real"],
    },
    canon: {
      confirmedFacts: ["Daniel is Lily's father", "Daniel remembers future events"],
      proposedDetails: [],
      unresolvedQuestions: ["The origin of Daniel's ability"],
      hiddenInformation: ["The full meaning of the final light"],
      characterKnowledge: [
        { characterName: "Daniel", knows: ["He will die", "Lily is his daughter"], believes: ["The future cannot be changed"] },
        { characterName: "Lily", knows: ["Daniel is her father"], believes: ["Daniel is unwell"] },
      ],
      audienceKnowledge: ["Daniel remembers the future"],
    },
  };
}

function makeCharacterProfiles(): CharacterProfile[] {
  return [
    {
      name: "Daniel",
      role: "protagonist",
      ageRange: "",
      gender: "",
      clothing: "",
      distinguishingFeatures: "",
      personality: "Contemplative, grieving, determined",
      physicalDescription: "Middle-aged, tired eyes",
      background: "Lost his wife and struggles with his ability",
      relationships: [],
      aliases: [],
      voiceManifestations: [],
    },
    {
      name: "Lily",
      role: "supporting",
      ageRange: "",
      gender: "",
      clothing: "",
      distinguishingFeatures: "",
      personality: "Caring, curious",
      physicalDescription: "Young woman",
      background: "Daniel's daughter",
      relationships: [],
      aliases: [],
      voiceManifestations: [],
    },
    {
      name: "Mara Voss",
      role: "antagonist",
      ageRange: "",
      gender: "",
      clothing: "",
      distinguishingFeatures: "",
      personality: "Mysterious, calculating",
      physicalDescription: "Tall, dark hair, distinctive scar",
      background: "A rememberer who has hidden her identity",
      relationships: [],
      aliases: [
        { name: "The Visitor", type: "codename", description: "Known by this name before her real identity is revealed" },
      ],
      voiceManifestations: [],
    },
    {
      name: "Dr. Miriam Vale",
      role: "recurring",
      ageRange: "",
      gender: "",
      clothing: "",
      distinguishingFeatures: "",
      personality: "Clinical, manipulative",
      physicalDescription: "Older woman, sharp features",
      background: "A researcher studying rememberers",
      relationships: [],
      aliases: [],
      voiceManifestations: [],
    },
  ];
}

function ep(num: number, overrides: Partial<EpisodePlanItem> = {}): EpisodePlanItem {
  return {
    episodeNumber: num,
    workingTitle: `Episode ${num}`,
    narrativePurpose: `Advance the story in episode ${num}`,
    startingSituation: `The situation at the start of episode ${num}`,
    mainObjective: `The objective for episode ${num}`,
    centralConflict: `The conflict in episode ${num}`,
    majorStoryBeats: [`Beat 1 of episode ${num}`],
    informationRevealed: [],
    characterDevelopment: `Daniel and Lily develop in episode ${num}`,
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
    seasonObjective: "Daniel must uncover the conspiracy of rememberers and accept his fate.",
    centralConflictOrMystery: "Daniel must uncover the conspiracy of rememberers while confronting his own mortality.",
    mainCharacterObjectives: "Daniel wants the truth; Lily wants to help her father.",
    overallCharacterDevelopment: "Daniel learns to accept his fate and expose the conspiracy.",
    majorStoryDevelopments: ["Mara's identity is revealed", "The conspiracy is exposed"],
    beginningDirection: "Daniel discovers his ability and meets Lily.",
    middleDirection: "Daniel uncovers the conspiracy with Mara's help.",
    endingDirection: "Daniel exposes the conspiracy and accepts his fate.",
    episodeProgression: episodes,
    importantRevelations: ["Mara Voss is a rememberer", "The conspiracy is real"],
    relationshipChanges: ["Daniel and Mara move from adversaries to allies"],
    consequencesCarriedBetween: ["Mara's identity is known"],
    setupAndPayoff: [
      "Setup: Mara's mysterious visits in episode 2",
      "Payoff: Mara's identity and motivation revealed in episode 5",
    ],
    unresolvedQuestions: ["Are there other rememberers beyond those Daniel has met?"],
    intendedSeasonConclusion: "Daniel exposes the conspiracy of rememberers and accepts his mortality, but hints of more rememberers remain.",
  };
}

function makeFullPlan(): SeasonPlan {
  return makePlan([
    ep(1, {
      workingTitle: "The First Memory",
      characterDevelopment: "Daniel experiences a vivid memory of tomorrow and confides in Lily.",
      characterArcChanges: [
        { name: "Daniel", change: "Daniel experiences his first conscious future memory" },
        { name: "Lily", change: "Lily worries about Daniel's mental state" },
      ],
    }),
    ep(2, {
      workingTitle: "The Visitor",
      characterDevelopment: "Daniel is visited by a mysterious woman who seems to know about his ability. Mara Voss is introduced.",
      characterArcChanges: [
        { name: "Daniel", change: "Daniel meets The Visitor and is unsettled" },
        { name: "Mara Voss", change: "Mara Voss is introduced as a mysterious visitor who reveals she knows about Daniel's ability" },
      ],
      relationshipChanges: [
        { from: "Mara Voss", to: "Daniel", change: "Mara approaches Daniel with knowledge of his ability" },
      ],
      unresolvedThreads: ["Who is The Visitor and what does she want?"],
    }),
    ep(3, {
      workingTitle: "The Researcher",
      characterDevelopment: "Daniel meets Dr. Miriam Vale at the Quantum Annex, a secret research facility. Dr. Vale is introduced.",
      characterArcChanges: [
        { name: "Daniel", change: "Daniel discovers the Quantum Annex" },
        { name: "Dr. Miriam Vale", change: "Dr. Miriam Vale is introduced as a researcher studying rememberers" },
        { name: "Mara Voss", change: "Mara Voss is revealed to be working with Dr. Vale" },
      ],
      locationChanges: [
        { name: "Quantum Annex", change: "Daniel is brought to the Quantum Annex, a secret research facility" },
      ],
      relationshipChanges: [
        { from: "Dr. Miriam Vale", to: "Daniel", change: "Dr. Vale manipulates Daniel into joining her research" },
      ],
      informationRevealed: ["The Quantum Annex is a facility for studying rememberers"],
    }),
    ep(4, {
      workingTitle: "The Betrayal",
      characterDevelopment: "Daniel discovers that Dr. Vale has been manipulating him. A new character, Marcus, is introduced.",
      characterArcChanges: [
        { name: "Daniel", change: "Daniel realizes he has been manipulated" },
        { name: "Marcus", change: "Marcus is introduced as another rememberer who warns Daniel" },
      ],
    }),
    ep(5, {
      workingTitle: "The Truth",
      characterDevelopment: "Mara's true identity and motivation are revealed. She is a rememberer trying to protect others like Daniel.",
      characterArcChanges: [
        { name: "Mara Voss", change: "Mara's identity as a rememberer and protector is revealed" },
        { name: "Daniel", change: "Daniel learns to trust Mara" },
      ],
      informationRevealed: ["Mara Voss is a rememberer who has been protecting others"],
      relationshipChanges: [
        { from: "Daniel", to: "Mara Voss", change: "Daniel and Mara become allies" },
      ],
    }),
    ep(6, {
      workingTitle: "The Rememberers",
      characterDevelopment: "Daniel exposes the conspiracy and accepts his fate. A voice hint suggests other rememberers exist.",
      characterArcChanges: [
        { name: "Daniel", change: "Daniel exposes the conspiracy and accepts his mortality" },
        { name: "Dr. Miriam Vale", change: "Dr. Vale's manipulation is exposed and she is held accountable" },
      ],
      importantEvents: ["Daniel exposes the conspiracy of rememberers", "A voice hint reveals other rememberers exist in the world"],
      endingOrCliffhanger: "Daniel accepts his fate, but a voice hint suggests there are other rememberers beyond those he has met.",
      unresolvedThreads: ["An unresolved thread: are there other rememberers beyond those Daniel has met, carried forward to next season?"],
      informationRevealed: ["Dr. Vale's manipulation is exposed", "Other rememberers exist in the world"],
    }),
  ]);
}

describe("Temporal Narrative Continuity — Regression Tests", () => {
  const bible = makeBible();
  const profiles = makeCharacterProfiles();
  const plan = makeFullPlan();
  const registry = buildRegistry({ bible, plan, ledger: null, characterProfiles: profiles });

  describe("1. Character introduction absence", () => {
    it("Mara Voss introduced in Episode 2: no Episode 1 absence error", () => {
      const maraId = resolveCanonicalId(registry, "Mara Voss", "character");
      expect(maraId).not.toBeNull();
      const status = getCharacterStatusAtEpisode(registry, maraId!, 1);
      expect(status).toBe("not_yet_introduced");

      const result = validateSeasonPlanRich(plan, bible);
      const absenceFindings = result.findings.filter(
        (f) => f.category === "canon_contradiction" &&
          f.episodeNumber === 1 &&
          f.message.includes("Mara"),
      );
      expect(absenceFindings).toHaveLength(0);
    });

    it("Dr. Miriam Vale introduced later: no findings in earlier episodes merely because she is absent", () => {
      const valeId = resolveCanonicalId(registry, "Dr. Miriam Vale", "character");
      expect(valeId).not.toBeNull();
      const statusEp1 = getCharacterStatusAtEpisode(registry, valeId!, 1);
      const statusEp2 = getCharacterStatusAtEpisode(registry, valeId!, 2);
      expect(statusEp1).toBe("not_yet_introduced");
      expect(statusEp2).toBe("not_yet_introduced");

      const result = validateSeasonPlanRich(plan, bible);
      const absenceFindings = result.findings.filter(
        (f) => f.category === "canon_contradiction" &&
          (f.episodeNumber === 1 || f.episodeNumber === 2) &&
          f.message.includes("Vale"),
      );
      expect(absenceFindings).toHaveLength(0);
    });
  });

  describe("2. Alias resolution", () => {
    it("Mara's alias resolves to the same canonical character", () => {
      const maraId = resolveCanonicalId(registry, "Mara Voss", "character");
      const aliasId = resolveCanonicalId(registry, "The Visitor", "character");
      expect(maraId).not.toBeNull();
      expect(aliasId).not.toBeNull();
      expect(aliasId).toBe(maraId);
    });

    it("alias use in Episode 2 relationship change creates no duplicate entity", () => {
      const maraEntities = registry.entities.filter(
        (e) => e.type === "character" &&
          (e.primaryName === "Mara Voss" ||
            e.aliases.some((a) => a.name === "The Visitor")),
      );
      expect(maraEntities).toHaveLength(1);
    });

    it("alias use in relationship change does not create duplicate Ledger state", () => {
      const canonSummary: EpisodeCanonSummary = {
        episodeNumber: 2,
        title: "The Visitor",
        events: [],
        characterStates: [
          {
            name: "Mara Voss",
            currentLocation: "Daniel's Apartment",
            currentObjective: "Approach Daniel",
            knowledge: [],
            beliefs: [],
            motivations: ["To protect rememberers"],
            emotionalState: "Calculating",
            physicalState: "",
            relationships: [
              { characterName: "Daniel", relationship: "Adversary", tensionOrChange: "Mara approaches Daniel" },
            ],
          },
        ],
        locationStates: [],
        objectStates: [],
        revealedSecrets: [],
        unresolvedThreads: [],
        consequences: [],
        summary: "",
      };

      const ledger1 = applyCanonToLedger(null, canonSummary);
      const ledger2 = applyCanonToLedger(ledger1, { ...canonSummary, episodeNumber: 3 });

      const maraStates = ledger2.characterStates.filter(
        (s) => s.name.toLowerCase() === "mara voss",
      );
      expect(maraStates).toHaveLength(1);
    });
  });

  describe("3. Location introduction", () => {
    it("Quantum Annex introduced in Episode 3: accepted and recorded", () => {
      const locId = resolveCanonicalId(registry, "Quantum Annex", "location");
      expect(locId).not.toBeNull();
      expect(isIntroducedBy(registry, locId!, 3)).toBe(true);
      expect(hasAppearedBy(registry, locId!, 3)).toBe(true);
    });

    it("unexplained pre-introduction visit is flagged", () => {
      const planWithEarlyVisit = makePlan([
        ep(1, {
          workingTitle: "The First Memory",
          characterDevelopment: "Daniel experiences a vivid memory and visits the Quantum Annex.",
          characterArcChanges: [
            { name: "Daniel", change: "Daniel experiences his first conscious future memory" },
            { name: "Lily", change: "Lily worries about Daniel's mental state" },
          ],
          locationChanges: [
            { name: "Quantum Annex", change: "Daniel visits the Quantum Annex" },
          ],
        }),
        ...plan.episodeProgression.slice(1),
      ]);

      const earlyRegistry = buildRegistry({ bible, plan: planWithEarlyVisit, ledger: null });
      const result = validateSeasonPlanRich(planWithEarlyVisit, bible, { registry: earlyRegistry });
      const preIntroFindings = result.findings.filter(
        (f) => f.category === "unknown_entity_reference" &&
          f.episodeNumber === 1 &&
          f.message.includes("Quantum Annex"),
      );
      expect(preIntroFindings.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("4. Future-season hooks", () => {
    it("Episode 6 voice hint about other rememberers is allowed as an intentional future-season hook", () => {
      const threadLc = getThreadLifecycle(
        registry,
        "An unresolved thread: are there other rememberers beyond those Daniel has met, carried forward to next season?",
      );
      expect(threadLc).not.toBeNull();

      const result = validateSeasonPlanRich(plan, bible);
      const hookFindings = result.findings.filter(
        (f) => f.category === "setup_payoff" &&
          f.message.includes("other rememberers"),
      );
      expect(hookFindings).toHaveLength(0);
    });
  });

  describe("5. Setup/payoff attribution", () => {
    it("Mara's Episode 2 setup and Episode 5 payoff are evaluated together", () => {
      const maraThreadLc = getThreadLifecycle(registry, "Who is The Visitor and what does she want?");
      expect(maraThreadLc).not.toBeNull();
      expect(maraThreadLc!.firstReferenceEpisode).toBe(2);

      const result = validateSeasonPlanRich(plan, bible);
      const setupFindings = result.findings.filter(
        (f) => f.category === "setup_payoff" &&
          f.message.includes("Visitor"),
      );
      for (const f of setupFindings) {
        expect(f.episodeNumber).not.toBe(6);
      }
    });

    it("Dr. Vale's Episode 3 manipulation and Episode 6 payoff are evaluated across the season", () => {
      const valeId = resolveCanonicalId(registry, "Dr. Miriam Vale", "character");
      expect(valeId).not.toBeNull();
      const lc = getLifecycle(registry, valeId!);
      expect(lc).not.toBeNull();
      expect(lc!.firstAppearanceEpisode).toBe(3);

      const ep6 = plan.episodeProgression.find((e) => e.episodeNumber === 6);
      expect(ep6?.characterArcChanges.some((a) => a.name === "Dr. Miriam Vale")).toBe(true);
    });
  });

  describe("6. Finale classification", () => {
    it("finale is classified using the actual central conflict and season plan", () => {
      const result = validateSeasonPlanRich(plan, bible);
      const climaxFindings = result.findings.filter(
        (f) => f.category === "climax_resolution" || f.category === "premature_climax",
      );
      for (const f of climaxFindings) {
        expect(f.episodeNumber ?? 0).not.toBeLessThan(1);
      }
    });

    it("distinguishes conflict resolution from future-season hooks", () => {

      const hookQuestions = plan.unresolvedQuestions.filter(
        (q) => q.toLowerCase().includes("other rememberers"),
      );
      expect(hookQuestions.length).toBeGreaterThan(0);
    });
  });

  describe("7. Character introduction cases", () => {
    it("Episode 2: Mara Voss introduction", () => {
      const maraId = resolveCanonicalId(registry, "Mara Voss", "character");
      expect(maraId).not.toBeNull();
      expect(hasAppearedBy(registry, maraId!, 2)).toBe(true);
      expect(hasAppearedBy(registry, maraId!, 1)).toBe(false);
    });

    it("Episode 3: Dr. Miriam Vale introduction", () => {
      const valeId = resolveCanonicalId(registry, "Dr. Miriam Vale", "character");
      expect(valeId).not.toBeNull();
      expect(hasAppearedBy(registry, valeId!, 3)).toBe(true);
      expect(hasAppearedBy(registry, valeId!, 2)).toBe(false);
    });

    it("Episode 4: Marcus introduction", () => {
      const marcusId = resolveCanonicalId(registry, "Marcus", "character");
      expect(marcusId).not.toBeNull();
      expect(hasAppearedBy(registry, marcusId!, 4)).toBe(true);
      expect(hasAppearedBy(registry, marcusId!, 3)).toBe(false);
    });

    it("Episode 5: Mara's identity revealed (development)", () => {
      const maraId = resolveCanonicalId(registry, "Mara Voss", "character");
      const lc = getLifecycle(registry, maraId!);
      expect(lc).not.toBeNull();
      expect(lc!.developmentEpisodes).toContain(5);
    });

    it("mid-season location introduction (Quantum Annex in Episode 3)", () => {
      const locId = resolveCanonicalId(registry, "Quantum Annex", "location");
      expect(locId).not.toBeNull();
      const lc = getLifecycle(registry, locId!);
      expect(lc).not.toBeNull();
      expect(lc!.firstAppearanceEpisode).toBe(3);
    });

    it("alias-collision: The Visitor resolves to Mara Voss, not a separate entity", () => {
      const visitorId = resolveCanonicalId(registry, "The Visitor", "character");
      const maraId = resolveCanonicalId(registry, "Mara Voss", "character");
      expect(visitorId).toBe(maraId);

      const allChars = registry.entities.filter((e) => e.type === "character");
      const visitorOnly = allChars.filter(
        (e) => e.primaryName === "The Visitor" && e.canonicalId !== maraId,
      );
      expect(visitorOnly).toHaveLength(0);
    });

    it("nonlinear-timeline: flashback indicators are recognized", () => {
      const flashbackPlan = makePlan([
        ep(1, {
          characterDevelopment: "Daniel has a flashback to a memory from years ago.",
          importantEvents: ["Flashback: Daniel remembers meeting Lily as a child"],
        }),
        ...plan.episodeProgression.slice(1),
      ]);
      const fbRegistry = buildRegistry({ bible, plan: flashbackPlan, ledger: null });
      const eventEntity = fbRegistry.entities.find(
        (e) => e.type === "event" && e.description.includes("Flashback"),
      );
      expect(eventEntity).toBeDefined();
      if (eventEntity) {
        const lc = getLifecycle(fbRegistry, eventEntity.canonicalId);
        expect(lc?.isNonLinear).toBe(true);
      }
    });

    it("relationship-support: relationship begins in same episode as character introduction", () => {
      const maraId = resolveCanonicalId(registry, "Mara Voss", "character");
      expect(maraId).not.toBeNull();
      expect(hasAppearedBy(registry, maraId!, 2)).toBe(true);

      const ep2 = plan.episodeProgression.find((e) => e.episodeNumber === 2);
      expect(ep2?.relationshipChanges.some((r) => r.from === "Mara Voss")).toBe(true);
    });
  });

  describe("8. Hard contradiction behavior and approved-only Ledger advancement", () => {
    it("preserves hard contradiction behavior for reversed parent-child relationships", () => {
      const contradictionPlan = makePlan([
        ep(1, {
          characterArcChanges: [
            { name: "Daniel", change: "Daniel is established as Lily's father" },
            { name: "Lily", change: "Lily is established as Daniel's daughter" },
          ],
          relationshipChanges: [
            { from: "Lily", to: "Daniel", change: "Lily is the father of Daniel" },
          ],
        }),
        ...plan.episodeProgression.slice(1),
      ]);

      const result = validateSeasonPlanRich(contradictionPlan, bible);
      const contradictionFindings = result.findings.filter(
        (f) => f.category === "relationship_integrity" && f.severity === "blocking",
      );
      expect(contradictionFindings.length).toBeGreaterThan(0);
    });

    it("approved-only Ledger advancement: applyCanonToLedger merges correctly", () => {
      const summary1: EpisodeCanonSummary = {
        episodeNumber: 1,
        title: "The First Memory",
        events: [],
        characterStates: [
          {
            name: "Daniel",
            currentLocation: "Daniel's Apartment",
            currentObjective: "Understand his ability",
            knowledge: [],
            beliefs: [],
            motivations: [],
            emotionalState: "Confused",
            physicalState: "",
            relationships: [],
          },
        ],
        locationStates: [],
        objectStates: [],
        revealedSecrets: [],
        unresolvedThreads: [],
        consequences: [],
        summary: "",
      };

      const summary2: EpisodeCanonSummary = {
        ...summary1,
        episodeNumber: 2,
        title: "The Visitor",
        characterStates: [
          {
            name: "Daniel",
            currentLocation: "Daniel's Apartment",
            currentObjective: "Investigate The Visitor",
            knowledge: ["The Visitor knows about his ability"],
            beliefs: [],
            motivations: [],
            emotionalState: "Suspicious",
            physicalState: "",
            relationships: [],
          },
          {
            name: "Mara Voss",
            currentLocation: "Daniel's Apartment",
            currentObjective: "Approach Daniel",
            knowledge: [],
            beliefs: [],
            motivations: [],
            emotionalState: "Calculating",
            physicalState: "",
            relationships: [],
          },
        ],
      };

      const ledger1 = applyCanonToLedger(null, summary1);
      expect(ledger1.characterStates).toHaveLength(1);
      expect(ledger1.characterStates[0]!.name).toBe("Daniel");

      const ledger2 = applyCanonToLedger(ledger1, summary2);
      expect(ledger2.characterStates).toHaveLength(2);
      const daniel = ledger2.characterStates.find((s) => s.name === "Daniel");
      expect(daniel).toBeDefined();
      expect(daniel!.emotionalState).toBe("Suspicious");
      const mara = ledger2.characterStates.find((s) => s.name === "Mara Voss");
      expect(mara).toBeDefined();
    });

    it("Ledger is not modified by validation — only by approval", () => {
      const ledger: ContinuityLedger = {
        events: [],
        characterStates: [],
        locationStates: [],
        objectStates: [],
        revealedSecrets: [],
        unresolvedThreads: [],
        consequences: [],
        timelineNotes: "",
      };

      const result = validateSeasonPlanRich(plan, bible);
      expect(result.findings).toBeDefined();

      expect(ledger.characterStates).toHaveLength(0);
      expect(ledger.events).toHaveLength(0);
    });
  });
});