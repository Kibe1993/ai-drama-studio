import { log } from "@/lib/log";
import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "@/lib/providers/llm/anthropic";
import { createDeepSeekProvider, DEFAULT_DEEPSEEK_MODEL } from "@/lib/providers/llm/deepseek";
import {
  DEFAULT_FREE_MODELS,
  freeModelAllowed,
  isFreeOnly,
  providerBlockedReason,
} from "@/lib/providers/llm/freePolicy";
import { createGeminiProvider, DEFAULT_LLM_MODEL } from "@/lib/providers/llm/gemini";
import { createGroqProvider } from "@/lib/providers/llm/groq";
import { createKimiProvider, DEFAULT_KIMI_MODEL } from "@/lib/providers/llm/kimi";
import { StoryProviderManager, type ProviderSlot, ProviderHealthTracker } from "@/lib/providers/llm/manager";
import { createMistralProvider } from "@/lib/providers/llm/mistral";
import {
  DEFAULT_OLLAMA_MODEL,
  OllamaLLMProvider,
  ollamaBaseUrl,
  ollamaEndpoint,
  ollamaGenerationOptions,
  ollamaSectionNumCtx,
  ollamaSectionTimeoutMs,
  ollamaStoryTimeoutMs,
  ollamaTimeoutMs,
} from "@/lib/providers/llm/ollama";
import { createLmStudioProvider, DEFAULT_LMSTUDIO_MODEL, LmStudioLLMProvider, lmstudioBaseUrl, lmstudioApiKey, lmstudioTimeoutMs, lmstudioSectionTimeoutMs, lmstudioStoryTimeoutMs, lmstudioEnabled } from "@/lib/providers/llm/lmstudio";
import { createOpenAIProvider, DEFAULT_OPENAI_MODEL } from "@/lib/providers/llm/openai";
import { createOpenRouterProvider, openRouterTimeoutMs } from "@/lib/providers/llm/openrouter";

import type { LLMProvider } from "@/lib/providers/llm/types";
import type { SeasonPlanPrompt, SeasonArchitecturePrompt, EpisodeDetailBatchPrompt } from "@/lib/providers/llm/seasonPlanTask";
import type { RepairScenesPrompt } from "@/lib/providers/llm/repairScenes";
import type { EpisodeRevisionPrompt } from "@/lib/providers/llm/episodeRevision";
import type { StoryCriticPrompt } from "@/lib/providers/llm/storyCritic";
import type { CanonExtractionPrompt } from "@/lib/providers/llm/canonExtractionTask";
import type { CanonFactExtractionTaskInput } from "@/lib/providers/llm/canonFactExtractionTask";

export const LLM_PROVIDER_IDS = [
  "ollama",
  "lmstudio",
  "gemini",
  "groq",
  "openrouter",
  "mistral",
  "openai",
  "anthropic",
  "deepseek",
  "kimi",
] as const;
export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

const DEFAULT_MODELS: Record<LlmProviderId, string> = {
  ollama: DEFAULT_OLLAMA_MODEL,
  lmstudio: DEFAULT_LMSTUDIO_MODEL,
  gemini: DEFAULT_LLM_MODEL,
  groq: DEFAULT_FREE_MODELS.groq,
  openrouter: DEFAULT_FREE_MODELS.openrouter,
  mistral: "mistral-small-latest",
  openai: DEFAULT_OPENAI_MODEL,
  anthropic: DEFAULT_ANTHROPIC_MODEL,
  deepseek: DEFAULT_DEEPSEEK_MODEL,
  kimi: DEFAULT_KIMI_MODEL,
};

const KEY_NAMES: Record<LlmProviderId, string> = {
  ollama: "",
  lmstudio: "LMSTUDIO_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  kimi: "KIMI_API_KEY",
};

function known(value: string): value is LlmProviderId {
  return (LLM_PROVIDER_IDS as readonly string[]).includes(value);
}

