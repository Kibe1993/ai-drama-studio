import { describe, expect, it } from "vitest";
import { type JobRecord } from "@/lib/pipeline/types";
import { createSeasonPlanEngine, type SeasonPlanProgressEvent } from "@/lib/pipeline/seasonPlanEngine";
import { assembleSeasonPlan } from "@/lib/providers/llm/seasonPlanTask";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { StoryRecord } from "@/lib/validation/story";
import type {
  SeasonPlan,
  SeasonPlanRecord,
  SeasonArchitecture,
  EpisodeDetail,
  EpisodeOutline,
} from "@/lib/validation/seasonPlan";

// ---------------------------------------------------------------------------
// Fixtures (adapted from season-plan-generation.test.ts)
// ---------------------------------------------------------------------------

const now = new Date().toISOString();
const projectId = "a".repeat(24);
const ownerUserId = "user_owner";

function outline(n: number): EpisodeOutline {
  return {
    episodeNumber: n,
    workingTitle: `Episode ${n}`,
    narrativePurpose: `Purpose of episode ${n}.`,
    centralConflict: `Conflict of episode ${n}.`,
    endingOrCliffhanger: `Episode ${n} ends on a turn.`,
  };
}

function episodeDetail(n: number): EpisodeDetail {
  return {
    episodeNumber: n,
    workingTitle: `Episode ${n}`,
    narrativePurpose: `Purpose of episode ${n}.`,
    startingSituation: `Situation at start of episode ${n}.`,
    mainObjective: `Objective of episode ${n}.`,
    centralConflict: `Conflict of episode ${n}.`,
    majorStoryBeats: [`Beat one of episode ${n}.`],
    informationRevealed: [`A fact revealed in episode ${n}.`],
    characterDevelopment: `Characters change in episode ${n}.`,
    importantEvents: [`An event in episode ${n}.`],
    consequences: [`A consequence of episode ${n}.`],
    storyContribution: `Episode ${n} advances the season.`,
    endingOrCliffhanger: `Episode ${n} ends on a turn.`,
    unresolvedThreads: [`A thread from episode ${n}.`],
    continuityRequirements: `Next episode must respect episode ${n}.`,
    characterArcChanges: [],
    relationshipChanges: [],
    objectChanges: [],
    locationChanges: [],
  };
}

function architecture(episodeCount: number): SeasonArchitecture {
  return {
    seasonObjective: "Ada reclaims the family house.",
    centralConflictOrMystery: "Who hid the deed?",
    mainCharacterObjectives: "Ada wants the truth.",
    overallCharacterDevelopment: "Ada learns the cost of winning.",
    majorStoryDevelopments: ["The deed surfaces.", "Elias admits his part."],
    beginningDirection: "Ada returns.",
    middleDirection: "The search escalates.",
    endingDirection: "Ada chooses.",
    episodeOutlines: Array.from({ length: episodeCount }, (_, i) => outline(i + 1)),
    importantRevelations: ["Elias signed the deed."],
    relationshipChanges: ["Ada and Elias become rivals."],
    consequencesCarriedBetween: ["Elias is exposed."],
    setupAndPayoff: ["The drawer pays off."],
    unresolvedQuestions: ["Where is the second copy?"],
    intendedSeasonConclusion: "Ada keeps the house.",
  };
}

