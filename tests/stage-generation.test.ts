import { describe, expect, it } from "vitest";
import { createLiveEngines } from "@/lib/pipeline/liveEngines";
import { createMockEngines } from "@/lib/pipeline/mockEngines";
import { processGenerationJob } from "@/lib/pipeline/processJob";
import type { PipelineDeps } from "@/lib/pipeline/ports";
import { JobError, type JobRecord, type RunRecord } from "@/lib/pipeline/types";
import { StoryProviderManager, type ProviderSlot } from "@/lib/providers/llm/manager";
import type { LLMProvider } from "@/lib/providers/llm/types";
import type { CharacterProfile, ProductionScene } from "@/lib/validation/productionStages";
import type { GeneratedStory, StoryRecord } from "@/lib/validation/story";

const screenplay: GeneratedStory["screenplay"] = [
  {
    sceneNumber: 1,
    heading: "EXT. COURTYARD - NIGHT",
    location: "Courtyard",
    timeOfDay: "Night",
    charactersPresent: ["Ada", "Father"],
    visualDescription: "A locked iron gate.",
    action: "Ada knocks.",
    dialogue: [{ characterName: "Ada", line: "I came back." }],
  },
];

const characters: CharacterProfile[] = [
  {
    name: "Ada",
    role: "daughter",
    ageRange: "",
    gender: "",
    personality: "",
    physicalDescription: "",
    clothing: "",
    distinguishingFeatures: "",
    background: "",
    relationships: [],
    aliases: [],
    voiceManifestations: [],
  },
  {
    name: "Father",
    role: "father",
    ageRange: "",
    gender: "",
    personality: "",
    physicalDescription: "",
    clothing: "",
    distinguishingFeatures: "",
    background: "",
    relationships: [],
    aliases: [],
    voiceManifestations: [],
  },
];

const scenes: ProductionScene[] = [
  {
    sceneNumber: 1,
    title: "The gate",
    location: "Courtyard",
    interiorExterior: "exterior",
    timeOfDay: "Night",
    charactersPresent: ["Ada", "Father"],
    visualDescription: "A locked iron gate.",
    action: "Ada knocks.",
    dialogue: [{ characterName: "Ada", line: "I came back." }],
    cameraDirection: "",
    estimatedDurationSeconds: null,
  },
];

function story(status: StoryRecord["status"] = "approved"): StoryRecord {
  return {
    id: "c".repeat(24),
    clerkUserId: "user",
    projectId: "a".repeat(24),
    productionRunId: "b".repeat(24),
    title: "The closed gate",
    synopsis: "Ada asks to come home.",
    structure: {
      act1: {
        introduction: "Night.",
        mainCharacters: "Ada and her father.",
        setting: "Courtyard.",
        initialSituation: "The gate is locked.",
        incitingIncident: "Ada knocks.",
      },
      act2: {
        risingTension: "He does not answer.",
        obstacles: "The latch.",
        characterDecisions: "She waits.",
        turningPoint: "He opens it.",
      },
      act3: {
        climax: "They speak.",
        resolution: "She enters.",
        finalOutcome: "The gate stays open.",
      },
    },
    screenplay,
    status,
    version: 1,
    provider: "openrouter",
    model: "openrouter/free",
    fallbackFrom: "gemini",
    createdAt: "",
    updatedAt: "",
  };
}

function run(mode: RunRecord["workflowMode"] = "guided"): RunRecord {
  return {
    id: "b".repeat(24),
    clerkUserId: "user",
    projectId: "a".repeat(24),
    workflowMode: mode,
    currentStage: "characters",
    status: "running",
    stageResults: { story: { title: "The closed gate", synopsis: "Ada asks to come home.", approved: true, storyId: "c".repeat(24) } },
    retryCheckpoint: "story_ready",
    startedAt: "",
    completedAt: null,
  };
}

function job(jobType: JobRecord["jobType"]): JobRecord {
  return {
    id: "d".repeat(24),
    clerkUserId: "user",
    projectId: "a".repeat(24),
    runId: "b".repeat(24),
    sceneNumber: null,
    jobType,
    provider: "mock",
    model: "mock",
    input: {},
    output: null,
    status: "queued",
    progress: { stage: jobType, message: "Queued" },
    attempts: 0,
    maxAttempts: 3,
    error: null,
    idempotencyKey: jobType,
    bullJobId: null,
    startedAt: null,
    completedAt: null,
  };
}

function llm(calls: string[]): LLMProvider {
  return {
    id: "openrouter",
    model: "openrouter/free",
    async generateStory() {
      calls.push("story");
      throw new Error("story was not requested");
    },
    async generateCharacters() {
      calls.push("characters");
      return { characters, provider: "openrouter", model: "openrouter/free" };
    },
    async generateScenes() {
      calls.push("scenes");
      return { scenes, provider: "openrouter", model: "openrouter/free" };
    },
  };
}

