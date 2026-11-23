import { describe, expect, it, vi } from "vitest";
import { JobError } from "@/lib/pipeline/types";
import type { LLMProvider, StoryModelResult, StoryPrompt } from "@/lib/providers/llm/types";
import type { GeneratedStory } from "@/lib/validation/story";
import {
  STORY_DRAFT_PARTS,
  STORY_DRAFT_PART_LABELS,
  generateStoryDraftParts,
  parseStoryDraftPartsState,
  progressMessage,
  storyDraftPartsFingerprint,
  type StoryDraftPart,
  type StoryDraftPartsState,
} from "@/lib/providers/llm/storyDraftParts";

const basePrompt: StoryPrompt = {
  title: "The Inheritance",
  idea: "Two sisters uncover a secret.",
  genre: "family",
  language: "en",
  visualStyle: "realistic",
  tone: "dramatic",
  targetDurationSeconds: 300,
  aspectRatio: "16:9",
  productionType: "fictional_drama",
  bibleContext: "Story Bible context.",
  sceneRange: { min: 6, max: 8 },
};

const scope = { projectId: "a".repeat(24), operation: "generate", sourceBibleVersion: 1 };

function makeStory(part: StoryDraftPart, sceneCount = 1): GeneratedStory {
  return {
    title: "The Inheritance",
    synopsis: `Synopsis for ${part}.`,
    structure: {
      act1: {
        introduction: "Introduction.",
        mainCharacters: "Main characters.",
        setting: "Setting.",
        initialSituation: "Initial situation.",
        incitingIncident: "Inciting incident.",
      },
      act2: {
        risingTension: "Rising tension.",
        obstacles: "Obstacles.",
        characterDecisions: "Character decisions.",
        turningPoint: "Turning point.",
      },
      act3: {
        climax: "Climax.",
        resolution: "Resolution.",
        finalOutcome: "Final outcome.",
      },
    },
    screenplay: Array.from({ length: sceneCount }, (_, i) => ({
      sceneNumber: i + 1,
      heading: `INT. ROOM - DAY (${part} ${i + 1})`,
      location: "Room",
      timeOfDay: "Day",
      charactersPresent: ["Alice"],
      visualDescription: "A room.",
      action: `Action for ${part} scene ${i + 1}.`,
      dialogue: [{ characterName: "Alice", line: "Hello." }],
    })),
  };
}

function storyResult(story: GeneratedStory): StoryModelResult {
  return { ...story, provider: "ollama", model: "qwen3:4b", fallbackFrom: null };
}

function fakeProvider(handler: (input: StoryPrompt, call: number) => Promise<StoryModelResult>) {
  const calls: StoryPrompt[] = [];
  const provider = {
    id: "ollama",
    model: "qwen3:4b",
    generateStory: vi.fn(async (input: StoryPrompt) => {
      calls.push(input);
      return await handler(input, calls.length);
    }),
    generateCharacters: vi.fn(),
    generateScenes: vi.fn(),
  } as unknown as LLMProvider;
  return { provider, calls };
}

const partOrder = STORY_DRAFT_PARTS;

describe("storyDraftPartsFingerprint", () => {
  it("is deterministic for the same input", () => {
    const a = storyDraftPartsFingerprint(basePrompt, scope);
    const b = storyDraftPartsFingerprint(basePrompt, scope);
    expect(a).toBe(b);
    expect(a).toHaveLength(20);
  });

  it("changes when the operation changes", () => {
    const a = storyDraftPartsFingerprint(basePrompt, scope);
    const b = storyDraftPartsFingerprint(basePrompt, { ...scope, operation: "revise" });
    expect(a).not.toBe(b);
  });

  it("changes when the bible version changes", () => {
    const a = storyDraftPartsFingerprint(basePrompt, scope);
    const b = storyDraftPartsFingerprint(basePrompt, { ...scope, sourceBibleVersion: 2 });
    expect(a).not.toBe(b);
  });

  it("changes when the idea changes", () => {
    const a = storyDraftPartsFingerprint(basePrompt, scope);
    const b = storyDraftPartsFingerprint({ ...basePrompt, idea: "Different idea." }, scope);
    expect(a).not.toBe(b);
  });
});

