import { describe, expect, it } from "vitest";
import {
  WORKFLOW_STAGES,
  deriveWorkflowStage,
  workflowSteps,
  type WorkflowSignals,
} from "@/lib/domain/workflow";
import { createWorkflowService } from "@/lib/services/workflowService";
import type { RequestAuth } from "@/lib/auth/session";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";

const actor: RequestAuth = {
  userId: "user_owner",
  isAdmin: false,
  email: "owner@example.com",
  name: "Owner",
  imageUrl: "",
};

const projectId = "a".repeat(24);
const now = new Date().toISOString();

function projectRecord(status: ProjectRecord["status"] = "draft"): ProjectRecord {
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

function signals(overrides: Partial<WorkflowSignals> = {}): WorkflowSignals {
  return {
    projectStatus: "draft",
    storyDraftStatus: null,
    runStoryApproved: false,
    bibleApproved: false,
    bibleDraftReady: false,
    bibleGenerating: false,
    planApproved: false,
    planDraftReady: false,
    planGenerating: false,
    productionActive: false,
    charactersApproved: false,
    scenesApproved: false,
    episodesExist: false,
    productionMode: "serialized",
    canonCommitted: false,
    ...overrides,
  };
}

describe("WorkflowStepper regression: steps must never be undefined", () => {
  it("workflowSteps() always returns an array with one entry per stage", () => {
    for (const status of ["draft", "story_ready", "characters_ready", "completed"] as const) {
      const steps = workflowSteps(signals({ projectStatus: status }));
      expect(Array.isArray(steps)).toBe(true);
      expect(steps).toHaveLength(WORKFLOW_STAGES.length);
      for (const step of steps) {
        expect(typeof step.stage).toBe("string");
        expect(typeof step.label).toBe("string");
        expect(typeof step.state).toBe("string");
      }
    }
  });

  it("workflowSteps() returns a non-empty array even with all-false signals", () => {
    const steps = workflowSteps(signals());
    expect(steps.length).toBeGreaterThan(0);
  });

  it("deriveWorkflowStage() always returns a valid stage string", () => {
    const variants: Partial<WorkflowSignals>[] = [
      {},
      { bibleApproved: true },
      { bibleApproved: true, storyDraftStatus: "approved" },
      { bibleApproved: true, storyDraftStatus: "approved", planApproved: true },
      { bibleApproved: true, storyDraftStatus: "approved", planApproved: true, productionActive: true },
    ];
    for (const override of variants) {
      const stage = deriveWorkflowStage(signals(override));
      expect(WORKFLOW_STAGES).toContain(stage);
      expect(typeof stage).toBe("string");
    }
  });

  it("the workflow service always returns steps as an array and stage as a string", async () => {
    const service = createWorkflowService({
      projects: {
        async findOwned(userId, id) {
          return userId === actor.userId && id === projectId ? projectRecord() : null;
        },
      },
      runs: { async findLatest() { return null; } },
      stories: {
        async findForRun() { return null; },
        async findProjectDraft() { return null; },
      },
      bibles: { async findOwned() { return null; } },
      episodes: { async listOwned() { return null; } },
      plans: {
        async findLatest() { return null; },
        async findApproved() { return null; },
      },
      ledgers: { async findLatest() { return null; } },
    });

    const state = await service.get(actor, projectId);

    expect(Array.isArray(state.steps)).toBe(true);
    expect(state.steps).toHaveLength(WORKFLOW_STAGES.length);
    expect(typeof state.stage).toBe("string");
    expect(WORKFLOW_STAGES).toContain(state.stage);
  });

  it("the workflow service returns steps and stage even when the project is fully completed", async () => {
    const run = {
      id: "run-1",
      clerkUserId: actor.userId,
      projectId,
      episode: null,
      workflowMode: "guided" as const,
      currentStage: "done" as const,
      status: "completed" as const,
      stageResults: {
        story: { title: "T", synopsis: "S", approved: true, storyId: "f".repeat(24), sourceCanonVersion: 1 },
        characters: { approved: true },
        scenes: { approved: true },
        media: {},
        render: {},
      },
      retryCheckpoint: null,
      startedAt: now,
      completedAt: now,
    };

    const approvedPlan = {
      id: "b".repeat(24),
      version: 1,
      status: "approved" as const,
      basedOnBibleVersion: 1,
      episodeProgression: [{ episodeNumber: 1 }],
    };

    const service = createWorkflowService({
      projects: {
        async findOwned(userId, id) {
          return userId === actor.userId && id === projectId ? projectRecord("completed") : null;
        },
      },
      runs: {
        async findLatest(userId, id) {
          return userId === actor.userId && id === projectId ? run as never : null;
        },
      },
      stories: {
        async findForRun() { return null; },
        async findProjectDraft() {
          return { status: "approved" } as never;
        },
      },
      bibles: {
        async findOwned() {
          return { approvedVersion: 1, generationStatus: "idle", draftRevision: 1, premise: "Test.", canonFacts: [], content: null } as never;
        },
      },
      episodes: {
        async listOwned() { return []; },
      },
      plans: {
        async findLatest() { return approvedPlan as never; },
        async findApproved() { return approvedPlan as never; },
      },
      ledgers: { async findLatest() { return null; } },
    });

    const state = await service.get(actor, projectId);

    expect(Array.isArray(state.steps)).toBe(true);
    expect(state.steps).toHaveLength(WORKFLOW_STAGES.length);
    expect(typeof state.stage).toBe("string");
    expect(WORKFLOW_STAGES).toContain(state.stage);
  });
});