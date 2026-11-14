import { describe, expect, it } from "vitest";
import type { RequestAuth } from "@/lib/auth/session";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { EpisodeRecord } from "@/lib/validation/episode";
import type { StoryBibleRecord } from "@/lib/validation/storyBible";
import type { EpisodeSuggestionPrompt } from "@/lib/providers/llm/stageTasks";
import { createEpisodeService } from "@/lib/services/episodeService";
import { createEpisodeSuggestEngine } from "@/lib/pipeline/episodeSuggestEngine";
import type { JobRecord } from "@/lib/pipeline/types";

const actor: RequestAuth = {
  userId: "episode-owner",
  isAdmin: false,
  email: "owner@example.com",
  name: "Owner",
  imageUrl: "",
};
const projectId = "a".repeat(24);
const now = new Date().toISOString();

function project(productionMode: ProjectRecord["productionMode"]): ProjectRecord {
  return {
    id: projectId,
    title: "The inheritance",
    originalStoryIdea: "A family uncovers a secret.",
    genre: "family",
    language: "en",
    visualStyle: "realistic",
    tone: "dramatic",
    targetDurationSeconds: 300,
    aspectRatio: "16:9",
    status: "draft",
    workflowMode: "guided",
    productionType: "fictional_drama",
    productionMode,
    createdAt: now,
    updatedAt: now,
  };
}

function episodeRepo(episodes: EpisodeRecord[]) {
  return {
    async listOwned(userId: string, id: string) {
      return userId === actor.userId && id === projectId ? episodes : null;
    },
    async create(userId: string, id: string, input: { title: string; premise: string; targetDurationSeconds: number }, baseSnapshotVersion: number, basePlanVersion = 0) {
      if (userId !== actor.userId || id !== projectId) return null;
      const row: EpisodeRecord = {
        ...input,
        id: String(episodes.length + 1).padStart(24, "0"),
        clerkUserId: userId,
        projectId: id,
        episodeNumber: episodes.length + 1,
        status: "draft",
        currentStoryId: null,
        baseSnapshotVersion,
        basePlanVersion,
        timelineId: null,
        renderAssetId: null,
        createdAt: now,
        updatedAt: now,
      };
      episodes.push(row);
      return row;
    },
  };
}

/** A minimal approved season plan covering enough episodes for these tests. */
function planFixture(bibleVersion: number, version = 1) {
  return {
    version,
    status: "approved" as const,
    basedOnBibleVersion: bibleVersion,
    episodeProgression: Array.from({ length: 12 }, (_, index) => ({ episodeNumber: index + 1 })),
  };
}

/** Build an episodeService wired to in-memory repos with a no-op queue. */
function serviceHarness(mode: ProjectRecord["productionMode"], approvedVersion = 0, bible: StoryBibleRecord | null = null, hasApprovedPlan = false, ledger: { asOfEpisode: number; basedOnPlanVersion: number } | null = null) {
  const episodes: EpisodeRecord[] = [];
  const projects = [project(mode)];
  const inserted: { jobType: string }[] = [];
  const service = createEpisodeService(
    episodeRepo(episodes),
    { async findOwned(userId, id) { return userId === actor.userId && id === projectId ? projects[0]! : null; } },
    { async findLatest() { return null; } },
    {
      async findOwned(userId, id) {
        if (userId !== actor.userId || id !== projectId) return null;
        if (bible) return bible;
        if (approvedVersion === 0) return null;
        return { approvedVersion, premise: "", canonFacts: [], worldRules: [], themes: [], boundaries: [] } as unknown as StoryBibleRecord;
      },
    },
    {
      jobs: {
        async insert(data) { inserted.push(data); return { ...data, id: "job-1", bullJobId: null, startedAt: null, completedAt: null } as unknown as JobRecord; },
        async listByKeyPrefix() { return []; },
        async save(job: JobRecord) { return job; },
      },
      queueFactory: () => ({ async enqueue() {} }),
    },
    {
      async findApproved() { return hasApprovedPlan ? (planFixture(approvedVersion) as never) : null; },
      async findLatest() { return hasApprovedPlan ? (planFixture(approvedVersion) as never) : null; },
    },
    { async findLatest() { return ledger as never; } },
  );
  return { service, episodes, projects, inserted };
}

