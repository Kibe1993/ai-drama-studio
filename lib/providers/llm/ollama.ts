import { Agent } from "undici";
import { log } from "@/lib/log";
import { JobError } from "@/lib/pipeline/types";
import { storyCompletionBudget } from "@/lib/providers/llm/budget";
import { requestStoryContinuation } from "@/lib/providers/llm/continuation";
import { classifyProviderError, safeProviderDetail } from "@/lib/providers/llm/errors";
import { parseStory } from "@/lib/providers/llm/parse";
import { storySystemPrompt, storyUserPrompt } from "@/lib/providers/llm/prompt";
import {
  requestCharacters,
  requestEpisodeSuggestion,
  requestScenes,
  type CharacterPrompt,
  type EpisodeSuggestionPrompt,
  type ScenePrompt,
  type StageTransport,
} from "@/lib/providers/llm/stageTasks";
import {
  requestStoryBible,
  type StoryBibleTaskInput,
  type StoryBibleTaskTransport,
} from "@/lib/providers/llm/storyBibleTask";
import { requestSeasonPlan, requestSeasonArchitecture, requestEpisodeDetails, type SeasonPlanPrompt, type SeasonArchitecturePrompt, type EpisodeDetailBatchPrompt } from "@/lib/providers/llm/seasonPlanTask";
import { requestSceneRepair, type RepairScenesPrompt } from "@/lib/providers/llm/repairScenes";
import { requestEpisodeRevision, type EpisodeRevisionPrompt } from "@/lib/providers/llm/episodeRevision";
import { requestStoryCritique, type StoryCriticPrompt } from "@/lib/providers/llm/storyCritic";
import type {
  CharacterModelResult,
  EpisodeSuggestionModelResult,
  LLMProvider,
  RepairScenesModelResult,
  EpisodeRevisionModelResult,
  SceneModelResult,
  SeasonPlanModelResult,
  SeasonArchitectureModelResult,
  EpisodeDetailBatchModelResult,
  StoryBibleModelResult,
  StoryCallOptions,
  StoryContinuationModelResult,
  StoryCritiqueModelResult,
  StoryModelResult,
  StoryPrompt,
  TokenUsage,
} from "@/lib/providers/llm/types";
import { STORY_RESPONSE_SCHEMA, type ScreenplayScene } from "@/lib/validation/story";
import type { StoryBibleSection } from "@/lib/validation/storyBible";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_MODEL = "gemma3:4b";
export const DEFAULT_OLLAMA_ENDPOINT = "/api/chat";
export const DEFAULT_OLLAMA_TIMEOUT_MS = 240_000;
export const DEFAULT_OLLAMA_SECTION_TIMEOUT_MS = 600_000;
export const DEFAULT_OLLAMA_TEMPERATURE = 0.7;
export const DEFAULT_OLLAMA_NUM_CTX = 8192;
export const DEFAULT_OLLAMA_TOP_P = 0.9;

// Node.js's built-in fetch (undici) applies a default bodyTimeout of 300_000 ms
// (5 minutes). For streaming requests, this is the idle timeout before the first
// body chunk arrives — i.e. during Ollama's prompt_eval phase. A 4,156-token
// prompt at ~13 t/s prompt eval takes ~320 s, which exceeds the 300 s default
// and causes undici to abort the request before the manager's 600 s section
// timeout signal fires. This agent raises both timeouts to 600 s so the signal
// is the sole authority for request cancellation.
const ollamaHttpAgent = new Agent({
  headersTimeout: DEFAULT_OLLAMA_SECTION_TIMEOUT_MS,
  bodyTimeout: DEFAULT_OLLAMA_SECTION_TIMEOUT_MS,
});
export const DEFAULT_OLLAMA_REPEAT_PENALTY = 1.1;

export type OllamaOptions = {
  baseURL?: string;
  model?: string;
  endpoint?: string;
  timeoutMs?: number;
  sectionTimeoutMs?: number;
  temperature?: number;
  numCtx?: number;
  topP?: number;
  repeatPenalty?: number;
  formatMode?: "json" | "schema";
  extraOptions?: Record<string, unknown>;
};

export function ollamaBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.OLLAMA_BASE_URL?.trim();
  return (url || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
}

function numberFrom(value: string | undefined): number | null {
  const text = value?.trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ollamaModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
}

