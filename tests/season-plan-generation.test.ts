import { describe, expect, it } from "vitest";
import { JobError, type JobRecord } from "@/lib/pipeline/types";
import { StoryProviderManager, type ProviderSlot } from "@/lib/providers/llm/manager";
import { createSeasonPlanEngine } from "@/lib/pipeline/seasonPlanEngine";
import { assembleSeasonPlan } from "@/lib/providers/llm/seasonPlanTask";
import type {
  SeasonArchitecturePrompt,
  EpisodeDetailBatchPrompt,
} from "@/lib/providers/llm/seasonPlanTask";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { StoryRecord } from "@/lib/validation/story";
import type {
  SeasonPlan,
  SeasonPlanRecord,
  SeasonArchitecture,
  EpisodeDetail,
  EpisodeDetailBatch,
  EpisodeOutline,
} from "@/lib/validation/seasonPlan";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date().toISOString();
const projectId = "a".repeat(24);
const ownerUserId = "user_owner";

function outline(n: number): EpisodeOutline {
  return {
    episodeNumber: n,
    workingTitle: `Episode ${n}`,
    narrativePurpose: `Purpose of episode ${n}.`,
    centralConflict: `Conflict of episode ${n}.`,
    endingOrCliffhanger: `Episode ${n} ends on a turn.`,
  };
}

function episodeDetail(n: number): EpisodeDetail {
  return {
    episodeNumber: n,
    workingTitle: `Episode ${n}`,
    narrativePurpose: `Purpose of episode ${n}.`,
    startingSituation: `Situation at start of episode ${n}.`,
    mainObjective: `Objective of episode ${n}.`,
    centralConflict: `Ada investigates who hid the deed in episode ${n}.`,
    majorStoryBeats: [`Beat one of episode ${n}.`],
    informationRevealed: [`A fact revealed in episode ${n}.`],
    characterDevelopment: `Characters change in episode ${n}.`,
    importantEvents: [`An event in episode ${n}.`],
    consequences: [`A consequence of episode ${n}.`],
    storyContribution: `Episode ${n} advances the season.`,
    endingOrCliffhanger: `Episode ${n} ends with Ada closer to the deed.`,
    unresolvedThreads: [`An unresolved thread from episode ${n}.`],
    continuityRequirements: `Next episode must respect episode ${n}.`,
    characterArcChanges: [],
    relationshipChanges: [],
    objectChanges: [],
    locationChanges: [],
  };
}

function architecture(episodeCount: number): SeasonArchitecture {
  return {
    seasonObjective: "Ada reclaims the family house.",
    centralConflictOrMystery: "Who hid the deed?",
    mainCharacterObjectives: "Ada wants the truth.",
    overallCharacterDevelopment: "Ada learns the cost of winning.",
    majorStoryDevelopments: ["The deed surfaces.", "Elias admits his part."],
    beginningDirection: "Ada returns.",
    middleDirection: "The search escalates.",
    endingDirection: "Ada chooses.",
    episodeOutlines: Array.from({ length: episodeCount }, (_, i) => outline(i + 1)),
    importantRevelations: ["Elias signed the deed."],
    relationshipChanges: ["Ada and Elias become rivals."],
    consequencesCarriedBetween: ["Elias is exposed."],
    setupAndPayoff: ["The drawer pays off."],
    unresolvedQuestions: ["Where is the second copy?"],
    intendedSeasonConclusion: "Ada keeps the house.",
  };
}

function dummyGenerate(): ProviderSlot["generate"] {
  return async () => {
    throw new Error("Not used in season plan tests.");
  };
}

function slot(
  id: string,
  options: {
    configured?: boolean;
    generateSeasonArchitecture?: ProviderSlot["generateSeasonArchitecture"];
    generateEpisodeDetails?: ProviderSlot["generateEpisodeDetails"];
    generateSeasonPlan?: ProviderSlot["generateSeasonPlan"];
  } = {}
): ProviderSlot {
  return {
    id,
    model: `${id}-model`,
    configured: options.configured ?? true,
    generate: dummyGenerate(),
    ...(options.generateSeasonArchitecture ? { generateSeasonArchitecture: options.generateSeasonArchitecture } : {}),
    ...(options.generateEpisodeDetails ? { generateEpisodeDetails: options.generateEpisodeDetails } : {}),
    ...(options.generateSeasonPlan ? { generateSeasonPlan: options.generateSeasonPlan } : {}),
  };
}

