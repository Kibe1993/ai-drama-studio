import { describe, expect, it, vi } from "vitest";
import type { RequestAuth } from "@/lib/auth/session";
import { createLiveEngines } from "@/lib/pipeline/liveEngines";
import { processGenerationJob } from "@/lib/pipeline/processJob";
import type { PipelineDeps } from "@/lib/pipeline/ports";
import { JobError, type JobRecord, type RunRecord } from "@/lib/pipeline/types";
import { GeminiLLMProvider } from "@/lib/providers/llm/gemini";
import type { LlmClient } from "@/lib/providers/llm/types";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import { createPipelineService } from "@/lib/services/pipelineService";
import type { GeneratedStory, StoryRecord } from "@/lib/validation/story";

const owner: RequestAuth = {
  userId: "user_owner",
  isAdmin: false,
  email: "owner@example.com",
  name: "Owner",
  imageUrl: "",
};
const stranger: RequestAuth = { ...owner, userId: "user_stranger" };
const projectId = "a".repeat(24);

const sample: GeneratedStory = {
  title: "The closed gate",
  synopsis: "A daughter returns at night and asks to be let in.",
  structure: {
    act1: {
      introduction: "Night at a family house.",
      mainCharacters: "Ada and her father.",
      setting: "A locked courtyard.",
      initialSituation: "Ada has been away for a year.",
      incitingIncident: "She knocks on the gate.",
    },
    act2: {
      risingTension: "Her father will not answer.",
      obstacles: "The rest of the family is listening.",
      characterDecisions: "Ada refuses to leave.",
      turningPoint: "He lifts the latch.",
    },
    act3: {
      climax: "They speak through the opening.",
      resolution: "She steps inside.",
      finalOutcome: "The gate stays unlatched.",
    },
  },
  screenplay: [
    {
      sceneNumber: 1,
      heading: "EXT. COURTYARD - NIGHT",
      location: "Courtyard",
      timeOfDay: "Night",
      charactersPresent: ["Ada", "Father"],
      visualDescription: "A locked iron gate in warm window light.",
      action: "Ada knocks once and waits.",
      dialogue: [{ characterName: "Ada", line: "I came back." }],
    },
  ],
};

function project(): ProjectRecord {
  const now = new Date().toISOString();
  return {
    id: projectId,
    title: "The courtyard",
    originalStoryIdea: "A daughter asks to be let back in.",
    genre: "family",
    language: "en",
    visualStyle: "realistic",
    tone: "quiet",
    targetDurationSeconds: 60,
    aspectRatio: "16:9",
    status: "draft",
    workflowMode: "guided",
    productionType: "fictional_drama",
    productionMode: "standalone",
    createdAt: now,
    updatedAt: now,
  };
}

