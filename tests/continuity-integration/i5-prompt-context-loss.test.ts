import { describe, it, expect } from "vitest";
import { compactCasnaPromptContext } from "@/lib/pipeline/casnaContext";
import type { CasnaEpisodeContext } from "@/lib/pipeline/casnaContext";
import { makeLedger, makeCharacterState, makeSeasonPlan } from "./fixtures";

type CompactLedger = {
  characterStates?: Array<Record<string, unknown>>;
  locationStates?: Array<Record<string, unknown>>;
  objectStates?: Array<Record<string, unknown>>;
};

function makeCasnaContext(ledgerOverrides: Record<string, unknown>): CasnaEpisodeContext {
  const plan = makeSeasonPlan(3);
  const ledger = makeLedger(ledgerOverrides as Parameters<typeof makeLedger>[0]);
  return {
    gate: { allowed: true, code: "ok" as const, reason: null } as CasnaEpisodeContext["gate"],
    plan: { ...plan, version: 1 } as CasnaEpisodeContext["plan"],
    latestPlan: null,
    ledger: {
      ...ledger,
      id: "l1",
      clerkUserId: "u1",
      projectId: "p1",
      asOfEpisode: 1,
      basedOnPlanVersion: 1,
      version: 1,
      createdAt: "",
      updatedAt: "",
    } as CasnaEpisodeContext["ledger"],
    episodePlan: null,
    episodePlanValidation: null,
    previousEpisodes: [],
    previousEpisode: null,
  };
}

function compactLedger(context: CasnaEpisodeContext): CompactLedger {
  const compact = compactCasnaPromptContext(context);
  return compact.continuityLedger as CompactLedger;
}

describe("I-5: prompt context drops most ledger state", () => {
  it("compact context includes character knowledge", () => {
    const context = makeCasnaContext({
      characterStates: [
        makeCharacterState({
          name: "Alice",
          knowledge: ["Bob hid the document in the old house.", "The event happened twenty years ago."],
        }),
      ],
    });

    const cl = compactLedger(context);
    expect(cl).not.toBeNull();
    expect(cl.characterStates?.[0]?.knowledge).toBeDefined();
    expect(cl.characterStates?.[0]?.knowledge).toHaveLength(2);
  });

  it("compact context includes character beliefs", () => {
    const context = makeCasnaContext({
      characterStates: [
        makeCharacterState({
          name: "Alice",
          beliefs: ["The truth must come out."],
        }),
      ],
    });

    const cl = compactLedger(context);
    expect(cl.characterStates?.[0]?.beliefs).toBeDefined();
    expect(cl.characterStates?.[0]?.beliefs).toHaveLength(1);
  });

  it("compact context includes character motivations", () => {
    const context = makeCasnaContext({
      characterStates: [
        makeCharacterState({
          name: "Alice",
          motivations: ["Protect Bob.", "Find the document."],
        }),
      ],
    });

    const cl = compactLedger(context);
    expect(cl.characterStates?.[0]?.motivations).toBeDefined();
    expect(cl.characterStates?.[0]?.motivations).toHaveLength(2);
  });

  it("compact context includes character relationships", () => {
    const context = makeCasnaContext({
      characterStates: [
        makeCharacterState({
          name: "Alice",
          relationships: [
            { characterName: "Bob", relationship: "old friend", tensionOrChange: "Trust is strained." },
          ],
        }),
      ],
    });

    const cl = compactLedger(context);
    expect(cl.characterStates?.[0]?.relationships).toBeDefined();
    expect(cl.characterStates?.[0]?.relationships).toHaveLength(1);
  });

  it("compact context includes location states", () => {
    const context = makeCasnaContext({
      locationStates: [
        { name: "The Old House", currentState: "Boarded up and abandoned.", lastSeenEpisode: 3 },
      ],
    });

    const cl = compactLedger(context);
    expect(cl).not.toBeNull();
    expect(cl.locationStates).toBeDefined();
    expect(cl.locationStates).toHaveLength(1);
  });

  it("compact context includes object states", () => {
    const context = makeCasnaContext({
      objectStates: [
        { name: "The Document", ownership: "Hidden by Bob", condition: "Aged but intact.", lastSeenEpisode: 2 },
      ],
    });

    const cl = compactLedger(context);
    expect(cl).not.toBeNull();
    expect(cl.objectStates).toBeDefined();
    expect(cl.objectStates).toHaveLength(1);
  });
});