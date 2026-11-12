import Anthropic from "@anthropic-ai/sdk";
import { log } from "@/lib/log";
import { JobError } from "@/lib/pipeline/types";
import { classifyProviderError } from "@/lib/providers/llm/errors";
import { parseStory } from "@/lib/providers/llm/parse";
import { storySystemPrompt, storyUserPrompt } from "@/lib/providers/llm/prompt";
import { requestCharacters, requestScenes, type StageTransport } from "@/lib/providers/llm/stageTasks";
import type {
  CharacterModelResult,
  LLMProvider,
  SceneModelResult,
  StoryCallOptions,
  StoryModelResult,
  StoryPrompt,
} from "@/lib/providers/llm/types";
import type { CharacterPrompt, ScenePrompt } from "@/lib/providers/llm/stageTasks";
import { STORY_RESPONSE_SCHEMA } from "@/lib/validation/story";

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
          max_tokens: 8000,
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

  private stageTransport(): StageTransport {
    return {
      label: "Anthropic",
      request: async (system, prompt, schema, signal) => {
        if (!this.options.apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
        const client = new Anthropic({ apiKey: this.options.apiKey, maxRetries: 0, timeout: 90_000 });
        try {
          const message = await client.messages.create(
            {
              model: this.model,
              max_tokens: 8000,
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
          return { text, usage: inputTokens == null && outputTokens == null ? undefined : { inputTokens, outputTokens } };
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