function bibleContent(): StoryBibleContent {
  return {
    identity: {
      title: "The house", genres: ["drama"], subgenres: [],
      centralPremise: "A family fights over a house.",
      narrativeConcept: "A locked drawer holds the truth.",
      toneAndAtmosphere: "Cold and intimate.",
      targetAudience: "Adults",
      centralConflict: "Ada versus Elias.",
    },
    world: {
      description: "A coastal town.",
      geographyAndLocations: [{ name: "The house", description: "A family house.", storyFunction: "The prize." }],
      socialStructuresAndCultures: [], historyAndPastEvents: [], rules: [], definingSystems: [],
    },
    characters: {
      characters: [{
        name: "Ada", storyRole: "protagonist", roleDescription: "The lead.",
        physicalDescription: "", personality: "Guarded.", background: "Raised in the house.",
        motivations: ["Keep the family together."], fearsAndWeaknesses: ["Losing the house."],
        abilitiesAndLimitations: [], relationships: [], secrets: [], developmentPotential: "Learn to accept change.",
      }],
      relationshipDynamics: [],
    },
    narrative: {
      mainStoryline: "Ada returns to claim the house.",
      majorConflicts: ["The deed."], longTermDirection: "The siblings reconcile.",
      subplots: [], unresolvedMysteries: ["Who hid the deed?"],
      potentialFutureRevelations: ["Elias signed it."],
      majorNarrativeQuestions: ["Who owns the house?"],
      serializedEndingGuidance: "End with a choice.",
    },
    guidelines: {
      mainThemes: ["Inheritance"], secondaryThemes: [],
      storytellingStyle: "Grounded realism.", boundaries: [],
      mustRemainConsistent: ["The house is never sold."],
    },
    canon: {
      confirmedFacts: ["The house is never sold."], proposedDetails: [],
      unresolvedQuestions: ["Where is the second copy?"],
      hiddenInformation: [], characterKnowledge: [], audienceKnowledge: [],
    },
  };
}

function project(): ProjectRecord {
  return {
    id: projectId, title: "The house", originalStoryIdea: "A family fights over a house.",
    genre: "family", language: "en", visualStyle: "realistic", tone: "cold",
    targetDurationSeconds: 300, aspectRatio: "16:9", status: "draft",
    workflowMode: "guided", productionType: "fictional_drama", productionMode: "serialized",
    createdAt: now, updatedAt: now,
  };
}

function storyRecord(): StoryRecord {
  return {
    id: "s".repeat(24), clerkUserId: ownerUserId, projectId,
    productionRunId: null, episodeId: null, title: "The deed", synopsis: "Ada finds the deed.",
    structure: {
      act1: { introduction: "Ada returns.", mainCharacters: "Ada.", setting: "The house.", initialSituation: "Sold.", incitingIncident: "Ada finds a deed." },
      act2: { risingTension: "Elias avoids.", obstacles: "Lawyer missing.", characterDecisions: "Ada searches.", turningPoint: "She finds the signature." },
      act3: { climax: "Confrontation.", resolution: "Elias admits.", finalOutcome: "They talk." },
    },
    screenplay: [{ sceneNumber: 1, heading: "INT. HOUSE - NIGHT", location: "House", timeOfDay: "Night", charactersPresent: ["Ada"], visualDescription: "The house.", action: "Ada searches.", dialogue: [{ characterName: "Ada", line: "Found it." }] }],
    status: "approved", version: 1, provider: "fake", model: "fake-model", fallbackFrom: null,
    createdAt: now, updatedAt: now,
  };
}

function stubJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "j".repeat(24), clerkUserId: ownerUserId, projectId,
    runId: null, sceneNumber: null, jobType: "seasonPlan.generate",
    provider: "fake", model: "fake-model",
    input: { operation: "generate", episodeCount: 6 },
    output: null, status: "queued",
    progress: { stage: "seasonPlan.generate", message: "" },
    attempts: 0, maxAttempts: 3, error: null,
    idempotencyKey: "key", bullJobId: null, startedAt: null, completedAt: null,
    ...overrides,
  };
}

function planContent(episodeCount = 6): SeasonPlan {
  const arch = architecture(episodeCount);
  return assembleSeasonPlan(arch, arch.episodeOutlines.map((o) => episodeDetail(o.episodeNumber)));
}

// ---------------------------------------------------------------------------
// Engine harness that captures progressLog
// ---------------------------------------------------------------------------

