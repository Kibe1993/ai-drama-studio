import { describe, expect, it } from "vitest";
import { createPipelineService } from "@/lib/services/pipelineService";
import { extractEpisodeCanon } from "@/lib/domain/episodeCanon";
import { applyCanonToLedger } from "@/lib/domain/ledger";
import { validateSeasonPlan } from "@/lib/domain/seasonPlanValidation";
import {
  mergeSceneRepair,
  repairSceneInstructions,
  repairSceneNumbers,
} from "@/lib/providers/llm/repairScenes";
import { StoryProviderManager, type ProviderSlot } from "@/lib/providers/llm/manager";
import type { SeasonPlanPrompt } from "@/lib/providers/llm/stageTasks";
import type { PipelineDeps } from "@/lib/pipeline/ports";
import type { RequestAuth } from "@/lib/auth/session";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { RunRecord } from "@/lib/pipeline/types";
import type { StoryRecord, ScreenplayScene } from "@/lib/validation/story";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { EpisodePlan } from "@/lib/validation/casna";
import type { EpisodePlanItem, SeasonPlan } from "@/lib/validation/seasonPlan";
import type { EpisodeValidation } from "@/lib/validation/casna";

const owner: RequestAuth = {
  userId: "user_owner",
  isAdmin: false,
  email: "owner@example.com",
  name: "Owner",
  imageUrl: "",
};
const projectId = "a".repeat(24);
const storyId = "b".repeat(24);
const runId = "c".repeat(24);
const episodeId = "d".repeat(24);
const now = new Date().toISOString();

function project(): ProjectRecord {
  return {
    id: projectId,
    title: "The house",
    originalStoryIdea: "A family fights over a house.",
    genre: "family",
    language: "en",
    visualStyle: "realistic",
    tone: "cold",
    targetDurationSeconds: 300,
    aspectRatio: "16:9",
    status: "planning",
    workflowMode: "guided",
    productionType: "fictional_drama",
    productionMode: "serialized",
    createdAt: now,
    updatedAt: now,
  };
}

function run(): RunRecord {
  return {
    id: runId,
    clerkUserId: owner.userId,
    projectId,
    episode: {
      id: episodeId,
      number: 2,
      title: "The deed",
      premise: "Ada finds the deed.",
      targetDurationSeconds: 300,
      baseSnapshotVersion: 1,
    },
    workflowMode: "guided",
    currentStage: "story",
    status: "waiting_for_approval",
    stageResults: {
      story: { title: "The deed", synopsis: "Ada finds the deed.", approved: false, storyId },
    },
    retryCheckpoint: null,
    startedAt: now,
    completedAt: null,
  };
}

function screenplay(count = 6): ScreenplayScene[] {
  return Array.from({ length: count }, (_, index) => ({
    sceneNumber: index + 1,
    heading: `INT. HOUSE ${index + 1} - NIGHT`,
    location: "House",
    timeOfDay: "Night",
    charactersPresent: ["Ada", "Elias"],
    visualDescription: `The camera holds the house, room ${index + 1}.`,
    action: `Ada searches the study for a hidden deed, room ${index + 1}.`,
    dialogue: [{ characterName: "Ada", line: `Something new happens in room ${index + 1}.` }],
  }));
}

function story(overrides: Partial<StoryRecord> = {}): StoryRecord {
  return {
    id: storyId,
    clerkUserId: owner.userId,
    projectId,
    productionRunId: runId,
    episodeId,
    title: "The deed",
    synopsis: "Ada finds the deed and confronts Elias about the sale.",
    structure: {
      act1: {
        introduction: "Ada returns.",
        mainCharacters: "Ada and Elias.",
        setting: "The house.",
        initialSituation: "The house was sold.",
        incitingIncident: "Ada finds a deed.",
      },
      act2: {
        risingTension: "Elias avoids her.",
        obstacles: "The lawyer is missing.",
        characterDecisions: "Ada searches.",
        turningPoint: "She finds the signature.",
      },
      act3: {
        climax: "Ada confronts Elias.",
        resolution: "Elias admits it.",
        finalOutcome: "They talk.",
      },
    },
    screenplay: screenplay(),
    status: "awaiting_approval",
    version: 1,
    provider: "fake",
    model: "fake-model",
    fallbackFrom: null,
    validationFindings: { passed: true, findings: [], validatedAt: now },
    updatedAt: now,
    createdAt: now,
    ...overrides,
  };
}

