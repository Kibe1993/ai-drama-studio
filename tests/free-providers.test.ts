import { describe, expect, it } from "vitest";
import { createLiveEngines } from "@/lib/pipeline/liveEngines";
import { processGenerationJob } from "@/lib/pipeline/processJob";
import type { PipelineDeps } from "@/lib/pipeline/ports";
import type { JobRecord, RunRecord } from "@/lib/pipeline/types";
import { classifyProviderError } from "@/lib/providers/llm/errors";
import { StoryProviderManager, type ProviderSlot } from "@/lib/providers/llm/manager";
import { parseStory } from "@/lib/providers/llm/parse";
import { buildSlots } from "@/lib/providers/llm/registry";
import type { StoryPrompt } from "@/lib/providers/llm/types";
import type { GeneratedStory, StoryRecord } from "@/lib/validation/story";

const prompt: StoryPrompt = {
  title: "The courtyard",
  idea: "A daughter asks to be let back in.",
  genre: "family",
  language: "en",
  visualStyle: "realistic",
  tone: "quiet",
  targetDurationSeconds: 60,
  aspectRatio: "16:9",
};

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

function slot(id: string, generate: ProviderSlot["generate"], model = `${id}-model`): ProviderSlot {
  return { id, model, configured: true, supported: true, generate };
}

function manager(slots: ProviderSlot[], freeOnly = true) {
  return new StoryProviderManager({ slots, sequenceTimeoutMs: 5_000, providerTimeoutMs: 40, freeOnly });
}

function settings(values: Record<string, string>): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", LLM_FREE_ONLY: "true", ...values } as NodeJS.ProcessEnv;
}

