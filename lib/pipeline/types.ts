import type { ProjectStatus, WorkflowMode } from "@/lib/domain/projectCatalog";

export const JOB_TYPES = [
  "story.generate",
  "character.extract",
  "scene.breakdown",
  "video.scene",
  "render.final",
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "processing", "completed", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const RUN_STATUSES = [
  "pending",
  "running",
  "waiting_for_approval",
  "completed",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export type PipelineStage = "story" | "characters" | "scenes" | "media" | "render" | "done";

export type StoryResult = {
  title: string;
  synopsis: string;
  approved: boolean;
};

export type CharacterResult = {
  names: string[];
  approved: boolean;
};

export type SceneItem = {
  sceneNumber: number;
  title: string;
  videoReady: boolean;
  failed: boolean;
};

export type SceneResult = {
  approved: boolean;
  items: SceneItem[];
};

export type StageResults = {
  story?: StoryResult;
  characters?: CharacterResult;
  scenes?: SceneResult;
  render?: { ready: boolean };
};

export type RunRecord = {
  id: string;
  clerkUserId: string;
  projectId: string;
  workflowMode: WorkflowMode;
  currentStage: PipelineStage;
  status: RunStatus;
  stageResults: StageResults;
  retryCheckpoint: ProjectStatus | null;
  startedAt: string;
  completedAt: string | null;
};

export type JobRecord = {
  id: string;
  clerkUserId: string;
  projectId: string;
  runId: string;
  sceneNumber: number | null;
  jobType: JobType;
  provider: string;
  model: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: JobStatus;
  progress: { stage: string; message: string };
  attempts: number;
  maxAttempts: number;
  error: { code: string; message: string; retryable: boolean } | null;
  idempotencyKey: string;
  bullJobId: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export class JobError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

export type EngineSet = {
  failNext(jobType: JobType, times: number, retryable: boolean): void;
  run(job: JobRecord, run: RunRecord): Promise<Record<string, unknown>>;
};

export type JobQueue = {
  enqueue(job: Pick<JobRecord, "id" | "jobType" | "maxAttempts">): Promise<void>;
};
