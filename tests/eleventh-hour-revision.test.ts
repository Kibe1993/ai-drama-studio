import { describe, expect, it } from "vitest";
import { canonFromApprovedSources, validateKnowledge, validateWorldRules } from "@/lib/domain/narrativeControl";
import { describeWorldRule } from "@/lib/domain/narrativeControl/worldRules";
import { canonStateSchema } from "@/lib/validation/narrativeControl";
import { createLiveEngines } from "@/lib/pipeline/liveEngines";
import { createStoryDraftEngine } from "@/lib/pipeline/storyDraftEngine";
import { type JobRecord, type RunRecord } from "@/lib/pipeline/types";
import { storyUserPrompt } from "@/lib/providers/llm/prompt";
import type { LLMProvider, StoryPrompt } from "@/lib/providers/llm/types";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import { createPipelineService } from "@/lib/services/pipelineService";
import { createStoryDraftService } from "@/lib/services/storyDraftService";
import type { EpisodeValidation } from "@/lib/validation/casna";
import type { CanonState } from "@/lib/validation/narrativeControl";
import type { GeneratedStory, ScreenplayScene, StoryRecord, StoryStructure } from "@/lib/validation/story";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { PipelineDeps } from "@/lib/pipeline/ports";

const userId = "user_owner";
const projectId = "c".repeat(24);
const now = new Date().toISOString();

const FACTS = {
  journalist: "Amara is a journalist returning to her coastal hometown.",
  brother: "Kofi is her missing brother.",
  photograph: "An anonymous package contains Kofi's photograph.",
  call: "Kofi calls at 11:47 PM to warn Amara about the ritual.",
  resident: "Another resident disappears.",
  interval: "The town performs a sacrifice every 12 years.",
  lighthouse: "The lighthouse houses a sea-bound entity.",
  door: "Amara hears her own voice warning her not to open the door.",
  fate: "Her final fate remains uncertain.",
};

const SECRET = "The entity knows Amara's childhood name.";
const RITUAL_RULE = "The ritual involves a sacrifice every 12 years, not every year.";
const LIGHTHOUSE_RULE = "The lighthouse houses a sea-bound entity.";

function bible(): StoryBibleContent {
  const character = (name: string, role: "protagonist" | "supporting", secret = "") => ({
    name,
    storyRole: role,
    roleDescription: `${name} belongs to the coastal town.`,
    physicalDescription: "",
    personality: "Guarded.",
    background: "Raised beside the lighthouse.",
    motivations: ["Protect the town."],
    fearsAndWeaknesses: ["Opening the wrong door."],
    abilitiesAndLimitations: [],
    relationships: name === "Amara"
      ? [{ characterName: "Kofi", relationship: "brother", tensionOrChange: "He is missing and still calls." }]
      : [{ characterName: "Amara", relationship: "sister", tensionOrChange: "He warns her and remains missing." }],
    secrets: secret ? [secret] : [],
    developmentPotential: "Face the ritual without a certain ending.",
  });
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
      rules: [RITUAL_RULE, LIGHTHOUSE_RULE],
      definingSystems: [],
    },
    characters: {
      characters: [character("Amara", "protagonist", SECRET), character("Kofi", "supporting", FACTS.call)],
      relationshipDynamics: ["Amara and Kofi are sister and brother."],
    },
    narrative: {
      mainStoryline: "Amara follows Kofi's warning toward the lighthouse.",
      majorConflicts: ["Whether to open the door."],
      longTermDirection: "The town's fate stays unresolved.",
      subplots: [],
      unresolvedMysteries: ["What the entity wants."],
      potentialFutureRevelations: [SECRET],
      majorNarrativeQuestions: ["Does Amara open the door?"],
      serializedEndingGuidance: "Leave Amara's decision and the town's fate uncertain.",
    },
    guidelines: {
      mainThemes: ["Warning"],
      secondaryThemes: [],
      storytellingStyle: "Restrained thriller.",
      boundaries: ["Do not decide the town's fate."],
      mustRemainConsistent: [FACTS.interval, FACTS.fate],
    },
    canon: {
      confirmedFacts: Object.values(FACTS),
      proposedDetails: [],
      unresolvedQuestions: ["Does Amara open the door?"],
      hiddenInformation: [],
      characterKnowledge: [],
      audienceKnowledge: [],
    },
  };
}

