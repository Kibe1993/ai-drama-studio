import { log } from "@/lib/log";
import { parseStory } from "@/lib/providers/llm/parse";
import { chatJson } from "@/lib/providers/llm/chat";
import { storySystemPrompt, storyUserPrompt } from "@/lib/providers/llm/prompt";
import { bindChatStages } from "@/lib/providers/llm/chatStages";
import type { LLMProvider, StoryCallOptions, StoryModelResult, StoryPrompt } from "@/lib/providers/llm/types";
import { STORY_RESPONSE_SCHEMA } from "@/lib/validation/story";

export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

/**
 * GPT-6 Luna documents `gpt-6-luna` and says Chat Completions function calling
 * needs reasoning_effort none. The story request uses that setting so the
 * screenplay JSON is the response instead of a reasoning trace.
 */
export class OpenAILLMProvider implements LLMProvider {
  readonly id = "openai";
  readonly model: string;
  readonly generateCharacters: LLMProvider["generateCharacters"];
  readonly generateScenes: LLMProvider["generateScenes"];
  readonly generateStoryBible: NonNullable<LLMProvider["generateStoryBible"]>;

  constructor(private readonly options: { model: string; apiKey: string | undefined }) {
    this.model = options.model;
    const stages = bindChatStages({
      label: "OpenAI",
      apiKey: options.apiKey,
      model: options.model,
      schemaMode: "json_schema",
      strictSchema: true,
      extra: { reasoning_effort: "none" },
    });
    this.generateCharacters = stages.generateCharacters;
    this.generateScenes = stages.generateScenes;
    this.generateStoryBible = stages.generateStoryBible!;
  }

  async generateStory(input: StoryPrompt, options: StoryCallOptions = {}): Promise<StoryModelResult> {
    if (!this.options.apiKey) {
      throw new Error("OPENAI_API_KEY is not set.");
    }
    const signal = options.signal ?? AbortSignal.timeout(90_000);
    const started = Date.now();
    log.info("openai", "request", { model: this.model });
    const response = await chatJson({
      label: "OpenAI",
      apiKey: this.options.apiKey,
      model: this.model,
      system: storySystemPrompt(),
      prompt: storyUserPrompt(input),
      signal,
      timeoutMs: 90_000,
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "drama_screenplay",
          strict: true,
          schema: STORY_RESPONSE_SCHEMA,
        },
      },
      extra: { reasoning_effort: "none" },
    });
    const story = parseStory("OpenAI", response.text);
    log.info("openai", "response", { model: this.model, ms: Date.now() - started, scenes: story.screenplay.length });
    return { ...story, usage: response.usage };
  }
}

export function createOpenAIProvider(model = process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL): LLMProvider {
  return new OpenAILLMProvider({ model, apiKey: process.env.OPENAI_API_KEY?.trim() });
}
