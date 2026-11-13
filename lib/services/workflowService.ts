import "server-only";
import type { RequestAuth } from "@/lib/auth/session";
import type { ProjectStatus } from "@/lib/domain/projectCatalog";
import {
  bibleNeedsReview,
  deriveWorkflowStage,
  episodeNeedsReview,
  storyAwaitingApproval,
  storyIsApproved,
  workflowSteps,
  type WorkflowSignals,
  type WorkflowStage,
  type WorkflowStep,
} from "@/lib/domain/workflow";
import { StudioError } from "@/lib/http/errors";
import { isObjectId } from "@/lib/repositories/ownership";
import {
  episodeGenerationGate,
  episodeNeedsPlanReview,
  nextEpisodeNumber,
} from "@/lib/domain/casna";
import { episodeRepository } from "@/lib/repositories/episodeRepository";
import { projectRepository } from "@/lib/repositories/projectRepository";
import { productionRunRepository } from "@/lib/repositories/productionRunRepository";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { seasonPlanRepository } from "@/lib/repositories/seasonPlanRepository";
import { continuityLedgerRepository } from "@/lib/repositories/continuityLedgerRepository";

export type WorkflowState = {
  projectId: string;
  status: ProjectStatus;
  stage: WorkflowStage;
  steps: WorkflowStep[];
  story: { exists: boolean; approved: boolean; awaitingApproval: boolean; failed: boolean };
  bible: {
    approved: boolean;
    approvedVersion: number;
    draftRevision: number;
    draftReady: boolean;
    generating: boolean;
    failed: boolean;
    needsReview: boolean;
  };
  plan: {
    exists: boolean;
    approved: boolean;
    awaitingApproval: boolean;
    failed: boolean;
    version: number;
    needsReview: boolean;
  };
  episodes: {
    total: number;
    open: number;
    needingReview: number;
    /** The next episode the creator can work on. */
    nextNumber: number;
    /** Whether the next episode is locked, and why. */
    nextLocked: boolean;
    nextLockReason: string | null;
  };
  production: { started: boolean };
  /** Why the next stage is unavailable, if it is. */
  blockedReason: string | null;
};

type ProjectPort = Pick<typeof projectRepository, "findOwned">;
type RunPort = Pick<typeof productionRunRepository, "findLatest">;
type StoryPort = Pick<typeof storyRepository, "findForRun" | "findProjectDraft">;
type BiblePort = Pick<typeof storyBibleRepository, "findOwned">;
type EpisodePort = Pick<typeof episodeRepository, "listOwned">;
type PlanPort = Pick<typeof seasonPlanRepository, "findLatest" | "findApproved">;
type LedgerPort = Pick<typeof continuityLedgerRepository, "findLatest">;

export type WorkflowPorts = {
  projects: ProjectPort;
  runs: RunPort;
  stories: StoryPort;
  bibles: BiblePort;
  episodes: EpisodePort;
  plans: PlanPort;
  ledgers: LedgerPort;
};

function hasBibleContent(bible: {
  content?: unknown;
  premise: string;
  canonFacts: string[];
}): boolean {
  return Boolean(bible.content) || bible.premise.trim().length > 0 || bible.canonFacts.length > 0;
}

