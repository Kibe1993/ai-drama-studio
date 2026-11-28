import { describe, expect, it } from "vitest";
import {
  bibleNeedsReview,
  deriveStepState,
  deriveWorkflowStage,
  episodeNeedsReview,
  isAwaitingApproval,
  isStageCompleted,
  isStageSkipped,
  storyApprovedForProject,
  storyIsApproved,
  workflowSteps,
  type WorkflowSignals,
} from "@/lib/domain/workflow";
import { canTransition } from "@/lib/domain/projectStatus";

// ---------------------------------------------------------------------------
// Helper: build workflow signals for a given project state
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Stage derivation
// ---------------------------------------------------------------------------

describe("workflow stage derivation", () => {
  it("starts at the bible stage when nothing is approved", () => {
    expect(deriveWorkflowStage(signals())).toBe("bible");
  });

  it("stays at the bible stage when a story draft is awaiting approval but no bible exists", () => {
    expect(deriveWorkflowStage(signals({ storyDraftStatus: "awaiting_approval" }))).toBe("bible");
  });

  it("stays at the bible stage while the bible is generating but not yet approved", () => {
    expect(
      deriveWorkflowStage(signals({ bibleGenerating: true }))
    ).toBe("bible");
  });

  it("advances to the story stage once the bible is approved", () => {
    expect(
      deriveWorkflowStage(signals({ bibleApproved: true }))
    ).toBe("story");
  });

  it("advances to the plan stage after the bible and story are approved", () => {
    expect(
      deriveWorkflowStage(signals({ bibleApproved: true, storyDraftStatus: "approved" }))
    ).toBe("episodes");
  });

  it("advances to episodes after the season plan is approved", () => {
    expect(
      deriveWorkflowStage(signals({ bibleApproved: true, storyDraftStatus: "approved", planApproved: true }))
    ).toBe("episodes");
  });

  it("advances to production_design once a production run is active", () => {
    expect(
      deriveWorkflowStage(
        signals({ bibleApproved: true, storyDraftStatus: "approved", planApproved: true, productionActive: true })
      )
    ).toBe("production_design");
  });

  it("falls back to project status for legacy projects without a story draft", () => {
    // A project that was already at characters_ready before guided workflow drafts existed.
    // It has no story draft, but the run-level story was approved and the bible was approved.
    // Legacy projects skip the plan stage when they already have a production run.
    expect(
      deriveWorkflowStage(
        signals({ projectStatus: "characters_ready", runStoryApproved: true, bibleApproved: true, planApproved: true })
      )
    ).toBe("episodes");
  });
});

// ---------------------------------------------------------------------------
// Step states
// ---------------------------------------------------------------------------

describe("workflow step states", () => {
  it("marks the bible stage as current when nothing is approved", () => {
    const steps = workflowSteps(signals());
    expect(steps.find((s) => s.stage === "bible")?.state).toBe("current");
    expect(steps.find((s) => s.stage === "story")?.state).toBe("upcoming");
    expect(steps.find((s) => s.stage === "episodes")?.state).toBe("upcoming");
    expect(steps.find((s) => s.stage === "production_design")?.state).toBe("upcoming");
  });

  it("marks bible as awaiting_approval when a draft is ready but not approved", () => {
    const steps = workflowSteps(
      signals({ bibleDraftReady: true })
    );
    expect(steps.find((s) => s.stage === "bible")?.state).toBe("awaiting_approval");
  });

  it("marks bible as completed and story as current once bible is approved", () => {
    const steps = workflowSteps(signals({ bibleApproved: true }));
    expect(steps.find((s) => s.stage === "bible")?.state).toBe("completed");
    expect(steps.find((s) => s.stage === "story")?.state).toBe("current");
    expect(steps.find((s) => s.stage === "episodes")?.state).toBe("upcoming");
    expect(steps.find((s) => s.stage === "characters")?.state).toBe("upcoming");
    expect(steps.find((s) => s.stage === "scenes")?.state).toBe("upcoming");
  });

  it("marks story as awaiting_approval when a draft is generated but not approved", () => {
    const steps = workflowSteps(
      signals({ bibleApproved: true, storyDraftStatus: "awaiting_approval" })
    );
    expect(steps.find((s) => s.stage === "story")?.state).toBe("awaiting_approval");
  });

  it("marks plan as awaiting_approval when a draft is ready but not approved", () => {
    const steps = workflowSteps(
      signals({ bibleApproved: true, storyDraftStatus: "approved", planDraftReady: true })
    );
    expect(steps.find((s) => s.stage === "episodes")?.state).toBe("awaiting_approval");
  });

  it("marks earlier stages as completed when production is active", () => {
    const steps = workflowSteps(
      signals({
        bibleApproved: true,
        storyDraftStatus: "approved",
        planApproved: true,
        productionActive: true,
        charactersApproved: true,
        scenesApproved: true,
        episodesExist: true,
        canonCommitted: true,
      })
    );
    expect(steps.filter((s) => s.state === "completed")).toHaveLength(11);
    expect(steps.find((s) => s.stage === "production_design")?.state).toBe("current");
  });
});

