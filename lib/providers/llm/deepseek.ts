import { log } from "@/lib/log";
import { chatJson } from "@/lib/providers/llm/chat";
import { storyCompletionBudget } from "@/lib/providers/llm/budget";
import { parseStory } from "@/lib/providers/llm/parse";
import { storySystemPrompt, storyUserPrompt } from "@/lib/providers/llm/prompt";
import { bindChatStages } from "@/lib/providers/llm/chatStages";
import type { LLMProvider, StoryCallOptions, StoryModelResult, StoryPrompt } from "@/lib/providers/llm/types";

export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export class DeepSeekLLMProvider implements LLMProvider {
  readonly id = "deepseek";
  readonly model: string;
  readonly generateCharacters: LLMProvider["generateCharacters"];
  readonly generateScenes: LLMProvider["generateScenes"];
  readonly generateStoryBible: NonNullable<LLMProvider["generateStoryBible"]>;
  readonly generateEpisodeSuggestion: LLMProvider["generateEpisodeSuggestion"];
  readonly continueStory: LLMProvider["continueStory"];
  readonly generateSeasonPlan: NonNullable<LLMProvider["generateSeasonPlan"]>;
  readonly repairScenes: NonNullable<LLMProvider["repairScenes"]>;
  readonly critiqueStory: NonNullable<LLMProvider["critiqueStory"]>;

  constructor(private readonly options: { model: string; apiKey: string | undefined }) {
    this.model = options.model;
    const stages = bindChatStages({
      label: "DeepSeek",
      apiKey: options.apiKey,
      baseURL: DEEPSEEK_BASE_URL,
      model: options.model,
      schemaMode: "json_object",
      extra: { thinking: { type: "disabled" } },
    });
    this.generateCharacters = stages.generateCharacters;
    this.generateScenes = stages.generateScenes;
    this.generateStoryBible = stages.generateStoryBible!;
    this.generateEpisodeSuggestion = stages.generateEpisodeSuggestion;
    this.continueStory = stages.continueStory;
    this.generateSeasonPlan = stages.generateSeasonPlan!;
    this.repairScenes = stages.repairScenes!;
    this.critiqueStory = stages.critiqueStory!;
  }

  async generateStory(input: StoryPrompt, options: StoryCallOptions = {}): Promise<StoryModelResult> {
    if (!this.options.apiKey) {
      throw new Error("DEEPSEEK_API_KEY is not set.");
    }
    const signal = options.signal ?? AbortSignal.timeout(90_000);
    const started = Date.now();
    log.info("deepseek", "request", { model: this.model });
    const response = await chatJson({
      label: "DeepSeek",
      apiKey: this.options.apiKey,
      baseURL: DEEPSEEK_BASE_URL,
      model: this.model,
      system: storySystemPrompt(),
      prompt: `${storyUserPrompt(input)}\nReturn one JSON object and no other text.`,
      signal,
      timeoutMs: 90_000,
      responseFormat: { type: "json_object" },
      extra: { thinking: { type: "disabled" } },
      maxCompletionTokens: storyCompletionBudget(input.targetDurationSeconds),
    });
    const story = parseStory("DeepSeek", response.text);
    log.info("deepseek", "response", { model: this.model, ms: Date.now() - started, scenes: story.screenplay.length });
    return { ...story, usage: response.usage, truncated: response.truncated };
  }
}

export function createDeepSeekProvider(
  model = process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL
): LLMProvider {
  return new DeepSeekLLMProvider({ model, apiKey: process.env.DEEPSEEK_API_KEY?.trim() });
}
