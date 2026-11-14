import { log } from "@/lib/log";
import { chatJson } from "@/lib/providers/llm/chat";
import { storyCompletionBudget } from "@/lib/providers/llm/budget";
import { DEFAULT_FREE_MODELS } from "@/lib/providers/llm/freePolicy";
import { parseStory } from "@/lib/providers/llm/parse";
import { storySystemPrompt, storyUserPrompt } from "@/lib/providers/llm/prompt";
import { bindChatStages, storyBibleCompletionBudget } from "@/lib/providers/llm/chatStages";
import type { LLMProvider, StoryCallOptions, StoryModelResult, StoryPrompt } from "@/lib/providers/llm/types";

export const DEFAULT_OPENROUTER_MODEL = DEFAULT_FREE_MODELS.openrouter;
export const DEFAULT_OPENROUTER_TIMEOUT_MS = 150_000;

export function openRouterTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OPENROUTER_TIMEOUT_MS?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_OPENROUTER_TIMEOUT_MS;
  return Math.max(15_000, Math.min(300_000, parsed));
}

export class OpenRouterLLMProvider implements LLMProvider {
  readonly id = "openrouter";
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

  constructor(private readonly options: { model: string; apiKey: string | undefined; timeoutMs?: number }) {
    this.model = options.model;
    const timeoutMs = options.timeoutMs ?? DEFAULT_OPENROUTER_TIMEOUT_MS;
    const stages = bindChatStages({
      label: "OpenRouter",
      apiKey: options.apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      model: options.model,
      headers: { "HTTP-Referer": "http://localhost:3000", "X-Title": "AI Drama Studio" },
      schemaMode: "json_object",
      storyBibleSchemaMode: "json_schema",
      storyBibleStrictSchema: false,
      storyBibleMaxCompletionTokens: (input) => storyBibleCompletionBudget(input, 32_000),
      storyBibleTimeoutMs: timeoutMs,
      storyBibleExtra: { provider: { require_parameters: true } },
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
    if (!this.options.apiKey) throw new Error("OPENROUTER_API_KEY is not set.");
    const signal = options.signal ?? AbortSignal.timeout(90_000);
    const started = Date.now();
    log.info("openrouter", "request", { model: this.model });
    const response = await chatJson({
      label: "OpenRouter",
      apiKey: this.options.apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      model: this.model,
      system: storySystemPrompt(),
      prompt: storyUserPrompt(input),
      signal,
      timeoutMs: 90_000,
      headers: {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "AI Drama Studio",
      },
      responseFormat: { type: "json_object" },
      maxCompletionTokens: storyCompletionBudget(input.targetDurationSeconds),
    });
    const story = parseStory("OpenRouter", response.text);
    log.info("openrouter", "response", { model: this.model, ms: Date.now() - started, scenes: story.screenplay.length });
    return { ...story, usage: response.usage, truncated: response.truncated };
  }
}

export function createOpenRouterProvider(
  model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL,
  env: NodeJS.ProcessEnv = process.env
): LLMProvider {
  return new OpenRouterLLMProvider({
    model,
    apiKey: env.OPENROUTER_API_KEY?.trim(),
    timeoutMs: openRouterTimeoutMs(env),
  });
}