// ---------------------------------------------------------------------------
// Per-stage state derivation (Fix B)
// ---------------------------------------------------------------------------

describe("per-stage state derivation (Fix B)", () => {
  it("skips episodes and planning in standalone mode", () => {
    const steps = workflowSteps(signals({ productionMode: "standalone" }));
    expect(steps.find((s) => s.stage === "episodes")?.state).toBe("skipped");
    expect(steps.find((s) => s.stage === "planning")?.state).toBe("skipped");
  });

  it("marks episodes as current (not completed) when no artifacts exist", () => {
    const steps = workflowSteps(signals({ bibleApproved: true, storyDraftStatus: "approved" }));
    expect(steps.find((s) => s.stage === "episodes")?.state).toBe("current");
  });

  it("marks characters as upcoming when no artifacts exist", () => {
    const steps = workflowSteps(signals({ bibleApproved: true, storyDraftStatus: "approved" }));
    expect(steps.find((s) => s.stage === "characters")?.state).toBe("upcoming");
  });

  it("marks scenes as upcoming when no artifacts exist", () => {
    const steps = workflowSteps(signals({ bibleApproved: true, storyDraftStatus: "approved" }));
    expect(steps.find((s) => s.stage === "scenes")?.state).toBe("upcoming");
  });

  it("marks characters as completed when charactersApproved", () => {
    const steps = workflowSteps(
      signals({ bibleApproved: true, storyDraftStatus: "approved", charactersApproved: true })
    );
    expect(steps.find((s) => s.stage === "characters")?.state).toBe("completed");
  });

  it("marks scenes as completed when scenesApproved", () => {
    const steps = workflowSteps(
      signals({ bibleApproved: true, storyDraftStatus: "approved", scenesApproved: true })
    );
    expect(steps.find((s) => s.stage === "scenes")?.state).toBe("completed");
  });

  it("marks episodes as not completed when planApproved but no episodes", () => {
    const steps = workflowSteps(
      signals({ bibleApproved: true, storyDraftStatus: "approved", planApproved: true, episodesExist: false })
    );
    expect(steps.find((s) => s.stage === "episodes")?.state).toBe("current");
  });

  it("marks episodes as completed when planApproved and episodesExist", () => {
    const steps = workflowSteps(
      signals({
        bibleApproved: true,
        storyDraftStatus: "approved",
        planApproved: true,
        episodesExist: true,
        productionActive: true,
      })
    );
    expect(steps.find((s) => s.stage === "episodes")?.state).toBe("completed");
  });

  it("marks rendering as completed only when projectStatus is completed", () => {
    const steps = workflowSteps(
      signals({
        bibleApproved: true,
        storyDraftStatus: "approved",
        planApproved: true,
        productionActive: true,
        projectStatus: "completed",
        episodesExist: true,
        charactersApproved: true,
        scenesApproved: true,
        canonCommitted: true,
      })
    );
    expect(steps.find((s) => s.stage === "rendering")?.state).toBe("completed");
  });

  it("marks rendering as upcoming when production active but not completed", () => {
    const steps = workflowSteps(
      signals({
        bibleApproved: true,
        storyDraftStatus: "approved",
        planApproved: true,
        productionActive: true,
        projectStatus: "rendering",
        episodesExist: true,
        charactersApproved: true,
        scenesApproved: true,
        canonCommitted: true,
      })
    );
    expect(steps.find((s) => s.stage === "rendering")?.state).toBe("upcoming");
  });

  it("skipped takes precedence over completed", () => {
    const steps = workflowSteps(
      signals({
        productionMode: "standalone",
        bibleApproved: true,
        storyDraftStatus: "approved",
        planApproved: true,
        episodesExist: true,
      })
    );
    expect(steps.find((s) => s.stage === "episodes")?.state).toBe("skipped");
  });
});