export function ollamaEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const ep = env.OLLAMA_ENDPOINT?.trim() || DEFAULT_OLLAMA_ENDPOINT;
  return ep.startsWith("/") ? ep : `/${ep}`;
}

export function ollamaTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = numberFrom(env.OLLAMA_TIMEOUT_MS);
  if (parsed === null) return DEFAULT_OLLAMA_TIMEOUT_MS;
  return Math.min(300_000, Math.max(10_000, parsed));
}

export function ollamaSectionTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = numberFrom(env.OLLAMA_SECTION_TIMEOUT_MS);
  if (parsed === null) return DEFAULT_OLLAMA_SECTION_TIMEOUT_MS;
  return Math.min(600_000, Math.max(10_000, parsed));
}

// Small sections on a 4B local model need bounded output, but the caps differ:
// characters and canon spend more tokens than identity or guidelines.
const OLLAMA_SECTION_NUM_PREDICT: Record<StoryBibleSection, number> = {
  identity: 1_500,
  world: 2_000,
  characters: 2_500,
  narrative: 2_000,
  guidelines: 1_500,
  canon: 2_000,
};

const MAX_STORY_NUM_CTX = 32_768;
const NUM_CTX_HEADROOM = 4_096;

/**
 * Keep num_ctx constant at the configured value to avoid model reloads.
 * Ollama reloads the model (≈15 s on a 4B model) whenever num_ctx changes
 * between calls.  Setting only num_predict lets every call reuse the
 * already-loaded model.  If the configured num_ctx is too small for a
 * particular output, Ollama truncates and downstream Zod validation
 * catches the incomplete response.
 */
function ollamaOptionsWithBudget(
  options: Record<string, unknown>,
  maxCompletionTokens: number
): Record<string, unknown> {
  const configured = Number(options.num_ctx);
  const base = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_OLLAMA_NUM_CTX;
  return { ...options, num_predict: maxCompletionTokens, num_ctx: base };
}

export function ollamaGenerationOptions(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const temperature = numberFrom(env.OLLAMA_TEMPERATURE);
  const numCtx = numberFrom(env.OLLAMA_NUM_CTX);
  const topP = numberFrom(env.OLLAMA_TOP_P);
  const repeatPenalty = numberFrom(env.OLLAMA_REPEAT_PENALTY);
  return {
    temperature: temperature === null ? DEFAULT_OLLAMA_TEMPERATURE : Math.max(0, Math.min(2, temperature)),
    num_ctx: numCtx === null || numCtx <= 0 ? DEFAULT_OLLAMA_NUM_CTX : numCtx,
    top_p: topP === null ? DEFAULT_OLLAMA_TOP_P : Math.max(0, Math.min(1, topP)),
    repeat_penalty:
      repeatPenalty === null ? DEFAULT_OLLAMA_REPEAT_PENALTY : Math.max(1.0, Math.min(2.0, repeatPenalty)),
  };
}

export type OllamaChatRequest = {
  baseURL?: string;
  model?: string;
  endpoint?: string;
  system?: string;
  prompt: string;
  format?: string | Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  options?: Record<string, unknown>;
  stream?: boolean;
  stage?: string;
};

