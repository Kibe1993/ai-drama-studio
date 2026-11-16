import { describe, expect, it } from "vitest";
import { validateEpisodeScreenplay } from "@/lib/domain/screenplayValidation";
import {
  analyzeRevision,
  applyAcceptedChanges,
  assembleNarrativeContext,
  assessCausality,
  canonFromApprovedSources,
  defineCanon,
  defineEntity,
  evaluateProposal,
  failureIsRetryable,
  InMemoryCanonStore,
  knowledgeAt,
  markStaleArtifacts,
  parseRevisionResponse,
  proposeChange,
  renderNarrativeContext,
  resolveIdentity,
  runControlledRevision,
  upgradeRegressions,
  validateDisclosures,
  validateEntityUse,
  validateFinale,
  validateKnowledge,
  validateObjects,
  validateThreads,
  validateWorldRules,
  VersionConflict,
  adjudicateCriticFindings,
  mergeDerivedCanon,
  provenanceIsStale,
  resolveWorkingCanon,
} from "@/lib/domain/narrativeControl";
import { emptyAuthorization, type CanonState, type NarrativeRevisionResponse } from "@/lib/validation/narrativeControl";
import type { ScreenplayScene } from "@/lib/validation/story";
import type { StoryBibleContent } from "@/lib/validation/storyBible";

function response(canon: CanonState, overrides: Partial<NarrativeRevisionResponse> = {}): NarrativeRevisionResponse {
  return {
    taskId: "task-1",
    projectId: canon.projectId,
    narrativeVersion: canon.version,
    proposedContent: "",
    proposedChanges: [],
    newEntities: [],
    newFacts: [],
    modifiedFacts: [],
    dependencies: [],
    uncertainties: [],
    ...overrides,
  };
}

function lastBus(): CanonState {
  const samuel = defineEntity({ id: "character:samuel", kind: "character", name: "Samuel", aliases: ["Sam Voss"] });
  const nia = defineEntity({ id: "character:nia", kind: "character", name: "Nia", role: "passenger" });
  const driver = defineEntity({ id: "character:driver", kind: "character", name: "The Driver" });
  return defineCanon({
    projectId: "last-bus",
    version: 3,
    entities: [samuel, nia, driver],
    facts: [
      {
        id: "fact-driver",
        key: "accident.driver",
        statement: "Samuel caused the accident and was the original driver.",
        classification: "AUTHOR_TRUTH",
        protected: true,
        subjectEntityIds: [samuel.id],
        value: "Samuel",
        rolePhrase: "driver",
        audienceRevealEpisode: 4,
        certainPatterns: ["i was driving", "i caused the crash", "samuel caused the crash"],
        suspectedPatterns: ["might have been driving"],
      },
      {
        id: "fact-date",
        key: "accident.date",
        statement: "The accident happened on 10 March 2007.",
        classification: "ESTABLISHED_CANON",
        protected: true,
        value: "10 March 2007",
        literalKind: "date",
      },
      {
        id: "fact-bus",
        key: "bus.type",
        statement: "The supernatural bus is a city bus.",
        classification: "ESTABLISHED_CANON",
        protected: true,
        value: "city bus",
        forbiddenLiterals: ["school bus"],
      },
      {
        id: "fact-accident",
        key: "accident.occurred",
        statement: "An accident occurred.",
        classification: "AUDIENCE_KNOWLEDGE",
        protected: true,
        subjectEntityIds: [samuel.id],
        audienceRevealEpisode: 2,
        suspectedPatterns: ["an accident happened"],
      },
      {
        id: "fact-mystery",
        key: "mystery.explanation",
        statement: "The Driver does not explain the whole mystery before the finale.",
        classification: "AUTHOR_TRUTH",
        protected: true,
        audienceRevealEpisode: 5,
        certainPatterns: ["the driver explains everything"],
      },
    ],
    knowledge: [
      {
        id: "know-accident",
        characterId: samuel.id,
        factId: "fact-accident",
        knownFromEpisode: 2,
        certainty: "incomplete",
        learnedVia: "A clue at the bus stop.",
      },
      {
        id: "know-suspect",
        characterId: samuel.id,
        factId: "fact-driver",
        knownFromEpisode: 3,
        certainty: "suspected",
        learnedVia: "He connects the clue to the bus.",
      },
      {
        id: "know-certain",
        characterId: samuel.id,
        factId: "fact-driver",
        knownFromEpisode: 4,
        certainty: "certain",
        learnedVia: "He remembers that he was driving.",
        supportingEventId: "event-memory",
      },
    ],
    rules: [
      {
        id: "rule-bus",
        description: "The supernatural bus appears at 11:47 PM.",
        scope: "the bus stop",
        approvalStatus: "approved",
        violationPatterns: ["bus arrives at noon"],
        establishedRef: "bible:1",
      },
    ],
    threads: [
      {
        id: "thread-driver",
        description: "Who was driving the bus?",
        category: "mystery",
        status: "resolved",
        scope: "central",
        introducedEpisode: 1,
        setupEpisodes: [1],
        payoffEpisodes: [5],
      },
    ],
    resolvedFindingSignatures: [],
  });
}

