import { log } from "@/lib/log";
import { chatJson } from "@/lib/providers/llm/chat";
import { storyCompletionBudget } from "@/lib/providers/llm/budget";
import { ClassifiedProviderError } from "@/lib/providers/llm/errors";
import { parseStory } from "@/lib/providers/llm/parse";
import { storySystemPrompt, storyUserPrompt } from "@/lib/providers/llm/prompt";
import { storyJsonSchemaFormat } from "@/lib/providers/llm/schemaFormat";
import { bindChatStages, storyBibleCompletionBudget } from "@/lib/providers/llm/chatStages";
import type { LLMProvider, StoryCallOptions, StoryModelResult, StoryPrompt } from "@/lib/providers/llm/types";
import { DEFAULT_FREE_MODELS } from "@/lib/providers/llm/freePolicy";

export const DEFAULT_GROQ_MODEL = DEFAULT_FREE_MODELS.groq;

export class GroqLLMProvider implements LLMProvider {
  readonly id = "groq";
  readonly model: string;
  readonly generateCharacters: LLMProvider["generateCharacters"];
  readonly generateScenes: LLMProvider["generateScenes"];
  readonly generateStoryBible: NonNullable<LLMProvider["generateStoryBible"]>;
  readonly generateEpisodeSuggestion: LLMProvider["generateEpisodeSuggestion"];
  readonly continueStory: LLMProvider["continueStory"];
  readonly generateSeasonPlan: NonNullable<LLMProvider["generateSeasonPlan"]>;
  readonly generateSeasonArchitecture: NonNullable<LLMProvider["generateSeasonArchitecture"]>;
  readonly generateEpisodeDetails: NonNullable<LLMProvider["generateEpisodeDetails"]>;
  readonly repairScenes: NonNullable<LLMProvider["repairScenes"]>;
  readonly reviseEpisode: NonNullable<LLMProvider["reviseEpisode"]>;
  readonly critiqueStory: NonNullable<LLMProvider["critiqueStory"]>;

  constructor(private readonly options: { model: string; apiKey: string | undefined }) {
    this.model = options.model;
    const stages = bindChatStages({
      label: "Groq",
      apiKey: options.apiKey,
      baseURL: "https://api.groq.com/openai/v1",
      model: options.model,
      schemaMode: "json_schema",
      strictSchema: false,
      // Groq's grammar-constrained Story Bible mode rejects this large schema
      // server-side. JSON object mode plus the explicit prompt contract lets
      // Groq answer normally; any incomplete shape is rejected by Zod and the
      // sequence moves to the next provider.
      storyBibleSchemaMode: "json_object",
      storyBibleMaxCompletionTokens: (input) => storyBibleCompletionBudget(input, 16_000),
      // Groq's grammar-constrained json_schema mode rejects the large season
      // plan schema server-side. JSON object mode plus the explicit prompt
      // contract lets Groq answer normally; any incomplete shape is rejected by
      // Zod and the sequence moves to the next provider.
      seasonPlanSchemaMode: "json_object",
      recoverRejected: true,
      extra: { reasoning_effort: "low" },
    });
    this.generateCharacters = stages.generateCharacters;
    this.generateScenes = stages.generateScenes;
    this.generateStoryBible = stages.generateStoryBible!;
    this.generateEpisodeSuggestion = stages.generateEpisodeSuggestion;
    this.continueStory = stages.continueStory;
    this.generateSeasonPlan = stages.generateSeasonPlan!;
    this.generateSeasonArchitecture = stages.generateSeasonArchitecture!;
    this.generateEpisodeDetails = stages.generateEpisodeDetails!;
    this.repairScenes = stages.repairScenes!;
    this.reviseEpisode = stages.reviseEpisode!;
    this.critiqueStory = stages.critiqueStory!;
  }

  async generateStory(input: StoryPrompt, options: StoryCallOptions = {}): Promise<StoryModelResult> {
    if (!this.options.apiKey) throw new Error("GROQ_API_KEY is not set.");
    const signal = options.signal ?? AbortSignal.timeout(90_000);
    const started = Date.now();
    log.info("groq", "request", { model: this.model });
    const request = {
      label: "Groq",
      apiKey: this.options.apiKey,
      baseURL: "https://api.groq.com/openai/v1",
      model: this.model,
      system: storySystemPrompt(),
      prompt: `${storyUserPrompt(input)}\nsceneNumber must be an integer. dialogue and charactersPresent must be arrays. Do not use an empty string where an object, array, or number belongs.`,
      signal,
      timeoutMs: 90_000,
      responseFormat: storyJsonSchemaFormat(false),
      extra: { reasoning_effort: "low" },
      maxCompletionTokens: storyCompletionBudget(input.targetDurationSeconds),
    };
    let response: { text: string; usage?: StoryModelResult["usage"]; truncated?: boolean };
    try {
      response = await chatJson(request);
    } catch (error) {
      const failed = error instanceof ClassifiedProviderError ? error.failedGeneration : "";
      if (!failed) throw error;
      log.info("groq", "using rejected generation", { model: this.model });
      const story = parseStory("Groq", failed);
      log.info("groq", "response", { model: this.model, ms: Date.now() - started, scenes: story.screenplay.length });
      return { ...story, usage: undefined };
    }
    const story = parseStory("Groq", response.text);
    log.info("groq", "response", { model: this.model, ms: Date.now() - started, scenes: story.screenplay.length });
    return { ...story, usage: response.usage, truncated: response.truncated };
  }
}

export function createGroqProvider(model = process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL): LLMProvider {
  return new GroqLLMProvider({ model, apiKey: process.env.GROQ_API_KEY?.trim() });
}