export function providerSequence(env?: {
  LLM_PROVIDER?: string;
  LLM_FALLBACK_PROVIDERS?: string;
}): string[] {
  const source = env ?? process.env;
  const primary = source.LLM_PROVIDER?.trim().toLowerCase() || "gemini";
  const defaultFallbacks = "groq,openrouter,mistral,openai,deepseek,kimi,anthropic,ollama";
  const rawFallbacks = source.LLM_FALLBACK_PROVIDERS !== undefined
    ? source.LLM_FALLBACK_PROVIDERS
    : defaultFallbacks;
  const fallbacks = rawFallbacks
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item) => item !== primary);
  return [primary, ...fallbacks];
}

export function modelFor(id: string, env: NodeJS.ProcessEnv, primary: string): string {
  if (!known(id)) return "";
  const specific = env[`${id.toUpperCase()}_MODEL`]?.trim();
  if (specific) return specific;
  if (id === primary && env.LLM_MODEL?.trim() && !isFreeOnly(env)) return env.LLM_MODEL.trim();
  if (isFreeOnly(env) && id in DEFAULT_FREE_MODELS) {
    return DEFAULT_FREE_MODELS[id as keyof typeof DEFAULT_FREE_MODELS];
  }
  return DEFAULT_MODELS[id];
}

export function credentialPresent(id: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!known(id)) return false;
  if (id === "ollama") {
    if (env.OLLAMA_DISABLED?.trim().toLowerCase() === "true") return false;
    if (env.OLLAMA_ENABLED?.trim().toLowerCase() === "false") return false;
    return true;
  }
  if (id === "lmstudio") {
    return lmstudioEnabled(env);
  }
  return Boolean(env[KEY_NAMES[id]]?.trim());
}

function adapter(id: LlmProviderId, model: string, env: NodeJS.ProcessEnv): LLMProvider {
  if (id === "ollama") {
    return new OllamaLLMProvider({
      model,
      baseURL: ollamaBaseUrl(env),
      endpoint: ollamaEndpoint(env),
      timeoutMs: ollamaTimeoutMs(env),
      sectionTimeoutMs: ollamaSectionTimeoutMs(env),
      storyTimeoutMs: ollamaStoryTimeoutMs(env),
      sectionNumCtx: ollamaSectionNumCtx(env),
      formatMode: env.OLLAMA_FORMAT?.trim().toLowerCase() === "schema" ? "schema" : "json",
      extraOptions: ollamaGenerationOptions(env),
    });
  }
  if (id === "lmstudio") {
    return new LmStudioLLMProvider({
      model,
      baseURL: lmstudioBaseUrl(env),
      apiKey: lmstudioApiKey(env),
      timeoutMs: lmstudioTimeoutMs(env),
      sectionTimeoutMs: lmstudioSectionTimeoutMs(env),
      storyTimeoutMs: lmstudioStoryTimeoutMs(env),
    });
  }
  if (id === "gemini") return createGeminiProvider(model);
  if (id === "groq") return createGroqProvider(model);
  if (id === "openrouter") return createOpenRouterProvider(model, env);
  if (id === "mistral") return createMistralProvider(model);
  if (id === "openai") return createOpenAIProvider(model);
  if (id === "anthropic") return createAnthropicProvider(model);
  if (id === "kimi") return createKimiProvider(model);
  return createDeepSeekProvider(model);
}

