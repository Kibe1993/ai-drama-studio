import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { ProjectStatus } from "@/lib/domain/projectCatalog";
import type { EngineSet, JobQueue, JobRecord, RunRecord, SceneItem } from "@/lib/pipeline/types";
import type { StoryRecord } from "@/lib/validation/story";
import type { EpisodeRecord } from "@/lib/validation/episode";
import type { SceneEdit, SceneRecord } from "@/lib/validation/scene";
import type { CharacterProfile } from "@/lib/validation/productionStages";

export type ProjectPort = {
  findOwned(clerkUserId: string, id: string): Promise<ProjectRecord | null>;
  update(
    clerkUserId: string,
    id: string,
    patch: Partial<Pick<ProjectRecord, "status">>
  ): Promise<ProjectRecord | null>;
};

export type RunPort = {
  insert(run: Omit<RunRecord, "id">): Promise<RunRecord>;
  findOwned(clerkUserId: string, id: string): Promise<RunRecord | null>;
  findLatest(clerkUserId: string, projectId: string): Promise<RunRecord | null>;
  save(run: RunRecord): Promise<RunRecord>;
};

export type JobPort = {
  insert(job: Omit<JobRecord, "id">): Promise<JobRecord>;
  findOwned(clerkUserId: string, id: string): Promise<JobRecord | null>;
  findById(id: string): Promise<JobRecord | null>;
  listForRun(runId: string): Promise<JobRecord[]>;
  listOpen(): Promise<JobRecord[]>;
  listByKeyPrefix(prefix: string): Promise<JobRecord[]>;
  save(job: JobRecord): Promise<JobRecord>;
};

export type StoryPort = {
  findOwned(clerkUserId: string, id: string): Promise<StoryRecord | null>;
  findForRun(clerkUserId: string, productionRunId: string): Promise<StoryRecord | null>;
  markApproved(clerkUserId: string, id: string): Promise<StoryRecord | null>;
};

export type EpisodePort = {
  findOwned(clerkUserId: string, projectId: string, episodeId: string): Promise<EpisodeRecord | null>;
  ensureFirst(clerkUserId: string, projectId: string, title: string, targetDurationSeconds: number): Promise<EpisodeRecord | null>;
  updateStatus(clerkUserId: string, projectId: string, episodeId: string, status: EpisodeRecord["status"], currentStoryId?: string | null): Promise<EpisodeRecord | null>;
};

export type ProductionScenePort = {
  listForRun(clerkUserId: string, runId: string): Promise<SceneRecord[]>;
  persistBreakdown(clerkUserId: string, run: RunRecord, storyId: string, scenes: SceneItem[]): Promise<SceneRecord[]>;
  updateOwned(clerkUserId: string, projectId: string, runId: string, sceneNumber: number, input: SceneEdit): Promise<SceneRecord | null>;
};

export type ContinuityPort = {
  persistCharacters(clerkUserId: string, run: RunRecord, storyId: string, profiles: CharacterProfile[]): Promise<void>;
  persistSceneCanon(clerkUserId: string, run: RunRecord, storyId: string, scenes: SceneItem[]): Promise<void>;
  approveCharactersForRun(clerkUserId: string, projectId: string, runId: string): Promise<void>;
  approveScenesForRun(clerkUserId: string, projectId: string, runId: string): Promise<void>;
  syncSceneEvent(clerkUserId: string, projectId: string, runId: string, scene: SceneEdit & { sceneNumber: number }): Promise<void>;
  getPriorEpisodeContext(clerkUserId: string, projectId: string, beforeEpisodeNumber: number): Promise<string | undefined>;
};

export type PipelineDeps = {
  projects: ProjectPort;
  runs: RunPort;
  jobs: JobPort;
  stories: StoryPort;
  episodes?: EpisodePort;
  scenes?: ProductionScenePort;
  continuity?: ContinuityPort;
  queue: JobQueue;
  engines: EngineSet;
  storyBibleEngine?: {
    run(job: JobRecord, project: ProjectRecord): Promise<Record<string, unknown>>;
    fail(job: JobRecord, message: string): Promise<void>;
  };
};

export type StatusPatch = {
  status: ProjectStatus;
};
