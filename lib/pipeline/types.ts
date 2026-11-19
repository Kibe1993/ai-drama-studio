import type { ProjectStatus, WorkflowMode } from "@/lib/domain/projectCatalog";
import type { CharacterProfile } from "@/lib/validation/productionStages";

export const JOB_TYPES = [
  "story.draft",
  "story.generate",
  "storyBible.generate",
  "seasonPlan.generate",
  "episodeSuggest.generate",
  "character.extract",
  "scene.breakdown",
  "video.scene",
  "render.final",
  "image.character_reference",
  "image.environment_reference",
  "image.object_reference",
  "image.shot",
  "video.shot",
  "audio.dialogue",
  "audio.narration",
  "audio.sfx",
  "audio.music",
  "media.validate",
  "assembly.generate",
  "canon.extract",
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "processing", "completed", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const RUN_STATUSES = [
  "pending",
  "running",
  "waiting_for_approval",
  "unavailable",
  "completed",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const MEDIA_STATUSES = [
  "pending",
  "processing",
  "mock",
  "completed",
  "failed",
  "unavailable",
] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export type PipelineStage = "story" | "characters" | "scenes" | "media" | "render" | "done";

export type StoryResult = {
  title: string;
  synopsis: string;
  approved: boolean;
  storyId?: string;
  sourceCanonVersion?: number;
};

export type CharacterResult = {
  names: string[];
  profiles?: CharacterProfile[];
  approved: boolean;
  provider?: string;
  model?: string;
  fallbackFrom?: string | null;
};

export type SceneItem = {
  sceneNumber: number;
  title: string;
  /** Legacy convenience flag. Readiness gates also require a stored asset reference and status. */
  videoReady: boolean;
  videoStatus?: MediaStatus;
  videoAssetId?: string;
  failed: boolean;
  location?: string;
  interiorExterior?: "interior" | "exterior" | "";
  timeOfDay?: string;
  charactersPresent?: string[];
  visualDescription?: string;
  action?: string;
  dialogue?: { characterName: string; line: string }[];
  cameraDirection?: string;
  estimatedDurationSeconds?: number | null;
};

export type SceneResult = {
  approved: boolean;
  items: SceneItem[];
  provider?: string;
  model?: string;
  fallbackFrom?: string | null;
};

export type StageResults = {
  story?: StoryResult;
  characters?: CharacterResult;
  scenes?: SceneResult;
  render?: { ready: boolean; status?: MediaStatus; mediaAssetId?: string };
};

export type RunRecord = {
  id: string;
  clerkUserId: string;
  projectId: string;
  episode?: {
    id: string;
    number: number;
    title: string;
    premise: string;
    targetDurationSeconds: number;
    baseSnapshotVersion: number;
  } | null;
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
  runId: string | null;
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
  error: { code: string; message: string; retryable: boolean; findings?: Array<{ category: string; severity: string; sceneNumber?: number; message: string; code?: string; evidence?: string }> } | null;
  idempotencyKey: string;
  bullJobId: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export class JobError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly details?: Record<string, unknown>,
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
