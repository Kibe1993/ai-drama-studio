import Anthropic from "@anthropic-ai/sdk";
import { log } from "@/lib/log";
import { JobError } from "@/lib/pipeline/types";
import { storyCompletionBudget } from "@/lib/providers/llm/budget";
import { requestStoryContinuation } from "@/lib/providers/llm/continuation";
import { classifyProviderError } from "@/lib/providers/llm/errors";
import { parseStory } from "@/lib/providers/llm/parse";
import { storySystemPrompt, storyUserPrompt } from "@/lib/providers/llm/prompt";
import { requestCharacters, requestEpisodeSuggestion, requestScenes, type StageTransport } from "@/lib/providers/llm/stageTasks";
import type {
  CharacterModelResult,
  EpisodeSuggestionModelResult,
  LLMProvider,
  SceneModelResult,
  StoryCallOptions,
  StoryContinuationModelResult,
  StoryModelResult,
  StoryPrompt,
} from "@/lib/providers/llm/types";
import type { CharacterPrompt, EpisodeSuggestionPrompt, ScenePrompt } from "@/lib/providers/llm/stageTasks";
import { STORY_RESPONSE_SCHEMA, type ScreenplayScene } from "@/lib/validation/story";
import { requestStoryBible, type StoryBibleTaskInput } from "@/lib/providers/llm/storyBibleTask";
import {
  requestSeasonPlan,
  requestSeasonArchitecture,
  requestEpisodeDetails,
  type SeasonPlanPrompt,
  type SeasonArchitecturePrompt,
  type EpisodeDetailBatchPrompt,
} from "@/lib/providers/llm/seasonPlanTask";
import { requestSceneRepair, type RepairScenesPrompt } from "@/lib/providers/llm/repairScenes";
import { requestStoryCritique, type StoryCriticPrompt } from "@/lib/providers/llm/storyCritic";
import type {
  RepairScenesModelResult,
  SeasonPlanModelResult,
  SeasonArchitectureModelResult,
  EpisodeDetailBatchModelResult,
  StoryCritiqueModelResult,
} from "@/lib/providers/llm/types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";

export class AnthropicLLMProvider implements LLMProvider {
  readonly id = "anthropic";
  readonly model: string;

  constructor(private readonly options: { model: string; apiKey: string | undefined }) {
    this.model = options.model;
  }

  async generateStory(input: StoryPrompt, options: StoryCallOptions = {}): Promise<StoryModelResult> {
    if (!this.options.apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set.");
    }
    const signal = options.signal ?? AbortSignal.timeout(90_000);
    const client = new Anthropic({ apiKey: this.options.apiKey, maxRetries: 0, timeout: 90_000 });
    const started = Date.now();
    log.info("anthropic", "request", { model: this.model });
    try {
      const message = await client.messages.create(
        {
          model: this.model,
          max_tokens: storyCompletionBudget(input.targetDurationSeconds),
          system: storySystemPrompt(),
          messages: [{ role: "user", content: storyUserPrompt(input) }],
          output_config: {
            format: {
              type: "json_schema",
              schema: STORY_RESPONSE_SCHEMA,
            },
          },
        },
        { signal, maxRetries: 0, timeout: 90_000 }
      );
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      const story = parseStory("Anthropic", text);
      const inputTokens = typeof message.usage?.input_tokens === "number" ? message.usage.input_tokens : undefined;
      const outputTokens = typeof message.usage?.output_tokens === "number" ? message.usage.output_tokens : undefined;
      log.info("anthropic", "response", { model: this.model, ms: Date.now() - started, scenes: story.screenplay.length });
      return {
        ...story,
        usage: inputTokens == null && outputTokens == null ? undefined : { inputTokens, outputTokens },
        truncated: message.stop_reason === "max_tokens",
      };
    } catch (error) {
      if (error instanceof JobError) throw error;
      throw classifyProviderError("Anthropic", error);
    }
  }