describe("character and scene stages", () => {
  it("adds only the approved Story Bible snapshot to story generation", async () => {
    let captured: { continuityContext?: string } | undefined;
    const savedStory = story();
    const provider: LLMProvider = {
      id: "openrouter",
      model: "openrouter/free",
      async generateStory(input) {
        captured = input;
        return {
          title: savedStory.title,
          synopsis: savedStory.synopsis,
          structure: savedStory.structure,
          screenplay: savedStory.screenplay,
          provider: "openrouter",
          model: "openrouter/free",
        };
      },
      async generateCharacters() { return { characters: [] }; },
      async generateScenes() { return { scenes: [] }; },
    };
    const projectRecord = {
      id: "a".repeat(24),
      title: "The closed gate",
      originalStoryIdea: "Ada returns home.",
      genre: "family" as const,
      language: "en" as const,
      visualStyle: "realistic" as const,
      tone: "quiet",
      targetDurationSeconds: 300,
      aspectRatio: "16:9" as const,
      status: "planning" as const,
      workflowMode: "guided" as const,
      productionType: "fictional_drama" as const,
      productionMode: "serialized" as const,
      createdAt: "",
      updatedAt: "",
    };
    const engines = createLiveEngines({
      llm: provider,
      projects: { async findOwned() { return projectRecord; }, async update() { return null; } },
      stories: {
        async upsertAwaiting() { return { id: "c".repeat(24), title: savedStory.title, synopsis: savedStory.synopsis }; },
        async findForRun() { return savedStory; },
      },
      storyBible: {
        async findApproved() {
          return {
            premise: "A family guards a secret.",
            worldRules: ["The old house is never sold."],
            themes: ["Sacrifice"],
            boundaries: [],
            canonFacts: ["Ada's brother left ten years ago."],
            version: 1,
            createdAt: "",
          };
        },
      },
    });
    await engines.run(job("story.generate"), run());
    expect(captured?.continuityContext).toContain("The old house is never sold");
    expect(captured?.continuityContext).toContain("Ada's brother left ten years ago");
  });

  it("uses the language provider for characters and scenes, and the mock for video", async () => {
    const calls: string[] = [];
    const engines = createLiveEngines({
      llm: llm(calls),
      stories: { async upsertAwaiting() { throw new Error("unused"); }, async findForRun() { return story(); } },
      projects: {
        async findOwned() {
          return {
            id: "a".repeat(24),
            title: "The closed gate",
            originalStoryIdea: "Ada asks to come home.",
            genre: "family",
            language: "en",
            visualStyle: "realistic",
            tone: "quiet",
            targetDurationSeconds: 60,
            aspectRatio: "16:9",
            status: "story_ready",
            workflowMode: "guided",
            productionType: "fictional_drama",
            productionMode: "standalone",
            createdAt: "",
            updatedAt: "",
          };
        },
        async update() { return null; },
      },
    });
    const current = run();
    current.stageResults.characters = { names: ["Ada", "Father"], approved: true };
    const charactersOut = await engines.run(job("character.extract"), run());
    const scenesOut = await engines.run(job("scene.breakdown"), current);
    const videoOut = await engines.run({ ...job("video.scene"), sceneNumber: 1 }, current);
    expect(calls).toEqual(["characters", "scenes"]);
    expect(charactersOut.provider).toBe("openrouter");
    expect(scenesOut.provider).toBe("openrouter");
    expect(videoOut).toMatchObject({ sceneNumber: 1, referenceUsed: false });
  });

  it("rejects an invented character and does not save it", async () => {
    const calls: string[] = [];
    const saved = run();
    const currentJob = job("character.extract");
    const deps = box(saved, currentJob, {
      ...llm(calls),
      async generateCharacters() {
        calls.push("characters");
        return { characters: [{ ...characters[0]!, name: "Stranger" }], provider: "groq", model: "openai/gpt-oss-20b" };
      },
    }, story());
    await expect(processGenerationJob(deps, currentJob.id)).rejects.toMatchObject({ code: "invalid_schema" });
    expect(saved.stageResults.characters).toBeUndefined();
    expect(currentJob.status).toBe("failed");
  });

  it("saves one character set and one scene list, including after a retry", async () => {
    const saved = run("automatic");
    const currentJob = job("character.extract");
    const deps = box(saved, currentJob, llm([]), story());
    await processGenerationJob(deps, currentJob.id);
    expect(saved.stageResults.characters?.names).toEqual(["Ada", "Father"]);
    expect(saved.stageResults.characters?.profiles).toHaveLength(2);
    expect(saved.status).toBe("running");
    const sceneJob = deps.jobs && (await deps.jobs.listForRun(saved.id)).find((item) => item.jobType === "scene.breakdown");
    expect(sceneJob).toBeTruthy();
    await processGenerationJob(deps, sceneJob!.id);
    expect(saved.stageResults.scenes?.items).toHaveLength(1);
    expect(saved.stageResults.scenes?.provider).toBe("openrouter");
    sceneJob!.status = "queued";
    sceneJob!.completedAt = null;
    await processGenerationJob(deps, sceneJob!.id);
    expect(saved.stageResults.scenes?.items).toHaveLength(1);
  });

  it("keeps guided approval between characters and scenes", async () => {
    const saved = run("guided");
    const currentJob = job("character.extract");
    const deps = box(saved, currentJob, llm([]), story());
    await processGenerationJob(deps, currentJob.id);
    expect(saved.status).toBe("waiting_for_approval");
    expect(saved.stageResults.characters?.approved).toBe(false);
    expect((await deps.jobs.listForRun(saved.id)).some((item) => item.jobType === "scene.breakdown")).toBe(false);
  });

  it("does not extract characters before the story is approved", async () => {
    const calls: string[] = [];
    const saved = run();
    const currentJob = job("character.extract");
    const deps = box(saved, currentJob, llm(calls), story("awaiting_approval"));
    await expect(processGenerationJob(deps, currentJob.id)).rejects.toMatchObject({ code: "dependency" });
    expect(calls).toEqual([]);
  });

  it("skips a paid provider while free-only mode is on", async () => {
    let paid = 0;
    const slots: ProviderSlot[] = [
      {
        id: "groq",
        model: "openai/gpt-oss-20b",
        configured: true,
        supported: true,
        async generate() { throw new Error("unused"); },
        async generateCharacters() {
          throw new JobError("Groq is unavailable.", "provider_unavailable", true);
        },
      },
      {
        id: "openai",
        model: "gpt-6-luna",
        configured: true,
        supported: false,
        reason: "Paid providers are disabled while free-only mode is enabled.",
        async generate() { throw new Error("unused"); },
        async generateCharacters() { paid += 1; return { characters }; },
      },
    ];
    await expect(
      new StoryProviderManager({ slots, sequenceTimeoutMs: 5_000, providerTimeoutMs: 40, freeOnly: true }).generateCharacters({
        title: "The closed gate",
        screenplay,
      })
    ).rejects.toThrow(/No free language provider is currently available/);
    expect(paid).toBe(0);
  });

  it("keeps the mock character engine available", async () => {
    const output = await createMockEngines().run(job("character.extract"), run());
    expect(output.names).toEqual(["Amara", "Julian", "Mr. Adeyemi"]);
  });
});