function memoryStories() {
  const rows: StoryRecord[] = [];
  let sequence = 0;
  return {
    rows,
    async upsertAwaiting(input: Omit<StoryRecord, "id" | "status" | "version" | "createdAt" | "updatedAt">) {
      const existing = rows.find(
        (row) => row.productionRunId === input.productionRunId && row.clerkUserId === input.clerkUserId
      );
      if (existing?.status === "approved") {
        throw new JobError("This story is already approved.", "story_approved", false);
      }
      const now = new Date().toISOString();
      if (existing) {
        Object.assign(existing, input, { status: "awaiting_approval", updatedAt: now });
        return existing;
      }
      sequence += 1;
      const created: StoryRecord = {
        ...input,
        id: sequence.toString(16).padStart(24, "c"),
        status: "awaiting_approval",
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(created);
      return created;
    },
    async findOwned(clerkUserId: string, id: string) {
      return rows.find((row) => row.id === id && row.clerkUserId === clerkUserId) ?? null;
    },
    async findForRun(clerkUserId: string, productionRunId: string) {
      return rows.find((row) => row.productionRunId === productionRunId && row.clerkUserId === clerkUserId) ?? null;
    },
    async markApproved(clerkUserId: string, id: string) {
      const row = rows.find((item) => item.id === id && item.clerkUserId === clerkUserId);
      if (!row || (row.status !== "awaiting_approval" && row.status !== "approved")) return null;
      row.status = "approved";
      return row;
    },
  };
}

function harness(client: LlmClient) {
  const projects = [project()];
  const runs: RunRecord[] = [];
  const jobs: JobRecord[] = [];
  const stories = memoryStories();
  let sequence = 0;
  const nextId = () => {
    sequence += 1;
    return sequence.toString(16).padStart(24, "d");
  };
  const projectsPort = {
    async findOwned(clerkUserId: string, id: string) {
      if (clerkUserId !== owner.userId) return null;
      return projects.find((item) => item.id === id) ?? null;
    },
    async update(clerkUserId: string, id: string, patch: Partial<ProjectRecord>) {
      const row = projects.find((item) => item.id === id && clerkUserId === owner.userId);
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
  };
  const deps: PipelineDeps = {
    projects: projectsPort,
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
    stories,
    queue: { async enqueue() {} },
    engines: createLiveEngines({
      llm: new GeminiLLMProvider({
        model: "gemini-flash-latest",
        apiKey: "test-key",
        selectedProvider: "gemini",
        client,
      }),
      stories,
      projects: projectsPort,
    }),
  };
  return { deps, api: createPipelineService(deps), projects, jobs, stories };
}

function provider(client: LlmClient, apiKey: string | undefined = "test-key") {
  return new GeminiLLMProvider({
    model: "gemini-flash-latest",
    apiKey,
    selectedProvider: "gemini",
    client,
  });
}

const prompt = {
  title: "The courtyard",
  idea: "A daughter asks to be let back in.",
  genre: "family",
  language: "en",
  visualStyle: "realistic",
  tone: "quiet",
  targetDurationSeconds: 60,
  aspectRatio: "16:9",
};

describe("Gemini story provider", () => {
  it("accepts a valid story JSON response", async () => {
    const story = await provider({ async complete() { return { text: JSON.stringify(sample) }; } }).generateStory(prompt);
    expect(story.title).toBe("The closed gate");
    expect(story.screenplay[0]?.dialogue[0]?.line).toBe("I came back.");
  });

  it("rejects invalid JSON without calling the pipeline", async () => {
    await expect(provider({ async complete() { return { text: "not json" }; } }).generateStory(prompt)).rejects.toMatchObject({
      code: "invalid_json",
      retryable: false,
    });
  });

  it("rejects a response that fails the screenplay schema", async () => {
    await expect(
      provider({ async complete() { return { text: JSON.stringify({ title: "Only a title" }) }; } }).generateStory(prompt)
    ).rejects.toMatchObject({ code: "invalid_schema", retryable: false });
  });

  it("fails when the API key is missing and does not call Gemini", async () => {
    const complete = vi.fn(async () => ({ text: "{}" }));
    await expect(provider({ complete }, "").generateStory(prompt)).rejects.toMatchObject({
      code: "configuration",
      retryable: false,
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it("maps a Gemini API failure to a permanent job error", async () => {
    await expect(
      provider({
        async complete() {
          throw new Error("Gemini could not complete the request");
        },
      }).generateStory(prompt)
    ).rejects.toMatchObject({ code: "provider_failed", retryable: false });
  });

  it("retries a rate limit", async () => {
    await expect(
      provider({
        async complete() {
          throw Object.assign(new Error("rate limit"), { status: 429 });
        },
      }).generateStory(prompt)
    ).rejects.toMatchObject({ code: "rate_limited", retryable: true });
  });

  it("logs a redacted diagnostic before normalizing the error", async () => {
    const secret = "AIzaSySECRETKEY1234567890";
    const failure = new Error(
      JSON.stringify({
        error: {
          message: `upstream failed ${secret} key=supersecret`,
          status: "UNAVAILABLE",
        },
      })
    );
    failure.name = "ApiError";
    Object.assign(failure, { status: 503, cause: { code: "ECONNRESET" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      provider({
        async complete() {
          throw failure;
        },
      }).generateStory(prompt)
    ).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
    const logged = spy.mock.calls.flat().join(" ");
    spy.mockRestore();
    expect(logged).toContain("gemini diagnostic");
    expect(logged).toContain("name=ApiError");
    expect(logged).toContain("httpStatus=503");
    expect(logged).toContain("googleStatus=UNAVAILABLE");
    expect(logged).toContain("causeCode=ECONNRESET");
    expect(logged).toContain("model=gemini-flash-latest");
    expect(logged).toContain("applicationTimeout=false");
    expect(logged).toContain("[redacted]");
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain("supersecret");
    expect(logged).not.toContain(prompt.idea);
  });

  it("marks an application timeout in the diagnostic log", async () => {
    const failure = new Error("The operation was aborted");
    failure.name = "TimeoutError";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      provider({
        async complete() {
          throw failure;
        },
      }).generateStory(prompt)
    ).rejects.toMatchObject({ code: "timeout", retryable: true });
    const logged = spy.mock.calls.flat().join(" ");
    spy.mockRestore();
    expect(logged).toContain("applicationTimeout=true");
    expect(logged).not.toContain(prompt.idea);
  });

  it("retries a timeout", async () => {
    await expect(
      provider({
        async complete() {
          const error = new Error("timed out");
          error.name = "TimeoutError";
          throw error;
        },
      }).generateStory(prompt)
    ).rejects.toMatchObject({ code: "timeout", retryable: true });
  });
});

describe("story generation pipeline", () => {
  it("saves one story for the project and run, and a retry updates it", async () => {
    const box = harness({ async complete() { return { text: JSON.stringify(sample) }; } });
    await box.api.start(owner, projectId, "automatic");
    await box.api.generateStory(owner, projectId);
    await processGenerationJob(box.deps, box.jobs[0]!.id);
    expect(box.stories.rows).toHaveLength(1);
    expect(box.stories.rows[0]).toMatchObject({
      projectId,
      productionRunId: box.jobs[0]!.runId,
      status: "awaiting_approval",
      version: 1,
    });
    box.jobs[0]!.status = "queued";
    box.jobs[0]!.completedAt = null;
    await processGenerationJob(box.deps, box.jobs[0]!.id);
    expect(box.stories.rows).toHaveLength(1);
  });

  it("pauses after the story, then extracts characters from the approved screenplay", async () => {
    const calls = { count: 0 };
    const box = harness({
      async complete(input) {
        calls.count += 1;
        if (input.prompt.includes("Use only people who appear")) {
          return {
            text: JSON.stringify({
              characters: [
                { name: "Ada", role: "daughter", physicalDescription: "" },
                { name: "Father", role: "father", physicalDescription: "" },
              ],
            }),
          };
        }
        return { text: JSON.stringify(sample) };
      },
    });
    await box.api.start(owner, projectId, "automatic");
    await box.api.generateStory(owner, projectId);
    await processGenerationJob(box.deps, box.jobs[0]!.id);
    const paused = await box.api.get(owner, projectId);
    expect(paused.run?.status).toBe("waiting_for_approval");
    expect(paused.run?.stageResults.story?.approved).toBe(false);
    expect(paused.jobs.some((job) => job.jobType === "character.extract")).toBe(false);
    expect(calls.count).toBe(1);

    await box.api.approveStory(owner, projectId, box.stories.rows[0]!.id);
    const character = box.jobs.find((job) => job.jobType === "character.extract");
    await processGenerationJob(box.deps, character!.id);
    expect(calls.count).toBe(2);
    const moved = await box.api.get(owner, projectId);
    expect(moved.run?.stageResults.characters?.names).toEqual(["Ada", "Father"]);
    expect(moved.run?.workflowMode).toBe("automatic");
    expect(moved.run?.currentStage === "scenes" || moved.jobs.some((job) => job.jobType === "scene.breakdown")).toBe(true);
  });

  it("fails the project when Gemini rejects the story and does not save one", async () => {
    const box = harness({ async complete() { return { text: "not json" }; } });
    await box.api.start(owner, projectId, "guided");
    await box.api.generateStory(owner, projectId);
    await expect(processGenerationJob(box.deps, box.jobs[0]!.id)).rejects.toMatchObject({ retryable: false });
    expect(box.jobs[0]?.status).toBe("failed");
    expect(box.projects[0]?.status).toBe("failed");
    expect(box.stories.rows).toHaveLength(0);
    const state = await box.api.get(owner, projectId);
    expect(state.run?.status).toBe("failed");
  });
});

describe("story approval", () => {
  async function ready() {
    const box = harness({ async complete() { return { text: JSON.stringify(sample) }; } });
    await box.api.start(owner, projectId, "guided");
    await box.api.generateStory(owner, projectId);
    await processGenerationJob(box.deps, box.jobs[0]!.id);
    return box;
  }

  it("lets the owner approve and resume the next stage", async () => {
    const box = await ready();
    const first = await box.api.approveStory(owner, projectId, box.stories.rows[0]!.id);
    expect(first.alreadyApproved).toBe(false);
    expect(first.story.status).toBe("approved");
    expect(first.job?.jobType).toBe("character.extract");
    expect(box.projects[0]?.status).toBe("story_ready");
  });

  it("does not enqueue a second character job when approval is repeated", async () => {
    const box = await ready();
    await box.api.approveStory(owner, projectId, box.stories.rows[0]!.id);
    const second = await box.api.approveStory(owner, projectId, box.stories.rows[0]!.id);
    expect(second.alreadyApproved).toBe(true);
    expect(box.jobs.filter((job) => job.jobType === "character.extract")).toHaveLength(1);
    expect(second.job?.id).toBe(box.jobs.find((job) => job.jobType === "character.extract")?.id);
  });

  it("refuses a non-owner", async () => {
    const box = await ready();
    await expect(box.api.approveStory(stranger, projectId, box.stories.rows[0]!.id)).rejects.toMatchObject({
      status: 409,
    });
    expect(box.stories.rows[0]?.status).toBe("awaiting_approval");
  });

  it("refuses an invalid or failed story", async () => {
    const box = await ready();
    await expect(box.api.approveStory(owner, projectId, "not-an-id")).rejects.toMatchObject({ code: "invalid_id" });
    await expect(box.api.approveStory(owner, projectId, "e".repeat(24))).rejects.toMatchObject({ code: "not_found" });
    box.stories.rows[0]!.status = "failed";
    await expect(box.api.approveStory(owner, projectId, box.stories.rows[0]!.id)).rejects.toMatchObject({
      code: "story_failed",
    });
  });
});
