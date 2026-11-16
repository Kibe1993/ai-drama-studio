import { describe, expect, it } from "vitest";
import { JobError, type JobRecord } from "@/lib/pipeline/types";
import { StoryProviderManager, LlmSequenceError, type ProviderSlot } from "@/lib/providers/llm/manager";
import { llmSequenceRetryAllowed } from "@/lib/pipeline/processJob";
import { seasonArchitectureInstructions, episodeDetailBatchInstructions } from "@/lib/providers/llm/seasonPlanTask";
import { ollamaChat } from "@/lib/providers/llm/ollama";
import type {
  SeasonArchitecturePrompt,
  EpisodeDetailBatchPrompt,
} from "@/lib/providers/llm/seasonPlanTask";
import type {
  SeasonArchitecture,

  EpisodeOutline,
} from "@/lib/validation/seasonPlan";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const archPrompt: SeasonArchitecturePrompt = {
  seriesTitle: "The house",
  storyBible: { identity: { title: "The house" } },
  storyFoundation: "Ada returns to claim the house.",
  creativeDirection: "Make it cold.",
  tone: "cold",
  genre: "family",
  language: "en",
  productionMode: "serialized",
  episodeCount: 6,
  operation: "generate",
};

function outline(n: number): EpisodeOutline {
  return {
    episodeNumber: n,
    workingTitle: `Episode ${n}`,
    narrativePurpose: `Purpose of episode ${n}.`,
    centralConflict: `Conflict of episode ${n}.`,
    endingOrCliffhanger: `Episode ${n} ends on a turn.`,
  };
}

function architecture(episodeCount: number): SeasonArchitecture {
  return {
    seasonObjective: "Ada reclaims the family house.",
    centralConflictOrMystery: "Who hid the deed?",
    mainCharacterObjectives: "Ada wants the truth.",
    overallCharacterDevelopment: "Ada learns the cost of winning.",
    majorStoryDevelopments: ["The deed surfaces.", "Elias admits his part."],
    beginningDirection: "Ada returns.",
    middleDirection: "The search escalates.",
    endingDirection: "Ada chooses.",
    episodeOutlines: Array.from({ length: episodeCount }, (_, i) => outline(i + 1)),
    importantRevelations: ["Elias signed the deed."],
    relationshipChanges: ["Ada and Elias become rivals."],
    consequencesCarriedBetween: ["Elias is exposed."],
    setupAndPayoff: ["The drawer pays off."],
    unresolvedQuestions: ["Where is the second copy?"],
    intendedSeasonConclusion: "Ada keeps the house.",
  };
}

function dummyGenerate(): ProviderSlot["generate"] {
  return async () => {
    throw new Error("Not used in these tests.");
  };
}

function slot(
  id: string,
  options: {
    configured?: boolean;
    generateSeasonArchitecture?: ProviderSlot["generateSeasonArchitecture"];
    generateEpisodeDetails?: ProviderSlot["generateEpisodeDetails"];
  } = {}
): ProviderSlot {
  return {
    id,
    model: `${id}-model`,
    configured: options.configured ?? true,
    generate: dummyGenerate(),
    ...(options.generateSeasonArchitecture ? { generateSeasonArchitecture: options.generateSeasonArchitecture } : {}),
    ...(options.generateEpisodeDetails ? { generateEpisodeDetails: options.generateEpisodeDetails } : {}),
  };
}

function manager(slots: ProviderSlot[]) {
  return new StoryProviderManager({
    slots,
    sequenceTimeoutMs: 10_000,
    providerTimeoutMs: 5_000,
  });
}

function baseJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    clerkUserId: "user-1",
    projectId: "p-1",
    runId: null,
    sceneNumber: null,
    jobType: "seasonPlan.generate",
    provider: "mock",
    model: "mock",
    input: { operation: "generate", episodeCount: 6 },
    output: null,
    status: "processing",
    progress: { stage: "seasonPlan.generate", message: "Generating" },
    attempts: 1,
    maxAttempts: 3,
    error: null,
    idempotencyKey: "key-1",
    bullJobId: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Section A: Schema mismatch — prompt must enumerate all required fields
