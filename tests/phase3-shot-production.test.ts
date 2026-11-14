import { describe, expect, it } from "vitest";
import { buildVideoPrompt } from "@/lib/providers/media/prompt/video";
import { createShotProductionService } from "@/lib/services/shotProductionService";
import type { ProviderCapability } from "@/lib/providers/media/capability";

describe("video prompt builder", () => {
  it("describes motion and camera movement distinct from the static scene", () => {
    const prompt = buildVideoPrompt({
      shot: {
        purpose: "Amara on the pier",
        action: "walking cautiously towards the edge",
        cameraDirection: "slow dolly forward",
        lighting: "golden hour",
        environment: "wooden pier",
      },
      characters: [{
        name: "Amara",
        appearance: "tall woman, dark skin",
        clothing: "linen dress",
      }],
      environment: {
        name: "Harbor Pier",
        weather: "windy",
        atmosphere: "curtains swaying",
      },
      motion: "water moving beneath boards, clothing responding to wind",
      cameraMovement: "slow tracking behind subject",
      durationSeconds: 6,
    });

    expect(prompt.motion).toContain("walking");
    expect(prompt.motion).toContain("water moving");
    expect(prompt.motion).toContain("wind");
    expect(prompt.cameraMovement).toContain("tracking");
    expect(prompt.staticScene.subject).toContain("Amara");
    expect(prompt.durationSeconds).toBe(6);
  });

  it("includes segment note when shot was split", () => {
    const prompt = buildVideoPrompt({
      shot: { purpose: "Long walk" },
      characters: [],
      durationSeconds: 20,
      segmentNote: "Part 1 of 3: approach",
    });
    expect(prompt.segmentNote).toBe("Part 1 of 3: approach");
  });
});

describe("shot production duration splitting", () => {
  const service = createShotProductionService();
  const mockCap: ProviderCapability = {
    supportsImageToImage: false,
    supportsImageToVideo: true,
    supportsReferenceGuidedVideo: true,
    maxClipDurationSeconds: 8,
    maxImageDimension: 1024,
    isMock: true,
    isPaid: false,
    supportedModels: ["mock-video"],
  };

  it("returns a single segment when duration is within provider limit", () => {
    const result = service.planDurationSegments(5, mockCap);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].durationSeconds).toBe(5);
    expect(result.adjusted).toBe(false);
  });

  it("splits into multiple segments when duration exceeds provider limit", () => {
    const result = service.planDurationSegments(20, mockCap);
    expect(result.segments.length).toBeGreaterThan(1);
    expect(result.adjusted).toBe(true);
    const total = result.segments.reduce((sum, s) => sum + s.durationSeconds, 0);
    expect(total).toBeCloseTo(20, 1);
  });

  it("does not split when provider maxClipDuration is 0 (no limit)", () => {
    const noLimitCap = { ...mockCap, maxClipDurationSeconds: 0 };
    const result = service.planDurationSegments(120, noLimitCap);
    expect(result.segments).toHaveLength(1);
    expect(result.adjusted).toBe(false);
  });
});