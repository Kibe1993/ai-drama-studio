import { describe, expect, it } from "vitest";
import { shotPlanInstructions } from "@/lib/providers/llm/shotPlanTask";
import type { ShotPlanPrompt } from "@/lib/providers/llm/shotPlanTask";

function makePrompt(): ShotPlanPrompt {
  return {
    sceneNumber: 1,
    title: "The Letter",
    location: "Kitchen",
    interiorExterior: "interior",
    timeOfDay: "Night",
    charactersPresent: ["Amara"],
    visualDescription: "Warm lamplight on a folded letter.",
    action: "Amara opens the letter and reads it.",
    dialogue: [{ characterName: "Amara", line: "This changes everything." }],
    cameraDirection: "Slow push in",
    estimatedDurationSeconds: 45,
  };
}

describe("Shot Plan Generation", () => {
  describe("shotPlanInstructions", () => {
    it("includes the scene title and number", () => {
      const { prompt } = shotPlanInstructions(makePrompt());
      expect(prompt).toContain("Scene 1: The Letter");
    });

    it("includes the location and time of day", () => {
      const { prompt } = shotPlanInstructions(makePrompt());
      expect(prompt).toContain("Location: Kitchen (interior)");
      expect(prompt).toContain("Time of day: Night");
    });

    it("includes the characters present", () => {
      const { prompt } = shotPlanInstructions(makePrompt());
      expect(prompt).toContain("Characters present: Amara");
    });

    it("includes the dialogue", () => {
      const { prompt } = shotPlanInstructions(makePrompt());
      expect(prompt).toContain('Amara: "This changes everything."');
    });

    it("includes the estimated duration", () => {
      const { prompt } = shotPlanInstructions(makePrompt());
      expect(prompt).toContain("Estimated scene duration: 45 seconds");
    });

    it("includes the camera direction when provided", () => {
      const { prompt } = shotPlanInstructions(makePrompt());
      expect(prompt).toContain("Existing camera direction: Slow push in");
    });

    it("includes continuity context when provided", () => {
      const input = makePrompt();
      input.continuityContext = "Previous scene: Amara entered the kitchen.";
      const { prompt } = shotPlanInstructions(input);
      expect(prompt).toContain("Continuity context from prior scenes");
      expect(prompt).toContain("Previous scene: Amara entered the kitchen.");
    });

    it("instructs the LLM to break the scene into shots", () => {
      const { prompt } = shotPlanInstructions(makePrompt());
      expect(prompt).toContain("Break this scene into a sequence of shots");
      expect(prompt).toContain("shotNumber");
      expect(prompt).toContain("framing");
      expect(prompt).toContain("cameraAngle");
      expect(prompt).toContain("estimatedDurationSeconds");
    });

    it("instructs the LLM to maintain visual continuity", () => {
      const { prompt } = shotPlanInstructions(makePrompt());
      expect(prompt).toContain("Maintain visual continuity");
      expect(prompt).toContain("180-degree rule");
    });

    it("handles scenes with no dialogue", () => {
      const input = makePrompt();
      input.dialogue = [];
      const { prompt } = shotPlanInstructions(input);
      expect(prompt).toContain("(no dialogue)");
    });
  });
});