import { describe, expect, it, vi } from "vitest";
import { createLiveEngines } from "@/lib/pipeline/liveEngines";
import { JobError, type JobRecord, type RunRecord } from "@/lib/pipeline/types";
import { classifyProviderError, failedGenerationOf } from "@/lib/providers/llm/errors";
import { StoryProviderManager, type ProviderSlot } from "@/lib/providers/llm/manager";
import { providerSequence } from "@/lib/providers/llm/registry";
import { storyBibleResponseFormat } from "@/lib/providers/llm/chatStages";
import { parseStory } from "@/lib/providers/llm/parse";
import type { StoryPrompt } from "@/lib/providers/llm/types";
import type { GeneratedStory, StoryRecord } from "@/lib/validation/story";

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

function manager(slots: ProviderSlot[], timeouts: { sequenceTimeoutMs?: number; providerTimeoutMs?: number } = {}) {
  return new StoryProviderManager({ slots, sequenceTimeoutMs: 5_000, providerTimeoutMs: 1_000, ...timeouts });
}

describe("provider sequence", () => {
  it("keeps the configured fallback order", () => {
    expect(
      providerSequence({
        LLM_PROVIDER: "gemini",
        LLM_FALLBACK_PROVIDERS: "openai,anthropic,deepseek",
      })
    ).toEqual(["gemini", "openai", "anthropic", "deepseek"]);
  });
});

