import { describe, expect, it } from "vitest";
import { createStoryDraftEngine } from "@/lib/pipeline/storyDraftEngine";
import { storyUserPrompt } from "@/lib/providers/llm/prompt";
import type { LLMProvider, StoryPrompt } from "@/lib/providers/llm/types";
import type { JobRecord } from "@/lib/pipeline/types";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { EpisodeValidation } from "@/lib/validation/casna";
import type { CanonState } from "@/lib/validation/narrativeControl";
import type { GeneratedStory, ScreenplayScene, StoryRecord, StoryStructure } from "@/lib/validation/story";
import type { StoryBibleContent, StoryBibleSnapshot } from "@/lib/validation/storyBible";

const userId = "user_owner";
const projectId = "c".repeat(24);
const now = new Date().toISOString();

function bible(): StoryBibleContent {
  return {
    identity: {
      title: "The Eleventh Hour",
      genres: ["thriller"],
      subgenres: [],
      centralPremise: "Amara returns home as the twelve-year ritual comes due.",
      narrativeConcept: "A phone call and a lighthouse hold the same warning.",
      toneAndAtmosphere: "Salt, dark water, and an unanswered door.",
      targetAudience: "Adults",
      centralConflict: "Amara must decide whether to open the door.",
    },
    world: {
      description: "A coastal town bound to a lighthouse.",
      geographyAndLocations: [
        { name: "Lighthouse", description: "It houses a sea-bound entity.", storyFunction: "The containment." },
        { name: "Amara's house", description: "The door she may not open.", storyFunction: "The climax." },
      ],
      socialStructuresAndCultures: ["The town keeps the ritual."],
      historyAndPastEvents: ["The sacrifice has returned every 12 years."],
      rules: ["The ritual involves a sacrifice every 12 years, not every year.", "The lighthouse houses a sea-bound entity."],
      definingSystems: [],
    },
    characters: {
      characters: [
        {
          name: "Amara",
          storyRole: "protagonist",
          roleDescription: "A journalist returning to her coastal hometown.",
          physicalDescription: "",
          personality: "Guarded and determined.",
          background: "Raised beside the lighthouse.",
          motivations: ["Protect the town.", "Find her brother."],
          fearsAndWeaknesses: ["Opening the wrong door."],
          abilitiesAndLimitations: [],
          relationships: [{ characterName: "Kofi", relationship: "brother", tensionOrChange: "He is missing and still calls." }],
          secrets: ["The entity knows Amara's childhood name."],
          developmentPotential: "Face the ritual without a certain ending.",
        },
        {
          name: "Kofi",
          storyRole: "supporting",
          roleDescription: "Amara's missing brother.",
          physicalDescription: "",
          personality: "Protective.",
          background: "Raised beside the lighthouse.",
          motivations: ["Warn Amara."],
          fearsAndWeaknesses: [],
          abilitiesAndLimitations: [],
          relationships: [{ characterName: "Amara", relationship: "sister", tensionOrChange: "He warns her and remains missing." }],
          secrets: [],
          developmentPotential: "Remains missing.",
        },
      ],
      relationshipDynamics: ["Amara and Kofi are sister and brother."],
    },
    narrative: {
      mainStoryline: "Amara follows Kofi's warning toward the lighthouse.",
      majorConflicts: ["Whether to open the door."],
      longTermDirection: "The town's fate stays unresolved.",
      subplots: [],
      unresolvedMysteries: ["What the entity wants."],
      potentialFutureRevelations: [],
      majorNarrativeQuestions: ["Does Amara open the door?"],
      serializedEndingGuidance: "Leave Amara's decision and the town's fate uncertain.",
    },
    guidelines: {
      mainThemes: ["Warning"],
      secondaryThemes: [],
      storytellingStyle: "Restrained thriller.",
      boundaries: ["Do not decide the town's fate."],
      mustRemainConsistent: ["The town performs a sacrifice every 12 years.", "Her final fate remains uncertain."],
    },
    canon: {
      confirmedFacts: [
        "Amara is a journalist returning to her coastal hometown.",
        "Kofi is her missing brother.",
        "An anonymous package contains Kofi's photograph.",
        "Kofi calls at 11:47 PM to warn Amara about the ritual.",
        "Another resident disappears.",
        "The town performs a sacrifice every 12 years.",
        "The lighthouse houses a sea-bound entity.",
        "Amara hears her own voice warning her not to open the door.",
        "Her final fate remains uncertain.",
      ],
      proposedDetails: [],
      unresolvedQuestions: [],
      hiddenInformation: [],
      characterKnowledge: [
        {
          characterName: "Amara",
          knows: ["Kofi is her missing brother."],
          believes: [],
        },
      ],
      audienceKnowledge: ["The town performs a sacrifice every 12 years."],
    },
  };
}

