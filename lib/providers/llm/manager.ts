import { log } from "@/lib/log";
import { JobError } from "@/lib/pipeline/types";
import { classifyProviderError, ClassifiedProviderError, safeProviderDetail, statusOf } from "@/lib/providers/llm/errors";
import type { CharacterPrompt, ScenePrompt } from "@/lib/providers/llm/stageTasks";
import type {
  AttemptRecord,
  CharacterModelResult,
  LLMProvider,
  SceneModelResult,
  StoryCallOptions,
  StoryModelResult,
  StoryPrompt,
  TokenUsage,
} from "@/lib/providers/llm/types";
import type { CharacterProfile, ProductionScene } from "@/lib/validation/productionStages";
import { generatedStorySchema, type GeneratedStory } from "@/lib/validation/story";

export const DEFAULT_SEQUENCE_TIMEOUT_MS = 120_000;
export const DEFAULT_PROVIDER_TIMEOUT_MS = 90_000;
const MINIMUM_ATTEMPT_MS = 1_000;

export const FAILOVER_CODES = new Set([
  "rate_limited",
  "timeout",
  "provider_unavailable",
  "empty_response",
  "invalid_json",
  "invalid_schema",
  "invalid_request",
  "quota_exhausted",
]);

const TRANSPORT_CODES = new Set(["rate_limited", "timeout", "provider_unavailable", "quota_exhausted"]);

export type ProviderSlot = {
  id: string;
  model: string;
  configured: boolean;
  supported?: boolean;
  reason?: string;
  generate(
    input: StoryPrompt,
    options: { signal: AbortSignal }
  ): Promise<{ story: GeneratedStory; usage?: TokenUsage }>;
  generateCharacters?(
    input: CharacterPrompt,
    options: { signal: AbortSignal }
  ): Promise<{ characters: CharacterProfile[]; usage?: TokenUsage }>;
  generateScenes?(
    input: ScenePrompt,
    options: { signal: AbortSignal }
  ): Promise<{ scenes: ProductionScene[]; usage?: TokenUsage }>;
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
  const parsed = Number(env.LLM_SEQUENCE_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_SEQUENCE_TIMEOUT_MS;
  return Math.min(180_000, Math.max(15_000, parsed));
}

function providerLabel(id: string): string {
  if (id === "openai") return "OpenAI";
  if (id === "anthropic") return "Anthropic";
  if (id === "deepseek") return "DeepSeek";
  if (id === "gemini") return "Gemini";
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
      return { value: parsed.data, usage: generated.usage };
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

  private async runSequence<T>(
    context: StoryCallOptions,
    task: string,
    activity: string,
    call: (slot: ProviderSlot, signal: AbortSignal) => Promise<{ value: T; usage?: TokenUsage }>
  ): Promise<{
    value: T;
    provider: string;
    model: string;
    fallbackFrom: string | null;
    attempts: AttemptRecord[];
    usage?: TokenUsage;
  }> {
    const slots = this.options.slots;
    if (slots.length === 0) {
      throw new LlmSequenceError("No language provider is configured.", "configuration", false, []);
    }
    const sequenceMs = this.options.sequenceTimeoutMs ?? sequenceTimeoutMs();
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
            `${providerLabel(slot.id)} is selected but its API key is not set.`,
            "configuration",
            false,
            attempts
          );
        }
        log.info("llm", "fallback skipped", { provider: slot.id, reason: "missing_credentials" });
        attempts.push(record(slot, 0, false, "configuration", null, true));
        continue;
      }

      const budget = Math.min(providerCap, remaining);
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
        const failure = error instanceof JobError ? error : classifyProviderError(providerLabel(slot.id), error);
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