export async function ollamaChat(
  request: OllamaChatRequest
): Promise<{ text: string; usage?: TokenUsage; truncated?: boolean }> {
  const baseURL = (request.baseURL || ollamaBaseUrl()).replace(/\/+$/, "");
  const model = request.model || ollamaModel();
  const endpoint = request.endpoint || ollamaEndpoint();
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const targetUrl = `${baseURL}${cleanEndpoint}`;
  const timeoutMs = request.timeoutMs ?? ollamaTimeoutMs();

  const messages: Array<{ role: string; content: string }> = [];
  if (request.system?.trim()) {
    messages.push({ role: "system", content: request.system.trim() });
  }
  messages.push({ role: "user", content: request.prompt });

  const payload: Record<string, unknown> = {
    model,
    messages,
    stream: Boolean(request.stream),
    options: {
      ...ollamaGenerationOptions(),
      ...request.options,
    },
  };
  if (request.format !== undefined) {
    payload.format = request.format;
  }

  const signal = request.signal
    ? request.signal
    : AbortSignal.timeout(timeoutMs);

  const started = Date.now();
  const stage = request.stage ?? "unknown";
  const formatMode = request.format === undefined ? "none" : typeof request.format === "string" ? request.format : "schema";
  const requestOptions = payload.options as Record<string, unknown>;
  log.info("ollama", "request", {
    stage,
    model,
    url: targetUrl,
    stream: Boolean(request.stream),
    numCtx: requestOptions.num_ctx,
    numPredict: requestOptions.num_predict,
    formatMode,
    effectiveTimeoutMs: request.signal ? "external" : timeoutMs,
    fallbackTimeoutMs: timeoutMs,
    httpBodyTimeoutMs: DEFAULT_OLLAMA_SECTION_TIMEOUT_MS,
  });

  let partialOutputTokens: number | undefined;
  let partialChars = 0;

  try {
    const fetchOptions: Record<string, unknown> = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
      dispatcher: ollamaHttpAgent,
    };
    const res = await fetch(targetUrl, fetchOptions as RequestInit);

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      const detail = safeProviderDetail(errorText);

      // Model not installed (HTTP 404 from Ollama with "not found")
      if (res.status === 404 && /not found/i.test(errorText)) {
        log.error("ollama", "model not installed", { stage, model, detail });
        throw new JobError(
          `Ollama model '${model}' is not installed. Run 'ollama pull ${model}' to install it.`,
          "invalid_model",
          false
        );
      }
      if (res.status === 400) {
        log.error("ollama", "rejected request", { stage, model, detail });
        throw new JobError(
          `Ollama rejected the request. ${detail}`,
          "invalid_request",
          false
        );
      }
      if (res.status === 429) {
        log.error("ollama", "rate limited", { stage, model, detail });
        throw new JobError(
          `Ollama is busy and rate limited the request. The next provider will be tried.`,
          "rate_limited",
          true
        );
      }
      if (res.status >= 500) {
        log.error("ollama", "service error", { stage, model, status: res.status, detail });
        throw new JobError(
          `Ollama service error (${res.status}): ${detail}`,
          "provider_unavailable",
          true
        );
      }
      throw new JobError(
        `Ollama request failed (${res.status}): ${detail}`,
        "provider_failed",
        false
      );
    }

    // Streaming lets a section survive Ollama's repeat-limit guard, which aborts
    // the request but still emits the text generated so far. parseStructured and
    // Zod then decide whether that partial output is usable.
    if (request.stream && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let streamError: string | null = null;
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let doneReason: string | undefined;
      let totalDuration: number | undefined;
      let loadDuration: number | undefined;
      let promptEvalDuration: number | undefined;
      let evalDuration: number | undefined;
      let firstTokenMs: number | undefined;
      const consume = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let chunk: {
          message?: { content?: string };
          error?: string;
          prompt_eval_count?: number;
          eval_count?: number;
          done_reason?: string;
          total_duration?: number;
          load_duration?: number;
          prompt_eval_duration?: number;
          eval_duration?: number;
        };
        try {
          chunk = JSON.parse(trimmed);
        } catch {
          return;
        }
        if (typeof chunk.error === "string" && chunk.error) {
          streamError = chunk.error;
          return;
        }
        if (typeof chunk.message?.content === "string") {
          if (firstTokenMs === undefined && chunk.message.content) firstTokenMs = Date.now() - started;
          text += chunk.message.content;
        }
        if (typeof chunk.prompt_eval_count === "number") inputTokens = chunk.prompt_eval_count;
        if (typeof chunk.eval_count === "number") outputTokens = chunk.eval_count;
        if (typeof chunk.done_reason === "string") doneReason = chunk.done_reason;
        if (typeof chunk.total_duration === "number") totalDuration = chunk.total_duration;
        if (typeof chunk.load_duration === "number") loadDuration = chunk.load_duration;
        if (typeof chunk.prompt_eval_duration === "number") promptEvalDuration = chunk.prompt_eval_duration;
        if (typeof chunk.eval_duration === "number") evalDuration = chunk.eval_duration;
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) consume(line);
        partialChars = text.length;
        partialOutputTokens = outputTokens;
      }
      consume(buffer);
      partialChars = text.length;
      partialOutputTokens = outputTokens;
      if (!text.trim()) {
        if (streamError) {
          log.error("ollama", "stream stopped", { stage, model, detail: safeProviderDetail(streamError) });
          throw new JobError(`Ollama stopped generating: ${safeProviderDetail(streamError)}`, "provider_unavailable", true);
        }
        log.error("ollama", "empty completion", { stage, model, ms: Date.now() - started });
        throw new JobError("Ollama returned an empty response.", "empty_response", false);
      }
      if (streamError) {
        log.error("ollama", "stream aborted with partial output", {
          stage,
          model,
          detail: safeProviderDetail(streamError),
          chars: text.length,
        });
      }
      const usage: TokenUsage | undefined =
        inputTokens == null && outputTokens == null ? undefined : { inputTokens, outputTokens };
      const elapsedMs = Date.now() - started;
      const tokensPerSec = outputTokens != null && evalDuration
        ? Number((outputTokens / (evalDuration / 1_000_000_000)).toFixed(2))
        : undefined;
      log.info("ollama", "response", {
        stage,
        model,
        ms: elapsedMs,
        stream: true,
        ttftMs: firstTokenMs ?? "",
        loadDurationNs: loadDuration ?? "",
        promptEvalDurationNs: promptEvalDuration ?? "",
        evalDurationNs: evalDuration ?? "",
        totalDurationNs: totalDuration ?? "",
        inputTokens: inputTokens ?? "",
        outputTokens: outputTokens ?? "",
        tokensPerSec: tokensPerSec ?? "",
        doneReason: doneReason ?? "",
      });
      return { text, usage, truncated: doneReason === "length" };
    }

    const data = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
      done_reason?: string;
      total_duration?: number;
      load_duration?: number;
      prompt_eval_duration?: number;
      eval_duration?: number;
    };

    const text = data.message?.content ?? "";
    if (!text.trim()) {
      log.error("ollama", "empty completion", { stage, model, ms: Date.now() - started });
      throw new JobError("Ollama returned an empty response.", "empty_response", false);
    }

    const inputTokens = typeof data.prompt_eval_count === "number" ? data.prompt_eval_count : undefined;
    const outputTokens = typeof data.eval_count === "number" ? data.eval_count : undefined;
    const usage: TokenUsage | undefined =
      inputTokens == null && outputTokens == null ? undefined : { inputTokens, outputTokens };
    const elapsedMs = Date.now() - started;
    const evalDuration = typeof data.eval_duration === "number" ? data.eval_duration : undefined;
    const tokensPerSec = outputTokens != null && evalDuration
      ? Number((outputTokens / (evalDuration / 1_000_000_000)).toFixed(2))
      : undefined;

    log.info("ollama", "response", {
      stage,
      model,
      ms: elapsedMs,
      stream: false,
      loadDurationNs: typeof data.load_duration === "number" ? data.load_duration : "",
      promptEvalDurationNs: typeof data.prompt_eval_duration === "number" ? data.prompt_eval_duration : "",
      evalDurationNs: evalDuration ?? "",
      totalDurationNs: typeof data.total_duration === "number" ? data.total_duration : "",
      inputTokens: inputTokens ?? "",
      outputTokens: outputTokens ?? "",
      tokensPerSec: tokensPerSec ?? "",
      doneReason: data.done_reason ?? "",
    });

    // Ollama reports done_reason "length" when it hit num_predict, i.e. the
    // output ceiling, so the response is not necessarily complete.
    return { text, usage, truncated: data.done_reason === "length" };
  } catch (error) {
    if (error instanceof JobError) throw error;

    const timeoutAbort =
      (signal.aborted &&
        signal.reason &&
        typeof signal.reason === "object" &&
        (signal.reason as Error).name === "TimeoutError") ||
      (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"));

    if (timeoutAbort) {
      log.error("ollama", "timeout", {
        stage,
        model,
        timeoutMs,
        elapsedMs: Date.now() - started,
        partialTokens: partialOutputTokens ?? 0,
        partialChars,
      });
      throw new JobError(
        `Ollama timed out while generating with '${model}'. The next provider will be tried.`,
        "timeout",
        true
      );
    }

    const isConnRefused =
      (error && typeof error === "object" && "cause" in error && (error.cause as { code?: string })?.code === "ECONNREFUSED") ||
      (error instanceof Error && /econnrefused|fetch failed/i.test(error.message));

    if (isConnRefused) {
      log.error("ollama", "connection refused", { stage, model, url: targetUrl });
      throw new JobError(
        `Ollama is not running (connection refused at ${baseURL}). The next provider will be tried.`,
        "provider_unavailable",
        true
      );
    }

    throw classifyProviderError("Ollama", error);
  }
}