function snapshot(version = 1): StoryBibleSnapshot {
  return {
    premise: "",
    worldRules: [],
    themes: [],
    boundaries: [],
    canonFacts: [],
    version,
    createdAt: now,
    content: bible(),
  };
}

function structure(): StoryStructure {
  return {
    act1: {
      introduction: "Amara returns to the coastal town.",
      mainCharacters: "Amara is a journalist. Kofi is her brother.",
      setting: "A lighthouse town.",
      initialSituation: "Amara is a journalist returning home.",
      incitingIncident: "An anonymous package contains Kofi's photograph.",
    },
    act2: {
      risingTension: "Another resident disappears.",
      obstacles: "The ritual involves a sacrifice every 12 years.",
      characterDecisions: "Amara follows the warning.",
      turningPoint: "Kofi calls at 11:47 PM to warn Amara about the ritual.",
    },
    act3: {
      climax: "Amara hears her own voice warning her not to open the door.",
      resolution: "The lighthouse houses a sea-bound entity.",
      finalOutcome: "Her final fate remains uncertain.",
    },
  };
}

function scene(sceneNumber: number, action: string, line = "I have to keep going."): ScreenplayScene {
  return {
    sceneNumber,
    heading: `INT. COASTAL HOUSE - NIGHT`,
    location: sceneNumber === 6 ? "Lighthouse" : "Amara's house",
    timeOfDay: "Night",
    charactersPresent: ["Amara"],
    visualDescription: "Salt light and a closed door.",
    action,
    dialogue: [{ characterName: "Amara", line }],
  };
}

function faithfulStory(): GeneratedStory {
  const actions = [
    "Amara is a journalist. Kofi is her missing brother. An anonymous package contains Kofi's photograph.",
    "Amara studies the photograph and the empty street.",
    "A resident disappears from the harbor while Amara watches the boats.",
    "Kofi calls at 11:47 PM to warn Amara about the ritual and the sacrifice.",
    "The ritual involves a sacrifice every 12 years, not every year. The lighthouse houses a sea-bound entity.",
    "Amara hears her own voice warning her not to open the door.",
    "Her final fate remains uncertain, and the town's fate remains uncertain.",
  ];
  return {
    title: "The Eleventh Hour",
    synopsis: "Amara returns to her coastal hometown. Kofi is her missing brother. An anonymous package contains Kofi's photograph. Kofi calls at 11:47 PM to warn Amara about the ritual. The town performs a sacrifice every 12 years. The lighthouse houses a sea-bound entity. Amara hears her own voice warning her not to open the door. Her final fate remains uncertain.",
    structure: structure(),
    screenplay: actions.map((action, index) => scene(index + 1, action, index === 3
      ? "Kofi calls at 11:47 PM to warn me about the ritual."
      : "The door stays shut.")),
  };
}

function defectiveStory(): GeneratedStory {
  const story = structuredClone(faithfulStory());
  story.screenplay = story.screenplay.slice(0, 5).map((item, index) => ({ ...item, sceneNumber: index + 1 }));
  return story;
}

function project(): ProjectRecord {
  return {
    id: projectId,
    title: "The Eleventh Hour",
    originalStoryIdea: "A journalist returns home the night the twelve-year ritual comes due.",
    genre: "thriller",
    language: "en",
    visualStyle: "naturalistic",
    tone: "ominous",
    targetDurationSeconds: 300,
    aspectRatio: "16:9",
    status: "draft",
    workflowMode: "guided",
    productionType: "mystery_crime_thriller",
    productionMode: "serialized",
    sceneRange: { min: 6, max: 8 },
    createdAt: now,
    updatedAt: now,
  };
}

