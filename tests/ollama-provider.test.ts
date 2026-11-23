import { afterEach, describe, expect, it, vi } from "vitest";
import { JobError } from "@/lib/pipeline/types";
import { StoryProviderManager, type ProviderSlot } from "@/lib/providers/llm/manager";
import {
  createOllamaProvider,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  OllamaLLMProvider,
  ollamaBaseUrl,
  ollamaModel,
  ollamaEndpoint,
  ollamaTimeoutMs,
  ollamaGenerationOptions,
  ollamaSectionNumCtx,
  DEFAULT_OLLAMA_SECTION_NUM_CTX,
} from "@/lib/providers/llm/ollama";
import { buildSlots, credentialPresent, providerSequence } from "@/lib/providers/llm/registry";
import type { CharacterPrompt, ScenePrompt, StoryPrompt } from "@/lib/providers/llm/types";
import type { GeneratedStory } from "@/lib/validation/story";
import type { StoryBibleTaskInput } from "@/lib/providers/llm/storyBibleTask";

const env = (values: Record<string, string> = {}): NodeJS.ProcessEnv => values as NodeJS.ProcessEnv;

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

const sampleIdentity = {
  title: "The Closed Gate",
  genres: ["Drama"],
  subgenres: ["Family Drama"],
  centralPremise: "A daughter returns home after years of estrangement.",
  narrativeConcept: "A single night of confrontation at the family threshold.",
  toneAndAtmosphere: "Quiet and tense",
  targetAudience: "Adult drama audience",
  centralConflict: "Trust between father and daughter",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ollamaChatResponse(content: string, options: { promptTokens?: number; evalTokens?: number } = {}) {
  return jsonResponse({
    model: "gemma3:4b",
    created_at: new Date().toISOString(),
    message: {
      role: "assistant",
      content,
    },
    done: true,
    done_reason: "stop",
    prompt_eval_count: options.promptTokens ?? 25,
    eval_count: options.evalTokens ?? 150,
  });
}

describe("Ollama LLM Provider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("Configuration and defaults", () => {
    it("uses default values when environment variables are unset", () => {
      expect(ollamaBaseUrl(env())).toBe(DEFAULT_OLLAMA_BASE_URL);
      expect(ollamaModel(env())).toBe(DEFAULT_OLLAMA_MODEL);
      expect(ollamaTimeoutMs(env())).toBe(240_000);
      const opts = ollamaGenerationOptions(env());
      expect(opts.temperature).toBe(0.7);
      expect(opts.num_ctx).toBe(8192);
      expect(opts.repeat_penalty).toBe(1.1);
    });

    it("respects custom environment variables", () => {
      const customEnv = {
        OLLAMA_BASE_URL: "http://192.168.1.50:11434/",
        OLLAMA_MODEL: "gemma3:12b",
        OLLAMA_TIMEOUT_MS: "60000",
        OLLAMA_TEMPERATURE: "0.2",
        OLLAMA_NUM_CTX: "16384",
        OLLAMA_REPEAT_PENALTY: "1.2",
      } as unknown as NodeJS.ProcessEnv;

      expect(ollamaBaseUrl(customEnv)).toBe("http://192.168.1.50:11434");
      expect(ollamaModel(customEnv)).toBe("gemma3:12b");
      expect(ollamaTimeoutMs(customEnv)).toBe(60_000);
      const opts = ollamaGenerationOptions(customEnv);
      expect(opts.temperature).toBe(0.2);
      expect(opts.num_ctx).toBe(16384);
      expect(opts.repeat_penalty).toBe(1.2);
    });

    it("treats blank environment values as unset", () => {
      const blank = env({
        OLLAMA_BASE_URL: "  ",
        OLLAMA_MODEL: "",
        OLLAMA_TIMEOUT_MS: " ",
        OLLAMA_TEMPERATURE: "",
        OLLAMA_TOP_P: "",
        OLLAMA_REPEAT_PENALTY: "",
      });

      expect(ollamaBaseUrl(blank)).toBe(DEFAULT_OLLAMA_BASE_URL);
      expect(ollamaModel(blank)).toBe(DEFAULT_OLLAMA_MODEL);
      expect(ollamaTimeoutMs(blank)).toBe(240_000);
      const opts = ollamaGenerationOptions(blank);
      expect(opts.temperature).toBe(0.7);
      expect(opts.top_p).toBe(0.9);
      expect(opts.repeat_penalty).toBe(1.1);
    });

    it("normalizes a custom endpoint", () => {
      expect(ollamaEndpoint(env())).toBe("/api/chat");
      expect(ollamaEndpoint(env({ OLLAMA_ENDPOINT: "api/chat" }))).toBe("/api/chat");
      expect(ollamaEndpoint(env({ OLLAMA_ENDPOINT: " /v1/chat " }))).toBe("/v1/chat");
    });

    it("registers Ollama without requiring an API key", () => {
      expect(credentialPresent("ollama", env())).toBe(true);
      expect(credentialPresent("ollama", env({ OLLAMA_DISABLED: "true" }))).toBe(false);
      expect(credentialPresent("ollama", env({ OLLAMA_ENABLED: "false" }))).toBe(false);
    });

    it("uses default section num_ctx when unset", () => {
      expect(ollamaSectionNumCtx(env())).toBe(DEFAULT_OLLAMA_SECTION_NUM_CTX);
      expect(ollamaSectionNumCtx(env())).toBe(8192);
    });

    it("respects OLLAMA_SECTION_NUM_CTX override", () => {
      expect(ollamaSectionNumCtx(env({ OLLAMA_SECTION_NUM_CTX: "4096" }))).toBe(4096);
      expect(ollamaSectionNumCtx(env({ OLLAMA_SECTION_NUM_CTX: "16384" }))).toBe(16384);
    });

    it("clamps OLLAMA_SECTION_NUM_CTX to valid range", () => {
      expect(ollamaSectionNumCtx(env({ OLLAMA_SECTION_NUM_CTX: "1024" }))).toBe(2048);
      expect(ollamaSectionNumCtx(env({ OLLAMA_SECTION_NUM_CTX: "999999" }))).toBe(65536);
    });

    it("treats blank OLLAMA_SECTION_NUM_CTX as unset", () => {
      expect(ollamaSectionNumCtx(env({ OLLAMA_SECTION_NUM_CTX: "  " }))).toBe(DEFAULT_OLLAMA_SECTION_NUM_CTX);
    });
  });

  describe("Direct generation", () => {
    it("successfully generates plain text via complete()", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse("The gate creaked open in the dark.")
      );

      const provider = new OllamaLLMProvider();
      const result = await provider.complete({ prompt: "Describe a gate." });

      expect(result.text).toBe("The gate creaked open in the dark.");
      expect(result.usage).toEqual({ inputTokens: 25, outputTokens: 150 });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:11434/api/chat",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    it("sends system and user messages with JSON mode and generation options", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse(JSON.stringify(sampleStory))
      );

      const provider = new OllamaLLMProvider({
        model: "gemma3:4b",
        baseURL: "http://127.0.0.1:11434",
        endpoint: "/api/chat",
        formatMode: "json",
        extraOptions: { temperature: 0.3, repeat_penalty: 1.1 },
      });
      await provider.complete({
        system: "You are a screenwriter.",
        prompt: "Write the scene.",
        schema: { type: "object" },
      });

      const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      const body = JSON.parse(String(init?.body));
      expect(body.stream).toBe(false);
      expect(body.format).toBe("json");
      expect(body.messages).toEqual([
        { role: "system", content: "You are a screenwriter." },
        { role: "user", content: "Write the scene." },
      ]);
      expect(body.options.temperature).toBe(0.3);
      expect(body.options.repeat_penalty).toBe(1.1);
      expect(body.options.num_ctx).toBe(8192);
    });

    it("successfully generates a valid screenplay story", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse(JSON.stringify(sampleStory), { promptTokens: 30, evalTokens: 200 })
      );

      const provider = createOllamaProvider();
      const result = await provider.generateStory(prompt);

      expect(result.title).toBe("The closed gate");
      expect(result.screenplay).toHaveLength(1);
      expect(result.screenplay[0]?.charactersPresent).toEqual(["Ada", "Father"]);
      expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 200 });
    });

    it("successfully extracts characters matching the approved screenplay", async () => {
      const characterData = {
        characters: [
          { name: "Ada", role: "protagonist", physicalDescription: "Tired traveler", personality: "Resolute" },
          { name: "Father", role: "supporting", physicalDescription: "Elderly man", personality: "Guarded" },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse(JSON.stringify(characterData))
      );

      const provider = createOllamaProvider();
      const input: CharacterPrompt = {
        title: sampleStory.title,
        screenplay: sampleStory.screenplay,
      };

      const result = await provider.generateCharacters(input);
      expect(result.characters).toHaveLength(2);
      expect(result.characters[0]?.name).toBe("Ada");
      expect(result.characters[1]?.name).toBe("Father");
    });

    it("successfully generates scene breakdown", async () => {
      const sceneData = {
        scenes: [
          {
            sceneNumber: 1,
            title: "Arrival at the Gate",
            heading: "EXT. COURTYARD - NIGHT",
            location: "Courtyard",
            timeOfDay: "Night",
            interiorExterior: "exterior",
            charactersPresent: ["Ada", "Father"],
            visualDescription: "A locked iron gate in warm window light.",
            action: "Ada knocks once and waits.",
            dialogue: [{ characterName: "Ada", line: "I came back." }],
            cameraDirection: "Static wide shot",
            estimatedDurationSeconds: 60,
          },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse(JSON.stringify(sceneData))
      );

      const provider = createOllamaProvider();
      const input: ScenePrompt = {
        title: sampleStory.title,
        screenplay: sampleStory.screenplay,
        characterNames: ["Ada", "Father"],
        targetDurationSeconds: 60,
      };

      const result = await provider.generateScenes(input);
      expect(result.scenes).toHaveLength(1);
      expect(result.scenes[0]?.sceneNumber).toBe(1);
      expect(result.scenes[0]?.title).toBe("Arrival at the Gate");
      expect(result.scenes[0]?.location).toBe("Courtyard");
    });

    it("successfully generates a complete Story Bible", async () => {
      const bibleContent = {
        identity: {
          title: "The Closed Gate",
          genres: ["Drama"],
          subgenres: ["Family Drama"],
          centralPremise: "A daughter returns home after years of estrangement.",
          narrativeConcept: "A single night of confrontation at the family threshold.",
          toneAndAtmosphere: "Quiet and tense",
          targetAudience: "Adult drama audience",
          centralConflict: "Trust between father and daughter",
        },
        world: {
          description: "A rural family compound.",
          geographyAndLocations: [
            { name: "Courtyard", description: "Iron gate and stone courtyard", storyFunction: "Threshold" },
            { name: "Kitchen", description: "Warm hearth and tea", storyFunction: "Domestic sanctuary" },
          ],
          socialStructuresAndCultures: ["Traditional family expectations"],
          historyAndPastEvents: ["Ada left a year ago"],
          rules: ["The gate is locked at sundown"],
          definingSystems: [],
        },
        characters: {
          characters: [
            {
              name: "Ada",
              storyRole: "protagonist",
              roleDescription: "The prodigal daughter",
              physicalDescription: "Worn coat, tired eyes",
              personality: "Steely but longing",
              background: "Left home under unresolved tension",
              motivations: ["Reconciliation"],
              fearsAndWeaknesses: ["Rejection"],
              abilitiesAndLimitations: ["Speaks plainly"],
              relationships: [{ characterName: "Father", relationship: "Parent", tensionOrChange: "Unforgiven rift" }],
              secrets: ["Why she left"],
              developmentPotential: "Finding peace",
            },
            {
              name: "Father",
              storyRole: "supporting",
              roleDescription: "The estranged parent",
              physicalDescription: "Weathered face, calloused hands",
              personality: "Proud and silent",
              background: "Maintains the family homestead",
              motivations: ["Protecting the household"],
              fearsAndWeaknesses: ["Vulnerability"],
              abilitiesAndLimitations: ["Authoritative presence"],
              relationships: [{ characterName: "Ada", relationship: "Child", tensionOrChange: "Struggling to forgive" }],
              secrets: ["Kept her letters"],
              developmentPotential: "Opening the door",
            },
          ],
          relationshipDynamics: ["Father and daughter silence"],
        },
        narrative: {
          mainStoryline: "The return of Ada",
          majorConflicts: ["Pride vs forgiveness"],
          longTermDirection: "Healing",
          subplots: [],
          unresolvedMysteries: [],
          potentialFutureRevelations: [],
          majorNarrativeQuestions: ["Will he unlock the gate?"],
          serializedEndingGuidance: "Bittersweet entry",
        },
        guidelines: {
          mainThemes: ["Reconciliation", "Family pride"],
          secondaryThemes: ["Homecoming"],
          storytellingStyle: "Naturalistic",
          boundaries: ["No melodrama"],
          mustRemainConsistent: ["Character tone"],
        },
        canon: {
          confirmedFacts: ["Ada left 1 year ago"],
          proposedDetails: [],
          unresolvedQuestions: [],
          hiddenInformation: [],
          characterKnowledge: [{ characterName: "Ada", knows: ["She is home"], believes: ["He will listen"] }],
          audienceKnowledge: ["The house is watching"],
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse(JSON.stringify({ content: bibleContent }))
      );

      const provider = createOllamaProvider();
      const input: StoryBibleTaskInput = {
        mode: "generate",
        title: "The Closed Gate",
        idea: "A daughter returns home.",
      };

      const result = await provider.generateStoryBible!(input);
      expect(result.result.mode).toBe("complete");
      if (result.result.mode === "complete") {
        expect(result.result.content.identity.title).toBe("The Closed Gate");
      }
    });

    it("sends the section schema and section token budget for Story Bible sections", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse(JSON.stringify(sampleIdentity))
      );

      const provider = new OllamaLLMProvider({ formatMode: "json" });
      const result = await provider.generateStoryBible({
        mode: "section",
        section: "identity",
        idea: "A daughter returns home.",
      });

      expect(result.result.mode).toBe("section");
      if (result.result.mode === "section") {
        expect(result.result.value).toMatchObject({ title: "The Closed Gate" });
      }

      const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      const body = JSON.parse(String(init?.body));
      expect(body.format).toMatchObject({
        type: "object",
        required: expect.arrayContaining(["centralPremise", "narrativeConcept"]),
      });
      expect(body.options.num_predict).toBe(1_500);
    });

    it("unwraps a single section-named object around a section response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse(JSON.stringify({ identity: sampleIdentity }))
      );

      const provider = new OllamaLLMProvider({ formatMode: "schema" });
      const result = await provider.generateStoryBible({
        mode: "section",
        section: "identity",
        idea: "A daughter returns home.",
      });

      expect(result.result.mode).toBe("section");
      if (result.result.mode === "section") {
        expect(result.result.value).toMatchObject({ title: "The Closed Gate" });
      }
    });

    it("still rejects a wrapped section that renames required fields", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse(JSON.stringify({
          identity: {
            title: "The Closed Gate",
            genres: ["Drama"],
            subgenres: ["Family Drama"],
            premise: "Shorthand that is not the schema field.",
            concept: "Shorthand that is not the schema field.",
            tone: "Quiet and tense",
            audience: "Adult drama audience",
            centralConflict: "Trust between father and daughter",
          },
        }))
      );

      const provider = new OllamaLLMProvider({ formatMode: "json" });
      await expect(provider.generateStoryBible({
        mode: "section",
        section: "identity",
        idea: "A daughter returns home.",
      })).rejects.toMatchObject({ code: "invalid_schema", retryable: false });
    });

    it("streams a section response split across NDJSON chunks", async () => {
      const payload = JSON.stringify(sampleIdentity);
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(
            `${JSON.stringify({ message: { content: payload.slice(0, 60) } })}\n`
          ));
          controller.enqueue(encoder.encode(JSON.stringify({
            message: { content: payload.slice(60) },
            done: true,
            prompt_eval_count: 40,
            eval_count: 120,
          })));
          controller.close();
        },
      });
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      }));

      const provider = new OllamaLLMProvider();
      const result = await provider.generateStoryBible({
        mode: "section",
        section: "identity",
        idea: "A daughter returns home.",
      });

      expect(result.result.mode).toBe("section");
      if (result.result.mode === "section") {
        expect(result.result.value).toMatchObject({ title: "The Closed Gate" });
      }
      expect(result.usage).toEqual({ inputTokens: 40, outputTokens: 120 });

      const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(JSON.parse(String(init?.body)).stream).toBe(true);
    });

    it("keeps complete streamed text when Ollama ends with a repeat-limit error", async () => {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(
            `${JSON.stringify({ message: { content: JSON.stringify(sampleIdentity) } })}\n`
          ));
          controller.enqueue(encoder.encode(JSON.stringify({
            error: "prediction aborted, token repeat limit reached",
          })));
          controller.close();
        },
      });
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      }));

      const provider = new OllamaLLMProvider();
      const result = await provider.generateStoryBible({
        mode: "section",
        section: "identity",
        idea: "A daughter returns home.",
      });

      expect(result.result.mode).toBe("section");
      if (result.result.mode === "section") {
        expect(result.result.value).toMatchObject({ title: "The Closed Gate" });
      }
    });
  });

  describe("Error handling and classification", () => {
    it("distinguishes connection refused when Ollama is not running", async () => {
      const connError = new TypeError("fetch failed");
      (connError as unknown as { cause: { code: string } }).cause = { code: "ECONNREFUSED" };
      globalThis.fetch = vi.fn().mockRejectedValue(connError);

      const provider = createOllamaProvider();
      await expect(provider.generateStory(prompt)).rejects.toMatchObject({
        message: expect.stringContaining("connection refused"),
        code: "provider_unavailable",
        retryable: true,
      });
    });

    it("distinguishes when the model is not installed (404)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        jsonResponse({ error: "model 'gemma3:4b' not found" }, 404)
      );

      const provider = createOllamaProvider();
      await expect(provider.generateStory(prompt)).rejects.toMatchObject({
        message: expect.stringContaining("is not installed. Run 'ollama pull"),
        code: "invalid_model",
        retryable: false,
      });
    });

    it("distinguishes request timeouts", async () => {
      const timeoutError = new Error("The operation was aborted due to timeout");
      timeoutError.name = "TimeoutError";
      globalThis.fetch = vi.fn().mockRejectedValue(timeoutError);

      const provider = createOllamaProvider();
      await expect(provider.generateStory(prompt)).rejects.toMatchObject({
        message: expect.stringContaining("timed out"),
        code: "timeout",
        retryable: true,
      });
    });

    it("distinguishes empty responses", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse("   ")
      );

      const provider = createOllamaProvider();
      await expect(provider.generateStory(prompt)).rejects.toMatchObject({
        message: expect.stringContaining("empty response"),
        code: "empty_response",
        retryable: false,
      });
    });

    it("distinguishes invalid JSON responses", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse("This is plain text, not JSON")
      );

      const provider = createOllamaProvider();
      await expect(provider.generateStory(prompt)).rejects.toMatchObject({
        code: "invalid_json",
        retryable: false,
      });
    });

    it("distinguishes invalid schema responses", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse(JSON.stringify({ title: "Incomplete", synopsis: "Missing structure & screenplay" }))
      );

      const provider = createOllamaProvider();
      await expect(provider.generateStory(prompt)).rejects.toMatchObject({
        code: "invalid_schema",
        retryable: false,
      });
    });

    it("distinguishes Ollama server errors (500)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        jsonResponse({ error: "internal server error in llama.cpp runner" }, 500)
      );

      const provider = createOllamaProvider();
      await expect(provider.generateStory(prompt)).rejects.toMatchObject({
        code: "provider_unavailable",
        retryable: true,
      });
    });

    it("treats Ollama HTTP 429 as a retryable rate limit", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        jsonResponse({ error: "server busy" }, 429)
      );

      const provider = createOllamaProvider();
      await expect(provider.generateStory(prompt)).rejects.toMatchObject({
        code: "rate_limited",
        retryable: true,
      });
    });
  });
});