function bible(): StoryBibleContent {
  return {
    identity: { title: "The house" },
    characters: {
      characters: [
        { name: "Ada", physicalDescription: "", storyRole: "protagonist" },
        { name: "Elias", physicalDescription: "", storyRole: "supporting" },
      ],
      relationshipDynamics: [],
    },
  } as unknown as StoryBibleContent;
}

function planItem(overrides: Partial<EpisodePlanItem> = {}): EpisodePlanItem {
  return {
    episodeNumber: 2,
    workingTitle: "The deed",
    narrativePurpose: "Ada confronts the sale.",
    startingSituation: "Ada has returned.",
    mainObjective: "Find the deed. Ada searches the study.",
    centralConflict: "Elias hides the truth.",
    majorStoryBeats: ["Ada finds the deed."],
    informationRevealed: ["Elias signed the deed."],
    characterDevelopment: "Ada stops trusting Elias.",
    importantEvents: ["Ada finds the deed."],
    consequences: ["Elias is exposed."],
    storyContribution: "The season turns.",
    endingOrCliffhanger: "Elias admits he signed the deed.",
    unresolvedThreads: ["Where is the second copy?"],
    continuityRequirements: "Elias is exposed.",
    characterArcChanges: [{ name: "Ada", change: "Ada stops trusting Elias." }],
    relationshipChanges: [{ from: "Ada", to: "Elias", change: "Trust collapses." }],
    objectChanges: [{ name: "Deed", ownership: "Ada", condition: "Torn" }],
    locationChanges: [{ name: "Study", change: "Ransacked" }],
    ...overrides,
  };
}

function plan(): SeasonPlan & { version: number } {
  return {
    seasonObjective: "Ada reclaims the house.",
    centralConflictOrMystery: "Who hid the deed?",
    mainCharacterObjectives: "Ada wants the truth.",
    overallCharacterDevelopment: "Ada learns to forgive.",
    majorStoryDevelopments: ["The deed surfaces."],
    beginningDirection: "Ada returns.",
    middleDirection: "The search.",
    endingDirection: "The choice.",
    episodeProgression: [planItem({ episodeNumber: 1 }), planItem()],
    importantRevelations: ["Elias signed."],
    relationshipChanges: ["Siblings become rivals."],
    consequencesCarriedBetween: ["Elias is exposed."],
    setupAndPayoff: ["The drawer pays off."],
    unresolvedQuestions: ["Second copy?"],
    intendedSeasonConclusion: "Ada keeps the house.",
    version: 1,
  };
}

function episodePlan(): EpisodePlan {
  const item = planItem();
  return {
    episodeNumber: 2,
    workingTitle: item.workingTitle,
    narrativePurpose: item.narrativePurpose,
    sourcePlanVersion: 1,
    inheritsFrom: ["Ada returned."],
    intendsToAchieve: item.mainObjective,
    newDevelopments: item.majorStoryBeats,
    characterChanges: [item.characterDevelopment],
    informationRevealed: item.informationRevealed,
    consequencesCreated: item.consequences,
    seasonAdvance: item.storyContribution,
    carryForward: item.continuityRequirements,
    continuityRequirements: item.continuityRequirements,
    unresolvedThreads: item.unresolvedThreads,
  };
}

// ---------------------------------------------------------------------------
// Manual screenplay editing
// ---------------------------------------------------------------------------