function job(operation: "generate" | "revise" = "generate", sourceBibleVersion?: number): JobRecord {
  return {
    id: "j".repeat(24),
    clerkUserId: userId,
    projectId,
    runId: null,
    sceneNumber: null,
    jobType: "story.draft",
    provider: "stub",
    model: "stub",
    input: {
      operation,
      instruction: "",
      creativeDirection: "",
      ...(sourceBibleVersion ? { sourceBibleVersion } : {}),
    },
    output: null,
    status: "queued",
    progress: { stage: "story.draft", message: "" },
    attempts: 0,
    maxAttempts: 3,
    error: null,
    idempotencyKey: "bible-integration",
    bullJobId: null,
    startedAt: null,
    completedAt: null,
  };
}

function canonPort() {
  let current: CanonState | null = null;
  return {
    async latest() { return current; },
    async commit(input: { expectedVersion: number; state: CanonState }) {
      current = { ...input.state, version: input.expectedVersion + 1 };
      return current;
    },
  };
}

function memoryStories(saved: StoryRecord[]) {
  return {
    async findProjectDraft() {
      return [...saved].reverse().find((draft) => draft.status !== "failed") ?? null;
    },
    async upsertProjectDraft(input: GeneratedStory & {
      validationFindings?: EpisodeValidation | null;
      sourceCanonVersion?: number | null;
      sourceBibleVersion?: number | null;
      promptFingerprint?: string | null;
      storyContract?: StoryRecord["storyContract"];
    }) {
      const record: StoryRecord = {
        ...input,
        id: "e".repeat(24),
        clerkUserId: userId,
        projectId,
        productionRunId: null,
        status: "awaiting_approval",
        version: saved.length + 1,
        provider: "stub",
        model: "stub",
        fallbackFrom: null,
        validationFindings: input.validationFindings ?? null,
        sourceCanonVersion: input.sourceCanonVersion ?? null,
        sourceBibleVersion: input.sourceBibleVersion ?? null,
        promptFingerprint: input.promptFingerprint ?? null,
        storyContract: input.storyContract ?? null,
        createdAt: now,
        updatedAt: now,
      };
      saved.push(record);
      return record;
    },
  };
}

function stub(produce: (prompt: StoryPrompt) => GeneratedStory) {
  return {
    id: "stub",
    model: "stub",
    async generateStory(prompt: StoryPrompt) {
      return { ...produce(prompt), provider: "stub", model: "stub", fallbackFrom: null, attempts: [] };
    },
  };
}

describe("Story Bible context delivery", () => {
  it("includes character personalities, relationships, and world rules in the generation prompt", async () => {
    const prompts: StoryPrompt[] = [];
    const saved: StoryRecord[] = [];
    const engine = createStoryDraftEngine(
      stub((call) => { prompts.push(call); return faithfulStory(); }) as unknown as LLMProvider,
      memoryStories(saved),
      undefined,
      canonPort(),
      { bible: { async findApproved() { return snapshot(); } } },
    );
    await engine.run(job(), project());
    expect(prompts.length).toBeGreaterThanOrEqual(1);
    const rendered = storyUserPrompt(prompts[0]!);
    expect(rendered).toContain("Amara");
    expect(rendered).toContain("Guarded and determined");
    expect(rendered).toContain("Kofi");
    expect(rendered).toContain("brother");
    expect(rendered).toContain("A coastal town bound to a lighthouse");
    expect(rendered).toContain("The ritual involves a sacrifice every 12 years");
    expect(rendered).toContain("Restrained thriller");
    expect(rendered).toContain("Do not decide the town's fate");
  });

  it("includes narrative direction and themes in the generation prompt", async () => {
    const prompts: StoryPrompt[] = [];
    const saved: StoryRecord[] = [];
    const engine = createStoryDraftEngine(
      stub((call) => { prompts.push(call); return faithfulStory(); }) as unknown as LLMProvider,
      memoryStories(saved),
      undefined,
      canonPort(),
      { bible: { async findApproved() { return snapshot(); } } },
    );
    await engine.run(job(), project());
    const rendered = storyUserPrompt(prompts[0]!);
    expect(rendered).toContain("Amara follows Kofi's warning toward the lighthouse");
    expect(rendered).toContain("Whether to open the door");
    expect(rendered).toContain("Warning");
    expect(rendered).toContain("Leave Amara's decision and the town's fate uncertain");
  });

  it("includes character knowledge and audience knowledge in the generation prompt", async () => {
    const prompts: StoryPrompt[] = [];
    const saved: StoryRecord[] = [];
    const engine = createStoryDraftEngine(
      stub((call) => { prompts.push(call); return faithfulStory(); }) as unknown as LLMProvider,
      memoryStories(saved),
      undefined,
      canonPort(),
      { bible: { async findApproved() { return snapshot(); } } },
    );
    await engine.run(job(), project());
    const rendered = storyUserPrompt(prompts[0]!);
    expect(rendered).toContain("Amara");
    expect(rendered).toContain("Kofi is her missing brother");
    expect(rendered).toContain("The town performs a sacrifice every 12 years");
  });
});