function engineHarness(options: { episodeCount?: number } = {}) {
  const episodeCount = options.episodeCount ?? 6;
  const rows: SeasonPlanRecord[] = [];
  const plans = {
    async insert(input: Record<string, unknown>) {
      const record = {
        ...planContent(episodeCount),
        ...(input as Partial<SeasonPlanRecord>),
        id: `plan-${rows.length + 1}`,
        version: rows.length + 1,
        status: "awaiting_approval" as const,
        validationFindings: null,
      } as SeasonPlanRecord;
      rows.push(record);
      return record;
    },
    async findLatest() { return rows[rows.length - 1] ?? null; },
    async saveValidationFindings() { return null; },
  };
  const bibles = {
    async findOwned() {
      return { approvedVersion: 1, approvedSnapshot: { version: 1, content: bibleContent(), createdAt: now }, creativeDirection: "" } as never;
    },
  };
  const stories = { async findProjectDraft() { return storyRecord() as never; } };
  const episodes = { async listOwned() { return []; } };
  const ledgers = { async findLatest() { return null; } };

  const arch = architecture(episodeCount);
  const llm = {
    id: "fake",
    model: "fake-model",
    async generateSeasonArchitecture() {
      return { architecture: arch, provider: "fake", model: "fake-model", fallbackFrom: null };
    },
    async generateEpisodeDetails(input: { outlines: EpisodeOutline[] }) {
      return {
        batch: { episodes: input.outlines.map((o) => episodeDetail(o.episodeNumber)) },
        provider: "fake",
        model: "fake-model",
        fallbackFrom: null,
      };
    },
  } as never;

  const engine = createSeasonPlanEngine(
    llm, plans as never, bibles as never, stories as never,
    async (_job: JobRecord, _message: string, output?: Record<string, unknown>) => {
      if (output !== undefined) _job.output = output;
    },
    episodes as never, ledgers as never,
  );
  return { engine, rows };
}

function getProgressLog(job: JobRecord): SeasonPlanProgressEvent[] {
  const output = job.output as { progressLog?: SeasonPlanProgressEvent[] } | null;
  return output?.progressLog ?? [];
}

// ---------------------------------------------------------------------------
// Section 1: Two-stage generation emits structured progress events
// ---------------------------------------------------------------------------

