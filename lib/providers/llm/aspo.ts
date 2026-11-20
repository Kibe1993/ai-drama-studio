
import { log } from "@/lib/log";
import { JobError } from "@/lib/pipeline/types";
import { classifyProviderError, ClassifiedProviderError, safeProviderDetail } from "@/lib/providers/llm/errors";

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

export type FailureCategory =
  | "authentication_error"
  | "permission_error"
  | "model_unavailable"
  | "rate_limited"
  | "quota_exhausted"
  | "billing_error"
  | "connection_error"
  | "provider_overloaded"
  | "timeout"
  | "empty_response"
  | "invalid_json"
  | "invalid_schema"
  | "truncated_output"
  | "content_validation_error"
  | "prompt_too_large"
  | "unknown_error";

export type RecoveryStrategy =
  | "skip_provider"
  | "cooldown_short"
  | "cooldown_medium"
  | "cooldown_long"
  | "failover"
  | "abort"
  | "repair_once";

const RECOVERY: Record<FailureCategory, RecoveryStrategy> = {
  authentication_error: "skip_provider",
  permission_error: "skip_provider",
  model_unavailable: "skip_provider",
  rate_limited: "cooldown_medium",
  quota_exhausted: "cooldown_long",
  billing_error: "skip_provider",
  connection_error: "cooldown_short",
  provider_overloaded: "cooldown_short",
  timeout: "cooldown_medium",
  empty_response: "failover",
  invalid_json: "repair_once",
  invalid_schema: "repair_once",
  truncated_output: "failover",
  content_validation_error: "failover",
  prompt_too_large: "failover",
  unknown_error: "failover",
};

const COOLDOWN_MS: Record<RecoveryStrategy, number> = {
  skip_provider: 300_000,
  cooldown_short: 15_000,
  cooldown_medium: 30_000,
  cooldown_long: 300_000,
  failover: 5_000,
  abort: 0,
  repair_once: 5_000,
};

export function recoveryFor(category: FailureCategory): RecoveryStrategy {
  return RECOVERY[category] ?? "failover";
}

export function cooldownFor(category: FailureCategory): number {
  return COOLDOWN_MS[recoveryFor(category)] ?? 15_000;
}

export function shouldFailover(category: FailureCategory): boolean {
  const strategy = recoveryFor(category);
  return strategy !== "skip_provider" && strategy !== "abort";
}

export function shouldSkipProvider(category: FailureCategory): boolean {
  return recoveryFor(category) === "skip_provider";
}

const HTTP_TO_CATEGORY: Record<number, FailureCategory> = {
  400: "unknown_error",
  401: "authentication_error",
  402: "billing_error",
  403: "permission_error",
  404: "model_unavailable",
  408: "timeout",
  429: "rate_limited",
  500: "provider_overloaded",
  502: "provider_overloaded",
  503: "provider_overloaded",
  504: "timeout",
};

const TEXT_PATTERNS: Array<{ pattern: RegExp; category: FailureCategory }> = [
  { pattern: /quota|billing|insufficient_quota|payment required|credit balance|exceeded your current quota/i, category: "quota_exhausted" },
  { pattern: /model.*(not found|does not exist|unsupported|invalid)|unknown model|invalid model/i, category: "model_unavailable" },
  { pattern: /resource_exhausted|rate limit|too many requests|tokens per minute/i, category: "rate_limited" },
  { pattern: /overloaded|capacity|service unavailable|busy/i, category: "provider_overloaded" },
  { pattern: /timeout|timed out|etimedout|deadline/i, category: "timeout" },
  { pattern: /econnreset|econnrefused|enotfound|eai_again|network|fetch failed|socket/i, category: "connection_error" },
];

export function classifyFailure(
  providerLabel: string,
  error: unknown,
  truncated?: boolean,
): { category: FailureCategory; detail: string; httpStatus: number | null; error: Error } {
  if (error instanceof JobError) {
    const httpStatus = error instanceof ClassifiedProviderError ? error.httpStatus : null;
    let category: FailureCategory = mapJobErrorCode(error.code);
    if (httpStatus && HTTP_TO_CATEGORY[httpStatus]) {
      category = HTTP_TO_CATEGORY[httpStatus]!;
    }
    return {
      category,
      detail: safeProviderDetail(error.message),
      httpStatus,
      error,
    };
  }
  const classified = classifyProviderError(providerLabel, error);
  const httpStatus = classified.httpStatus;
  let category: FailureCategory = "unknown_error";
  if (httpStatus && HTTP_TO_CATEGORY[httpStatus]) {
    category = HTTP_TO_CATEGORY[httpStatus]!;
  } else {
    const text = error instanceof Error ? error.message : String(error);
    for (const { pattern, category: cat } of TEXT_PATTERNS) {
      if (pattern.test(text)) {
        category = cat;
        break;
      }
    }
  }
  if (truncated && category === "unknown_error") {
    category = "truncated_output";
  }
  return {
    category,
    detail: safeProviderDetail(classified.detail ?? (error instanceof Error ? error.message : String(error))),
    httpStatus,
    error: classified,
  };
}

