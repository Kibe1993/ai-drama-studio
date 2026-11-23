import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logMock = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/log", () => ({
  log: logMock,
}));

const realAbortTimeout = AbortSignal.timeout;

function installFakeAbortTimeout() {
  Object.defineProperty(AbortSignal, "timeout", {
    value: function timeout(ms: number): AbortSignal {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" })),
        ms
      );
      return controller.signal;
    },
    writable: true,
    configurable: true,
  });
}

function restoreAbortTimeout() {
  Object.defineProperty(AbortSignal, "timeout", {
    value: realAbortTimeout,
    writable: true,
    configurable: true,
  });
}

import { JobError } from "@/lib/pipeline/types";
import { StoryProviderManager, type ProviderSlot } from "@/lib/providers/llm/manager";
import {
  DEFAULT_OLLAMA_STORY_TIMEOUT_MS,
  DEFAULT_OLLAMA_TIMEOUT_MS,
  ollamaStoryTimeoutMs,
} from "@/lib/providers/llm/ollama";
import { buildSlots } from "@/lib/providers/llm/registry";
import type { StoryPrompt, TokenUsage } from "@/lib/providers/llm/types";
import type { GeneratedStory } from "@/lib/validation/story";

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

const sampleStory: GeneratedStory = {
  title: "The closed gate",
  synopsis: "A daughter returns at night and asks to be let in.",
  structure: {
    act1: {
      introduction: "Night at a family house.",
      mainCharacters: "Ada and Father.",
      setting: "A locked courtyard.",
      initialSituation: "Ada has been away for a year.",
      incitingIncident: "She knocks on the gate.",
    },
    act2: {
      risingTension: "Her father will not answer.",
      obstacles: "The family is listening.",
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

function findLog(
  calls: ReturnType<typeof vi.fn>["mock"]["calls"],
  message: string
): Record<string, unknown> | undefined {
  const call = calls.find((c) => c[1] === message);
  return call?.[2] as Record<string, unknown> | undefined;
}

function ollamaStorySlot(
  responseMs: number,
  storyTimeoutMs: number = DEFAULT_OLLAMA_STORY_TIMEOUT_MS,
  timeoutMs: number = DEFAULT_OLLAMA_TIMEOUT_MS
): ProviderSlot {
  return {
    id: "ollama",
    model: "qwen3:4b",
    configured: true,
    supported: true,
    timeoutMs,
    storyTimeoutMs,
    async generate(_input: StoryPrompt, options: { signal: AbortSignal }): Promise<{ story: GeneratedStory; usage?: TokenUsage }> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (options.signal.aborted) {
            reject(new JobError("The signal aborted before the response completed.", "timeout", true));
            return;
          }
          resolve({ story: sampleStory, usage: { inputTokens: 100, outputTokens: 200 } });
        }, responseMs);
        options.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new JobError("The signal aborted before the response completed.", "timeout", true));
        });
      });
    },
  };
}

function cloudSlot(
  id: string,
  responseMs: number,
  providerTimeoutMs: number = 90_000
): ProviderSlot {
  return {
    id,
    model: `${id}-model`,
    configured: true,
    supported: true,
    timeoutMs: providerTimeoutMs,
    async generate(_input: StoryPrompt, options: { signal: AbortSignal }): Promise<{ story: GeneratedStory; usage?: TokenUsage }> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (options.signal.aborted) {
            reject(new JobError("The signal aborted.", "timeout", true));
            return;
          }
          resolve({ story: sampleStory, usage: { inputTokens: 50, outputTokens: 100 } });
        }, responseMs);
        options.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new JobError("The signal aborted.", "timeout", true));
        });
      });
    },
  };
}

describe("Story Draft timeout: ollamaStoryTimeoutMs configuration", () => {
  it("defaults to 900 seconds when env is unset", () => {
    expect(ollamaStoryTimeoutMs({} as NodeJS.ProcessEnv)).toBe(900_000);
  });

  it("respects OLLAMA_STORY_TIMEOUT_MS", () => {
    expect(ollamaStoryTimeoutMs({ NODE_ENV: "test", OLLAMA_STORY_TIMEOUT_MS: "600000" } as NodeJS.ProcessEnv)).toBe(600_000);
  });

  it("clamps to a minimum of 10 seconds", () => {
    expect(ollamaStoryTimeoutMs({ NODE_ENV: "test", OLLAMA_STORY_TIMEOUT_MS: "5000" } as NodeJS.ProcessEnv)).toBe(10_000);
  });

  it("clamps to a maximum of 1 hour", () => {
    expect(ollamaStoryTimeoutMs({ NODE_ENV: "test", OLLAMA_STORY_TIMEOUT_MS: "7200000" } as NodeJS.ProcessEnv)).toBe(3_600_000);
  });

  it("treats blank values as unset", () => {
    expect(ollamaStoryTimeoutMs({ NODE_ENV: "test", OLLAMA_STORY_TIMEOUT_MS: "  " } as NodeJS.ProcessEnv)).toBe(900_000);
  });
});