// ---------------------------------------------------------------------------
// isStageCompleted and isStageSkipped predicates
// ---------------------------------------------------------------------------

describe("isStageCompleted and isStageSkipped predicates", () => {
  it("isStageSkipped returns true for planning and episodes in standalone mode", () => {
    const s = signals({ productionMode: "standalone" });
    expect(isStageSkipped("planning", s)).toBe(true);
    expect(isStageSkipped("episodes", s)).toBe(true);
  });

  it("isStageSkipped returns false for planning and episodes in serialized mode", () => {
    const s = signals({ productionMode: "serialized" });
    expect(isStageSkipped("planning", s)).toBe(false);
    expect(isStageSkipped("episodes", s)).toBe(false);
  });

  it("isStageSkipped returns false for all other stages in standalone mode", () => {
    const s = signals({ productionMode: "standalone" });
    expect(isStageSkipped("bible", s)).toBe(false);
    expect(isStageSkipped("story", s)).toBe(false);
    expect(isStageSkipped("characters", s)).toBe(false);
    expect(isStageSkipped("scenes", s)).toBe(false);
    expect(isStageSkipped("rendering", s)).toBe(false);
  });

  it("isStageCompleted returns true for project_setup always", () => {
    expect(isStageCompleted("project_setup", signals())).toBe(true);
  });

  it("isStageCompleted returns bibleApproved for planning and bible", () => {
    expect(isStageCompleted("planning", signals({ bibleApproved: false }))).toBe(false);
    expect(isStageCompleted("planning", signals({ bibleApproved: true }))).toBe(true);
    expect(isStageCompleted("bible", signals({ bibleApproved: false }))).toBe(false);
    expect(isStageCompleted("bible", signals({ bibleApproved: true }))).toBe(true);
  });

  it("isStageCompleted returns planApproved && episodesExist for episodes", () => {
    expect(isStageCompleted("episodes", signals({ planApproved: true, episodesExist: false }))).toBe(false);
    expect(isStageCompleted("episodes", signals({ planApproved: false, episodesExist: true }))).toBe(false);
    expect(isStageCompleted("episodes", signals({ planApproved: true, episodesExist: true }))).toBe(true);
  });

  it("isStageCompleted returns charactersApproved for characters", () => {
    expect(isStageCompleted("characters", signals({ charactersApproved: false }))).toBe(false);
    expect(isStageCompleted("characters", signals({ charactersApproved: true }))).toBe(true);
  });

  it("isStageCompleted returns scenesApproved for scenes", () => {
    expect(isStageCompleted("scenes", signals({ scenesApproved: false }))).toBe(false);
    expect(isStageCompleted("scenes", signals({ scenesApproved: true }))).toBe(true);
  });

  it("isStageCompleted returns canonCommitted for canon", () => {
    expect(isStageCompleted("canon", signals({ canonCommitted: false }))).toBe(false);
    expect(isStageCompleted("canon", signals({ canonCommitted: true }))).toBe(true);
  });

  it("isStageCompleted returns productionActive for production stages", () => {
    expect(isStageCompleted("production_design", signals({ productionActive: false }))).toBe(false);
    expect(isStageCompleted("production_design", signals({ productionActive: true }))).toBe(true);
    expect(isStageCompleted("audio", signals({ productionActive: true }))).toBe(true);
    expect(isStageCompleted("video", signals({ productionActive: true }))).toBe(true);
    expect(isStageCompleted("timeline", signals({ productionActive: true }))).toBe(true);
  });

  it("isStageCompleted returns productionActive && projectStatus==='completed' for rendering", () => {
    expect(isStageCompleted("rendering", signals({ productionActive: true, projectStatus: "rendering" }))).toBe(false);
    expect(isStageCompleted("rendering", signals({ productionActive: true, projectStatus: "completed" }))).toBe(true);
    expect(isStageCompleted("rendering", signals({ productionActive: false, projectStatus: "completed" }))).toBe(false);
  });

  it("deriveStepState evaluates skipped before completed", () => {
    const s = signals({ productionMode: "standalone", bibleApproved: true });
    expect(deriveStepState("episodes", "story", s)).toBe("skipped");
  });

  it("deriveStepState returns current for the current stage", () => {
    const s = signals({ bibleApproved: true });
    expect(deriveStepState("story", "story", s)).toBe("current");
  });

  it("deriveStepState returns awaiting_approval for current stage awaiting approval", () => {
    const s = signals({ bibleDraftReady: true });
    expect(deriveStepState("bible", "bible", s)).toBe("awaiting_approval");
  });
});