export function createWorkflowService(ports: WorkflowPorts) {
  return {
    async get(actor: RequestAuth, projectId: string): Promise<WorkflowState> {
      if (!isObjectId(projectId)) throw new StudioError("That project id is not valid", 400, "invalid_id");
      const project = await ports.projects.findOwned(actor.userId, projectId);
      if (!project) throw new StudioError("Project not found", 404, "not_found");

      const run = await ports.runs.findLatest(actor.userId, projectId);
      const story = run ? await ports.stories.findForRun(actor.userId, run.id) : null;
      const storyDraft = await ports.stories.findProjectDraft(actor.userId, projectId);
      const bible = await ports.bibles.findOwned(actor.userId, projectId);
      const episodes = (await ports.episodes.listOwned(actor.userId, projectId)) ?? [];
      const plan = await ports.plans.findLatest(actor.userId, projectId);
      const approvedPlan = await ports.plans.findApproved(actor.userId, projectId);
      const ledger = await ports.ledgers.findLatest(actor.userId, projectId);

      const runStoryApproved = Boolean(run?.stageResults.story?.approved) || story?.status === "approved";
      const storyDraftStatus = storyDraft?.status ?? null;
      const approvalSignals = { projectStatus: project.status, storyDraftStatus, runStoryApproved };
      const storyApproved = storyIsApproved(approvalSignals);
      const storyAwaiting =
        storyAwaitingApproval(approvalSignals) ||
        Boolean(run && run.status === "waiting_for_approval" && run.currentStage === "story" && run.stageResults.story);
      const bibleApproved = (bible?.approvedVersion ?? 0) > 0;
      const bibleGenerating = bible?.generationStatus === "queued" || bible?.generationStatus === "processing";
      const bibleDraftReady = Boolean(
        bible &&
          bible.generationStatus === "idle" &&
          bible.draftRevision > bible.approvedVersion &&
          hasBibleContent(bible)
      );
      const planApproved = Boolean(approvedPlan);
      const planDraftReady = Boolean(plan && plan.status === "awaiting_approval");
      const planGenerating = false; // Tracked via generation jobs, not the plan record
      // CASNA: the approved plan is stale once the approved Bible version changes.
      const planReview = Boolean(
        approvedPlan && bible && bible.approvedVersion > 0 &&
        approvedPlan.basedOnBibleVersion !== bible.approvedVersion,
      );
      const productionActive = Boolean(
        run &&
          storyApproved &&
          bibleApproved &&
          (run.stageResults.characters !== undefined ||
            run.currentStage === "scenes" ||
            run.currentStage === "media" ||
            run.currentStage === "render" ||
            run.currentStage === "done")
      );

      const signals: WorkflowSignals = {
        projectStatus: project.status,
        storyDraftStatus,
        runStoryApproved,
        bibleApproved,
        bibleDraftReady,
        bibleGenerating,
        planApproved,
        planDraftReady,
        planGenerating,
        planNeedsReview: planReview,
        productionActive,
      };
      const stage = deriveWorkflowStage(signals);

      const needingReview = episodes.filter(
        (episode) =>
          episodeNeedsReview({
            bibleApprovedVersion: bible?.approvedVersion ?? 0,
            episodeBaseSnapshotVersion: episode.baseSnapshotVersion,
          }) ||
          episodeNeedsPlanReview({
            approvedPlanVersion: approvedPlan?.version ?? 0,
            episodeBasePlanVersion: episode.basePlanVersion ?? 0,
          })
      );
      const bibleReview = bibleNeedsReview({
        bibleApproved: bibleApproved,
        basedOnStoryId: bible?.basedOnStoryId ?? null,
        currentStoryId: project.currentStoryId,
      });

      const nextNumber = nextEpisodeNumber(episodes);
      const nextGate = episodeGenerationGate({
        productionMode: project.productionMode,
        bibleApprovedVersion: bible?.approvedVersion ?? 0,
        approvedPlan,
        latestPlan: plan,
        ledger,
        episodes,
        targetEpisodeNumber: nextNumber,
      });

      return {
        projectId,
        status: project.status,
        stage,
        steps: workflowSteps(signals),
        story: {
          exists: storyDraft !== null || story !== null || Boolean(run?.stageResults.story),
          approved: storyApproved,
          awaitingApproval: storyAwaiting,
          failed: storyDraft?.status === "failed" || story?.status === "failed" || project.status === "failed",
        },
        bible: {
          approved: bibleApproved,
          approvedVersion: bible?.approvedVersion ?? 0,
          draftRevision: bible?.draftRevision ?? 0,
          draftReady: bibleDraftReady,
          generating: bibleGenerating,
          failed: bible?.generationStatus === "failed",
          needsReview: bibleReview,
        },
        plan: {
          exists: Boolean(plan),
          approved: planApproved,
          awaitingApproval: Boolean(plan && plan.status === "awaiting_approval"),
          failed: Boolean(plan && plan.status === "failed"),
          version: approvedPlan?.version ?? plan?.version ?? 0,
          needsReview: planReview,
        },
        episodes: {
          total: episodes.length,
          open: episodes.filter((episode) => episode.status === "draft").length,
          needingReview: needingReview.length,
          nextNumber,
          nextLocked: !nextGate.allowed,
          nextLockReason: nextGate.reason,
        },
        production: { started: productionActive },
        blockedReason: blockedReason(stage, storyApproved, storyAwaiting, bibleApproved, bibleGenerating, planApproved),
      };
    },
  };
}

function blockedReason(
  stage: WorkflowStage,
  storyApproved: boolean,
  storyAwaitingApproval: boolean,
  bibleApproved: boolean,
  bibleGenerating: boolean,
  planApproved: boolean,
): string | null {
  if (stage === "story") {
    if (storyAwaitingApproval) return "Approve the story draft to continue.";
    if (!storyApproved) return "Generate and approve a story draft before the Story Bible.";
  }
  if (stage === "bible") {
    if (bibleGenerating) return "The Story Bible is generating. Wait for all six sections.";
    if (!bibleApproved) return "Generate and approve the Story Bible before creating the Season Plan.";
  }
  if (stage === "plan") {
    if (!planApproved) return "Generate and approve a Season Plan before creating episodes.";
  }
  return null;
}

export const workflowService = createWorkflowService({
  projects: projectRepository,
  runs: productionRunRepository,
  stories: storyRepository,
  bibles: storyBibleRepository,
  episodes: episodeRepository,
  plans: seasonPlanRepository,
  ledgers: continuityLedgerRepository,
});