function mapJobErrorCode(code: string): FailureCategory {
  const map: Record<string, FailureCategory> = {
    authentication: "authentication_error",
    forbidden: "permission_error",
    configuration: "unknown_error",
    invalid_request: "unknown_error",
    invalid_model: "model_unavailable",
    rate_limited: "rate_limited",
    timeout: "timeout",
    provider_unavailable: "connection_error",
    provider_failed: "unknown_error",
    quota_exhausted: "quota_exhausted",
    empty_response: "empty_response",
    invalid_json: "invalid_json",
    invalid_schema: "invalid_schema",
    prompt_too_large: "prompt_too_large",
  };
  return map[code] ?? "unknown_error";
}

// ---------------------------------------------------------------------------
// Provider availability manager
// ---------------------------------------------------------------------------

export type TaskStats = {
  attempts: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  totalLatencyMs: number;
  lastErrorCode: FailureCategory | null;
  lastAttemptAt: number;
};

export type ProviderStats = {
  providerId: string;
  configured: boolean;
  model: string;
  cooldownUntil: number;
  lastSuccessAt: number;
  permanentSkip: boolean;
  skipReason: string | null;
  taskStats: Map<string, TaskStats>;
};

export type ProviderScore = {
  providerId: string;
  score: number;
  eligible: boolean;
  reason: string | null;
};

const TASK_WINDOW = 20;
const INITIAL_PRIORITY: Record<string, number> = {
  gemini: 100,
  groq: 90,
  openrouter: 85,
  openai: 80,
  deepseek: 75,
  kimi: 70,
  mistral: 65,
  anthropic: 60,
  ollama: 50,
};

const LATENCY_WEIGHT = 0.3;
const SUCCESS_WEIGHT = 0.5;
const PRIORITY_WEIGHT = 0.2;

export class ProviderAvailabilityManager {
  private readonly stats = new Map<string, ProviderStats>();
  private readonly initialPriority: Record<string, number>;

  constructor(options: { initialPriority?: Record<string, number> } = {}) {
    this.initialPriority = options.initialPriority ?? INITIAL_PRIORITY;
  }

  registerProvider(providerId: string, model: string, configured: boolean): void {
    if (!this.stats.has(providerId)) {
      this.stats.set(providerId, {
        providerId,
        configured,
        model,
        cooldownUntil: 0,
        lastSuccessAt: 0,
        permanentSkip: false,
        skipReason: null,
        taskStats: new Map(),
      });
    } else {
      const existing = this.stats.get(providerId)!;
      existing.model = model;
      existing.configured = configured;
    }
  }

  recordSuccess(providerId: string, task: string, latencyMs: number): void {
    const provider = this.getOrCreate(providerId);
    provider.lastSuccessAt = Date.now();
    provider.permanentSkip = false;
    provider.skipReason = null;
    const taskStats = this.getOrCreateTask(provider, task);
    taskStats.attempts += 1;
    taskStats.successes += 1;
    taskStats.consecutiveFailures = 0;
    taskStats.totalLatencyMs += latencyMs;
    taskStats.lastErrorCode = null;
    taskStats.lastAttemptAt = Date.now();
  }

  recordFailure(providerId: string, task: string, category: FailureCategory, latencyMs: number): void {
    const provider = this.getOrCreate(providerId);
    const taskStats = this.getOrCreateTask(provider, task);
    taskStats.attempts += 1;
    taskStats.failures += 1;
    taskStats.consecutiveFailures += 1;
    taskStats.totalLatencyMs += latencyMs;
    taskStats.lastErrorCode = category;
    taskStats.lastAttemptAt = Date.now();

    if (shouldSkipProvider(category)) {
      provider.permanentSkip = true;
      provider.skipReason = `${category} — skip until credentials or configuration change`;
    } else {
      const cooldown = cooldownFor(category);
      const until = Date.now() + cooldown;
      if (until > provider.cooldownUntil) {
        provider.cooldownUntil = until;
      }
    }
  }

  isAvailable(providerId: string): boolean {
    const provider = this.stats.get(providerId);
    if (!provider) return true;
    if (provider.permanentSkip) return false;
    if (Date.now() < provider.cooldownUntil) return false;
    return true;
  }

  getCooldownRemaining(providerId: string): number {
    const provider = this.stats.get(providerId);
    if (!provider) return 0;
    return Math.max(0, provider.cooldownUntil - Date.now());
  }

  getStats(providerId: string): ProviderStats | undefined {
    return this.stats.get(providerId);
  }