function box(saved: RunRecord, currentJob: JobRecord, provider: LLMProvider, approved: StoryRecord): PipelineDeps {
  const jobs = [currentJob];
  return {
    projects: {
      async findOwned() {
        return {
          id: saved.projectId,
          title: "The closed gate",
          originalStoryIdea: "Ada asks to come home.",
          genre: "family",
          language: "en",
          visualStyle: "realistic",
          tone: "quiet",
          targetDurationSeconds: 60,
          aspectRatio: "16:9",
          status: "story_ready",
          workflowMode: saved.workflowMode,
          productionType: "fictional_drama",
          productionMode: "standalone",
          createdAt: "",
          updatedAt: "",
        };
      },
      async update(_clerkUserId, _id, patch) {
        return {
          id: saved.projectId,
          title: "The closed gate",
          originalStoryIdea: "Ada asks to come home.",
          genre: "family",
          language: "en",
          visualStyle: "realistic",
          tone: "quiet",
          targetDurationSeconds: 60,
          aspectRatio: "16:9",
          status: patch.status ?? "story_ready",
          workflowMode: saved.workflowMode,
          productionType: "fictional_drama",
          productionMode: "standalone",
          createdAt: "",
          updatedAt: "",
        };
      },
    },
    runs: {
      async insert(input) { return { ...input, id: saved.id }; },
      async findOwned() { return saved; },
      async findLatest() { return saved; },
      async save(next) { Object.assign(saved, next); return saved; },
    },
    jobs: {
      async insert(input) {
        const created = { ...input, id: `${jobs.length + 1}`.padStart(24, "e") };
        jobs.push(created);
        return created;
      },
      async findOwned() { return currentJob; },
      async findById(id) { return jobs.find((item) => item.id === id) ?? null; },
      async listForRun() { return jobs; },
      async listOpen() { return []; },
      async listByKeyPrefix(prefix) { return jobs.filter((item) => item.idempotencyKey === prefix || item.idempotencyKey.startsWith(`${prefix}:`)); },
      async save(next) {
        const index = jobs.findIndex((item) => item.id === next.id);
        if (index >= 0) jobs[index] = next;
        if (next.id === currentJob.id) Object.assign(currentJob, next);
        return next;
      },
    },
    stories: {
      async findOwned() { return approved; },
      async findForRun() { return approved; },
      async markApproved() { return approved; },
    },
    queue: { async enqueue() {} },
    engines: createLiveEngines({
      llm: provider,
      stories: { async upsertAwaiting() { throw new Error("unused"); }, async findForRun() { return approved; } },
      projects: {
        async findOwned() {
          return {
            id: saved.projectId,
            title: "The closed gate",
            originalStoryIdea: "Ada asks to come home.",
            genre: "family",
            language: "en",
            visualStyle: "realistic",
            tone: "quiet",
            targetDurationSeconds: 60,
            aspectRatio: "16:9",
            status: "characters_ready",
            workflowMode: saved.workflowMode,
            productionType: "fictional_drama",
            productionMode: "standalone",
            createdAt: "",
            updatedAt: "",
          };
        },
        async update() { return null; },
      },
    }),
  };
}
