import type { ProjectStatus } from "@/lib/domain/projectCatalog";
import type { StoryRecord, StoryStatus } from "@/lib/validation/story";

/**
 * The guided creative workflow shown to the user. This is derived from existing
 * records (project status, the project-level story draft, the production run,
 * the Story Bible, episodes) rather than stored, so no new status enum is
 * introduced.
 *
 * `Create Drama` is the project creation page itself; once a project exists the
 * remaining stages are the four below.
 */
export const WORKFLOW_STAGES = [
  "project_setup",
  "planning",
  "bible",
  "episodes",
  "characters",
  "scenes",
  "story",
  "canon",
  "production_design",
  "audio",
  "video",
  "timeline",
  "rendering",
] as const;
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

export const WORKFLOW_STAGE_LABELS: Record<WorkflowStage, string> = {
  project_setup: "Project Setup",
  planning: "Creative Planning",
  bible: "Story Bible",
  episodes: "Season & Episodes",
  characters: "Characters & Locations",
  scenes: "Scene Breakdown",
  story: "Screenplay",
  canon: "Canon & Continuity",
  production_design: "Production Design",
  audio: "Audio",
  video: "Video",
  timeline: "Timeline",
  rendering: "Rendering",
};

export const WORKFLOW_STAGE_PHASES: Record<WorkflowStage, "creative" | "structural" | "production" | "output"> = {
  project_setup: "creative",
  planning: "creative",
  bible: "creative",
  episodes: "structural",
  characters: "structural",
  scenes: "structural",
  story: "structural",
  canon: "structural",
  production_design: "production",
  audio: "production",
  video: "production",
  timeline: "production",
  rendering: "output",
};

/** Path segment under `/projects/[projectId]`. */
export const WORKFLOW_STAGE_PATH: Record<WorkflowStage, string> = {
  project_setup: "",
  planning: "planning",
  bible: "bible",
  episodes: "episodes",
  characters: "characters",
  scenes: "scenes",
  story: "story",
  canon: "canon",
  production_design: "production-design",
  audio: "audio",
  video: "video",
  timeline: "timeline",
  rendering: "rendering",
};

export type WorkflowStepState =
  | "completed"
  | "awaiting_approval"
  | "current"
  | "upcoming";

export type WorkflowStep = {
  stage: WorkflowStage;
  label: string;
  state: WorkflowStepState;
};

/**
 * A project status at or beyond `story_ready` means a story draft was approved.
 * `failed` is intentionally excluded: a failure is retried from its checkpoint.
 *
 * Kept as a fallback for projects created before the guided workflow introduced
 * the project-level story draft.
 */
export const STORY_APPROVED_STATUSES: readonly ProjectStatus[] = [
  "story_ready",
  "characters_ready",
  "scenes_ready",
  "generating",
  "rendering",
  "completed",
];

export type WorkflowSignals = {
  projectStatus: ProjectStatus;
  /**
   * Status of the project-level story draft, when one has been generated.
   * When present it is the source of truth: regenerating an approved draft
   * must send the project back to the story stage.
   */
  storyDraftStatus: StoryStatus | null;
  /** The production run's recorded story is approved. */
  runStoryApproved: boolean;
  bibleApproved: boolean;
  bibleDraftReady: boolean;
  bibleGenerating: boolean;
  /** CASNA: A Season Plan has been approved. */
  planApproved: boolean;
  /** CASNA: A Season Plan draft is ready for review. */
  planDraftReady: boolean;
  /** CASNA: A Season Plan generation job is running. */
  planGenerating: boolean;
  /**
   * CASNA: The approved plan was developed from an older Story Bible version and
   * must be reviewed before it can drive new episodes.
   */
  planNeedsReview?: boolean;
  /** Production has moved beyond the story stage for the current episode. */
  productionActive: boolean;
};

/**
 * Whether the project has an approved story. The project-level draft, when it
 * exists, decides; otherwise the project status is the legacy signal.
 */
export function storyApprovedForProject(
  projectStatus: ProjectStatus,
  storyDraftStatus: StoryStatus | null | undefined
): boolean {
  if (storyDraftStatus) return storyDraftStatus === "approved";
  return STORY_APPROVED_STATUSES.includes(projectStatus);
}