/** Build an engine harness for testing the generation logic directly. */
function engineHarness(mode: ProjectRecord["productionMode"], approvedVersion = 0, bible: StoryBibleRecord | null = null, plan: unknown = null, ledger: unknown = null) {
  const episodes: EpisodeRecord[] = [];
  const suggestionCalls: EpisodeSuggestionPrompt[] = [];
  const engine = createEpisodeSuggestEngine(
    {
      async generateEpisodeSuggestion(input) {
        suggestionCalls.push(input);
        return { suggestion: { title: "The reading of the will", premise: "The family gathers to hear the will, and the secret named inside it splits them apart." } };
      },
    },
    episodeRepo(episodes),
    {
      async findOwned(userId, id) {
        if (userId !== actor.userId || id !== projectId) return null;
        if (bible) return bible;
        if (approvedVersion === 0) return null;
        return { approvedVersion, premise: "", canonFacts: [], worldRules: [], themes: [], boundaries: [] } as unknown as StoryBibleRecord;
      },
    },
    { async findLatest() { return null; } },
    undefined,
    {
      async findApproved() { return plan as never; },
      async findLatest() { return plan as never; },
    },
    { async findLatest() { return ledger as never; } },
  );
  return { engine, episodes, suggestionCalls };
}

function stubJob(override: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    clerkUserId: actor.userId,
    projectId,
    runId: null,
    sceneNumber: null,
    jobType: "episodeSuggest.generate",
    provider: "pending",
    model: "pending",
    input: {},
    output: null,
    status: "queued",
    progress: { stage: "episodeSuggest.generate", message: "" },
    attempts: 0,
    maxAttempts: 3,
    error: null,
    idempotencyKey: "k",
    bullJobId: null,
    startedAt: null,
    completedAt: null,
    ...override,
  };
}

// ---------------------------------------------------------------------------
// Service: continuity and queue wiring
// ---------------------------------------------------------------------------

describe("episode service — continuity", () => {
  it("numbers episodes in order and binds later serialized episodes to approved canon", async () => {
    const ledger = { asOfEpisode: 0, basedOnPlanVersion: 1 };
    const { service, episodes } = serviceHarness("serialized", 3, null, true, ledger);
    const first = await service.create(actor, projectId, { title: "Arrival", premise: "The secret surfaces.", targetDurationSeconds: 300 });
    expect(first.baseSnapshotVersion).toBe(3);
    expect(first.basePlanVersion).toBe(1);
    // Episode 2 is locked until episode 1 is approved and the ledger catches up.
    await expect(
      service.create(actor, projectId, { title: "Consequences", premise: "The family responds.", targetDurationSeconds: 600 })
    ).rejects.toMatchObject({ code: "episode_locked" });
    episodes[0]!.status = "story_approved";
    ledger.asOfEpisode = 1;
    const second = await service.create(actor, projectId, { title: "Consequences", premise: "The family responds.", targetDurationSeconds: 600 });
    expect([first.episodeNumber, second.episodeNumber]).toEqual([1, 2]);
    expect(second.baseSnapshotVersion).toBe(3);
    expect(episodes).toHaveLength(2);
  });

  it("blocks creating any episode until the Story Bible is approved", async () => {
    const { service } = serviceHarness("serialized");
    await expect(service.create(actor, projectId, { title: "Arrival", premise: "", targetDurationSeconds: 300 }))
      .rejects.toMatchObject({ code: "bible_required" });
  });

  it("does not expose another owner's project episodes", async () => {
    const { service } = serviceHarness("standalone");
    await expect(service.list({ ...actor, userId: "another-user" }, projectId))
      .rejects.toMatchObject({ code: "not_found" });
  });
});

describe("episode service — requestGenerate", () => {
  it("enqueues a job and returns it", async () => {
    const { service, inserted } = serviceHarness("standalone", 1);
    const result = await service.requestGenerate(actor, projectId);
    expect(result.job.jobType).toBe("episodeSuggest.generate");
    expect(inserted).toHaveLength(1);
  });

  it("throws queue_unavailable when the queue is not configured", async () => {
    // Override with a null queue
    const noop = createEpisodeService(
      episodeRepo([]),
      { async findOwned(userId, id) { return userId === actor.userId && id === projectId ? project("standalone") : null; } },
      { async findLatest() { return null; } },
      { async findOwned() { return { approvedVersion: 1, premise: "", canonFacts: [], worldRules: [], themes: [], boundaries: [] } as unknown as StoryBibleRecord; } },
      {
        jobs: {
          async insert(data) { return { ...data, id: "j", bullJobId: null, startedAt: null, completedAt: null } as unknown as JobRecord; },
          async listByKeyPrefix() { return []; },
          async save(job: JobRecord) { return job; },
        },
        queueFactory: () => null,
      },
      {
        async findApproved() { return null; },
        async findLatest() { return null; },
      },
      { async findLatest() { return null; } },
    );
    await expect(noop.requestGenerate(actor, projectId)).rejects.toMatchObject({ code: "queue_unavailable" });
  });

  it("blocks AI episode proposals until the Story Bible is approved", async () => {
    const { service } = serviceHarness("serialized");
    await expect(service.requestGenerate(actor, projectId)).rejects.toMatchObject({ code: "bible_required" });
  });
});