// ---------------------------------------------------------------------------
// Story approval checks
// ---------------------------------------------------------------------------

describe("story approval enforcement", () => {
  it("does not consider a project 'story approved' when only a draft exists", () => {
    expect(storyApprovedForProject("draft", "awaiting_approval")).toBe(false);
  });

  it("does not consider a failed draft as approved", () => {
    expect(storyApprovedForProject("draft", "failed")).toBe(false);
  });

  it("requires an explicit approved status", () => {
    expect(storyApprovedForProject("draft", "approved")).toBe(true);
  });

  it("rejects null story draft and a draft status as not approved", () => {
    expect(storyIsApproved(signals({ storyDraftStatus: null, runStoryApproved: false }))).toBe(false);
  });

  it("accepts a run-level approved story as a fallback", () => {
    expect(storyIsApproved(signals({ runStoryApproved: true }))).toBe(true);
  });

  it("marks story as awaiting approval only when a draft exists and is awaiting", () => {
    expect(isAwaitingApproval("story", signals({ storyDraftStatus: "awaiting_approval" }))).toBe(true);
    expect(isAwaitingApproval("story", signals({ storyDraftStatus: "approved" }))).toBe(false);
    expect(isAwaitingApproval("story", signals({ storyDraftStatus: null }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Downstream invalidation / review flags
// ---------------------------------------------------------------------------

describe("downstream invalidation on earlier-stage changes", () => {
  it("flags the Story Bible for review when the approved story changes", () => {
    expect(
      bibleNeedsReview({
        bibleApproved: true,
        basedOnStoryId: "old-story-id",
        currentStoryId: "new-story-id",
      })
    ).toBe(true);
  });

  it("does not flag the Story Bible when the story hasn't changed", () => {
    expect(
      bibleNeedsReview({
        bibleApproved: true,
        basedOnStoryId: "same-story-id",
        currentStoryId: "same-story-id",
      })
    ).toBe(false);
  });

  it("does not flag the Bible when it was never approved", () => {
    expect(
      bibleNeedsReview({ bibleApproved: false, basedOnStoryId: null, currentStoryId: "new" })
    ).toBe(false);
  });

  it("does not flag the Bible when it has no basedOnStoryId (legacy)", () => {
    expect(
      bibleNeedsReview({ bibleApproved: true, basedOnStoryId: null, currentStoryId: "new" })
    ).toBe(false);
  });

  it("flags an episode for review when its base snapshot is behind the current Bible version", () => {
    expect(
      episodeNeedsReview({ bibleApprovedVersion: 3, episodeBaseSnapshotVersion: 2 })
    ).toBe(true);
  });

  it("does not flag an episode when its snapshot matches the current Bible version", () => {
    expect(
      episodeNeedsReview({ bibleApprovedVersion: 3, episodeBaseSnapshotVersion: 3 })
    ).toBe(false);
  });

  it("does not flag an episode when the Bible was never approved", () => {
    expect(
      episodeNeedsReview({ bibleApprovedVersion: 0, episodeBaseSnapshotVersion: 0 })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Project status transition enforcement
// ---------------------------------------------------------------------------

describe("project status transition enforcement", () => {
  it("allows draft → story_ready (story approval)", () => {
    expect(canTransition("draft", "story_ready")).toBe(true);
  });

  it("allows story_ready → planning (going back to revise)", () => {
    expect(canTransition("story_ready", "planning")).toBe(true);
  });

  it("blocks skipping from draft directly to generating", () => {
    expect(canTransition("draft", "generating")).toBe(false);
  });

  it("blocks skipping from draft directly to characters_ready", () => {
    expect(canTransition("draft", "characters_ready")).toBe(false);
  });

  it("blocks transitioning from failed to any stage except archive or checkpoint", () => {
    expect(canTransition("failed", "generating")).toBe(false);
    expect(canTransition("failed", "rendering")).toBe(false);
    expect(canTransition("failed", "archived")).toBe(true);
  });

  it("allows completed → planning (returning to create more episodes)", () => {
    expect(canTransition("completed", "planning")).toBe(true);
  });

  it("blocks transitioning from archived directly to generating", () => {
    expect(canTransition("archived", "generating")).toBe(false);
    expect(canTransition("archived", "draft")).toBe(true);
  });
});
