import { describe, expect, it } from "vitest";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { RequestAuth } from "@/lib/auth/session";
import { canTransition } from "@/lib/domain/projectStatus";
import { createMockEngines } from "@/lib/pipeline/mockEngines";
import { processGenerationJob, reconcileOpenJobs } from "@/lib/pipeline/processJob";
import type { PipelineDeps } from "@/lib/pipeline/ports";
import { JobError, type JobRecord, type RunRecord } from "@/lib/pipeline/types";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createPipelineService } from "@/lib/services/pipelineService";
import { livePipelineDeps } from "@/lib/pipeline/live";
import { ensureStoryIndexes } from "@/lib/db/ensureIndexes";
import type { StoryRecord } from "@/lib/validation/story";

const owner: RequestAuth = {
  userId: "user_owner",
  isAdmin: false,
  email: "owner@example.com",
  name: "Owner",
  imageUrl: "",
};

const projectId = "a".repeat(24);

function project(status: ProjectRecord["status"] = "draft"): ProjectRecord {
  const now = new Date().toISOString();
  return {
    id: projectId,
    title: "The courtyard",
    originalStoryIdea: "A secret changes the family.",
    genre: "romance",
    language: "en",
    visualStyle: "realistic",
    tone: "quiet",
    targetDurationSeconds: 60,
    aspectRatio: "16:9",
    status,
    workflowMode: "guided",
    productionType: "fictional_drama",
    productionMode: "standalone",
    createdAt: now,
    updatedAt: now,
  };
}

function storyRecord(runId: string, sceneCount: number): StoryRecord {
  const now = new Date().toISOString();
  return {
    id: "f".repeat(24),
    clerkUserId: owner.userId,
    projectId,
    productionRunId: runId,
    status: "awaiting_approval",
    version: 1,
    provider: "mock",
    model: "mock",
    fallbackFrom: null,
    createdAt: now,
    updatedAt: now,
    title: "The courtyard",
    synopsis: "A secret changes the family.",
    structure: {
      act1: { introduction: "Dusk.", mainCharacters: "Amara and Julian.", setting: "The courtyard.", initialSituation: "They meet in secret.", incitingIncident: "The family notices." },
      act2: { risingTension: "The meetings continue.", obstacles: "The family forbids it.", characterDecisions: "They keep meeting.", turningPoint: "Julian is caught." },
      act3: { climax: "Amara chooses.", resolution: "The family relents.", finalOutcome: "They leave together." },
    },
    screenplay: Array.from({ length: sceneCount }, (_, index) => ({
      sceneNumber: index + 1,
      heading: `INT. ROOM ${index + 1} - DAY`,
      location: `Room ${index + 1}`,
      timeOfDay: "Day",
      charactersPresent: ["Amara"],
      visualDescription: `The camera holds room ${index + 1}.`,
      action: `Amara changes the situation in room ${index + 1}.`,
      dialogue: [{ characterName: "Amara", line: `Line ${index + 1}.` }],
    })),
  };
}

function harness(status: ProjectRecord["status"] = "draft") {
  const projects = [project(status)];
  const runs: RunRecord[] = [];
  const jobs: JobRecord[] = [];
  const enqueued: string[] = [];
  let sequence = 0;
  const nextId = () => {
    sequence += 1;
    return sequence.toString(16).padStart(24, "b");
  };

  const deps: PipelineDeps = {
    projects: {
      async findOwned(clerkUserId, id) {
        if (clerkUserId !== owner.userId) return null;
        return projects.find((item) => item.id === id) ?? null;
      },
      async update(clerkUserId, id, patch) {
        const row = projects.find((item) => item.id === id && clerkUserId === owner.userId);
        if (!row) return null;
        Object.assign(row, patch, { updatedAt: new Date().toISOString() });
        return row;
      },
    },
    runs: {
      async insert(input) {
        const run = { ...input, id: nextId(), stageResults: { ...input.stageResults } };
        runs.push(run);
        return run;
      },
      async findOwned(clerkUserId, id) {
        return runs.find((run) => run.id === id && run.clerkUserId === clerkUserId) ?? null;
      },
      async findLatest(clerkUserId, id) {
        return [...runs].reverse().find((run) => run.projectId === id && run.clerkUserId === clerkUserId) ?? null;
      },
      async save(run) {
        const index = runs.findIndex((item) => item.id === run.id);
        runs[index] = run;
        return run;
      },
    },
    jobs: {
      async insert(input) {
        const job = { ...input, id: nextId() };
        jobs.push(job);
        return job;
      },
      async findOwned(clerkUserId, id) {
        return jobs.find((job) => job.id === id && job.clerkUserId === clerkUserId) ?? null;
      },
      async findById(id) {
        return jobs.find((job) => job.id === id) ?? null;
      },
      async listForRun(runId) {
        return jobs.filter((job) => job.runId === runId);
      },
      async listOpen() {
        return jobs.filter((job) => job.status === "queued" || job.status === "processing");
      },
      async listByKeyPrefix(prefix) {
        return jobs.filter((job) => job.idempotencyKey === prefix || job.idempotencyKey.startsWith(`${prefix}:`));
      },
      async save(job) {
        const index = jobs.findIndex((item) => item.id === job.id);
        jobs[index] = job;
        return job;
      },
    },
    queue: {
      async enqueue(job) {
        enqueued.push(job.id);
      },
    },
    stories: {
      async findOwned() {
        return null;
      },
      async findForRun() {
        return null;
      },
      async markApproved() {
        return null;
      },
    },
    engines: createMockEngines(),
  };

  return { deps, api: createPipelineService(deps), projects, runs, jobs, enqueued };
}