describe("parseStoryDraftPartsState", () => {
  it("returns null for missing output", () => {
    expect(parseStoryDraftPartsState(null)).toBeNull();
    expect(parseStoryDraftPartsState(undefined)).toBeNull();
    expect(parseStoryDraftPartsState({})).toBeNull();
    expect(parseStoryDraftPartsState({ storyDraftParts: null })).toBeNull();
  });

  it("returns null for invalid version", () => {
    expect(parseStoryDraftPartsState({ storyDraftParts: { version: 2, fingerprint: "abc" } })).toBeNull();
  });

  it("returns null for missing fingerprint", () => {
    expect(parseStoryDraftPartsState({ storyDraftParts: { version: 1 } })).toBeNull();
  });

  it("parses a valid state with completed parts", () => {
    const fingerprint = storyDraftPartsFingerprint(basePrompt, scope);
    const state: StoryDraftPartsState = {
      version: 1,
      fingerprint,
      parts: { opening: makeStory("opening") },
      runs: { opening: { part: "opening", provider: "ollama", model: "qwen3:4b", fallbackFrom: null, durationMs: 100 } },
    };
    const parsed = parseStoryDraftPartsState({ storyDraftParts: state });
    expect(parsed).not.toBeNull();
    expect(parsed!.fingerprint).toBe(fingerprint);
    expect(parsed!.parts.opening).toBeDefined();
    expect(parsed!.parts.opening?.title).toBe("The Inheritance");
  });

  it("parses a state with a failed part", () => {
    const fingerprint = storyDraftPartsFingerprint(basePrompt, scope);
    const state: StoryDraftPartsState = {
      version: 1,
      fingerprint,
      parts: { opening: makeStory("opening") },
      runs: {},
      failedPart: "inciting_incident",
      error: { code: "part_failed", message: "Failed." },
    };
    const parsed = parseStoryDraftPartsState({ storyDraftParts: state });
    expect(parsed?.failedPart).toBe("inciting_incident");
    expect(parsed?.error?.code).toBe("part_failed");
  });

  it("drops invalid part data during parsing", () => {
    const fingerprint = storyDraftPartsFingerprint(basePrompt, scope);
    const state = {
      version: 1,
      fingerprint,
      parts: { opening: { title: "", synopsis: "", structure: {}, screenplay: [] } },
      runs: {},
    };
    const parsed = parseStoryDraftPartsState({ storyDraftParts: state });
    expect(parsed?.parts.opening).toBeUndefined();
  });
});

describe("progressMessage", () => {
  it("shows completed count when no failure", () => {
    const state: StoryDraftPartsState = {
      version: 1,
      fingerprint: "abc",
      parts: { opening: makeStory("opening"), inciting_incident: makeStory("inciting_incident") },
      runs: {},
    };
    expect(progressMessage(state)).toBe("Story Draft: 2 of 6 parts ready");
  });

  it("shows failed part name when failure", () => {
    const state: StoryDraftPartsState = {
      version: 1,
      fingerprint: "abc",
      parts: { opening: makeStory("opening") },
      runs: {},
      failedPart: "investigation",
      error: { code: "part_failed", message: "Failed." },
    };
    expect(progressMessage(state)).toBe("Story Draft: Investigation and Complications part failed; 1 of 6 parts preserved");
  });
});

