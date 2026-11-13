import { describe, expect, it } from "vitest";
import {
  minimumScenesForDuration,
  stageCompletionBudget,
  storyCompletionBudget,
  storySceneRange,
} from "@/lib/providers/llm/budget";
import { StoryProviderManager, type ProviderSlot } from "@/lib/providers/llm/manager";
import { MAX_CONTINUATION_ROUNDS, mergeScreenplays, requestStoryContinuation } from "@/lib/providers/llm/continuation";
import { parseStory } from "@/lib/providers/llm/parse";
import { sceneCountGuidance, storySystemPrompt, storyUserPrompt } from "@/lib/providers/llm/prompt";
import { assertScenes, assertScreenplayPacing, type StageTransport } from "@/lib/providers/llm/stageTasks";
import { GeminiLLMProvider } from "@/lib/providers/llm/gemini";
import type { LlmClient, LlmCompletionRequest, StoryPrompt } from "@/lib/providers/llm/types";
import type { ProductionScene } from "@/lib/validation/productionStages";
import type { GeneratedStory, ScreenplayScene } from "@/lib/validation/story";

function screenplay(count: number): ScreenplayScene[] {
  return Array.from({ length: count }, (_, index) => ({
    sceneNumber: index + 1,
    heading: `INT. ROOM ${index + 1} - DAY`,
    location: `Room ${index + 1}`,
    timeOfDay: "Day",
    charactersPresent: ["Ada"],
    visualDescription: `The camera holds room ${index + 1}.`,
    action: `Ada changes the situation in room ${index + 1}.`,
    dialogue: [{ characterName: "Ada", line: `This is line ${index + 1}.` }],
  }));
}

function moreScenes(from: number, count: number): ScreenplayScene[] {
  return Array.from({ length: count }, (_, index) => {
    const number = from + index + 1;
    return {
      sceneNumber: number,
      heading: `INT. ROOM ${number} - DAY`,
      location: `Room ${number}`,
      timeOfDay: "Day",
      charactersPresent: ["Ada"],
      visualDescription: `The camera holds room ${number}.`,
      action: `Ada changes the situation in room ${number}.`,
      dialogue: [{ characterName: "Ada", line: `This is line ${number}.` }],
    };
  });
}

function story(sceneCount: number): GeneratedStory {
  return {
    title: "The last lantern keeper",
    synopsis: "A keeper fights to keep the village lantern lit through a single night.",
    structure: {
      act1: {
        introduction: "The village at dusk.",
        mainCharacters: "Elias the keeper and the villagers.",
        setting: "A hillside village above the sea.",
        initialSituation: "The lantern is failing.",
        incitingIncident: "The flame gutters.",
      },
      act2: {
        risingTension: "The villagers suspect Elias.",
        obstacles: "The oil is gone.",
        characterDecisions: "Elias climbs the tower alone.",
        turningPoint: "He learns who cut the fuel line.",
      },
      act3: {
        climax: "He relights the lantern as the storm breaks.",
        resolution: "The villagers see the light and return.",
        finalOutcome: "Elias keeps the watch.",
      },
    },
    screenplay: screenplay(sceneCount),
  };
}

const prompt: StoryPrompt = {
  title: "The last lantern keeper",
  idea: "A keeper keeps a village lantern lit.",
  genre: "drama",
  language: "en",
  visualStyle: "realistic",
  tone: "tense",
  targetDurationSeconds: 300,
  aspectRatio: "16:9",
};

function slot(id: string, generate: ProviderSlot["generate"]): ProviderSlot {
  return { id, model: `${id}-model`, configured: true, supported: true, generate };
}

describe("duration-scaled output budgets", () => {
  it("grows the screenplay budget with the requested duration", () => {
    const short = storyCompletionBudget(60);
    const long = storyCompletionBudget(900);
    expect(long).toBeGreaterThan(short);
    expect(short).toBeGreaterThanOrEqual(8_000);
    expect(long).toBeLessThanOrEqual(32_000);
  });

  it("never asks a provider for one scene on a multi-minute episode", () => {
    expect(storySceneRange(60).min).toBe(1);
    expect(storySceneRange(300).min).toBeGreaterThanOrEqual(3);
    expect(minimumScenesForDuration(600)).toBeGreaterThanOrEqual(5);
  });

  it("sizes a stage budget to the length of the screenplay it must transcribe", () => {
    expect(stageCompletionBudget(20)).toBeGreaterThan(stageCompletionBudget(1));
    expect(stageCompletionBudget(0)).toBeGreaterThanOrEqual(8_000);
  });
});