describe("identity resolution", () => {
  const entities = [
    defineEntity({ id: "character:mara", kind: "character", name: "Mara Voss", aliases: ["Mara"] }),
    defineEntity({ id: "character:miriam", kind: "character", name: "Miriam Vale" }),
    defineEntity({ id: "character:samuel", kind: "character", name: "Samuel" }),
    defineEntity({ id: "character:samantha", kind: "character", name: "Samantha" }),
    defineEntity({ id: "character:jon", kind: "character", name: "Jon Vale" }),
    defineEntity({ id: "character:driver", kind: "character", name: "The Driver" }),
  ];

  it("matches a registered alias and a unique honorific form", () => {
    expect(resolveIdentity("Mara", entities)).toMatchObject({ canonicalId: "character:mara", method: "alias", ambiguous: false });
    expect(resolveIdentity("Dr. Vale", [entities[1]!])).toMatchObject({
      canonicalId: "character:miriam",
      method: "constrained_name",
      ambiguous: false,
    });
  });

  it("does not merge similar names, and it flags an ambiguous surname", () => {
    expect(resolveIdentity("Samantha", entities).canonicalId).toBe("character:samantha");
    expect(resolveIdentity("Samuel", entities).canonicalId).toBe("character:samuel");
    expect(resolveIdentity("Samuela", entities)).toMatchObject({ canonicalId: null, method: "fuzzy_review", ambiguous: true });
    const ambiguous = resolveIdentity("Dr. Vale", entities);
    expect(ambiguous.canonicalId).toBeNull();
    expect(ambiguous.ambiguous).toBe(true);
    expect(ambiguous.candidateIds).toEqual(expect.arrayContaining(["character:miriam", "character:jon"]));
    expect(resolveIdentity("The Driver", entities).canonicalId).toBe("character:driver");
  });
});

describe("temporal introduction", () => {
  const lila = defineEntity({
    id: "character:lila",
    kind: "character",
    name: "Lila",
    firstIntroductionEpisode: 3,
    firstAppearanceEpisode: 3,
    lifecycle: "introduced",
  });
  const pier = defineEntity({
    id: "location:pier",
    kind: "location",
    name: "The pier",
    firstIntroductionEpisode: 3,
    firstAppearanceEpisode: 3,
  });

  it("accepts a first appearance and a new location, and rejects an early physical appearance", () => {
    expect(validateEntityUse(lila, 3, "physical")).toEqual([]);
    expect(validateEntityUse(pier, 3, "physical")).toEqual([]);
    expect(validateEntityUse(lila, 1, "physical").map((finding) => finding.severity)).toEqual(["ERROR"]);
    expect(validateEntityUse(lila, 2, "absent")).toEqual([]);
  });
});