describe("Provider priority and failover", () => {
  function slot(
    id: string,
    generate: ProviderSlot["generate"],
    options: { configured?: boolean; supported?: boolean; model?: string; timeoutMs?: number } = {}
  ): ProviderSlot {
    return {
      id,
      model: options.model ?? `${id}-model`,
      configured: options.configured ?? true,
      supported: options.supported ?? true,
      timeoutMs: options.timeoutMs,
      generate,
    };
  }

  function manager(slots: ProviderSlot[]) {
    return new StoryProviderManager({
      slots,
      sequenceTimeoutMs: 15_000,
      providerTimeoutMs: 5_000,
      freeOnly: true,
    });
  }

  it("has Gemini as primary with all configured providers as fallbacks", () => {
    const sequence = providerSequence({});
    expect(sequence).toEqual(["gemini", "groq", "openrouter", "mistral", "openai", "deepseek", "kimi", "anthropic", "ollama"]);
  });

  it("builds slots with Ollama as primary when explicitly configured", () => {
    const slots = buildSlots(env({ LLM_PROVIDER: "ollama" }));
    expect(slots[0]?.id).toBe("ollama");
    expect(slots[0]?.configured).toBe(true);
    expect(slots[0]?.supported).toBe(true);
    expect(slots[0]?.model).toBe("gemma3:4b");
  });

  it("falls back from Ollama to Groq when Ollama is unavailable", async () => {
    const ollamaGenerate = vi.fn(async () => {
      throw new JobError("Ollama connection refused.", "provider_unavailable", true);
    });
    const result = await manager([
      slot("ollama", ollamaGenerate),
      slot("groq", async () => ({ story: sampleStory })),
    ]).generateStory(prompt);

    expect(result.provider).toBe("groq");
    expect(result.fallbackFrom).toBe("ollama");
    expect(result.title).toBe("The closed gate");
    expect(ollamaGenerate).toHaveBeenCalledTimes(1);
  });

  it("falls back from Ollama to Groq when Ollama times out", async () => {
    const ollamaGenerate = vi.fn(async () => {
      throw new JobError("Ollama timed out.", "timeout", true);
    });
    const result = await manager([
      slot("ollama", ollamaGenerate),
      slot("groq", async () => ({ story: sampleStory })),
    ]).generateStory(prompt);

    expect(result.provider).toBe("groq");
    expect(ollamaGenerate).toHaveBeenCalledTimes(1);
  });

  it("falls back from Ollama to Groq on an empty response", async () => {
    const ollamaGenerate = vi.fn(async () => {
      throw new JobError("Ollama returned empty.", "empty_response", false);
    });
    const result = await manager([
      slot("ollama", ollamaGenerate),
      slot("groq", async () => ({ story: sampleStory })),
    ]).generateStory(prompt);

    expect(result.provider).toBe("groq");
    expect(ollamaGenerate).toHaveBeenCalledTimes(1);
  });

  it("falls back from Ollama on invalid schema output", async () => {
    const ollamaGenerate = vi.fn(async () => {
      throw new JobError("Ollama returned invalid schema.", "invalid_schema", false);
    });
    const result = await manager([
      slot("ollama", ollamaGenerate),
      slot("groq", async () => ({ story: sampleStory })),
    ]).generateStory(prompt);

    expect(result.provider).toBe("groq");
    expect(ollamaGenerate).toHaveBeenCalledTimes(1);
  });

  it("falls back from Ollama when model is not installed (invalid_model)", async () => {
    const ollamaGenerate = vi.fn(async () => {
      throw new JobError("Ollama model not installed.", "invalid_model", false);
    });
    const result = await manager([
      slot("ollama", ollamaGenerate),
      slot("groq", async () => ({ story: sampleStory })),
    ]).generateStory(prompt);

    expect(result.provider).toBe("groq");
    expect(ollamaGenerate).toHaveBeenCalledTimes(1);
  });

  it("continues fallback through the configured providers: Ollama -> Groq -> OpenRouter -> Mistral", async () => {
    const mistralGenerate = vi.fn(async () => ({ story: sampleStory }));
    const result = await manager([
      slot("ollama", async () => {
        throw new JobError("Ollama connection refused.", "provider_unavailable", true);
      }),
      slot("groq", async () => {
        throw new JobError("Groq rate limited.", "rate_limited", true);
      }),
      slot("openrouter", async () => {
        throw new JobError("OpenRouter 503.", "provider_unavailable", true);
      }),
      slot("mistral", mistralGenerate),
    ]).generateStory(prompt);

    expect(result.provider).toBe("mistral");
    expect(result.fallbackFrom).toBe("ollama");
    expect(mistralGenerate).toHaveBeenCalledOnce();
  });

  it("fails cleanly when all providers fail without claiming success", async () => {
    await expect(
      manager([
        slot("ollama", async () => {
          throw new JobError("Ollama connection refused.", "provider_unavailable", true);
        }),
        slot("groq", async () => {
          throw new JobError("Groq rate limited.", "rate_limited", true);
        }),
        slot("openrouter", async () => {
          throw new JobError("OpenRouter quota exhausted.", "quota_exhausted", true);
        }),
        slot("mistral", async () => {
          throw new JobError("Mistral service unavailable.", "provider_unavailable", true);
        }),
      ]).generateStory(prompt)
    ).rejects.toMatchObject({
      message: "No free language provider is currently available.",
      code: "provider_unavailable",
      retryable: true,
      attempts: expect.arrayContaining([
        expect.objectContaining({ provider: "ollama", success: false }),
        expect.objectContaining({ provider: "groq", success: false }),
        expect.objectContaining({ provider: "openrouter", success: false }),
        expect.objectContaining({ provider: "mistral", success: false }),
      ]),
    });
  });

  it("succeeds with Groq when Ollama is disabled but cloud providers are available", async () => {
    const result = await manager([
      slot("ollama", async () => ({ story: sampleStory }), { configured: false }),
      slot("groq", async () => ({ story: sampleStory })),
    ]).generateStory(prompt);

    expect(result.provider).toBe("groq");
    expect(result.title).toBe("The closed gate");
  });

  it("marks Ollama as unconfigured when it is explicitly disabled", () => {
    const slots = buildSlots(env({ OLLAMA_DISABLED: "true", GROQ_API_KEY: "groq-key" }));
    const ollamaSlot = slots.find((s) => s.id === "ollama");
    expect(ollamaSlot?.configured).toBe(false);
  });

  it("retries on invalid_schema with empty required fields", async () => {
    const emptyTitleStory = { ...sampleStory, title: "" };
    let callCount = 0;
    const generate = vi.fn(async (input: StoryPrompt) => {
      callCount += 1;
      if (callCount === 1) return { story: emptyTitleStory };
      expect(input.continuityContext).toContain("non-empty");
      return { story: sampleStory };
    });

    const result = await manager([
      slot("ollama", generate),
    ]).generateStory(prompt);

    expect(result.provider).toBe("ollama");
    expect(result.title).toBe("The closed gate");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("does not retry on invalid_schema without empty fields", async () => {
    const invalidStory = { ...sampleStory, screenplay: [] };
    const generate = vi.fn(async () => ({ story: invalidStory }));

    const result = await manager([
      slot("ollama", generate),
      slot("groq", async () => ({ story: sampleStory })),
    ]).generateStory(prompt);

    expect(result.provider).toBe("groq");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
