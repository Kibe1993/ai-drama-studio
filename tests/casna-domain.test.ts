import { describe, expect, it } from "vitest";
import {
  episodeGenerationGate,
  episodeNeedsPlanReview,
  nextEpisodeNumber,
  planGate,
  type PlanGateView,
} from "@/lib/domain/casna";
import { deriveEpisodePlan, validateEpisodePlan } from "@/lib/domain/episodePlan";
import { applyCanonToLedger } from "@/lib/domain/ledger";
import { extractEpisodeCanon } from "@/lib/domain/episodeCanon";
import { validateEpisodeScreenplay } from "@/lib/domain/screenplayValidation";
import { deriveWorkflowStage } from "@/lib/domain/workflow";
import { validateSeasonPlan } from "@/lib/domain/seasonPlanValidation";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import type { EpisodePlanItem, SeasonPlan } from "@/lib/validation/seasonPlan";
import type { ScreenplayScene } from "@/lib/validation/story";
import type { StoryBibleContent } from "@/lib/validation/storyBible";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function episodeItem(
  episodeNumber: number,
  overrides: Partial<EpisodePlanItem> = {}
): EpisodePlanItem {
  return {
    episodeNumber,
    workingTitle: `Episode ${episodeNumber}`,
    narrativePurpose: `Purpose of episode ${episodeNumber}.`,
    startingSituation: `The situation at the start of episode ${episodeNumber}.`,
    mainObjective: `Achieve the objective of episode ${episodeNumber}.`,
    centralConflict: `The conflict of episode ${episodeNumber}.`,
    majorStoryBeats: [`Beat one of episode ${episodeNumber}.`],
    informationRevealed: [`A fact revealed in episode ${episodeNumber}.`],
    characterDevelopment: `Ada changes in episode ${episodeNumber}.`,
    importantEvents: [`An important event in episode ${episodeNumber}.`],
    consequences: [`A consequence of episode ${episodeNumber}.`],
    storyContribution: `Episode ${episodeNumber} advances the season.`,
    endingOrCliffhanger: `Episode ${episodeNumber} ends on a turn.`,
    unresolvedThreads: [`A thread opened in episode ${episodeNumber}.`],
    continuityRequirements: `The next episode must respect episode ${episodeNumber}.`,
    characterArcChanges: [],
    relationshipChanges: [],
    objectChanges: [],
    locationChanges: [],
    ...overrides,
  };
}

function seasonPlan(overrides: Partial<SeasonPlan> = {}): SeasonPlan {
  return {
    seasonObjective: "Ada reclaims the family house without destroying her brother.",
    centralConflictOrMystery: "Who hid the deed, and what will Ada give up to learn it?",
    mainCharacterObjectives: "Ada wants the truth; Elias wants to keep the peace.",
    overallCharacterDevelopment: "Ada learns that winning the house can lose her family.",
    majorStoryDevelopments: ["The deed surfaces.", "Elias admits his part."],
    beginningDirection: "Ada returns and finds the house changed.",
    middleDirection: "Allies split as the search for the deed escalates.",
    endingDirection: "Ada chooses between the house and her brother.",
    episodeProgression: [episodeItem(1), episodeItem(2), episodeItem(3), episodeItem(4)],
    importantRevelations: ["Elias signed the deed."],
    relationshipChanges: ["Ada and Elias move from allies to rivals."],
    consequencesCarriedBetween: ["Elias is exposed."],
    setupAndPayoff: ["The locked drawer in episode 1 pays off in episode 4."],
    unresolvedQuestions: ["Where is the second copy?"],
    intendedSeasonConclusion: "Ada keeps the house and offers Elias a place in it.",
    ...overrides,
  };
}

function bible(names: string[]): StoryBibleContent {
  return {
    characters: {
      characters: names.map((name) => ({ name })),
      relationshipDynamics: [],
    },
  } as unknown as StoryBibleContent;
}

function screenplay(count: number, overrides: Partial<ScreenplayScene> = {}): ScreenplayScene[] {
  return Array.from({ length: count }, (_, index) => ({
    sceneNumber: index + 1,
    heading: `INT. HOUSE ${index + 1} - NIGHT`,
    location: "House",
    timeOfDay: "Night",
    charactersPresent: ["Ada"],
    visualDescription: `The camera holds the house, room ${index + 1}.`,
    action: `Ada searches the study for a hidden deed, room ${index + 1}.`,
    dialogue: [{ characterName: "Ada", line: `Something new happens in room ${index + 1}.` }],
    ...overrides,
  }));
}