export function buildSlots(env: NodeJS.ProcessEnv = process.env): ProviderSlot[] {
  const primary = env.LLM_PROVIDER?.trim().toLowerCase() || "gemini";
  const freeOnly = isFreeOnly(env);
  const testMode = env.LLM_TEST_MODE?.trim().toLowerCase() || "";
  const sequenceConfig = testMode === "lmstudio"
    ? { LLM_PROVIDER: "lmstudio", LLM_FALLBACK_PROVIDERS: "" }
    : { LLM_PROVIDER: env.LLM_PROVIDER, LLM_FALLBACK_PROVIDERS: env.LLM_FALLBACK_PROVIDERS };
  if (testMode === "lmstudio") {
    log.info("llm", "exclusive test mode active", { mode: "lmstudio" });
  }
  return providerSequence(sequenceConfig).map((id) => {
    if (!known(id)) {
      return {
        id,
        model: "",
        configured: false,
        supported: false,
        reason: "That language provider is not registered.",
        async generate() {
          throw new Error("Unsupported language provider.");
        },
      };
    }
    const model = modelFor(id, env, primary);
    const blocked = providerBlockedReason(id, model, freeOnly);
    const provider = blocked ? null : adapter(id, model, env);
    const configured = credentialPresent(id, env);
    return {
      id,
      model,
      configured,
      supported: !blocked,
      reason: blocked ?? undefined,
      timeoutMs: id === "ollama"
        ? ollamaTimeoutMs(env)
        : id === "lmstudio"
          ? lmstudioTimeoutMs(env)
          : id === "openrouter"
            ? openRouterTimeoutMs(env)
            : undefined,
      sectionTimeoutMs: id === "ollama"
        ? ollamaSectionTimeoutMs(env)
        : id === "lmstudio"
          ? lmstudioSectionTimeoutMs(env)
          : undefined,
      storyTimeoutMs: id === "ollama"
        ? ollamaStoryTimeoutMs(env)
        : id === "lmstudio"
          ? lmstudioStoryTimeoutMs(env)
          : undefined,
      async generate(input, options) {
        if (!provider) throw new Error(blocked ?? "Provider is not available.");
        const result = await provider.generateStory(input, { signal: options.signal });
        return {
          story: {
            title: result.title,
            synopsis: result.synopsis,
            structure: result.structure,
            screenplay: result.screenplay,
          },
          usage: result.usage,
          truncated: result.truncated,
        };
      },
      async continueStory(input, written, options) {
        if (!provider?.continueStory) throw new Error(blocked ?? "Provider cannot continue a screenplay.");
        const result = await provider.continueStory(input, written, { signal: options.signal });
        return { screenplay: result.screenplay, usage: result.usage, truncated: result.truncated };
      },
      async generateCharacters(input, options) {
        if (!provider) throw new Error(blocked ?? "Provider is not available.");
        const result = await provider.generateCharacters(input, { signal: options.signal });
        return { characters: result.characters, usage: result.usage };
      },
      async generateScenes(input, options) {
        if (!provider) throw new Error(blocked ?? "Provider is not available.");
        const result = await provider.generateScenes(input, { signal: options.signal });
        return { scenes: result.scenes, usage: result.usage };
      },
      async generateStoryBible(input, options) {
        if (!provider?.generateStoryBible) throw new Error(blocked ?? "Provider cannot develop a Story Bible.");
        const result = await provider.generateStoryBible(input, { signal: options.signal });
        return { result: result.result, usage: result.usage };
      },
      async generateEpisodeSuggestion(input, options) {
        if (!provider?.generateEpisodeSuggestion) throw new Error(blocked ?? "Provider cannot suggest an episode.");
        const result = await provider.generateEpisodeSuggestion(input, { signal: options.signal });
        return { suggestion: result.suggestion, usage: result.usage };
      },
      // Capability-scoped methods are only present when the adapter supports
      // them, so the manager's capability filter can skip a provider that would
      // simply fail instead of blocking failover.
      ...(provider && "generateSeasonPlan" in provider && provider.generateSeasonPlan
        ? {
            async generateSeasonPlan(input: SeasonPlanPrompt, options: { signal: AbortSignal }) {
              const result = await provider!.generateSeasonPlan!(input, { signal: options.signal });
              return { plan: result.plan, usage: result.usage };
            },
          }
        : {}),
      ...(provider && "generateSeasonArchitecture" in provider && provider.generateSeasonArchitecture
        ? {
            async generateSeasonArchitecture(input: SeasonArchitecturePrompt, options: { signal: AbortSignal }) {
              const result = await provider!.generateSeasonArchitecture!(input, { signal: options.signal });
              return { architecture: result.architecture, usage: result.usage };
            },
          }
        : {}),
      ...(provider && "generateEpisodeDetails" in provider && provider.generateEpisodeDetails
        ? {
            async generateEpisodeDetails(input: EpisodeDetailBatchPrompt, options: { signal: AbortSignal }) {
              const result = await provider!.generateEpisodeDetails!(input, { signal: options.signal });
              return { batch: result.batch, usage: result.usage };
            },
          }
        : {}),
      ...(provider && "repairScenes" in provider && provider.repairScenes
        ? {
            async repairScenes(input: RepairScenesPrompt, options: { signal: AbortSignal }) {
              const result = await provider!.repairScenes!(input, { signal: options.signal });
              return { screenplay: result.screenplay, usage: result.usage };
            },
          }
        : {}),
      ...(provider && "reviseEpisode" in provider && provider.reviseEpisode
        ? {
            async reviseEpisode(input: EpisodeRevisionPrompt, options: { signal: AbortSignal }) {
              const result = await provider!.reviseEpisode!(input, { signal: options.signal });
              return { episode: result.episode, usage: result.usage };
            },
          }
        : {}),
      ...(provider && "critiqueStory" in provider && provider.critiqueStory
        ? {
            async critiqueStory(input: StoryCriticPrompt, options: { signal: AbortSignal }) {
              const result = await provider!.critiqueStory!(input, { signal: options.signal });
              return { findings: result.findings, usage: result.usage };
            },
          }
        : {}),
      ...(provider && "generateCanonSuggestions" in provider && provider.generateCanonSuggestions
        ? {
            async generateCanonSuggestions(input: CanonExtractionPrompt, options: { signal: AbortSignal }) {
              const result = await provider!.generateCanonSuggestions!(input, { signal: options.signal });
              return { response: result.response, usage: result.usage };
            },
          }
        : {}),
      ...(provider && "generateCanonFacts" in provider && provider.generateCanonFacts
        ? {
            async generateCanonFacts(input: CanonFactExtractionTaskInput, options: { signal: AbortSignal }) {
              const result = await provider!.generateCanonFacts!(input, { signal: options.signal });
              return { text: result.text, usage: result.usage };
            },
          }
        : {}),
    };
  });
}