  async generateCharacters(input: CharacterPrompt, options: StoryCallOptions = {}): Promise<CharacterModelResult> {
    const result = await requestCharacters(this.stageTransport(), input, options);
    return { ...result, provider: this.id, model: this.model };
  }

  async generateScenes(input: ScenePrompt, options: StoryCallOptions = {}): Promise<SceneModelResult> {
    const result = await requestScenes(this.stageTransport(), input, options);
    return { ...result, provider: this.id, model: this.model };
  }

  async generateEpisodeSuggestion(input: EpisodeSuggestionPrompt, options?: StoryCallOptions): Promise<EpisodeSuggestionModelResult> {
    const result = await requestEpisodeSuggestion(this.stageTransport(), input, options);
    return { ...result, provider: this.id, model: this.model };
  }

  async generateStoryBible(input: StoryBibleTaskInput, options?: StoryCallOptions) {
    const generated = await requestStoryBible(this.stageTransport(), input, options);
    return { result: generated.result, usage: generated.usage };
  }

  async generateSeasonPlan(input: SeasonPlanPrompt, options?: StoryCallOptions): Promise<SeasonPlanModelResult> {
    const result = await requestSeasonPlan(this.stageTransport(), input, options);
    return { ...result, provider: this.id, model: this.model };
  }

  async generateSeasonArchitecture(input: SeasonArchitecturePrompt, options?: StoryCallOptions): Promise<SeasonArchitectureModelResult> {
    const result = await requestSeasonArchitecture(this.stageTransport(), input, options);
    return { ...result, provider: this.id, model: this.model };
  }

  async generateEpisodeDetails(input: EpisodeDetailBatchPrompt, options?: StoryCallOptions): Promise<EpisodeDetailBatchModelResult> {
    const result = await requestEpisodeDetails(this.stageTransport(), input, options);
    return { ...result, provider: this.id, model: this.model };
  }

  async repairScenes(input: RepairScenesPrompt, options?: StoryCallOptions): Promise<RepairScenesModelResult> {
    const result = await requestSceneRepair(this.stageTransport(), input, options);
    return { ...result, provider: this.id, model: this.model };
  }

  async critiqueStory(input: StoryCriticPrompt, options?: StoryCallOptions): Promise<StoryCritiqueModelResult> {
    const result = await requestStoryCritique(this.stageTransport(), input, options);
    return { ...result, provider: this.id, model: this.model };
  }

  async continueStory(
    input: StoryPrompt,
    written: ScreenplayScene[],
    options: StoryCallOptions = {}
  ): Promise<StoryContinuationModelResult> {
    return requestStoryContinuation(this.stageTransport(), input, written, options);
  }

  private stageTransport(): StageTransport {
    return {
      label: "Anthropic",
      request: async (system, prompt, schema, signal, maxCompletionTokens) => {
        if (!this.options.apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
        const client = new Anthropic({ apiKey: this.options.apiKey, maxRetries: 0, timeout: 90_000 });
        try {
          const message = await client.messages.create(
            {
              model: this.model,
              max_tokens: maxCompletionTokens ?? 8_000,
              system,
              messages: [{ role: "user", content: prompt }],
              output_config: { format: { type: "json_schema", schema } },
            },
            { signal, maxRetries: 0, timeout: 90_000 }
          );
          const text = message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("");
          const inputTokens = typeof message.usage?.input_tokens === "number" ? message.usage.input_tokens : undefined;
          const outputTokens = typeof message.usage?.output_tokens === "number" ? message.usage.output_tokens : undefined;
          return {
            text,
            usage: inputTokens == null && outputTokens == null ? undefined : { inputTokens, outputTokens },
            truncated: message.stop_reason === "max_tokens",
          };
        } catch (error) {
          if (error instanceof JobError) throw error;
          throw classifyProviderError("Anthropic", error);
        }
      },
    };
  }
}

export function createAnthropicProvider(
  model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL
): LLMProvider {
  return new AnthropicLLMProvider({ model, apiKey: process.env.ANTHROPIC_API_KEY?.trim() });
}
