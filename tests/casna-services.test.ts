import { describe, expect, it } from "vitest";
import type { RequestAuth } from "@/lib/auth/session";
import { createSeasonPlanEngine, mergeTargetedRevision } from "@/lib/pipeline/seasonPlanEngine";
import { createSeasonPlanService } from "@/lib/services/seasonPlanService";
import { createLiveEngines } from "@/lib/pipeline/liveEngines";
import { createCasnaContext } from "@/lib/pipeline/casnaContext";
import { createContinuityService } from "@/lib/services/continuityService";
import { JobError, type JobRecord, type RunRecord } from "@/lib/pipeline/types";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { StoryRecord } from "@/lib/validation/story";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { SeasonPlan, SeasonPlanRecord } from "@/lib/validation/seasonPlan";
import type { ContinuityLedgerRecord } from "@/lib/validation/continuityLedger";
import type { EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { ScreenplayScene } from "@/lib/validation/story";
import { createEpisodeService } from "@/lib/services/episodeService";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const owner: RequestAuth = {
  userId: "user_owner",
  isAdmin: false,
  email: "owner@example.com",
  name: "Owner",
  imageUrl: "",
};
const projectId = "a".repeat(24);
const now = new Date().toISOString();

function episodeItem(episodeNumber: number, overrides: Partial<EpisodePlanItem> = {}): EpisodePlanItem {
  return {
    episodeNumber,
    workingTitle: `Episode ${episodeNumber}`,
    narrativePurpose: `Purpose of episode ${episodeNumber}.`,
    startingSituation: `The situation at the start of episode ${episodeNumber}.`,
    mainObjective: `Achieve the objective of episode ${episodeNumber}.`,
    centralConflict: `The conflict of episode ${episodeNumber}.`,
    majorStoryBeats: [`Beat one of episode ${episodeNumber}.`],
    informationRevealed: [`A fact revealed in episode ${episodeNumber}.`],
    characterDevelopment: `Ada changes in episode ${episodeNumber}.`,
    importantEvents: [`An important event in episode ${episodeNumber}.`],
    consequences: [`A consequence of episode ${episodeNumber}.`],
    storyContribution: `Episode ${episodeNumber} advances the season.`,
    endingOrCliffhanger: `Episode ${episodeNumber} ends on a turn.`,
    unresolvedThreads: [`A thread opened in episode ${episodeNumber}.`],
    continuityRequirements: `The next episode must respect episode ${episodeNumber}.`,
    characterArcChanges: [],
    relationshipChanges: [],
    objectChanges: [],
    locationChanges: [],
    ...overrides,
  };
}

function planContent(): SeasonPlan {
  return {
    seasonObjective: "Ada reclaims the family house without destroying her brother.",
    centralConflictOrMystery: "Who hid the deed, and what will Ada give up to learn it?",
    mainCharacterObjectives: "Ada wants the truth; Elias wants to keep the peace.",
    overallCharacterDevelopment: "Ada learns that winning the house can lose her family.",
    majorStoryDevelopments: ["The deed surfaces.", "Elias admits his part."],
    beginningDirection: "Ada returns and finds the house changed.",
    middleDirection: "Allies split as the search for the deed escalates.",
    endingDirection: "Ada chooses between the house and her brother.",
    episodeProgression: [episodeItem(1), episodeItem(2), episodeItem(3)],
    importantRevelations: ["Elias signed the deed."],
    relationshipChanges: ["Ada and Elias move from allies to rivals."],
    consequencesCarriedBetween: ["Elias is exposed."],
    setupAndPayoff: ["The locked drawer in episode 1 pays off in episode 3."],
    unresolvedQuestions: ["Where is the second copy?"],
    intendedSeasonConclusion: "Ada keeps the house and offers Elias a place in it.",
  };
}

function planRecord(overrides: Partial<SeasonPlanRecord> = {}): SeasonPlanRecord {
  return {
    ...planContent(),
    id: "a1b2c3d4e5f6a7b8c9d0e1f2",
    clerkUserId: owner.userId,
    projectId,
    basedOnBibleVersion: 1,
    basedOnBibleFingerprint: "f".repeat(20),
    version: 1,
    status: "awaiting_approval",
    provider: "fake",
    model: "fake-model",
    fallbackFrom: null,
    validationFindings: { passed: true, findings: [], validatedAt: now },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function bibleContent(names = ["Ada", "Elias"]): StoryBibleContent {
  return {
    identity: {
      title: "The house",
      genres: ["drama"],
      subgenres: [],
      centralPremise: "A family fights over a house.",
      narrativeConcept: "A locked drawer holds the truth.",
      toneAndAtmosphere: "Cold and intimate.",
      targetAudience: "Adults",
      centralConflict: "Ada versus Elias.",
    },
    world: {
      description: "A coastal town.",
      geographyAndLocations: [
        { name: "The house", description: "A family house.", storyFunction: "The prize." },
        { name: "The town", description: "A quiet town.", storyFunction: "Pressure." },
      ],
      socialStructuresAndCultures: [],
      historyAndPastEvents: [],
      rules: [],
      definingSystems: [],
    },
    characters: {
      characters: names.map((name) => ({
        name,
        storyRole: name === "Ada" ? "protagonist" : "supporting",
        roleDescription: "A member of the family.",
        physicalDescription: "",
        personality: "Guarded.",
        background: "Raised in the house.",
        motivations: ["Keep the family together."],
        fearsAndWeaknesses: ["Losing the house."],
        abilitiesAndLimitations: [],
        relationships: [],
        secrets: [],
        developmentPotential: "Learn to accept change.",
      })),
      relationshipDynamics: ["Ada and Elias are siblings."],
    },
    narrative: {
      mainStoryline: "Ada returns to claim the house.",
      majorConflicts: ["The deed."],
      longTermDirection: "The siblings reconcile or separate.",
      subplots: [],
      unresolvedMysteries: ["Who hid the deed?"],
      potentialFutureRevelations: ["Elias signed it."],
      majorNarrativeQuestions: ["Who owns the house?"],
      serializedEndingGuidance: "End with a choice, not a verdict.",
    },
    guidelines: {
      mainThemes: ["Inheritance"],
      secondaryThemes: [],
      storytellingStyle: "Grounded realism.",
      boundaries: [],
      mustRemainConsistent: ["The house is never sold."],
    },
    canon: {
      confirmedFacts: ["The house is never sold."],
      proposedDetails: [],
      unresolvedQuestions: ["Where is the second copy?"],
      hiddenInformation: [],
      characterKnowledge: [],
      audienceKnowledge: [],
    },
  };
}

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: projectId,
    title: "The house",
    originalStoryIdea: "A family fights over a house.",
    genre: "family",
    language: "en",
    visualStyle: "realistic",
    tone: "cold",
    targetDurationSeconds: 300,
    aspectRatio: "16:9",
    status: "draft",
    workflowMode: "guided",
    productionType: "fictional_drama",
    productionMode: "serialized",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function storyRecord(overrides: Partial<StoryRecord> = {}): StoryRecord {
  return {
    id: "s".repeat(24),
    clerkUserId: owner.userId,
    projectId,
    productionRunId: "r".repeat(24),
    episodeId: "e".repeat(24),
    title: "The deed",
    synopsis: "Ada finds the deed and confronts Elias.",
    structure: {
      act1: {
        introduction: "Ada returns.",
        mainCharacters: "Ada and Elias.",
        setting: "The family house.",
        initialSituation: "The house has been sold.",
        incitingIncident: "Ada finds a torn deed.",
      },
      act2: {
        risingTension: "Elias avoids the truth.",
        obstacles: "The lawyer is missing.",
        characterDecisions: "Ada searches the study.",
        turningPoint: "She finds the signature.",
      },
      act3: {
        climax: "Ada confronts Elias.",
        resolution: "Elias admits he signed.",
        finalOutcome: "They agree to talk.",
      },
    },
    screenplay: screenplay(5),
    status: "awaiting_approval",
    version: 1,
    provider: "fake",
    model: "fake-model",
    fallbackFrom: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function screenplay(count: number): ScreenplayScene[] {
  return Array.from({ length: count }, (_, index) => ({
    sceneNumber: index + 1,
    heading: `INT. HOUSE ${index + 1} - NIGHT`,
    location: "House",
    timeOfDay: "Night",
    charactersPresent: ["Ada"],
    visualDescription: `The camera holds the house, room ${index + 1}.`,
    action: `Ada searches the study for a hidden deed, room ${index + 1}.`,
    dialogue: [{ characterName: "Ada", line: `Something new happens in room ${index + 1}.` }],
  }));
}

function stubJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "j".repeat(24),
    clerkUserId: owner.userId,
    projectId,
    runId: null,
    sceneNumber: null,
    jobType: "seasonPlan.generate",
    provider: "fake",
    model: "fake-model",
    input: { operation: "generate", instruction: "" },
    output: null,
    status: "queued",
    progress: { stage: "seasonPlan.generate", message: "" },
    attempts: 0,
    maxAttempts: 3,
    error: null,
    idempotencyKey: "key",
    bullJobId: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "r".repeat(24),
    clerkUserId: owner.userId,
    projectId,
    episode: {
      id: "e".repeat(24),
      number: 2,
      title: "The deed",
      premise: "Ada finds the deed.",
      targetDurationSeconds: 300,
      baseSnapshotVersion: 1,
    },
    workflowMode: "guided",
    currentStage: "story",
    status: "running",
    stageResults: {},
    retryCheckpoint: null,
    startedAt: now,
    completedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stage B: season plan generation
// ---------------------------------------------------------------------------

function engineHarness(options: { fail?: boolean } = {}) {
  const rows: SeasonPlanRecord[] = [];
  const findings: { planId: string; passed: boolean }[] = [];
  const jobs: JobRecord[] = [];
  const plans = {
    async insert(input: Record<string, unknown>) {
      const record = planRecord({
        ...(input as Partial<SeasonPlanRecord>),
        id: `plan-${rows.length + 1}`,
        version: rows.length + 1,
        status: "awaiting_approval",
        validationFindings: null,
      });
      rows.push(record);
      return record;
    },
    async findLatest() {
      return rows[rows.length - 1] ?? null;
    },
    async saveValidationFindings(_userId: string, planId: string, value: { passed: boolean }) {
      const row = rows.find((entry) => entry.id === planId) ?? null;
      findings.push({ planId, passed: value.passed });
      if (row) row.validationFindings = value as SeasonPlanRecord["validationFindings"];
      return row;
    },
  };
  const bibles = {
    async findOwned() {
      return {
        approvedVersion: 1,
        approvedSnapshot: { version: 1, content: bibleContent(), createdAt: now },
        creativeDirection: "",
      } as never;
    },
  };
  const stories = {
    async findProjectDraft() {
      return storyRecord({ status: "approved", productionRunId: null, episodeId: null }) as never;
    },
  };
  const episodes = { async listOwned() { return []; } };
  const ledgers = { async findLatest() { return null; } };
  const llm = {
    id: "fake",
    model: "fake-model",
    async generateSeasonPlan() {
      if (options.fail) throw new JobError("Provider failed.", "provider_failed", true);
      return { plan: planContent(), provider: "fake", model: "fake-model", fallbackFrom: null };
    },
  } as never;
  const engine = createSeasonPlanEngine(llm, plans as never, bibles as never, stories as never, undefined, episodes as never, ledgers as never);
  return { engine, rows, findings, jobs };
}

describe("season plan generation (Stage B)", () => {
  it("persists a validated plan from the approved foundation", async () => {
    const { engine, rows, findings } = engineHarness();
    const output = await engine.run(stubJob(), project());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version: 1,
      status: "awaiting_approval",
      basedOnBibleVersion: 1,
      provider: "fake",
    });
    expect(output).toMatchObject({ version: 1, passed: true });
    expect(findings).toHaveLength(1);
  });

  it("refuses to plan from an unapproved Story Bible", async () => {
    const plans = {
      async insert() { throw new Error("should not save"); },
      async findLatest() { return null; },
      async saveValidationFindings() { return null; },
    };
    const engine = createSeasonPlanEngine(
      { id: "fake", model: "m" } as never,
      plans as never,
      { async findOwned() { return { approvedVersion: 0, approvedSnapshot: null } as never; } },
      { async findProjectDraft() { return null; } },
      undefined,
      { async listOwned() { return []; } } as never,
      { async findLatest() { return null; } } as never
    );
    await expect(engine.run(stubJob(), project())).rejects.toMatchObject({ code: "bible_required" });
  });

  it("does not save a plan when generation fails, and can retry", async () => {
    const failing = engineHarness({ fail: true });
    await expect(failing.engine.run(stubJob(), project())).rejects.toMatchObject({ code: "provider_failed" });
    expect(failing.rows).toHaveLength(0);

    const retry = engineHarness();
    const output = await retry.engine.run(stubJob({ attempts: 1 }), project());
    expect(output).toMatchObject({ version: 1 });
    expect(retry.rows).toHaveLength(1);
  });

  it("replaces only the targeted episode when regenerating a section", () => {
    const previous = planRecord();
    const generated: SeasonPlan = {
      ...planContent(),
      seasonObjective: "A different season objective the model invented.",
      episodeProgression: [
        episodeItem(1, { workingTitle: "Rewritten one" }),
        episodeItem(2, { workingTitle: "Regenerated two" }),
        episodeItem(3, { workingTitle: "Rewritten three" }),
      ],
    };
    const merged = mergeTargetedRevision(previous, generated, 2);
    expect(merged.seasonObjective).toBe(previous.seasonObjective);
    expect(merged.episodeProgression.map((item) => item.workingTitle)).toEqual([
      "Episode 1",
      "Regenerated two",
      "Episode 3",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Stage D: approval, editing, duplicate prevention, concurrency
// ---------------------------------------------------------------------------

function serviceHarness(seed: SeasonPlanRecord | null = planRecord(), overrides: {
  bibleApprovedVersion?: number;
  storyStatus?: string;
  openJob?: JobRecord | null;
} = {}) {
  const plans: SeasonPlanRecord[] = seed ? [seed] : [];
  const jobs: JobRecord[] = overrides.openJob ? [overrides.openJob] : [];
  let insertCalls = 0;
  const deps = {
    projects: { async findOwned() { return project(); } },
    bibles: {
      async findOwned() {
        return {
          approvedVersion: overrides.bibleApprovedVersion ?? 1,
          approvedSnapshot: { version: 1, content: bibleContent(), createdAt: now },
          creativeDirection: "",
        } as never;
      },
    },
    stories: {
      async findProjectDraft() {
        return storyRecord({
          status: (overrides.storyStatus ?? "approved") as StoryRecord["status"],
          productionRunId: null,
          episodeId: null,
        });
      },
    },
    plans: {
      async findLatest() { return plans[plans.length - 1] ?? null; },
      async findApproved() {
        return [...plans].reverse().find((plan) => plan.status === "approved") ?? null;
      },
      async markApproved(_userId: string, planId: string) {
        const row = plans.find((plan) => plan.id === planId);
        if (!row) return null;
        // Mirrors the atomic conditional update in the repository.
        if (row.status !== "awaiting_approval") return row;
        row.status = "approved";
        return row;
      },
      async insert(input: Partial<SeasonPlanRecord>) {
        insertCalls += 1;
        const record = planRecord({
          ...input,
          id: `plan-${plans.length + 1}`,
          version: plans.length + 1,
          status: "awaiting_approval",
          validationFindings: null,
        });
        plans.push(record);
        return record;
      },
      async saveValidationFindings(_userId: string, planId: string, value: SeasonPlanRecord["validationFindings"]) {
        const row = plans.find((plan) => plan.id === planId) ?? null;
        if (row) row.validationFindings = value;
        return row;
      },
    },
    ledgers: { async findLatest() { return null; } },
    episodes: { async listOwned() { return []; } },
    jobs: {
      async listByKeyPrefix() { return jobs; },
      async insert(data: Omit<JobRecord, "id">) {
        // Mirrors the unique idempotency index: a losing race throws.
        if (jobs.some((job) => job.idempotencyKey === data.idempotencyKey)) {
          const error = new Error("E11000 duplicate key error");
          error.name = "MongoServerError";
          throw error;
        }
        const job = { ...data, id: `job-${jobs.length + 1}` } as JobRecord;
        jobs.push(job);
        return job;
      },
      async save(job: JobRecord) { return job; },
    },
    queueFactory: () => ({ async enqueue() {} }),
  };
  const service = createSeasonPlanService(deps as never);
  return { service, plans, jobs, insertCalls: () => insertCalls };
}

describe("season plan approval (Stage D)", () => {
  it("approves a valid plan", async () => {
    const { service, plans } = serviceHarness();
    const approved = await service.approve(owner, projectId, plans[0]!.id);
    expect(approved.status).toBe("approved");
  });

  it("refuses to approve a plan with validation errors", async () => {
    const harness = serviceHarness(
      planRecord({
        validationFindings: {
          passed: false,
          findings: [{ category: "continuity", severity: "error", message: "Contradiction." }],
          validatedAt: now,
        },
      })
    );
    await expect(harness.service.approve(owner, projectId, harness.plans[0]!.id)).rejects.toMatchObject({
      code: "plan_validation_failed",
    });
  });

  it("refuses to approve a plan developed from an older Story Bible", async () => {
    const { service, plans } = serviceHarness(planRecord({ basedOnBibleVersion: 1 }), {
      bibleApprovedVersion: 2,
    });
    await expect(service.approve(owner, projectId, plans[0]!.id)).rejects.toMatchObject({ code: "plan_stale" });
  });

  it("is idempotent under concurrent approval attempts", async () => {
    const { service, plans } = serviceHarness();
    const [first, second] = await Promise.all([
      service.approve(owner, projectId, plans[0]!.id),
      service.approve(owner, projectId, plans[0]!.id),
    ]);
    expect(first.status).toBe("approved");
    expect(second.status).toBe("approved");
    expect(plans.filter((plan) => plan.status === "approved")).toHaveLength(1);
  });

  it("saves a creator edit as a new version and re-validates it", async () => {
    const { service, plans, insertCalls } = serviceHarness();
    const edited = planContent();
    edited.episodeProgression[0]!.mainObjective = "A creator-written objective.";
    const saved = await service.update(owner, projectId, plans[0]!.id, {
      expectedVersion: 1,
      plan: edited,
    });
    expect(saved.version).toBe(2);
    expect(saved.episodeProgression[0]!.mainObjective).toBe("A creator-written objective.");
    expect(saved.validationFindings).not.toBeNull();
    expect(insertCalls()).toBe(1);
  });

  it("rejects an edit that would overwrite a newer version", async () => {
    const { service, plans } = serviceHarness();
    await expect(
      service.update(owner, projectId, plans[0]!.id, {
        expectedVersion: 99,
        plan: planContent(),
      })
    ).rejects.toMatchObject({ code: "plan_conflict" });
  });

  it("returns the open job instead of starting a duplicate generation", async () => {
    const open = stubJob({ status: "processing" });
    const { service, jobs } = serviceHarness(planRecord(), { openJob: open });
    const result = await service.start(owner, projectId, { operation: "regenerate" });
    expect(result.job.id).toBe(open.id);
    expect(jobs).toHaveLength(1);
  });

  it("collapses two concurrent generation requests into one job", async () => {
    const { service, jobs } = serviceHarness(planRecord());
    const [first, second] = await Promise.all([
      service.start(owner, projectId, { operation: "regenerate" }),
      service.start(owner, projectId, { operation: "regenerate" }),
    ]);
    expect(jobs).toHaveLength(1);
    expect(first.job.id).toBe(second.job.id);
  });

  it("blocks planning until the story draft is approved", async () => {
    const { service } = serviceHarness(null, { storyStatus: "awaiting_approval" });
    await expect(service.start(owner, projectId, { operation: "generate" })).rejects.toMatchObject({
      code: "story_required",
    });
  });
});

// ---------------------------------------------------------------------------
// Stage E/F: screenplay context
// ---------------------------------------------------------------------------

function liveEngineHarness(options: {
  episodeNumber?: number;
  gate?: { allowed: boolean; code: string; reason: string | null };
  withLedger?: boolean;
  llmScreenplay?: ScreenplayScene[];
  repair?: (scenes: ScreenplayScene[]) => ScreenplayScene[];
  repairThrows?: boolean;
  semanticCritique?: boolean;
  critiqueFindings?: { category: string; severity: string; message: string; sceneNumber?: number }[];
} = {}) {
  const saved: Record<string, unknown>[] = [];
  const prompts: Record<string, unknown>[] = [];
  const repairCalls: number[][] = [];
  let critiqueCalls = 0;
  const episodeNumber = options.episodeNumber ?? 1;
  const plan = planRecord({ status: "approved" });
  const ledger: ContinuityLedgerRecord = {
    id: "l".repeat(24),
    clerkUserId: owner.userId,
    projectId,
    events: [
      {
        episodeNumber: 1,
        event: "Ada returned to the house.",
        consequence: "Elias realised she knew about the sale.",
        affectedCharacters: ["Ada", "Elias"],
        revealedInformation: ["The house was sold."],
      },
    ],
    characterStates: [
      {
        name: "Ada",
        currentLocation: "The house",
        currentObjective: "Find the deed.",
        knowledge: ["The house was sold."],
        beliefs: [],
        motivations: ["Reclaim the house."],
        emotionalState: "Determined",
        physicalState: "",
        relationships: [],
      },
    ],
    locationStates: [],
    objectStates: [],
    revealedSecrets: ["The house was sold."],
    unresolvedThreads: [{ thread: "Where is the deed?", introducedInEpisode: 1, status: "open" }],
    consequences: ["Elias realised she knew about the sale."],
    timelineNotes: "",
    asOfEpisode: 1,
    basedOnPlanVersion: 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const episodePlan = {
    episodeNumber,
    workingTitle: `Episode ${episodeNumber}`,
    narrativePurpose: `Purpose of episode ${episodeNumber}.`,
    sourcePlanVersion: 1,
    inheritsFrom: options.withLedger === false ? [] : ["Ada returned to the house."],
    intendsToAchieve: `Achieve the objective of episode ${episodeNumber}.`,
    newDevelopments: ["Ada finds the deed."],
    characterChanges: ["Ada changes."],
    informationRevealed: ["Elias signed the deed."],
    consequencesCreated: ["Elias is exposed."],
    seasonAdvance: `Episode ${episodeNumber} advances the season.`,
    carryForward: `The next episode must respect episode ${episodeNumber}.`,
    continuityRequirements: `The next episode must respect episode ${episodeNumber}.`,
    unresolvedThreads: ["Where is the second copy?"],
  };
  const casna = {
    async load() {
      return {
        gate: options.gate ?? { allowed: true, code: "ok", reason: null },
        plan,
        latestPlan: plan,
        ledger: options.withLedger === false ? null : ledger,
        episodePlan,
        episodePlanValidation: { passed: true, findings: [], validatedAt: now },
        previousEpisodes: options.withLedger === false ? [] : [
          {
            episodeNumber: 1,
            title: "Return",
            synopsis: "Ada returns and finds the house sold.",
            screenplay: screenplay(2),
          },
        ],
        previousEpisode: options.withLedger === false
          ? null
          : { episodeNumber: 1, title: "Return", synopsis: "Ada returns and finds the house sold." },
      };
    },
  };
  const engines = createLiveEngines({
    llm: {
      id: "fake",
      model: "fake-model",
      async generateStory(input: Record<string, unknown>) {
        prompts.push(input);
        return {
          title: `Episode ${episodeNumber} title`,
          synopsis: "Ada finds the deed and confronts Elias, then learns the sale was forged and that Elias signed it himself.",
          structure: {
            act1: { introduction: "a", mainCharacters: "b", setting: "c", initialSituation: "d", incitingIncident: "e" },
            act2: { risingTension: "f", obstacles: "g", characterDecisions: "h", turningPoint: "i" },
            act3: { climax: "j", resolution: "k", finalOutcome: "l" },
          },
          screenplay: options.llmScreenplay ?? screenplay(5),
          provider: "fake",
          model: "fake-model",
          fallbackFrom: null,
        };
      },
      ...(options.repair || options.repairThrows
        ? {
            async repairScenes(input: {
              screenplay: ScreenplayScene[];
              findings: { severity: string; sceneNumber?: number }[];
            }) {
              repairCalls.push(
                input.findings
                  .filter((finding) => finding.severity === "error" && finding.sceneNumber)
                  .map((finding) => finding.sceneNumber!)
              );
              if (options.repairThrows) throw new JobError("repair unavailable", "provider_failed", true);
              return {
                screenplay: options.repair ? options.repair(input.screenplay) : input.screenplay,
                provider: "fake",
                model: "fake-model",
              };
            },
          }
        : {}),
      ...(options.semanticCritique
        ? {
            async critiqueStory() {
              critiqueCalls += 1;
              return {
                findings: options.critiqueFindings ?? [],
                provider: "fake",
                model: "fake-model",
              };
            },
          }
        : {}),
    } as never,
    stories: {
      async upsertAwaiting(input: Record<string, unknown>) {
        saved.push(input);
        return { id: "story-1", title: String(input.title ?? ""), synopsis: String(input.synopsis ?? "") };
      },
      async findForRun() { return null; },
    },
    projects: { async findOwned() { return project(); } } as never,
    storyBible: {
      async findApproved() {
        return { version: 1, content: bibleContent(), premise: "", worldRules: [], themes: [], boundaries: [], canonFacts: [] } as never;
      },
    },
    casna: casna as never,
    semanticCritique: options.semanticCritique,
  });
  return {
    engines,
    saved,
    prompts,
    plan,
    ledger,
    episodePlan,
    repairCalls,
    critiqueCalls: () => critiqueCalls,
  };
}

describe("sequential screenplay generation (Stages E/F/G)", () => {
  it("writes Episode 1 from the approved Story Bible and Season Plan", async () => {
    const { engines, saved, prompts } = liveEngineHarness({ withLedger: false });
    await engines.run(stubJob({ jobType: "story.generate", runId: "r".repeat(24) }), runRecord({ episode: { id: "e".repeat(24), number: 1, title: "Return", premise: "Ada returns.", targetDurationSeconds: 300, baseSnapshotVersion: 1 } }));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.seasonPlan).toBeTruthy();
    expect(prompts[0]!.episodePlan).toMatchObject({ episodeNumber: 1 });
    expect(prompts[0]!.previousEpisode).toBeNull();
    expect(saved[0]!.plan).toEqual(prompts[0]!.episodePlan);
    expect(saved[0]!.validationFindings).toMatchObject({ passed: true });
  });

  it("passes the previous approved episode and Continuity Ledger into Episode 2", async () => {
    const { engines, prompts } = liveEngineHarness({ episodeNumber: 2 });
    await engines.run(
      stubJob({ jobType: "story.generate", runId: "r".repeat(24) }),
      runRecord()
    );
    expect(prompts[0]!.previousEpisode).toMatchObject({ episodeNumber: 1, title: "Return" });
    expect(prompts[0]!.continuityLedger).toMatchObject({
      events: [expect.objectContaining({ episode: 1, event: "Ada returned to the house." })],
      consequences: ["Elias realised she knew about the sale."],
    });
    expect(prompts[0]!.episodePlan).toMatchObject({ episodeNumber: 2, sourcePlanVersion: 1 });
  });

  it("refuses to generate a locked episode and calls no provider", async () => {
    const { engines, prompts, saved } = liveEngineHarness({
      episodeNumber: 2,
      gate: { allowed: false, code: "episode_locked", reason: "Episode 2 is locked until episode 1 is approved." },
    });
    await expect(
      engines.run(stubJob({ jobType: "story.generate", runId: "r".repeat(24) }), runRecord())
    ).rejects.toMatchObject({ code: "episode_locked" });
    expect(prompts).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  it("keeps an invalid screenplay for review but never reports success", async () => {
    const invalid = screenplay(5);
    invalid[2]!.dialogue = [{ characterName: "The Stranger", line: "I know where the deed is." }];
    const { engines, saved } = liveEngineHarness({ llmScreenplay: invalid });
    await expect(
      engines.run(stubJob({ jobType: "story.generate", runId: "r".repeat(24) }), runRecord({ episode: { id: "e".repeat(24), number: 1, title: "Return", premise: "", targetDurationSeconds: 300, baseSnapshotVersion: 1 } }))
    ).rejects.toMatchObject({ code: "screenplay_conflict", retryable: true });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.validationFindings).toMatchObject({ passed: false });
  });
});

describe("targeted repair and advisory critique (Stage H)", () => {
  it("repairs only the failing scene and saves a passing screenplay", async () => {
    const invalid = screenplay(5);
    invalid[2]!.dialogue = [{ characterName: "The Stranger", line: "I know where the deed is." }];
    const { engines, saved, repairCalls } = liveEngineHarness({
      llmScreenplay: invalid,
      repair: (scenes) =>
        scenes.map((scene) =>
          scene.sceneNumber === 3
            ? { ...scene, dialogue: [{ characterName: "Ada", line: "I know where the deed is." }] }
            : scene
        ),
    });
    await engines.run(
      stubJob({ jobType: "story.generate", runId: "r".repeat(24) }),
      runRecord({ episode: { id: "e".repeat(24), number: 1, title: "Return", premise: "", targetDurationSeconds: 300, baseSnapshotVersion: 1 } })
    );
    expect(repairCalls).toEqual([[3]]);
    expect(saved[0]!.validationFindings).toMatchObject({ passed: true });
    expect((saved[0]!.repairHistory as unknown[]).length).toBe(1);
    expect((saved[0]!.screenplay as ScreenplayScene[])[2]!.dialogue[0]!.characterName).toBe("Ada");
  });

  it("does not repair a failure that is not scene-scoped", async () => {
    const { engines, repairCalls, saved } = liveEngineHarness({
      llmScreenplay: screenplay(1),
      repair: (scenes) => scenes,
    });
    await expect(
      engines.run(stubJob({ jobType: "story.generate", runId: "r".repeat(24) }), runRecord({ episode: { id: "e".repeat(24), number: 1, title: "Return", premise: "", targetDurationSeconds: 300, baseSnapshotVersion: 1 } }))
    ).rejects.toMatchObject({ code: "screenplay_conflict" });
    expect(repairCalls).toHaveLength(0);
    expect(saved[0]!.validationFindings).toMatchObject({ passed: false });
  });

  it("bounds repair rounds when a repair does not resolve the finding", async () => {
    const invalid = screenplay(5);
    invalid[2]!.dialogue = [{ characterName: "The Stranger", line: "I know where the deed is." }];
    const { engines, repairCalls } = liveEngineHarness({
      llmScreenplay: invalid,
      repair: (scenes) => scenes,
    });
    await expect(
      engines.run(stubJob({ jobType: "story.generate", runId: "r".repeat(24) }), runRecord({ episode: { id: "e".repeat(24), number: 1, title: "Return", premise: "", targetDurationSeconds: 300, baseSnapshotVersion: 1 } }))
    ).rejects.toMatchObject({ code: "screenplay_conflict" });
    expect(repairCalls).toHaveLength(2);
  });

  it("keeps a repair provider failure from blocking the draft", async () => {
    const invalid = screenplay(5);
    invalid[2]!.dialogue = [{ characterName: "The Stranger", line: "I know where the deed is." }];
    const { engines, saved, repairCalls } = liveEngineHarness({
      llmScreenplay: invalid,
      repairThrows: true,
    });
    await expect(
      engines.run(stubJob({ jobType: "story.generate", runId: "r".repeat(24) }), runRecord({ episode: { id: "e".repeat(24), number: 1, title: "Return", premise: "", targetDurationSeconds: 300, baseSnapshotVersion: 1 } }))
    ).rejects.toMatchObject({ code: "screenplay_conflict" });
    expect(repairCalls).toHaveLength(1);
    expect(saved[0]!.validationFindings).toMatchObject({ passed: false });
  });

  it("adds advisory critique findings as warnings without blocking approval", async () => {
    const { engines, saved, critiqueCalls } = liveEngineHarness({
      semanticCritique: true,
      critiqueFindings: [
        { category: "timeline", severity: "error", message: "Night falls twice in one evening.", sceneNumber: 4 },
      ],
    });
    await engines.run(
      stubJob({ jobType: "story.generate", runId: "r".repeat(24) }),
      runRecord({ episode: { id: "e".repeat(24), number: 1, title: "Return", premise: "", targetDurationSeconds: 300, baseSnapshotVersion: 1 } })
    );
    expect(critiqueCalls()).toBe(1);
    const validation = saved[0]!.validationFindings as {
      passed: boolean;
      findings: { category: string; severity: string; message: string }[];
    };
    expect(validation.passed).toBe(true);
    expect(validation.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "timeline", severity: "warning" }),
      ])
    );
  });
});

// ---------------------------------------------------------------------------
// Stage I: continuity ledger update
// ---------------------------------------------------------------------------

function continuityHarness(existing: ContinuityLedgerRecord | null = null) {
  const upserts: Record<string, unknown>[] = [];
  const canonSummaries: Record<string, unknown>[] = [];
  const draft = storyRecord({
    status: "awaiting_approval",
    plan: {
      episodeNumber: 2,
      workingTitle: "Episode 2",
      narrativePurpose: "Purpose of episode 2.",
      sourcePlanVersion: 1,
      inheritsFrom: ["Ada returned to the house."],
      intendsToAchieve: "Achieve the objective of episode 2.",
      newDevelopments: ["Ada finds the deed."],
      characterChanges: ["Ada changes."],
      informationRevealed: ["Elias signed the deed."],
      consequencesCreated: ["Elias is exposed."],
      seasonAdvance: "Episode 2 advances the season.",
      carryForward: "Respect episode 2.",
      continuityRequirements: "Respect episode 2.",
      unresolvedThreads: ["Where is the second copy?"],
    },
  });
  const service = createContinuityService(
    { async findOwned() { return project(); } },
    { async findApproved() { return planRecord({ status: "approved" }); } },
    {
      async findLatest() { return existing; },
      async upsert(input: Record<string, unknown>) {
        upserts.push(input);
        return {
          ...input,
          id: "ledger-1",
          version: upserts.length,
          createdAt: now,
          updatedAt: now,
        } as never;
      },
    },
    { async listOwned() { return []; } },
    {
      async findLatestAwaitingEpisode() { return draft; },
      async findOwned() { return storyRecord({ status: "approved" }); },
      async saveCanonSummary(_userId: string, _id: string, summary: Record<string, unknown>) {
        canonSummaries.push(summary);
        return null;
      },
    }
  );
  return { service, upserts, canonSummaries, draft };
}

describe("continuity ledger updates (Stage I)", () => {
  it("promotes an approved episode into established canon", async () => {
    const { service, upserts, canonSummaries } = continuityHarness();
    const result = await service.onEpisodeApproved({
      clerkUserId: owner.userId,
      projectId,
      episodeNumber: 2,
      story: storyRecord({ status: "approved" }),
    });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ asOfEpisode: 2, basedOnPlanVersion: 1 });
    expect((upserts[0]!.events as unknown[]).length).toBeGreaterThan(0);
    expect(canonSummaries).toHaveLength(1);
    expect(result).toMatchObject({ asOfEpisode: 2 });
  });

  it("does not touch the ledger for an unapproved draft", async () => {
    const { service, upserts } = continuityHarness();
    const state = await service.get(owner, projectId);
    expect(state.ledger).toBeNull();
    expect(upserts).toHaveLength(0);
    // The draft's developments are exposed as proposals, not canon.
    expect(state.proposedDevelopments.length).toBeGreaterThan(0);
    expect(state.proposedDevelopments[0]).toMatchObject({ episodeNumber: 2, source: "episode_plan" });
  });

  it("does not apply the same episode twice on retry", async () => {
    const existing = {
      id: "l".repeat(24),
      clerkUserId: owner.userId,
      projectId,
      events: [],
      characterStates: [],
      locationStates: [],
      objectStates: [],
      revealedSecrets: [],
      unresolvedThreads: [],
      consequences: [],
      timelineNotes: "",
      asOfEpisode: 2,
      basedOnPlanVersion: 1,
      version: 1,
      createdAt: now,
      updatedAt: now,
    } as ContinuityLedgerRecord;
    const { service, upserts } = continuityHarness(existing);
    const result = await service.onEpisodeApproved({
      clerkUserId: owner.userId,
      projectId,
      episodeNumber: 2,
      story: storyRecord({ status: "approved" }),
    });
    expect(result).toBe(existing);
    expect(upserts).toHaveLength(0);
  });
});

describe("continuity ledger rebuild", () => {
  function rebuildHarness(options: {
    existing?: ContinuityLedgerRecord | null;
    episodes?: { episodeNumber: number; status: string; currentStoryId: string | null }[];
    stories?: Record<string, StoryRecord>;
  } = {}) {
    const upserts: Record<string, unknown>[] = [];
    const summaries: string[] = [];
    const storyMap = options.stories ?? {
      ["s1".padEnd(24, "0")]: storyRecord({
        id: "s1".padEnd(24, "0"),
        status: "approved",
        title: "Return",
        synopsis: "Ada returns and finds the house sold.",
      }),
      ["s2".padEnd(24, "0")]: storyRecord({
        id: "s2".padEnd(24, "0"),
        status: "approved",
        title: "The deed",
        synopsis: "Ada finds the deed and confronts Elias.",
      }),
    };
    const episodes = options.episodes ?? [
      { episodeNumber: 1, status: "story_approved", currentStoryId: "s1".padEnd(24, "0") },
      { episodeNumber: 2, status: "story_approved", currentStoryId: "s2".padEnd(24, "0") },
      { episodeNumber: 3, status: "draft", currentStoryId: null },
    ];
    const service = createContinuityService(
      { async findOwned() { return project(); } },
      { async findApproved() { return planRecord({ status: "approved" }); } },
      {
        async findLatest() { return options.existing ?? null; },
        async upsert(input: Record<string, unknown>) {
          upserts.push(input);
          return { ...input, id: "ledger-1", version: 1, createdAt: now, updatedAt: now } as never;
        },
      },
      { async listOwned() { return episodes as never; } },
      {
        async findLatestAwaitingEpisode() { return null; },
        async findOwned(_userId: string, id: string) { return storyMap[id] ?? null; },
        async saveCanonSummary(_userId: string, id: string) {
          summaries.push(id);
          return null;
        },
      }
    );
    return { service, upserts, summaries };
  }

  it("reconstructs one ledger from approved episodes in order", async () => {
    const { service, upserts, summaries } = rebuildHarness();
    const result = await service.rebuild(owner, projectId);
    expect(result.replayedEpisodes).toBe(2);
    expect(result.created).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ asOfEpisode: 2, basedOnPlanVersion: 1 });
    expect((upserts[0]!.events as unknown[]).length).toBeGreaterThan(0);
    expect(summaries).toHaveLength(2);
  });

  it("does not write during a dry run", async () => {
    const { service, upserts } = rebuildHarness();
    const result = await service.rebuild(owner, projectId, { dryRun: true });
    expect(result.replayedEpisodes).toBe(2);
    expect(result.created).toBe(false);
    expect(result.ledger?.asOfEpisode).toBe(2);
    expect(upserts).toHaveLength(0);
  });

  it("is a no-op when a ledger already exists", async () => {
    const existing = {
      id: "l".repeat(24),
      clerkUserId: owner.userId,
      projectId,
      events: [],
      characterStates: [],
      locationStates: [],
      objectStates: [],
      revealedSecrets: [],
      unresolvedThreads: [],
      consequences: [],
      timelineNotes: "",
      asOfEpisode: 2,
      basedOnPlanVersion: 1,
      version: 3,
      createdAt: now,
      updatedAt: now,
    } as ContinuityLedgerRecord;
    const { service, upserts } = rebuildHarness({ existing });
    const result = await service.rebuild(owner, projectId);
    expect(result.created).toBe(false);
    expect(result.ledger).toBe(existing);
    expect(upserts).toHaveLength(0);
  });

  it("ignores unapproved episodes and refuses with none approved", async () => {
    const { service } = rebuildHarness({
      episodes: [{ episodeNumber: 1, status: "draft", currentStoryId: null }],
    });
    await expect(service.rebuild(owner, projectId)).rejects.toMatchObject({
      code: "no_approved_episodes",
    });
  });
});

// ---------------------------------------------------------------------------
// CASNA context + Episode service gates
// ---------------------------------------------------------------------------

describe("CASNA context loading", () => {
  it("loads the approved plan, ledger, and previous approved episodes", async () => {
    const context = createCasnaContext({
      plans: {
        async findApproved() { return planRecord({ status: "approved" }); },
        async findLatest() { return planRecord({ status: "approved" }); },
      },
      ledgers: {
        async findLatest() {
          return {
            id: "l".repeat(24),
            clerkUserId: owner.userId,
            projectId,
            events: [],
            characterStates: [],
            locationStates: [],
            objectStates: [],
            revealedSecrets: [],
            unresolvedThreads: [],
            consequences: [],
            timelineNotes: "",
            asOfEpisode: 1,
            basedOnPlanVersion: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
          } as ContinuityLedgerRecord;
        },
      },
      episodes: {
        async listOwned() {
          return [
            { episodeNumber: 1, status: "story_approved", currentStoryId: "s".repeat(24) },
            { episodeNumber: 2, status: "draft", currentStoryId: null },
          ] as never;
        },
      },
      stories: {
        async findOwned() { return storyRecord({ status: "approved" }); },
      },
    });
    const loaded = await context.load({
      clerkUserId: owner.userId,
      projectId,
      productionMode: "serialized",
      episodeNumber: 2,
      bibleApprovedVersion: 1,
    });
    expect(loaded.gate.allowed).toBe(true);
    expect(loaded.previousEpisodes).toHaveLength(1);
    expect(loaded.episodePlan).toMatchObject({ episodeNumber: 2 });
    expect(loaded.episodePlanValidation).toMatchObject({ passed: true });
  });
});

describe("episode service CASNA gate", () => {
  function episodeServiceHarness(hasPlan: boolean, episodes: { episodeNumber: number; status: string }[] = []) {
    const rows = episodes.map((episode, index) => ({
      ...episode,
      id: String(index + 1).padStart(24, "0"),
      clerkUserId: owner.userId,
      projectId,
      title: `Episode ${episode.episodeNumber}`,
      premise: "",
      targetDurationSeconds: 300,
      currentStoryId: null,
      baseSnapshotVersion: 1,
      basePlanVersion: 1,
      createdAt: now,
      updatedAt: now,
    }));
    const service = createEpisodeService(
      {
        async listOwned() { return rows as never; },
        async create() { return rows[0] as never; },
      },
      { async findOwned() { return project(); } },
      { async findLatest() { return null; } },
      { async findOwned() { return { approvedVersion: 1 } as never; } },
      { jobs: { async insert() { throw new Error("unused"); }, async listByKeyPrefix() { return []; }, async save(job: JobRecord) { return job; } }, queueFactory: () => null },
      {
        async findApproved() { return hasPlan ? (planRecord({ status: "approved" }) as never) : null; },
        async findLatest() { return hasPlan ? (planRecord({ status: "approved" }) as never) : null; },
      },
      { async findLatest() { return null; } }
    );
    return service;
  }

  it("blocks episode creation before the Season Plan is approved", async () => {
    const service = episodeServiceHarness(false);
    await expect(
      service.create(owner, projectId, { title: "Two", premise: "", targetDurationSeconds: 300 })
    ).rejects.toMatchObject({ code: "season_plan_required" });
  });

  it("blocks the next episode while the previous one is unapproved", async () => {
    const service = episodeServiceHarness(true, [{ episodeNumber: 1, status: "draft" }]);
    await expect(
      service.create(owner, projectId, { title: "Two", premise: "", targetDurationSeconds: 300 })
    ).rejects.toMatchObject({ code: "episode_locked" });
  });
});
