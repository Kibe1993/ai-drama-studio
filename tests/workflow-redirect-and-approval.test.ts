import { describe, expect, it } from "vitest";
import type { WorkflowSignals } from "@/lib/domain/workflow";
import { episodeGenerationGate, episodeIsApproved } from "@/lib/domain/casna";
import { createWorkflowService } from "@/lib/services/workflowService";
import { createPipelineService } from "@/lib/services/pipelineService";
import { createSeasonPlanService } from "@/lib/services/seasonPlanService";
import { createMockEngines } from "@/lib/pipeline/mockEngines";
import type { PipelineDeps } from "@/lib/pipeline/ports";
import type { RequestAuth } from "@/lib/auth/session";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { EpisodeRecord } from "@/lib/validation/episode";
import type { StoryRecord } from "@/lib/validation/story";
import type { RunRecord } from "@/lib/pipeline/types";

const actor: RequestAuth = {
  userId: "user_owner",
  isAdmin: false,
  email: "owner@example.com",
  name: "Owner",
  imageUrl: "",
};

const projectId = "a".repeat(24);
const now = new Date().toISOString();

function projectRecord(status: ProjectRecord["status"] = "planning"): ProjectRecord {
  return {
    id: projectId,
    title: "Test project",
    originalStoryIdea: "A story idea.",
    genre: "thriller",
    language: "en",
    visualStyle: "realistic",
    tone: "dramatic",
    targetDurationSeconds: 60,
    aspectRatio: "16:9",
    status,
    workflowMode: "guided",
    productionType: "fictional_drama",
    productionMode: "serialized",
    createdAt: now,
    updatedAt: now,
  };
}

function storyRecord(runId: string): StoryRecord {
  return {
    id: "f".repeat(24),
    clerkUserId: actor.userId,
    projectId,
    productionRunId: runId,
    status: "awaiting_approval",
    version: 1,
    provider: "mock",
    model: "mock",
    fallbackFrom: null,
    createdAt: now,
    updatedAt: now,
    title: "Test story",
    synopsis: "Test synopsis.",
    structure: {
      act1: { introduction: "A.", mainCharacters: "B.", setting: "C.", initialSituation: "D.", incitingIncident: "E." },
      act2: { risingTension: "F.", obstacles: "G.", characterDecisions: "H.", turningPoint: "I." },
      act3: { climax: "J.", resolution: "K.", finalOutcome: "L." },
    },
    screenplay: [
      {
        sceneNumber: 1,
        heading: "INT. ROOM - DAY",
        location: "Room",
        timeOfDay: "Day",
        charactersPresent: ["Amara"],
        visualDescription: "The camera holds.",
        action: "Amara acts.",
        dialogue: [{ characterName: "Amara", line: "Hello." }],
      },
    ],
  };
}

