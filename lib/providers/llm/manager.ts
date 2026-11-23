import { log } from "@/lib/log";
import { JobError } from "@/lib/pipeline/types";
import { minimumScenesForDuration } from "@/lib/providers/llm/budget";
import { MAX_CONTINUATION_ROUNDS, mergeScreenplays } from "@/lib/providers/llm/continuation";
import { classifyProviderError, ClassifiedProviderError, safeProviderDetail, statusOf } from "@/lib/providers/llm/errors";
import {
  type CostPolicy,
  type ProviderAvailabilityManager,
  aspoAttemptResult,
  aspoAttemptStart,
  aspoEligibleProviders,
  aspoFallback,
  aspoGenerationFailed,
  aspoGenerationSucceeded,
  aspoHealthUpdated,
  classifyFailure,
  cooldownFor as aspoCooldownFor,
  isCostEligible,
  recoveryFor,
} from "@/lib/providers/llm/aspo";
import type { CharacterPrompt, EpisodeSuggestionPrompt, ScenePrompt, SeasonPlanPrompt } from "@/lib/providers/llm/stageTasks";
import type { RepairScenesPrompt } from "@/lib/providers/llm/repairScenes";
import { repairScenesResultSchema } from "@/lib/providers/llm/repairScenes";
import type { EpisodeRevisionPrompt } from "@/lib/providers/llm/episodeRevision";
import type { StoryCriticFinding, StoryCriticPrompt } from "@/lib/providers/llm/storyCritic";
import { storyCritiqueSchema } from "@/lib/providers/llm/storyCritic";
import type { CanonExtractionPrompt } from "@/lib/providers/llm/canonExtractionTask";
import type { CanonFactExtractionTaskInput } from "@/lib/providers/llm/canonFactExtractionTask";
import { canonExtractionResponseSchema, type CanonExtractionResponse } from "@/lib/validation/canonExtraction";
import { canonExtractionResultSchema } from "@/lib/validation/canonExtractionResult";
import { assertScreenplayPacing } from "@/lib/providers/llm/stageTasks";
import type {
  AttemptRecord,
  CharacterModelResult,
  EpisodeSuggestionModelResult,
  LLMProvider,
  RepairScenesModelResult,
  EpisodeRevisionModelResult,
  SceneModelResult,
  SeasonPlanModelResult,
  SeasonArchitectureModelResult,
  EpisodeDetailBatchModelResult,
  StoryCallOptions,

  StoryCritiqueModelResult,
  CanonExtractionModelResult,
  CanonFactExtractionModelResult,
  StoryModelResult,
  StoryPrompt,
  TokenUsage,
} from "@/lib/providers/llm/types";
import type { SeasonArchitecturePrompt, EpisodeDetailBatchPrompt } from "@/lib/providers/llm/seasonPlanTask";
import { episodeSuggestionSchema, type EpisodeSuggestion } from "@/lib/validation/episode";
import type { CharacterProfile, ProductionScene } from "@/lib/validation/productionStages";
import { generatedStorySchema, type GeneratedStory, type ScreenplayScene } from "@/lib/validation/story";
import { validateStoryBibleTaskResult, type StoryBibleTaskInput, type StoryBibleTaskResult } from "@/lib/providers/llm/storyBibleTask";
import { seasonPlanSchema, type SeasonPlan, type EpisodePlanItem, seasonArchitectureSchema, type SeasonArchitecture, episodeDetailBatchSchema, type EpisodeDetailBatch } from "@/lib/validation/seasonPlan";

export const DEFAULT_SEQUENCE_TIMEOUT_MS = 300_000;
export const DEFAULT_PROVIDER_TIMEOUT_MS = 90_000;
const MINIMUM_ATTEMPT_MS = 100;
const EMPTY_FIELD_RETRY_HINT = "Every required text field must be non-empty. Do not use empty strings for any required field.";

const PROVIDER_RETRY_COUNT = Number(process.env.LLM_PROVIDER_RETRY_COUNT ?? "4") || 4;
const RETRYABLE_CODES = new Set(["rate_limited", "timeout", "provider_unavailable", "connection_error", "provider_overloaded", "provider_failed"]);

export const FAILOVER_CODES = new Set([
  "rate_limited",
  "timeout",
  "provider_unavailable",
  "provider_failed",
  "empty_response",
  "invalid_json",
  "invalid_schema",
  "invalid_request",
  "quota_exhausted",
  "invalid_model",
  "truncated_output",
  "content_validation_error",
  "provider_overloaded",
  "billing_error",
  "authentication_error",
  "permission_error",
  "connection_error",
  "prompt_too_large",
]);

const TRANSPORT_CODES = new Set(["rate_limited", "timeout", "provider_unavailable", "quota_exhausted", "connection_error", "provider_overloaded"]);

const COOLDOWN_MS: Record<string, number> = {
  rate_limited: 30_000,
  timeout: 60_000,
  provider_unavailable: 60_000,
  quota_exhausted: 300_000,
  provider_failed: 15_000,
  empty_response: 15_000,
  invalid_json: 5_000,
  invalid_schema: 5_000,
  invalid_request: 5_000,
  invalid_model: 300_000,
  truncated_output: 5_000,
  content_validation_error: 5_000,
  provider_overloaded: 15_000,
  billing_error: 300_000,
  authentication_error: 300_000,
  permission_error: 300_000,
  connection_error: 15_000,
  prompt_too_large: 5_000,
};