describe("Story Draft timeout: registry slot configuration", () => {
  it("sets storyTimeoutMs on the Ollama slot", () => {
    const slots = buildSlots({ NODE_ENV: "test", LLM_FREE_ONLY: "true" } as NodeJS.ProcessEnv);
    const ollamaSlot = slots.find((s) => s.id === "ollama");
    expect(ollamaSlot?.storyTimeoutMs).toBe(DEFAULT_OLLAMA_STORY_TIMEOUT_MS);
  });

  it("respects OLLAMA_STORY_TIMEOUT_MS from the environment", () => {
    const slots = buildSlots({
      NODE_ENV: "test",
      LLM_FREE_ONLY: "true",
      OLLAMA_STORY_TIMEOUT_MS: "1200000",
    } as NodeJS.ProcessEnv);
    const ollamaSlot = slots.find((s) => s.id === "ollama");
    expect(ollamaSlot?.storyTimeoutMs).toBe(1_200_000);
  });

  it("does not set storyTimeoutMs on cloud provider slots", () => {
    const slots = buildSlots({
      NODE_ENV: "test",
      LLM_FREE_ONLY: "false",
      LLM_PAID_ENABLED: "true",
      GROQ_API_KEY: "test",
    } as NodeJS.ProcessEnv);
    const groqSlot = slots.find((s) => s.id === "groq");
    expect(groqSlot?.storyTimeoutMs).toBeUndefined();
  });
});

describe("Story Draft timeout: manager budget allocation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeAbortTimeout();
    logMock.info.mockClear();
    logMock.error.mockClear();
  });

  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it("logs timeoutMs=900000 for a story task with Ollama", async () => {
    const slot = ollamaStorySlot(100_000);
    const mgr = new StoryProviderManager({
      slots: [slot],
      freeOnly: false,
    });

    const promise = mgr.generateStory(prompt);
    await vi.advanceTimersByTimeAsync(100_000);
    await promise;

    const attemptLog = findLog(logMock.info.mock.calls, "provider attempt");
    expect(attemptLog).toBeDefined();
    expect(attemptLog!.timeoutMs).toBe(900_000);
    expect(attemptLog!.task).toBe("story");
    expect(attemptLog!.provider).toBe("ollama");
  });

  it("a 700-second story call succeeds within the 900s budget", async () => {
    const slot = ollamaStorySlot(700_000);
    const mgr = new StoryProviderManager({
      slots: [slot],
      freeOnly: false,
    });

    const promise = mgr.generateStory(prompt);
    await vi.advanceTimersByTimeAsync(700_000);
    const result = await promise;

    expect(result.provider).toBe("ollama");
  });

  it("a call exceeding the 900s story budget fails with timeout", async () => {
    const slot = ollamaStorySlot(1_000_000);
    const mgr = new StoryProviderManager({
      slots: [slot],
      freeOnly: false,
    });

    const promise = mgr.generateStory(prompt);
    const caught = promise.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(900_001);

    expect(await caught).toMatchObject({ code: "timeout" });
  });

  it("does not clamp the story timeout to 240 or 300 seconds", async () => {
    const slot = ollamaStorySlot(100_000);
    const mgr = new StoryProviderManager({
      slots: [slot],
      freeOnly: false,
    });

    const promise = mgr.generateStory(prompt);
    await vi.advanceTimersByTimeAsync(100_000);
    await promise;

    const attemptLog = findLog(logMock.info.mock.calls, "provider attempt");
    expect(attemptLog!.timeoutMs).toBe(900_000);
    expect(attemptLog!.timeoutMs).not.toBe(240_000);
    expect(attemptLog!.timeoutMs).not.toBe(300_000);

    const startLog = findLog(logMock.info.mock.calls, "generation started");
    expect(startLog!.sequenceMs).toBe(900_000);
  });

  it("respects a custom OLLAMA_STORY_TIMEOUT_MS value", async () => {
    const slot = ollamaStorySlot(100_000, 1_200_000);
    const mgr = new StoryProviderManager({
      slots: [slot],
      freeOnly: false,
    });

    const promise = mgr.generateStory(prompt);
    await vi.advanceTimersByTimeAsync(100_000);
    await promise;

    const attemptLog = findLog(logMock.info.mock.calls, "provider attempt");
    expect(attemptLog!.timeoutMs).toBe(1_200_000);
  });
});

