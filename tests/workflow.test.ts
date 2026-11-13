import { describe, expect, it } from "vitest";
import {
  bibleNeedsReview,
  deriveWorkflowStage,
  episodeNeedsReview,
  isAwaitingApproval,
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stage derivation
// ---------------------------------------------------------------------------

describe("workflow stage derivation", () => {
  it("starts at the story stage when nothing is approved", () => {
    expect(deriveWorkflowStage(signals())).toBe("story");
  });

  it("stays at the story stage when a draft is awaiting approval", () => {
    expect(deriveWorkflowStage(signals({ storyDraftStatus: "awaiting_approval" }))).toBe("story");
  });

  it("advances to the bible stage once the story is approved", () => {
    expect(deriveWorkflowStage(signals({ storyDraftStatus: "approved" }))).toBe("bible");
  });

  it("stays at the bible stage while the bible is generating but not yet approved", () => {
    expect(
      deriveWorkflowStage(signals({ storyDraftStatus: "approved", bibleGenerating: true }))
    ).toBe("bible");
  });

  it("advances to the plan stage after the bible is approved", () => {
    expect(
      deriveWorkflowStage(signals({ storyDraftStatus: "approved", bibleApproved: true }))
    ).toBe("plan");
  });

  it("advances to episodes after the season plan is approved", () => {
    expect(
      deriveWorkflowStage(signals({ storyDraftStatus: "approved", bibleApproved: true, planApproved: true }))
    ).toBe("episodes");
  });

  it("advances to production once a production run is active", () => {
    expect(
      deriveWorkflowStage(
        signals({ storyDraftStatus: "approved", bibleApproved: true, planApproved: true, productionActive: true })
      )
    ).toBe("production");
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
  it("marks the story stage as current when nothing is approved", () => {
    const steps = workflowSteps(signals());
    expect(steps.find((s) => s.stage === "story")?.state).toBe("current");
    expect(steps.find((s) => s.stage === "bible")?.state).toBe("upcoming");
    expect(steps.find((s) => s.stage === "plan")?.state).toBe("upcoming");
    expect(steps.find((s) => s.stage === "episodes")?.state).toBe("upcoming");
    expect(steps.find((s) => s.stage === "production")?.state).toBe("upcoming");
  });

  it("marks story as awaiting_approval when a draft is generated but not approved", () => {
    const steps = workflowSteps(signals({ storyDraftStatus: "awaiting_approval" }));
    expect(steps.find((s) => s.stage === "story")?.state).toBe("awaiting_approval");
  });

  it("marks story as completed and bible as current once story is approved", () => {
    const steps = workflowSteps(signals({ storyDraftStatus: "approved" }));
    expect(steps.find((s) => s.stage === "story")?.state).toBe("completed");
    expect(steps.find((s) => s.stage === "bible")?.state).toBe("current");
  });

  it("marks bible as awaiting_approval when a draft is ready but not approved", () => {
    const steps = workflowSteps(
      signals({ storyDraftStatus: "approved", bibleDraftReady: true })
    );
    expect(steps.find((s) => s.stage === "bible")?.state).toBe("awaiting_approval");
  });

  it("marks plan as awaiting_approval when a draft is ready but not approved", () => {
    const steps = workflowSteps(
      signals({ storyDraftStatus: "approved", bibleApproved: true, planDraftReady: true })
    );
    expect(steps.find((s) => s.stage === "plan")?.state).toBe("awaiting_approval");
  });

  it("marks earlier stages as completed when production is active", () => {
    const steps = workflowSteps(
      signals({ storyDraftStatus: "approved", bibleApproved: true, planApproved: true, productionActive: true })
    );
    expect(steps.filter((s) => s.state === "completed")).toHaveLength(4);
    expect(steps.find((s) => s.stage === "production")?.state).toBe("current");
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
