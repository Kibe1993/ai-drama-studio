import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { ProjectStatus } from "@/lib/domain/projectCatalog";
import type { EngineSet, JobQueue, JobRecord, RunRecord } from "@/lib/pipeline/types";

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

export type PipelineDeps = {
  projects: ProjectPort;
  runs: RunPort;
  jobs: JobPort;
  queue: JobQueue;
  engines: EngineSet;
};

export type StatusPatch = {
  status: ProjectStatus;
};
