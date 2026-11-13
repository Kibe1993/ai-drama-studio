import { log } from "@/lib/log";
import { JobError } from "@/lib/pipeline/types";
import { minimumScenesForDuration } from "@/lib/providers/llm/budget";
import { MAX_CONTINUATION_ROUNDS, mergeScreenplays } from "@/lib/providers/llm/continuation";
import { classifyProviderError, ClassifiedProviderError, safeProviderDetail, statusOf } from "@/lib/providers/llm/errors";
import type { CharacterPrompt, EpisodeSuggestionPrompt, ScenePrompt, SeasonPlanPrompt } from "@/lib/providers/llm/stageTasks";
import type { RepairScenesPrompt } from "@/lib/providers/llm/repairScenes";
import { repairScenesResultSchema } from "@/lib/providers/llm/repairScenes";
import type { StoryCriticFinding, StoryCriticPrompt } from "@/lib/providers/llm/storyCritic";
import { storyCritiqueSchema } from "@/lib/providers/llm/storyCritic";
import { assertScreenplayPacing } from "@/lib/providers/llm/stageTasks";
import type {
  AttemptRecord,
  CharacterModelResult,
  EpisodeSuggestionModelResult,
  LLMProvider,
  RepairScenesModelResult,
  SceneModelResult,
  SeasonPlanModelResult,
  StoryCallOptions,
  StoryCritiqueModelResult,
  StoryModelResult,
  StoryPrompt,
  TokenUsage,
} from "@/lib/providers/llm/types";
import { episodeSuggestionSchema, type EpisodeSuggestion } from "@/lib/validation/episode";
import type { CharacterProfile, ProductionScene } from "@/lib/validation/productionStages";
import { generatedStorySchema, type GeneratedStory, type ScreenplayScene } from "@/lib/validation/story";
import { validateStoryBibleTaskResult, type StoryBibleTaskInput, type StoryBibleTaskResult } from "@/lib/providers/llm/storyBibleTask";
import { seasonPlanSchema, type SeasonPlan } from "@/lib/validation/seasonPlan";

export const DEFAULT_SEQUENCE_TIMEOUT_MS = 300_000;
export const DEFAULT_PROVIDER_TIMEOUT_MS = 90_000;
const MINIMUM_ATTEMPT_MS = 100;

export const FAILOVER_CODES = new Set([
  "rate_limited",
  "timeout",
  "provider_unavailable",
  "empty_response",
  "invalid_json",
  "invalid_schema",
  "invalid_request",
  "quota_exhausted",
  "invalid_model",
]);

const TRANSPORT_CODES = new Set(["rate_limited", "timeout", "provider_unavailable", "quota_exhausted"]);