describe("character knowledge", () => {
  const canon = lastBus();

  it("keeps Samuel's knowledge behind the episode in which he gains it", () => {
    expect(knowledgeAt(canon, "character:samuel", "fact-driver", 1).knows).toBe(false);
    expect(knowledgeAt(canon, "character:samuel", "fact-accident", 2).certainty).toBe("incomplete");
    expect(knowledgeAt(canon, "character:samuel", "fact-driver", 3).certainty).toBe("suspected");
    expect(knowledgeAt(canon, "character:samuel", "fact-driver", 4).certainty).toBe("certain");
    expect(validateDisclosures(canon, 2, "Samuel learns that an accident happened.").some((finding) => finding.severity === "ERROR")).toBe(false);
    expect(validateDisclosures(canon, 3, "Samuel says he might have been driving.").some((finding) => finding.severity === "ERROR")).toBe(false);
    expect(validateDisclosures(canon, 4, "Samuel says I was driving.")).toEqual([]);
    const early = validateDisclosures(canon, 1, "Samuel caused the crash and says I was driving.");
    expect(early.some((finding) => finding.severity === "ERROR" && finding.category === "knowledge")).toBe(true);
  });
});

describe("causal progression", () => {
  const canon = defineCanon({
    projectId: "causal",
    events: [
      { id: "e1", description: "The bus crashes.", episode: 1, consequences: ["e2"], acknowledgement: "required" },
      { id: "e2", description: "Samuel finds the route card.", episode: 2, causedBy: ["e1"], consequences: ["e3"], acknowledgement: "required" },
      { id: "e3", description: "Samuel follows the route card to the stop.", episode: 3, causedBy: ["e2"], consequences: ["e4"], acknowledgement: "optional" },
      { id: "e4", description: "Samuel remembers the road.", episode: 4, causedBy: ["e3"] },
      { id: "e5", description: "A later scene mentions the weather.", episode: 2, acknowledgement: "optional" },
    ],
  });

  it("accepts linked consequences and flags a contradiction and a missing prerequisite", () => {
    const linked = assessCausality(canon);
    expect(linked.some((item) => item.eventId === "e1" && item.classification === "valid_progression")).toBe(true);
    expect(linked.some((item) => item.eventId === "e5" && item.classification === "unacknowledged_consequence")).toBe(false);
    const contradicted = defineCanon({
      projectId: "causal",
      events: [
        { id: "e3", description: "The route card is destroyed.", episode: 3 },
        { id: "e4", description: "Samuel reads the intact route card.", episode: 4, contradictoryWith: ["e3"] },
      ],
    });
    expect(assessCausality(contradicted).some((item) => item.classification === "contradictory_consequence")).toBe(true);
    const missing = defineCanon({
      projectId: "causal",
      events: [{ id: "e9", description: "Samuel opens the barrier.", episode: 3, preconditions: ["e-missing"] }],
    });
    expect(assessCausality(missing).some((item) => item.classification === "missing_prerequisite")).toBe(true);
  });
});

describe("narrative threads", () => {
  it("accepts a payoff and a future hook, and rejects an open central conflict", () => {
    const resolved = defineCanon({
      projectId: "threads",
      threads: [
        {
          id: "thread-mystery",
          description: "Who rang the bell?",
          category: "mystery",
          status: "resolved",
          scope: "central",
          introducedEpisode: 1,
          setupEpisodes: [1],
          payoffEpisodes: [5],
        },
        {
          id: "thread-hook",
          description: "The second bus is still missing.",
          category: "future_season_hook",
          status: "deliberately_carried_forward",
          scope: "hook",
          introducedEpisode: 5,
          carryForward: true,
          intendedSeason: 2,
          explanation: "Season 2 investigates the second bus.",
        },
      ],
    });
    expect(validateThreads(resolved).filter((finding) => finding.severity === "ERROR")).toEqual([]);
    expect(resolved.threads[0]).toMatchObject({ setupEpisodes: [1], payoffEpisodes: [5] });
    expect(validateFinale(resolved, 5).some((finding) => finding.severity === "ERROR")).toBe(false);

    const abandoned = defineCanon({
      projectId: "threads",
      threads: [
        {
          id: "thread-central",
          description: "Can Samuel leave the loop?",
          category: "conflict",
          status: "active",
          scope: "central",
          introducedEpisode: 1,
        },
      ],
    });
    expect(validateFinale(abandoned, 5).some((finding) => finding.severity === "ERROR")).toBe(true);
  });
});