function manager(slots: ProviderSlot[]) {
  return new StoryProviderManager({
    slots,
    sequenceTimeoutMs: 10_000,
    providerTimeoutMs: 5_000,
  });
}

const archPrompt: SeasonArchitecturePrompt = {
  seriesTitle: "The house",
  storyBible: {},
  storyFoundation: "Ada returns to claim the house.",
  creativeDirection: "",
  tone: "cold",
  genre: "family",
  language: "en",
  productionMode: "serialized",
  episodeCount: 6,
  operation: "generate",
};

function batchPrompt(arch: SeasonArchitecture, outlines: EpisodeOutline[]): EpisodeDetailBatchPrompt {
  return {
    seriesTitle: "The house",
    storyBible: {},
    genre: "family",
    language: "en",
    tone: "cold",
    productionMode: "serialized",
    architecture: arch,
    outlines,
  };
}

// ---------------------------------------------------------------------------
// Provider failover tests
// ---------------------------------------------------------------------------

describe("season plan two-stage provider failover", () => {
  it("fails over when the first provider returns malformed JSON for architecture", async () => {
    const arch = architecture(6);
    const first = slot("groq", {
      generateSeasonArchitecture: async () => {
        throw new JobError("Groq returned malformed JSON.", "invalid_json", false);
      },
    });
    const second = slot("openrouter", {
      generateSeasonArchitecture: async () => ({ architecture: arch, usage: { inputTokens: 10, outputTokens: 20 } }),
    });
    const result = await manager([first, second]).generateSeasonArchitecture!(archPrompt);
    expect(result.architecture).toEqual(arch);
    expect(result.provider).toBe("openrouter");
    expect(result.fallbackFrom).toBe("groq");
  });

  it("fails over when the first provider returns empty content (finishReason=length)", async () => {
    const arch = architecture(6);
    const first = slot("openrouter-bad", {
      generateSeasonArchitecture: async () => {
        throw new JobError("OpenRouter returned an empty response.", "empty_response", false);
      },
    });
    const second = slot("mistral", {
      generateSeasonArchitecture: async () => ({ architecture: arch }),
    });
    const result = await manager([first, second]).generateSeasonArchitecture!(archPrompt);
    expect(result.architecture).toEqual(arch);
    expect(result.provider).toBe("mistral");
  });

  it("fails over when the first provider is rate limited (429)", async () => {
    const arch = architecture(6);
    const first = slot("mistral-429", {
      generateSeasonArchitecture: async () => {
        throw new JobError("Mistral is rate limited.", "rate_limited", true);
      },
    });
    const second = slot("groq", {
      generateSeasonArchitecture: async () => ({ architecture: arch }),
    });
    const result = await manager([first, second]).generateSeasonArchitecture!(archPrompt);
    expect(result.architecture).toEqual(arch);
    expect(result.provider).toBe("groq");
  });

  it("fails over when the first provider times out", async () => {
    const arch = architecture(6);
    const first = slot("ollama-slow", {
      generateSeasonArchitecture: async () => {
        throw new JobError("Ollama timed out.", "timeout", true);
      },
    });
    const second = slot("groq", {
      generateSeasonArchitecture: async () => ({ architecture: arch }),
    });
    const result = await manager([first, second]).generateSeasonArchitecture!(archPrompt);
    expect(result.architecture).toEqual(arch);
    expect(result.provider).toBe("groq");
  });

  it("fails over when the first provider returns malformed JSON for episode details", async () => {
    const arch = architecture(6);
    const outlines = arch.episodeOutlines.slice(0, 3);
    const batch: EpisodeDetailBatch = { episodes: outlines.map((o) => episodeDetail(o.episodeNumber)) };
    const first = slot("groq", {
      generateEpisodeDetails: async () => {
        throw new JobError("Groq returned malformed JSON.", "invalid_json", false);
      },
    });
    const second = slot("openrouter", {
      generateEpisodeDetails: async () => ({ batch }),
    });
    const result = await manager([first, second]).generateEpisodeDetails!(batchPrompt(arch, outlines));
    expect(result.batch).toEqual(batch);
    expect(result.provider).toBe("openrouter");
  });
});