function editingHarness(initial: StoryRecord = story()) {
  const updates: { screenplay: ScreenplayScene[]; validationFindings: EpisodeValidation | null }[] = [];
  const deps = {
    projects: { async findOwned() { return project(); }, async update() { return project(); } },
    runs: {
      async findLatest() { return run(); },
      async findOwned() { return run(); },
      async insert() { return run(); },
      async save(value: RunRecord) { return value; },
    },
    jobs: {
      async findOwned() { return null; },
      async findById() { return null; },
      async listForRun() { return []; },
      async listOpen() { return []; },
      async listByKeyPrefix() { return []; },
      async insert() { throw new Error("unused"); },
      async save(job: unknown) { return job; },
    },
    stories: {
      async findOwned(_userId: string, id: string) { return id === initial.id ? initial : null; },
      async findForRun() { return initial; },
      async markApproved() { return initial; },
      async updateScreenplay(
        _userId: string,
        _id: string,
        input: {
          title?: string;
          synopsis?: string;
          screenplay: ScreenplayScene[];
          validationFindings: EpisodeValidation | null;
        }
      ) {
        updates.push({ screenplay: input.screenplay, validationFindings: input.validationFindings });
        return {
          ...initial,
          title: input.title ?? initial.title,
          synopsis: input.synopsis ?? initial.synopsis,
          screenplay: input.screenplay,
          validationFindings: input.validationFindings,
          updatedAt: new Date().toISOString(),
        };
      },
    },
    episodes: { async findOwned() { return null; }, async ensureFirst() { return null; }, async updateStatus() { return null; } },
    bibles: {
      async findOwned() { return { approvedVersion: 1 }; },
      async findApprovedVersion() { return { version: 1, content: bible(), createdAt: now }; },
      async findApproved() { return { version: 1, content: bible(), createdAt: now }; },
    },
    casna: {
      async load() {
        return {
          gate: { allowed: true, code: "ok", reason: null },
          plan: { ...plan(), id: "e".repeat(24), status: "approved" },
          latestPlan: { ...plan(), id: "e".repeat(24), status: "approved" },
          ledger: null,
          episodePlan: episodePlan(),
          episodePlanValidation: { passed: true, findings: [], validatedAt: now },
          previousEpisodes: [],
          previousEpisode: null,
        };
      },
      async onEpisodeApproved() { return null; },
    },
    queue: { async enqueue() {} },
    engines: { async run() { throw new Error("unused"); } },
  };
  const service = createPipelineService(deps as unknown as PipelineDeps);
  return { service, updates };
}