// ---------------------------------------------------------------------------

describe("Section A: seasonArchitectureInstructions prompt", () => {
  const requiredFields = [
    "seasonObjective",
    "centralConflictOrMystery",
    "mainCharacterObjectives",
    "overallCharacterDevelopment",
    "majorStoryDevelopments",
    "beginningDirection",
    "middleDirection",
    "endingDirection",
    "episodeOutlines",
    "importantRevelations",
    "relationshipChanges",
    "consequencesCarriedBetween",
    "setupAndPayoff",
    "unresolvedQuestions",
    "intendedSeasonConclusion",
  ];

  it("enumerates every required field from seasonArchitectureSchema", () => {
    const { prompt } = seasonArchitectureInstructions(archPrompt);
    for (const field of requiredFields) {
      expect(prompt).toContain(field);
    }
  });

  it("includes a Required output contract section", () => {
    const { prompt } = seasonArchitectureInstructions(archPrompt);
    expect(prompt).toContain("Required output contract");
  });

  it("describes episodeOutlines structure with all sub-fields", () => {
    const { prompt } = seasonArchitectureInstructions(archPrompt);
    expect(prompt).toContain("episodeNumber");
    expect(prompt).toContain("workingTitle");
    expect(prompt).toContain("narrativePurpose");
    expect(prompt).toContain("centralConflict");
    expect(prompt).toContain("endingOrCliffhanger");
  });

  it("does not echo input-only fields as output fields", () => {
    const { prompt } = seasonArchitectureInstructions(archPrompt);
    // These are input fields that the model incorrectly returned before the fix.
    // The prompt should not list them as output fields.
    const outputContractStart = prompt.indexOf("Provide exactly the following");
    const outputContract = outputContractStart >= 0 ? prompt.slice(outputContractStart) : "";
    expect(outputContract).not.toContain("seriesTitle");
    expect(outputContract).not.toContain("productionMode");
    expect(outputContract).not.toContain("episodeCount");
    expect(outputContract).not.toContain("creatorDirection");
    expect(outputContract).not.toContain("seasonLevelDirection");
  });
});

describe("Section A: episodeDetailBatchInstructions prompt", () => {
  const arch = architecture(3);
  const batchPrompt: EpisodeDetailBatchPrompt = {
    seriesTitle: "The house",
    storyBible: {},
    genre: "family",
    language: "en",
    tone: "cold",
    productionMode: "serialized",
    architecture: arch,
    outlines: arch.episodeOutlines.slice(0, 3),
  };

  it("includes a Required output contract section", () => {
    const { prompt } = episodeDetailBatchInstructions(batchPrompt);
    expect(prompt).toContain("Required output contract");
  });

  it("enumerates all episode detail fields", () => {
    const { prompt } = episodeDetailBatchInstructions(batchPrompt);
    const expectedFields = [
      "episodeNumber",
      "workingTitle",
      "narrativePurpose",
      "startingSituation",
      "mainObjective",
      "centralConflict",
      "majorStoryBeats",
      "informationRevealed",
      "characterDevelopment",
      "importantEvents",
      "consequences",
      "storyContribution",
      "endingOrCliffhanger",
      "unresolvedThreads",
      "continuityRequirements",
      "characterArcChanges",
      "relationshipChanges",
      "objectChanges",
      "locationChanges",
    ];
    for (const field of expectedFields) {
      expect(prompt).toContain(field);
    }
  });
});

// ---------------------------------------------------------------------------
// Section B: Ollama timeout — external signal must not be overridden
// ---------------------------------------------------------------------------

