import { describe, expect, it } from "vitest";
import { capabilitySatisfies, type ProviderCapability } from "@/lib/providers/media/capability";
import { ProviderRegistry } from "@/lib/providers/media/registry";
import { MockImageProvider } from "@/lib/providers/media/image/mock";
import { MockVideoProvider } from "@/lib/providers/media/video/mock";
import { MockAudioProvider } from "@/lib/providers/media/audio/mock";
import { classifyFailure, isRetryable } from "@/lib/pipeline/failureClassification";
import { queueNameFor } from "@/lib/pipeline/redis";
import { JOB_TYPES } from "@/lib/pipeline/types";

describe("provider capability satisfaction", () => {
  const cap: ProviderCapability = {
    supportsImageToImage: true,
    supportsImageToVideo: false,
    supportsReferenceGuidedVideo: false,
    maxClipDurationSeconds: 8,
    maxImageDimension: 1024,
    isMock: true,
    isPaid: false,
    supportedModels: ["mock"],
  };

  it("satisfies when all required capabilities are present", () => {
    expect(capabilitySatisfies(cap, { requiresImageToImage: true })).toBe(true);
    expect(capabilitySatisfies(cap, { minClipDurationSeconds: 5 })).toBe(true);
    expect(capabilitySatisfies(cap, {})).toBe(true);
  });

  it("rejects when a required capability is missing", () => {
    expect(capabilitySatisfies(cap, { requiresImageToVideo: true })).toBe(false);
    expect(capabilitySatisfies(cap, { minClipDurationSeconds: 16 })).toBe(false);
  });
});

describe("provider registry selection", () => {
  it("returns the mock provider when no paid provider is eligible", () => {
    const registry = new ProviderRegistry();
    const provider = registry.selectImage({}, "mock-image", false);
    expect(provider.capabilities.isMock).toBe(true);
  });

  it("returns mock when creator has not initiated paid work", () => {
    const registry = new ProviderRegistry();
    const provider = registry.selectImage({}, "mock-image", false);
    expect(provider.capabilities.isMock).toBe(true);
  });

  it("never falls back from a failed free provider to a paid one", () => {
    const registry = new ProviderRegistry();
    const provider = registry.selectVideo({ minClipDurationSeconds: 4 }, "mock-video", false);
    expect(provider.capabilities.isMock).toBe(true);
    expect(provider.capabilities.isPaid).toBe(false);
  });

  it("throws no_provider_available when no adapter satisfies the requirement", () => {
    const registry = new ProviderRegistry();
    expect(() => registry.selectVideo({ minClipDurationSeconds: 999 }, "mock-video", false))
      .toThrow("no_provider_available");
  });
});

describe("mock image provider", () => {
  it("returns valid PNG bytes with mock flag", async () => {
    const provider = new MockImageProvider();
    const result = await provider.generate({
      prompt: { subject: "test", environment: "", style: "", lighting: "", camera: "", composition: "", continuityNotes: "" },
      referenceImages: [],
      model: "mock-image",
      settings: { aspectRatio: "16:9" },
      idempotencyKey: "test-key-123",
    });
    expect(result.mock).toBe(true);
    expect(result.mimeType).toBe("image/png");
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.referencesUsed).toBe(false);
  });
});

describe("mock video provider async lifecycle", () => {
  it("submits then polls processing then completed", async () => {
    const provider = new MockVideoProvider();
    const handle = await provider.submit({
      prompt: { staticScene: { subject: "", environment: "", style: "", lighting: "", camera: "", composition: "", continuityNotes: "" }, motion: "", cameraMovement: "", durationSeconds: 5, segmentNote: "" },
      model: "mock-video",
      settings: { aspectRatio: "16:9", durationSeconds: 5 },
      idempotencyKey: "test-video-key",
    });
    expect(handle.status).toBe("submitted");

    const first = await provider.poll(handle);
    expect(first.status).toBe("processing");

    const second = await provider.poll(handle);
    expect(second.status).toBe("completed");
    if (second.status === "completed") {
      expect(second.mock).toBe(true);
      expect(second.mimeType).toBe("video/mp4");
      expect(second.bytes.byteLength).toBeGreaterThan(0);
    }
  });
});

describe("mock audio provider", () => {
  it("returns valid WAV bytes for sfx", async () => {
    const provider = new MockAudioProvider();
    const result = await provider.generate({
      kind: "sfx",
      text: "wind blowing",
      settings: { language: "en" },
      idempotencyKey: "test-sfx-key",
    });
    expect(result.mock).toBe(true);
    expect(result.mimeType).toBe("audio/wav");
  });

  it("requires a voice profile for dialogue", async () => {
    const provider = new MockAudioProvider();
    await expect(provider.generate({
      kind: "dialogue",
      text: "Hello",
      settings: { language: "en" },
      idempotencyKey: "test-dialogue-key",
    })).rejects.toThrow("voice_profile_required");
  });
});

describe("failure classification", () => {
  it("classifies permanent errors as non-retryable", () => {
    expect(classifyFailure("content_rejected")).toBe("permanent");
    expect(classifyFailure("cost_limit_exceeded")).toBe("permanent");
    expect(classifyFailure("no_provider_available")).toBe("permanent");
    expect(isRetryable("permanent")).toBe(false);
  });

  it("classifies transient errors as retryable", () => {
    expect(classifyFailure("provider_transient")).toBe("transient");
    expect(classifyFailure("timeout")).toBe("transient");
    expect(isRetryable("transient")).toBe(true);
  });

  it("returns null for unknown/null codes", () => {
    expect(classifyFailure(null)).toBeNull();
    expect(classifyFailure(undefined)).toBeNull();
    expect(classifyFailure("")).toBeNull();
  });
});

describe("job type queue routing", () => {
  it("routes image jobs to studio-image", () => {
    expect(queueNameFor("image.character_reference")).toBe("studio-image");
    expect(queueNameFor("image.shot")).toBe("studio-image");
  });

  it("routes video.shot to studio-video", () => {
    expect(queueNameFor("video.shot")).toBe("studio-video");
    expect(queueNameFor("video.scene")).toBe("studio-video");
  });

  it("routes audio jobs to studio-audio", () => {
    expect(queueNameFor("audio.dialogue")).toBe("studio-audio");
    expect(queueNameFor("audio.music")).toBe("studio-audio");
  });

  it("routes render.final to studio-render", () => {
    expect(queueNameFor("render.final")).toBe("studio-render");
  });

  it("routes media.validate and assembly.generate to studio-llm", () => {
    expect(queueNameFor("media.validate")).toBe("studio-llm");
    expect(queueNameFor("assembly.generate")).toBe("studio-llm");
  });

  it("includes all 20 job types", () => {
    expect(JOB_TYPES).toHaveLength(20);
  });
});