function cooldownFor(code: string): number {
  return COOLDOWN_MS[code] ?? 15_000;
}

export class ProviderHealthTracker {
  private failures = new Map<string, number>();

  recordFailure(providerId: string, code: string): void {
    const cooldown = cooldownFor(code);
    const until = Date.now() + cooldown;
    const existing = this.failures.get(providerId);
    if (existing === undefined || existing < until) {
      this.failures.set(providerId, until);
    }
  }

  isHealthy(providerId: string): boolean {
    const until = this.failures.get(providerId);
    if (until === undefined) return true;
    if (Date.now() >= until) {
      this.failures.delete(providerId);
      return true;
    }
    return false;
  }

  clear(): void {
    this.failures.clear();
  }
}

const FAST_PROVIDERS = new Set(["groq", "openrouter", "mistral"]);
const STRUCTURED_TASKS = new Set(["characters", "scenes", "episode_suggestion", "scene_repair", "story_critic", "season_architecture", "episode_details"]);

function routeByTask(task: string, slots: ProviderSlot[]): ProviderSlot[] {
  if (slots.length <= 2 || !STRUCTURED_TASKS.has(task)) return slots;
  const [primary, ...fallbacks] = slots;
  if (!primary) return slots;
  const fast = fallbacks.filter((s) => FAST_PROVIDERS.has(s.id));
  const slow = fallbacks.filter((s) => !FAST_PROVIDERS.has(s.id));
  return [primary, ...fast, ...slow];
}

export type ProviderSlot = {
  id: string;
  model: string;
  configured: boolean;
  supported?: boolean;
  reason?: string;
  timeoutMs?: number;
  sectionTimeoutMs?: number;
  storyTimeoutMs?: number;
  generate(
    input: StoryPrompt,
    options: { signal: AbortSignal }
  ): Promise<{ story: GeneratedStory; usage?: TokenUsage; truncated?: boolean }>;
  continueStory?(
    input: StoryPrompt,
    written: ScreenplayScene[],
    options: { signal: AbortSignal }
  ): Promise<{ screenplay: ScreenplayScene[]; usage?: TokenUsage; truncated?: boolean }>;
  generateCharacters?(
    input: CharacterPrompt,
    options: { signal: AbortSignal }
  ): Promise<{ characters: CharacterProfile[]; usage?: TokenUsage }>;
  generateScenes?(
    input: ScenePrompt,
    options: { signal: AbortSignal }
  ): Promise<{ scenes: ProductionScene[]; usage?: TokenUsage }>;
  generateStoryBible?(
    input: StoryBibleTaskInput,
    options: { signal: AbortSignal }
  ): Promise<{ result: StoryBibleTaskResult; usage?: TokenUsage }>;
  generateEpisodeSuggestion?(
    input: EpisodeSuggestionPrompt,
    options: { signal: AbortSignal }
  ): Promise<{ suggestion: EpisodeSuggestion; usage?: TokenUsage }>;
  generateSeasonPlan?(
    input: SeasonPlanPrompt,
    options: { signal: AbortSignal }
  ): Promise<{ plan: SeasonPlan; usage?: TokenUsage }>;
  generateSeasonArchitecture?(
    input: SeasonArchitecturePrompt,
    options: { signal: AbortSignal }
  ): Promise<{ architecture: SeasonArchitecture; usage?: TokenUsage }>;
  generateEpisodeDetails?(
    input: EpisodeDetailBatchPrompt,
    options: { signal: AbortSignal }
  ): Promise<{ batch: EpisodeDetailBatch; usage?: TokenUsage }>;
  repairScenes?(
    input: RepairScenesPrompt,
    options: { signal: AbortSignal }
  ): Promise<{ screenplay: ScreenplayScene[]; usage?: TokenUsage }>;
  reviseEpisode?(
    input: EpisodeRevisionPrompt,
    options: { signal: AbortSignal }
  ): Promise<{ episode: EpisodePlanItem; usage?: TokenUsage }>;
  critiqueStory?(
    input: StoryCriticPrompt,
    options: { signal: AbortSignal }
  ): Promise<{ findings: StoryCriticFinding[]; usage?: TokenUsage }>;
  generateCanonSuggestions?(
    input: CanonExtractionPrompt,
    options: { signal: AbortSignal }
  ): Promise<{ response: CanonExtractionResponse; usage?: TokenUsage }>;
  generateCanonFacts?(
    input: CanonFactExtractionTaskInput,
    options: { signal: AbortSignal }
  ): Promise<{ text: string; usage?: TokenUsage }>;
};

export class LlmSequenceError extends JobError {
  constructor(
    message: string,
    code: string,
    retryable: boolean,
    readonly attempts: AttemptRecord[]
  ) {
    super(message, code, retryable);
  }
}

export function sequenceTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LLM_SEQUENCE_TIMEOUT_MS?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_SEQUENCE_TIMEOUT_MS;
  return Math.min(300_000, Math.max(15_000, parsed));
}

function providerLabel(id: string): string {
  if (id === "ollama") return "Ollama";
  if (id === "openai") return "OpenAI";
  if (id === "anthropic") return "Anthropic";
  if (id === "deepseek") return "DeepSeek";
  if (id === "gemini") return "Gemini";
  if (id === "groq") return "Groq";
  if (id === "openrouter") return "OpenRouter";
  if (id === "mistral") return "Mistral";
  if (id === "kimi") return "Kimi";
  return id;
}