export type ProviderSlot = {
  id: string;
  model: string;
  configured: boolean;
  supported?: boolean;
  reason?: string;
  timeoutMs?: number;
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
  repairScenes?(
    input: RepairScenesPrompt,
    options: { signal: AbortSignal }
  ): Promise<{ screenplay: ScreenplayScene[]; usage?: TokenUsage }>;
  critiqueStory?(
    input: StoryCriticPrompt,
    options: { signal: AbortSignal }
  ): Promise<{ findings: StoryCriticFinding[]; usage?: TokenUsage }>;
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
    }
  ) {
    this.id = options.slots[0]?.id ?? "llm";
    this.model = options.slots[0]?.model ?? "";
  }

  async generateStory(input: StoryPrompt, context: StoryCallOptions = {}): Promise<StoryModelResult> {
    const result = await this.runSequence(context, "story", "Generating story", async (slot, signal) => {
      const generated = await slot.generate(input, { signal });
      const parsed = generatedStorySchema.safeParse(generated.story);
      if (!parsed.success) {
        throw new JobError(
          `${providerLabel(slot.id)} returned a story that did not match the screenplay schema.`,
          "invalid_schema",
          false
        );
      }
      // If the provider stopped short — either below the pacing floor or at its
      // own output ceiling — ask the same provider to continue from the last
      // scene it wrote before giving up on it. One response is no longer the
      // ceiling on how long the episode can be.
      const extended = await extendScreenplay(slot, input, parsed.data.screenplay, generated.usage, generated.truncated, signal);
      // A screenplay that is still too short for its requested duration is
      // incomplete, not a valid episode. Throwing here fails over to the next
      // provider instead of saving a one-scene episode.
      assertScreenplayPacing(input.targetDurationSeconds, extended.screenplay);
      return { value: { ...parsed.data, screenplay: extended.screenplay }, usage: extended.usage };
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
    const result = await this.runSequence(context, "story_bible", "Developing Story Bible", async (slot, signal) => {
      if (!slot.generateStoryBible) {
        throw new JobError(`${providerLabel(slot.id)} cannot develop a Story Bible.`, "configuration", false);
      }
      const generated = await slot.generateStoryBible(input, { signal });
      return { value: validateStoryBibleTaskResult(input, generated.result), usage: generated.usage };
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
    });
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
    const slots = supports ? this.options.slots.filter(supports) : this.options.slots;
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
    const sequenceMs = this.options.sequenceTimeoutMs ?? context.sequenceTimeoutMs ?? sequenceTimeoutMs();
    const providerCap = this.options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    const deadline = Date.now() + sequenceMs;
    const attempts: AttemptRecord[] = [];
    let last: JobError | null = null;
    log.info("llm", "generation started", {
      task,
      primary: slots[0]?.id ?? "",
      providers: slots.map((slot) => slot.id).join(","),
      sequenceMs,
      runId: context.runId ?? "",
      jobId: context.jobId ?? "",
    });

    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index]!;
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
        if (index === 0) {
          throw new LlmSequenceError(
            slot.id === "ollama"
              ? "Ollama is selected but disabled. Set a different LLM_PROVIDER or re-enable Ollama."
              : `${providerLabel(slot.id)} is selected but its API key is not set.`,
            "configuration",
            false,
            attempts
          );
        }
        log.info("llm", "fallback skipped", { provider: slot.id, reason: "missing_credentials" });
        attempts.push(record(slot, 0, false, "configuration", null, true));
        continue;
      }

      // Share the remaining bounded sequence budget with configured providers
      // still eligible in the chain. A slow first provider must not consume the
      // entire allowance and prevent every fallback from being attempted.
      const slotCap = slot.timeoutMs ?? providerCap;
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
        provider: slot.id,
        model: slot.model,
        timeoutMs: budget,
        fallback: index > 0,
        runId: context.runId ?? "",
        jobId: context.jobId ?? "",
      });
      const started = Date.now();
      try {
        const result = await call(slot, signal);
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
        return {
          value: result.value,
          provider: slot.id,
          model: slot.model,
          fallbackFrom: index === 0 ? null : earlierProvider(attempts),
          attempts,
          usage: result.usage,
        };
      } catch (error) {
        const reasonName = signal.reason && typeof signal.reason === "object" && "name" in signal.reason
          ? signal.reason.name
          : "";
        const timeoutAbort = signal.aborted && reasonName === "TimeoutError";
        // SDKs can wrap a manager-triggered AbortSignal timeout as a generic
        // non-retryable provider_failed JobError. The signal deadline is the
        // authoritative cause, so classify it before honoring that wrapper.
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
        if (!FAILOVER_CODES.has(failure.code)) {
          throw new LlmSequenceError(failure.message, failure.code, false, attempts);
        }
        const next = slots[index + 1];
        if (next) log.info("llm", "fallback starting", {
          task, from: slot.id, fromModel: slot.model, to: next.id, toModel: next.model,
          runId: context.runId ?? "", jobId: context.jobId ?? "",
        });
      }
    }

    const transportFailed = attempts.some((attempt) => !attempt.success && TRANSPORT_CODES.has(attempt.category));
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