async function nextQueued(deps: PipelineDeps) {
  const job = (await deps.jobs.listOpen()).find((item) => item.status === "queued");
  if (!job) throw new Error("No queued job");
  try {
    await processGenerationJob(deps, job.id);
  } catch (error) {
    if (!(error instanceof JobError)) throw error;
  }
  return job;
}

describe("production pipeline", () => {
  it("refuses scenes before the story and characters are approved", async () => {
    const { api } = harness();
    await api.start(owner, projectId, "guided");
    await expect(api.generateScenes(owner, projectId)).rejects.toMatchObject({ code: "dependency" });
    expect(canTransition("draft", "completed")).toBe(false);
  });

  it("refuses to approve a story that is still below its pacing floor", async () => {
    const { api, deps, projects } = harness();
    await api.start(owner, projectId, "guided");
    await api.generateStory(owner, projectId);
    await nextQueued(deps);

    const run = (await deps.runs.findLatest(owner.userId, projectId))!;
    // A five-minute episode needs six to eight scenes; this stored story carries one.
    projects[0]!.targetDurationSeconds = 300;
    const storyId = "f".repeat(24);
    run.stageResults.story!.storyId = storyId;
    await deps.runs.save(run);
    deps.stories.findOwned = async (userId, id) =>
      userId === owner.userId && id === storyId ? storyRecord(run.id, 1) : null;

    await expect(api.approveStory(owner, projectId, storyId)).rejects.toMatchObject({ code: "story_incomplete" });
  });

  it("stops at mock video output instead of completing a guided production", async () => {
    const { api, deps, projects } = harness();
    await api.start(owner, projectId, "guided");
    const first = await api.generateStory(owner, projectId);
    const second = await api.generateStory(owner, projectId);
    expect(second.id).toBe(first.id);
    await nextQueued(deps);
    expect(projects[0]?.status).toBe("planning");
    await api.approve(owner, projectId);
    await nextQueued(deps);
    await api.approve(owner, projectId);
    await nextQueued(deps);
    await api.approve(owner, projectId);
    expect(projects[0]?.status).toBe("generating");
    await nextQueued(deps);
    const state = await api.get(owner, projectId);
    expect(state.run?.stageResults.story?.approved).toBe(true);
    expect(state.run?.stageResults.scenes?.items).toHaveLength(2);
    expect(state.run?.status).toBe("unavailable");
    expect(state.run?.stageResults.scenes?.items.every((scene) => !scene.videoReady)).toBe(true);
    expect(state.run?.stageResults.scenes?.items.some((scene) => scene.videoStatus === "mock")).toBe(true);
    expect((await deps.jobs.listForRun(state.run!.id)).some((job) => job.jobType === "render.final")).toBe(false);
    expect(projects[0]?.status).toBe("generating");
    await expect(api.approve(owner, projectId)).rejects.toMatchObject({ code: "not_waiting" });
  });

  it("does not accept a legacy videoReady flag without an asset reference", async () => {
    const { api, deps } = harness();
    await api.start(owner, projectId, "guided");
    await api.generateStory(owner, projectId);
    await nextQueued(deps);
    await api.approve(owner, projectId);
    await nextQueued(deps);
    await api.approve(owner, projectId);
    await nextQueued(deps);

    const state = await api.get(owner, projectId);
    const run = state.run!;
    for (const scene of run.stageResults.scenes!.items) scene.videoReady = true;
    run.currentStage = "media";
    run.status = "waiting_for_approval";
    await deps.runs.save(run);

    await expect(api.approve(owner, projectId)).rejects.toMatchObject({ code: "media_incomplete" });
    expect((await deps.jobs.listForRun(run.id)).some((job) => job.jobType === "render.final")).toBe(false);
  });

  it("does not complete the production when the final render engine is mocked", async () => {
    const { api, deps, projects, runs } = harness();
    await api.start(owner, projectId, "guided");
    await api.generateStory(owner, projectId);
    await nextQueued(deps);
    await api.approve(owner, projectId);
    await nextQueued(deps);
    await api.approve(owner, projectId);
    await nextQueued(deps);
    const run = runs[0]!;
    for (const scene of run.stageResults.scenes!.items) {
      scene.videoReady = true;
      scene.videoStatus = "completed";
      scene.videoAssetId = `asset-${scene.sceneNumber}`;
    }
    run.currentStage = "media";
    run.status = "waiting_for_approval";
    projects[0]!.status = "generating";
    await deps.runs.save(run);

    await api.approve(owner, projectId);
    expect(projects[0]?.status).toBe("rendering");
    await nextQueued(deps);

    expect(run.status).toBe("unavailable");
    expect(run.stageResults.render).toMatchObject({ ready: false, status: "mock" });
    expect(projects[0]?.status).toBe("rendering");
  });

  it("keeps a failed scene from discarding the other scene", async () => {
    const { api, deps, projects } = harness();
    deps.engines.failNext("video.scene", 1, false);
    await api.start(owner, projectId, "automatic");
    await api.generateStory(owner, projectId);
    await nextQueued(deps);
    await api.approve(owner, projectId);
    for (let i = 0; i < 8; i += 1) {
      const open = (await deps.jobs.listOpen()).some((job) => job.status === "queued");
      if (!open) break;
      await nextQueued(deps);
    }
    const state = await api.get(owner, projectId);
    const items = state.run?.stageResults.scenes?.items ?? [];
    expect(items.filter((scene) => scene.failed)).toHaveLength(1);
    expect(items.filter((scene) => scene.videoReady)).toHaveLength(0);
    expect(state.run?.status).toBe("unavailable");
    expect(projects[0]?.status).toBe("generating");
  });

  it("retries a transient story failure and reloads from stored state", async () => {
    const box = harness();
    box.deps.engines.failNext("story.generate", 1, true);
    await box.api.start(owner, projectId, "guided");
    await box.api.generateStory(owner, projectId);
    await expect(processGenerationJob(box.deps, box.jobs[0]!.id)).rejects.toMatchObject({ retryable: true });
    expect(box.jobs[0]?.status).toBe("queued");
    const reloaded = createPipelineService(box.deps);
    await processGenerationJob(box.deps, box.jobs[0]!.id);
    const state = await reloaded.get(owner, projectId);
    expect(state.run?.status).toBe("waiting_for_approval");
    expect(state.run?.stageResults.story?.synopsis).toContain("family");
  });

  it("stops a permanent story failure without inventing a later status", async () => {
    const { api, deps, projects, jobs } = harness();
    deps.engines.failNext("story.generate", 1, false);
    await api.start(owner, projectId, "guided");
    await api.generateStory(owner, projectId);
    await expect(processGenerationJob(deps, jobs[0]!.id)).rejects.toMatchObject({ retryable: false });
    expect(jobs[0]?.status).toBe("failed");
    expect(projects[0]?.status).toBe("failed");
    const retried = await api.retry(owner, projectId);
    expect(projects[0]?.status).toBe("planning");
    expect(retried.id).not.toBe(jobs[0]?.id);
  });

  it("requeues a processing job after a restart", async () => {
    const { deps, jobs, enqueued } = harness();
    jobs.push({
      id: "c".repeat(24),
      clerkUserId: owner.userId,
      projectId,
      runId: "d".repeat(24),
      sceneNumber: null,
      jobType: "story.generate",
      provider: "mock",
      model: "mock",
      input: {},
      output: null,
      status: "processing",
      progress: { stage: "story.generate", message: "Developing story" },
      attempts: 1,
      maxAttempts: 3,
      error: null,
      idempotencyKey: "story.generate:run:all",
      bullJobId: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    });
    const count = await reconcileOpenJobs(deps);
    expect(count).toBe(1);
    expect(jobs[0]?.status).toBe("queued");
    expect(enqueued).toContain(jobs[0]?.id);
  });

  it("ownedRun throws actionable message when no run exists", async () => {
    const { api } = harness();
    await expect(api.generateStory(owner, projectId)).rejects.toMatchObject({
      code: "run_required",
      status: 409,
      message: expect.stringMatching(/No production run exists.*Call pipeline\.start/),
    });
  });
});

