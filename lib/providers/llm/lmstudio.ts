import { log } from "@/lib/log";
import { JobError } from "@/lib/pipeline/types";
import { chatJson } from "@/lib/providers/llm/chat";
import { bindChatStages } from "@/lib/providers/llm/chatStages";
import { storyCompletionBudget } from "@/lib/providers/llm/budget";
import { storySystemPrompt, storyUserPrompt } from "@/lib/providers/llm/prompt";
import { parseStory } from "@/lib/providers/llm/parse";
import { classifyProviderError, safeProviderDetail } from "@/lib/providers/llm/errors";
import { STORY_RESPONSE_SCHEMA } from "@/lib/validation/story";
import type { LLMProvider, StoryCallOptions, StoryModelResult, StoryPrompt, TokenUsage } from "@/lib/providers/llm/types";

export const DEFAULT_LMSTUDIO_BASE_URL = "http://127.0.0.1:1234/v1";
export const DEFAULT_LMSTUDIO_MODEL = "qwen3-4b-instruct-2507";
export const DEFAULT_LMSTUDIO_API_KEY = "lm-studio";
export const DEFAULT_LMSTUDIO_TIMEOUT_MS = 900_000;
export const DEFAULT_LMSTUDIO_SECTION_TIMEOUT_MS = 600_000;
export const DEFAULT_LMSTUDIO_STORY_TIMEOUT_MS = 900_000;
export const DEFAULT_LMSTUDIO_TEMPERATURE = 0.7;

function numberFrom(value: string | undefined): number | null {
  const text = value?.trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function lmstudioBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.LMSTUDIO_BASE_URL?.trim();
  return (url || DEFAULT_LMSTUDIO_BASE_URL).replace(/\/+$/, "");
}

export function lmstudioModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.LMSTUDIO_MODEL?.trim() || DEFAULT_LMSTUDIO_MODEL;
}

export function lmstudioApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.LMSTUDIO_API_KEY?.trim() || DEFAULT_LMSTUDIO_API_KEY;
}

export function lmstudioTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = numberFrom(env.LMSTUDIO_TIMEOUT_MS);
  if (parsed === null) return DEFAULT_LMSTUDIO_TIMEOUT_MS;
  return Math.min(3_600_000, Math.max(10_000, parsed));
}

export function lmstudioSectionTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = numberFrom(env.LMSTUDIO_SECTION_TIMEOUT_MS);
  if (parsed === null) return DEFAULT_LMSTUDIO_SECTION_TIMEOUT_MS;
  return Math.min(3_600_000, Math.max(10_000, parsed));
}

export function lmstudioStoryTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = numberFrom(env.LMSTUDIO_STORY_TIMEOUT_MS);
  if (parsed === null) return DEFAULT_LMSTUDIO_STORY_TIMEOUT_MS;
  return Math.min(3_600_000, Math.max(10_000, parsed));
}

export function lmstudioEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.LMSTUDIO_ENABLED?.trim().toLowerCase();
  if (value === "false" || value === "0" || value === "off") return false;
  return true;
}

export type LmStudioHealthStatus = {
  status: "unavailable" | "server_running" | "model_loaded";
  modelLoaded: boolean;
  serverRunning: boolean;
  detail: string;
  models?: string[];
};