describe("Candidate-aware revision", () => {
  it("defective story produces validation errors for revision", async () => {
    const prompts: StoryPrompt[] = [];
    const saved: StoryRecord[] = [];
    const engine = createStoryDraftEngine(
      stub((call) => { prompts.push(call); return defectiveStory(); }) as unknown as LLMProvider,
      memoryStories(saved),
      undefined,
      canonPort(),
      { bible: { async findApproved() { return snapshot(); } } },
    );
    await engine.run(job("generate"), project());
    expect(saved[0]!.validationFindings?.passed).toBe(false);
    const findings = saved[0]!.validationFindings?.findings ?? [];
    expect(findings.some((f) => f.severity === "error")).toBe(true);
  });

  it("attempts revision even for authorization-requiring findings", async () => {
    const prompts: StoryPrompt[] = [];
    const saved: StoryRecord[] = [];
    const canonViolation = structuredClone(faithfulStory());
    canonViolation.synopsis = canonViolation.synopsis.replace("every 12 years", "every year");
    canonViolation.screenplay[4]!.action = "The ritual takes a sacrifice every year.";
    const engine = createStoryDraftEngine(
      stub((call) => { prompts.push(call); return canonViolation; }) as unknown as LLMProvider,
      memoryStories(saved),
      undefined,
      canonPort(),
      { bible: { async findApproved() { return snapshot(); } } },
    );
    await engine.run(job("generate"), project());
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    expect(saved[0]!.validationFindings?.passed).toBe(false);
  });

  it("fixes authorization-requiring finding when LLM corrects the story", async () => {
    const prompts: StoryPrompt[] = [];
    const saved: StoryRecord[] = [];
    let callCount = 0;
    const engine = createStoryDraftEngine(
      stub((call) => {
        prompts.push(call);
        callCount += 1;
        if (callCount === 1) {
          const defective = structuredClone(faithfulStory());
          defective.synopsis = defective.synopsis.replace("every 12 years", "every year");
          defective.screenplay[4]!.action = "The ritual takes a sacrifice every year.";
          return defective;
        }
        return faithfulStory();
      }) as unknown as LLMProvider,
      memoryStories(saved),
      undefined,
      canonPort(),
      { bible: { async findApproved() { return snapshot(); } } },
    );
    await engine.run(job("generate"), project());
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    expect(saved[0]!.validationFindings?.passed).toBe(true);
  });

  it("includes the complete candidate in the revision prompt", async () => {
    const prompts: StoryPrompt[] = [];
    const saved: StoryRecord[] = [];
    const engine = createStoryDraftEngine(
      stub((call) => { prompts.push(call); return defectiveStory(); }) as unknown as LLMProvider,
      memoryStories(saved),
      undefined,
      canonPort(),
      { bible: { async findApproved() { return snapshot(); } } },
    );
    await engine.run(job("generate"), project());
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    const revisionPrompt = storyUserPrompt(prompts[1]!);
    expect(revisionPrompt).toContain("Title: The Eleventh Hour");
    expect(revisionPrompt).toContain("Synopsis:");
    expect(revisionPrompt).toContain("Act 1");
    expect(revisionPrompt).toContain("Act 2");
    expect(revisionPrompt).toContain("Act 3");
    expect(revisionPrompt).toContain("Scene 1:");
    expect(revisionPrompt).toContain("Visual:");
    expect(revisionPrompt).toContain("Action:");
    expect(revisionPrompt).toContain("Amara:");
  });

  it("includes finding explanations in the revision prompt", async () => {
    const prompts: StoryPrompt[] = [];
    const saved: StoryRecord[] = [];
    const engine = createStoryDraftEngine(
      stub((call) => { prompts.push(call); return defectiveStory(); }) as unknown as LLMProvider,
      memoryStories(saved),
      undefined,
      canonPort(),
      { bible: { async findApproved() { return snapshot(); } } },
    );
    await engine.run(job("generate"), project());
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    const revisionPrompt = storyUserPrompt(prompts[1]!);
    expect(revisionPrompt).toContain("Defects to fix");
    expect(revisionPrompt).toContain("Preservation requirements");
    expect(revisionPrompt).toContain("Preserve the story's central premise");
    expect(revisionPrompt).toContain("Preserve approved Bible facts");
  });

  it("includes Bible context in the revision prompt", async () => {
    const prompts: StoryPrompt[] = [];
    const saved: StoryRecord[] = [];
    const engine = createStoryDraftEngine(
      stub((call) => { prompts.push(call); return defectiveStory(); }) as unknown as LLMProvider,
      memoryStories(saved),
      undefined,
      canonPort(),
      { bible: { async findApproved() { return snapshot(); } } },
    );
    await engine.run(job("generate"), project());
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    const revisionPrompt = storyUserPrompt(prompts[1]!);
    expect(revisionPrompt).toContain("A coastal town bound to a lighthouse");
    expect(revisionPrompt).toContain("Guarded and determined");
  });
});