function httpStatusOf(error: unknown): number | null {
  if (error instanceof ClassifiedProviderError) return error.httpStatus;
  return statusOf(error);
}

export class StoryProviderManager implements LLMProvider {
  readonly id: string;
  readonly model: string;

  constructor(
    private readonly options: {
      slots: ProviderSlot[];
      sequenceTimeoutMs?: number;
      providerTimeoutMs?: number;
      freeOnly?: boolean;
      healthTracker?: ProviderHealthTracker;
      taskRouting?: boolean;
      availabilityManager?: ProviderAvailabilityManager;
      costPolicy?: CostPolicy;
    }
  ) {
    this.id = options.slots[0]?.id ?? "llm";
    this.model = options.slots[0]?.model ?? "";
  }

  async generateStory(input: StoryPrompt, context: StoryCallOptions = {}): Promise<StoryModelResult> {
    const result = await this.runSequence(context, "story", "Generating story", async (slot, signal) => {
      const tryGenerate = async (generateInput: StoryPrompt): Promise<{ value: GeneratedStory; usage?: TokenUsage }> => {
        const generated = await slot.generate(generateInput, { signal });
        const parsed = generatedStorySchema.safeParse(generated.story);
        if (!parsed.success) {
          const emptyField = parsed.error.issues.some(
            (i) => i.code === "too_small" && (i as { type?: string }).type === "string" && (i as { minimum?: number }).minimum === 1
          );
          throw new JobError(
            `${providerLabel(slot.id)} returned a story that did not match the screenplay schema.`,
            "invalid_schema",
            false,
            emptyField ? { emptyField: true } : undefined
          );
        }
        const extended = await extendScreenplay(slot, generateInput, parsed.data.screenplay, generated.usage, generated.truncated, signal);
        assertScreenplayPacing(generateInput.targetDurationSeconds, extended.screenplay);
        return { value: { ...parsed.data, screenplay: extended.screenplay }, usage: extended.usage };
      };

      try {
        return await tryGenerate(input);
      } catch (error) {
        if (error instanceof JobError && error.code === "invalid_schema" && error.details?.emptyField) {
          const retryInput: StoryPrompt = {
            ...input,
            continuityContext: [input.continuityContext, EMPTY_FIELD_RETRY_HINT].filter(Boolean).join("\n\n"),
          };
          log.info("llm", "retrying with empty-field hint", { provider: slot.id, task: "story" });
          return await tryGenerate(retryInput);
        }
        throw error;
      }
    });
    return { ...result.value, provider: result.provider, model: result.model, fallbackFrom: result.fallbackFrom, attempts: result.attempts, usage: result.usage };
  }

  async generateCharacters(input: CharacterPrompt, context: StoryCallOptions = {}): Promise<CharacterModelResult> {
    const result = await this.runSequence(context, "characters", "Extracting characters", async (slot, signal) => {
      if (!slot.generateCharacters) {
        throw new JobError(`${providerLabel(slot.id)} cannot extract characters.`, "configuration", false);
      }
      const generated = await slot.generateCharacters(input, { signal });
      return { value: generated.characters, usage: generated.usage };
    });
    return {
      characters: result.value,
      provider: result.provider,
      model: result.model,
      fallbackFrom: result.fallbackFrom,
      attempts: result.attempts,
      usage: result.usage,
    };
  }

  async generateScenes(input: ScenePrompt, context: StoryCallOptions = {}): Promise<SceneModelResult> {
    const result = await this.runSequence(context, "scenes", "Preparing scenes", async (slot, signal) => {
      if (!slot.generateScenes) {
        throw new JobError(`${providerLabel(slot.id)} cannot break down scenes.`, "configuration", false);
      }
      const generated = await slot.generateScenes(input, { signal });
      return { value: generated.scenes, usage: generated.usage };
    });
    return {
      scenes: result.value,
      provider: result.provider,
      model: result.model,
      fallbackFrom: result.fallbackFrom,
      attempts: result.attempts,
      usage: result.usage,
    };
  }

  async generateStoryBible(input: StoryBibleTaskInput, context: StoryCallOptions = {}) {
    const sectionContext = { ...context, sectionMode: input.mode === "section" };
    const result = await this.runSequence(sectionContext, "story_bible", "Developing Story Bible", async (slot, signal) => {
      if (!slot.generateStoryBible) {
        throw new JobError(`${providerLabel(slot.id)} cannot develop a Story Bible.`, "configuration", false);
      }
      const maxEmptyFieldRetries = 3;
      let lastError: unknown = null;
      for (let attempt = 0; attempt <= maxEmptyFieldRetries; attempt += 1) {
        const retryInput: StoryBibleTaskInput = attempt === 0
          ? input
          : { ...input, instruction: [input.instruction, EMPTY_FIELD_RETRY_HINT, `Attempt ${attempt + 1}: every field must have substantive content.`].filter(Boolean).join("\n\n") };
        try {
          const generated = await slot.generateStoryBible(retryInput, { signal });
          return { value: validateStoryBibleTaskResult(retryInput, generated.result), usage: generated.usage };
        } catch (error) {
          if (
            error instanceof JobError &&
            error.code === "invalid_schema" &&
            (error.details as { emptyField?: boolean } | undefined)?.emptyField &&
            attempt < maxEmptyFieldRetries
          ) {
            log.info("llm", "retrying story bible section with empty-field hint", {
              provider: slot.id,
              section: input.section ?? "",
              attempt: attempt + 1,
            });
            lastError = error;
            continue;
          }
          throw error;
        }
      }
      throw lastError ?? new JobError("Story Bible generation failed after retries.", "invalid_schema", false);
    });
    return {
      result: result.value,
      provider: result.provider,
      model: result.model,
      fallbackFrom: result.fallbackFrom,
      attempts: result.attempts,
      usage: result.usage,
    };
  }