describe("free provider sequence", () => {
  it("moves from Gemini to Groq", async () => {
    const result = await manager([
      slot("gemini", async () => {
        throw classifyProviderError("Gemini", { status: 503, message: "unavailable" });
      }),
      slot("groq", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("groq");
  });

  it("moves from Groq to OpenRouter", async () => {
    const result = await manager([
      slot("groq", async () => {
        throw classifyProviderError("Groq", { status: 503, message: "unavailable" });
      }),
      slot("openrouter", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("openrouter");
  });

  it("moves from OpenRouter to Mistral", async () => {
    const result = await manager([
      slot("openrouter", async () => {
        throw classifyProviderError("OpenRouter", { status: 503, message: "unavailable" });
      }),
      slot("mistral", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("mistral");
  });

  it("falls over a quota error", async () => {
    const result = await manager([
      slot("gemini", async () => {
        throw classifyProviderError("Gemini", { status: 402, message: "quota exceeded" });
      }),
      slot("groq", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("groq");
    expect(result.attempts?.[0]?.category).toBe("quota_exhausted");
  });

  it("falls over a provider timeout", async () => {
    const result = await manager(
      [
        slot("groq", (_input, options) => {
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              const error = new Error("timed out");
              error.name = "TimeoutError";
              reject(error);
            });
          });
        }),
        slot("openrouter", async () => ({ story: sample })),
      ],
      true
    ).generateStory(prompt);
    expect(result.provider).toBe("openrouter");
  });

  it("falls over invalid screenplay JSON", async () => {
    const result = await manager([
      slot("gemini", async () => {
        parseStory("Gemini", "not json");
        return { story: sample };
      }),
      slot("mistral", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("mistral");
    expect(result.attempts?.[0]?.category).toBe("invalid_json");
  });

  it("reads a screenplay wrapped in a JSON code fence", () => {
    expect(parseStory("Groq", "```json\n" + JSON.stringify(sample) + "\n```").title).toBe("The closed gate");
  });

  it("repairs a Groq screenplay that used empty strings for lists and numbers", () => {
    const loose = {
      title: "Existence",
      synopsis: "",
      structure: {
        act1: {
          introduction: "Jonah questions the sky.",
          mainCharacters: "Jonah",
          setting: "A hill",
          initialSituation: "He is alone.",
          incitingIncident: "A voice answers.",
        },
        act2: {
          risingTension: "The voice goes silent.",
          obstacles: "He cannot see who spoke.",
          characterDecisions: "He stays on the hill.",
          turningPoint: "The latch of the night opens.",
        },
        act3: {
          climax: "He answers.",
          resolution: "The hill is quiet.",
          finalOutcome: "He walks home.",
        },
      },
      screenplay: [
        {
          sceneNumber: "1",
          heading: "EXT. HILL - NIGHT",
          location: "Hill",
          timeOfDay: "night",
          charactersPresent: "",
          visualDescription: "Jonah looks up.",
          action: "He waits.",
          dialogue: "",
        },
      ],
    };
    const story = parseStory("Groq", JSON.stringify(loose));
    expect(story.synopsis).toBe("Jonah questions the sky.");
    expect(story.screenplay[0]?.sceneNumber).toBe(1);
    expect(story.screenplay[0]?.charactersPresent).toEqual(["Narrator"]);
    expect(story.screenplay[0]?.dialogue).toEqual([]);
  });

  it("does not select paid providers while free-only mode is enabled", () => {
    const slots = buildSlots(
      settings({
        LLM_PROVIDER: "gemini",
        LLM_FALLBACK_PROVIDERS: "openai,anthropic,deepseek,groq",
        GEMINI_API_KEY: "configured",
        OPENAI_API_KEY: "configured",
        ANTHROPIC_API_KEY: "configured",
        DEEPSEEK_API_KEY: "configured",
        GROQ_API_KEY: "configured",
      })
    );
    for (const id of ["openai", "anthropic", "deepseek"]) {
      expect(slots.find((item) => item.id === id)?.supported).toBe(false);
    }
    expect(slots.find((item) => item.id === "groq")).toMatchObject({
      supported: true,
      model: "openai/gpt-oss-20b",
    });
  });

  it("rejects an OpenRouter model that is not marked free", () => {
    const blocked = buildSlots(
      settings({
        LLM_PROVIDER: "openrouter",
        OPENROUTER_MODEL: "openai/gpt-4o",
        OPENROUTER_API_KEY: "configured",
      })
    );
    expect(blocked[0]).toMatchObject({ supported: false });
    const allowed = buildSlots(
      settings({
        LLM_PROVIDER: "openrouter",
        OPENROUTER_MODEL: "openrouter/free",
        OPENROUTER_API_KEY: "configured",
      })
    );
    expect(allowed[0]).toMatchObject({ supported: true, model: "openrouter/free" });
  });

  it("reports a clear failure when every free provider fails", async () => {
    await expect(
      manager([
        slot("groq", async () => {
          throw classifyProviderError("Groq", { status: 429, message: "rate limit" });
        }),
        slot("mistral", async () => {
          throw classifyProviderError("Mistral", { status: 503, message: "unavailable" });
        }),
      ]).generateStory(prompt)
    ).rejects.toMatchObject({
      message: "No free language provider is currently available.",
      retryable: true,
    });
  });

  it("saves one valid screenplay and leaves it waiting for approval", async () => {
    const rows: StoryRecord[] = [];
    const projectId = "a".repeat(24);
    const runId = "b".repeat(24);
    const jobId = "d".repeat(24);
    const run: RunRecord = {
      id: runId,
      clerkUserId: "user",
      projectId,
      workflowMode: "guided",
      currentStage: "story",
      status: "running",
      stageResults: {},
      retryCheckpoint: "planning",
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    const job: JobRecord = {
      id: jobId,
      clerkUserId: "user",
      projectId,
      runId,
      sceneNumber: null,
      jobType: "story.generate",
      provider: "mock",
      model: "mock",
      input: {},
      output: null,
      status: "queued",
      progress: { stage: "story.generate", message: "Queued" },
      attempts: 0,
      maxAttempts: 3,
      error: null,
      idempotencyKey: "story",
      bullJobId: null,
      startedAt: null,
      completedAt: null,
    };
    const deps: PipelineDeps = {
      projects: {
        async findOwned() {
          return {
            id: projectId,
            title: prompt.title,
            originalStoryIdea: prompt.idea,
            genre: "family",
            language: "en",
            visualStyle: "realistic",
            tone: "quiet",
            targetDurationSeconds: 60,
            aspectRatio: "16:9",
            status: "planning",
            workflowMode: "guided",
            createdAt: "",
            updatedAt: "",
          };
        },
        async update() {
          return null;
        },
      },
      runs: {
        async insert(input) {
          return input as RunRecord;
        },
        async findOwned() {
          return run;
        },
        async findLatest() {
          return run;
        },
        async save(next) {
          Object.assign(run, next);
          return run;
        },
      },
      jobs: {
        async insert(input) {
          return input as JobRecord;
        },
        async findOwned() {
          return job;
        },
        async findById() {
          return job;
        },
        async listForRun() {
          return [job];
        },
        async listOpen() {
          return [];
        },
        async listByKeyPrefix() {
          return [];
        },
        async save(next) {
          Object.assign(job, next);
          return job;
        },
      },
      stories: {
        async findOwned() {
          return null;
        },
        async findForRun() {
          return rows[0] ?? null;
        },
        async markApproved() {
          return null;
        },
      },
      queue: { async enqueue() {} },
      engines: createLiveEngines({
        llm: manager([slot("groq", async () => ({ story: sample }), "openai/gpt-oss-20b")]),
        stories: {
          async upsertAwaiting(input) {
            const created: StoryRecord = {
              ...input,
              provider: input.provider ?? "",
              model: input.model ?? "",
              fallbackFrom: input.fallbackFrom ?? null,
              id: "c".repeat(24),
              status: "awaiting_approval",
              version: 1,
              createdAt: "",
              updatedAt: "",
            };
            rows.push(created);
            return created;
          },
          async findForRun() {
            return rows[0] ?? null;
          },
        },
        projects: {
          async findOwned() {
            return {
              id: projectId,
              title: prompt.title,
              originalStoryIdea: prompt.idea,
              genre: "family",
              language: "en",
              visualStyle: "realistic",
              tone: "quiet",
              targetDurationSeconds: 60,
              aspectRatio: "16:9",
              status: "planning",
              workflowMode: "guided",
              createdAt: "",
              updatedAt: "",
            };
          },
          async update() {
            return null;
          },
        },
      }),
    };
    await processGenerationJob(deps, jobId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("awaiting_approval");
    expect(rows[0]?.title).toBe("The closed gate");
    expect(run.status).toBe("waiting_for_approval");
    expect(run.stageResults.story?.approved).toBe(false);
  });
});
