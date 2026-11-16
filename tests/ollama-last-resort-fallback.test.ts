import { describe, expect, it, vi } from "vitest";

import { classifyProviderError } from "@/lib/providers/llm/errors";
import { StoryProviderManager, ProviderHealthTracker, type ProviderSlot } from "@/lib/providers/llm/manager";
import type { StoryPrompt } from "@/lib/providers/llm/types";
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

function slot(
  id: string,
  generate: ProviderSlot["generate"],
  options: { configured?: boolean; supported?: boolean; model?: string } = {}
): ProviderSlot {
  return {
    id,
    model: options.model ?? `${id}-model`,
    configured: options.configured ?? true,
    supported: options.supported ?? true,
    generate,
  };
}

function manager(
  slots: ProviderSlot[],
  timeouts: { sequenceTimeoutMs?: number; providerTimeoutMs?: number; healthTracker?: ProviderHealthTracker } = {}
) {
  return new StoryProviderManager({
    slots,
    sequenceTimeoutMs: 10_000,
    providerTimeoutMs: 5_000,
    healthTracker: timeouts.healthTracker,
    ...timeouts,
  });
}

function failingGenerate(providerLabel: string, status = 503) {
  return async () => {
    throw classifyProviderError(providerLabel, { status, message: "unavailable" });
  };
}