// ---------------------------------------------------------------------------
// Engine: generation logic
// ---------------------------------------------------------------------------

describe("AI episode engine — generation logic", () => {
  it("creates an episode proposed by AI from the approved bible snapshot", async () => {
    const bible = {
      approvedVersion: 3,
      content: {
        identity: {
          title: "The Lantern Keeper",
          genres: ["fantasy"],
          subgenres: [],
          centralPremise: "A keeper guards the last light.",
          narrativeConcept: "",
          toneAndAtmosphere: "",
          targetAudience: "",
          centralConflict: "",
        },
      },
    } as unknown as StoryBibleRecord;
    const { engine, episodes, suggestionCalls } = engineHarness("serialized", 0, bible, planFixture(3));
    const output = await engine.run(stubJob(), project("serialized"));
    expect(output.title).toBe("The reading of the will");
    expect(episodes).toHaveLength(1);
    expect(suggestionCalls).toHaveLength(1);
    expect(suggestionCalls[0]).toMatchObject({
      seriesTitle: "The Lantern Keeper",
      episodeNumber: 1,
      productionMode: "serialized",
      targetDurationSeconds: 300,
    });
    expect(suggestionCalls[0]!.storyBible).toMatchObject({ identity: { title: "The Lantern Keeper" } });
  });

  it("refuses to propose an episode before the Story Bible is approved", async () => {
    const { engine } = engineHarness("standalone");
    await expect(engine.run(stubJob(), project("standalone"))).rejects.toMatchObject({ code: "bible_required" });
  });

  it("lists existing episodes so AI does not repeat plots", async () => {
    const episodes: EpisodeRecord[] = [
      { id: "ep1", clerkUserId: actor.userId, projectId, episodeNumber: 1, title: "Arrival", premise: "The secret surfaces.", targetDurationSeconds: 300, status: "draft", currentStoryId: null, baseSnapshotVersion: 0, basePlanVersion: 0, timelineId: null, renderAssetId: null, createdAt: now, updatedAt: now },
    ];
    const engine = createEpisodeSuggestEngine(
      { async generateEpisodeSuggestion(input) {
        return { suggestion: { title: "Next", premise: "Continuation." }, input };
      } },
      {
        async listOwned() { return episodes; },
        async create(_u, _p, input, snap) {
          const row = { ...input, id: "ep2", clerkUserId: actor.userId, projectId, episodeNumber: 2, status: "draft" as const, currentStoryId: null, baseSnapshotVersion: snap, basePlanVersion: 0, timelineId: null, renderAssetId: null, createdAt: now, updatedAt: now };
          episodes.push(row);
          return row;
        },
      },
      { async findOwned() { return { approvedVersion: 1, premise: "Canon.", canonFacts: [], worldRules: [], themes: [], boundaries: [] } as unknown as StoryBibleRecord; } },
      { async findLatest() { return null; } }
    );
    const out = await engine.run(stubJob(), project("standalone"));
    expect(out.episodeNumber).toBe(2);
  });

  it("rejects generation when there is no story reference at all", async () => {
    const { engine } = engineHarness("standalone", 1);
    const noIdea = { ...project("standalone"), originalStoryIdea: "" };
    await expect(engine.run(stubJob(), noIdea)).rejects.toMatchObject({ code: "reference_required" });
  });

  it("requires an approved bible before generating the next serialized episode", async () => {
    const episodes: EpisodeRecord[] = [
      { id: "ep1", clerkUserId: actor.userId, projectId, episodeNumber: 1, title: "Arrival", premise: "", targetDurationSeconds: 300, status: "draft", currentStoryId: null, baseSnapshotVersion: 0, basePlanVersion: 0, timelineId: null, renderAssetId: null, createdAt: now, updatedAt: now },
    ];
    const engine = createEpisodeSuggestEngine(
      { async generateEpisodeSuggestion(input) { return { suggestion: { title: "X", premise: "Y" }, input }; } },
      { async listOwned() { return episodes; }, async create() { return null; } },
      { async findOwned() { return null; } }, // approvedVersion = 0
      { async findLatest() { return null; } }
    );
    await expect(engine.run(stubJob(), project("serialized"))).rejects.toMatchObject({ code: "bible_required" });
  });
});