describe("Season plan progress events: two-stage generation", () => {
  it("emits architecture started and completed events", async () => {
    const { engine } = engineHarness();
    const job = stubJob();
    await engine.run(job, project());
    const log = getProgressLog(job);
    const archStarted = log.find((e) => e.stage === "architecture" && e.status === "started");
    const archCompleted = log.find((e) => e.stage === "architecture" && e.status === "completed");
    expect(archStarted).toBeDefined();
    expect(archStarted?.message).toContain("Designing season architecture");
    expect(archCompleted).toBeDefined();
    expect(archCompleted?.message).toContain("Season architecture ready");
    expect(archCompleted?.totalEpisodes).toBe(6);
    expect(archCompleted?.provider).toBe("fake");
    expect(archCompleted?.model).toBe("fake-model");
  });

  it("emits episode_details started, progress, and completed events", async () => {
    const { engine } = engineHarness();
    const job = stubJob();
    await engine.run(job, project());
    const log = getProgressLog(job);
    const detailsStarted = log.find((e) => e.stage === "episode_details" && e.status === "started");
    const detailsCompleted = log.find((e) => e.stage === "episode_details" && e.status === "completed");
    expect(detailsStarted).toBeDefined();
    expect(detailsStarted?.totalEpisodes).toBe(6);
    expect(detailsStarted?.totalBatches).toBe(1);
    expect(detailsCompleted).toBeDefined();
    expect(detailsCompleted?.completedEpisodes).toBe(6);
    expect(detailsCompleted?.totalEpisodes).toBe(6);
  });

  it("emits episode_details progress events with completedEpisodes count", async () => {
    const { engine } = engineHarness();
    const job = stubJob();
    await engine.run(job, project());
    const log = getProgressLog(job);
    const progressEvents = log.filter(
      (e) => e.stage === "episode_details" && e.status === "progress"
    );
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    const lastProgress = progressEvents[progressEvents.length - 1];
    expect(lastProgress?.completedEpisodes).toBe(6);
    expect(lastProgress?.totalEpisodes).toBe(6);
  });

  it("emits validation started and completed events with pass/fail info", async () => {
    const { engine } = engineHarness();
    const job = stubJob();
    await engine.run(job, project());
    const log = getProgressLog(job);
    const valStarted = log.find((e) => e.stage === "validation" && e.status === "started");
    const valCompleted = log.find((e) => e.stage === "validation" && e.status === "completed");
    expect(valStarted).toBeDefined();
    expect(valCompleted).toBeDefined();
    expect(valCompleted?.passed).toBeDefined();
    expect(typeof valCompleted?.errorCount).toBe("number");
    expect(typeof valCompleted?.warningCount).toBe("number");
  });

  it("emits saving and complete events", async () => {
    const { engine } = engineHarness();
    const job = stubJob();
    await engine.run(job, project());
    const log = getProgressLog(job);
    const savingStarted = log.find((e) => e.stage === "saving" && e.status === "started");
    const complete = log.find((e) => e.stage === "complete" && e.status === "completed");
    expect(savingStarted).toBeDefined();
    expect(complete).toBeDefined();
    expect(complete?.message).toContain("Season plan saved");
    expect(complete?.provider).toBe("fake");
  });

  it("emits events in chronological order with timestamps", async () => {
    const { engine } = engineHarness();
    const job = stubJob();
    await engine.run(job, project());
    const log = getProgressLog(job);
    expect(log.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < log.length; i++) {
      expect(log[i]!.ts).toBeGreaterThanOrEqual(log[i - 1]!.ts);
    }
  });

  it("accumulates all events in job.output.progressLog", async () => {
    const { engine } = engineHarness();
    const job = stubJob();
    await engine.run(job, project());
    const log = getProgressLog(job);
    const stages = log.map((e) => e.stage);
    expect(stages).toContain("architecture");
    expect(stages).toContain("episode_details");
    expect(stages).toContain("validation");
    expect(stages).toContain("saving");
    expect(stages).toContain("complete");
  });
});

// ---------------------------------------------------------------------------
// Section 2: Resume from cached architecture emits correct events
// ---------------------------------------------------------------------------