  async generateEpisodeSuggestion(input: EpisodeSuggestionPrompt, context: StoryCallOptions = {}): Promise<EpisodeSuggestionModelResult> {
    const result = await this.runSequence(context, "episode_suggestion", "Developing episode idea", async (slot, signal) => {
      if (!slot.generateEpisodeSuggestion) {
        throw new JobError(`${providerLabel(slot.id)} cannot suggest an episode.`, "configuration", false);
      }
      const generated = await slot.generateEpisodeSuggestion(input, { signal });
      const parsed = episodeSuggestionSchema.safeParse(generated.suggestion);
      if (!parsed.success) {
        throw new JobError(
          `${providerLabel(slot.id)} returned an episode idea that did not match the schema.`,
          "invalid_schema",
          false
        );
      }
      return { value: parsed.data, usage: generated.usage };
    }, (slot) => Boolean(slot.generateEpisodeSuggestion));
    return {
      suggestion: result.value,
      provider: result.provider,
      model: result.model,
      fallbackFrom: result.fallbackFrom,
      attempts: result.attempts,
      usage: result.usage,
    };
  }

  async generateSeasonPlan(input: SeasonPlanPrompt, context: StoryCallOptions = {}): Promise<SeasonPlanModelResult> {
    const result = await this.runSequence(context, "season_plan", "Developing season plan", async (slot, signal) => {
      if (!slot.generateSeasonPlan) {
        throw new JobError(`${providerLabel(slot.id)} cannot develop a season plan.`, "configuration", false);
      }
      const generated = await slot.generateSeasonPlan(input, { signal });
      const parsed = seasonPlanSchema.safeParse(generated.plan);
      if (!parsed.success) {
        throw new JobError(
          `${providerLabel(slot.id)} returned a season plan that did not match the schema.`,
          "invalid_schema",
          false
        );
      }
      return { value: parsed.data, usage: generated.usage };
    }, (slot) => Boolean(slot.generateSeasonPlan));
    return {
      plan: result.value,
      provider: result.provider,
      model: result.model,
      fallbackFrom: result.fallbackFrom,
      attempts: result.attempts,
      usage: result.usage,
    };
  }

  async generateSeasonArchitecture(input: SeasonArchitecturePrompt, context: StoryCallOptions = {}): Promise<SeasonArchitectureModelResult> {
    const result = await this.runSequence(context, "season_architecture", "Developing season architecture", async (slot, signal) => {
      if (!slot.generateSeasonArchitecture) {
        throw new JobError(`${providerLabel(slot.id)} cannot develop a season architecture.`, "configuration", false);
      }
      const generated = await slot.generateSeasonArchitecture(input, { signal });
      const parsed = seasonArchitectureSchema.safeParse(generated.architecture);
      if (!parsed.success) {
        throw new JobError(
          `${providerLabel(slot.id)} returned a season architecture that did not match the schema.`,
          "invalid_schema",
          false
        );
      }
      return { value: parsed.data, usage: generated.usage };
    }, (slot) => Boolean(slot.generateSeasonArchitecture));
    return {
      architecture: result.value,
      provider: result.provider,
      model: result.model,
      fallbackFrom: result.fallbackFrom,
      attempts: result.attempts,
      usage: result.usage,
    };
  }

  async generateEpisodeDetails(input: EpisodeDetailBatchPrompt, context: StoryCallOptions = {}): Promise<EpisodeDetailBatchModelResult> {
    const result = await this.runSequence(context, "episode_details", "Developing episode details", async (slot, signal) => {
      if (!slot.generateEpisodeDetails) {
        throw new JobError(`${providerLabel(slot.id)} cannot develop episode details.`, "configuration", false);
      }
      const generated = await slot.generateEpisodeDetails(input, { signal });
      const parsed = episodeDetailBatchSchema.safeParse(generated.batch);
      if (!parsed.success) {
        throw new JobError(
          `${providerLabel(slot.id)} returned episode details that did not match the schema.`,
          "invalid_schema",
          false
        );
      }
      return { value: parsed.data, usage: generated.usage };
    }, (slot) => Boolean(slot.generateEpisodeDetails));
    return {
      batch: result.value,
      provider: result.provider,
      model: result.model,
      fallbackFrom: result.fallbackFrom,
      attempts: result.attempts,
      usage: result.usage,
    };
  }