describe("Ollama last-resort fallback", () => {
  it("retries non-Ollama providers twice before calling Ollama", async () => {
    const groq = vi.fn(failingGenerate("Groq"));
    const openrouter = vi.fn(failingGenerate("OpenRouter"));
    const ollama = vi.fn(async () => ({ story: sample }));

    const result = await manager([
      slot("groq", groq),
      slot("openrouter", openrouter),
      slot("ollama", ollama),
    ]).generateStory(prompt);

    expect(result.provider).toBe("ollama");
    expect(groq).toHaveBeenCalledTimes(2);
    expect(openrouter).toHaveBeenCalledTimes(2);
    expect(ollama).toHaveBeenCalledTimes(1);
  });

  it("succeeds on the retry pass without calling Ollama", async () => {
    let groqCalls = 0;
    const groq = vi.fn(async () => {
      groqCalls += 1;
      if (groqCalls === 1) throw classifyProviderError("Groq", { status: 503, message: "unavailable" });
      return { story: { ...sample, title: "Groq recovered" } };
    });
    const openrouter = vi.fn(failingGenerate("OpenRouter"));
    const ollama = vi.fn(async () => ({ story: sample }));

    const result = await manager([
      slot("groq", groq),
      slot("openrouter", openrouter),
      slot("ollama", ollama),
    ]).generateStory(prompt);

    expect(result.provider).toBe("groq");
    expect(result.title).toBe("Groq recovered");
    expect(groq).toHaveBeenCalledTimes(2);
    expect(openrouter).toHaveBeenCalledTimes(1);
    expect(ollama).not.toHaveBeenCalled();
  });

  it("does not retry non-Ollama providers when Ollama is absent", async () => {
    const groq = vi.fn(failingGenerate("Groq"));
    const openrouter = vi.fn(async () => ({ story: sample }));

    const result = await manager([
      slot("groq", groq),
      slot("openrouter", openrouter),
    ]).generateStory(prompt);

    expect(result.provider).toBe("openrouter");
    expect(groq).toHaveBeenCalledTimes(1);
    expect(openrouter).toHaveBeenCalledTimes(1);
  });

  it("succeeds on first pass without entering retry pass or Ollama", async () => {
    const groq = vi.fn(async () => ({ story: sample }));
    const openrouter = vi.fn();
    const ollama = vi.fn();

    const result = await manager([
      slot("groq", groq),
      slot("openrouter", openrouter),
      slot("ollama", ollama),
    ]).generateStory(prompt);

    expect(result.provider).toBe("groq");
    expect(groq).toHaveBeenCalledTimes(1);
    expect(openrouter).not.toHaveBeenCalled();
    expect(ollama).not.toHaveBeenCalled();
  });

  it("retry pass bypasses health tracker circuit breaker", async () => {
    const healthTracker = new ProviderHealthTracker();
    let groqCalls = 0;
    const groq = vi.fn(async () => {
      groqCalls += 1;
      if (groqCalls === 1) throw classifyProviderError("Groq", { status: 503, message: "unavailable" });
      return { story: { ...sample, title: "Groq recovered on retry" } };
    });
    const ollama = vi.fn(async () => ({ story: sample }));

    const result = await manager(
      [
        slot("groq", groq),
        slot("ollama", ollama),
      ],
      { healthTracker }
    ).generateStory(prompt);

    expect(result.provider).toBe("groq");
    expect(result.title).toBe("Groq recovered on retry");
    expect(groq).toHaveBeenCalledTimes(2);
    expect(ollama).not.toHaveBeenCalled();
  });

  it("throws when all providers fail including Ollama on both passes", async () => {
    const groq = vi.fn(failingGenerate("Groq"));
    const openrouter = vi.fn(failingGenerate("OpenRouter"));
    const ollama = vi.fn(failingGenerate("Ollama", 502));

    await expect(
      manager([
        slot("groq", groq),
        slot("openrouter", openrouter),
        slot("ollama", ollama),
      ]).generateStory(prompt)
    ).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });

    expect(groq).toHaveBeenCalledTimes(2);
    expect(openrouter).toHaveBeenCalledTimes(2);
    expect(ollama).toHaveBeenCalledTimes(1);
  });

  it("does not apply retry logic when only Ollama is configured", async () => {
    const ollama = vi.fn(async () => ({ story: sample }));

    const result = await manager([
      slot("ollama", ollama),
    ]).generateStory(prompt);

    expect(result.provider).toBe("ollama");
    expect(ollama).toHaveBeenCalledTimes(1);
  });

  it("preserves Ollama result metadata when used as last resort", async () => {
    const groq = vi.fn(failingGenerate("Groq"));
    const ollama = vi.fn(async () => ({
      story: { ...sample, title: "Ollama story" },
      usage: { inputTokens: 42, outputTokens: 99 },
    }));

    const result = await manager([
      slot("groq", groq),
      slot("ollama", ollama),
    ]).generateStory(prompt);

    expect(result.provider).toBe("ollama");
    expect(result.title).toBe("Ollama story");
    expect(result.fallbackFrom).toBe("groq");
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 99 });
    expect(groq).toHaveBeenCalledTimes(2);
    expect(ollama).toHaveBeenCalledTimes(1);
  });

  it("records all attempts across both passes and Ollama", async () => {
    const groq = vi.fn(failingGenerate("Groq"));
    const openrouter = vi.fn(failingGenerate("OpenRouter"));
    const ollama = vi.fn(async () => ({ story: sample }));

    const result = await manager([
      slot("groq", groq),
      slot("openrouter", openrouter),
      slot("ollama", ollama),
    ]).generateStory(prompt);

    const failedAttempts = result.attempts?.filter((a) => !a.success) ?? [];
    const successAttempts = result.attempts?.filter((a) => a.success) ?? [];

    expect(failedAttempts).toHaveLength(4);
    expect(successAttempts).toHaveLength(1);
    expect(successAttempts[0]?.provider).toBe("ollama");
    expect(failedAttempts.map((a) => a.provider)).toEqual([
      "groq", "openrouter", "groq", "openrouter",
    ]);
  });

  it("stops immediately on a non-retryable error without retry pass", async () => {
    const groq = vi.fn(async () => {
      throw classifyProviderError("Groq", { status: 401, message: "bad credentials" });
    });
    const openrouter = vi.fn();
    const ollama = vi.fn();

    await expect(
      manager([
        slot("groq", groq),
        slot("openrouter", openrouter),
        slot("ollama", ollama),
      ]).generateStory(prompt)
    ).rejects.toMatchObject({ code: "authentication", retryable: false });

    expect(groq).toHaveBeenCalledTimes(1);
    expect(openrouter).not.toHaveBeenCalled();
    expect(ollama).not.toHaveBeenCalled();
  });

  it("skips unconfigured non-Ollama providers on both passes but still tries Ollama", async () => {
    const groq = vi.fn(failingGenerate("Groq"));
    const openrouter = vi.fn();
    const ollama = vi.fn(async () => ({ story: sample }));

    const result = await manager([
      slot("groq", groq),
      slot("openrouter", openrouter, { configured: false }),
      slot("ollama", ollama),
    ]).generateStory(prompt);

    expect(result.provider).toBe("ollama");
    expect(groq).toHaveBeenCalledTimes(2);
    expect(openrouter).not.toHaveBeenCalled();
    expect(ollama).toHaveBeenCalledTimes(1);
  });
});