export class OllamaLLMProvider implements LLMProvider {
  readonly id = "ollama";
  readonly model: string;
  readonly baseURL: string;
  readonly endpoint: string;
  readonly timeoutMs: number;
  readonly sectionTimeoutMs: number;
  readonly formatMode: "json" | "schema";
  readonly options: Record<string, unknown>;

  private readonly stageTransport: StageTransport;
  private readonly storyBibleTransport: StoryBibleTaskTransport;
  private readonly sectionTransports: Partial<Record<StoryBibleSection, StoryBibleTaskTransport>> = {};

  constructor(options: OllamaOptions = {}) {
    this.model = options.model || ollamaModel();
    this.baseURL = (options.baseURL || ollamaBaseUrl()).replace(/\/+$/, "");
    this.endpoint = options.endpoint || ollamaEndpoint();
    this.timeoutMs = options.timeoutMs ?? ollamaTimeoutMs();
    this.sectionTimeoutMs = options.sectionTimeoutMs ?? ollamaSectionTimeoutMs();
    this.formatMode = options.formatMode ?? (process.env.OLLAMA_FORMAT === "schema" ? "schema" : "json");
    this.options = {
      ...ollamaGenerationOptions(),
      ...options.extraOptions,
    };

    const makeTransport = (
      label: string,
      stage: string,
      timeoutMs = this.timeoutMs,
      generationOptions = this.options,
      formatMode = this.formatMode,
      stream = false
    ): StoryBibleTaskTransport => ({
      label,
      stage,
      request: async (
        system: string,
        prompt: string,
        schema: Record<string, unknown>,
        signal: AbortSignal,
        maxCompletionTokens?: number
      ) => {
        const format = formatMode === "schema" ? schema : "json";
        return await ollamaChat({
          baseURL: this.baseURL,
          model: this.model,
          endpoint: this.endpoint,
          system,
          prompt,
          format,
          signal,
          timeoutMs,
          options: maxCompletionTokens ? ollamaOptionsWithBudget(generationOptions, maxCompletionTokens) : generationOptions,
          stream,
          stage,
        });
      },
    });

    this.stageTransport = makeTransport("Ollama", "stage");
    this.storyBibleTransport = makeTransport("Ollama", "story_bible");
    // Section schemas are small enough for structured output even on a 4B model,
    // and plain JSON mode lets the model rename required fields. Low-entropy
    // sampling and a wider repeat window keep long JSON strings from collapsing
    // into token loops, which Ollama aborts with a repeat-limit error.
    const sectionTemperature = Math.min(
      0.2,
      Math.max(0, Number(this.options.temperature ?? DEFAULT_OLLAMA_TEMPERATURE))
    );
    const sectionTopP = Math.min(
      0.8,
      Math.max(0, Number(this.options.top_p ?? DEFAULT_OLLAMA_TOP_P))
    );
    const sectionRepeatPenalty = Math.max(
      1.3,
      Number(this.options.repeat_penalty ?? DEFAULT_OLLAMA_REPEAT_PENALTY)
    );
    for (const section of Object.keys(OLLAMA_SECTION_NUM_PREDICT) as StoryBibleSection[]) {
      this.sectionTransports[section] = makeTransport("Ollama", `story_bible:${section}`, this.sectionTimeoutMs, {
        ...this.options,
        temperature: sectionTemperature,
        top_p: sectionTopP,
        repeat_penalty: sectionRepeatPenalty,
        repeat_last_n: 128,
        num_predict: OLLAMA_SECTION_NUM_PREDICT[section],
      }, "schema", true);
    }
  }