describe("worker dependency graph", () => {
  it("imports the live pipeline and keeps worker modules free of the Next-only guard", () => {
    expect(typeof livePipelineDeps).toBe("function");
    const workerModules = [
      "lib/services/continuityService.ts",
      "lib/pipeline/live.ts",
      "lib/pipeline/liveEngines.ts",
    ];
    for (const modulePath of workerModules) {
      const source = readFileSync(path.join(process.cwd(), modulePath), "utf8");
      expect(source).not.toMatch(/(^|\n)\s*import\s+["']server-only["']/);
    }
  });
});

describe("story index migration", () => {
  it("drops the legacy non-partial unique index and creates the partial one", async () => {
    const dropped: string[] = [];
    let created: { key: unknown; options: unknown } | null = null;
    const collection = {
      async indexes() {
        return [{ name: "productionRunId_1", unique: true }];
      },
      async dropIndex(name: string) {
        dropped.push(name);
      },
      async createIndex(key: unknown, options: unknown) {
        created = { key, options };
      },
    };
    await ensureStoryIndexes({ collection: () => collection } as never);
    expect(dropped).toEqual(["productionRunId_1"]);
    expect(created).toMatchObject({
      key: { productionRunId: 1 },
      options: {
        name: "productionRunId_1",
        unique: true,
        partialFilterExpression: { productionRunId: { $type: "objectId" } },
      },
    });
  });
});