describe("world rules and protected revisions", () => {
  const canon = lastBus();

  it("preserves a rule, detects an exception, and records an authorized change", () => {
    expect(validateWorldRules(canon, 1, "The bus arrives at noon.").map((finding) => finding.severity)).toEqual(["ERROR"]);
    const allowed = defineCanon({
      ...canon,
      rules: [{ ...canon.rules[0]!, exceptions: [{ id: "ex-1", description: "A noon rehearsal is staged.", episode: 2, approved: true }] }],
    });
    expect(validateWorldRules(allowed, 2, "The bus arrives at noon.")).toEqual([]);

    const change = proposeChange({
      id: "change-rule",
      kind: "MODIFY",
      targetKind: "rule",
      targetId: "rule-bus",
      currentValue: canon.rules[0]!.description,
      proposedValue: "The bus appears at 11:47 PM except during the approved rehearsal.",
      reason: "The rehearsal is now canon.",
      dependencies: ["event-rehearsal"],
    });
    const denied = analyzeRevision(canon, [change], emptyAuthorization());
    expect(denied.decisions[0]?.accepted).toBe(false);
    const granted = analyzeRevision(canon, [change], { factIds: [], ruleIds: ["rule-bus"], entityIds: [] });
    expect(granted.decisions[0]?.accepted).toBe(true);
    expect(granted.decisions[0]?.downstreamIds).toContain("event-rehearsal");
    const next = applyAcceptedChanges(canon, granted.decisions);
    expect(canon.rules[0]?.description).toBe("The supernatural bus appears at 11:47 PM.");
    expect(next.rules[0]?.description).toContain("rehearsal");
  });

  it("rejects an unauthorized rewrite of the driver and the accident date", () => {
    const before = structuredClone(canon);
    const changes = [
      proposeChange({
        id: "change-driver",
        kind: "MODIFY",
        targetKind: "fact",
        targetId: "fact-driver",
        currentValue: "Samuel",
        proposedValue: "Nia",
        reason: "A more surprising ending.",
      }),
      proposeChange({
        id: "change-date",
        kind: "MODIFY",
        targetKind: "fact",
        targetId: "fact-date",
        currentValue: "10 March 2007",
        proposedValue: "11 March 2007",
      }),
    ];
    const decision = evaluateProposal({
      canon,
      episode: 1,
      provider: "groq",
      response: response(canon, {
        proposedContent: "Nia was the original driver. The accident was on 11 March 2007.",
        proposedChanges: changes,
      }),
    });
    expect(decision.decision).toBe("needs_authorization");
    expect(decision.nextCanon).toBeNull();
    expect(decision.retryable).toBe(false);
    expect(canon).toEqual(before);
  });

  it("applies a scene correction without rewriting protected identities or the date", () => {
    const change = proposeChange({
      id: "change-scene",
      kind: "MODIFY",
      targetKind: "scene",
      targetId: "scene-4",
      currentValue: "Samuel waits. Samuel waits.",
      proposedValue: "Samuel waits in the rain.",
      objective: "Remove the duplicated scene description.",
    });
    const decision = evaluateProposal({
      canon,
      episode: 4,
      response: response(canon, {
        proposedContent: "Samuel waits in the rain. Nia remains a passenger. The accident was on 10 March 2007.",
        proposedChanges: [change],
      }),
    });
    expect(decision.decision).toBe("approve");
    expect(decision.nextCanon?.facts.find((fact) => fact.id === "fact-driver")?.value).toBe("Samuel");
    expect(decision.nextCanon?.facts.find((fact) => fact.id === "fact-date")?.value).toBe("10 March 2007");
    expect(decision.impact.decisions.map((item) => item.change.targetId)).toEqual(["scene-4"]);
    expect(canon.entities.map((entity) => entity.name)).toEqual(["Samuel", "Nia", "The Driver"]);
  });
});

