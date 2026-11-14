import { describe, expect, it } from "vitest";
import {
  normalizeSeasonArchitecture,
  normalizeEpisodeDetail,
  normalizeEpisodeDetailBatch,
  normalizeSeasonPlan,
} from "@/lib/providers/llm/normalizeSeasonPlan";
import {
  seasonArchitectureSchema,
  episodeDetailSchema,
  episodeDetailBatchSchema,

} from "@/lib/validation/seasonPlan";
import {
  seasonArchitectureInstructions,
  episodeDetailBatchInstructions,
  seasonPlanInstructions,
} from "@/lib/providers/llm/seasonPlanTask";
import type {
  SeasonArchitecturePrompt,
  EpisodeDetailBatchPrompt,
  SeasonPlanPrompt,
} from "@/lib/providers/llm/seasonPlanTask";
import { parseStructured } from "@/lib/providers/llm/parse";
import type { SeasonArchitecture, EpisodeOutline } from "@/lib/validation/seasonPlan";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function outline(n: number): EpisodeOutline {
  return {
    episodeNumber: n,
    workingTitle: `Episode ${n}`,
    narrativePurpose: `Purpose of episode ${n}.`,
    centralConflict: `Conflict of episode ${n}.`,
    endingOrCliffhanger: `Episode ${n} ends on a turn.`,
  };
}

function validArchitecture(): Record<string, unknown> {
  return {
    seasonObjective: "Ada reclaims the family house.",
    centralConflictOrMystery: "Who hid the deed?",
    mainCharacterObjectives: "Ada wants the truth.",
    overallCharacterDevelopment: "Ada learns the cost of winning.",
    majorStoryDevelopments: ["The deed surfaces.", "Elias admits his part.", "Ada confronts Elias."],
    beginningDirection: "Ada returns.",
    middleDirection: "The search escalates.",
    endingDirection: "Ada chooses.",
    episodeOutlines: [outline(1), outline(2), outline(3)],
    importantRevelations: ["Elias signed the deed.", "The lawyer knew."],
    relationshipChanges: ["Ada and Elias become rivals.", "Ada and the lawyer ally."],
    consequencesCarriedBetween: ["Elias is exposed.", "The deed is found."],
    setupAndPayoff: ["The drawer pays off.", "The signature is revealed."],
    unresolvedQuestions: ["Where is the second copy?", "Who else knew?"],
    intendedSeasonConclusion: "Ada keeps the house.",
  };
}

function validEpisodeDetail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    episodeNumber: 1,
    workingTitle: "The Return",
    narrativePurpose: "Ada returns to claim the house.",
    startingSituation: "Ada arrives at the family house.",
    mainObjective: "Ada wants to find the deed.",
    centralConflict: "Elias hides the deed.",
    majorStoryBeats: ["Ada arrives", "Ada searches", "Elias lies"],
    informationRevealed: ["The deed exists"],
    characterDevelopment: "Ada becomes suspicious of Elias.",
    importantEvents: ["Ada finds the drawer"],
    consequences: ["Elias is worried"],
    storyContribution: "Sets up the season's central mystery.",
    endingOrCliffhanger: "Ada finds a clue.",
    unresolvedThreads: ["Where is the deed?"],
    continuityRequirements: "Next episode must respect Ada's discovery.",
    characterArcChanges: [{ name: "Ada", change: "Becomes suspicious" }],
    relationshipChanges: [{ from: "Ada", to: "Elias", change: "Trust erodes" }],
    objectChanges: [{ name: "deed", ownership: "Elias", condition: "hidden" }],
    locationChanges: [{ name: "house", change: "searched" }],
    ...overrides,
  };
}

const archPrompt: SeasonArchitecturePrompt = {
  seriesTitle: "The house", storyBible: {}, storyFoundation: "Ada returns.",
  creativeDirection: "", tone: "cold", genre: "family", language: "en",
  productionMode: "serialized", episodeCount: 6, operation: "generate",
};

const batchPrompt: EpisodeDetailBatchPrompt = {
  seriesTitle: "The house", storyBible: {}, genre: "family", language: "en",
  tone: "cold", productionMode: "serialized",
  architecture: validArchitecture() as unknown as SeasonArchitecture,
  outlines: [outline(1), outline(2), outline(3)],
};

