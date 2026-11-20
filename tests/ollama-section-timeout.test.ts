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
import type { StoryBibleTaskInput, StoryBibleTaskResult } from "@/lib/providers/llm/storyBibleTask";
import type { StoryPrompt, TokenUsage } from "@/lib/providers/llm/types";
import type { GeneratedStory } from "@/lib/validation/story";

const validIdentity = {
  title: "The Closed Gate",
  genres: ["Drama"],
  subgenres: ["Family Drama"],
  centralPremise: "A daughter returns home after years of estrangement.",
  narrativeConcept: "A single night of confrontation at the family threshold.",
  toneAndAtmosphere: "Quiet and tense",
  targetAudience: "Adult drama audience",
  centralConflict: "Trust between father and daughter",
};

function findLog(
  calls: ReturnType<typeof vi.fn>["mock"]["calls"],
  message: string
): Record<string, unknown> | undefined {
  const call = calls.find((c) => c[1] === message);
  return call?.[2] as Record<string, unknown> | undefined;
}

function ollamaSlot(
  responseMs: number,
  sectionTimeoutMs: number = 600_000,
  timeoutMs: number = 240_000
): ProviderSlot {
  return {
    id: "ollama",
    model: "qwen3:4b",
    configured: true,
    supported: true,
    timeoutMs,
    sectionTimeoutMs,
    async generate(_input: StoryPrompt, _options: { signal: AbortSignal }): Promise<{ story: GeneratedStory; usage?: TokenUsage }> {
      throw new Error("not implemented");
    },
    async generateStoryBible(
      input: StoryBibleTaskInput,
      options: { signal: AbortSignal }
    ): Promise<{ result: StoryBibleTaskResult; usage?: TokenUsage }> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (options.signal.aborted) {
            reject(new JobError("The signal aborted before the response completed.", "timeout", true));
            return;
          }
          resolve({
            result: { mode: "section", section: input.section!, value: validIdentity },
            usage: { inputTokens: 100, outputTokens: 200 },
          });
        }, responseMs);
        options.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new JobError("The signal aborted before the response completed.", "timeout", true));
        });
      });
    },
  };
}

const sectionInput: StoryBibleTaskInput = {
  mode: "section",
  section: "identity",
  idea: "A daughter returns home.",
};

describe("Phase 2 correction: Ollama section timeout through manager", () => {
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

  it("logs timeoutMs=600000 for an eligible section request", async () => {

    const slot = ollamaSlot(100_000);
    const mgr = new StoryProviderManager({
      slots: [slot],
      sequenceTimeoutMs: 900_000,
      freeOnly: false,
    });

    const promise = mgr.generateStoryBible(sectionInput);
    await vi.advanceTimersByTimeAsync(100_000);
    await promise;

    const attemptLog = findLog(logMock.info.mock.calls, "provider attempt");
    expect(attemptLog).toBeDefined();
    expect(attemptLog!.timeoutMs).toBe(600_000);
    expect(attemptLog!.provider).toBe("ollama");
  });

  it("a 385-second section call succeeds within the 600s budget", async () => {

    const slot = ollamaSlot(385_000);
    const mgr = new StoryProviderManager({
      slots: [slot],
      sequenceTimeoutMs: 900_000,
      freeOnly: false,
    });

    const promise = mgr.generateStoryBible(sectionInput);
    await vi.advanceTimersByTimeAsync(385_000);
    const result = await promise;

    expect(result.provider).toBe("ollama");
    expect(result.result.mode).toBe("section");
  });

  it("a call exceeding the 600s budget fails with timeout", async () => {
    const slot = ollamaSlot(700_000);
    const mgr = new StoryProviderManager({
      slots: [slot],
      sequenceTimeoutMs: 900_000,
      freeOnly: false,
    });

    const promise = mgr.generateStoryBible(sectionInput);
    const caught = promise.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(600_001);

    expect(await caught).toMatchObject({ code: "timeout" });
  });


  it("non-section Ollama calls retain the 240s timeout", async () => {

    const slot = ollamaSlot(100_000);
    const mgr = new StoryProviderManager({
      slots: [slot],
      sequenceTimeoutMs: 900_000,
      freeOnly: false,
    });

    const fullBibleInput: StoryBibleTaskInput = {
      mode: "generate",
      idea: "A daughter returns home.",
    };

    const promise = mgr.generateStoryBible(fullBibleInput);
    const caught = promise.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100_000);
    await caught;

    const attemptLog = findLog(logMock.info.mock.calls, "provider attempt");
    expect(attemptLog).toBeDefined();
    expect(attemptLog!.timeoutMs).toBe(240_000);
  });

  it("cloud providers keep the default provider timeout for section calls", async () => {

    const cloudSlot: ProviderSlot = {
      id: "groq",
      model: "groq-model",
      configured: true,
      supported: true,
      async generate(_input: StoryPrompt, _options: { signal: AbortSignal }) {
        throw new Error("not implemented");
      },
      async generateStoryBible(input: StoryBibleTaskInput, options: { signal: AbortSignal }) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({
              result: { mode: "section", section: input.section!, value: validIdentity },
              usage: { inputTokens: 50, outputTokens: 100 },
            });
          }, 30_000);
          options.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new JobError("aborted", "timeout", true));
          });
        });
      },
    };

    const mgr = new StoryProviderManager({
      slots: [cloudSlot],
      sequenceTimeoutMs: 900_000,
      providerTimeoutMs: 90_000,
      freeOnly: false,
    });

    const promise = mgr.generateStoryBible(sectionInput);
    await vi.advanceTimersByTimeAsync(30_000);
    await promise;

    const attemptLog = findLog(logMock.info.mock.calls, "provider attempt");
    expect(attemptLog).toBeDefined();
    expect(attemptLog!.timeoutMs).toBe(90_000);
  });
});