  async repairScenes(input: RepairScenesPrompt, context: StoryCallOptions = {}): Promise<RepairScenesModelResult> {
    const result = await this.runSequence(context, "scene_repair", "Repairing scenes", async (slot, signal) => {
      if (!slot.repairScenes) {
        throw new JobError(`${providerLabel(slot.id)} cannot repair scenes.`, "configuration", false);
      }
      const generated = await slot.repairScenes(input, { signal });
      const parsed = repairScenesResultSchema.safeParse({ screenplay: generated.screenplay });
      if (!parsed.success) {
        throw new JobError(
          `${providerLabel(slot.id)} returned a scene repair that did not match the screenplay schema.`,
          "invalid_schema",
          false
        );
      }
      return { value: parsed.data.screenplay, usage: generated.usage };
    }, (slot) => Boolean(slot.repairScenes));
    return {
      screenplay: result.value,
      provider: result.provider,
      model: result.model,
      fallbackFrom: result.fallbackFrom,
      attempts: result.attempts,
      usage: result.usage,
    };
  }

  async reviseEpisode(input: EpisodeRevisionPrompt, context: StoryCallOptions = {}): Promise<EpisodeRevisionModelResult> {
    const result = await this.runSequence(context, "episode_revision", "Revising episode", async (slot, signal) => {
      if (!slot.reviseEpisode) {
        throw new JobError(`${providerLabel(slot.id)} cannot revise episodes.`, "configuration", false);
      }
      const generated = await slot.reviseEpisode(input, { signal });
      return { value: generated.episode, usage: generated.usage };
    }, (slot) => Boolean(slot.reviseEpisode));
    return {
      episode: result.value,
      provider: result.provider,
      model: result.model,
      fallbackFrom: result.fallbackFrom,
      attempts: result.attempts,
      usage: result.usage,
    };
  }

  async critiqueStory(input: StoryCriticPrompt, context: StoryCallOptions = {}): Promise<StoryCritiqueModelResult> {
    const result = await this.runSequence(context, "story_critic", "Reviewing continuity", async (slot, signal) => {
      if (!slot.critiqueStory) {
        throw new JobError(`${providerLabel(slot.id)} cannot critique a story.`, "configuration", false);
      }
      const generated = await slot.critiqueStory(input, { signal });
      const parsed = storyCritiqueSchema.safeParse({ findings: generated.findings });
      if (!parsed.success) {
        throw new JobError(
          `${providerLabel(slot.id)} returned a critique that did not match the schema.`,
          "invalid_schema",
          false
        );
      }
      return { value: parsed.data.findings, usage: generated.usage };
    }, (slot) => Boolean(slot.critiqueStory));
    return {
      findings: result.value,
      provider: result.provider,
      model: result.model,
      fallbackFrom: result.fallbackFrom,
      attempts: result.attempts,
      usage: result.usage,
    };
  }

  async generateCanonSuggestions(input: CanonExtractionPrompt, context: StoryCallOptions = {}): Promise<CanonExtractionModelResult> {
    const result = await this.runSequence(context, "canon_extraction", "Extracting canon", async (slot, signal) => {
      if (!slot.generateCanonSuggestions) {
        throw new JobError(`${providerLabel(slot.id)} cannot extract canon.`, "configuration", false);
      }
      const generated = await slot.generateCanonSuggestions(input, { signal });
      const parsed = canonExtractionResponseSchema.safeParse(generated.response);
      if (!parsed.success) {
        throw new JobError(
          `${providerLabel(slot.id)} returned canon suggestions that did not match the schema.`,
          "invalid_schema",
          false
        );
      }
      return { value: parsed.data, usage: generated.usage };
    }, (slot) => Boolean(slot.generateCanonSuggestions));
    return {
      response: result.value,
      provider: result.provider,
      model: result.model,
      fallbackFrom: result.fallbackFrom,
      attempts: result.attempts,
      usage: result.usage,
    };
  }

  async generateCanonFacts(input: CanonFactExtractionTaskInput, context: StoryCallOptions = {}): Promise<CanonFactExtractionModelResult> {
    const result = await this.runSequence(context, "canon_fact_extraction", "Extracting canon facts", async (slot, signal) => {
      if (!slot.generateCanonFacts) {
        throw new JobError(`${providerLabel(slot.id)} cannot extract canon facts.`, "configuration", false);
      }
      const generated = await slot.generateCanonFacts(input, { signal });
      const parsed = canonExtractionResultSchema.safeParse(JSON.parse(generated.text));
      if (!parsed.success) {
        throw new JobError(
          `${providerLabel(slot.id)} returned canon facts that did not match the schema.`,
          "invalid_schema",
          false
        );
      }
      return { value: generated.text, usage: generated.usage };
    }, (slot) => Boolean(slot.generateCanonFacts));
    return {
      text: result.value,
      provider: result.provider,
      model: result.model,
      fallbackFrom: result.fallbackFrom,
      attempts: result.attempts,
      usage: result.usage,
    };
  }

