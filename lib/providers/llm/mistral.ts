import { log } from "@/lib/log";
import { chatJson } from "@/lib/providers/llm/chat";
import { storyCompletionBudget } from "@/lib/providers/llm/budget";
import { parseStory } from "@/lib/providers/llm/parse";
import { storySystemPrompt, storyUserPrompt } from "@/lib/providers/llm/prompt";
import { storyJsonSchemaFormat } from "@/lib/providers/llm/schemaFormat";
import { bindChatStages, storyBibleCompletionBudget } from "@/lib/providers/llm/chatStages";
import type { LLMProvider, StoryCallOptions, StoryModelResult, StoryPrompt } from "@/lib/providers/llm/types";

export const DEFAULT_MISTRAL_MODEL = "mistral-small-latest";

export class MistralLLMProvider implements LLMProvider {
  readonly id = "mistral";
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
  readonly critiqueStory: NonNullable<LLMProvider["critiqueStory"]>;

  constructor(private readonly options: { model: string; apiKey: string | undefined }) {
    this.model = options.model;
    const stages = bindChatStages({
      label: "Mistral",
      apiKey: options.apiKey,
      baseURL: "https://api.mistral.ai/v1",
      model: options.model,
      schemaMode: "json_schema",
      strictSchema: true,
      storyBibleMaxCompletionTokens: (input) => storyBibleCompletionBudget(input, 8_000),
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
    this.critiqueStory = stages.critiqueStory!;
  }

  async generateStory(input: StoryPrompt, options: StoryCallOptions = {}): Promise<StoryModelResult> {
    if (!this.options.apiKey) throw new Error("MISTRAL_API_KEY is not set.");
    const signal = options.signal ?? AbortSignal.timeout(90_000);
    const started = Date.now();
    log.info("mistral", "request", { model: this.model });
    const response = await chatJson({
      label: "Mistral",
      apiKey: this.options.apiKey,
      baseURL: "https://api.mistral.ai/v1",
      model: this.model,
      system: storySystemPrompt(),
      prompt: storyUserPrompt(input),
      signal,
      timeoutMs: 90_000,
      responseFormat: storyJsonSchemaFormat(),
      maxCompletionTokens: storyCompletionBudget(input.targetDurationSeconds),
    });
    const story = parseStory("Mistral", response.text);
    log.info("mistral", "response", { model: this.model, ms: Date.now() - started, scenes: story.screenplay.length });
    return { ...story, usage: response.usage, truncated: response.truncated };
  }
}

export function createMistralProvider(
  model = process.env.MISTRAL_MODEL?.trim() || DEFAULT_MISTRAL_MODEL
): LLMProvider {
  return new MistralLLMProvider({ model, apiKey: process.env.MISTRAL_API_KEY?.trim() });
}
