import { describe, expect, it } from "vitest";
import { characterInstructions, sceneInstructions } from "@/lib/providers/llm/stageTasks";
import type { ScreenplayScene } from "@/lib/validation/story";

const screenplay: ScreenplayScene[] = [{
  sceneNumber: 1,
  heading: "INT. HOUSE - NIGHT",
  location: "House",
  timeOfDay: "Night",
  charactersPresent: ["Mara"],
  visualDescription: "A quiet room.",
  action: "Mara enters.",
  dialogue: [],
}];

describe("serialized continuity prompts", () => {
  it("supplies approved character canon to extraction without adding characters", () => {
    const prompt = characterInstructions({
      title: "The return",
      screenplay,
      continuityContext: "Character Mara: wears a red scarf; avoids the east wing.",
    }).prompt;
    expect(prompt).toContain("Approved prior-episode character canon");
    expect(prompt).toContain("red scarf");
    expect(prompt).toContain("Do not add a narrator, extra, or anyone who is not in that list.");
  });

  it("supplies approved character and location canon to scene breakdown", () => {
    const prompt = sceneInstructions({
      title: "The return",
      screenplay,
      characterNames: ["Mara"],
      targetDurationSeconds: 300,
      continuityContext: "Location House: the east wing remains sealed.",
    }).prompt;
    expect(prompt).toContain("Approved prior-episode character and location canon");
    expect(prompt).toContain("east wing remains sealed");
    expect(prompt).toContain("Do not change the story, add events, or add characters.");
  });
});