function structure(climax = FACTS.door, outcome = FACTS.fate): StoryStructure {
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
      climax,
      resolution: "The lighthouse houses a sea-bound entity.",
      finalOutcome: outcome,
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

const FAITHFUL_ACTIONS = [
  "Amara is a journalist. Kofi is her missing brother. An anonymous package contains Kofi's photograph.",
  "Amara studies the photograph and the empty street.",
  "A resident disappears from the harbor while Amara watches the boats.",
  "Kofi calls at 11:47 PM to warn Amara about the ritual and the sacrifice.",
  "The ritual involves a sacrifice every 12 years, not every year. The lighthouse houses a sea-bound entity.",
  "Amara hears her own voice warning her not to open the door.",
  "Her final fate remains uncertain, and the town's fate remains uncertain.",
];

function faithfulStory(): GeneratedStory {
  return {
    title: "The Eleventh Hour",
    synopsis: Object.values(FACTS).join(" "),
    structure: structure(),
    screenplay: FAITHFUL_ACTIONS.map((action, index) => scene(index + 1, action, index === 3
      ? "Kofi calls at 11:47 PM to warn me about the ritual."
      : "The door stays shut.")),
  };
}

function withStory(mutator: (story: GeneratedStory) => void): GeneratedStory {
  const copy = structuredClone(faithfulStory());
  mutator(copy);
  return copy;
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

function acceptedDraft(): StoryRecord {
  const story = faithfulStory();
  return {
    ...story,
    id: "d".repeat(24),
    clerkUserId: userId,
    projectId,
    productionRunId: null,
    status: "approved",
    version: 1,
    provider: "stub",
    model: "stub",
    fallbackFrom: null,
    createdAt: now,
    updatedAt: now,
  };
}

function job(): JobRecord {
  return {
    id: "j".repeat(24),
    clerkUserId: userId,
    projectId,
    runId: null,
    sceneNumber: null,
    jobType: "story.draft",
    provider: "stub",
    model: "stub",
    input: { operation: "revise", instruction: "Tighten the dialogue without changing the canon.", creativeDirection: "" },
    output: null,
    status: "queued",
    progress: { stage: "story.draft", message: "" },
    attempts: 0,
    maxAttempts: 3,
    error: null,
    idempotencyKey: "eleventh",
    bullJobId: null,
    startedAt: null,
    completedAt: null,
  };
}

function codes(findings: { code?: string; message: string }[]): string[] {
  return findings.map((finding) => finding.code ?? finding.message);
}

describe("world rules and concealed facts", () => {
  const canon = canonFromApprovedSources({ projectId, bible: bible(), bibleVersion: 1 });

  it("rejects an annual ritual and accepts the twelve-year interval", () => {
    const annual = validateWorldRules(canon, 1, "Every year, someone disappears for the ritual.");
    expect(annual.some((finding) => finding.algorithm === "world_rules")).toBe(true);
    expect(validateWorldRules(canon, 1, "The ritual involves a sacrifice every 12 years, not every year.")).toEqual([]);
    expect(validateWorldRules(canon, 1, "Kofi disappeared twelve years ago and then calls tonight.")).toEqual([]);
  });

  it("does not conceal a fact that the audience is already allowed to hear", () => {
    expect(canon.facts.some((fact) => fact.statement === FACTS.call && fact.classification === "AUTHOR_TRUTH")).toBe(false);
    expect(canon.facts.some((fact) => fact.statement === SECRET && fact.classification === "AUTHOR_TRUTH")).toBe(true);
    expect(canon.knowledge.some((entry) => entry.certainty === "certain" && entry.knownFromEpisode === 1)).toBe(true);
    const faithful = "Amara: Kofi calls at 11:47 PM to warn me about the ritual.";
    expect(validateKnowledge(canon, 1, faithful).filter((finding) => finding.severity === "ERROR")).toEqual([]);
    const leaked = "Amara: The entity knows Amara's childhood name.";
    expect(validateKnowledge(canon, 1, leaked).some((finding) => finding.severity === "ERROR")).toBe(true);
    expect(validateKnowledge(canon, 1, "Amara: I will not say what the entity knows.").filter((finding) => finding.severity === "ERROR")).toEqual([]);
  });

  it("rejects a yearly disappearance against a thirteen-year taking", () => {
    const description = "The house takes one resident every thirteen years.";
    const state = canonStateSchema.parse({
      projectId,
      version: 0,
      rules: [{
        id: "house-rule",
        description,
        canonicalInterval: describeWorldRule(description).canonicalInterval,
        approvalStatus: "approved",
      }],
    });
    expect(validateWorldRules(state, 1, "Every year, someone in Greyhaven disappears.").some((finding) => finding.algorithm === "world_rules")).toBe(true);
    expect(validateWorldRules(state, 1, "The ferry arrives every year.")).toEqual([]);
  });
});

describe("story revise workflow", () => {
  const cases: { name: string; story: GeneratedStory; code: string }[] = [
    {
      name: "annual ritual",
      code: "world_rules",
      story: withStory((story) => {
        story.synopsis = story.synopsis.replace("every 12 years", "every year");
        story.screenplay[4]!.action = "The ritual takes a sacrifice every year.";
      }),
    },
    {
      name: "anonymous caller",
      code: "agreement",
      story: withStory((story) => {
        story.screenplay[3]!.action = "An unrelated anonymous person calls Amara at 11:47 PM.";
        story.screenplay[3]!.dialogue = [{ characterName: "Amara", line: "An unrelated anonymous person calls me at 11:47 PM." }];
      }),
    },
    {
      name: "kofi gone twelve years",
      code: "agreement",
      story: withStory((story) => {
        story.screenplay[3]!.action = "Kofi disappeared twelve years ago and has no present role.";
        story.screenplay[3]!.dialogue = [{ characterName: "Amara", line: "Kofi disappeared twelve years ago." }];
      }),
    },
    {
      name: "disappearance only in the synopsis",
      code: "agreement",
      story: withStory((story) => {
        story.screenplay[2]!.action = "Amara walks the harbor and talks about the weather.";
      }),
    },
    {
      name: "five scenes",
      code: "scene_count",
      story: withStory((story) => {
        story.screenplay = story.screenplay.slice(0, 5).map((item, index) => ({ ...item, sceneNumber: index + 1 }));
        story.screenplay[4]!.action += ` ${FACTS.door} ${FACTS.fate} A resident disappears.`;
      }),
    },
    {
      name: "kofi disconnected from the sacrifice",
      code: "agreement",
      story: withStory((story) => {
        story.screenplay[3]!.action = "A recorded warning mentions the sacrifice and the ritual.";
        story.screenplay[3]!.dialogue = [{ characterName: "Amara", line: "The ritual will take a sacrifice." }];
        story.screenplay[0]!.action = "Amara is a journalist. Kofi is her missing brother. An anonymous package contains Kofi's photograph.";
      }),
    },
    {
      name: "climax without the stake",
      code: "agreement",
      story: withStory((story) => {
        story.structure.act3.climax = "Amara walks home.";
        story.structure.act3.finalOutcome = "The evening ends quietly.";
        story.screenplay[5]!.action = "Amara locks the kitchen and washes a cup.";
        story.screenplay[6]!.action = "The town goes to sleep.";
      }),
    },
    {
      name: "kofi is not her brother",
      code: "agreement",
      story: withStory((story) => {
        story.screenplay[0]!.action = "Amara is a journalist. Kofi is not her brother. An anonymous package contains Kofi's photograph.";
      }),
    },
    {
      name: "premature secret",
      code: "implication",
      story: withStory((story) => {
        story.screenplay[1]!.dialogue = [{ characterName: "Amara", line: "The entity knows Amara's childhood name." }];
      }),
    },
    {
      name: "lighthouse rule denied",
      code: "world_rules",
      story: withStory((story) => {
        story.screenplay[4]!.action = "The lighthouse does not contain the entity. The ritual involves a sacrifice every 12 years.";
      }),
    },
  ];

  it.each(cases)("saves candidate with $name findings for creator review", async ({ story, code }) => {
    const saved: StoryRecord[] = [acceptedDraft()];
    const commits: CanonState[] = [];
    const prompts: StoryPrompt[] = [];
    const port = canonPort(commits);
    const engine = createStoryDraftEngine(stub((call) => {
      prompts.push(call);
      return story;
    }) as unknown as LLMProvider, memoryStories(saved), undefined, port, { bible: { async findApproved() { return snapshot(); } } });

    const result = await engine.run(job(), project());
    expect(result.storyId).toBeTruthy();
    expect(result.validationPassed).toBe(false);
    expect(saved).toHaveLength(2);
    expect(saved[1]!.status).toBe("awaiting_approval");
    const findings = saved[1]!.validationFindings?.findings ?? [];
    expect(findings.some((finding) => finding.severity === "error" && (finding.code === code || finding.message.length > 0))).toBe(true);
    expect(codes(findings)).toContain(code);
    expect(findings.some((finding) => finding.evidence || finding.message)).toBe(true);
    expect(commits).toEqual([]);
  });

  it("includes the screenplay and canonical constraints in the revise prompt", async () => {
    const prompts: StoryPrompt[] = [];
    const engine = createStoryDraftEngine(stub((call) => {
      prompts.push(call);
      return faithfulStory();
    }) as unknown as LLMProvider, memoryStories([acceptedDraft()]), undefined, canonPort([]), {
      bible: { async findApproved() { return snapshot(); } },
    });
    await engine.run(job(), project());
    const rendered = storyUserPrompt(prompts[0]!);
    expect(rendered).toContain("An anonymous package contains Kofi's photograph");
    expect(rendered).toContain("every 12 years");
    expect(rendered).toContain("Do not change");
    expect(rendered).toContain("Write 6–8");
    expect(rendered).toContain(SECRET);
    expect(rendered.indexOf("NARRATIVE AUTHORITY")).toBeGreaterThan(-1);
  });

  it("saves a faithful revision and commits canon only when it is approved", async () => {
    const saved: StoryRecord[] = [acceptedDraft()];
    const commits: CanonState[] = [];
    const engine = createStoryDraftEngine(stub(() => faithfulStory()) as unknown as LLMProvider, memoryStories(saved), undefined, canonPort(commits), {
      bible: { async findApproved() { return snapshot(); } },
    });
    const result = await engine.run(job(), project());
    expect(result.validationPassed).toBe(true);
    expect(saved).toHaveLength(2);
    expect(saved[1]!.status).toBe("awaiting_approval");
    expect(saved[1]!.storyContract?.status).toBe("provisional");
    expect(saved[1]!.storyContract?.layers.semantic).toBe("not_executed");
    expect(saved[1]!.storyContract?.layers.agreement).toBe("passed");
    expect(commits).toEqual([]);

    const service = createStoryDraftService({
      projects: {
        async findOwned() { return project(); },
        async update(_userId: string, _id: string, patch: Partial<ProjectRecord>) { return { ...project(), ...patch }; },
      },
      stories: {
        async findOwned() { return saved[1]!; },
        async findProjectDraft() { return saved[1]!; },
        async markApproved() { return { ...saved[1]!, status: "approved" as const }; },
      },
      jobs: { async listByKeyPrefix() { return []; } },
      queueFactory: () => ({ async enqueue() {} }),
      bibles: { async findApproved() { return snapshot(); } },
      narrativeCanon: canonPort(commits),
    } as never);
    const approved = await service.approve({ userId, isAdmin: false, email: "", name: "", imageUrl: "" }, projectId, saved[1]!.id);
    expect(approved.status).toBe("approved");
    expect(commits).toHaveLength(1);
  });

  it("refuses approval of a draft that contradicts canon", async () => {
    const bad = { ...acceptedDraft(), id: "e".repeat(24), status: "awaiting_approval" as const, ...withStory((story) => {
      story.screenplay[4]!.action = "The ritual takes a sacrifice every year.";
    }) };
    const commits: CanonState[] = [];
    const service = createStoryDraftService({
      projects: { async findOwned() { return project(); }, async update() { return project(); } },
      stories: {
        async findOwned() { return bad; },
        async markApproved() { return { ...bad, status: "approved" as const }; },
      },
      jobs: { async listByKeyPrefix() { return []; } },
      queueFactory: () => ({ async enqueue() {} }),
      bibles: { async findApproved() { return snapshot(); } },
      narrativeCanon: canonPort(commits),
    } as never);
    await expect(service.approve({ userId, isAdmin: false, email: "", name: "", imageUrl: "" }, projectId, bad.id))
      .rejects.toMatchObject({ code: "story_invalid" });
    expect(commits).toEqual([]);
  });
});

describe("manual save and episode generation", () => {
  it("rejects an annual manual save and keeps the previous screenplay", async () => {
    const story = episodeStory(faithfulStory());
    story.validationFindings = { passed: true, findings: [], validatedAt: now };
    const annual = story.screenplay.map((scene, index) =>
      index === 4 ? { ...scene, action: "The ritual takes a sacrifice every year." } : scene,
    );
    const commits: CanonState[] = [];
    const harness = pipelineHarness(story, commits);
    const service = createPipelineService(harness.deps);
    await expect(service.updateStory(
      { userId, isAdmin: false, email: "", name: "", imageUrl: "" },
      projectId,
      story.id,
      { screenplay: annual, synopsis: story.synopsis },
    )).rejects.toMatchObject({
      code: "story_invalid",
      status: 409,
      message: expect.stringContaining("every 12 years"),
    });
    expect(harness.writes()).toBe(0);
    expect(harness.current().screenplay[4]?.action).toBe(story.screenplay[4]?.action);
    expect(commits).toEqual([]);
  });

  it("rejects an annual episode generation without committing canon", async () => {
    const commits: CanonState[] = [];
    const saved: { validationFindings?: EpisodeValidation | null }[] = [];
    const engines = createLiveEngines({
      llm: stub(() => withStory((draft) => {
        draft.screenplay[4]!.action = "The ritual takes a sacrifice every year.";
      })) as never,
      stories: {
        async upsertAwaiting(input: { validationFindings?: EpisodeValidation | null }) {
          saved.push(input);
          return { id: "f".repeat(24), title: "The Eleventh Hour", synopsis: "synopsis" };
        },
        async findForRun() { return null; },
      },
      projects: { async findOwned() { return project(); }, async update() { return project(); } },
      storyBible: { async findApproved() { return snapshot(); } },
      narrativeCanon: canonPort(commits),
      casna: { async load() { return { gate: { allowed: true, code: "ok", reason: null }, plan: null, latestPlan: null, ledger: null, episodePlan: null, episodePlanValidation: null, previousEpisodes: [], previousEpisode: null }; } },
    });
    const failure = await engines.run(episodeJob(), episodeRun()).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      code: "screenplay_conflict",
      retryable: false,
      details: { canonCommitted: false, artifactsStale: false },
    });
    expect(saved).toHaveLength(0);
    const findings = (failure as { details?: { findings?: { code?: string; message: string }[] } }).details?.findings ?? [];
    expect(codes(findings)).toContain("world_rules");
    expect(commits).toEqual([]);
  });

  it("accepts a faithful episode generation without committing canon", async () => {
    const commits: CanonState[] = [];
    const engines = createLiveEngines({
      llm: stub(() => faithfulStory()) as never,
      stories: {
        async upsertAwaiting() { return { id: "f".repeat(24), title: "The Eleventh Hour", synopsis: "synopsis" }; },
        async findForRun() { return null; },
      },
      projects: { async findOwned() { return project(); }, async update() { return project(); } },
      storyBible: { async findApproved() { return snapshot(); } },
      narrativeCanon: canonPort(commits),
      casna: { async load() { return { gate: { allowed: true, code: "ok", reason: null }, plan: null, latestPlan: null, ledger: null, episodePlan: null, episodePlanValidation: null, previousEpisodes: [], previousEpisode: null }; } },
    });
    const result = await engines.run(episodeJob(), episodeRun());
    expect(result.storyId).toBe("f".repeat(24));
    expect(commits).toEqual([]);
  });
});