  async generateStory(input: StoryPrompt, options: StoryCallOptions = {}): Promise<StoryModelResult> {
    const signal = options.signal ?? AbortSignal.timeout(this.timeoutMs);
    const started = Date.now();
    log.info("ollama", "story request", { model: this.model });
    const format =
      this.formatMode === "schema"
        ? (STORY_RESPONSE_SCHEMA as unknown as Record<string, unknown>)
        : "json";
    const prompt = `${storyUserPrompt(input)}\nsceneNumber must be an integer. dialogue and charactersPresent must be arrays. Do not use an empty string where an object, array, or number belongs.`;
    const response = await ollamaChat({
      baseURL: this.baseURL,
      model: this.model,
      endpoint: this.endpoint,
      system: storySystemPrompt(),
      prompt,
      format,
      signal,
      timeoutMs: this.timeoutMs,
      options: ollamaOptionsWithBudget(this.options, storyCompletionBudget(input.targetDurationSeconds)),
      stage: "story",
    });
    const story = parseStory("Ollama", response.text);
    log.info("ollama", "story response", {
      model: this.model,
      ms: Date.now() - started,
      scenes: story.screenplay.length,
    });
    return { ...story, usage: response.usage, truncated: response.truncated };
  }

  async generateCharacters(input: CharacterPrompt, options: StoryCallOptions = {}): Promise<CharacterModelResult> {
    const result = await requestCharacters(this.stageTransport, input, options);
    return { characters: result.characters, usage: result.usage };
  }