  private async runSequence<T>(
    context: StoryCallOptions,
    task: string,
    activity: string,
    call: (slot: ProviderSlot, signal: AbortSignal) => Promise<{ value: T; usage?: TokenUsage }>,
    supports?: (slot: ProviderSlot) => boolean
  ): Promise<{
    value: T;
    provider: string;
    model: string;
    fallbackFrom: string | null;
    attempts: AttemptRecord[];
    usage?: TokenUsage;
  }> {
    const baseSlots = supports ? this.options.slots.filter(supports) : this.options.slots;
    const aspo = this.options.availabilityManager;
    const costPolicy = this.options.costPolicy;
    let slots: ProviderSlot[];
    if (aspo) {
      for (const s of baseSlots) {
        aspo.registerProvider(s.id, s.model, s.configured);
      }
      const candidates = baseSlots.map((s) => ({
        providerId: s.id,
        configured: s.configured,
        supported: s.supported !== false,
        costEligible: costPolicy ? isCostEligible(s.id, s.model, costPolicy) : true,
      }));
      const order = aspo.selectOrder(task, candidates);
      const ordered = order
        .map((id) => baseSlots.find((s) => s.id === id))
        .filter((s): s is ProviderSlot => Boolean(s));
      slots = ordered.length > 0 ? ordered : baseSlots;
      aspoEligibleProviders(task, slots.map((s) => s.id));
    } else {
      slots = this.options.taskRouting ? routeByTask(task, baseSlots) : baseSlots;
    }
    // Ollama is a slow local provider. Use it only as a last-resort
    // fallback after every other provider has been retried once (two
    // passes total). This avoids spending the sequence budget on Ollama
    // when a faster cloud provider may recover on a second attempt.
    //
    // When Ollama is the explicitly configured primary provider
    // (LLM_PROVIDER=ollama, i.e. the first slot), respect the user's
    // intent and skip the last-resort reordering so Ollama is tried in
    // its natural position within the ASPO-ordered sequence.
    const ollamaIsPrimary = baseSlots[0]?.id === "ollama";
    const ollamaSlots = slots.filter((s) => s.id === "ollama");
    const nonOllamaSlots = slots.filter((s) => s.id !== "ollama");
    let retryStartIndex = -1;
    let ollamaStartIndex = -1;
    if (!ollamaIsPrimary && ollamaSlots.length > 0 && nonOllamaSlots.length > 0) {
      retryStartIndex = nonOllamaSlots.length;
      ollamaStartIndex = nonOllamaSlots.length * 2;
      slots = [...nonOllamaSlots, ...nonOllamaSlots, ...ollamaSlots];
    }
    // When a previous call in the same workflow succeeded with a specific
    // provider (e.g. sequential story draft parts), try that provider first
    // to avoid re-running the full fallback sequence for every part.
    const preferred = context.preferredProvider;
    if (preferred && slots.length > 1) {
      const preferredSlots = slots.filter((s) => s.id === preferred);
      const otherSlots = slots.filter((s) => s.id !== preferred);
      if (preferredSlots.length > 0 && otherSlots.length > 0) {
        slots = [...preferredSlots, ...otherSlots];
        retryStartIndex = -1;
        ollamaStartIndex = -1;
      }
    }
    if (slots.length === 0) {
      throw new LlmSequenceError(
        supports
          ? "No configured language provider supports this task."
          : "No language provider is configured.",
        "configuration",
        false,
        []
      );
    }
    const baseSequenceMs = this.options.sequenceTimeoutMs ?? context.sequenceTimeoutMs ?? sequenceTimeoutMs();
    const providerCap = this.options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    // Story Draft on a local 4B model can spend several minutes in prompt_eval.
    // The default sequence cap (300 s) would truncate the story timeout budget
    // before the per-attempt signal fires. Raise the sequence deadline to
    // accommodate the largest story timeout across eligible slots so the
    // per-attempt signal is the sole authority for story cancellation.
    const storyMaxMs = task === "story"
      ? slots
          .filter((s) => s.supported !== false && s.configured)
          .reduce((max, s) => Math.max(max, s.storyTimeoutMs ?? 0), 0)
      : 0;
    const sequenceMs = Math.max(baseSequenceMs, storyMaxMs);
    const deadline = Date.now() + sequenceMs;
    const attempts: AttemptRecord[] = [];
    let last: JobError | null = null;
    log.info("llm", "generation started", {
      task,
      primary: slots[0]?.id ?? "",
      providers: slots.map((slot) => slot.id).join(","),
      retryStrategy: retryStartIndex >= 0 ? "ollama_last_resort" : "standard",
      sequenceMs,
      runId: context.runId ?? "",
      jobId: context.jobId ?? "",
    });

    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index]!;
      if (retryStartIndex >= 0 && index === retryStartIndex) {
        log.info("llm", "retry pass starting (non-Ollama providers retried)", {
          task,
          providers: nonOllamaSlots.map((s) => s.id).join(","),
          runId: context.runId ?? "",
          jobId: context.jobId ?? "",
        });
      }
      if (ollamaStartIndex >= 0 && index === ollamaStartIndex) {
        log.info("llm", "Ollama last-resort fallback starting", {
          task,
          runId: context.runId ?? "",
          jobId: context.jobId ?? "",
        });
      }
      const remaining = deadline - Date.now();
      if (remaining < MINIMUM_ATTEMPT_MS) {
        last = new JobError("The language provider sequence timed out.", "timeout", true);
        attempts.push(record(slot, 0, false, "timeout", null, index > 0));
        log.error("llm", "sequence timeout", { provider: slot.id, remainingMs: Math.max(0, remaining) });
        break;
      }
      if (slot.supported === false) {
        if (index === 0) {
          throw new LlmSequenceError(
            slot.reason ?? `${slot.id} is not a supported language provider.`,
            "configuration",
            false,
            attempts
          );
        }
        log.info("llm", "fallback skipped", { provider: slot.id, reason: "unsupported" });
        attempts.push(record(slot, 0, false, "configuration", null, true));
        continue;
      }
      if (!slot.configured) {
        if (index === 0 && slot.id !== "ollama") {
          throw new LlmSequenceError(
            `${providerLabel(slot.id)} is selected but its API key is not set.`,
            "configuration",
            false,
            attempts
          );
        }
        log.info("llm", "fallback skipped", { provider: slot.id, reason: "missing_credentials" });
        attempts.push(record(slot, 0, false, "configuration", null, index > 0));
        continue;
      }
      const isRetryPass = retryStartIndex >= 0 && index >= retryStartIndex && index < ollamaStartIndex;
      if (aspo && !aspo.isAvailable(slot.id)) {
        const cooldown = aspo.getCooldownRemaining(slot.id);
        log.info("llm", "provider skipped (aspo unavailable)", { provider: slot.id, task, cooldownMs: cooldown, retryPass: isRetryPass });
        attempts.push(record(slot, 0, false, "circuit_breaker", null, index > 0));
        continue;
      }
      if (!aspo && this.options.healthTracker && !this.options.healthTracker.isHealthy(slot.id)) {
        log.info("llm", "provider skipped (circuit breaker)", { provider: slot.id, task, retryPass: isRetryPass });
        attempts.push(record(slot, 0, false, "circuit_breaker", null, index > 0));
        continue;
      }