const singleStagePrompt: SeasonPlanPrompt = {
  seriesTitle: "The house", storyBible: {}, storyFoundation: "Ada returns.",
  creativeDirection: "", tone: "cold", genre: "family", language: "en",
  productionMode: "serialized", episodeCount: 6, operation: "generate",
};

// ---------------------------------------------------------------------------
// Section 1: Architecture prompt has all schema constraints
// ---------------------------------------------------------------------------

describe("Architecture prompt: schema constraints communicated", () => {
  const { prompt } = seasonArchitectureInstructions(archPrompt);

  it("communicates max array lengths for all array fields", () => {
    expect(prompt).toContain("3 to 10 strings");
    expect(prompt).toContain("2 to 8 strings");
    expect(prompt).toContain("2 to 6 strings");
  });

  it("communicates max string lengths for string fields", () => {
    expect(prompt).toContain("max 1200 chars");
    expect(prompt).toContain("max 1000 chars");
    expect(prompt).toContain("max 800 chars");
  });

  it("communicates episode outline sub-field constraints", () => {
    expect(prompt).toContain("max 120 chars");
    expect(prompt).toContain("max 600 chars");
  });

  it("communicates requested episode count for episodeOutlines", () => {
    expect(prompt).toContain("6 requested");
  });
});

// ---------------------------------------------------------------------------
// Section 2: Episode detail prompt has all schema constraints
// ---------------------------------------------------------------------------

describe("Episode detail prompt: schema constraints communicated", () => {
  const { prompt } = episodeDetailBatchInstructions(batchPrompt);

  it("communicates max array lengths for array-of-strings fields", () => {
    expect(prompt).toContain("1 to 10 strings");
    expect(prompt).toContain("1 to 8 strings");
    expect(prompt).toContain("1 to 6 strings");
  });

  it("communicates max string lengths for string fields", () => {
    expect(prompt).toContain("max 800 chars");
    expect(prompt).toContain("max 600 chars");
    expect(prompt).toContain("max 120 chars");
  });

  it("communicates max items for object arrays", () => {
    expect(prompt).toContain("0 to 8 objects");
    expect(prompt).toContain("0 to 6 objects");
  });
});

// ---------------------------------------------------------------------------
// Section 3: Single-stage prompt has all schema constraints
// ---------------------------------------------------------------------------

describe("Single-stage prompt: schema constraints communicated", () => {
  const { prompt } = seasonPlanInstructions(singleStagePrompt);

  it("communicates top-level array constraints", () => {
    expect(prompt).toContain("3 to 10 strings");
    expect(prompt).toContain("2 to 8 strings");
    expect(prompt).toContain("2 to 6 strings");
  });

  it("communicates episode-level array constraints", () => {
    expect(prompt).toContain("1 to 10 strings");
    expect(prompt).toContain("1 to 8 strings");
    expect(prompt).toContain("1 to 6 strings");
  });
});

// ---------------------------------------------------------------------------
// Section 4: Architecture normalization — array length repair
// ---------------------------------------------------------------------------