  async generateScenes(input: ScenePrompt, options: StoryCallOptions = {}): Promise<SceneModelResult> {
    const result = await requestScenes(this.stageTransport, input, options);
    return { scenes: result.scenes, usage: result.usage };
  }

  async generateEpisodeSuggestion(input: EpisodeSuggestionPrompt, options: StoryCallOptions = {}): Promise<EpisodeSuggestionModelResult> {
    const result = await requestEpisodeSuggestion(this.stageTransport, input, options);
    return { suggestion: result.suggestion, usage: result.usage };
  }

  async generateStoryBible(input: StoryBibleTaskInput, options: StoryCallOptions = {}): Promise<StoryBibleModelResult> {
    const transport = input.mode === "section" && input.section
      ? this.sectionTransports[input.section] ?? this.storyBibleTransport
      : this.storyBibleTransport;
    const result = await requestStoryBible(transport, input, options);
    return { result: result.result, usage: result.usage };
  }

  async generateSeasonPlan(input: SeasonPlanPrompt, options?: StoryCallOptions): Promise<SeasonPlanModelResult> {
    const result = await requestSeasonPlan(this.stageTransport, input, options);
    return { ...result, provider: this.id, model: this.model };
  }

  async generateSeasonArchitecture(input: SeasonArchitecturePrompt, options?: StoryCallOptions): Promise<SeasonArchitectureModelResult> {
    const result = await requestSeasonArchitecture(this.stageTransport, input, options);
    return { ...result, provider: this.id, model: this.model };
  }

  async generateEpisodeDetails(input: EpisodeDetailBatchPrompt, options?: StoryCallOptions): Promise<EpisodeDetailBatchModelResult> {
    const result = await requestEpisodeDetails(this.stageTransport, input, options);
    return { ...result, provider: this.id, model: this.model };
  }

  async repairScenes(input: RepairScenesPrompt, options?: StoryCallOptions): Promise<RepairScenesModelResult> {
    const result = await requestSceneRepair(this.stageTransport, input, options);
    return { ...result, provider: this.id, model: this.model };
  }

  async reviseEpisode(input: EpisodeRevisionPrompt, options?: StoryCallOptions): Promise<EpisodeRevisionModelResult> {
    const result = await requestEpisodeRevision(this.stageTransport, input, options);
    return { ...result, provider: this.id, model: this.model };
  }

  async critiqueStory(input: StoryCriticPrompt, options?: StoryCallOptions): Promise<StoryCritiqueModelResult> {
    const result = await requestStoryCritique(this.stageTransport, input, options);
    return { ...result, provider: this.id, model: this.model };
  }

  async continueStory(
    input: StoryPrompt,
    written: ScreenplayScene[],
    options: StoryCallOptions = {}
  ): Promise<StoryContinuationModelResult> {
    return requestStoryContinuation(this.stageTransport, input, written, options);
  }

  async complete(input: {
    system?: string;
    prompt: string;
    schema?: Record<string, unknown> | null;
    signal?: AbortSignal;
    format?: string | Record<string, unknown>;
  }): Promise<{ text: string; usage?: TokenUsage }> {
    const format =
      input.format !== undefined
        ? input.format
        : input.schema
          ? this.formatMode === "schema"
            ? input.schema
            : "json"
          : undefined;

    return await ollamaChat({
      baseURL: this.baseURL,
      model: this.model,
      endpoint: this.endpoint,
      system: input.system,
      prompt: input.prompt,
      format,
      signal: input.signal,
      timeoutMs: this.timeoutMs,
      options: this.options,
      stage: "complete",
    });
  }
}

export function createOllamaProvider(
  model?: string,
  baseURL?: string
): LLMProvider {
  return new OllamaLLMProvider({
    model: model?.trim() || ollamaModel(),
    baseURL: baseURL?.trim() || ollamaBaseUrl(),
  });
}
