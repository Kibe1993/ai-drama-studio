import { describe, expect, it } from "vitest";
import { buildImagePrompt } from "@/lib/providers/media/prompt/image";

describe("image prompt builder", () => {
  it("assembles a structured prompt from shot + character + environment context", () => {
    const prompt = buildImagePrompt({
      shot: { purpose: "Amara stands at the pier edge", framing: "medium shot", cameraAngle: "eye-level", lighting: "golden hour", environment: "wooden pier over water" },
      characters: [{
        name: "Amara",
        appearance: "tall woman with dark skin",
        hair: "long black braids",
        clothing: "worn linen dress",
        distinguishingFeatures: "scar on left cheek",
      }],
      environment: {
        name: "Harbor Pier",
        architecture: "weathered wooden planks",
        materials: "old wood, rope",
        colourPalette: "warm browns, sea blue",
        lighting: "golden hour",
        atmosphere: "misty, wind-swept",
      },
      projectStyle: "cinematic realism",
      aspectRatio: "16:9",
    });

    expect(prompt.subject).toContain("Amara");
    expect(prompt.subject).toContain("pier");
    expect(prompt.environment).toContain("Harbor Pier");
    expect(prompt.environment).toContain("wooden");
    expect(prompt.style).toBe("cinematic realism");
    expect(prompt.lighting).toContain("golden hour");
    expect(prompt.camera).toContain("medium shot");
    expect(prompt.composition).toContain("16:9");
  });

  it("caps total prompt length to avoid dumping the full Story Bible", () => {
    const prompt = buildImagePrompt({
      shot: { purpose: "x".repeat(499) },
      characters: Array.from({ length: 10 }, (_, i) => ({
        name: `Character${i}`,
        appearance: "y".repeat(500),
        clothing: "z".repeat(500),
      })),
      environment: { name: "Env", architecture: "a".repeat(500) },
    });

    const total = Object.values(prompt).reduce((sum, val) => sum + val.length, 0);
    expect(total).toBeLessThanOrEqual(2100);
  });

  it("handles empty context gracefully", () => {
    const prompt = buildImagePrompt({ shot: {}, characters: [] });
    expect(prompt.subject).toBe("");
    expect(prompt.environment).toBe("");
  });
});