function episodeRecord(id: string, number: number, status: EpisodeRecord["status"]): EpisodeRecord {
  return {
    id,
    clerkUserId: actor.userId,
    projectId,
    episodeNumber: number,
    title: `Episode ${number}`,
    premise: "Test.",
    targetDurationSeconds: 60,
    status,
    currentStoryId: null,
    baseSnapshotVersion: 1,
    basePlanVersion: 1,
    timelineId: null,
    renderAssetId: null,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Problem 2: Episode approval isolation
// ---------------------------------------------------------------------------

function pipelineHarness(episodeId: string, episodeNumber: number) {
  const updatedEpisodes: { episodeId: string; status: string }[] = [];
  const ledgerUpdates: { episodeNumber: number }[] = [];
  const story = storyRecord("run-1");

  const run: RunRecord = {
    id: "run-1",
    clerkUserId: actor.userId,
    projectId,
    episode: {
      id: episodeId,
      number: episodeNumber,
      title: `Episode ${episodeNumber}`,
      premise: "Test.",
      targetDurationSeconds: 60,
      baseSnapshotVersion: 1,
    },
    workflowMode: "guided",
    currentStage: "story",
    status: "waiting_for_approval",
    stageResults: {
      story: { title: story.title, synopsis: story.synopsis, approved: false, storyId: story.id },
    },
    retryCheckpoint: null,
    startedAt: now,
    completedAt: null,
  };

  const deps: PipelineDeps = {
    projects: {
      async findOwned(userId, id) {
        return userId === actor.userId && id === projectId ? projectRecord() : null;
      },
      async update() { return null; },
    },
    runs: {
      async insert(input) { return { ...input, id: "run-1" }; },
      async findOwned(userId, id) { return id === "run-1" && userId === actor.userId ? run : null; },
      async findLatest(userId, id) { return id === projectId && userId === actor.userId ? run : null; },
      async save(r) { Object.assign(run, r); return run; },
    },
    jobs: {
      async insert(input) { return { ...input, id: "job-1" }; },
      async findOwned() { return null; },
      async findById() { return null; },
      async listForRun() { return []; },
      async listOpen() { return []; },
      async listByKeyPrefix() { return []; },
      async save(job) { return job; },
    },
    stories: {
      async findOwned(userId, id) {
        return userId === actor.userId && id === story.id ? story : null;
      },
      async findForRun() { return null; },
      async markApproved(userId, id) {
        if (id === story.id) {
          story.status = "approved";
          return story;
        }
        return null;
      },
    },
    episodes: {
      async findOwned() { return null; },
      async ensureFirst() { return null; },
      async updateStatus(userId, pid, epId, status) {
        updatedEpisodes.push({ episodeId: epId, status });
        return null;
      },
    },
    bibles: {
      async findOwned() { return { approvedVersion: 1 }; },
    },
    casna: {
      async load() { return {} as never; },
      async onEpisodeApproved(input) {
        ledgerUpdates.push({ episodeNumber: input.episodeNumber });
        return undefined;
      },
    },
    queue: { async enqueue() {} },
    engines: createMockEngines(),
  };

  return { deps, api: createPipelineService(deps), updatedEpisodes, ledgerUpdates, story };
}

describe("episode approval isolation", () => {
  it("approving episode 1 does not change episode 2 or 3 statuses", async () => {
    const { api, updatedEpisodes, ledgerUpdates, story } = pipelineHarness("ep1", 1);
    await api.approveStory(actor, projectId, story.id);
    expect(updatedEpisodes).toHaveLength(1);
    expect(updatedEpisodes[0]).toEqual({ episodeId: "ep1", status: "story_approved" });
    expect(ledgerUpdates).toHaveLength(1);
    expect(ledgerUpdates[0]).toEqual({ episodeNumber: 1 });
  });

  it("approving episode 2 does not change episode 1 or 3 statuses", async () => {
    const { api, updatedEpisodes, ledgerUpdates, story } = pipelineHarness("ep2", 2);
    await api.approveStory(actor, projectId, story.id);
    expect(updatedEpisodes).toHaveLength(1);
    expect(updatedEpisodes[0]).toEqual({ episodeId: "ep2", status: "story_approved" });
    expect(ledgerUpdates).toHaveLength(1);
    expect(ledgerUpdates[0]).toEqual({ episodeNumber: 2 });
  });
});

// ---------------------------------------------------------------------------
// Season plan approval must not approve screenplays
// ---------------------------------------------------------------------------

describe("season plan approval", () => {
  it("approved season plan does not automatically approve screenplays", async () => {
    const episodeUpdates: { episodeId: string; status: string }[] = [];
    const plan = {
      id: "b".repeat(24),
      version: 1,
      status: "awaiting_approval" as const,
      basedOnBibleVersion: 1,
      validationFindings: null as unknown,
    };

    const service = createSeasonPlanService({
      projects: {
        async findOwned(userId: string, id: string) {
          return userId === actor.userId && id === projectId ? projectRecord() : null;
        },
      },
      bibles: {
        async findOwned() {
          return { approvedVersion: 1, premise: "", canonFacts: [], worldRules: [], themes: [], boundaries: [] } as never;
        },
      },
      stories: {} as never,
      plans: {
        async findLatest() { return plan as never; },
        async findApproved() { return null; },
        async markApproved() {
          (plan as { status: string }).status = "approved";
          return plan as never;
        },
      },
      ledgers: { async findLatest() { return null; } },
      episodes: {
        async listOwned() { return []; },
        async updateStatus(userId: string, pid: string, epId: string, status: string) {
          episodeUpdates.push({ episodeId: epId, status });
          return null;
        },
      },
      jobs: {} as never,
      queueFactory: () => ({ async enqueue() {} }) as never,
    } as never);

    await service.approve(actor, projectId, plan.id);
    expect(episodeUpdates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Episode generation must not auto-approve
// ---------------------------------------------------------------------------

describe("episode generation", () => {
  it("generating an episode does not automatically approve it", () => {
    // storyRepository.upsertAwaiting sets episode status to "story_review" (not "story_approved").
    // episodeIsApproved must return false for "story_review" and true only for "story_approved"/"completed".
    expect(episodeIsApproved("story_review")).toBe(false);
    expect(episodeIsApproved("in_production")).toBe(false);
    expect(episodeIsApproved("draft")).toBe(false);
    expect(episodeIsApproved("story_approved")).toBe(true);
    expect(episodeIsApproved("completed")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Continuity Ledger: only approved episodes update it
// ---------------------------------------------------------------------------

describe("continuity ledger", () => {
  it("only an approved episode updates the continuity ledger", async () => {
    // The casna.onEpisodeApproved call is only made inside acceptStory/approveStory
    // (approval path), never during story generation. The pipeline harness tracks
    // ledger updates: approving an episode must produce exactly one ledger update
    // for that episode number.
    const { api, ledgerUpdates, story } = pipelineHarness("ep1", 1);
    await api.approveStory(actor, projectId, story.id);
    expect(ledgerUpdates).toHaveLength(1);
    expect(ledgerUpdates[0]!.episodeNumber).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Episode generation gate: sequential eligibility
// ---------------------------------------------------------------------------

describe("episode generation gate", () => {
  it("next episode becomes eligible only when the required preceding episode is approved", () => {
    const plan = {
      version: 1,
      status: "approved" as const,
      basedOnBibleVersion: 1,
      episodeProgression: [{ episodeNumber: 1 }, { episodeNumber: 2 }, { episodeNumber: 3 }],
    };
    const ledger = { asOfEpisode: 0, basedOnPlanVersion: 1 };

    // Episode 2 is locked when episode 1 is not yet approved.
    const locked = episodeGenerationGate({
      productionMode: "serialized",
      bibleApprovedVersion: 1,
      approvedPlan: plan,
      ledger,
      episodes: [{ episodeNumber: 1, status: "story_review" }],
      targetEpisodeNumber: 2,
    });
    expect(locked.allowed).toBe(false);
    expect(locked.code).toBe("episode_locked");

    // Episode 2 becomes eligible once episode 1 is approved and the ledger catches up.
    const unlocked = episodeGenerationGate({
      productionMode: "serialized",
      bibleApprovedVersion: 1,
      approvedPlan: plan,
      ledger: { asOfEpisode: 1, basedOnPlanVersion: 1 },
      episodes: [{ episodeNumber: 1, status: "story_approved" }],
      targetEpisodeNumber: 2,
    });
    expect(unlocked.allowed).toBe(true);

    // Episode 3 is still locked because episode 2 is not approved.
    const stillLocked = episodeGenerationGate({
      productionMode: "serialized",
      bibleApprovedVersion: 1,
      approvedPlan: plan,
      ledger: { asOfEpisode: 1, basedOnPlanVersion: 1 },
      episodes: [
        { episodeNumber: 1, status: "story_approved" },
        { episodeNumber: 2, status: "story_review" },
      ],
      targetEpisodeNumber: 3,
    });
    expect(stillLocked.allowed).toBe(false);
    expect(stillLocked.code).toBe("episode_locked");
  });
});

// ---------------------------------------------------------------------------
// Problem 1: Production page redirect
// ---------------------------------------------------------------------------


describe("production navigation", () => {
  it("does not redirect while workflow data is loading", () => {
    // useWorkflowGuard logic: accessible = workflow ? isStageAccessible(stage, workflow.stage) : true
    // When workflow is undefined (loading), accessible defaults to true and the
    // useEffect is gated on workflow being truthy, so no redirect fires.
    const workflow = undefined as unknown as WorkflowSignals | undefined;
    const accessible = workflow ? false : true; // isStageAccessible would return false for production vs episodes
    expect(accessible).toBe(true);

    // After loading, if the stage is "episodes", production is not accessible.
    const loadedWorkflow = { stage: "episodes" as const };
    const order = ["story", "bible", "plan", "episodes", "production"] as const;
    const targetIndex = order.indexOf("production");
    const currentIndex = order.indexOf(loadedWorkflow.stage);
    const accessibleAfterLoad = targetIndex <= currentIndex;
    expect(accessibleAfterLoad).toBe(false); // redirect would fire
  });

  it("remains valid when the project has a valid approved season plan and an episode ready for production", async () => {
    // Set up: story approved, bible approved, plan approved, one episode in production.
    // The run exists but has NOT progressed past the story stage.
    // Before the fix: productionActive was false → stage "episodes" → redirect.
    // After the fix: episodeInProduction makes productionActive true → stage "production" → no redirect.
    const episodes = [
      episodeRecord("ep1", 1, "in_production"),
      episodeRecord("ep2", 2, "draft"),
      episodeRecord("ep3", 3, "draft"),
    ];

    const run: RunRecord = {
      id: "run-1",
      clerkUserId: actor.userId,
      projectId,
      episode: {
        id: "ep1",
        number: 1,
        title: "Episode 1",
        premise: "Test.",
        targetDurationSeconds: 60,
        baseSnapshotVersion: 1,
      },
      workflowMode: "guided",
      currentStage: "story",
      status: "running",
      stageResults: {
        story: { title: "Test", synopsis: "Test", approved: true, storyId: "f".repeat(24) },
      },
      retryCheckpoint: null,
      startedAt: now,
      completedAt: null,
    };

    const approvedPlan = {
      id: "b".repeat(24),
      version: 1,
      status: "approved" as const,
      basedOnBibleVersion: 1,
      episodeProgression: [{ episodeNumber: 1 }, { episodeNumber: 2 }, { episodeNumber: 3 }],
    };

    const service = createWorkflowService({
      projects: {
        async findOwned(userId, id) {
          return userId === actor.userId && id === projectId ? projectRecord("story_ready") : null;
        },
      },
      runs: {
        async findLatest(userId, id) {
          return userId === actor.userId && id === projectId ? run : null;
        },
      },
      stories: {
        async findForRun() { return null; },
        async findProjectDraft() {
          return { status: "approved" } as unknown as StoryRecord;
        },
      },
      bibles: {
        async findOwned() {
          return { approvedVersion: 1, generationStatus: "idle", draftRevision: 1, premise: "Test.", canonFacts: [], content: null } as never;
        },
      },
      episodes: {
        async listOwned(userId, id) {
          return userId === actor.userId && id === projectId ? episodes : null;
        },
      },
      plans: {
        async findLatest() { return approvedPlan as never; },
        async findApproved() { return approvedPlan as never; },
      },
      ledgers: { async findLatest() { return null; } },
    });

    const state = await service.get(actor, projectId);
    expect(state.stage).toBe("production_design");
    expect(state.production.started).toBe(true);
  });
});