describe("last bus regression and provider independence", () => {
  const canon = lastBus();

  it("detects the contradictions that previously reappeared in later drafts", () => {
    const defects = [
      validateDisclosures(canon, 2, "Nia was the original driver."),
      validateDisclosures(canon, 2, "Samuel caused the crash."),
      validateDisclosures(canon, 3, "The accident was on 11 March 2007."),
      validateDisclosures(canon, 3, "A school bus pulls up."),
      validateDisclosures(canon, 2, "The driver explains everything."),
    ];
    expect(defects.every((findings) => findings.some((finding) => finding.severity === "ERROR"))).toBe(true);
    const unresolved = defineCanon({
      projectId: "last-bus",
      threads: [
        {
          id: "thread-ending",
          description: "The loop ends.",
          category: "mystery",
          status: "resolved",
          scope: "central",
          introducedEpisode: 1,
          setupEpisodes: [1],
          payoffEpisodes: [],
        },
      ],
    });
    expect(validateThreads(unresolved).some((finding) => finding.severity === "ERROR")).toBe(true);
    const signature = defects[1]?.[0]?.signature ?? "";
    const returned = upgradeRegressions([signature], [{ ...(defects[1]?.[0]!), severity: "WARNING" }]);
    expect(returned[0]?.severity).toBe("ERROR");
    expect(returned[0]?.category).toBe("regression");
  });

  it("applies the same decision for every provider and rejects a malformed payload", () => {
    const payload = response(canon, { proposedContent: "Nia was the original driver." });
    const groq = evaluateProposal({ canon, episode: 1, provider: "groq", response: payload });
    const openrouter = evaluateProposal({ canon, episode: 1, provider: "openrouter", response: payload });
    expect(groq.decision).toBe(openrouter.decision);
    expect(groq.decision).toBe("reject");
    expect(groq.findings.map((finding) => finding.signature)).toEqual(openrouter.findings.map((finding) => finding.signature));
    expect(failureIsRetryable("validation")).toBe(false);
    expect(failureIsRetryable("provider")).toBe(true);
    expect(parseRevisionResponse({ proposedContent: 12 }).ok).toBe(false);
  });
});