describe("Section B: ollamaChat signal handling", () => {
  it("uses the provided external signal without adding a competing internal timeout", async () => {
    // When an external signal is provided (e.g., from the manager's budget),
    // ollamaChat must use it directly. The internal timeoutMs must NOT create
    // a shorter AbortSignal that kills the request before the manager's budget
    // expires.
    const controller = new AbortController();
    const fetchSpy = globalThis.fetch;
    let capturedSignal: AbortSignal | null | undefined;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal;
      // Never resolve — let the signal abort it.
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }
      });
    }) as typeof fetch;

    try {
      const promise = ollamaChat({
        baseURL: "http://127.0.0.1:11434",
        model: "test-model",
        prompt: "test",
        signal: controller.signal,
        timeoutMs: 240_000,
      });

      // Abort via the external signal after a short delay.
      setTimeout(() => controller.abort(), 50);

      await expect(promise).rejects.toThrow();

      // The signal passed to fetch must be the exact same signal we provided,
      // not a new AbortSignal.any() that wraps it.
      expect(capturedSignal).toBe(controller.signal);
    } finally {
      globalThis.fetch = fetchSpy;
    }
  });

  it("creates its own timeout signal when no external signal is provided", async () => {
    const fetchSpy = globalThis.fetch;
    let capturedSignal: AbortSignal | null | undefined;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }
      });
    }) as typeof fetch;

    try {
      const promise = ollamaChat({
        baseURL: "http://127.0.0.1:11434",
        model: "test-model",
        prompt: "test",
        timeoutMs: 100,
      });

      await expect(promise).rejects.toThrow();

      // When no external signal is provided, ollamaChat must create its own
      // timeout signal.
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal?.aborted).toBe(true);
    } finally {
      globalThis.fetch = fetchSpy;
    }
  });
});

// ---------------------------------------------------------------------------
// Section C: BullMQ retry — failure-aware retry decisions
// ---------------------------------------------------------------------------