      // Share the remaining bounded sequence budget with configured providers
      // still eligible in the chain. A slow first provider must not consume the
      // entire allowance and prevent every fallback from being attempted.
      // Story Draft gets a dedicated long budget (storyTimeoutMs) so a local
      // 4B model is not cut off during prompt_eval. Section mode (Story Bible
      // sections) uses sectionTimeoutMs. Everything else uses timeoutMs.
      const slotCap = context.sectionMode && slot.sectionTimeoutMs
        ? slot.sectionTimeoutMs
        : task === "story" && slot.storyTimeoutMs
          ? slot.storyTimeoutMs
          : slot.timeoutMs ?? providerCap;
      const remainingEligible = slots.slice(index).filter((candidate) => candidate.supported !== false && candidate.configured).length;
      const fairShareMs = Math.floor(remaining / Math.max(1, remainingEligible));
      const budget = Math.min(slotCap, Math.max(fairShareMs, Math.min(slotCap, remaining - (remainingEligible - 1) * 15_000)));
      const signal = AbortSignal.any([AbortSignal.timeout(budget), ...(context.signal ? [context.signal] : [])]);
      await context.onStatus?.(
        index === 0
          ? `${activity} with ${providerLabel(slot.id)}`
          : `Trying ${providerLabel(slot.id)} after the previous provider failed`
      );
      log.info("llm", "provider attempt", {
        task,
        provider: slot.id,
        model: slot.model,
        timeoutMs: budget,
        slotCap,
        fallback: index > 0,
        runId: context.runId ?? "",
        jobId: context.jobId ?? "",
      });
      const started = Date.now();
      const attemptId = `${task}-${slot.id}-${started}`;
      if (aspo) aspoAttemptStart(attemptId, slot.id, slot.model, task, budget);
      let providerSucceeded = false;
      let providerResult: { value: T; usage?: import("@/lib/providers/llm/types").TokenUsage } | null = null;
      let providerError: unknown = null;
      for (let retry = 0; retry < PROVIDER_RETRY_COUNT && !providerSucceeded; retry += 1) {
        if (retry > 0) {
          const backoffMs = Math.min(30_000, 2_000 * 2 ** (retry - 1));
          log.info("llm", "provider retry", { provider: slot.id, model: slot.model, task, retry, backoffMs });
          await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
        }
        const retrySignal = AbortSignal.any([AbortSignal.timeout(budget), ...(context.signal ? [context.signal] : [])]);
        try {
          const result = await call(slot, retrySignal);
          providerSucceeded = true;
          providerResult = result;
        } catch (error) {
          providerError = error;
          const reasonName = retrySignal.reason && typeof retrySignal.reason === "object" && "name" in retrySignal.reason
            ? retrySignal.reason.name
            : "";
          const timeoutAbort = retrySignal.aborted && reasonName === "TimeoutError";
          const failure = timeoutAbort
            ? new JobError(`${providerLabel(slot.id)} timed out.`, "timeout", true)
            : error instanceof JobError
              ? error
              : classifyProviderError(providerLabel(slot.id), error);
          if (retry < PROVIDER_RETRY_COUNT - 1 && RETRYABLE_CODES.has(failure.code)) {
            log.info("llm", "provider retryable failure", {
              provider: slot.id,
              model: slot.model,
              code: failure.code,
              retry: retry + 1,
              of: PROVIDER_RETRY_COUNT,
            });
            continue;
          }
          break;
        }
      }
      if (providerSucceeded && providerResult) {
        const result = providerResult;
        const durationMs = Date.now() - started;
        attempts.push({
          ...record(slot, durationMs, true, "ok", null, index > 0),
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
        });
        log.info("llm", "provider success", {
          task,
          provider: slot.id,
          model: slot.model,
          ms: durationMs,
          fallback: index > 0,
          inputTokens: result.usage?.inputTokens ?? "",
          outputTokens: result.usage?.outputTokens ?? "",
        });
        if (aspo) {
          aspo.recordSuccess(slot.id, task, durationMs);
          aspoAttemptResult(attemptId, slot.id, true, durationMs, null);
          aspoHealthUpdated(slot.id, task, "ok", 0);
          aspoGenerationSucceeded(task, slot.id, slot.model, durationMs);
        }
        return {
          value: result.value,
          provider: slot.id,
          model: slot.model,
          fallbackFrom: index === 0 ? null : earlierProvider(attempts),
          attempts,
          usage: result.usage,
        };
      }
      {
        const error = providerError;
        const reasonName = signal.reason && typeof signal.reason === "object" && "name" in signal.reason
          ? signal.reason.name
          : "";
        const timeoutAbort = signal.aborted && reasonName === "TimeoutError";
        const failure = timeoutAbort
          ? new JobError(`${providerLabel(slot.id)} timed out. The next provider will be tried.`, "timeout", true)
          : error instanceof JobError
            ? error
            : classifyProviderError(providerLabel(slot.id), error);
        const durationMs = Date.now() - started;
        attempts.push(record(slot, durationMs, false, failure.code, httpStatusOf(error) ?? httpStatusOf(failure), index > 0));
        last = failure;
        log.error("llm", "provider failed", {
          provider: slot.id,
          model: slot.model,
          code: failure.code,
          httpStatus: httpStatusOf(failure) ?? "",
          detail: error instanceof ClassifiedProviderError ? error.detail : safeProviderDetail(failure.message),
          ms: durationMs,
          fallback: index > 0,
        });
        if (aspo) {
          const classified = classifyFailure(slot.id, error, timeoutAbort || undefined);
          const category = classified.category;
          const strategy = recoveryFor(category);
          aspo.recordFailure(slot.id, task, category, durationMs);
          aspoAttemptResult(attemptId, slot.id, false, durationMs, category, classified.detail);
          aspoHealthUpdated(slot.id, task, category, aspoCooldownFor(category));
          if (strategy === "abort") {
            aspoGenerationFailed(task, attempts.length, category);
            throw new LlmSequenceError(failure.message, failure.code, false, attempts);
          }
          const next = slots[index + 1];
          if (next) {
            aspoFallback(task, slot.id, next.id);
            log.info("llm", "fallback starting", {
              task, from: slot.id, fromModel: slot.model, to: next.id, toModel: next.model,
              runId: context.runId ?? "", jobId: context.jobId ?? "",
            });
          }
        } else {
          if (!FAILOVER_CODES.has(failure.code)) {
            throw new LlmSequenceError(failure.message, failure.code, false, attempts);
          }
          this.options.healthTracker?.recordFailure(slot.id, failure.code);
          const next = slots[index + 1];
          if (next) log.info("llm", "fallback starting", {
            task, from: slot.id, fromModel: slot.model, to: next.id, toModel: next.model,
            runId: context.runId ?? "", jobId: context.jobId ?? "",
          });
        }
      }
    }

    const transportFailed = attempts.some((attempt) => !attempt.success && TRANSPORT_CODES.has(attempt.category));
    if (aspo) {
      const lastFailed = [...attempts].reverse().find((a) => !a.success);
      aspoGenerationFailed(task, attempts.length, (lastFailed?.category ?? "unknown_error") as Parameters<typeof aspoGenerationFailed>[2]);
    }
    throw new LlmSequenceError(
      this.options.freeOnly
        ? "No free language provider is currently available."
        : (last?.message ?? "The language stage failed."),
      last?.code ?? "provider_failed",
      transportFailed,
      attempts
    );
  }
}