export async function checkLmStudioHealth(
  baseURL: string,
  model: string,
  signal?: AbortSignal,
): Promise<LmStudioHealthStatus> {
  const url = `${baseURL.replace(/\/+$/, "")}/models`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: signal ?? AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      const detail = safeProviderDetail(await res.text().catch(() => ""));
      return {
        status: "server_running",
        modelLoaded: false,
        serverRunning: true,
        detail: `LM Studio API responded with HTTP ${res.status}: ${detail}`,
      };
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const modelIds = (data.data ?? []).map((m) => m.id);
    const loaded = modelIds.some((id) => id === model || id.includes(model));
    return {
      status: loaded ? "model_loaded" : "server_running",
      modelLoaded: loaded,
      serverRunning: true,
      detail: loaded
        ? `Model '${model}' is loaded and available.`
        : `Model '${model}' is not loaded. Available models: ${modelIds.join(", ") || "(none)"}.`,
      models: modelIds,
    };
  } catch (error) {
    const isConnRefused =
      (error && typeof error === "object" && "cause" in error && (error.cause as { code?: string })?.code === "ECONNREFUSED") ||
      (error instanceof Error && /econnrefused|fetch failed/i.test(error.message));
    return {
      status: "unavailable",
      modelLoaded: false,
      serverRunning: false,
      detail: isConnRefused
        ? `LM Studio server is not running at ${baseURL}.`
        : `LM Studio health check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export type LmStudioOptions = {
  baseURL?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  sectionTimeoutMs?: number;
  storyTimeoutMs?: number;
  temperature?: number;
};

export class LmStudioLLMProvider implements LLMProvider {
  readonly id = "lmstudio";
  readonly model: string;
  readonly baseURL: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly sectionTimeoutMs: number;
  readonly storyTimeoutMs: number;

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
  readonly generateCanonSuggestions: NonNullable<LLMProvider["generateCanonSuggestions"]>;
  readonly generateCanonFacts: NonNullable<LLMProvider["generateCanonFacts"]>;

  constructor(options: LmStudioOptions = {}) {
    this.model = options.model || lmstudioModel();
    this.baseURL = (options.baseURL || lmstudioBaseUrl()).replace(/\/+$/, "");
    this.apiKey = options.apiKey || lmstudioApiKey();
    this.timeoutMs = options.timeoutMs ?? lmstudioTimeoutMs();
    this.sectionTimeoutMs = options.sectionTimeoutMs ?? lmstudioSectionTimeoutMs();
    this.storyTimeoutMs = options.storyTimeoutMs ?? lmstudioStoryTimeoutMs();

    const stages = bindChatStages({
      label: "LMStudio",
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      model: this.model,
      schemaMode: "json_schema",
      strictSchema: true,
      storyBibleStrictSchema: true,
      storyBibleTimeoutMs: this.sectionTimeoutMs,
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
    this.generateCanonSuggestions = stages.generateCanonSuggestions!;
    this.generateCanonFacts = stages.generateCanonFacts!;
  }

  async generateStory(input: StoryPrompt, options: StoryCallOptions = {}): Promise<StoryModelResult> {
    const signal = options.signal ?? AbortSignal.timeout(this.storyTimeoutMs);
    const started = Date.now();
    log.info("lmstudio", "story request", {
      model: this.model,
      baseURL: this.baseURL,
      storyTimeoutMs: this.storyTimeoutMs,
    });
    const response = await chatJson({
      label: "LMStudio",
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      model: this.model,
      system: storySystemPrompt(),
      prompt: storyUserPrompt(input),
      signal,
      timeoutMs: this.storyTimeoutMs,
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "drama_screenplay",
          strict: false,
          schema: STORY_RESPONSE_SCHEMA,
        },
      },
      maxCompletionTokens: storyCompletionBudget(input.targetDurationSeconds),
    });
    const story = parseStory("LMStudio", response.text);
    log.info("lmstudio", "story response", {
      model: this.model,
      ms: Date.now() - started,
      scenes: story.screenplay.length,
      inputTokens: response.usage?.inputTokens ?? "",
      outputTokens: response.usage?.outputTokens ?? "",
    });
    return { ...story, usage: response.usage, truncated: response.truncated };
  }

  async healthCheck(signal?: AbortSignal): Promise<LmStudioHealthStatus> {
    return checkLmStudioHealth(this.baseURL, this.model, signal);
  }
}

export function createLmStudioProvider(
  model?: string,
  baseURL?: string,
  apiKey?: string,
): LLMProvider {
  return new LmStudioLLMProvider({
    model: model?.trim() || lmstudioModel(),
    baseURL: baseURL?.trim() || lmstudioBaseUrl(),
    apiKey: apiKey?.trim() || lmstudioApiKey(),
  });
}