describe("revision cycle, context, and versions", () => {
  it("preserves the original text when a non-canon defect survives three rounds", async () => {
    const canon = lastBus();
    let calls = 0;
    const result = await runControlledRevision({
      canon,
      episode: 1,
      text: "The bus arrives at noon.",
      maxRounds: 3,
      request: {
        taskId: "revise-3",
        projectId: canon.projectId,
        narrativeVersion: canon.version,
        targetArtifact: "screenplay",
        targetId: "episode-1",
        episode: 1,
        objective: "Correct the bus time.",
        allowedChangeIds: [],
      },
      propose: () => {
        calls += 1;
        return response(canon, { proposedContent: "The bus arrives at noon." });
      },
    });
    expect(calls).toBe(3);
    expect(result.decision).not.toBe("approve");
    expect(result.text).toBe("The bus arrives at noon.");
    expect(result.canon.rules[0]?.description).toBe(canon.rules[0]?.description);
  });

  it("asks for authorization instead of rewriting the driver", async () => {
    const canon = lastBus();
    let calls = 0;
    const result = await runControlledRevision({
      canon,
      episode: 1,
      text: "Nia was the original driver.",
      request: {
        taskId: "revise-1",
        projectId: canon.projectId,
        narrativeVersion: canon.version,
        targetArtifact: "screenplay",
        targetId: "episode-1",
        episode: 1,
        objective: "Remove the duplicated action line.",
        allowedChangeIds: [],
      },
      propose: () => {
        calls += 1;
        return response(canon, {
          proposedContent: "Nia was the original driver.",
          proposedChanges: [
            proposeChange({
              id: "bad",
              kind: "MODIFY",
              targetKind: "fact",
              targetId: "fact-driver",
              proposedValue: "Nia",
            }),
          ],
        });
      },
    });
    expect(calls).toBe(1);
    expect(result.decision).toBe("needs_authorization");
    expect(result.canon.facts.find((fact) => fact.id === "fact-driver")?.value).toBe("Samuel");
    expect(result.text).toBe("Nia was the original driver.");
  });

  it("repairs only the targeted text and then stops", async () => {
    const canon = lastBus();
    let calls = 0;
    const result = await runControlledRevision({
      canon,
      episode: 4,
      text: "The bus arrives at noon.",
      maxRounds: 3,
      request: {
        taskId: "revise-2",
        projectId: canon.projectId,
        narrativeVersion: canon.version,
        targetArtifact: "screenplay",
        targetId: "episode-4",
        episode: 4,
        objective: "Correct the bus time.",
        allowedChangeIds: [],
      },
      propose: () => {
        calls += 1;
        return response(canon, { proposedContent: "Samuel waits. The accident was on 10 March 2007." });
      },
    });
    expect(calls).toBe(1);
    expect(result.decision).toBe("approve");
    expect(result.text).toContain("10 March 2007");
    expect(result.canon.facts.find((fact) => fact.id === "fact-driver")?.value).toBe("Samuel");
  });

  it("keeps concealed facts out of the creative fact list and rejects a stale version", () => {
    const canon = lastBus();
    const packet = assembleNarrativeContext({
      canon,
      request: {
        taskId: "write-1",
        projectId: canon.projectId,
        narrativeVersion: canon.version,
        targetArtifact: "screenplay",
        targetId: "episode-1",
        episode: 1,
        objective: "Write the bus-stop opening.",
        allowedChangeIds: [],
      },
    });
    expect(packet.mandatoryFacts.some((fact) => fact.id === "fact-driver")).toBe(false);
    expect(packet.prohibitedDisclosures.some((fact) => fact.factId === "fact-driver")).toBe(true);
    const rendered = renderNarrativeContext(canon, packet);
    expect(rendered.indexOf("Concealed until")).toBeGreaterThan(rendered.indexOf("Priority 6"));
    const store = new InMemoryCanonStore();
    store.commit(canon.projectId, 0, { ...canon, version: 0 }, "approve bible");
    expect(() => store.commit(canon.projectId, 0, canon, "overlap")).toThrow(VersionConflict);
    const stale = markStaleArtifacts({
      currentCanonVersion: 2,
      changedFactIds: ["fact-driver"],
      artifacts: [
        { id: "screenplay-1", kind: "screenplay", sourceCanonVersion: 1, dependsOnFactIds: ["fact-driver"] },
        { id: "audio-1", kind: "audio", sourceCanonVersion: 1, dependsOnFactIds: ["fact-music"] },
      ],
    });
    expect(stale.map((item) => item.id)).toEqual(["screenplay-1"]);
  });
});

describe("screenplay gate", () => {
  it("rejects a fluent episode that reveals Samuel's secret too early", () => {
    const canon = lastBus();
    const scene: ScreenplayScene = {
      sceneNumber: 1,
      heading: "EXT. BUS STOP - NIGHT",
      location: "Bus stop",
      timeOfDay: "Night",
      charactersPresent: ["Samuel"],
      visualDescription: "Rain on an empty road.",
      action: "Samuel stares at the headlights.",
      dialogue: [{ characterName: "Samuel", line: "I caused the crash. I was driving." }],
    };
    const result = validateEpisodeScreenplay({
      episodeNumber: 1,
      seriesTitle: "The Last Bus Home",
      story: {
        title: "The stop",
        synopsis: "Samuel waits at the stop and accidentally confesses the ending.",
        screenplay: [scene],
      },
      targetDurationSeconds: 60,
      bible: null,
      seasonPlan: null,
      episodePlan: null,
      ledger: null,
      previousEpisodes: [],
      canon,
    });
    expect(result.passed).toBe(false);
    expect(result.findings.some((finding) => finding.category === "knowledge" && finding.severity === "error")).toBe(true);
    expect(result.narrativeCanonVersion).toBe(canon.version);
    expect(result.narrativeValidationLayers).toContain("deterministic");
  });
});