describe("language provider failover", () => {
  it("returns the first provider when it succeeds", async () => {
    const second = vi.fn();
    const result = await manager([
      slot("gemini", async () => ({ story: sample, usage: { inputTokens: 10, outputTokens: 20 } })),
      slot("openai", second),
    ]).generateStory(prompt);
    expect(result.title).toBe("The closed gate");
    expect(result.provider).toBe("gemini");
    expect(result.fallbackFrom).toBeNull();
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(second).not.toHaveBeenCalled();
  });

  it("fails over a 503 to the next provider", async () => {
    const result = await manager([
      slot("gemini", async () => {
        throw classifyProviderError("Gemini", { status: 503, message: "unavailable" });
      }),
      slot("openai", async () => ({ story: { ...sample, title: "From OpenAI" } })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("openai");
    expect(result.fallbackFrom).toBe("gemini");
    expect(result.title).toBe("From OpenAI");
  });

  it("fails over a provider timeout", async () => {
    const result = await manager(
      [
        slot("gemini", (_input, options) => {
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              reject(new Error("Request was aborted."));
            });
          });
        }),
        slot("openai", async () => ({ story: sample })),
      ],
      { providerTimeoutMs: 30, sequenceTimeoutMs: 5_000 }
    ).generateStory(prompt);
    expect(result.provider).toBe("openai");
    expect(result.attempts?.[0]?.category).toBe("timeout");
  });

  it("treats an SDK-wrapped provider_failed abort as a timeout and reaches the next model", async () => {
    const second = vi.fn(async () => ({ story: sample }));
    const result = await manager(
      [
        slot("openrouter", (_input, options) => new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            reject(classifyProviderError("OpenRouter", new Error("Request was aborted.")));
          });
        })),
        slot("mistral", second),
      ],
      { providerTimeoutMs: 30, sequenceTimeoutMs: 5_000 }
    ).generateStory(prompt);
    expect(result.provider).toBe("mistral");
    expect(result.attempts?.[0]?.category).toBe("timeout");
    expect(second).toHaveBeenCalledOnce();
  });

  it("shares the bounded sequence budget so later providers get a fallback attempt", async () => {
    const second = vi.fn(async () => ({ story: sample }));
    const result = await manager(
        [
          slot("gemini", (_input, options) => {
            return new Promise((_resolve, reject) => {
              options.signal.addEventListener("abort", () => {
                const error = new Error("timed out");
                error.name = "TimeoutError";
                reject(error);
              });
            });
          }),
          slot("openai", second),
        ],
        { providerTimeoutMs: 80, sequenceTimeoutMs: 1_050 }
      ).generateStory(prompt);
    expect(second).toHaveBeenCalledOnce();
    expect(result.provider).toBe("openai");
    expect(result.attempts?.[0]?.category).toBe("timeout");
  });

  it("fails over malformed JSON and does not return it", async () => {
    const result = await manager([
      slot("gemini", async () => {
        parseStory("Gemini", "not json");
        return { story: sample };
      }),
      slot("openai", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("openai");
    expect(result.attempts?.[0]?.category).toBe("invalid_json");
  });

  it("fails over a Zod validation failure", async () => {
    const result = await manager([
      slot("gemini", async () => ({ story: { title: "Only a title" } as GeneratedStory })),
      slot("anthropic", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("anthropic");
    expect(result.attempts?.[0]?.category).toBe("invalid_schema");
    expect(result.title).toBe("The closed gate");
  });

  it("stops the sequence on an authentication error", async () => {
    const second = vi.fn();
    await expect(
      manager([
        slot("gemini", async () => {
          throw classifyProviderError("Gemini", { status: 401, message: "bad credentials" });
        }),
        slot("openai", second),
      ]).generateStory(prompt)
    ).rejects.toMatchObject({ code: "authentication", retryable: false });
    expect(second).not.toHaveBeenCalled();
  });

  it("tries the next provider when one provider rejects the request", async () => {
    const result = await manager([
      slot("openai", async () => {
        throw classifyProviderError("OpenAI", { status: 400, message: "invalid request" });
      }),
      slot("anthropic", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(result.provider).toBe("anthropic");
    expect(result.attempts?.[0]?.category).toBe("invalid_request");
  });

  it("stops when the primary provider has no credentials", async () => {
    const second = vi.fn();
    await expect(
      manager([
        slot("gemini", second, { configured: false }),
        slot("openai", second),
      ]).generateStory(prompt)
    ).rejects.toMatchObject({ code: "configuration", retryable: false });
    expect(second).not.toHaveBeenCalled();
  });

  it("skips a fallback with missing credentials", async () => {
    const skipped = vi.fn();
    const result = await manager([
      slot("gemini", async () => {
        throw classifyProviderError("Gemini", { status: 503, message: "unavailable" });
      }),
      slot("openai", skipped, { configured: false }),
      slot("deepseek", async () => ({ story: sample })),
    ]).generateStory(prompt);
    expect(skipped).not.toHaveBeenCalled();
    expect(result.provider).toBe("deepseek");
  });

  it("fails when every provider fails and keeps the error retryable for transport failures", async () => {
    await expect(
      manager([
        slot("gemini", async () => {
          throw classifyProviderError("Gemini", { status: 503, message: "unavailable" });
        }),
        slot("openai", async () => {
          throw classifyProviderError("OpenAI", { status: 502, message: "bad gateway" });
        }),
      ]).generateStory(prompt)
    ).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
  });

  it("does not log secret values from a malformed response", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((message?: unknown) => {
      lines.push(String(message));
    });
    expect(() => parseStory("OpenAI", "not-json sk-testsecretvalue AIzaTestsecretvalue")).toThrow(JobError);
    const logged = lines.join("\n");
    expect(logged).not.toContain("sk-testsecretvalue");
    expect(logged).not.toContain("AIzaTestsecretvalue");
    spy.mockRestore();
  });

  it("saves one story after failover and does not insert another on a second delivery", async () => {
    const rows: StoryRecord[] = [];
    const stories = {
      async upsertAwaiting(input: Omit<StoryRecord, "id" | "status" | "version" | "createdAt" | "updatedAt">) {
        const existing = rows.find((row) => row.productionRunId === input.productionRunId);
        const now = new Date().toISOString();
        if (existing) {
          Object.assign(existing, input, { updatedAt: now });
          return existing;
        }
        const created: StoryRecord = {
          ...input,
          id: "c".repeat(24),
          status: "awaiting_approval",
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        rows.push(created);
        return created;
      },
      async findForRun(clerkUserId: string, productionRunId: string) {
        return rows.find((row) => row.clerkUserId === clerkUserId && row.productionRunId === productionRunId) ?? null;
      },
    };
    const llm = manager([
      slot("gemini", async () => {
        throw new JobError("Gemini returned a story that was not valid JSON.", "invalid_json", false);
      }),
      slot("openai", async () => ({ story: sample })),
    ]);
    const engines = createLiveEngines({
      llm,
      stories,
      projects: {
        async findOwned() {
          return {
            id: "a".repeat(24),
            title: prompt.title,
            originalStoryIdea: prompt.idea,
            genre: "family",
            language: "en",
            visualStyle: "realistic",
            tone: "quiet",
            targetDurationSeconds: 60,
            aspectRatio: "16:9",
            status: "draft",
            workflowMode: "guided",
            productionType: "fictional_drama",
            productionMode: "standalone",
            createdAt: "",
            updatedAt: "",
          };
        },
        async update() {
          return null;
        },
      },
    });
    const run = {
      id: "b".repeat(24),
      projectId: "a".repeat(24),
      clerkUserId: "user",
    } as RunRecord;
    const job = {
      id: "d".repeat(24),
      jobType: "story.generate",
      clerkUserId: "user",
      projectId: run.projectId,
    } as JobRecord;
    const first = await engines.run(job, run);
    const second = await engines.run(job, run);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("The closed gate");
    expect(rows[0]?.provider).toBe("openai");
    expect(first.storyId).toBe(second.storyId);
  });
});

describe("provider error classes", () => {
  it("classifies authentication separately from an unavailable provider", () => {
    expect(classifyProviderError("OpenAI", { status: 401, message: "no" }).code).toBe("authentication");
    expect(classifyProviderError("OpenAI", { status: 403, message: "no" }).retryable).toBe(false);
    expect(classifyProviderError("OpenAI", { status: 503, message: "no" })).toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
    expect(classifyProviderError("OpenAI", new Error("unknown model")).code).toBe("invalid_model");
  });

  it("extracts failed_generation from the OpenAI-compatible error body", () => {
    const body = {
      status: 400,
      message: "400 Failed to generate JSON.",
      error: {
        error: {
          message: "Failed to generate JSON.",
          code: "json_validate_failed",
          failed_generation: '{"title":"partial"}',
        },
      },
    };

    expect(failedGenerationOf(body)).toBe('{"title":"partial"}');
    expect(classifyProviderError("Groq", body).failedGeneration).toBe('{"title":"partial"}');
  });

  it("also reads a top-level failed_generation body", () => {
    const body = {
      status: 400,
      message: "rejected",
      error: { failed_generation: '{"title":"partial"}' },
    };

    expect(failedGenerationOf(body)).toBe('{"title":"partial"}');
  });
});

describe("Story Bible response format", () => {
  it("uses JSON object mode when the provider opts out of json_schema", () => {
    const format = storyBibleResponseFormat(
      { label: "Groq", schemaMode: "json_schema", storyBibleSchemaMode: "json_object" },
      { type: "object" },
      "generate"
    );

    expect(format).toEqual({ type: "json_object" });
  });
});