const sharedHealthTracker = new ProviderHealthTracker();

export function createStoryProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const testMode = env.LLM_TEST_MODE?.trim().toLowerCase() || "";
  const exclusiveMode = testMode === "lmstudio";
  const slots = buildSlots(env);
  return new StoryProviderManager({
    slots,
    freeOnly: isFreeOnly(env),
    healthTracker: sharedHealthTracker,
    taskRouting: !exclusiveMode,
  });
}

export function describeLlmSetup(env: NodeJS.ProcessEnv = process.env) {
  const sequence = providerSequence({
    LLM_PROVIDER: env.LLM_PROVIDER,
    LLM_FALLBACK_PROVIDERS: env.LLM_FALLBACK_PROVIDERS,
  });
  const primary = sequence[0] ?? "gemini";
  const freeOnly = isFreeOnly(env);
  return LLM_PROVIDER_IDS.map((id) => {
    const model = modelFor(id, env, primary);
    return {
      provider: id,
      configured: credentialPresent(id, env),
      model,
      registered: true,
      inSequence: sequence.includes(id),
      freeOnly,
      freeEligible: freeModelAllowed(id, model),
    };
  });
}

export function logLlmSetup(env: NodeJS.ProcessEnv = process.env): void {
  const sequence = providerSequence({
    LLM_PROVIDER: env.LLM_PROVIDER,
    LLM_FALLBACK_PROVIDERS: env.LLM_FALLBACK_PROVIDERS,
  });
  const freeOnly = isFreeOnly(env);
  const recognized = sequence.filter((id) => known(id) && !providerBlockedReason(id, modelFor(id, env, sequence[0] ?? "gemini"), freeOnly));
  log.info("llm", "startup sequence", {
    order: recognized.join(","),
    freeOnly,
    fallbackConfigured: Boolean(env.LLM_FALLBACK_PROVIDERS?.trim()),
    unrecognizedCount: sequence.length - sequence.filter((id) => known(id)).length,
  });
  for (const row of describeLlmSetup(env)) {
    log.info("llm", "startup", row);
  }
}