function earlierProvider(attempts: AttemptRecord[]): string | null {
  return attempts.find((attempt) => !attempt.success)?.provider ?? null;
}

/**
 * Ask the same provider to continue a screenplay that stopped short, up to a
 * bounded number of rounds, merging and de-duplicating each addition until the
 * episode reaches its pacing floor or nothing more is produced.
 */
async function extendScreenplay(
  slot: ProviderSlot,
  input: StoryPrompt,
  screenplay: ScreenplayScene[],
  usage: TokenUsage | undefined,
  truncated: boolean | undefined,
  signal: AbortSignal
): Promise<{ screenplay: ScreenplayScene[]; usage?: TokenUsage }> {
  if (!slot.continueStory) return { screenplay, usage };
  const minimum = minimumScenesForDuration(input.targetDurationSeconds);
  let current = screenplay;
  let total = usage;
  let cut = truncated ?? false;
  for (let round = 0; round < MAX_CONTINUATION_ROUNDS && (current.length < minimum || cut); round += 1) {
    const continuation = await slot.continueStory(input, current, { signal });
    if (continuation.screenplay.length === 0) break;
    const before = current.length;
    current = mergeScreenplays(current, continuation.screenplay);
    total = addUsage(total, continuation.usage);
    cut = continuation.truncated ?? false;
    // Nothing new survived de-duplication: stop rather than loop on a repeat.
    if (current.length === before) break;
  }
  return { screenplay: current, usage: total };
}

function addUsage(a?: TokenUsage, b?: TokenUsage): TokenUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens:
      a.inputTokens == null && b.inputTokens == null ? undefined : (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens:
      a.outputTokens == null && b.outputTokens == null ? undefined : (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
  };
}

function record(
  slot: ProviderSlot,
  durationMs: number,
  success: boolean,
  category: string,
  httpStatus: number | null,
  fallback: boolean
): AttemptRecord {
  return {
    provider: slot.id,
    model: slot.model,
    durationMs,
    success,
    category,
    httpStatus,
    fallback,
  };
}