// ---------------------------------------------------------------------------
// Two-stage assembly tests
// ---------------------------------------------------------------------------

describe("season plan two-stage assembly", () => {
  it("assembles a full season plan from architecture + episode details", () => {
    const arch = architecture(3);
    const details: EpisodeDetail[] = [episodeDetail(1), episodeDetail(2), episodeDetail(3)];
    const plan = assembleSeasonPlan(arch, details);
    expect(plan.seasonObjective).toBe(arch.seasonObjective);
    expect(plan.episodeProgression).toHaveLength(3);
    expect(plan.episodeProgression[0]!.episodeNumber).toBe(1);
    expect(plan.episodeProgression[0]!.startingSituation).toBe("Situation at start of episode 1.");
    expect(plan.intendedSeasonConclusion).toBe(arch.intendedSeasonConclusion);
  });

  it("generates a multi-episode plan via two-stage through the manager", async () => {
    const arch = architecture(6);
    const m = manager([
      slot("groq", {
        generateSeasonArchitecture: async () => ({ architecture: arch }),
        generateEpisodeDetails: async (_input: EpisodeDetailBatchPrompt) => ({
          batch: { episodes: _input.outlines.map((o) => episodeDetail(o.episodeNumber)) },
        }),
      }),
    ]);
    const archResult = await m.generateSeasonArchitecture!(archPrompt);
    expect(archResult.architecture.episodeOutlines).toHaveLength(6);

    const outlines = archResult.architecture.episodeOutlines;
    const allDetails: EpisodeDetail[] = [];
    for (let i = 0; i < outlines.length; i += 6) {
      const batch = outlines.slice(i, i + 6);
      const result = await m.generateEpisodeDetails!(batchPrompt(archResult.architecture, batch));
      allDetails.push(...result.batch.episodes);
    }
    expect(allDetails).toHaveLength(6);
    const plan = assembleSeasonPlan(archResult.architecture, allDetails);
    expect(plan.episodeProgression).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Engine-level two-stage generation with resume
// ---------------------------------------------------------------------------

describe("season plan engine two-stage generation", () => {
  function bibleContent(): StoryBibleContent {
    return {
      identity: {
        title: "The house",
        genres: ["drama"],
        subgenres: [],
        centralPremise: "A family fights over a house.",
        narrativeConcept: "A locked drawer holds the truth.",
        toneAndAtmosphere: "Cold and intimate.",
        targetAudience: "Adults",
        centralConflict: "Ada versus Elias.",
      },
      world: {
        description: "A coastal town.",
        geographyAndLocations: [
          { name: "The house", description: "A family house.", storyFunction: "The prize." },
        ],
        socialStructuresAndCultures: [],
        historyAndPastEvents: [],
        rules: [],
        definingSystems: [],
      },
      characters: {
        characters: [
          {
            name: "Ada",
            storyRole: "protagonist",
            roleDescription: "The lead.",
            physicalDescription: "",
            personality: "Guarded.",
            background: "Raised in the house.",
            motivations: ["Keep the family together."],
            fearsAndWeaknesses: ["Losing the house."],
            abilitiesAndLimitations: [],
            relationships: [],
            secrets: [],
            developmentPotential: "Learn to accept change.",
          },
        ],
        relationshipDynamics: [],
      },
      narrative: {
        mainStoryline: "Ada returns to claim the house.",
        majorConflicts: ["The deed."],
        longTermDirection: "The siblings reconcile.",
        subplots: [],
        unresolvedMysteries: ["Who hid the deed?"],
        potentialFutureRevelations: ["Elias signed it."],
        majorNarrativeQuestions: ["Who owns the house?"],
        serializedEndingGuidance: "End with a choice.",
      },
      guidelines: {
        mainThemes: ["Inheritance"],
        secondaryThemes: [],
        storytellingStyle: "Grounded realism.",
        boundaries: [],
        mustRemainConsistent: ["The house is never sold."],
      },
      canon: {
        confirmedFacts: ["The house is never sold."],
        proposedDetails: [],
        unresolvedQuestions: ["Where is the second copy?"],
        hiddenInformation: [],
        characterKnowledge: [],
        audienceKnowledge: [],
      },
    };
  }

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
      status: "draft",
      workflowMode: "guided",
      productionType: "fictional_drama",
      productionMode: "serialized",
      createdAt: now,
      updatedAt: now,
    };
  }

  function storyRecord(): StoryRecord {
    return {
      id: "s".repeat(24),
      clerkUserId: ownerUserId,
      projectId,
      productionRunId: null,
      episodeId: null,
      title: "The deed",
      synopsis: "Ada finds the deed.",
      structure: {
        act1: { introduction: "Ada returns.", mainCharacters: "Ada.", setting: "The house.", initialSituation: "Sold.", incitingIncident: "Ada finds a deed." },
        act2: { risingTension: "Elias avoids.", obstacles: "Lawyer missing.", characterDecisions: "Ada searches.", turningPoint: "She finds the signature." },
        act3: { climax: "Confrontation.", resolution: "Elias admits.", finalOutcome: "They talk." },
      },
      screenplay: [{ sceneNumber: 1, heading: "INT. HOUSE - NIGHT", location: "House", timeOfDay: "Night", charactersPresent: ["Ada"], visualDescription: "The house.", action: "Ada searches.", dialogue: [{ characterName: "Ada", line: "Found it." }] }],
      status: "approved",
      version: 1,
      provider: "fake",
      model: "fake-model",
      fallbackFrom: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  function stubJob(overrides: Partial<JobRecord> = {}): JobRecord {
    return {
      id: "j".repeat(24),
      clerkUserId: ownerUserId,
      projectId,
      runId: null,
      sceneNumber: null,
      jobType: "seasonPlan.generate",
      provider: "fake",
      model: "fake-model",
      input: { operation: "generate", episodeCount: 6 },
      output: null,
      status: "queued",
      progress: { stage: "seasonPlan.generate", message: "" },
      attempts: 0,
      maxAttempts: 3,
      error: null,
      idempotencyKey: "key",
      bullJobId: null,
      startedAt: null,
      completedAt: null,
      ...overrides,
    };
  }

  function engineHarness(options: {
    archFail?: boolean;
    batchFailOn?: number;
    cachedArchitecture?: SeasonArchitecture;
    cachedDetails?: EpisodeDetail[];
    episodeCount?: number;
  } = {}) {
    const episodeCount = options.episodeCount ?? 6;
    const rows: SeasonPlanRecord[] = [];
    const progressMessages: string[] = [];
    const plans = {
      async insert(input: Record<string, unknown>) {
        const record = {
          ...planContent(),
          ...(input as Partial<SeasonPlanRecord>),
          id: `plan-${rows.length + 1}`,
          version: rows.length + 1,
          status: "awaiting_approval" as const,
          validationFindings: null,
        } as SeasonPlanRecord;
        rows.push(record);
        return record;
      },
      async findLatest() { return rows[rows.length - 1] ?? null; },
      async saveValidationFindings(_userId: string, _planId: string, value: { passed: boolean }) {
        if (rows.length > 0) rows[rows.length - 1]!.validationFindings = value as SeasonPlanRecord["validationFindings"];
        return rows[rows.length - 1] ?? null;
      },
    };
    const bibles = {
      async findOwned() {
        return { approvedVersion: 1, approvedSnapshot: { version: 1, content: bibleContent(), createdAt: now }, creativeDirection: "" } as never;
      },
    };
    const stories = { async findProjectDraft() { return storyRecord() as never; } };
    const episodes = { async listOwned() { return []; } };
    const ledgers = { async findLatest() { return null; } };

    const arch = architecture(episodeCount);
    let batchCallCount = 0;
    const llm = {
      id: "fake",
      model: "fake-model",
      async generateSeasonArchitecture() {
        if (options.archFail) throw new JobError("Architecture failed.", "provider_failed", true);
        return { architecture: arch, provider: "fake", model: "fake-model", fallbackFrom: null };
      },
      async generateEpisodeDetails(input: EpisodeDetailBatchPrompt) {
        batchCallCount += 1;
        if (options.batchFailOn === batchCallCount) {
          throw new JobError("Batch failed.", "provider_failed", true);
        }
        return {
          batch: { episodes: input.outlines.map((o) => episodeDetail(o.episodeNumber)) },
          provider: "fake",
          model: "fake-model",
          fallbackFrom: null,
        };
      },
    } as never;

    const engine = createSeasonPlanEngine(
      llm,
      plans as never,
      bibles as never,
      stories as never,
      async (_job: JobRecord, message: string, output?: Record<string, unknown>) => {
        progressMessages.push(message);
        if (output !== undefined) _job.output = output;
      },
      episodes as never,
      ledgers as never,
    );
    return { engine, rows, progressMessages, getBatchCallCount: () => batchCallCount };
  }

  function planContent(): SeasonPlan {
    const arch = architecture(6);
    return assembleSeasonPlan(arch, arch.episodeOutlines.map((o) => episodeDetail(o.episodeNumber)));
  }

  it("generates a 6-episode plan via two-stage architecture + episode details", async () => {
    const { engine, rows } = engineHarness();
    const job = stubJob();
    const output = await engine.run(job, project());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.episodeProgression).toHaveLength(6);
    expect(output.passed).toBe(true);
    expect(output.provider).toBe("fake");
  });

  it("resumes from cached architecture and completed episode details on retry", async () => {
    const arch = architecture(6);
    const cachedDetails = [episodeDetail(1), episodeDetail(2), episodeDetail(3)];
    const { engine, rows, getBatchCallCount } = engineHarness({
      cachedArchitecture: arch,
      cachedDetails,
    });
    const job = stubJob({
      output: { seasonArchitecture: arch, episodeDetails: cachedDetails },
    });
    await engine.run(job, project());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.episodeProgression).toHaveLength(6);
    expect(rows[0]!.episodeProgression[0]!.episodeNumber).toBe(1);
    expect(getBatchCallCount()).toBe(1);
  });

  it("preserves completed batches when a later batch fails", async () => {
    const { engine, getBatchCallCount } = engineHarness({ batchFailOn: 2, episodeCount: 12 });
    const job = stubJob({ input: { operation: "generate", episodeCount: 12 } });
    await expect(engine.run(job, project())).rejects.toMatchObject({ code: "provider_failed" });
    expect(getBatchCallCount()).toBe(2);
    expect(job.output?.seasonArchitecture).toBeTruthy();
    expect(Array.isArray(job.output?.episodeDetails)).toBe(true);
    const details = job.output?.episodeDetails as EpisodeDetail[];
    expect(details.length).toBeGreaterThanOrEqual(6);
  });

  it("falls back to one-stage when the LLM lacks two-stage methods", async () => {
    const rows: SeasonPlanRecord[] = [];
    const plans = {
      async insert(input: Record<string, unknown>) {
        const record = { ...planContent(), ...(input as Partial<SeasonPlanRecord>), id: `plan-${rows.length + 1}`, version: rows.length + 1, status: "awaiting_approval" as const, validationFindings: null } as SeasonPlanRecord;
        rows.push(record);
        return record;
      },
      async findLatest() { return null; },
      async saveValidationFindings() { return null; },
    };
    const bibles = { async findOwned() { return { approvedVersion: 1, approvedSnapshot: { version: 1, content: bibleContent(), createdAt: now }, creativeDirection: "" } as never; } };
    const stories = { async findProjectDraft() { return storyRecord() as never; } };
    const episodes = { async listOwned() { return []; } };
    const ledgers = { async findLatest() { return null; } };
    const plan = planContent();
    const llm = {
      id: "fake",
      model: "fake-model",
      async generateSeasonPlan() {
        return { plan, provider: "fake", model: "fake-model", fallbackFrom: null };
      },
    } as never;
    const engine = createSeasonPlanEngine(llm, plans as never, bibles as never, stories as never, undefined, episodes as never, ledgers as never);
    const output = await engine.run(stubJob(), project());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.episodeProgression).toHaveLength(6);
    expect(output.provider).toBe("fake");
  });
});