  getTaskStats(providerId: string, task: string): TaskStats | undefined {
    return this.stats.get(providerId)?.taskStats.get(task);
  }

  clearCooldown(providerId: string): void {
    const provider = this.stats.get(providerId);
    if (provider) {
      provider.cooldownUntil = 0;
      provider.permanentSkip = false;
      provider.skipReason = null;
    }
  }

  clear(): void {
    this.stats.clear();
  }

  scoreProvider(
    providerId: string,
    task: string,
    options: { configured: boolean; supported: boolean; costEligible: boolean },
  ): ProviderScore {
    if (!options.configured) {
      return { providerId, score: 0, eligible: false, reason: "not_configured" };
    }
    if (!options.supported) {
      return { providerId, score: 0, eligible: false, reason: "not_supported" };
    }
    if (!options.costEligible) {
      return { providerId, score: 0, eligible: false, reason: "cost_blocked" };
    }
    const provider = this.stats.get(providerId);
    if (provider?.permanentSkip) {
      return { providerId, score: 0, eligible: false, reason: provider.skipReason ?? "permanent_skip" };
    }
    if (provider && Date.now() < provider.cooldownUntil) {
      return { providerId, score: 0, eligible: false, reason: `cooldown_${Math.ceil((provider.cooldownUntil - Date.now()) / 1000)}s` };
    }
    const taskStats = provider?.taskStats.get(task);
    const priority = this.initialPriority[providerId] ?? 50;
    if (!taskStats || taskStats.attempts < 3) {
      return { providerId, score: priority, eligible: true, reason: null };
    }
    const successRate = taskStats.successes / taskStats.attempts;
    const avgLatency = taskStats.totalLatencyMs / taskStats.attempts;
    const latencyScore = Math.max(0, Math.min(100, 100 - (avgLatency / 1000)));
    const successScore = successRate * 100;
    const score = LATENCY_WEIGHT * latencyScore + SUCCESS_WEIGHT * successScore + PRIORITY_WEIGHT * priority;
    return { providerId, score: Math.round(score * 100) / 100, eligible: true, reason: null };
  }

  selectProvider(
    task: string,
    candidates: Array<{
      providerId: string;
      configured: boolean;
      supported: boolean;
      costEligible: boolean;
    }>,
  ): { selected: string | null; scores: ProviderScore[] } {
    const scores = candidates.map((c) =>
      this.scoreProvider(c.providerId, task, {
        configured: c.configured,
        supported: c.supported,
        costEligible: c.costEligible,
      }),
    );
    const eligible = scores.filter((s) => s.eligible);
    if (eligible.length === 0) {
      return { selected: null, scores };
    }
    eligible.sort((a, b) => b.score - a.score);
    return { selected: eligible[0]!.providerId, scores };
  }

  selectOrder(
    task: string,
    candidates: Array<{
      providerId: string;
      configured: boolean;
      supported: boolean;
      costEligible: boolean;
    }>,
  ): string[] {
    const { scores } = this.selectProvider(task, candidates);
    return scores
      .filter((s) => s.eligible || (s.reason?.startsWith("cooldown_") ?? false))
      .sort((a, b) => {
        const aCooldown = a.reason?.startsWith("cooldown_") ? 1 : 0;
        const bCooldown = b.reason?.startsWith("cooldown_") ? 1 : 0;
        if (aCooldown !== bCooldown) return aCooldown - bCooldown;
        return b.score - a.score;
      })
      .map((s) => s.providerId);
  }

  private getOrCreate(providerId: string): ProviderStats {
    let provider = this.stats.get(providerId);
    if (!provider) {
      provider = {
        providerId,
        configured: true,
        model: "",
        cooldownUntil: 0,
        lastSuccessAt: 0,
        permanentSkip: false,
        skipReason: null,
        taskStats: new Map(),
      };
      this.stats.set(providerId, provider);
    }
    return provider;
  }

  private getOrCreateTask(provider: ProviderStats, task: string): TaskStats {
    let taskStats = provider.taskStats.get(task);
    if (!taskStats) {
      taskStats = {
        attempts: 0,
        successes: 0,
        failures: 0,
        consecutiveFailures: 0,
        totalLatencyMs: 0,
        lastErrorCode: null,
        lastAttemptAt: 0,
      };
      provider.taskStats.set(task, taskStats);
    }
    if (taskStats.attempts > TASK_WINDOW) {
      const keepRatio = TASK_WINDOW / taskStats.attempts;
      taskStats.attempts = Math.round(taskStats.attempts * keepRatio);
      taskStats.successes = Math.round(taskStats.successes * keepRatio);
      taskStats.failures = Math.round(taskStats.failures * keepRatio);
      taskStats.totalLatencyMs = Math.round(taskStats.totalLatencyMs * keepRatio);
    }
    return taskStats;
  }
}