describe("approved sources", () => {
  it("projects bible facts into canon without treating proposed details as protected", () => {
    const bible = {
      identity: {
        title: "The house",
        genres: ["drama"],
        subgenres: [],
        centralPremise: "A family fights over a house.",
        narrativeConcept: "A locked drawer holds the truth.",
        toneAndAtmosphere: "Cold.",
        targetAudience: "Adults",
        centralConflict: "Ada versus Elias.",
      },
      world: {
        description: "A coastal town.",
        geographyAndLocations: [
          { name: "The house", description: "A family house.", storyFunction: "The prize." },
          { name: "The town", description: "A quiet town.", storyFunction: "Pressure." },
        ],
        socialStructuresAndCultures: [],
        historyAndPastEvents: [],
        rules: ["The house is never sold."],
        definingSystems: [],
      },
      characters: {
        characters: ["Ada", "Elias"].map((name) => ({
          name,
          storyRole: "supporting" as const,
          roleDescription: "A member of the family.",
          physicalDescription: "",
          personality: "Guarded.",
          background: "Raised in the house.",
          motivations: ["Keep the family together."],
          fearsAndWeaknesses: ["Losing the house."],
          abilitiesAndLimitations: [],
          relationships: [],
          secrets: [],
          developmentPotential: "Learn to accept change.",
        })),
        relationshipDynamics: [],
      },
      narrative: {
        mainStoryline: "Ada returns.",
        majorConflicts: ["The deed."],
        longTermDirection: "A choice.",
        subplots: [],
        unresolvedMysteries: [],
        potentialFutureRevelations: [],
        majorNarrativeQuestions: [],
        serializedEndingGuidance: "Leave a question.",
      },
      guidelines: {
        mainThemes: ["Inheritance"],
        secondaryThemes: [],
        storytellingStyle: "Grounded.",
        boundaries: [],
        mustRemainConsistent: ["Ada is Elias's sister."],
      },
      canon: {
        confirmedFacts: ["Ada is Elias's sister."],
        proposedDetails: ["The attic has a second deed."],
        unresolvedQuestions: [],
        hiddenInformation: ["Elias signed the forged deed in 1998."],
        characterKnowledge: [],
        audienceKnowledge: [],
      },
    } satisfies StoryBibleContent;
    const canon = canonFromApprovedSources({ projectId: "house", bible, bibleVersion: 2, planVersion: 1 });
    expect(canon.facts.some((fact) => fact.statement === "Ada is Elias's sister." && fact.protected)).toBe(true);
    expect(canon.facts.some((fact) => fact.classification === "PROVISIONAL" && fact.protected === false)).toBe(true);
    expect(canon.facts.some((fact) => fact.classification === "HIDDEN_TRUTH")).toBe(true);
    expect(canon.rules[0]?.description).toBe("The house is never sold.");
    expect(canon.version).toBe(0);
  });
});