describe("screenplay completeness prompts", () => {
  it("requires several scenes and honours the Story Bible context", () => {
    const text = storyUserPrompt({
      ...prompt,
      continuityContext: "World rules: the lantern must never go out. Canon: Elias lost his brother at sea.",
    });
    expect(text).toContain(sceneCountGuidance(300));
    expect(text).toContain("Write 5–9 screenplay scenes");
    expect(text).toContain("the lantern must never go out");
    expect(text).toContain("Elias lost his brother at sea");
    expect(text).toContain("Distribute scenes across all three acts");
  });

  it("asks for a fully developed episode rather than an opening fragment", () => {
    const system = storySystemPrompt();
    expect(system).toContain("compelling opening");
    expect(system).toContain("developed climax");
    expect(system).toContain("resolution or deliberate cliffhanger");
  });
});

describe("truncated screenplay detection", () => {
  it("rejects a screenplay whose trailing scenes arrived empty", () => {
    const payload = {
      ...story(1),
      screenplay: [...screenplay(1), {}, {}],
    };
    expect(() => parseStory("Groq", JSON.stringify(payload))).toThrowError(
      /returned a screenplay with 3 scenes but only 1 were complete/
    );
    try {
      parseStory("Groq", JSON.stringify(payload));
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_schema", retryable: false });
    }
  });

  it("accepts a complete multi-scene screenplay", () => {
    const parsed = parseStory("Groq", JSON.stringify(story(5)));
    expect(parsed.screenplay).toHaveLength(5);
    expect(parsed.screenplay.map((scene) => scene.sceneNumber)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("screenplay pacing", () => {
  it("rejects a one-scene screenplay for a five-minute episode", () => {
    expect(() => assertScreenplayPacing(300, screenplay(1))).toThrowError(/generation is incomplete/);
  });

  it("accepts a screenplay that meets the duration minimum", () => {
    expect(() => assertScreenplayPacing(300, screenplay(5))).not.toThrow();
    expect(() => assertScreenplayPacing(60, screenplay(1))).not.toThrow();
  });

  it("fails over to the next provider instead of saving an incomplete episode", async () => {
    const result = await new StoryProviderManager({
      slots: [
        slot("groq", async () => ({ story: story(1) })),
        slot("openrouter", async () => ({ story: story(5) })),
      ],
      sequenceTimeoutMs: 5_000,
      providerTimeoutMs: 1_000,
    }).generateStory(prompt);
    expect(result.provider).toBe("openrouter");
    expect(result.fallbackFrom).toBe("groq");
    expect(result.screenplay).toHaveLength(5);
    expect(result.attempts?.[0]).toMatchObject({ provider: "groq", success: false, category: "invalid_schema" });
  });
});

describe("screenplay continuation", () => {
  it("asks the same provider to keep writing until the episode reaches its floor", async () => {
    const rounds: number[] = [];
    const provider = new StoryProviderManager({
      slots: [
        {
          id: "groq",
          model: "groq-model",
          configured: true,
          supported: true,
          async generate() {
            return { story: story(1), truncated: true };
          },
          async continueStory(_input, current) {
            rounds.push(current.length);
            return { screenplay: moreScenes(current.length, 2), truncated: false };
          },
        },
      ],
      sequenceTimeoutMs: 5_000,
      providerTimeoutMs: 1_000,
    });
    const result = await provider.generateStory(prompt);
    expect(result.screenplay.map((scene) => scene.sceneNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(rounds).toEqual([1, 3]);
  });

  it("never asks for a continuation once the screenplay already meets the floor", async () => {
    let calls = 0;
    const provider = new StoryProviderManager({
      slots: [
        {
          id: "groq",
          model: "groq-model",
          configured: true,
          supported: true,
          async generate() {
            return { story: story(5) };
          },
          async continueStory(_input, current) {
            calls += 1;
            return { screenplay: moreScenes(current.length, 2) };
          },
        },
      ],
      sequenceTimeoutMs: 5_000,
      providerTimeoutMs: 1_000,
    });
    const result = await provider.generateStory(prompt);
    expect(result.screenplay).toHaveLength(5);
    expect(calls).toBe(0);
  });

  it("bounds continuation rounds when a provider keeps reporting truncation", async () => {
    let calls = 0;
    const provider = new StoryProviderManager({
      slots: [
        {
          id: "groq",
          model: "groq-model",
          configured: true,
          supported: true,
          async generate() {
            return { story: story(1), truncated: true };
          },
          async continueStory(_input, current) {
            calls += 1;
            return { screenplay: moreScenes(current.length, 1), truncated: true };
          },
        },
      ],
      sequenceTimeoutMs: 5_000,
      providerTimeoutMs: 1_000,
    });
    const result = await provider.generateStory(prompt);
    expect(result.screenplay).toHaveLength(5);
    expect(calls).toBe(MAX_CONTINUATION_ROUNDS);
  });

  it("fails instead of saving a fragment when no continuation is possible", async () => {
    const provider = new StoryProviderManager({
      slots: [
        {
          id: "groq",
          model: "groq-model",
          configured: true,
          supported: true,
          async generate() {
            return { story: story(1), truncated: true };
          },
          async continueStory() {
            return { screenplay: [], truncated: true };
          },
        },
      ],
      sequenceTimeoutMs: 5_000,
      providerTimeoutMs: 1_000,
    });
    await expect(provider.generateStory(prompt)).rejects.toMatchObject({ code: "invalid_schema" });
  });
});

describe("screenplay continuation merge", () => {
  it("keeps written scenes, drops repeats, and renumbers the result", () => {
    const merged = mergeScreenplays(screenplay(2), [...screenplay(2), ...moreScenes(2, 1)]);
    expect(merged.map((scene) => scene.sceneNumber)).toEqual([1, 2, 3]);
    expect(merged[2]?.heading).toBe("INT. ROOM 3 - DAY");
  });
});

describe("continuation truncation signal", () => {
  const transport = (response: () => { text: string; truncated?: boolean }): StageTransport => ({
    label: "Test",
    async request() {
      return response();
    },
  });

  it("flags a continuation the provider reported as cut short", async () => {
    const result = await requestStoryContinuation(
      transport(() => ({ text: JSON.stringify({ screenplay: moreScenes(0, 2) }), truncated: true })),
      prompt,
      screenplay(2)
    );
    expect(result.truncated).toBe(true);
    expect(result.screenplay).toHaveLength(2);
  });

  it("flags a continuation whose declared scenes outnumber the complete ones", async () => {
    const result = await requestStoryContinuation(
      transport(() => ({ text: JSON.stringify({ screenplay: [...moreScenes(0, 2), {}, {}] }) })),
      prompt,
      screenplay(2)
    );
    expect(result.truncated).toBe(true);
    expect(result.screenplay).toHaveLength(2);
  });

  it("leaves a clean, complete continuation unflagged", async () => {
    const result = await requestStoryContinuation(
      transport(() => ({ text: JSON.stringify({ screenplay: moreScenes(0, 2) }) })),
      prompt,
      screenplay(2)
    );
    expect(result.truncated).toBe(false);
    expect(result.screenplay).toHaveLength(2);
  });
});

describe("screenplay to scene breakdown consistency", () => {
  const breakdown = (sceneNumbers: number[]): ProductionScene[] =>
    sceneNumbers.map((sceneNumber) => ({
      sceneNumber,
      title: `Scene ${sceneNumber}`,
      location: `Room ${sceneNumber}`,
      interiorExterior: "interior" as const,
      timeOfDay: "Day",
      charactersPresent: ["Ada"],
      visualDescription: "A room.",
      action: "Ada acts.",
      dialogue: [{ characterName: "Ada", line: "Hello." }],
      cameraDirection: "",
      estimatedDurationSeconds: null,
    }));

  const input = { title: "The last lantern keeper", screenplay: screenplay(3), characterNames: ["Ada"], targetDurationSeconds: 300 };

  it("keeps every screenplay scene in order", () => {
    expect(() => assertScenes(input, breakdown([1, 2, 3]))).not.toThrow();
  });

  it("refuses a breakdown that silently drops a screenplay scene", () => {
    expect(() => assertScenes(input, breakdown([1, 2]))).toThrowError(/does not keep the approved scene numbers/);
  });

  it("refuses a breakdown that adds a scene absent from the screenplay", () => {
    expect(() => assertScenes(input, breakdown([1, 2, 3, 4]))).toThrowError(/does not keep the approved scene numbers/);
  });
});

describe("provider output budgets", () => {
  it("asks Gemini for a duration-scaled screenplay budget", async () => {
    const calls: LlmCompletionRequest[] = [];
    const client: LlmClient = {
      async complete(input) {
        calls.push(input);
        return { text: JSON.stringify(story(3)) };
      },
    };
    const provider = new GeminiLLMProvider({ model: "gemini-flash-latest", apiKey: "test-key", client });
    await provider.generateStory(prompt);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.maxOutputTokens).toBe(storyCompletionBudget(300));
  });
});