describe("Season plan progress events: resume from checkpoint", () => {
  it("emits architecture completed with resume message", async () => {
    const { engine } = engineHarness();
    const arch = architecture(6);
    const job = stubJob({
      output: { seasonArchitecture: arch, episodeDetails: [] as EpisodeDetail[] },
    });
    await engine.run(job, project());
    const log = getProgressLog(job);
    const archEvents = log.filter((e) => e.stage === "architecture");
    const resumeEvent = archEvents.find((e) => e.message.includes("resumed"));
    expect(resumeEvent).toBeDefined();
    expect(resumeEvent?.status).toBe("completed");
    expect(resumeEvent?.totalEpisodes).toBe(6);
  });

  it("does not emit architecture started when resuming", async () => {
    const { engine } = engineHarness();
    const arch = architecture(6);
    const job = stubJob({
      output: { seasonArchitecture: arch, episodeDetails: [] as EpisodeDetail[] },
    });
    await engine.run(job, project());
    const log = getProgressLog(job);
    const archStarted = log.find((e) => e.stage === "architecture" && e.status === "started");
    expect(archStarted).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Section 3: Multi-batch episode details
// ---------------------------------------------------------------------------

describe("Season plan progress events: multi-batch episode details", () => {
  it("emits batch metadata when episode count exceeds batch size", async () => {
    const { engine } = engineHarness({ episodeCount: 12 });
    const job = stubJob({ input: { operation: "generate", episodeCount: 12 } });
    await engine.run(job, project());
    const log = getProgressLog(job);
    const detailsStarted = log.find((e) => e.stage === "episode_details" && e.status === "started");
    expect(detailsStarted?.totalEpisodes).toBe(12);
    expect(detailsStarted?.totalBatches).toBe(2);
    const progressEvents = log.filter(
      (e) => e.stage === "episode_details" && e.status === "progress" && e.batch != null
    );
    expect(progressEvents.length).toBeGreaterThanOrEqual(2);
    expect(progressEvents[0]?.batch).toBe(1);
    expect(progressEvents[1]?.batch).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Section 4: Single-stage fallback emits progress events
// ---------------------------------------------------------------------------

describe("Season plan progress events: single-stage fallback", () => {
  it("emits architecture started and completed for single-stage", async () => {
    const rows: SeasonPlanRecord[] = [];
    const plans = {
      async insert(input: Record<string, unknown>) {
        const record = { ...planContent(), ...(input as Partial<SeasonPlanRecord>), id: `plan-${rows.length + 1}`, version: rows.length + 1, status: "awaiting_approval" as const, validationFindings: null } as SeasonPlanRecord;
        rows.push(record);
        return record;
      },
      async findLatest() { return null; },
      async saveValidationFindings() { return null; },
    };
    const bibles = { async findOwned() { return { approvedVersion: 1, approvedSnapshot: { version: 1, content: bibleContent(), createdAt: now }, creativeDirection: "" } as never; } };
    const stories = { async findProjectDraft() { return storyRecord() as never; } };
    const episodes = { async listOwned() { return []; } };
    const ledgers = { async findLatest() { return null; } };
    const plan = planContent();
    const llm = {
      id: "fake", model: "fake-model",
      async generateSeasonPlan() { return { plan, provider: "fake", model: "fake-model", fallbackFrom: null }; },
    } as never;
    const engine = createSeasonPlanEngine(llm, plans as never, bibles as never, stories as never,
      async (_job: JobRecord, _message: string, output?: Record<string, unknown>) => {
        if (output !== undefined) _job.output = output;
      },
      episodes as never, ledgers as never,
    );
    const job = stubJob();
    await engine.run(job, project());
    const log = getProgressLog(job);
    const archStarted = log.find((e) => e.stage === "architecture" && e.status === "started");
    const archCompleted = log.find((e) => e.stage === "architecture" && e.status === "completed");
    expect(archStarted).toBeDefined();
    expect(archCompleted).toBeDefined();
    expect(archCompleted?.totalEpisodes).toBe(6);
    const valCompleted = log.find((e) => e.stage === "validation" && e.status === "completed");
    expect(valCompleted).toBeDefined();
    const complete = log.find((e) => e.stage === "complete" && e.status === "completed");
    expect(complete).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Section 5: Progress log structure and types
// ---------------------------------------------------------------------------

describe("Season plan progress events: structure", () => {
  it("every event has ts, stage, status, and message", async () => {
    const { engine } = engineHarness();
    const job = stubJob();
    await engine.run(job, project());
    const log = getProgressLog(job);
    for (const event of log) {
      expect(typeof event.ts).toBe("number");
      expect(event.stage).toBeDefined();
      expect(event.status).toBeDefined();
      expect(typeof event.message).toBe("string");
      expect(event.message.length).toBeGreaterThan(0);
    }
  });

  it("stage values are from the allowed set", async () => {
    const { engine } = engineHarness();
    const job = stubJob();
    await engine.run(job, project());
    const log = getProgressLog(job);
    const validStages = ["init", "architecture", "episode_details", "validation", "saving", "complete"];
    for (const event of log) {
      expect(validStages).toContain(event.stage);
    }
  });

  it("status values are from the allowed set", async () => {
    const { engine } = engineHarness();
    const job = stubJob();
    await engine.run(job, project());
    const log = getProgressLog(job);
    const validStatuses = ["started", "progress", "provider_attempt", "provider_success", "provider_failed", "completed", "failed"];
    for (const event of log) {
      expect(validStatuses).toContain(event.status);
    }
  });
});