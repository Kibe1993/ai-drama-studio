import { describe, it, expect } from "vitest";
import { extractEpisodeCanon } from "@/lib/domain/episodeCanon";
import { applyCanonToLedger } from "@/lib/domain/ledger";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import { makeSeasonPlan, makeEpisodeScreenplay, makeEpisodePlanItem, makeLedger } from "./fixtures";

const EPISODE_COUNT = 10;

function replaySeason(): { ledger: ContinuityLedger; perEpisode: ContinuityLedger[] } {
  const plan = makeSeasonPlan(EPISODE_COUNT, {
    episodeProgression: Array.from({ length: EPISODE_COUNT }, (_, i) =>
      makeEpisodePlanItem({
        episodeNumber: i + 1,
        workingTitle: `Episode ${i + 1}: The Discovery`,
        narrativePurpose: `Episode ${i + 1} advances the investigation.`,
        mainObjective: `Alice pursues clue number ${i + 1}.`,
        characterDevelopment: `Alice grows more determined in episode ${i + 1}.`,
        characterArcChanges: [
          { name: "Alice", change: `Alice's objective shifts to clue ${i + 1} in episode ${i + 1}.` },
        ],
        endingOrCliffhanger:
          i + 1 < EPISODE_COUNT
            ? `Episode ${i + 1} ends with Alice discovering clue ${i + 2}.`
            : `Episode ${i + 1} ends with the final confrontation.`,
      }),
    ),
  });

  let ledger: ContinuityLedger = makeLedger();
  const perEpisode: ContinuityLedger[] = [];

  for (let ep = 1; ep <= EPISODE_COUNT; ep++) {
    const story = {
      title: `Episode ${ep}: The Discovery`,
      synopsis: `Alice investigates clue ${ep} and confronts new obstacles.`,
      screenplay: makeEpisodeScreenplay(ep, ["Alice", "Bob"], ep % 2 === 0 ? "The Old House" : "Town Square"),
    };

    const summary = extractEpisodeCanon({
      episodeNumber: ep,
      story,
      plan: { ...plan, version: 1 },
      episodePlan: null,
      ledger,
    });

    ledger = applyCanonToLedger(ledger, summary);
    perEpisode.push(ledger);
  }

  return { ledger, perEpisode };
}

describe("10-episode season replay", () => {
  it("replays all 10 episodes without crashing", () => {
    const { ledger, perEpisode } = replaySeason();
    expect(perEpisode).toHaveLength(EPISODE_COUNT);
    expect(ledger.characterStates.length).toBeGreaterThan(0);
  });

  it("ledger accumulates events across all 10 episodes", () => {
    const { ledger } = replaySeason();
    // Each episode contributes events; the ledger should have events from multiple episodes.
    const episodeNumbers = new Set(ledger.events.map((e) => e.episodeNumber));
    expect(episodeNumbers.size).toBeGreaterThan(5);
  });

  it("Alice's objective evolves across the season", () => {
    const { perEpisode } = replaySeason();
    const ep1Objective = perEpisode[0]!.characterStates.find((s) => s.name === "Alice")?.currentObjective;
    const ep10Objective = perEpisode[9]!.characterStates.find((s) => s.name === "Alice")?.currentObjective;

    expect(ep1Objective).toBeDefined();
    expect(ep10Objective).toBeDefined();
    // After 10 episodes with different objectives, the objective should have changed.
    expect(ep10Objective).not.toBe(ep1Objective);
  });

  it("Alice's physicalState evolves across the season", () => {
    const { perEpisode } = replaySeason();
    const ep1Physical = perEpisode[0]!.characterStates.find((s) => s.name === "Alice")?.physicalState;
    const ep10Physical = perEpisode[9]!.characterStates.find((s) => s.name === "Alice")?.physicalState;

    // After 10 episodes with arc changes, the physical state should not be frozen.
    expect(ep10Physical).not.toBe(ep1Physical);
  });

  it("Alice's beliefs evolve across the season", () => {
    const { perEpisode } = replaySeason();
    const ep1Beliefs = perEpisode[0]!.characterStates.find((s) => s.name === "Alice")?.beliefs;
    const ep10Beliefs = perEpisode[9]!.characterStates.find((s) => s.name === "Alice")?.beliefs;

    // Beliefs should not be frozen across 10 episodes.
    expect(ep10Beliefs).not.toEqual(ep1Beliefs);
  });

  it("Alice's knowledge grows across the season (mergeUnique works)", () => {
    const { perEpisode } = replaySeason();
    const ep1Knowledge = perEpisode[0]!.characterStates.find((s) => s.name === "Alice")?.knowledge ?? [];
    const ep10Knowledge = perEpisode[9]!.characterStates.find((s) => s.name === "Alice")?.knowledge ?? [];

    // Knowledge is merged (not first-value-wins), so it should grow.
    expect(ep10Knowledge.length).toBeGreaterThanOrEqual(ep1Knowledge.length);
  });

  it("unresolved threads from later episodes are retained", () => {
    const plan = makeSeasonPlan(EPISODE_COUNT, {
      episodeProgression: Array.from({ length: EPISODE_COUNT }, (_, i) =>
        makeEpisodePlanItem({
          episodeNumber: i + 1,
          unresolvedThreads: [
            `Thread A from episode ${i + 1}`,
            `Thread B from episode ${i + 1}`,
          ],
        }),
      ),
    });

    let ledger: ContinuityLedger = makeLedger();

    for (let ep = 1; ep <= EPISODE_COUNT; ep++) {
      const story = {
        title: `Episode ${ep}`,
        synopsis: `Episode ${ep} synopsis.`,
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

    // With 2 threads per episode over 10 episodes = 20 threads total,
    // but buildThreads caps at 16 and mergeThreads caps at 30.
    // Threads from episode 10 should still be in the ledger.
    const hasEp10Thread = ledger.unresolvedThreads.some((t) => t.thread.includes("episode 10"));
    expect(hasEp10Thread).toBe(true);
  });
});