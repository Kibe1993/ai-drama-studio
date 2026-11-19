import { describe, it, expect } from "vitest";
import { extractEpisodeCanon } from "@/lib/domain/episodeCanon";
import { applyCanonToLedger } from "@/lib/domain/ledger";
import { makeLedger, makeCharacterState, makeSeasonPlan, makeEpisodeScreenplay, makeEpisodePlanItem } from "./fixtures";

describe("I-2: character state stagnation after first appearance", () => {
  it("character objective updates when a later episode provides an arc change", () => {
    const ledger = makeLedger({
      characterStates: [
        makeCharacterState({
          name: "Alice",
          currentObjective: "Find the truth about the document.",
          currentLocation: "Town Square",
        }),
      ],
    });

    const plan = makeSeasonPlan(3, {
      episodeProgression: [
        makeEpisodePlanItem({ episodeNumber: 1 }),
        makeEpisodePlanItem({
          episodeNumber: 2,
          characterArcChanges: [{ name: "Alice", change: "Alice confronts Bob about the document." }],
        }),
        makeEpisodePlanItem({ episodeNumber: 3 }),
      ],
    });
    const story = {
      title: "Episode 2: The Confrontation",
      synopsis: "Alice confronts Bob at the old house.",
      screenplay: makeEpisodeScreenplay(2, ["Alice", "Bob"], "The Old House"),
    };

    const summary = extractEpisodeCanon({
      episodeNumber: 2,
      story,
      plan: { ...plan, version: 1 },
      episodePlan: null,
      ledger,
    });

    const aliceState = summary.characterStates.find((s) => s.name === "Alice");
    expect(aliceState).toBeDefined();
    expect(aliceState!.currentObjective).not.toBe("Find the truth about the document.");
  });

  it("character physicalState updates when a later episode injures them", () => {
    const ledger = makeLedger({
      characterStates: [
        makeCharacterState({
          name: "Alice",
          physicalState: "Healthy and strong.",
        }),
      ],
    });

    const plan = makeSeasonPlan(3, {
      episodeProgression: [
        makeEpisodePlanItem({
          episodeNumber: 1,
          characterArcChanges: [{ name: "Alice", change: "Alice is injured in a fall." }],
        }),
        makeEpisodePlanItem({
          episodeNumber: 2,
          characterArcChanges: [{ name: "Alice", change: "Alice recovers from her injuries." }],
        }),
        makeEpisodePlanItem({ episodeNumber: 3 }),
      ],
    });

    const story = {
      title: "Episode 2: After the Fall",
      synopsis: "Alice struggles with her injury.",
      screenplay: makeEpisodeScreenplay(2, ["Alice"], "The Old House"),
    };

    const summary = extractEpisodeCanon({
      episodeNumber: 2,
      story,
      plan: { ...plan, version: 1 },
      episodePlan: null,
      ledger,
    });

    const aliceState = summary.characterStates.find((s) => s.name === "Alice");
    expect(aliceState).toBeDefined();
    expect(aliceState!.physicalState).not.toBe("Healthy and strong.");
  });

  it("character beliefs update when a later episode provides an arc change", () => {
    const ledger = makeLedger({
      characterStates: [
        makeCharacterState({
          name: "Alice",
          beliefs: ["The truth should come out no matter what."],
        }),
      ],
    });

    const plan = makeSeasonPlan(3, {
      episodeProgression: [
        makeEpisodePlanItem({ episodeNumber: 1 }),
        makeEpisodePlanItem({
          episodeNumber: 2,
          characterArcChanges: [{ name: "Alice", change: "Alice begins to doubt the cost of truth." }],
        }),
        makeEpisodePlanItem({ episodeNumber: 3 }),
      ],
    });
    const story = {
      title: "Episode 2: Doubt",
      synopsis: "Alice begins to question whether the truth is worth the cost.",
      screenplay: makeEpisodeScreenplay(2, ["Alice"], "Town Square"),
    };

    const summary = extractEpisodeCanon({
      episodeNumber: 2,
      story,
      plan: { ...plan, version: 1 },
      episodePlan: null,
      ledger,
    });

    const aliceState = summary.characterStates.find((s) => s.name === "Alice");
    expect(aliceState).toBeDefined();
    expect(aliceState!.beliefs).not.toEqual(["The truth should come out no matter what."]);
  });

  it("character motivations update when a later episode provides an arc change", () => {
    const ledger = makeLedger({
      characterStates: [
        makeCharacterState({
          name: "Alice",
          motivations: ["Find the truth."],
        }),
      ],
    });

    const plan = makeSeasonPlan(3, {
      episodeProgression: [
        makeEpisodePlanItem({ episodeNumber: 1 }),
        makeEpisodePlanItem({
          episodeNumber: 2,
          characterArcChanges: [{ name: "Alice", change: "Alice's motivation shifts to protecting Bob." }],
        }),
        makeEpisodePlanItem({ episodeNumber: 3 }),
      ],
    });
    const story = {
      title: "Episode 2: New Purpose",
      synopsis: "Alice's motivation shifts to protecting Bob.",
      screenplay: makeEpisodeScreenplay(2, ["Alice", "Bob"], "The Old House"),
    };

    const summary = extractEpisodeCanon({
      episodeNumber: 2,
      story,
      plan: { ...plan, version: 1 },
      episodePlan: null,
      ledger,
    });

    const aliceState = summary.characterStates.find((s) => s.name === "Alice");
    expect(aliceState).toBeDefined();
    expect(aliceState!.motivations).not.toEqual(["Find the truth."]);
  });

  it("ledger retains objective when no character-specific signal is provided", () => {
    let ledger = makeLedger();

    const plan = makeSeasonPlan(3);

    for (const ep of [1, 2]) {
      const story = {
        title: `Episode ${ep}`,
        synopsis: `Alice pursues a new goal in episode ${ep}.`,
        screenplay: makeEpisodeScreenplay(ep, ["Alice"], "Town Square"),
      };
      const summary = extractEpisodeCanon({
        episodeNumber: ep,
        story,
        plan: { ...plan, version: 1 },
        episodePlan: null,
        ledger,
      });
      ledger = applyCanonToLedger(ledger, summary);
    }

    const aliceState = ledger.characterStates.find((s) => s.name === "Alice");
    expect(aliceState).toBeDefined();
    // Without character-specific signals (arc changes, development mentioning the character),
    // the objective stays at the previous value. This is correct: if the episode plan
    // doesn't signal a change, the character's objective shouldn't change.
    const episode1Objective = "The protagonist pursues their goal.";
    expect(aliceState!.currentObjective).toBe(episode1Objective);
  });
});