describe("implied knowledge, objects, critic adjudication, and stored canon", () => {
  it("infers concealed knowledge from what a line presupposes", () => {
    const canon = lastBus();
    const errors = (episode: number, text: string) =>
      validateKnowledge(canon, episode, text).filter((finding) => finding.severity === "ERROR");
    expect(errors(1, "Samuel: The night he caused the accident still wakes me.").length).toBeGreaterThan(0);
    expect(errors(1, "Samuel: Maybe I was driving.").length).toBeGreaterThan(0);
    expect(errors(3, "Samuel: I might have been driving.")).toEqual([]);
    expect(errors(4, "Samuel: I was driving.")).toEqual([]);
    expect(errors(1, "Samuel: I did not cause the accident.")).toEqual([]);
    expect(validateDisclosures(canon, 4, "Samuel says I was driving.")).toEqual([]);
  });

  it("infers a definite unknown prop only after the canon already tracks objects", () => {
    const ticket = defineEntity({
      id: "object:ticket",
      kind: "object",
      name: "ticket",
      ownerId: "character:samuel",
      properties: [],
    });
    const samuel = defineEntity({ id: "character:samuel", kind: "character", name: "Samuel" });
    const nia = defineEntity({ id: "character:nia", kind: "character", name: "Nia" });
    const canon = defineCanon({ projectId: "props", entities: [samuel, nia, ticket] });
    const findings = (text: string) => validateObjects(canon, 2, text);
    expect(findings("Nia holds the locket.").some((finding) => finding.severity === "ERROR" && finding.actual === "locket")).toBe(true);
    expect(findings("Nia finds a locket.").every((finding) => finding.severity === "INFO")).toBe(true);
    expect(findings("Nia's ticket is in her coat.").some((finding) => finding.severity === "ERROR")).toBe(true);
    expect(findings("The ticket unlocks the study.").some((finding) => finding.severity === "ERROR" && finding.actual === "unlocks")).toBe(true);
    const empty = defineCanon({ projectId: "props", entities: [samuel] });
    expect(validateObjects(empty, 1, "Ada finds the deed.").every((finding) => finding.severity === "INFO")).toBe(true);
  });

  it("promotes a critic claim only when the scene text confirms it", () => {
    const canon = lastBus();
    const confirmed = adjudicateCriticFindings({
      canon,
      episode: 1,
      scenes: [{ sceneNumber: 1, text: "Samuel: I was driving." }],
      findings: [{ category: "knowledge", severity: "error", sceneNumber: 1, message: "Samuel reveals the driver." }],
    });
    expect(confirmed[0]?.severity).toBe("error");
    const advisory = adjudicateCriticFindings({
      canon,
      episode: 1,
      scenes: [{ sceneNumber: 4, text: "Night falls over the empty road." }],
      findings: [{ category: "timeline", severity: "error", sceneNumber: 4, message: "Night falls twice in one evening." }],
    });
    expect(advisory[0]?.severity).toBe("error");
    expect(advisory[0]?.message.startsWith("[continuity critic]")).toBe(true);
    expect(advisory[0]?.message).toContain("did not confirm this as a canon change");
  });

  it("keeps stored facts and commits only missing derived facts", async () => {
    const stored = lastBus();
    const derived = defineCanon({
      projectId: stored.projectId,
      version: 0,
      basedOnBibleVersion: 4,
      facts: [
        { ...stored.facts[0]!, value: "someone else", statement: stored.facts[0]!.statement },
        {
          id: "fact-new",
          key: "bus.route",
          statement: "The bus only stops at the old terminus.",
          classification: "ESTABLISHED_CANON",
          protected: true,
        },
      ],
    });
    const merged = mergeDerivedCanon(stored, derived);
    expect(merged.changed).toBe(true);
    expect(merged.state.facts.find((fact) => fact.id === "fact-driver")?.value).toBe("Samuel");
    expect(merged.state.facts.some((fact) => fact.id === "fact-new")).toBe(true);
    expect(merged.state.basedOnBibleVersion).toBe(4);

    let current: CanonState | null = null;
    let conflicts = 0;
    const port = {
      async latest() {
        return current;
      },
      async commit(input: { expectedVersion: number; state: CanonState }) {
        if (conflicts > 0) {
          current = { ...stored, version: 9 };
          throw new Error("conflict");
        }
        current = { ...input.state, version: input.expectedVersion + 1 };
        return current;
      },
    };
    const established = await resolveWorkingCanon({
      clerkUserId: "user",
      projectId: stored.projectId,
      derived: stored,
      port,
    });
    expect(established.version).toBe(1);
    conflicts = 1;
    const reloaded = await resolveWorkingCanon({
      clerkUserId: "user",
      projectId: stored.projectId,
      derived,
      port,
    });
    expect(reloaded.version).toBe(9);
    expect(provenanceIsStale(1, 9)).toBe(true);
    expect(provenanceIsStale(null, 9)).toBe(false);
    expect(provenanceIsStale(9, 9)).toBe(false);
  });
});
