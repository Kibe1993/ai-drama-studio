import { describe, expect, it, vi } from "vitest";
import { JobError } from "@/lib/pipeline/types";
import { classifyProviderError } from "@/lib/providers/llm/errors";
import { StoryProviderManager, LlmSequenceError, type ProviderSlot } from "@/lib/providers/llm/manager";
import {
  ProviderAvailabilityManager,
  type CostPolicy,

  classifyFailure,
  cooldownFor,
  isCostEligible,
  parseCostPolicy,
  recoveryFor,
} from "@/lib/providers/llm/aspo";
import { parseStory } from "@/lib/providers/llm/parse";
import type { StoryPrompt } from "@/lib/providers/llm/types";
import type { GeneratedStory } from "@/lib/validation/story";

const prompt: StoryPrompt = {
  title: "The courtyard",
  idea: "A daughter asks to be let back in.",
  genre: "family",
  language: "en",
  visualStyle: "realistic",
  tone: "quiet",
  targetDurationSeconds: 60,
  aspectRatio: "16:9",
};

const sample: GeneratedStory = {
  title: "The closed gate",
  synopsis: "A daughter returns at night and asks to be let in.",
  structure: {
    act1: {
      introduction: "Night at a family house.",
      mainCharacters: "Ada and her father.",
      setting: "A locked courtyard.",
      initialSituation: "Ada has been away for a year.",
      incitingIncident: "She knocks on the gate.",
    },
    act2: {
      risingTension: "Her father will not answer.",
      obstacles: "The rest of the family is listening.",
      characterDecisions: "Ada refuses to leave.",
      turningPoint: "He lifts the latch.",
    },
    act3: {
      climax: "They speak through the opening.",
      resolution: "She steps inside.",
      finalOutcome: "The gate stays unlatched.",
    },
  },
  screenplay: [
    {
      sceneNumber: 1,
      heading: "EXT. COURTYARD - NIGHT",
      location: "Courtyard",
      timeOfDay: "Night",
      charactersPresent: ["Ada", "Father"],
      visualDescription: "A locked iron gate in warm window light.",
      action: "Ada knocks once and waits.",
      dialogue: [{ characterName: "Ada", line: "I came back." }],
    },
  ],
};

function slot(
  id: string,
  generate: ProviderSlot["generate"],
  options: { configured?: boolean; supported?: boolean; model?: string } = {}
): ProviderSlot {
  return {
    id,
    model: options.model ?? `${id}-model`,
    configured: options.configured ?? true,
    supported: options.supported ?? true,
    generate,
  };
}

function aspoManager(
  slots: ProviderSlot[],
  options: {
    availabilityManager?: ProviderAvailabilityManager;
    costPolicy?: CostPolicy;
    sequenceTimeoutMs?: number;
    providerTimeoutMs?: number;
  } = {}
) {
  return new StoryProviderManager({
    slots,
    sequenceTimeoutMs: options.sequenceTimeoutMs ?? 10_000,
    providerTimeoutMs: options.providerTimeoutMs ?? 5_000,
    availabilityManager: options.availabilityManager ?? new ProviderAvailabilityManager(),
    costPolicy: options.costPolicy,
  });
}

const freeOnlyPolicy: CostPolicy = {
  mode: "free_only",
  paidProvidersAllowed: new Set<string>(),
  disabledProviders: new Set<string>(),
};

const paidEnabledPolicy: CostPolicy = {
  mode: "paid_enabled",
  paidProvidersAllowed: new Set(["openai", "anthropic", "deepseek"]),
  disabledProviders: new Set<string>(),
};