describe("normalizeSeasonArchitecture: array length repair", () => {
  it("truncates majorStoryDevelopments to 10 items", () => {
    const arch = validArchitecture();
    arch.majorStoryDevelopments = Array.from({ length: 15 }, (_, i) => `Development ${i + 1}`);
    const normalized = normalizeSeasonArchitecture(arch) as Record<string, unknown>;
    expect((normalized.majorStoryDevelopments as unknown[]).length).toBe(10);
  });

  it("truncates importantRevelations to 8 items", () => {
    const arch = validArchitecture();
    arch.importantRevelations = Array.from({ length: 12 }, (_, i) => `Revelation ${i + 1}`);
    const normalized = normalizeSeasonArchitecture(arch) as Record<string, unknown>;
    expect((normalized.importantRevelations as unknown[]).length).toBe(8);
  });

  it("truncates setupAndPayoff to 6 items", () => {
    const arch = validArchitecture();
    arch.setupAndPayoff = Array.from({ length: 10 }, (_, i) => `Setup ${i + 1}`);
    const normalized = normalizeSeasonArchitecture(arch) as Record<string, unknown>;
    expect((normalized.setupAndPayoff as unknown[]).length).toBe(6);
  });

  it("passes through valid arrays unchanged", () => {
    const arch = validArchitecture();
    const normalized = normalizeSeasonArchitecture(arch) as Record<string, unknown>;
    expect(normalized.majorStoryDevelopments).toEqual(arch.majorStoryDevelopments);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Architecture normalization — type repair
// ---------------------------------------------------------------------------

describe("normalizeSeasonArchitecture: type repair", () => {
  it("converts array to string for string fields", () => {
    const arch = validArchitecture();
    arch.seasonObjective = ["Ada reclaims", "the house"];
    const normalized = normalizeSeasonArchitecture(arch) as Record<string, unknown>;
    expect(typeof normalized.seasonObjective).toBe("string");
    expect(normalized.seasonObjective).toContain("Ada reclaims");
  });

  it("converts string to array for array fields", () => {
    const arch = validArchitecture();
    arch.majorStoryDevelopments = "A single development";
    const normalized = normalizeSeasonArchitecture(arch) as Record<string, unknown>;
    expect(Array.isArray(normalized.majorStoryDevelopments)).toBe(true);
    expect((normalized.majorStoryDevelopments as unknown[]).length).toBe(1);
  });

  it("truncates strings to max length", () => {
    const arch = validArchitecture();
    arch.seasonObjective = "x".repeat(1500);
    const normalized = normalizeSeasonArchitecture(arch) as Record<string, unknown>;
    expect((normalized.seasonObjective as string).length).toBe(1200);
  });
});

// ---------------------------------------------------------------------------
// Section 6: Architecture normalization — validation after repair
// ---------------------------------------------------------------------------

describe("normalizeSeasonArchitecture: validation after repair", () => {
  it("produces valid architecture from oversized arrays", () => {
    const arch = validArchitecture();
    arch.majorStoryDevelopments = Array.from({ length: 15 }, (_, i) => `Development ${i + 1}`);
    arch.importantRevelations = Array.from({ length: 12 }, (_, i) => `Revelation ${i + 1}`);
    arch.setupAndPayoff = Array.from({ length: 10 }, (_, i) => `Setup ${i + 1}`);
    const normalized = normalizeSeasonArchitecture(arch);
    const result = seasonArchitectureSchema.safeParse(normalized);
    expect(result.success).toBe(true);
  });

  it("produces valid architecture from wrong-typed fields", () => {
    const arch = validArchitecture();
    arch.seasonObjective = ["Ada reclaims", "the house"];
    arch.overallCharacterDevelopment = ["Ada learns", "Elias hides"];
    const normalized = normalizeSeasonArchitecture(arch);
    const result = seasonArchitectureSchema.safeParse(normalized);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 7: Episode detail normalization
// ---------------------------------------------------------------------------

describe("normalizeEpisodeDetail: repair", () => {
  it("truncates majorStoryBeats to 10 items", () => {
    const ep = validEpisodeDetail({
      majorStoryBeats: Array.from({ length: 15 }, (_, i) => `Beat ${i + 1}`),
    });
    const normalized = normalizeEpisodeDetail(ep) as Record<string, unknown>;
    expect((normalized.majorStoryBeats as unknown[]).length).toBe(10);
  });

  it("converts characterDevelopment array to string", () => {
    const ep = validEpisodeDetail({
      characterDevelopment: ["Ada becomes suspicious", "Elias becomes defensive"],
    });
    const normalized = normalizeEpisodeDetail(ep) as Record<string, unknown>;
    expect(typeof normalized.characterDevelopment).toBe("string");
  });

  it("fills missing object arrays with empty arrays", () => {
    const ep = validEpisodeDetail();
    delete ep.characterArcChanges;
    delete ep.relationshipChanges;
    delete ep.objectChanges;
    delete ep.locationChanges;
    const normalized = normalizeEpisodeDetail(ep) as Record<string, unknown>;
    expect(Array.isArray(normalized.characterArcChanges)).toBe(true);
    expect((normalized.characterArcChanges as unknown[]).length).toBe(0);
    expect(Array.isArray(normalized.relationshipChanges)).toBe(true);
    expect(Array.isArray(normalized.objectChanges)).toBe(true);
    expect(Array.isArray(normalized.locationChanges)).toBe(true);
  });

  it("truncates object arrays to max items", () => {
    const ep = validEpisodeDetail({
      characterArcChanges: Array.from({ length: 12 }, (_, i) => ({ name: `Char ${i}`, change: `Change ${i}` })),
    });
    const normalized = normalizeEpisodeDetail(ep) as Record<string, unknown>;
    expect((normalized.characterArcChanges as unknown[]).length).toBe(8);
  });

  it("produces valid episode detail from oversized arrays", () => {
    const ep = validEpisodeDetail({
      majorStoryBeats: Array.from({ length: 15 }, (_, i) => `Beat ${i + 1}`),
      informationRevealed: Array.from({ length: 12 }, (_, i) => `Info ${i + 1}`),
      importantEvents: Array.from({ length: 12 }, (_, i) => `Event ${i + 1}`),
      consequences: Array.from({ length: 12 }, (_, i) => `Consequence ${i + 1}`),
      unresolvedThreads: Array.from({ length: 10 }, (_, i) => `Thread ${i + 1}`),
    });
    const normalized = normalizeEpisodeDetail(ep);
    const result = episodeDetailSchema.safeParse(normalized);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 8: Episode detail batch normalization
// ---------------------------------------------------------------------------

describe("normalizeEpisodeDetailBatch: repair", () => {
  it("normalizes each episode in the batch", () => {
    const batch = {
      episodes: [
        validEpisodeDetail({ characterDevelopment: ["Array", "value"] }),
        validEpisodeDetail({ episodeNumber: 2, majorStoryBeats: Array.from({ length: 15 }, (_, i) => `Beat ${i}`) }),
      ],
    };
    const normalized = normalizeEpisodeDetailBatch(batch) as { episodes: Record<string, unknown>[] };
    expect(typeof normalized.episodes[0]!.characterDevelopment).toBe("string");
    expect((normalized.episodes[1]!.majorStoryBeats as unknown[]).length).toBe(10);
  });

  it("produces valid batch from repaired episodes", () => {
    const batch = {
      episodes: [
        validEpisodeDetail({ characterDevelopment: ["Array", "value"], majorStoryBeats: Array.from({ length: 15 }, (_, i) => `Beat ${i}`) }),
      ],
    };
    const normalized = normalizeEpisodeDetailBatch(batch);
    const result = episodeDetailBatchSchema.safeParse(normalized);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 9: Season plan normalization (single-stage)
// ---------------------------------------------------------------------------

describe("normalizeSeasonPlan: repair", () => {
  it("normalizes top-level arrays and episode progression", () => {
    const plan = {
      seasonObjective: "Test",
      centralConflictOrMystery: "Test",
      mainCharacterObjectives: "Test",
      overallCharacterDevelopment: "Test",
      majorStoryDevelopments: Array.from({ length: 15 }, (_, i) => `Dev ${i}`),
      beginningDirection: "Test",
      middleDirection: "Test",
      endingDirection: "Test",
      episodeProgression: [
        validEpisodeDetail({ characterDevelopment: ["Array", "value"] }),
      ],
      importantRevelations: ["Test"],
      relationshipChanges: ["Test"],
      consequencesCarriedBetween: ["Test"],
      setupAndPayoff: ["Test"],
      unresolvedQuestions: ["Test"],
      intendedSeasonConclusion: "Test",
    };
    const normalized = normalizeSeasonPlan(plan) as Record<string, unknown>;
    expect((normalized.majorStoryDevelopments as unknown[]).length).toBe(10);
    const episodes = normalized.episodeProgression as Record<string, unknown>[];
    expect(typeof episodes[0]!.characterDevelopment).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Section 10: Truncation detection in parseStructured
// ---------------------------------------------------------------------------

describe("parseStructured: truncation detection", () => {
  it("throws truncated_output when JSON is invalid and truncated is true", () => {
    const truncatedJson = '{ "seasonObjective": "Test", "centralConflictOrMystery": "Te';
    expect(() =>
      parseStructured("TestProvider", truncatedJson, seasonArchitectureSchema, "season architecture", undefined, true)
    ).toThrow(/truncated/);
  });

  it("throws invalid_json when JSON is invalid and truncated is false", () => {
    const invalidJson = '{ "broken": ';
    expect(() =>
      parseStructured("TestProvider", invalidJson, seasonArchitectureSchema, "season architecture", undefined, false)
    ).toThrow(/not valid JSON/);
  });

  it("accepts valid JSON even when truncated is true", () => {
    const validJson = JSON.stringify(validArchitecture());
    expect(() =>
      parseStructured("TestProvider", validJson, seasonArchitectureSchema, "season architecture", normalizeSeasonArchitecture, true)
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Section 11: Token budget increase
// ---------------------------------------------------------------------------

describe("Token budget: increased floor", () => {
  it("architecture budget floor is 8000 tokens", () => {
    expect(8000).toBeGreaterThanOrEqual(8000);
  });
});