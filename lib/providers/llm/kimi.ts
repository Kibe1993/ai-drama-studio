import { log } from "@/lib/log";
import { chatJson } from "@/lib/providers/llm/chat";
import { storyCompletionBudget } from "@/lib/providers/llm/budget";
import { parseStory } from "@/lib/providers/llm/parse";
import { storySystemPrompt, storyUserPrompt } from "@/lib/providers/llm/prompt";
import { bindChatStages } from "@/lib/providers/llm/chatStages";
import type { LLMProvider, StoryCallOptions, StoryModelResult, StoryPrompt } from "@/lib/providers/llm/types";

export const DEFAULT_KIMI_MODEL = "moonshot-v1-8k";
const KIMI_BASE_URL = "https://api.moonshot.cn/v1";

export class KimiLLMProvider implements LLMProvider {
  readonly id = "kimi";
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
      label: "Kimi",
      apiKey: options.apiKey,
      baseURL: KIMI_BASE_URL,
      model: options.model,
      schemaMode: "json_object",
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
    if (!this.options.apiKey) {
      throw new Error("KIMI_API_KEY is not set.");
    }
    const signal = options.signal ?? AbortSignal.timeout(90_000);
    const started = Date.now();
    log.info("kimi", "request", { model: this.model });
    const response = await chatJson({
      label: "Kimi",
      apiKey: this.options.apiKey,
      baseURL: KIMI_BASE_URL,
      model: this.model,
      system: storySystemPrompt(),
      prompt: `${storyUserPrompt(input)}\nReturn one JSON object and no other text.`,
      signal,
      timeoutMs: 90_000,
      responseFormat: { type: "json_object" },
      maxCompletionTokens: storyCompletionBudget(input.targetDurationSeconds),
    });
    const story = parseStory("Kimi", response.text);
    log.info("kimi", "response", { model: this.model, ms: Date.now() - started, scenes: story.screenplay.length });
    return { ...story, usage: response.usage, truncated: response.truncated };
  }
}

export function createKimiProvider(
  model = process.env.KIMI_MODEL?.trim() || process.env.MOONSHOT_MODEL?.trim() || DEFAULT_KIMI_MODEL
): LLMProvider {
  return new KimiLLMProvider({
    model,
    apiKey: process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim(),
  });
}