describe("ASPO: adaptive sequential provider orchestration", () => {
  it("1. first provider succeeds", async () => {
    const second = vi.fn();
    const result = await aspoManager([
      slot("groq", async () => ({ story: sample, usage: { inputTokens: 10, outputTokens: 20 } })),
      slot("openrouter", second),
    ]).generateStory(prompt);
    expect(result.title).toBe("The closed gate");
    expect(result.provider).toBe("groq");
    expect(result.fallbackFrom).toBeNull();
    expect(second).not.toHaveBeenCalled();
  });

  it("2. first provider returns invalid JSON and fails over", async () => {
    const result = await aspoManager([
      slot("groq", async () => {
        parseStory("Groq", "not json");
        return { story: sample };
      }),
      slot("openrouter", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("openrouter");
    expect(result.attempts?.[0]?.category).toBe("invalid_json");
    expect(result.fallbackFrom).toBe("groq");
  });

  it("3. first provider times out and fails over", async () => {
    const result = await aspoManager(
      [
        slot("groq", (_input, options) => {
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              reject(new Error("Request was aborted."));
            });
          });
        }),
        slot("openrouter", async () => ({ story: sample })),
      ],
      { providerTimeoutMs: 30, sequenceTimeoutMs: 5_000 }
    ).generateStory(prompt);
    expect(result.provider).toBe("openrouter");
    expect(result.attempts?.[0]?.category).toBe("timeout");
  });

  it("4. first provider returns HTTP 429 and fails over", async () => {
    const result = await aspoManager([
      slot("groq", async () => {
        throw classifyProviderError("Groq", { status: 429, message: "rate limited" });
      }),
      slot("openrouter", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("openrouter");
    expect(result.attempts?.[0]?.category).toBe("rate_limited");
  });

  it("5. first provider has invalid credentials and ASPO skips to next provider", async () => {
    const result = await aspoManager([
      slot("groq", async () => {
        throw classifyProviderError("Groq", { status: 401, message: "bad credentials" });
      }),
      slot("openrouter", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("openrouter");
    expect(result.attempts?.[0]?.category).toBe("authentication");
    expect(result.fallbackFrom).toBe("groq");
  });

  it("6. provider returns empty content and fails over", async () => {
    const result = await aspoManager([
      slot("groq", async () => {
        throw new JobError("Groq returned an empty response.", "empty_response", true);
      }),
      slot("openrouter", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("openrouter");
    expect(result.attempts?.[0]?.category).toBe("empty_response");
  });

  it("7. provider returns truncated content (too few scenes) and fails over", async () => {
    const truncatedStory: GeneratedStory = {
      ...sample,
      screenplay: [],
    };
    const result = await aspoManager([
      slot("groq", async () => ({ story: truncatedStory, truncated: true })),
      slot("openrouter", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("openrouter");
    expect(result.attempts?.[0]?.success).toBe(false);
  });

  it("8. all cloud providers fail and Ollama succeeds", async () => {
    const result = await aspoManager([
      slot("groq", async () => {
        throw classifyProviderError("Groq", { status: 503, message: "unavailable" });
      }),
      slot("openrouter", async () => {
        throw classifyProviderError("OpenRouter", { status: 429, message: "rate limited" });
      }),
      slot("mistral", async () => {
        throw new JobError("Mistral timed out.", "timeout", true);
      }),
      slot("ollama", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("ollama");
    expect(result.fallbackFrom).toBeTruthy();
    expect(result.attempts?.filter((a) => !a.success).length).toBe(6);
  });

  it("9. all providers fail", async () => {
    await expect(
      aspoManager([
        slot("groq", async () => {
          throw classifyProviderError("Groq", { status: 503, message: "unavailable" });
        }),
        slot("openrouter", async () => {
          throw classifyProviderError("OpenRouter", { status: 429, message: "rate limited" });
        }),
      ]).generateStory(prompt)
    ).rejects.toBeInstanceOf(LlmSequenceError);
  });

  it("10. a provider becomes available after cooldown", async () => {
    const availabilityManager = new ProviderAvailabilityManager();
    const manager = aspoManager(
      [
        slot("groq", async () => {
          throw classifyProviderError("Groq", { status: 429, message: "rate limited" });
        }),
        slot("openrouter", async () => ({ story: sample })),
      ],
      { availabilityManager }
    );
    const result1 = await manager.generateStory(prompt);
    expect(result1.provider).toBe("openrouter");
    expect(availabilityManager.isAvailable("groq")).toBe(false);
    const cooldown = cooldownFor("rate_limited");
    vi.useFakeTimers();
    vi.advanceTimersByTime(cooldown + 1_000);
    expect(availabilityManager.isAvailable("groq")).toBe(true);
    vi.useRealTimers();
  });

  it("11. paid providers excluded in free-only mode", async () => {
    const openaiGenerate = vi.fn(async () => ({ story: sample }));
    const costPolicy: CostPolicy = {
      mode: "free_only",
      paidProvidersAllowed: new Set<string>(),
      disabledProviders: new Set<string>(),
    };
    const result = await aspoManager(
      [
        slot("groq", async () => ({ story: sample })),
        slot("openai", openaiGenerate),
      ],
      { costPolicy }
    ).generateStory(prompt);
    expect(result.provider).toBe("groq");
    expect(isCostEligible("openai", "gpt-4o", costPolicy)).toBe(false);
    expect(isCostEligible("anthropic", "claude-3", costPolicy)).toBe(false);
    expect(isCostEligible("deepseek", "deepseek-chat", costPolicy)).toBe(false);
  });

  it("12. Gemini and other eligible configured providers are included", async () => {
    const availabilityManager = new ProviderAvailabilityManager();
    const geminiGenerate = vi.fn(async () => ({ story: sample }));
    const manager = aspoManager(
      [
        slot("groq", async () => {
          throw classifyProviderError("Groq", { status: 503, message: "unavailable" });
        }),
        slot("gemini", geminiGenerate, { model: "gemini-3.8-flash" }),
        slot("openrouter", async () => ({ story: sample })),
      ],
      { availabilityManager, costPolicy: freeOnlyPolicy }
    );
    const result = await manager.generateStory(prompt);
    expect(result.provider).toBe("gemini");
    expect(geminiGenerate).toHaveBeenCalledOnce();
  });

  it("13. a previous provider attempt is cancelled before the next starts", async () => {
    const abortSignals: AbortSignal[] = [];
    const result = await aspoManager(
      [
        slot("groq", (_input, options) => {
          abortSignals.push(options.signal);
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              reject(new Error("Request was aborted."));
            });
          });
        }),
        slot("openrouter", async (_input, options) => {
          abortSignals.push(options.signal);
          expect(options.signal.aborted).toBe(false);
          return { story: sample };
        }),
      ],
      { providerTimeoutMs: 30, sequenceTimeoutMs: 5_000 }
    ).generateStory(prompt);
    expect(result.provider).toBe("openrouter");
    expect(abortSignals.length).toBe(2);
    expect(abortSignals[0]!.aborted).toBe(true);
    expect(abortSignals[1]!.aborted).toBe(false);
  });

  it("14. a worker restarts with a fresh availability manager and selects by initial priority", async () => {
    const availabilityManagerBefore = new ProviderAvailabilityManager();
    availabilityManagerBefore.recordSuccess("groq", "story", 500);
    availabilityManagerBefore.recordFailure("openrouter", "story", "rate_limited", 1000);
    const freshManager = new ProviderAvailabilityManager();
    expect(freshManager.getTaskStats("groq", "story")).toBeUndefined();
    expect(freshManager.getTaskStats("openrouter", "story")).toBeUndefined();
    const result = await aspoManager(
      [
        slot("groq", async () => ({ story: sample })),
        slot("openrouter", async () => ({ story: { ...sample, title: "From OpenRouter" } })),
      ],
      { availabilityManager: freshManager }
    ).generateStory(prompt);
    expect(result.provider).toBe("groq");
    expect(result.title).toBe("The closed gate");
  });
});

describe("ASPO: failure classification", () => {
  it("maps HTTP 401 to authentication_error", () => {
    const error = classifyProviderError("Groq", { status: 401, message: "unauthorized" });
    const result = classifyFailure("groq", error);
    expect(result.category).toBe("authentication_error");
    expect(recoveryFor(result.category)).toBe("skip_provider");
  });

  it("maps HTTP 403 to permission_error", () => {
    const error = classifyProviderError("Groq", { status: 403, message: "forbidden" });
    const result = classifyFailure("groq", error);
    expect(result.category).toBe("permission_error");
    expect(recoveryFor(result.category)).toBe("skip_provider");
  });

  it("maps HTTP 429 to rate_limited", () => {
    const error = classifyProviderError("Groq", { status: 429, message: "too many requests" });
    const result = classifyFailure("groq", error);
    expect(result.category).toBe("rate_limited");
    expect(recoveryFor(result.category)).toBe("cooldown_medium");
  });

  it("maps HTTP 503 to provider_overloaded", () => {
    const error = classifyProviderError("Groq", { status: 503, message: "unavailable" });
    const result = classifyFailure("groq", error);
    expect(result.category).toBe("provider_overloaded");
  });

  it("maps quota text patterns to quota_exhausted", () => {
    const error = new Error("You exceeded your current quota, please check your plan and billing details.");
    const result = classifyFailure("groq", error);
    expect(result.category).toBe("quota_exhausted");
    expect(recoveryFor(result.category)).toBe("cooldown_long");
  });

  it("maps timeout text patterns to timeout", () => {
    const error = new Error("The request timed out.");
    const result = classifyFailure("groq", error);
    expect(result.category).toBe("timeout");
  });

  it("maps connection errors to connection_error", () => {
    const error = new Error("fetch failed: ECONNRESET");
    const result = classifyFailure("groq", error);
    expect(result.category).toBe("connection_error");
  });

  it("maps truncated flag to truncated_output when category is unknown", () => {
    const error = new Error("Unknown error");
    const result = classifyFailure("groq", error, true);
    expect(result.category).toBe("truncated_output");
  });
});

describe("ASPO: cost policy", () => {
  it("free_only mode blocks paid providers", () => {
    expect(isCostEligible("openai", "gpt-4o", freeOnlyPolicy)).toBe(false);
    expect(isCostEligible("anthropic", "claude-3", freeOnlyPolicy)).toBe(false);
    expect(isCostEligible("deepseek", "deepseek-chat", freeOnlyPolicy)).toBe(false);
  });

  it("free_only mode allows free providers", () => {
    expect(isCostEligible("ollama", "gemma3:4b", freeOnlyPolicy)).toBe(true);
    expect(isCostEligible("mistral", "mistral-small-latest", freeOnlyPolicy)).toBe(true);
  });

  it("paid_enabled mode allows paid providers in the allowed set", () => {
    expect(isCostEligible("openai", "gpt-4o", paidEnabledPolicy)).toBe(true);
    expect(isCostEligible("anthropic", "claude-3", paidEnabledPolicy)).toBe(true);
    expect(isCostEligible("deepseek", "deepseek-chat", paidEnabledPolicy)).toBe(true);
  });

  it("disabled providers are blocked in any mode", () => {
    const policy: CostPolicy = {
      mode: "paid_enabled",
      paidProvidersAllowed: new Set(["openai"]),
      disabledProviders: new Set(["groq"]),
    };
    expect(isCostEligible("groq", "openai/gpt-oss-20b", policy)).toBe(false);
    expect(isCostEligible("openai", "gpt-4o", policy)).toBe(true);
  });

  it("parseCostPolicy defaults to free_only", () => {
    const policy = parseCostPolicy({});
    expect(policy.mode).toBe("free_only");
  });

  it("parseCostPolicy enables paid mode when LLM_PAID_ENABLED is true", () => {
    const policy = parseCostPolicy({ LLM_PAID_ENABLED: "true" });
    expect(policy.mode).toBe("paid_enabled");
    expect(policy.paidProvidersAllowed.has("openai")).toBe(true);
  });

  it("parseCostPolicy respects LLM_DISABLED_PROVIDERS", () => {
    const policy = parseCostPolicy({ LLM_DISABLED_PROVIDERS: "groq,mistral" });
    expect(policy.disabledProviders.has("groq")).toBe(true);
    expect(policy.disabledProviders.has("mistral")).toBe(true);
  });
});

describe("ASPO: availability manager", () => {
  it("records success and reports availability", () => {
    const manager = new ProviderAvailabilityManager();
    manager.registerProvider("groq", "openai/gpt-oss-20b", true);
    manager.recordSuccess("groq", "story", 500);
    expect(manager.isAvailable("groq")).toBe(true);
    const stats = manager.getTaskStats("groq", "story");
    expect(stats?.successes).toBe(1);
    expect(stats?.attempts).toBe(1);
    expect(stats?.consecutiveFailures).toBe(0);
  });

  it("records failure and applies cooldown", () => {
    const manager = new ProviderAvailabilityManager();
    manager.registerProvider("groq", "openai/gpt-oss-20b", true);
    manager.recordFailure("groq", "story", "rate_limited", 1000);
    expect(manager.isAvailable("groq")).toBe(false);
    expect(manager.getCooldownRemaining("groq")).toBeGreaterThan(0);
  });

  it("permanently skips providers with authentication errors", () => {
    const manager = new ProviderAvailabilityManager();
    manager.registerProvider("groq", "openai/gpt-oss-20b", true);
    manager.recordFailure("groq", "story", "authentication_error", 100);
    expect(manager.isAvailable("groq")).toBe(false);
    const stats = manager.getStats("groq");
    expect(stats?.permanentSkip).toBe(true);
  });

  it("clears cooldown on clearCooldown", () => {
    const manager = new ProviderAvailabilityManager();
    manager.registerProvider("groq", "openai/gpt-oss-20b", true);
    manager.recordFailure("groq", "story", "rate_limited", 100);
    expect(manager.isAvailable("groq")).toBe(false);
    manager.clearCooldown("groq");
    expect(manager.isAvailable("groq")).toBe(true);
  });

  it("selects providers by score with no history", () => {
    const manager = new ProviderAvailabilityManager();
    const result = manager.selectProvider("story", [
      { providerId: "groq", configured: true, supported: true, costEligible: true },
      { providerId: "openrouter", configured: true, supported: true, costEligible: true },
      { providerId: "ollama", configured: true, supported: true, costEligible: true },
    ]);
    expect(result.selected).toBe("groq");
    expect(result.scores.length).toBe(3);
  });

  it("boosts primary provider priority", () => {
    const manager = new ProviderAvailabilityManager({
      initialPriority: { ollama: 110, groq: 100, openrouter: 90 },
    });
    const result = manager.selectProvider("story", [
      { providerId: "groq", configured: true, supported: true, costEligible: true },
      { providerId: "ollama", configured: true, supported: true, costEligible: true },
      { providerId: "openrouter", configured: true, supported: true, costEligible: true },
    ]);
    expect(result.selected).toBe("ollama");
  });

  it("excludes unconfigured providers from selection", () => {
    const manager = new ProviderAvailabilityManager();
    const result = manager.selectProvider("story", [
      { providerId: "groq", configured: true, supported: true, costEligible: true },
      { providerId: "openai", configured: false, supported: true, costEligible: true },
    ]);
    expect(result.selected).toBe("groq");
    expect(result.scores.find((s) => s.providerId === "openai")?.eligible).toBe(false);
  });

  it("excludes cost-ineligible providers from selection", () => {
    const manager = new ProviderAvailabilityManager();
    const result = manager.selectProvider("story", [
      { providerId: "groq", configured: true, supported: true, costEligible: true },
      { providerId: "openai", configured: true, supported: true, costEligible: false },
    ]);
    expect(result.selected).toBe("groq");
    expect(result.scores.find((s) => s.providerId === "openai")?.eligible).toBe(false);
  });

  it("returns null when no providers are eligible", () => {
    const manager = new ProviderAvailabilityManager();
    const result = manager.selectProvider("story", [
      { providerId: "groq", configured: false, supported: true, costEligible: true },
      { providerId: "openai", configured: true, supported: false, costEligible: true },
    ]);
    expect(result.selected).toBeNull();
  });

  it("selectOrder returns all eligible providers sorted by score", () => {
    const manager = new ProviderAvailabilityManager({
      initialPriority: { ollama: 110, groq: 100, openrouter: 90 },
    });
    const order = manager.selectOrder("story", [
      { providerId: "groq", configured: true, supported: true, costEligible: true },
      { providerId: "ollama", configured: true, supported: true, costEligible: true },
      { providerId: "openrouter", configured: true, supported: true, costEligible: true },
    ]);
    expect(order).toEqual(["ollama", "groq", "openrouter"]);
  });

  it("selectOrder includes cooldown providers sorted last", () => {
    const manager = new ProviderAvailabilityManager({
      initialPriority: { ollama: 110, groq: 100, openrouter: 90 },
    });
    manager.registerProvider("ollama", "qwen3:4b", true);
    manager.registerProvider("groq", "openai/gpt-oss-20b", true);
    manager.registerProvider("openrouter", "openrouter/free", true);
    manager.recordFailure("ollama", "story_bible", "connection_error", 1000);
    expect(manager.isAvailable("ollama")).toBe(false);
    const order = manager.selectOrder("story_bible", [
      { providerId: "groq", configured: true, supported: true, costEligible: true },
      { providerId: "ollama", configured: true, supported: true, costEligible: true },
      { providerId: "openrouter", configured: true, supported: true, costEligible: true },
    ]);
    expect(order).toEqual(["groq", "openrouter", "ollama"]);
  });

  it("selectOrder excludes permanently skipped providers but includes cooldown", () => {
    const manager = new ProviderAvailabilityManager({
      initialPriority: { ollama: 110, groq: 100, openrouter: 90 },
    });
    manager.registerProvider("ollama", "qwen3:4b", true);
    manager.registerProvider("groq", "openai/gpt-oss-20b", true);
    manager.registerProvider("openrouter", "openrouter/free", true);
    manager.recordFailure("groq", "story", "authentication_error", 100);
    manager.recordFailure("ollama", "story", "connection_error", 1000);
    const order = manager.selectOrder("story", [
      { providerId: "groq", configured: true, supported: true, costEligible: true },
      { providerId: "ollama", configured: true, supported: true, costEligible: true },
      { providerId: "openrouter", configured: true, supported: true, costEligible: true },
    ]);
    expect(order).toEqual(["openrouter", "ollama"]);
    expect(order).not.toContain("groq");
  });
});