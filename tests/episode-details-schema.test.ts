import { describe, expect, it } from "vitest";
import {
  episodeDetailSchema,
  episodeDetailBatchSchema,
  seasonArchitectureSchema,
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
import type {
  SeasonArchitecture,
  EpisodeOutline,
} from "@/lib/validation/seasonPlan";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validEpisodeDetail(overrides: Record<string, unknown> = {}) {
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
  seriesTitle: "The house",
  storyBible: {},
  storyFoundation: "Ada returns to claim the house.",
  creativeDirection: "",
  tone: "cold",
  genre: "family",
  language: "en",
  productionMode: "serialized",
  episodeCount: 6,
  operation: "generate",
};

function outline(n: number): EpisodeOutline {
  return {
    episodeNumber: n,
    workingTitle: `Episode ${n}`,
    narrativePurpose: `Purpose of episode ${n}.`,
    centralConflict: `Conflict of episode ${n}.`,
    endingOrCliffhanger: `Episode ${n} ends on a turn.`,
  };
}

function architecture(): SeasonArchitecture {
  return {
    seasonObjective: "Ada reclaims the family house.",
    centralConflictOrMystery: "Who hid the deed?",
    mainCharacterObjectives: "Ada wants the truth.",
    overallCharacterDevelopment: "Ada learns the cost of winning.",
    majorStoryDevelopments: ["The deed surfaces.", "Elias admits his part."],
    beginningDirection: "Ada returns.",
    middleDirection: "The search escalates.",
    endingDirection: "Ada chooses.",
    episodeOutlines: [outline(1), outline(2), outline(3)],
    importantRevelations: ["Elias signed the deed."],
    relationshipChanges: ["Ada and Elias become rivals."],
    consequencesCarriedBetween: ["Elias is exposed."],
    setupAndPayoff: ["The drawer pays off."],
    unresolvedQuestions: ["Where is the second copy?"],
    intendedSeasonConclusion: "Ada keeps the house.",
  };
}

function batchPrompt(): EpisodeDetailBatchPrompt {
  return {
    seriesTitle: "The house",
    storyBible: {},
    genre: "family",
    language: "en",
    tone: "cold",
    productionMode: "serialized",
    architecture: architecture(),
    outlines: [outline(1), outline(2), outline(3)],
  };
}

const singleStagePrompt: SeasonPlanPrompt = {
  seriesTitle: "The house",
  storyBible: {},
  storyFoundation: "Ada returns to claim the house.",
  creativeDirection: "",
  tone: "cold",
  genre: "family",
  language: "en",
  productionMode: "serialized",
  episodeCount: 6,
  operation: "generate",
};

// ---------------------------------------------------------------------------
// Section 1: characterDevelopment must be a string, not an array
// ---------------------------------------------------------------------------

describe("Episode Details schema: characterDevelopment is a string", () => {
  it("accepts a valid string for characterDevelopment", () => {
    const episode = validEpisodeDetail();
    const result = episodeDetailSchema.safeParse(episode);
    expect(result.success).toBe(true);
  });

  it("rejects an array for characterDevelopment (the observed failure)", () => {
    const episode = validEpisodeDetail({
      characterDevelopment: ["Ada becomes suspicious", "Elias becomes defensive"],
    });
    const result = episodeDetailSchema.safeParse(episode);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "characterDevelopment"
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toContain("Expected string");
    }
  });

  it("rejects null for characterDevelopment", () => {
    const episode = validEpisodeDetail({ characterDevelopment: null });
    const result = episodeDetailSchema.safeParse(episode);
    expect(result.success).toBe(false);
  });

  it("rejects a number for characterDevelopment", () => {
    const episode = validEpisodeDetail({ characterDevelopment: 42 });
    const result = episodeDetailSchema.safeParse(episode);
    expect(result.success).toBe(false);
  });

  it("rejects an empty string for characterDevelopment", () => {
    const episode = validEpisodeDetail({ characterDevelopment: "" });
    const result = episodeDetailSchema.safeParse(episode);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 2: All string fields reject arrays
// ---------------------------------------------------------------------------

describe("Episode Details schema: all string fields reject arrays", () => {
  const stringFields = [
    "workingTitle",
    "narrativePurpose",
    "startingSituation",
    "mainObjective",
    "centralConflict",
    "characterDevelopment",
    "storyContribution",
    "endingOrCliffhanger",
    "continuityRequirements",
  ];

  for (const field of stringFields) {
    it(`rejects an array for string field "${field}"`, () => {
      const episode = validEpisodeDetail({
        [field]: ["item one", "item two"],
      });
      const result = episodeDetailSchema.safeParse(episode);
      expect(result.success).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Section 3: All array fields reject strings
// ---------------------------------------------------------------------------

describe("Episode Details schema: all array-of-strings fields reject bare strings", () => {
  const arrayFields = [
    "majorStoryBeats",
    "informationRevealed",
    "importantEvents",
    "consequences",
    "unresolvedThreads",
  ];

  for (const field of arrayFields) {
    it(`rejects a bare string for array field "${field}"`, () => {
      const episode = validEpisodeDetail({
        [field]: "A single string instead of an array.",
      });
      const result = episodeDetailSchema.safeParse(episode);
      expect(result.success).toBe(false);
    });

    it(`accepts an array of strings for array field "${field}"`, () => {
      const episode = validEpisodeDetail({
        [field]: ["First item", "Second item"],
      });
      const result = episodeDetailSchema.safeParse(episode);
      expect(result.success).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Section 4: Batch schema validation
// ---------------------------------------------------------------------------

describe("Episode Details batch schema", () => {
  it("accepts a valid batch", () => {
    const batch = { episodes: [validEpisodeDetail(), validEpisodeDetail({ episodeNumber: 2 })] };
    const result = episodeDetailBatchSchema.safeParse(batch);
    expect(result.success).toBe(true);
  });

  it("rejects a batch where episode 0 has characterDevelopment as array", () => {
    const batch = {
      episodes: [
        validEpisodeDetail({ characterDevelopment: ["Ada changes"] }),
        validEpisodeDetail({ episodeNumber: 2 }),
      ],
    };
    const result = episodeDetailBatchSchema.safeParse(batch);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "episodes.0.characterDevelopment"
      );
      expect(issue).toBeDefined();
    }
  });

  it("rejects an empty episodes array", () => {
    const result = episodeDetailBatchSchema.safeParse({ episodes: [] });
    expect(result.success).toBe(false);
  });

  it("rejects missing episodes field", () => {
    const result = episodeDetailBatchSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Prompt explicitly specifies field types
// ---------------------------------------------------------------------------

describe("Episode Details prompt: explicit field types", () => {
  const { prompt } = episodeDetailBatchInstructions(batchPrompt());

  it("states characterDevelopment is a string, not an array", () => {
    expect(prompt).toContain("characterDevelopment (string");
    expect(prompt.toLowerCase()).toContain("not an array");
  });

  it("groups string fields separately from array fields", () => {
    expect(prompt).toContain("String fields");
    expect(prompt).toContain("Array of strings fields");
    expect(prompt).toContain("Array of objects fields");
  });

  it("lists all string fields with type annotation", () => {
    const stringFields = [
      "workingTitle",
      "narrativePurpose",
      "startingSituation",
      "mainObjective",
      "centralConflict",
      "characterDevelopment",
      "storyContribution",
      "endingOrCliffhanger",
      "continuityRequirements",
    ];
    for (const field of stringFields) {
      expect(prompt).toContain(field);
    }
  });

  it("lists all array-of-strings fields with type annotation", () => {
    const arrayFields = [
      "majorStoryBeats",
      "informationRevealed",
      "importantEvents",
      "consequences",
      "unresolvedThreads",
    ];
    for (const field of arrayFields) {
      expect(prompt).toContain(field);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 6: Single-stage prompt describes all top-level and episode fields
// ---------------------------------------------------------------------------

describe("Single-stage season plan prompt: top-level field descriptions", () => {
  const { prompt } = seasonPlanInstructions(singleStagePrompt);

  it("describes top-level string fields with type annotations", () => {
    const topLevelStrings = [
      "seasonObjective",
      "centralConflictOrMystery",
      "mainCharacterObjectives",
      "overallCharacterDevelopment",
      "beginningDirection",
      "middleDirection",
      "endingDirection",
      "intendedSeasonConclusion",
    ];
    for (const field of topLevelStrings) {
      expect(prompt).toContain(field);
      expect(prompt).toContain(`${field} (string`);
    }
  });

  it("describes top-level array-of-strings fields with type annotations", () => {
    const topLevelArrays = [
      "majorStoryDevelopments",
      "importantRevelations",
      "relationshipChanges",
      "consequencesCarriedBetween",
      "setupAndPayoff",
      "unresolvedQuestions",
    ];
    for (const field of topLevelArrays) {
      expect(prompt).toContain(field);
      expect(prompt).toContain("strings");
    }
  });

  it("describes episodeProgression as an array of objects", () => {
    expect(prompt).toContain("episodeProgression");
    expect(prompt).toContain("episode objects");
  });

  it("describes episode-level string fields with type annotations", () => {
    const episodeStrings = [
      "workingTitle",
      "narrativePurpose",
      "startingSituation",
      "mainObjective",
      "centralConflict",
      "characterDevelopment",
      "storyContribution",
      "endingOrCliffhanger",
      "continuityRequirements",
    ];
    for (const field of episodeStrings) {
      expect(prompt).toContain(`${field} (string`);
    }
  });

  it("states characterDevelopment is NOT an array", () => {
    expect(prompt).toContain("characterDevelopment (string");
    expect(prompt.toLowerCase()).toContain("not an array");
  });

  it("describes episode-level array-of-strings fields", () => {
    const episodeArrays = [
      "majorStoryBeats",
      "informationRevealed",
      "importantEvents",
      "consequences",
      "unresolvedThreads",
    ];
    for (const field of episodeArrays) {
      expect(prompt).toContain(field);
      expect(prompt).toContain("strings");
    }
  });

  it("separates string fields from array fields in the prompt", () => {
    expect(prompt).toContain("String fields");
    expect(prompt).toContain("Array of strings fields");
    expect(prompt).toContain("Array of objects fields");
  });
});

// ---------------------------------------------------------------------------
// Section 7: Season Architecture prompt: episodeOutlines sub-field types
// ---------------------------------------------------------------------------

describe("Season Architecture prompt: episodeOutlines sub-field types", () => {
  const { prompt } = seasonArchitectureInstructions(archPrompt);

  it("describes episodeOutlines as an array of objects", () => {
    expect(prompt).toContain("episodeOutlines");
    expect(prompt).toContain("objects");
  });

  it("explicitly types episodeNumber as integer in episodeOutlines", () => {
    expect(prompt).toContain("episodeNumber (integer");
  });

  it("explicitly types episodeOutlines string sub-fields as strings", () => {
    const subFields = ["workingTitle", "narrativePurpose", "centralConflict", "endingOrCliffhanger"];
    for (const field of subFields) {
      expect(prompt).toContain(`${field} (string`);
    }
  });

  it("describes all top-level architecture fields with types", () => {
    const archStrings = [
      "seasonObjective",
      "centralConflictOrMystery",
      "mainCharacterObjectives",
      "overallCharacterDevelopment",
      "beginningDirection",
      "middleDirection",
      "endingDirection",
      "intendedSeasonConclusion",
    ];
    for (const field of archStrings) {
      expect(prompt).toContain(`${field} (string`);
    }
  });

  it("describes all top-level architecture array fields with types", () => {
    const archArrays = [
      "majorStoryDevelopments",
      "importantRevelations",
      "relationshipChanges",
      "consequencesCarriedBetween",
      "setupAndPayoff",
      "unresolvedQuestions",
    ];
    for (const field of archArrays) {
      expect(prompt).toContain(field);
      expect(prompt).toContain("strings");
    }
  });
});

// ---------------------------------------------------------------------------
// Section 8: Season Architecture schema is consistent
// ---------------------------------------------------------------------------

describe("Season Architecture schema consistency", () => {
  it("accepts a valid architecture", () => {
    const result = seasonArchitectureSchema.safeParse(architecture());
    expect(result.success).toBe(true);
  });

  it("rejects overallCharacterDevelopment as array", () => {
    const arch = { ...architecture(), overallCharacterDevelopment: ["Ada learns", "Elias hides"] };
    const result = seasonArchitectureSchema.safeParse(arch);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 9: OpenRouter model configuration
// ---------------------------------------------------------------------------

describe("OpenRouter model configuration", () => {
  it("freePolicy uses baidu/ernie-5.5-flash-preview:free, not the dead llama model", async () => {
    const { FREE_OPENROUTER_MODELS } = await import("@/lib/providers/llm/freePolicy");
    expect(FREE_OPENROUTER_MODELS).toContain("baidu/ernie-5.5-flash-preview:free");
    expect(FREE_OPENROUTER_MODELS).not.toContain("meta-llama/llama-3.3-8b-instruct:free");
  });
});