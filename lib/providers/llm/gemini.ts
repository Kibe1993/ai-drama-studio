import { GoogleGenAI } from "@google/genai";
import { log } from "@/lib/log";
import { geminiDiagnostics, geminiFailure } from "@/lib/providers/llm/errors";
import { parseStory } from "@/lib/providers/llm/parse";
import { storySystemPrompt, storyUserPrompt } from "@/lib/providers/llm/prompt";
import { requestCharacters, requestScenes, type StageTransport } from "@/lib/providers/llm/stageTasks";
import type {
  CharacterModelResult,
  LlmClient,
  LLMProvider,
  SceneModelResult,
  StoryCallOptions,
  StoryModelResult,
  StoryPrompt,
} from "@/lib/providers/llm/types";
import type { CharacterPrompt, ScenePrompt } from "@/lib/providers/llm/stageTasks";
import { JobError } from "@/lib/pipeline/types";
import { STORY_RESPONSE_SCHEMA } from "@/lib/validation/story";
import { requestStoryBible, type StoryBibleTaskInput } from "@/lib/providers/llm/storyBibleTask";

export const DEFAULT_LLM_MODEL = "gemini-flash-latest";
const STORY_TIMEOUT_MS = 90_000;

export function configuredLlmModel(): string {
  return process.env.GEMINI_MODEL?.trim() || process.env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL;
}

export class GeminiLLMProvider implements LLMProvider {
  readonly id = "gemini";
  readonly model: string;

  constructor(
    private readonly options: {
      model: string;
      apiKey: string | undefined;
      selectedProvider?: string;
      client?: LlmClient;
    }
  ) {
    this.model = options.model;
  }

  async generateStory(input: StoryPrompt, options: StoryCallOptions = {}): Promise<StoryModelResult> {
    if (!this.options.apiKey) {
      throw new JobError("GEMINI_API_KEY is not set. Story generation is unavailable.", "configuration", false);
    }
    const client = this.options.client ?? googleClient(this.options.apiKey);
    const started = Date.now();
    const signal = AbortSignal.any([
      AbortSignal.timeout(STORY_TIMEOUT_MS),
      ...(options.signal ? [options.signal] : []),
    ]);
    log.info("gemini", "request", {
      model: this.model,
      genre: input.genre,
      language: input.language,
      seconds: input.targetDurationSeconds,
      ideaChars: input.idea.length,
    });
    try {
      const response = await client.complete({
        model: this.model,
        system: storySystemPrompt(),
        prompt: storyUserPrompt(input),
        jsonSchema: STORY_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        signal,
      });
      const story = parseStory("Gemini", response.text);
      log.info("gemini", "response", {
        model: this.model,
        title: story.title,
        scenes: story.screenplay.length,
        ms: Date.now() - started,
      });
      return { ...story, usage: response.usage };
    } catch (error) {
      if (error instanceof JobError) {
        log.error("gemini", "rejected", { model: this.model, code: error.code, ms: Date.now() - started });
        throw error;
      }
      const diagnostic = geminiDiagnostics(error);
      log.error("gemini", "diagnostic", {
        name: diagnostic.name,
        httpStatus: diagnostic.httpStatus,
        googleStatus: diagnostic.googleStatus,
        causeCode: diagnostic.causeCode,
        detail: diagnostic.detail,
        ms: Date.now() - started,
        model: this.model,
        applicationTimeout: diagnostic.applicationTimeout,
      });
      const failure = geminiFailure(error);
      log.error("gemini", "request failed", { model: this.model, code: failure.code, ms: Date.now() - started });
      throw failure;
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

  async generateStoryBible(input: StoryBibleTaskInput, options?: StoryCallOptions) {
    const generated = await requestStoryBible(this.stageTransport(), input, options);
    return { result: generated.result, usage: generated.usage };
  }

  private stageTransport(): StageTransport {
    return {
      label: "Gemini",
      request: async (system, prompt, schema, signal) => {
        if (!this.options.apiKey) {
          throw new JobError("GEMINI_API_KEY is not set.", "configuration", false);
        }
        const client = this.options.client ?? googleClient(this.options.apiKey);
        return client.complete({ model: this.model, system, prompt, jsonSchema: schema, signal });
      },
    };
  }
}

function googleClient(apiKey: string): LlmClient {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { retryOptions: { attempts: 1 } },
  });
  return {
    async complete(input) {
      const response = await ai.models.generateContent({
        model: input.model,
        contents: input.prompt,
        config: {
          systemInstruction: input.system,
          responseMimeType: "application/json",
          responseJsonSchema: input.jsonSchema,
          abortSignal: input.signal,
        },
      });
      const usage = response.usageMetadata;
      const inputTokens = typeof usage?.promptTokenCount === "number" ? usage.promptTokenCount : undefined;
      const outputTokens = typeof usage?.candidatesTokenCount === "number" ? usage.candidatesTokenCount : undefined;
      return {
        text: response.text ?? "",
        usage: inputTokens == null && outputTokens == null ? undefined : { inputTokens, outputTokens },
      };
    },
  };
}

export function createGeminiProvider(model = configuredLlmModel()): LLMProvider {
  return new GeminiLLMProvider({
    model,
    apiKey: process.env.GEMINI_API_KEY?.trim(),
  });
}