describe("generateStoryDraftParts", () => {
  it("generates all six parts sequentially", async () => {
    let call = 0;
    const { provider, calls } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      return storyResult(makeStory(part));
    });
    const progressCalls: StoryDraftPartsState[] = [];

    const result = await generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
      onProgress: async (state) => { progressCalls.push({ ...state, parts: { ...state.parts }, runs: { ...state.runs } }); },
    });

    expect(calls).toHaveLength(6);
    expect(Object.keys(result.state.parts)).toEqual([...STORY_DRAFT_PARTS]);
    expect(result.story.screenplay.length).toBeGreaterThanOrEqual(6);
    expect(result.provider).toBe("ollama");
    expect(result.model).toBe("qwen3:4b");
    expect(progressCalls).toHaveLength(6);
    expect(Object.keys(progressCalls[0]!.parts)).toEqual(["opening"]);
    expect(Object.keys(progressCalls[5]!.parts)).toEqual([...STORY_DRAFT_PARTS]);
  });

  it("renumbers scenes sequentially in the merged story", async () => {
    let call = 0;
    const { provider } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      return storyResult(makeStory(part, 2));
    });

    const result = await generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
    });

    const sceneNumbers = result.story.screenplay.map((s) => s.sceneNumber);
    expect(sceneNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("skips completed parts on resume from cached state", async () => {
    const fingerprint = storyDraftPartsFingerprint(basePrompt, scope);
    let call = 0;
    const { provider, calls } = fakeProvider(async () => {
      const part = partOrder[call + 2]!;
      call += 1;
      return storyResult(makeStory(part));
    });
    const cached: StoryDraftPartsState = {
      version: 1,
      fingerprint,
      parts: {
        opening: makeStory("opening"),
        inciting_incident: makeStory("inciting_incident"),
      },
      runs: {},
    };

    const result = await generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
      cached,
    });

    expect(calls).toHaveLength(4);
    expect(Object.keys(result.state.parts)).toHaveLength(6);
    expect(result.state.parts.opening).toBe(cached.parts.opening);
  });

  it("discards cached state when fingerprint mismatches", async () => {
    let call = 0;
    const { provider, calls } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      return storyResult(makeStory(part));
    });
    const cached: StoryDraftPartsState = {
      version: 1,
      fingerprint: "different-fingerprint",
      parts: { opening: makeStory("opening") },
      runs: {},
    };

    await generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
      cached,
    });

    expect(calls).toHaveLength(6);
  });

  it("passes previous scenes as continuity context to later parts", async () => {
    let call = 0;
    const { provider, calls } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      return storyResult(makeStory(part));
    });

    await generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
    });

    expect(calls[0]?.continuityContext).toContain("Part 1 of 6");
    expect(calls[0]?.continuityContext).not.toContain("Previous scenes:");
    expect(calls[1]?.continuityContext).toContain("Previous scenes:");
    expect(calls[5]?.continuityContext).toContain("Previous scenes:");
  });

  it("includes part label and objective in the prompt", async () => {
    let call = 0;
    const { provider, calls } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      return storyResult(makeStory(part));
    });

    await generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
    });

    expect(calls[0]?.continuityContext).toContain("Opening");
    expect(calls[1]?.continuityContext).toContain("Inciting Incident");
    expect(calls[4]?.continuityContext).toContain("Climax");
    expect(calls[5]?.continuityContext).toContain("Resolution");
  });

  it("throws JobError when a part fails", async () => {
    let call = 0;
    const { provider } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      if (part === "investigation") {
        throw new JobError("Provider failed.", "provider_error", true);
      }
      return storyResult(makeStory(part));
    });
    const progressCalls: StoryDraftPartsState[] = [];

    await expect(generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
      onProgress: async (state) => { progressCalls.push({ ...state, parts: { ...state.parts }, runs: { ...state.runs } }); },
    })).rejects.toThrow(JobError);

    expect(progressCalls.at(-1)?.failedPart).toBe("investigation");
    expect(Object.keys(progressCalls.at(-1)?.parts ?? {})).toEqual(["opening", "inciting_incident"]);
  });

  it("stops generation when cancellation is requested between parts", async () => {
    let call = 0;
    let cancelRequested = false;
    const { provider, calls } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      if (part === "investigation") {
        cancelRequested = true;
      }
      return storyResult(makeStory(part));
    });

    await expect(generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
      checkCancellation: async () => cancelRequested,
    })).rejects.toThrow("cancelled");

    expect(calls.length).toBeLessThan(6);
  });

  it("aborts the current call when cancellation is requested", async () => {
    let call = 0;
    const { provider, calls } = fakeProvider(async () => {
      call += 1;
      const part = partOrder[call - 1]!;
      return storyResult(makeStory(part));
    });

    let cancelAfter2 = false;
    const checkCancellation = async () => {
      if (call >= 2) cancelAfter2 = true;
      return cancelAfter2;
    };

    await expect(generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
      checkCancellation,
    })).rejects.toThrow("cancelled");

    expect(calls.length).toBeLessThan(6);
    expect(call).toBeLessThanOrEqual(3);
  });

  it("persists progress after each part", async () => {
    let call = 0;
    const { provider } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      return storyResult(makeStory(part));
    });
    const progressCalls: StoryDraftPartsState[] = [];

    await generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
      onProgress: async (state) => { progressCalls.push({ ...state, parts: { ...state.parts }, runs: { ...state.runs } }); },
    });

    expect(progressCalls).toHaveLength(6);
    for (let i = 0; i < 6; i += 1) {
      expect(Object.keys(progressCalls[i]!.parts)).toHaveLength(i + 1);
    }
  });

  it("calls onStatus before each part", async () => {
    let call = 0;
    const { provider } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      return storyResult(makeStory(part));
    });
    const statusMessages: string[] = [];

    await generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
      onStatus: async (message) => { statusMessages.push(message); },
    });

    expect(statusMessages).toHaveLength(6);
    expect(statusMessages[0]).toContain("Opening");
    expect(statusMessages[0]).toContain("1/6");
    expect(statusMessages[5]).toContain("Resolution");
    expect(statusMessages[5]).toContain("6/6");
  });

  it("merges structure fields from the correct parts", async () => {
    let call = 0;
    const { provider } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      const story = makeStory(part);
      if (part === "opening") {
        story.structure.act1.introduction = "Custom introduction from opening.";
      }
      if (part === "climax") {
        story.structure.act3.climax = "Custom climax from climax part.";
      }
      return storyResult(story);
    });

    const result = await generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
    });

    expect(result.story.structure.act1.introduction).toBe("Custom introduction from opening.");
    expect(result.story.structure.act3.climax).toBe("Custom climax from climax part.");
  });

  it("produces a valid GeneratedStory that passes schema validation", async () => {
    let call = 0;
    const { provider } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      return storyResult(makeStory(part, 3));
    });

    const result = await generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
    });

    expect(result.story.title).toBe("The Inheritance");
    expect(result.story.synopsis.length).toBeGreaterThan(0);
    expect(result.story.synopsis.length).toBeLessThanOrEqual(2000);
    expect(result.story.screenplay.length).toBe(18);
    expect(result.story.screenplay.length).toBeLessThanOrEqual(40);
    expect(result.story.screenplay[0]!.sceneNumber).toBe(1);
    expect(result.story.screenplay[17]!.sceneNumber).toBe(18);
  });

  it("caps screenplay at 40 scenes", async () => {
    let call = 0;
    const { provider } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      return storyResult(makeStory(part, 10));
    });

    const result = await generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
    });

    expect(result.story.screenplay.length).toBe(40);
    expect(result.story.screenplay[39]!.sceneNumber).toBe(40);
  });

  it("tracks provider and model metadata from parts", async () => {
    let call = 0;
    const { provider } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      const result = storyResult(makeStory(part));
      if (part === "climax") {
        result.provider = "groq";
        result.model = "llama-3.3-70b";
        result.fallbackFrom = "ollama";
      }
      return result;
    });

    const result = await generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
    });

    expect(result.provider).toBe("mixed");
    expect(result.model).toBe("mixed");
    expect(result.fallbackFrom).toBe("ollama");
  });

  it("passes preferredProvider to subsequent parts after first success", async () => {
    let call = 0;
    const { provider } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      return storyResult(makeStory(part));
    });

    await generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
    });

    const mockCalls = vi.mocked(provider.generateStory).mock.calls;
    expect(mockCalls).toHaveLength(6);
    expect(mockCalls[0]![1]?.preferredProvider).toBeUndefined();
    for (let i = 1; i < 6; i += 1) {
      expect(mockCalls[i]![1]?.preferredProvider).toBe("ollama");
    }
  });

  it("does not pass preferredProvider when provider is unknown", async () => {
    let call = 0;
    const { provider, calls } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      return { ...makeStory(part), provider: "unknown", model: "unknown" };
    });

    await generateStoryDraftParts(provider, basePrompt, {
      jobId: "job1",
      scope,
    });

    const mockCalls = vi.mocked(provider.generateStory).mock.calls;
    expect(calls).toHaveLength(6);
    for (let i = 0; i < 6; i += 1) {
      expect(mockCalls[i]![1]?.preferredProvider).toBeUndefined();
    }
  });

  it("compacts bibleContext and narrativeAuthority for parts 2-6", async () => {
    const largeBible = "B".repeat(20_000);
    const largeAuthority = "A".repeat(15_000);
    const promptWithLargeContext: StoryPrompt = {
      ...basePrompt,
      bibleContext: largeBible,
      narrativeAuthority: largeAuthority,
    };

    let call = 0;
    const { provider, calls } = fakeProvider(async () => {
      const part = partOrder[call]!;
      call += 1;
      return storyResult(makeStory(part));
    });

    await generateStoryDraftParts(provider, promptWithLargeContext, {
      jobId: "job1",
      scope,
    });

    expect(calls).toHaveLength(6);
    expect(calls[0]!.bibleContext).toBe(largeBible);
    expect(calls[0]!.narrativeAuthority).toBe(largeAuthority);
    for (let i = 1; i < 6; i += 1) {
      expect(calls[i]!.bibleContext!.length).toBeLessThan(largeBible.length);
      expect(calls[i]!.narrativeAuthority!.length).toBeLessThan(largeAuthority.length);
      expect(calls[i]!.bibleContext!.length).toBeLessThanOrEqual(5_000);
      expect(calls[i]!.narrativeAuthority!.length).toBeLessThanOrEqual(3_000);
    }
  });
});

describe("STORY_DRAFT_PARTS constants", () => {
  it("defines six parts in the correct order", () => {
    expect(STORY_DRAFT_PARTS).toEqual([
      "opening",
      "inciting_incident",
      "investigation",
      "escalation",
      "climax",
      "resolution",
    ]);
  });

  it("has a label for every part", () => {
    for (const part of STORY_DRAFT_PARTS) {
      expect(STORY_DRAFT_PART_LABELS[part]).toBeDefined();
      expect(STORY_DRAFT_PART_LABELS[part].length).toBeGreaterThan(0);
    }
  });
});