describe("Story Draft timeout: ordinary tasks retain 240s", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeAbortTimeout();
    logMock.info.mockClear();
    logMock.error.mockClear();
  });

  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it("character extraction uses the ordinary 240s timeout, not the story timeout", async () => {
    const slot: ProviderSlot = {
      id: "ollama",
      model: "qwen3:4b",
      configured: true,
      supported: true,
      timeoutMs: DEFAULT_OLLAMA_TIMEOUT_MS,
      storyTimeoutMs: DEFAULT_OLLAMA_STORY_TIMEOUT_MS,
      async generate(_input: StoryPrompt, options: { signal: AbortSignal }) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({ story: sampleStory });
          }, 50_000);
          options.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new JobError("aborted", "timeout", true));
          });
        });
      },
      async generateCharacters() {
        return { characters: [], usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };

    const mgr = new StoryProviderManager({
      slots: [slot],
      freeOnly: false,
    });

    const input = {
      title: sampleStory.title,
      screenplay: sampleStory.screenplay,
    };

    const promise = mgr.generateCharacters(input);
    await vi.advanceTimersByTimeAsync(50_000);
    await promise;

    const attemptLog = findLog(logMock.info.mock.calls, "provider attempt");
    expect(attemptLog).toBeDefined();
    expect(attemptLog!.timeoutMs).toBe(DEFAULT_OLLAMA_TIMEOUT_MS);
    expect(attemptLog!.task).toBe("characters");
  });
});

describe("Story Draft timeout: cloud providers unchanged", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeAbortTimeout();
    logMock.info.mockClear();
    logMock.error.mockClear();
  });

  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it("cloud providers use providerTimeoutMs for story tasks, not the story timeout", async () => {
    const slot = cloudSlot("groq", 30_000, 90_000);
    const mgr = new StoryProviderManager({
      slots: [slot],
      freeOnly: false,
      providerTimeoutMs: 90_000,
    });

    const promise = mgr.generateStory(prompt);
    await vi.advanceTimersByTimeAsync(30_000);
    await promise;

    const attemptLog = findLog(logMock.info.mock.calls, "provider attempt");
    expect(attemptLog).toBeDefined();
    expect(attemptLog!.timeoutMs).toBe(90_000);
    expect(attemptLog!.provider).toBe("groq");
  });
});

describe("Story Draft timeout: parent cancellation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeAbortTimeout();
    logMock.info.mockClear();
    logMock.error.mockClear();
  });

  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it("a parent signal aborts the story request before the 900s budget", async () => {
    const slot = ollamaStorySlot(1_000_000);
    const mgr = new StoryProviderManager({
      slots: [slot],
      freeOnly: false,
    });

    const parentController = new AbortController();
    const promise = mgr.generateStory(prompt, { signal: parentController.signal });
    const caught = promise.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(10_000);
    parentController.abort();
    await vi.advanceTimersByTimeAsync(1);

    const error = await caught;
    expect(error).toBeInstanceOf(JobError);
  });
});

describe("Story Draft timeout: ASPO failover on timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeAbortTimeout();
    logMock.info.mockClear();
    logMock.error.mockClear();
  });

  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it("records a retryable timeout when Ollama story times out", async () => {
    const slowOllama = ollamaStorySlot(1_000_000);
    const mgr = new StoryProviderManager({
      slots: [slowOllama],
      freeOnly: false,
    });

    const promise = mgr.generateStory(prompt);
    const caught = promise.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(900_001);

    const error = await caught;
    expect(error).toBeInstanceOf(JobError);
    expect((error as JobError).code).toBe("timeout");
    expect((error as JobError).retryable).toBe(true);
  });

  it("fails over from a timed-out Ollama to a succeeding cloud provider", async () => {
    const slowOllama = ollamaStorySlot(1_000_000);
    const fastCloud = cloudSlot("groq", 30_000, 90_000);

    const mgr = new StoryProviderManager({
      slots: [fastCloud, slowOllama],
      freeOnly: false,
      providerTimeoutMs: 90_000,
    });

    const promise = mgr.generateStory(prompt);
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await promise;

    expect(result.provider).toBe("groq");
  });
});