// ---------------------------------------------------------------------------
// Cost policy
// ---------------------------------------------------------------------------

export type CostPolicyMode = "free_only" | "paid_enabled" | "disabled";

export type CostPolicy = {
  mode: CostPolicyMode;
  paidProvidersAllowed: Set<string>;
  disabledProviders: Set<string>;
};

export function parseCostPolicy(env: Record<string, string | undefined> = process.env): CostPolicy {
  const freeOnly = env.LLM_FREE_ONLY?.trim().toLowerCase();
  const paidEnabled = env.LLM_PAID_ENABLED?.trim().toLowerCase();
  const disabledRaw = env.LLM_DISABLED_PROVIDERS?.trim().toLowerCase();

  let mode: CostPolicyMode = "free_only";
  if (paidEnabled === "true" || paidEnabled === "1" || paidEnabled === "on") {
    mode = "paid_enabled";
  } else if (freeOnly === "false" || freeOnly === "0" || freeOnly === "off") {
    mode = "paid_enabled";
  }

  const paidProvidersAllowed = new Set<string>();
  if (mode === "paid_enabled") {
    const explicit = env.LLM_PAID_PROVIDERS?.trim().toLowerCase();
    if (explicit) {
      for (const p of explicit.split(",").map((s) => s.trim()).filter(Boolean)) {
        paidProvidersAllowed.add(p);
      }
    } else {
      paidProvidersAllowed.add("openai");
      paidProvidersAllowed.add("anthropic");
      paidProvidersAllowed.add("deepseek");
      paidProvidersAllowed.add("kimi");
    }
  }

  const disabledProviders = new Set<string>();
  if (disabledRaw) {
    for (const p of disabledRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
      disabledProviders.add(p);
    }
  }

  return { mode, paidProvidersAllowed, disabledProviders };
}

export function isCostEligible(providerId: string, model: string, policy: CostPolicy): boolean {
  if (policy.disabledProviders.has(providerId)) return false;
  if (policy.mode === "free_only") {
    const paidIds = ["openai", "anthropic", "deepseek", "kimi"];
    if (paidIds.includes(providerId)) return false;
    return freeModelAllowedCheck(providerId, model);
  }
  if (policy.mode === "paid_enabled") {
    const paidIds = ["openai", "anthropic", "deepseek", "kimi"];
    if (paidIds.includes(providerId)) {
      return policy.paidProvidersAllowed.has(providerId);
    }
    return true;
  }
  return false;
}

function freeModelAllowedCheck(providerId: string, model: string): boolean {
  if (providerId === "ollama") return true;
  if (providerId === "gemini") return ["gemini-3.8-flash", "gemini-3.6-flash"].includes(model);
  if (providerId === "groq") return ["openai/gpt-oss-20b"].includes(model);
  if (providerId === "openrouter") return model === "openrouter/free" || model.endsWith(":free");
  if (providerId === "mistral") return true;
  return false;
}

// ---------------------------------------------------------------------------
// ASPO telemetry
// ---------------------------------------------------------------------------

export function aspoLog(event: string, data: Record<string, unknown>): void {
  log.info("aspo", event, data);
}

export function aspoEligibleProviders(task: string, providers: string[]): void {
  aspoLog("eligible_providers", { task, count: providers.length, providers: providers.join(",") });
}

export function aspoSelected(task: string, providerId: string, model: string, score: number): void {
  aspoLog("selected", { task, provider: providerId, model, score });
}

export function aspoAttemptStart(attemptId: string, providerId: string, model: string, task: string, timeoutMs: number): void {
  aspoLog("attempt_started", { attemptId, provider: providerId, model, task, timeoutMs });
}

export function aspoAttemptResult(
  attemptId: string,
  providerId: string,
  success: boolean,
  latencyMs: number,
  category: FailureCategory | null,
  detail?: string,
): void {
  aspoLog("attempt_result", {
    attemptId,
    provider: providerId,
    success,
    latencyMs,
    category: category ?? "ok",
    detail: detail ?? "",
  });
}

export function aspoHealthUpdated(providerId: string, task: string, category: FailureCategory | "ok", cooldownMs: number): void {
  aspoLog("health_updated", { provider: providerId, task, category, cooldownMs });
}

export function aspoFallback(task: string, fromProvider: string, toProvider: string): void {
  aspoLog("fallback", { task, from: fromProvider, to: toProvider });
}

export function aspoGenerationSucceeded(task: string, providerId: string, model: string, latencyMs: number): void {
  aspoLog("generation_succeeded", { task, provider: providerId, model, latencyMs });
}

export function aspoGenerationFailed(task: string, attempts: number, lastCategory: FailureCategory): void {
  aspoLog("generation_failed", { task, attempts, lastCategory });
}