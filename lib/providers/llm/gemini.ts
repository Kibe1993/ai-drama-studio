import { GoogleGenAI } from "@google/genai";
import { log } from "@/lib/log";
import { storyCompletionBudget } from "@/lib/providers/llm/budget";
import { requestStoryContinuation } from "@/lib/providers/llm/continuation";
import { geminiDiagnostics, geminiFailure } from "@/lib/providers/llm/errors";
import { parseStory } from "@/lib/providers/llm/parse";
import { storySystemPrompt, storyUserPrompt } from "@/lib/providers/llm/prompt";
import { requestCharacters, requestEpisodeSuggestion, requestScenes, type StageTransport } from "@/lib/providers/llm/stageTasks";
import type {
  CharacterModelResult,
  EpisodeSuggestionModelResult,
  LlmClient,
  LLMProvider,
  SceneModelResult,
  StoryCallOptions,
  StoryContinuationModelResult,
  StoryModelResult,
  StoryPrompt,
} from "@/lib/providers/llm/types";
import type { CharacterPrompt, EpisodeSuggestionPrompt, ScenePrompt } from "@/lib/providers/llm/stageTasks";
import { JobError } from "@/lib/pipeline/types";
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
import { requestEpisodeRevision, type EpisodeRevisionPrompt } from "@/lib/providers/llm/episodeRevision";
import { requestStoryCritique, type StoryCriticPrompt } from "@/lib/providers/llm/storyCritic";
import type {
  RepairScenesModelResult,
  EpisodeRevisionModelResult,
  SeasonPlanModelResult,
  SeasonArchitectureModelResult,
  EpisodeDetailBatchModelResult,
  StoryCritiqueModelResult,
} from "@/lib/providers/llm/types";

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
        maxOutputTokens: storyCompletionBudget(input.targetDurationSeconds),
      });
      const story = parseStory("Gemini", response.text);
      log.info("gemini", "response", {
        model: this.model,
        title: story.title,
        scenes: story.screenplay.length,
        ms: Date.now() - started,
      });
      return { ...story, usage: response.usage, truncated: response.truncated };
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

  async reviseEpisode(input: EpisodeRevisionPrompt, options?: StoryCallOptions): Promise<EpisodeRevisionModelResult> {
    const result = await requestEpisodeRevision(this.stageTransport(), input, options);
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
      label: "Gemini",
      request: async (system, prompt, schema, signal, maxCompletionTokens) => {
        if (!this.options.apiKey) {
          throw new JobError("GEMINI_API_KEY is not set.", "configuration", false);
        }
        const client = this.options.client ?? googleClient(this.options.apiKey);
        return client.complete({ model: this.model, system, prompt, jsonSchema: schema, signal, maxOutputTokens: maxCompletionTokens });
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
          ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
        },
      });
      const usage = response.usageMetadata;
      const inputTokens = typeof usage?.promptTokenCount === "number" ? usage.promptTokenCount : undefined;
      const outputTokens = typeof usage?.candidatesTokenCount === "number" ? usage.candidatesTokenCount : undefined;
      // MAX_TOKENS is Gemini's finish reason for a response stopped at the
      // configured output ceiling.
      const truncated = String(response.candidates?.[0]?.finishReason ?? "") === "MAX_TOKENS";
      return {
        text: response.text ?? "",
        usage: inputTokens == null && outputTokens == null ? undefined : { inputTokens, outputTokens },
        truncated,
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
