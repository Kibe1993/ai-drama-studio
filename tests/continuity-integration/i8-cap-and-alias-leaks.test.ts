import { describe, it, expect } from "vitest";
import { applyCanonToLedger } from "@/lib/domain/ledger";
import { extractEpisodeCanon } from "@/lib/domain/episodeCanon";
import { canonFromApprovedSources } from "@/lib/domain/narrativeControl/projectCanon";
import { makeLedger, makeEpisodeCanonSummary, makeStoryBible, makeSeasonPlan, makeEpisodeScreenplay, makeEpisodePlanItem } from "./fixtures";

describe("I-8: cap and alias leaks", () => {
  it.fails("mergeThreads does not drop the newest thread when cap is reached", () => {
    const existingThreads = Array.from({ length: 29 }, (_, i) => ({
      thread: `Old unresolved thread number ${i + 1}`,
      introducedInEpisode: 1,
      status: "open" as const,
    }));

    const ledger = makeLedger({ unresolvedThreads: existingThreads });

    const summary = makeEpisodeCanonSummary({
      episodeNumber: 2,
      unresolvedThreads: [
        { thread: "Critical new thread from episode 2", introducedInEpisode: 2, status: "open" },
        { thread: "Another new thread from episode 2", introducedInEpisode: 2, status: "open" },
      ],
    });

    const result = applyCanonToLedger(ledger, summary);

    // The newest thread should be retained; an older, less important one should be dropped instead.
    expect(result.unresolvedThreads.some((t) => t.thread === "Another new thread from episode 2")).toBe(true);
  });

  it.fails("buildThreads in episodeCanon does not drop newest thread at cap 16", () => {
    const existingThreads = Array.from({ length: 15 }, (_, i) => ({
      thread: `Existing thread ${i + 1}`,
      introducedInEpisode: 1,
      status: "open" as const,
    }));

    const ledger = makeLedger({ unresolvedThreads: existingThreads });

    const plan = makeSeasonPlan(3, {
      episodeProgression: [
        makeEpisodePlanItem({ episodeNumber: 1 }),
        makeEpisodePlanItem({
          episodeNumber: 2,
          unresolvedThreads: [
            "New thread A that should be retained",
            "New thread B that should be retained",
          ],
        }),
        makeEpisodePlanItem({ episodeNumber: 3 }),
      ],
    });

    const story = {
      title: "Episode 2",
      synopsis: "Episode 2 introduces new threads.",
      screenplay: makeEpisodeScreenplay(2, ["Alice"], "Town Square"),
    };

    const summary = extractEpisodeCanon({
      episodeNumber: 2,
      story,
      plan: { ...plan, version: 1 },
      episodePlan: null,
      ledger,
    });

    // buildThreads caps at 16. With 15 existing + 2 new = 17, the newest is dropped.
    expect(summary.unresolvedThreads.some((t) => t.thread === "New thread B that should be retained")).toBe(true);
  });

  it.fails("canon entities have aliases populated from the bible", () => {
    const bible = makeStoryBible({
      characters: {
        characters: [
          {
            name: "Alice",
            storyRole: "protagonist",
            roleDescription: "A journalist named Alice Chen.",
            physicalDescription: "Sharp eyes.",
            personality: "Curious.",
            background: "From the town.",
            motivations: ["Find the truth."],
            fearsAndWeaknesses: ["Being wrong."],
            abilitiesAndLimitations: ["Research."],
            relationships: [{ characterName: "Bob", relationship: "friend", tensionOrChange: "Trust." }],
            secrets: ["Stole a story once."],
            developmentPotential: "Grows.",
          },
          {
            name: "Bob",
            storyRole: "supporting",
            roleDescription: "A librarian called Robert.",
            physicalDescription: "Tall.",
            personality: "Quiet.",
            background: "Local.",
            motivations: ["Peace."],
            fearsAndWeaknesses: ["Change."],
            abilitiesAndLimitations: ["Knows everyone."],
            relationships: [{ characterName: "Alice", relationship: "friend", tensionOrChange: "Helpful." }],
            secrets: ["Knows the secret."],
            developmentPotential: "Chooses truth.",
          },
        ],
        relationshipDynamics: ["Alice and Bob are close."],
      },
    });

    const canon = canonFromApprovedSources({
      projectId: "proj-1",
      bible,
      ledger: null,
      bibleVersion: 1,
      planVersion: 1,
    });

    // Characters often have aliases or short names. The canon entity should have at least
    // an empty aliases array, but ideally aliases like "Ali" for "Alice" or "Robert" for "Bob".
    const bobEntity = canon.entities.find((e) => e.name === "Bob");
    expect(bobEntity).toBeDefined();
    // Bob is described as "Robert" in his roleDescription — the alias should be captured.
    expect(bobEntity!.aliases.length).toBeGreaterThan(0);
  });

  it("revealedSecrets cap drops oldest (correct behavior, documents current design)", () => {
    const existingSecrets = Array.from({ length: 20 }, (_, i) => `Old secret ${i + 1}`);
    const ledger = makeLedger({ revealedSecrets: existingSecrets });

    const summary = makeEpisodeCanonSummary({
      episodeNumber: 2,
      revealedSecrets: ["New secret from episode 2"],
    });

    const result = applyCanonToLedger(ledger, summary);
    // appendUnique uses .slice(-cap), so the newest 20 are kept and the oldest is dropped.
    expect(result.revealedSecrets).toContain("New secret from episode 2");
    expect(result.revealedSecrets).not.toContain("Old secret 1");
    expect(result.revealedSecrets).toHaveLength(20);
  });
});