function emptyLedger(overrides: Partial<ContinuityLedger> = {}): ContinuityLedger {
  return {
    events: [],
    characterStates: [],
    locationStates: [],
    objectStates: [],
    revealedSecrets: [],
    unresolvedThreads: [],
    consequences: [],
    timelineNotes: "",
    ...overrides,
  };
}

function approvedPlan(overrides: Partial<PlanGateView> = {}): PlanGateView {
  return {
    version: 1,
    status: "approved",
    basedOnBibleVersion: 1,
    episodeProgression: [
      { episodeNumber: 1 },
      { episodeNumber: 2 },
      { episodeNumber: 3 },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stage gates
// ---------------------------------------------------------------------------

describe("CASNA plan gate", () => {
  it("requires an approved Story Bible", () => {
    expect(
      planGate({ approvedPlan: null, latestPlan: null, bibleApprovedVersion: 0 })
    ).toMatchObject({ allowed: false, code: "bible_required" });
  });

  it("requires an approved Season Plan for a serialized drama", () => {
    expect(
      planGate({ approvedPlan: null, latestPlan: null, bibleApprovedVersion: 2 })
    ).toMatchObject({ allowed: false, code: "season_plan_required" });
  });

  it("rejects a plan that was developed from an older Story Bible version", () => {
    expect(
      planGate({
        approvedPlan: approvedPlan({ basedOnBibleVersion: 1 }),
        latestPlan: approvedPlan({ basedOnBibleVersion: 1 }),
        bibleApprovedVersion: 2,
      })
    ).toMatchObject({ allowed: false, code: "plan_stale" });
  });

  it("blocks while a newer plan revision waits for approval", () => {
    expect(
      planGate({
        approvedPlan: approvedPlan({ version: 1 }),
        latestPlan: approvedPlan({ version: 2, status: "awaiting_approval" }),
        bibleApprovedVersion: 1,
      })
    ).toMatchObject({ allowed: false, code: "plan_revision_pending" });
  });

  it("allows a current approved plan", () => {
    expect(
      planGate({ approvedPlan: approvedPlan(), latestPlan: approvedPlan(), bibleApprovedVersion: 1 })
    ).toEqual({ allowed: true, code: "ok", reason: null });
  });
});

describe("CASNA sequential episode gate", () => {
  const base = {
    productionMode: "serialized",
    bibleApprovedVersion: 1,
    approvedPlan: approvedPlan(),
    latestPlan: approvedPlan(),
    ledger: { asOfEpisode: 1, basedOnPlanVersion: 1 },
    episodes: [
      { episodeNumber: 1, status: "story_approved" },
      { episodeNumber: 2, status: "draft" },
    ],
  };

  it("allows the next episode when the previous one is approved and the ledger caught up", () => {
    expect(episodeGenerationGate({ ...base, targetEpisodeNumber: 2 })).toEqual({
      allowed: true,
      code: "ok",
      reason: null,
    });
  });

  it("locks an episode until the earlier episode is approved", () => {
    expect(
      episodeGenerationGate({
        ...base,
        episodes: [
          { episodeNumber: 1, status: "draft" },
          { episodeNumber: 2, status: "draft" },
        ],
        targetEpisodeNumber: 2,
      })
    ).toMatchObject({ allowed: false, code: "episode_locked" });
  });

  it("locks an episode until the Continuity Ledger has caught up", () => {
    expect(
      episodeGenerationGate({ ...base, ledger: { asOfEpisode: 0, basedOnPlanVersion: 1 }, targetEpisodeNumber: 2 })
    ).toMatchObject({ allowed: false, code: "episode_locked" });
  });

  it("rejects an episode the approved plan does not cover", () => {
    expect(
      episodeGenerationGate({
        ...base,
        approvedPlan: approvedPlan({
          episodeProgression: [{ episodeNumber: 1 }, { episodeNumber: 2 }],
        }),
        latestPlan: approvedPlan({ episodeProgression: [{ episodeNumber: 1 }, { episodeNumber: 2 }] }),
        targetEpisodeNumber: 3,
      })
    ).toMatchObject({ allowed: false, code: "plan_episode_missing" });
  });

  it("does not require a season plan for a standalone drama", () => {
    expect(
      episodeGenerationGate({
        productionMode: "standalone",
        bibleApprovedVersion: 1,
        approvedPlan: null,
        ledger: null,
        episodes: [],
        targetEpisodeNumber: 1,
      })
    ).toEqual({ allowed: true, code: "ok", reason: null });
  });

  it("flags an episode planned from an older plan version", () => {
    expect(episodeNeedsPlanReview({ approvedPlanVersion: 2, episodeBasePlanVersion: 1 })).toBe(true);
    expect(episodeNeedsPlanReview({ approvedPlanVersion: 2, episodeBasePlanVersion: 2 })).toBe(false);
  });

  it("numbers the next episode from the highest existing episode", () => {
    expect(nextEpisodeNumber([{ episodeNumber: 1 }, { episodeNumber: 5 }])).toBe(6);
    expect(nextEpisodeNumber([])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Stage F: episode-specific plan
// ---------------------------------------------------------------------------

describe("episode-specific plan", () => {
  it("inherits the previous episode ending, consequences, and open threads", () => {
    const plan = seasonPlan();
    const ledger = emptyLedger({
      consequences: ["Elias is exposed."],
      unresolvedThreads: [
        { thread: "Where is the second copy of the deed?", introducedInEpisode: 1, status: "open" },
      ],
    });
    const episodePlan = deriveEpisodePlan({
      plan: { ...plan, version: 1 },
      ledger,
      previousEpisode: { episodeNumber: 1, title: "Return", synopsis: "Ada finds the house sold. Elias lies to her." },
      episodeNumber: 2,
    });
    expect(episodePlan).not.toBeNull();
    expect(episodePlan!.inheritsFrom.join(" ")).toContain("Elias lies to her");
    expect(episodePlan!.inheritsFrom.join(" ")).toContain("Elias is exposed.");
    expect(episodePlan!.inheritsFrom.join(" ")).toContain("second copy");
    expect(episodePlan!.sourcePlanVersion).toBe(1);
    expect(validateEpisodePlan({ episodePlan: episodePlan!, plan: { ...plan, version: 1 }, previousEpisode: { episodeNumber: 1 } }))
      .toMatchObject({ passed: true });
  });

  it("returns null when the plan does not cover the episode", () => {
    expect(
      deriveEpisodePlan({
        plan: { ...seasonPlan(), version: 1 },
        ledger: null,
        previousEpisode: null,
        episodeNumber: 9,
      })
    ).toBeNull();
  });

  it("rejects an episode plan that drifts from the approved purpose", () => {
    const plan = seasonPlan();
    const episodePlan = deriveEpisodePlan({
      plan: { ...plan, version: 1 },
      ledger: null,
      previousEpisode: null,
      episodeNumber: 1,
    })!;
    const result = validateEpisodePlan({
      episodePlan: { ...episodePlan, narrativePurpose: "A completely unrelated episode." },
      plan: { ...plan, version: 1 },
      previousEpisode: null,
    });
    expect(result.passed).toBe(false);
    expect(result.findings.some((finding) => finding.message.includes("narrative purpose"))).toBe(true);
  });

  it("requires the previous episode for a later episode", () => {
    const plan = seasonPlan();
    const episodePlan = deriveEpisodePlan({
      plan: { ...plan, version: 1 },
      ledger: null,
      previousEpisode: null,
      episodeNumber: 2,
    })!;
    const result = validateEpisodePlan({
      episodePlan,
      plan: { ...plan, version: 1 },
      previousEpisode: null,
    });
    expect(result.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stage C: season plan validation
// ---------------------------------------------------------------------------

describe("season plan validation", () => {
  it("passes a coherent plan", () => {
    const result = validateSeasonPlan(seasonPlan(), null);
    expect(result.findings.filter((finding) => finding.severity === "error")).toHaveLength(0);
    expect(result.passed).toBe(true);
  });

  it("rejects out-of-sequence episodes", () => {
    const result = validateSeasonPlan(
      seasonPlan({ episodeProgression: [episodeItem(1), episodeItem(3)] }),
      null
    );
    expect(result.passed).toBe(false);
    expect(result.findings.some((finding) => finding.message.includes("out of sequence"))).toBe(true);
  });

  it("rejects a repeated episode objective", () => {
    const result = validateSeasonPlan(
      seasonPlan({
        episodeProgression: [
          episodeItem(1),
          episodeItem(2, { mainObjective: "Achieve the objective of episode 1." }),
        ],
      }),
      null
    );
    expect(result.passed).toBe(false);
    expect(result.findings.some((finding) => finding.category === "progression")).toBe(true);
  });

  it("flags repeated conflicts as a repetition warning", () => {
    const conflict = "Ada confronts Elias about the missing deed in the locked study.";
    const result = validateSeasonPlan(
      seasonPlan({
        episodeProgression: [
          episodeItem(1, { centralConflict: conflict }),
          episodeItem(2, { centralConflict: conflict }),
        ],
      }),
      null
    );
    expect(result.findings.some((finding) => finding.category === "repetition")).toBe(true);
  });

  it("rejects a plan with no intended conclusion", () => {
    const result = validateSeasonPlan(
      seasonPlan({ intendedSeasonConclusion: "x" }),
      null
    );
    expect(result.passed).toBe(false);
    expect(result.findings.some((finding) => finding.category === "narrative_structure")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage H: screenplay validation
// ---------------------------------------------------------------------------

describe("screenplay validation", () => {
  const base = {
    episodeNumber: 2,
    seriesTitle: "The house",
    targetDurationSeconds: 300,
    bible: bible(["Ada", "Elias"]),
    seasonPlan: seasonPlan(),
    episodePlan: deriveEpisodePlan({
      plan: { ...seasonPlan(), version: 1 },
      ledger: null,
      previousEpisode: { episodeNumber: 1, title: "Return", synopsis: "Ada returns and finds the house sold." },
      episodeNumber: 2,
    }),
    ledger: emptyLedger(),
    previousEpisodes: [
      {
        episodeNumber: 1,
        title: "Return",
        synopsis: "Ada returns and finds the house sold.",
        screenplay: [
          {
            sceneNumber: 1,
            heading: "EXT. HOUSE - NIGHT",
            location: "House",
            timeOfDay: "Night",
            charactersPresent: ["Ada", "Elias"],
            visualDescription: "Rain on the roof.",
            action: "Ada asks about the sale. Elias refuses to answer.",
            dialogue: [{ characterName: "Elias", line: "You should not have come." }],
          },
        ],
      },
    ],
  };

  it("rejects an incomplete screenplay for the requested duration", () => {
    const result = validateEpisodeScreenplay({
      ...base,
      story: { title: "Consequences", synopsis: "Ada presses Elias for the truth about the deed and the sale.", screenplay: screenplay(1) },
    });
    expect(result.passed).toBe(false);
    expect(result.findings.some((finding) => finding.category === "completeness")).toBe(true);
  });

  it("rejects a speaking character who is not in established canon", () => {
    const scenes = screenplay(5);
    scenes[2]!.dialogue = [{ characterName: "The Stranger", line: "I know where the deed is." }];
    const result = validateEpisodeScreenplay({
      ...base,
      story: { title: "Consequences", synopsis: "Ada presses Elias for the truth about the deed and the sale.", screenplay: scenes },
    });
    expect(result.passed).toBe(false);
    expect(result.findings.some((finding) => finding.category === "canon" && finding.message.includes("The Stranger"))).toBe(true);
  });

  it("rejects a character the ledger records as dead", () => {
    const result = validateEpisodeScreenplay({
      ...base,
      ledger: emptyLedger({
        characterStates: [
          {
            name: "Elias",
            currentLocation: "House",
            currentObjective: "Keep the secret.",
            knowledge: [],
            beliefs: [],
            motivations: [],
            emotionalState: "Guilty",
            physicalState: "Deceased after the fire.",
            relationships: [],
          },
        ],
      }),
      story: { title: "Consequences", synopsis: "Ada presses Elias for the truth about the deed and the sale.", screenplay: screenplay(5, { charactersPresent: ["Ada", "Elias"] }) },
    });
    expect(result.passed).toBe(false);
    expect(result.findings.some((finding) => finding.message.includes("records them as dead"))).toBe(true);
  });

  it("flags a scene that repeats a previous episode development", () => {
    const scenes = screenplay(5);
    scenes[0] = {
      ...scenes[0]!,
      action: "Ada asks about the sale. Elias refuses to answer.",
      heading: "EXT. HOUSE - NIGHT",
      location: "House",
      visualDescription: "Rain on the roof.",
      dialogue: [{ characterName: "Elias", line: "You should not have come." }],
    };
    const result = validateEpisodeScreenplay({
      ...base,
      story: { title: "Consequences", synopsis: "Ada presses Elias for the truth about the deed and the sale.", screenplay: scenes },
    });
    expect(result.findings.some((finding) => finding.category === "repetition")).toBe(true);
  });

  it("passes a screenplay that respects canon and duration", () => {
    const result = validateEpisodeScreenplay({
      ...base,
      story: { title: "Consequences", synopsis: "Ada presses Elias for the truth about the deed and the sale.", screenplay: screenplay(5) },
    });
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage I: canon extraction and ledger merge
// ---------------------------------------------------------------------------

describe("canon extraction and ledger merge", () => {
  const plan = { ...seasonPlan(), version: 1 };
  const episodePlan = deriveEpisodePlan({
    plan,
    ledger: null,
    previousEpisode: { episodeNumber: 1, title: "Return", synopsis: "Ada returns." },
    episodeNumber: 2,
  });

  it("extracts events, states, and threads from the approved plan and screenplay", () => {
    const summary = extractEpisodeCanon({
      episodeNumber: 2,
      story: {
        title: "The deed",
        synopsis: "Ada finds the deed and confronts Elias.",
        screenplay: screenplay(3),
      },
      plan,
      episodePlan,
      ledger: null,
    });
    expect(summary.episodeNumber).toBe(2);
    expect(summary.events.length).toBeGreaterThan(0);
    expect(summary.characterStates.some((state) => state.name === "Ada")).toBe(true);
    expect(summary.locationStates.length).toBeGreaterThan(0);
    expect(summary.unresolvedThreads.length).toBeGreaterThan(0);
    expect(summary.consequences.length).toBeGreaterThan(0);
  });

  it("merges approved canon without dropping earlier facts", () => {
    const existing = emptyLedger({
      events: [
        { episodeNumber: 1, event: "Ada returned.", consequence: "Elias lied.", affectedCharacters: ["Ada"], revealedInformation: [] },
      ],
      consequences: ["Elias lied."],
      unresolvedThreads: [
        { thread: "Where is the deed?", introducedInEpisode: 1, status: "open" },
      ],
    });
    const summary = extractEpisodeCanon({
      episodeNumber: 2,
      story: { title: "The deed", synopsis: "Ada finds the deed.", screenplay: screenplay(3) },
      plan,
      episodePlan,
      ledger: existing,
    });
    const merged = applyCanonToLedger(existing, summary);
    expect(merged.events[0]!.episodeNumber).toBe(1);
    expect(merged.events.some((event) => event.episodeNumber === 2)).toBe(true);
    expect(merged.consequences).toContain("Elias lied.");
    expect(merged.unresolvedThreads.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Workflow invalidation
// ---------------------------------------------------------------------------

describe("workflow invalidation", () => {
  it("returns to the plan stage when an approved plan is stale", () => {
    expect(
      deriveWorkflowStage({
        projectStatus: "draft",
        storyDraftStatus: "approved",
        runStoryApproved: false,
        bibleApproved: true,
        planApproved: true,
        planDraftReady: false,
        planNeedsReview: true,
        productionActive: false,
      })
    ).toBe("plan");
  });

  it("returns to the plan stage while a plan revision is awaiting approval", () => {
    expect(
      deriveWorkflowStage({
        projectStatus: "draft",
        storyDraftStatus: "approved",
        runStoryApproved: false,
        bibleApproved: true,
        planApproved: true,
        planDraftReady: true,
        planNeedsReview: false,
        productionActive: false,
      })
    ).toBe("plan");
  });
});