describe("Bible version provenance", () => {
  it("loads the pinned Bible version when sourceBibleVersion is set", async () => {
    const saved: StoryRecord[] = [];
    const calls: { method: string; version?: number }[] = [];
    const engine = createStoryDraftEngine(
      stub(() => faithfulStory()) as unknown as LLMProvider,
      memoryStories(saved),
      undefined,
      canonPort(),
      {
        bible: {
          async findApproved() { calls.push({ method: "findApproved" }); return snapshot(2); },
          async findApprovedVersion(_user: string, _project: string, version: number) {
            calls.push({ method: "findApprovedVersion", version });
            return snapshot(version);
          },
        },
      },
    );
    await engine.run(job("generate", 1), project());
    expect(calls.some((c) => c.method === "findApprovedVersion" && c.version === 1)).toBe(true);
    expect(saved[0]!.sourceBibleVersion).toBe(1);
  });

  it("records sourceBibleVersion on the saved draft", async () => {
    const saved: StoryRecord[] = [];
    const engine = createStoryDraftEngine(
      stub(() => faithfulStory()) as unknown as LLMProvider,
      memoryStories(saved),
      undefined,
      canonPort(),
      { bible: { async findApproved() { return snapshot(3); } } },
    );
    await engine.run(job("generate"), project());
    expect(saved[0]!.sourceBibleVersion).toBe(3);
  });

  it("rejects when pinned version is not found instead of falling back", async () => {
    const saved: StoryRecord[] = [];
    const calls: { method: string; version?: number }[] = [];
    const engine = createStoryDraftEngine(
      stub(() => faithfulStory()) as unknown as LLMProvider,
      memoryStories(saved),
      undefined,
      canonPort(),
      {
        bible: {
          async findApproved() { calls.push({ method: "findApproved" }); return snapshot(2); },
          async findApprovedVersion(_user: string, _project: string, version: number) {
            calls.push({ method: "findApprovedVersion", version });
            return null;
          },
        },
      },
    );
    await expect(engine.run(job("generate", 99), project())).rejects.toThrow(/pinned Story Bible version 99 was not found/);
    expect(calls.some((c) => c.method === "findApprovedVersion" && c.version === 99)).toBe(true);
    expect(calls.some((c) => c.method === "findApproved")).toBe(false);
    expect(saved).toHaveLength(0);
  });
});