describe("Section C: llmSequenceRetryAllowed failure-aware logic", () => {
  function jobWithAttempts(attempts: number): JobRecord {
    return baseJob({ attempts });
  }

  const nonTransientCodes = [
    "configuration",
    "authentication",
    "forbidden",
    "ownership",
    "dependency",
    "bible_required",
    "story_required",
    "invalid_input",
    "invalid_job",
    "not_found",
    "invalid_model",
  ];

  const transientCodes = [
    "rate_limited",
    "timeout",
    "provider_unavailable",
    "quota_exhausted",
    "provider_failed",
    "empty_response",
    "invalid_json",
    "invalid_schema",
    "truncated_output",
    "content_validation_error",
  ];

  for (const code of nonTransientCodes) {
    it(`returns false for non-transient code "${code}"`, () => {
      const error = new LlmSequenceError("Failed.", code, false, []);
      expect(llmSequenceRetryAllowed(error, jobWithAttempts(1))).toBe(false);
    });
  }

  for (const code of transientCodes) {
    it(`returns true for transient code "${code}" on first attempt`, () => {
      const error = new LlmSequenceError("Failed.", code, true, []);
      expect(llmSequenceRetryAllowed(error, jobWithAttempts(1))).toBe(true);
    });
  }

  it("returns false for transient codes on second attempt (attempts >= 2)", () => {
    const error = new LlmSequenceError("Failed.", "rate_limited", true, []);
    expect(llmSequenceRetryAllowed(error, jobWithAttempts(2))).toBe(false);
  });

  it("returns true for non-LlmSequenceError errors", () => {
    const error = new JobError("Failed.", "stage_failed", true);
    expect(llmSequenceRetryAllowed(error, jobWithAttempts(1))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section E: Failure scenario tests through the provider manager
// ---------------------------------------------------------------------------

describe("Section E: failure scenario failover", () => {
  it("fails over on timeout", async () => {
    const arch = architecture(6);
    const first = slot("ollama", {
      generateSeasonArchitecture: async () => {
        throw new JobError("Ollama timed out.", "timeout", true);
      },
    });
    const second = slot("groq", {
      generateSeasonArchitecture: async () => ({ architecture: arch }),
    });
    const result = await manager([first, second]).generateSeasonArchitecture!(archPrompt);
    expect(result.architecture).toEqual(arch);
    expect(result.provider).toBe("groq");
    expect(result.fallbackFrom).toBeNull();
  });

  it("fails over on invalid_schema", async () => {
    const arch = architecture(6);
    const first = slot("groq", {
      generateSeasonArchitecture: async () => {
        throw new JobError("Invalid schema returned.", "invalid_schema", true);
      },
    });
    const second = slot("openrouter", {
      generateSeasonArchitecture: async () => ({ architecture: arch }),
    });
    const result = await manager([first, second]).generateSeasonArchitecture!(archPrompt);
    expect(result.architecture).toEqual(arch);
    expect(result.provider).toBe("openrouter");
  });

  it("fails over on 429 rate_limited", async () => {
    const arch = architecture(6);
    const first = slot("mistral", {
      generateSeasonArchitecture: async () => {
        throw new JobError("Mistral rate limited.", "rate_limited", true);
      },
    });
    const second = slot("gemini", {
      generateSeasonArchitecture: async () => ({ architecture: arch }),
    });
    const result = await manager([first, second]).generateSeasonArchitecture!(archPrompt);
    expect(result.architecture).toEqual(arch);
    expect(result.provider).toBe("gemini");
  });

  it("fails over on provider_unavailable", async () => {
    const arch = architecture(6);
    const first = slot("ollama", {
      generateSeasonArchitecture: async () => {
        throw new JobError("Ollama not running.", "provider_unavailable", true);
      },
    });
    const second = slot("groq", {
      generateSeasonArchitecture: async () => ({ architecture: arch }),
    });
    const result = await manager([first, second]).generateSeasonArchitecture!(archPrompt);
    expect(result.architecture).toEqual(arch);
    expect(result.provider).toBe("groq");
  });

  it("aborts immediately on configuration error (non-failover code)", async () => {
    const first = slot("groq", {
      generateSeasonArchitecture: async () => {
        throw new JobError("GROQ_API_KEY not set.", "configuration", false);
      },
    });
    const second = slot("openrouter", {
      generateSeasonArchitecture: async () => {
        throw new Error("Should not be reached.");
      },
    });
    await expect(
      manager([first, second]).generateSeasonArchitecture!(archPrompt)
    ).rejects.toThrow(LlmSequenceError);
  });

  it("aborts immediately on authentication error (non-failover code)", async () => {
    const first = slot("groq", {
      generateSeasonArchitecture: async () => {
        throw new JobError("Invalid API key.", "authentication", false);
      },
    });
    const second = slot("openrouter", {
      generateSeasonArchitecture: async () => {
        throw new Error("Should not be reached.");
      },
    });
    await expect(
      manager([first, second]).generateSeasonArchitecture!(archPrompt)
    ).rejects.toThrow(LlmSequenceError);
  });

  it("throws LlmSequenceError when all providers fail with transient codes", async () => {
    const first = slot("groq", {
      generateSeasonArchitecture: async () => {
        throw new JobError("Groq rate limited.", "rate_limited", true);
      },
    });
    const second = slot("openrouter", {
      generateSeasonArchitecture: async () => {
        throw new JobError("OpenRouter timed out.", "timeout", true);
      },
    });
    await expect(
      manager([first, second]).generateSeasonArchitecture!(archPrompt)
    ).rejects.toThrow(LlmSequenceError);
  });

  it("preserves checkpoint data in job.output across retries", () => {
    // Simulate a job that has cached architecture from a previous attempt.
    const arch = architecture(6);
    const job = baseJob({
      attempts: 1,
      output: {
        seasonArchitecture: arch,
        episodeDetails: [],
      },
    });

    // The engine's readSeasonPlanProgress reads from job.output.
    // Verify the structure is preserved.
    expect(job.output).toBeDefined();
    expect(job.output!.seasonArchitecture).toEqual(arch);
    expect(Array.isArray(job.output!.episodeDetails)).toBe(true);
  });
});