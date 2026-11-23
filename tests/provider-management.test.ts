import { describe, expect, it, vi } from "vitest";
import { classifyProviderError } from "@/lib/providers/llm/errors";
import { StoryProviderManager, ProviderHealthTracker, type ProviderSlot } from "@/lib/providers/llm/manager";
import { LLM_PROVIDER_IDS, providerSequence, buildSlots } from "@/lib/providers/llm/registry";

import { PAID_PROVIDER_IDS } from "@/lib/providers/llm/freePolicy";
import { ollamaTimeoutMs, ollamaSectionTimeoutMs } from "@/lib/providers/llm/ollama";
import type { StoryPrompt } from "@/lib/providers/llm/types";
import type { GeneratedStory } from "@/lib/validation/story";

const prompt: StoryPrompt = {
  title: "Test",
  idea: "A test story.",
  genre: "family",
  language: "en",
  visualStyle: "realistic",
  tone: "quiet",
  targetDurationSeconds: 60,
  aspectRatio: "16:9",
};

const sample: GeneratedStory = {
  title: "Test",
  synopsis: "A test.",
  structure: {
    act1: { introduction: "Start.", mainCharacters: "A.", setting: "Here.", initialSituation: "Before.", incitingIncident: "Something." },
    act2: { risingTension: "Tension.", obstacles: "Obstacles.", characterDecisions: "Decide.", turningPoint: "Turn." },
    act3: { climax: "Climax.", resolution: "Resolve.", finalOutcome: "Done." },
  },
  screenplay: [
    { sceneNumber: 1, heading: "INT. ROOM - DAY", location: "Room", timeOfDay: "Day", charactersPresent: ["A"], visualDescription: "A room.", action: "Action.", dialogue: [{ characterName: "A", line: "Hi." }] },
  ],
};

function slot(id: string, generate: ProviderSlot["generate"], options: { configured?: boolean; supported?: boolean; model?: string } = {}): ProviderSlot {
  return { id, model: options.model ?? `${id}-model`, configured: options.configured ?? true, supported: options.supported ?? true, generate };
}

function manager(slots: ProviderSlot[], opts: { healthTracker?: ProviderHealthTracker } = {}) {
  return new StoryProviderManager({
    slots,
    sequenceTimeoutMs: 5_000,
    providerTimeoutMs: 2_000,
    healthTracker: opts.healthTracker,
  });
}

describe("provider management: Kimi/Moonshot adapter", () => {
  it("registers kimi in LLM_PROVIDER_IDS", () => {
    expect(LLM_PROVIDER_IDS).toContain("kimi");
  });

  it("marks kimi as a paid provider", () => {
    expect(PAID_PROVIDER_IDS).toContain("kimi");
  });

  it("blocks kimi in free-only mode", () => {
    const env = { NODE_ENV: "test", LLM_FREE_ONLY: "true", KIMI_API_KEY: "test-key" } as NodeJS.ProcessEnv;
    const slots = buildSlots(env);
    const kimiSlot = slots.find((s) => s.id === "kimi");
    expect(kimiSlot?.supported).toBe(false);
  });

  it("allows kimi when paid mode is enabled", () => {
    const env = { NODE_ENV: "test", LLM_FREE_ONLY: "false", LLM_PAID_ENABLED: "true", KIMI_API_KEY: "test-key" } as NodeJS.ProcessEnv;
    const slots = buildSlots(env);
    const kimiSlot = slots.find((s) => s.id === "kimi");
    expect(kimiSlot?.supported).not.toBe(false);
    expect(kimiSlot?.configured).toBe(true);
  });
});

describe("provider management: priority ordering", () => {
  it("defaults to gemini as primary when LLM_PROVIDER is not set", () => {
    const seq = providerSequence({});
    expect(seq[0]).toBe("gemini");
  });

  it("places ollama last in the default fallback sequence", () => {
    const seq = providerSequence({});
    expect(seq[seq.length - 1]).toBe("ollama");
  });

});

describe("provider management: HTTP 413 classification", () => {
  it("classifies plain 413 as prompt_too_large (not retryable)", () => {
    const error = classifyProviderError("Groq", { status: 413, message: "request entity too large" });
    expect(error.code).toBe("prompt_too_large");
    expect(error.retryable).toBe(false);
  });

  it("classifies 413 with 'tokens per minute' as rate_limited", () => {
    const error = Object.assign(new Error("tokens per minute (TPM) exceeded"), { status: 413 });
    const classified = classifyProviderError("Groq", error);
    expect(classified.code).toBe("rate_limited");
    expect(classified.retryable).toBe(true);
  });


  it("fails over on prompt_too_large to a provider with a larger context", async () => {
    const result = await manager([
      slot("groq", async () => {
        throw classifyProviderError("Groq", { status: 413, message: "request entity too large" });
      }),
      slot("openrouter", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("openrouter");
    expect(result.attempts?.[0]?.category).toBe("prompt_too_large");
  });
});

describe("provider management: retry pass respects cooldowns", () => {
  it("does not bypass circuit breaker during retry pass", async () => {
    const groqAttempts = vi.fn(async () => {
      throw classifyProviderError("Groq", { status: 429, message: "rate limited" });
    });
    const ollamaAttempts = vi.fn(async () => ({ story: sample }));
    const tracker = new ProviderHealthTracker();
    const result = await manager(
      [
        slot("groq", groqAttempts),
        slot("ollama", ollamaAttempts),
      ],
      { healthTracker: tracker }
    ).generateStory(prompt);
    expect(result.provider).toBe("ollama");
    // groq should be called exactly once (first pass), not again during retry pass
    expect(groqAttempts).toHaveBeenCalledTimes(1);
  });

});

describe("provider management: Ollama slot timeout", () => {
  it("uses ollamaTimeoutMs for the slot, not Math.max with section timeout", () => {
    const env = { NODE_ENV: "test", OLLAMA_TIMEOUT_MS: "60000", OLLAMA_SECTION_TIMEOUT_MS: "300000" } as NodeJS.ProcessEnv;
    const slots = buildSlots({ ...env, LLM_FREE_ONLY: "true" } as NodeJS.ProcessEnv);
    const ollamaSlot = slots.find((s) => s.id === "ollama");
    expect(ollamaSlot?.timeoutMs).toBe(60_000);
  });

  it("does not inflate ordinary task timeout to the section timeout", () => {
    const defaultTimeout = ollamaTimeoutMs();
    const sectionTimeout = ollamaSectionTimeoutMs();
    expect(sectionTimeout).toBeGreaterThan(defaultTimeout);
    const slots = buildSlots({ NODE_ENV: "test", LLM_FREE_ONLY: "true" } as NodeJS.ProcessEnv);
    const ollamaSlot = slots.find((s) => s.id === "ollama");
    expect(ollamaSlot?.timeoutMs).toBe(defaultTimeout);
    expect(ollamaSlot?.timeoutMs).not.toBe(sectionTimeout);
  });
});