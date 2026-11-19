import { describe, it, expect } from "vitest";
import { canonFromApprovedSources } from "@/lib/domain/narrativeControl/projectCanon";
import { assembleNarrativeContext } from "@/lib/domain/narrativeControl/context";
import type { NarrativeGenerationRequest } from "@/lib/validation/narrativeControl";
import { makeStoryBible, makeLedger } from "./fixtures";

describe("I-4: hidden truths can never be revealed", () => {
  it("audienceRevealEpisode is set when ledger records the secret as revealed", () => {
    const bible = makeStoryBible({
      canon: {
        confirmedFacts: ["Alice is a journalist."],
        proposedDetails: [],
        unresolvedQuestions: [],
        hiddenInformation: ["Bob knows what happened twenty years ago."],
        characterKnowledge: [],
        audienceKnowledge: [],
      },
    });

    const ledger = makeLedger({
      revealedSecrets: ["Bob knows what happened twenty years ago."],
    });

    const canon = canonFromApprovedSources({
      projectId: "proj-1",
      bible,
      ledger,
      bibleVersion: 1,
      planVersion: 1,
    });

    const hiddenFact = canon.facts.find(
      (f) => f.statement === "Bob knows what happened twenty years ago." && f.classification === "HIDDEN_TRUTH",
    );
    expect(hiddenFact).toBeDefined();
    // After the secret is revealed (in the ledger), the HIDDEN_TRUTH fact should have audienceRevealEpisode set.
    expect(hiddenFact!.audienceRevealEpisode).not.toBeNull();
  });

  it("revealed hidden truth is not concealed from later episodes in the context packet", () => {
    const bible = makeStoryBible({
      canon: {
        confirmedFacts: [],
        proposedDetails: [],
        unresolvedQuestions: [],
        hiddenInformation: ["Bob knows what happened twenty years ago."],
        characterKnowledge: [],
        audienceKnowledge: [],
      },
    });

    const ledger = makeLedger({
      revealedSecrets: ["Bob knows what happened twenty years ago."],
    });

    const canon = canonFromApprovedSources({
      projectId: "proj-1",
      bible,
      ledger,
      bibleVersion: 1,
      planVersion: 1,
    });

    const request: NarrativeGenerationRequest = {
      taskId: "task-1",
      projectId: "proj-1",
      narrativeVersion: 0,
      targetArtifact: "screenplay",
      targetId: "",
      episode: 5,
      objective: "Write episode 5.",
      allowedChangeIds: [],
    };

    const packet = assembleNarrativeContext({ canon, request });

    // The secret was revealed in an earlier episode, so it should NOT be in prohibitedDisclosures for episode 5.
    const stillConcealed = packet.prohibitedDisclosures.some(
      (d) => d.statement === "Bob knows what happened twenty years ago.",
    );
    expect(stillConcealed).toBe(false);
  });

  it("hidden truth without ledger revelation stays concealed", () => {
    const bible = makeStoryBible({
      canon: {
        confirmedFacts: [],
        proposedDetails: [],
        unresolvedQuestions: [],
        hiddenInformation: ["Bob knows what happened twenty years ago."],
        characterKnowledge: [],
        audienceKnowledge: [],
      },
    });

    const canon = canonFromApprovedSources({
      projectId: "proj-1",
      bible,
      ledger: null,
      bibleVersion: 1,
      planVersion: 1,
    });

    const hiddenFact = canon.facts.find(
      (f) => f.statement === "Bob knows what happened twenty years ago." && f.classification === "HIDDEN_TRUTH",
    );
    expect(hiddenFact).toBeDefined();
    expect(hiddenFact!.audienceRevealEpisode).toBeNull();

    const request: NarrativeGenerationRequest = {
      taskId: "task-1",
      projectId: "proj-1",
      narrativeVersion: 0,
      targetArtifact: "screenplay",
      targetId: "",
      episode: 10,
      objective: "Write episode 10.",
      allowedChangeIds: [],
    };

    const packet = assembleNarrativeContext({ canon, request });
    const stillConcealed = packet.prohibitedDisclosures.some(
      (d) => d.statement === "Bob knows what happened twenty years ago.",
    );
    expect(stillConcealed).toBe(true);
  });
});