function snapshot() {
  return {
    ...{
      premise: "",
      worldRules: [],
      themes: [],
      boundaries: [],
      canonFacts: [],
    },
    version: 1,
    createdAt: now,
    content: bible(),
  };
}

function canonPort(commits: CanonState[]) {
  let current: CanonState | null = null;
  return {
    async latest() { return current; },
    async commit(input: { expectedVersion: number; state: CanonState }) {
      current = { ...input.state, version: input.expectedVersion + 1 };
      commits.push(current);
      return current;
    },
  };
}

function memoryStories(saved: StoryRecord[]) {
  return {
    async findProjectDraft() {
      return [...saved].reverse().find((draft) => draft.status !== "failed") ?? null;
    },
    async upsertProjectDraft(input: GeneratedStory & { validationFindings?: EpisodeValidation | null; sourceCanonVersion?: number | null; promptFingerprint?: string | null; storyContract?: StoryRecord["storyContract"] }) {
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

function episodeStory(story: GeneratedStory & { validationFindings?: EpisodeValidation | null }): StoryRecord {
  return {
    ...faithfulStory(),
    ...story,
    id: "f".repeat(24),
    clerkUserId: userId,
    projectId,
    productionRunId: "b".repeat(24),
    status: "awaiting_approval",
    version: 1,
    provider: "stub",
    model: "stub",
    fallbackFrom: null,
    createdAt: now,
    updatedAt: now,
  };
}

function pipelineHarness(story: StoryRecord, commits: CanonState[]): {
  deps: PipelineDeps;
  writes: () => number;
  current: () => StoryRecord;
} {
  let current = story;
  let writes = 0;
  const run = episodeRun();
  const deps = {
    projects: { async findOwned() { return { ...project(), status: "planning" }; }, async update() { return project(); } },
    runs: {
      async findLatest() { return run; },
      async findOwned() { return run; },
      async insert(input: RunRecord) { return { ...run, ...input, id: run.id }; },
      async save(value: RunRecord) { return value; },
    },
    jobs: {
      async listForRun() { return []; },
      async insert(input: JobRecord) { return { ...job(), ...input, id: "j".repeat(24) }; },
      async findOwned() { return null; },
      async save(value: JobRecord) { return value; },
    },
    stories: {
      async findOwned() { return current; },
      async findForRun() { return current; },
      async markApproved() { return { ...current, status: "approved" as const }; },
      async updateScreenplay(_user: string, _id: string, input: { title?: string; synopsis?: string; screenplay: ScreenplayScene[]; validationFindings: EpisodeValidation | null }) {
        writes += 1;
        current = { ...current, ...input, updatedAt: now };
        return current;
      },
    },
    queue: { async enqueue() {} },
    engines: { async run() { return {}; }, failNext() {} },
    bibles: {
      async findOwned() { return { approvedVersion: 1 }; },
      async findApproved() { return snapshot(); },
    },
    narrativeCanon: canonPort(commits),
  } as unknown as PipelineDeps;
  return { deps, writes: () => writes, current: () => current };
}

function episodeJob(): JobRecord {
  return { ...job(), jobType: "story.generate", runId: "b".repeat(24), input: {} };
}

function houseStory(): GeneratedStory {
  const description = "Dust motes dance in shafts of early light through the abandoned Greyhaven house, and a single framed photograph hangs crooked on the wall.";
  const scene = (sceneNumber: number, heading: string, location: string, dialogue: { characterName: string; line: string }[]): ScreenplayScene => ({
    sceneNumber,
    heading,
    location,
    timeOfDay: "Night",
    charactersPresent: dialogue.map((line) => line.characterName),
    visualDescription: description,
    action: description,
    dialogue,
  });
  return {
    title: "The House That Remembers",
    synopsis: "When architect Daniel Mwangi inherits an abandoned house in Greyhaven, the house erases a town resident every thirteen years. He must decide whether to sacrifice the truth to save his family or let the house consume him.",
    structure: {
      act1: {
        introduction: "Daniel arrives in Greyhaven.",
        mainCharacters: "Daniel Mwangi, Miriam, and Ruth.",
        setting: "An abandoned house in Greyhaven.",
        initialSituation: "Daniel moves into the inherited house.",
        incitingIncident: "He finds a photograph of Ruth, who never lived in Greyhaven.",
      },
      act2: {
        risingTension: "An old ledger hints that someone disappears every thirteen years.",
        obstacles: "Daniel's father's warnings echo through the walls.",
        characterDecisions: "Daniel follows the ledger despite Miriam's fear.",
        turningPoint: "They discover a town map with a red X marking the house's next victim.",
      },
      act3: {
        climax: "The house reveals a hidden compartment with a rusted key.",
        resolution: "Daniel uses the key to unlock the compartment and triggers the countdown.",
        finalOutcome: "The door opens on the next victim, and Daniel's fate stays uncertain.",
      },
    },
    screenplay: [
      scene(1, "INT. GREAWHAVEN FAMILY HOUSE - LIVING ROOM - DAWN", "Greyhaven Family House", [
        { characterName: "Daniel", line: "Ruth? She never came to Greyhaven." },
        { characterName: "Miriam", line: "It's a house, Daniel. Not a museum." },
      ]),
      scene(2, "INT. GREAWHAVEN FAMILY HOUSE - STUDY - AFTERNOON", "Greyhaven Family House", [
        { characterName: "Miriam", line: "Every thirteen years it takes one of us." },
      ]),
      scene(3, "EXT. GREAWHAVEN FAMILY HOUSE - FRONT YARD - SUNSET", "Greyhaven Family House", [
        { characterName: "Daniel", line: "This key was in my father's desk." },
      ]),
      scene(4, "INT. GREAWHAVEN FAMILY HOUSE - BASEMENT - MIDNIGHT", "Greyhaven Family House", [
        { characterName: "Daniel", line: "Here goes nothing." },
      ]),
      scene(5, "INT. GREAWHAVEN FAMILY HOUSE - SECRET CHAMBER - MIDNIGHT", "Greyhaven Family House", [
        { characterName: "Daniel", line: "Ruth, I'm sorry." },
      ]),
      scene(6, "EXT. GREAWHAVEN FAMILY HOUSE - FRONT YARD - DAWN", "Greyhaven Family House", [
        { characterName: "Daniel", line: "Not again." },
      ]),
    ],
  };
}

describe("story draft requires a Story Bible", () => {
  it("saves a screenplay with validation findings even when acts are not played", async () => {
    const saved: StoryRecord[] = [];
    const commits: CanonState[] = [];
    const engine = createStoryDraftEngine(
      stub(() => houseStory()) as unknown as LLMProvider,
      memoryStories(saved),
      undefined,
      canonPort(commits),
      { bible: { async findApproved() { return snapshot(); } } },
    );
    const result = await engine.run(job(), project());
    expect(result.storyId).toBeTruthy();
    expect(result.validationPassed).toBe(false);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.status).toBe("awaiting_approval");
    const findings = saved[0]!.validationFindings?.findings ?? [];
    expect(codes(findings)).toEqual(
      expect.arrayContaining(["draft_agreement", "draft_mechanism", "draft_choice", "draft_causality", "scene_action", "place_name"]),
    );
    expect(commits).toEqual([]);
  });

  it("saves a consistent draft with an approved Story Bible", async () => {
    const saved: StoryRecord[] = [];
    const engine = createStoryDraftEngine(
      stub(() => faithfulStory()) as unknown as LLMProvider,
      memoryStories(saved),
      undefined,
      canonPort([]),
      { bible: { async findApproved() { return snapshot(); } } },
    );
    const result = await engine.run(job(), project());
    expect(result.storyId).toBeTruthy();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.validationFindings?.passed).toBe(true);
  });

  it("refuses to generate when no Story Bible exists", async () => {
    const saved: StoryRecord[] = [];
    const engine = createStoryDraftEngine(
      stub(() => faithfulStory()) as unknown as LLMProvider,
      memoryStories(saved),
      undefined,
      canonPort([]),
      { bible: { async findApproved() { return null; } } },
    );
    await expect(engine.run(job(), project())).rejects.toMatchObject({ code: "bible_required" });
    expect(saved).toHaveLength(0);
  });

  it("refuses to approve the same draft when no Story Bible exists", async () => {
    const story = houseStory();
    let approved = false;
    const service = createStoryDraftService({
      projects: { async findOwned() { return project(); }, async update() { return project(); } },
      stories: {
        async findOwned() {
          return {
            ...story,
            id: "d".repeat(24),
            clerkUserId: userId,
            projectId,
            productionRunId: null,
            status: "awaiting_approval" as const,
            version: 1,
            provider: "stub",
            model: "stub",
            fallbackFrom: null,
            createdAt: now,
            updatedAt: now,
          };
        },
        async markApproved() {
          approved = true;
          return null;
        },
      },
      jobs: { async listByKeyPrefix() { return []; } },
      queueFactory: () => ({ async enqueue() {} }),
      bibles: { async findApproved() { return null; } },
      narrativeCanon: canonPort([]),
    } as never);
    await expect(service.approve({ userId, isAdmin: false, email: "", name: "", imageUrl: "" }, projectId, "d".repeat(24)))
      .rejects.toMatchObject({ code: "bible_required", status: 409 });
    expect(approved).toBe(false);
  });
});

function episodeRun(): RunRecord {
  return {
    id: "b".repeat(24),
    clerkUserId: userId,
    projectId,
    episode: {
      id: "a".repeat(24),
      number: 1,
      title: "The Eleventh Hour",
      premise: "Amara returns.",
      targetDurationSeconds: 300,
      baseSnapshotVersion: 1,
    },
    workflowMode: "guided",
    currentStage: "story",
    status: "waiting_for_approval",
    stageResults: { story: { title: "The Eleventh Hour", synopsis: "Amara returns.", approved: false, storyId: "f".repeat(24) } },
    retryCheckpoint: null,
    startedAt: now,
    completedAt: null,
  };
}