describe("manual screenplay editing", () => {
  it("saves an edit and revalidates it against canon", async () => {
    const { service, updates } = editingHarness();
    const result = await service.updateStory(owner, projectId, storyId, {
      screenplay: screenplay(),
      expectedUpdatedAt: now,
      title: "The deed, revised",
    });
    expect(result.story.title).toBe("The deed, revised");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.validationFindings).toMatchObject({ passed: true });
  });

  it("rejects an invalid edit and keeps the previous screenplay", async () => {
    const edited = screenplay();
    edited[2]!.dialogue = [{ characterName: "The Stranger", line: "I know where the deed is." }];
    const { service, updates } = editingHarness();
    await expect(
      service.updateStory(owner, projectId, storyId, { screenplay: edited })
    ).rejects.toMatchObject({ status: 409, code: "story_invalid" });
    expect(updates).toHaveLength(0);
  });

  it("refuses to edit an approved story", async () => {
    const { service } = editingHarness(story({ status: "approved" }));
    await expect(
      service.updateStory(owner, projectId, storyId, { screenplay: screenplay() })
    ).rejects.toMatchObject({ code: "story_locked" });
  });

  it("rejects an edit made against an older revision", async () => {
    const { service } = editingHarness();
    await expect(
      service.updateStory(owner, projectId, storyId, {
        screenplay: screenplay(),
        expectedUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
      })
    ).rejects.toMatchObject({ code: "story_modified" });
  });

  it("rejects a malformed screenplay", async () => {
    const { service } = editingHarness();
    await expect(
      service.updateStory(owner, projectId, storyId, { screenplay: [] })
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

// ---------------------------------------------------------------------------
// Structured canon deltas
// ---------------------------------------------------------------------------

describe("structured canon deltas", () => {
  it("extracts arcs, relationships, objects, and locations into the summary", () => {
    const summary = extractEpisodeCanon({
      episodeNumber: 2,
      story: {
        title: "The deed",
        synopsis: "Ada finds the deed.",
        screenplay: screenplay(),
      },
      plan: plan(),
      episodePlan: episodePlan(),
      ledger: null,
    });
    expect(summary.objectStates).toEqual([
      expect.objectContaining({ name: "Deed", ownership: "Ada", condition: "Torn" }),
    ]);
    expect(summary.locationStates).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Study", currentState: "Ransacked" })])
    );
    const ada = summary.characterStates.find((state) => state.name === "Ada")!;
    expect(ada.emotionalState).toContain("stops trusting");
    expect(ada.relationships).toEqual(
      expect.arrayContaining([expect.objectContaining({ characterName: "Elias" })])
    );
    const elias = summary.characterStates.find((state) => state.name === "Elias")!;
    expect(elias.relationships).toEqual(
      expect.arrayContaining([expect.objectContaining({ characterName: "Ada" })])
    );
  });

  it("merges object and relationship deltas into the ledger", () => {
    const summary = extractEpisodeCanon({
      episodeNumber: 2,
      story: { title: "The deed", synopsis: "Ada finds the deed.", screenplay: screenplay() },
      plan: plan(),
      episodePlan: episodePlan(),
      ledger: null,
    });
    const ledger = applyCanonToLedger(null, summary);
    expect(ledger.objectStates).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Deed", ownership: "Ada" })])
    );
    const ada = ledger.characterStates.find((state) => state.name === "Ada")!;
    expect(ada.relationships).toEqual(
      expect.arrayContaining([expect.objectContaining({ characterName: "Elias" })])
    );
  });
});

// ---------------------------------------------------------------------------
// Season-plan repetition upgrades
// ---------------------------------------------------------------------------

describe("semantic repetition in the season plan", () => {
  it("flags a reused cliffhanger", () => {
    const ending = "Elias admits he signed the deed as the lights go out.";
    const result = validateSeasonPlan(
      {
        ...plan(),
        episodeProgression: [
          planItem({ episodeNumber: 1, endingOrCliffhanger: ending }),
          planItem({ episodeNumber: 2, endingOrCliffhanger: ending }),
        ],
      },
      null
    );
    expect(
      result.findings.some((finding) => finding.message.includes("reuses the ending beat"))
    ).toBe(true);
  });

  it("flags information revealed twice", () => {
    const revelation = "Elias signed the deed in the spring.";
    const result = validateSeasonPlan(
      {
        ...plan(),
        episodeProgression: [
          planItem({ episodeNumber: 1, informationRevealed: [revelation] }),
          planItem({ episodeNumber: 2, informationRevealed: [revelation] }),
        ],
      },
      null
    );
    expect(
      result.findings.some((finding) => finding.message.includes("already revealed"))
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Repair utilities
// ---------------------------------------------------------------------------

describe("scene repair utilities", () => {
  it("targets only the scene numbers named by error findings", () => {
    const findings: EpisodeValidation["findings"] = [
      { category: "canon", severity: "error", sceneNumber: 3, message: "Unknown character." },
      { category: "repetition", severity: "warning", sceneNumber: 2, message: "Repeated." },
      { category: "canon", severity: "error", sceneNumber: 5, message: "Dead character." },
    ];
    expect(repairSceneNumbers(findings)).toEqual([3, 5]);
    const instructions = repairSceneInstructions({
      seriesTitle: "The house",
      episodeNumber: 2,
      targetDurationSeconds: 300,
      screenplay: screenplay(),
      findings,
      episodePlan: episodePlan(),
      seasonPlan: null,
      continuityLedger: null,
    });
    const targetSection = instructions.prompt.split("Full screenplay for context")[0]!;
    expect(instructions.prompt).toContain("Scenes to repair");
    expect(targetSection).toContain('"sceneNumber":3');
    expect(targetSection).not.toContain('"sceneNumber":2');
  });

  it("replaces only the repaired scenes and keeps the rest", () => {
    const original = screenplay();
    const repaired = [
      { ...original[2]!, action: "Ada hides the deed before Elias enters." },
    ];
    const merged = mergeSceneRepair(original, repaired, [3])!;
    expect(merged).toHaveLength(original.length);
    expect(merged[2]!.action).toContain("hides the deed");
    expect(merged[0]!.action).toBe(original[0]!.action);
  });

  it("rejects a repair that does not return every target scene", () => {
    expect(mergeSceneRepair(screenplay(), [], [3])).toBeNull();
    expect(mergeSceneRepair(screenplay(), [screenplay()[0]!], [3])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Capability-aware failover
// ---------------------------------------------------------------------------

describe("capability-aware provider sequencing", () => {
  it("skips a provider that cannot plan a season and uses one that can", async () => {
    const unsupported: ProviderSlot = {
      id: "ollama",
      model: "local",
      configured: true,
      supported: true,
      async generate() {
        throw new Error("unused");
      },
    };
    const planner: ProviderSlot = {
      id: "gemini",
      model: "gemini-model",
      configured: true,
      supported: true,
      async generate() {
        throw new Error("unused");
      },
      async generateSeasonPlan() {
        return { plan: plan() };
      },
    };
    const manager = new StoryProviderManager({ slots: [unsupported, planner], sequenceTimeoutMs: 5_000 });
    const prompt: SeasonPlanPrompt = {
      seriesTitle: "The house",
      storyBible: {},
      storyFoundation: "Ada returns.",
      creativeDirection: "",
      tone: "cold",
      genre: "family",
      language: "en",
      productionMode: "serialized",
      episodeCount: 2,
      operation: "generate",
    };
    const result = await manager.generateSeasonPlan(prompt);
    expect(result.provider).toBe("gemini");
    expect(result.plan.episodeProgression).toHaveLength(2);
  });
});