export function storyIsApproved(
  signals: Pick<WorkflowSignals, "projectStatus" | "storyDraftStatus" | "runStoryApproved">
): boolean {
  return (
    storyApprovedForProject(signals.projectStatus, signals.storyDraftStatus) ||
    signals.runStoryApproved
  );
}

export function storyAwaitingApproval(
  signals: Pick<WorkflowSignals, "storyDraftStatus" | "runStoryApproved" | "projectStatus">
): boolean {
  if (signals.storyDraftStatus) return signals.storyDraftStatus === "awaiting_approval";
  return false;
}

/**
 * The single stage the user should be working in. Every earlier stage depends on
 * the successful completion and approval of the one before it.
 */
export function deriveWorkflowStage(
  signals: Pick<
    WorkflowSignals,
    | "projectStatus"
    | "storyDraftStatus"
    | "runStoryApproved"
    | "bibleApproved"
    | "planApproved"
    | "planDraftReady"
    | "planNeedsReview"
    | "productionActive"
  >
): WorkflowStage {
  if (!signals.bibleApproved) return "bible";
  if (!storyIsApproved(signals)) return "story";
  if (!signals.planApproved || signals.planDraftReady || signals.planNeedsReview) return "episodes";
  if (!signals.productionActive) return "episodes";
  return "production_design";
}

/** Whether the stage that is currently open is waiting for the user's approval. */
export function isAwaitingApproval(stage: WorkflowStage, signals: WorkflowSignals): boolean {
  if (stage === "bible") return !signals.bibleApproved && signals.bibleDraftReady;
  if (stage === "story") return storyAwaitingApproval(signals);
  if (stage === "episodes") return !signals.planApproved && signals.planDraftReady;
  return false;
}

export function workflowSteps(signals: WorkflowSignals): WorkflowStep[] {
  const current = deriveWorkflowStage(signals);
  const currentIndex = WORKFLOW_STAGES.indexOf(current);
  return WORKFLOW_STAGES.map((stage, index) => {
    let state: WorkflowStepState;
    if (index < currentIndex) {
      state = "completed";
    } else if (index > currentIndex) {
      state = "upcoming";
    } else if (isAwaitingApproval(stage, signals)) {
      state = "awaiting_approval";
    } else {
      state = "current";
    }
    return { stage, label: WORKFLOW_STAGE_LABELS[stage], state };
  });
}

/**
 * A Story Bible needs review again when the story it was approved from is no
 * longer the project's current story. In the current workflow the Bible is
 * approved before the story draft, so this only applies to legacy projects
 * that have a `basedOnStoryId` set.
 */
export function bibleNeedsReview(input: {
  bibleApproved: boolean;
  basedOnStoryId: string | null | undefined;
  currentStoryId: string | null | undefined;
}): boolean {
  if (!input.bibleApproved) return false;
  if (!input.basedOnStoryId) return false;
  return input.basedOnStoryId !== (input.currentStoryId ?? null);
}

/** An episode needs review when a newer Story Bible version exists than the one it started from. */
export function episodeNeedsReview(input: {
  bibleApprovedVersion: number;
  episodeBaseSnapshotVersion: number;
}): boolean {
  return (
    input.bibleApprovedVersion > 0 &&
    input.episodeBaseSnapshotVersion > 0 &&
    input.episodeBaseSnapshotVersion < input.bibleApprovedVersion
  );
}

/**
 * A compact, human-readable summary of an approved story draft. The Season Plan
 * engine uses it so the plan is developed from the story the creator actually
 * approved, not the raw project idea.
 * Bounded to stay within the Story Bible idea field's limit.
 */
export function storyFoundation(
  story: Pick<StoryRecord, "title" | "synopsis" | "structure">
): string {
  const { act1, act2, act3 } = story.structure;
  const text = [
    `Approved story: ${story.title}`,
    `Synopsis: ${story.synopsis}`,
    `Act 1: ${act1.introduction} ${act1.mainCharacters} ${act1.setting} ${act1.initialSituation} ${act1.incitingIncident}`,
    `Act 2: ${act2.risingTension} ${act2.obstacles} ${act2.characterDecisions} ${act2.turningPoint}`,
    `Act 3: ${act3.climax} ${act3.resolution} ${act3.finalOutcome}`,
  ].join("\n");
  return text.length > 7800 ? text.slice(0, 7800) : text;
}
