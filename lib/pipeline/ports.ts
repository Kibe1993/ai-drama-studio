import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { ProjectStatus } from "@/lib/domain/projectCatalog";
import type { EngineSet, JobQueue, JobRecord, RunRecord, SceneItem } from "@/lib/pipeline/types";
import type { StoryRecord, ScreenplayScene } from "@/lib/validation/story";
import type { EpisodeRecord } from "@/lib/validation/episode";
import type { StoryBibleSnapshot } from "@/lib/validation/storyBible";
import type { EpisodeValidation } from "@/lib/validation/casna";
import type { SceneEdit, SceneRecord } from "@/lib/validation/scene";
import type { CharacterProfile } from "@/lib/validation/productionStages";
import type { CasnaEpisodeContext } from "@/lib/pipeline/casnaContext";
import type { CanonPort } from "@/lib/domain/narrativeControl";
import type { DerivedCanonState } from "@/lib/canon/schema";

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
  /** Undo an approval when a later step in the same operation fails. */
  revertApproval?(clerkUserId: string, id: string): Promise<StoryRecord | null>;
  /** CASNA: save a creator's manual screenplay revision while unapproved. */
  updateScreenplay?(
    clerkUserId: string,
    id: string,
    input: {
      title?: string;
      synopsis?: string;
      screenplay: ScreenplayScene[];
      validationFindings: EpisodeValidation | null;
      expectedUpdatedAt?: string;
    }
  ): Promise<StoryRecord | null>;
  recordCanonVersion?(clerkUserId: string, id: string, version: number): Promise<void>;
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

export type CasnaPort = {
  /** Stage E/F: load the approved plan, ledger, and earlier approved episodes. */
  load(input: {
    clerkUserId: string;
    projectId: string;
    productionMode: string;
    episodeNumber: number;
    bibleApprovedVersion: number;
    withScreenplays?: boolean;
  }): Promise<CasnaEpisodeContext>;
  /** Stage I: promote an approved episode into established canon. */
  onEpisodeApproved(input: {
    clerkUserId: string;
    projectId: string;
    episodeNumber: number;
    story: StoryRecord;
  }): Promise<unknown>;
};

export type PipelineDeps = {
  projects: ProjectPort;
  runs: RunPort;
  jobs: JobPort;
  stories: StoryPort;
  episodes?: EpisodePort;
  scenes?: ProductionScenePort;
  continuity?: ContinuityPort;
  /** Approved Story Bible gateway for production start and stage advancement. */
  bibles?: {
    findOwned(clerkUserId: string, projectId: string): Promise<{ approvedVersion: number } | null>;
    findApproved?(clerkUserId: string, projectId: string): Promise<StoryBibleSnapshot | null>;
    findApprovedVersion?(
      clerkUserId: string,
      projectId: string,
      version: number
    ): Promise<StoryBibleSnapshot | null>;
  };
  queue: JobQueue;
  engines: EngineSet;
  /** CASNA: season plan, continuity ledger, and sequential episode gates. */
  casna?: CasnaPort;
  /** Versioned narrative canon. Generation prepares it; approval commits it. */
  narrativeCanon?: CanonPort;
  /** Append-only canon fact log. When present, the verifier uses the authoritative derived state. */
  canonFactLog?: {
    latestState(clerkUserId: string, projectId: string): Promise<DerivedCanonState | null>;
  };
  storyDraftEngine?: {
    run(job: JobRecord, project: ProjectRecord): Promise<Record<string, unknown>>;
  };
  storyBibleEngine?: {
    run(job: JobRecord, project: ProjectRecord): Promise<Record<string, unknown>>;
    fail(job: JobRecord, message: string): Promise<void>;
  };
  episodeSuggestEngine?: {
    run(job: JobRecord, project: ProjectRecord): Promise<Record<string, unknown>>;
    fail(job: JobRecord, message: string): Promise<void>;
  };
  seasonPlanEngine?: {
    run(job: JobRecord, project: ProjectRecord): Promise<Record<string, unknown>>;
  };
  /** Canon Fact Log extraction — enqueued after episode approval. */
  canonExtraction?: {
    extractAndCommit(input: {
      clerkUserId: string;
      projectId: string;
      episodeId: string;
      storyId: string;
      episodeNumber: number;
      jobId: string;
    }): Promise<{ committed: number; issues: number; status: string }>;
  };
};

export type StatusPatch = {
  status: ProjectStatus;
};
