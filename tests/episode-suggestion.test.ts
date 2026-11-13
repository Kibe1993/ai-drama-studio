import { describe, expect, it } from "vitest";
import { JobError } from "@/lib/pipeline/types";
import { StoryProviderManager, type ProviderSlot } from "@/lib/providers/llm/manager";
import { requestEpisodeSuggestion, type EpisodeSuggestionPrompt, type StageTransport } from "@/lib/providers/llm/stageTasks";
import { EPISODE_SUGGESTION_RESPONSE_SCHEMA } from "@/lib/validation/episode";

const input: EpisodeSuggestionPrompt = {
  seriesTitle: "The Last Lantern Keeper",
  targetDurationSeconds: 300,
  episodeNumber: 2,
  productionMode: "serialized",
  previousEpisodes: [{ episodeNumber: 1, title: "The lighting", premise: "The keeper inherits the lantern." }],
  storyBible: { identity: { title: "The Last Lantern Keeper" } },
};

function transportReturning(text: string) {
  const calls: { system: string; prompt: string; schema: Record<string, unknown> }[] = [];
  const transport: StageTransport = {
    label: "Fake",
    async request(system, prompt, schema) {
      calls.push({ system, prompt, schema });
      return { text };
    },
  };
  return { transport, calls };
}

describe("requestEpisodeSuggestion", () => {
  it("parses a valid suggestion and sends the reference context", async () => {
    const { transport, calls } = transportReturning(JSON.stringify({
      title: "The debt of embers",
      premise: "The keeper learns who extinguished the first lantern, and the price of relighting it.",
    }));
    const result = await requestEpisodeSuggestion(transport, input);
    expect(result.suggestion.title).toBe("The debt of embers");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toContain("next episode");
    expect(calls[0]!.prompt).toContain("The Last Lantern Keeper");
    expect(calls[0]!.prompt).toContain("episode number 2");
    expect(calls[0]!.prompt).toContain("The lighting");
    expect(calls[0]!.prompt).toContain("Series reference (immutable canon):");
    expect(calls[0]!.schema).toEqual(EPISODE_SUGGESTION_RESPONSE_SCHEMA);
  });

  it("omits previous episodes and the reference when none exist", async () => {
    const { transport, calls } = transportReturning(JSON.stringify({ title: "Arrival", premise: "The keeper arrives." }));
    await requestEpisodeSuggestion(transport, {
      seriesTitle: "The Last Lantern Keeper",
      targetDurationSeconds: 300,
      episodeNumber: 1,
    });
    expect(calls[0]!.prompt).not.toContain("Episodes already produced");
    expect(calls[0]!.prompt).not.toContain("Series reference:");
  });

  it("rejects a response that is not valid JSON", async () => {
    const { transport } = transportReturning("no json here");
    await expect(requestEpisodeSuggestion(transport, input)).rejects.toMatchObject({ code: "invalid_json" });
  });

  it("rejects a response missing the premise", async () => {
    const { transport } = transportReturning(JSON.stringify({ title: "The debt of embers" }));
    await expect(requestEpisodeSuggestion(transport, input)).rejects.toMatchObject({ code: "invalid_schema" });
  });
});

describe("generateEpisodeSuggestion failover", () => {
  function slot(id: string, behavior: () => Promise<{ suggestion: { title: string; premise: string } }>): ProviderSlot {
    return {
      id,
      model: `${id}-model`,
      configured: true,
      supported: true,
      async generate() { throw new Error("unused"); },
      async generateEpisodeSuggestion() {
        return behavior();
      },
    };
  }

  it("falls back to the next provider when the first is rate limited", async () => {
    const slots: ProviderSlot[] = [
      slot("groq", async () => { throw new JobError("Groq rate limit reached.", "rate_limited", true); }),
      slot("openrouter", async () => ({ suggestion: { title: "The debt of embers", premise: "The keeper pays." } })),
    ];
    const manager = new StoryProviderManager({ slots, sequenceTimeoutMs: 5_000 });
    const result = await manager.generateEpisodeSuggestion(input);
    expect(result.suggestion.title).toBe("The debt of embers");
    expect(result.provider).toBe("openrouter");
    expect(result.fallbackFrom).toBe("groq");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts![1]!.fallback).toBe(true);
  });

  it("stops the sequence when a provider cannot suggest episodes", async () => {
    const withoutCapability: ProviderSlot = {
      id: "ollama",
      model: "gemma3:4b",
      configured: true,
      supported: true,
      async generate() { throw new Error("unused"); },
    };
    const slots: ProviderSlot[] = [
      withoutCapability,
      slot("mistral", async () => ({ suggestion: { title: "Arrival", premise: "The keeper arrives." } })),
    ];
    const manager = new StoryProviderManager({ slots, sequenceTimeoutMs: 5_000 });
    await expect(manager.generateEpisodeSuggestion(input)).rejects.toMatchObject({ code: "configuration" });
  });

  it("fails when every provider fails", async () => {
    const slots: ProviderSlot[] = [
      slot("groq", async () => { throw new JobError("Groq failed.", "provider_failed", false); }),
    ];
    const manager = new StoryProviderManager({ slots, sequenceTimeoutMs: 5_000 });
    await expect(manager.generateEpisodeSuggestion(input)).rejects.toMatchObject({ code: "provider_failed" });
  });
});
