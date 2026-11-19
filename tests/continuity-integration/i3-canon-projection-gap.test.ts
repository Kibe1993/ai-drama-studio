import { describe, it, expect } from "vitest";
import { canonFromApprovedSources } from "@/lib/domain/narrativeControl/projectCanon";
import { mergeDerivedCanon } from "@/lib/domain/narrativeControl/canonResolution";
import { makeStoryBible, makeLedger, makeCharacterState } from "./fixtures";

describe("I-3: canon projection gap — ledger character states never reach CanonState", () => {
  it.fails("canonFromApprovedSources projects ledger character states into entities", () => {
    const bible = makeStoryBible();
    const ledger = makeLedger({
      characterStates: [
        makeCharacterState({
          name: "Alice",
          currentLocation: "The Old House",
          currentObjective: "Confront Bob about the document.",
          emotionalState: "Angry and determined.",
          physicalState: "Injured but standing.",
        }),
      ],
    });

    const canon = canonFromApprovedSources({
      projectId: "proj-1",
      bible,
      ledger,
      bibleVersion: 1,
      planVersion: 1,
    });

    const aliceEntity = canon.entities.find((e) => e.name === "Alice");
    expect(aliceEntity).toBeDefined();
    // The canon entity should reflect the ledger's current state, not just the bible's static description.
    expect(aliceEntity!.description).not.toBe(bible.characters.characters[0]!.roleDescription);
  });

  it.fails("mergeDerivedCanon updates entity description from newer ledger character states", () => {
    const bible = makeStoryBible();
    const initialLedger = makeLedger({
      characterStates: [
        makeCharacterState({ name: "Alice", currentObjective: "Find the truth.", emotionalState: "Curious." }),
      ],
    });

    const storedCanon = canonFromApprovedSources({
      projectId: "proj-1",
      bible,
      ledger: initialLedger,
      bibleVersion: 1,
      planVersion: 1,
    });

    const updatedLedger = makeLedger({
      characterStates: [
        makeCharacterState({
          name: "Alice",
          currentObjective: "Confront the antagonist.",
          emotionalState: "Furious.",
          physicalState: "Wounded.",
        }),
      ],
    });

    const derivedCanon = canonFromApprovedSources({
      projectId: "proj-1",
      bible,
      ledger: updatedLedger,
      bibleVersion: 1,
      planVersion: 2,
    });

    const merged = mergeDerivedCanon(storedCanon, derivedCanon);
    const aliceEntity = merged.state.entities.find((e) => e.name === "Alice");
    expect(aliceEntity).toBeDefined();
    // The merged canon should reflect the updated ledger state.
    expect(aliceEntity!.description).not.toBe(storedCanon.entities.find((e) => e.name === "Alice")!.description);
  });

  it.fails("canonFromApprovedSources projects ledger character knowledge as facts", () => {
    const bible = makeStoryBible();
    const ledger = makeLedger({
      characterStates: [
        makeCharacterState({
          name: "Alice",
          knowledge: ["Bob is the one who hid the document.", "The document is in the old house."],
        }),
      ],
    });

    const canon = canonFromApprovedSources({
      projectId: "proj-1",
      bible,
      ledger,
      bibleVersion: 1,
      planVersion: 1,
    });

    // Knowledge acquired in later episodes (via the ledger) should appear as facts or knowledge entries.
    const hasLedgerKnowledge = canon.facts.some(
      (f) => f.statement.includes("hid the document") || f.statement.includes("old house"),
    );
    expect(hasLedgerKnowledge).toBe(true);
  });
});