import { canTransition } from "@/lib/domain/projectStatus";
import type { ProjectStatus } from "@/lib/domain/projectCatalog";
import { stageMessage } from "@/lib/pipeline/messages";
import type { PipelineDeps } from "@/lib/pipeline/ports";
import {
  JobError,
  type JobRecord,
  type RunRecord,
  type SceneItem,
  type StageResults,
} from "@/lib/pipeline/types";

const OPEN = new Set(["queued", "processing"]);

function scenesOf(run: RunRecord): SceneItem[] {
  return run.stageResults.scenes?.items ?? [];
}

async function transition(
  deps: PipelineDeps,
  run: RunRecord,
  to: ProjectStatus
): Promise<void> {
  const project = await deps.projects.findOwned(run.clerkUserId, run.projectId);
  if (!project) return;
  if (!canTransition(project.status, to, run.retryCheckpoint ?? undefined)) return;
  await deps.projects.update(run.clerkUserId, run.projectId, { status: to });
}

async function enqueueNew(
  deps: PipelineDeps,
  run: RunRecord,
  jobType: JobRecord["jobType"],
  sceneNumber: number | null,
  input: Record<string, unknown>
): Promise<JobRecord> {
  const base = `${jobType}:${run.id}:${sceneNumber ?? "all"}`;
  const existing = await deps.jobs.listByKeyPrefix(base);
  const open = existing.find((job) => OPEN.has(job.status));
  if (open) return open;
  const key = existing.length === 0 ? base : `${base}:${existing.length + 1}`;
  const job = await deps.jobs.insert({
    clerkUserId: run.clerkUserId,
    projectId: run.projectId,
    runId: run.id,
    sceneNumber,
    jobType,
    provider: "mock",
    model: "mock",
    input,
    output: null,
    status: "queued",
    progress: { stage: jobType, message: stageMessage({ jobType, sceneNumber }) },
    attempts: 0,
    maxAttempts: 3,
    error: null,
    idempotencyKey: key,
    bullJobId: null,
    startedAt: null,
    completedAt: null,
  });
  try {
    await deps.queue.enqueue(job);
    job.bullJobId = job.id;
    await deps.jobs.save(job);
  } catch {
    job.progress = { stage: jobType, message: "Waiting for the job queue" };
    await deps.jobs.save(job);
  }
  return job;
}

async function failProject(deps: PipelineDeps, run: RunRecord, projectStatus: ProjectStatus) {
  if (canTransition(projectStatus, "failed")) {
    run.retryCheckpoint = projectStatus;
    await deps.projects.update(run.clerkUserId, run.projectId, { status: "failed" });
  }
  run.status = "failed";
  await deps.runs.save(run);
}

async function afterSuccess(deps: PipelineDeps, run: RunRecord, job: JobRecord, output: Record<string, unknown>) {
  const automatic = run.workflowMode === "automatic";
  const results: StageResults = { ...run.stageResults };

  if (job.jobType === "story.generate") {
    results.story = {
      title: String(output.title ?? "Untitled"),
      synopsis: String(output.synopsis ?? ""),
      approved: automatic,
    };
    run.stageResults = results;
    run.currentStage = "story";
    if (automatic) {
      await transition(deps, run, "story_ready");
      run.currentStage = "characters";
      run.status = "running";
      await deps.runs.save(run);
      await enqueueNew(deps, run, "character.extract", null, {});
      return;
    }
    run.status = "waiting_for_approval";
    await deps.runs.save(run);
    return;
  }

  if (job.jobType === "character.extract") {
    const names = Array.isArray(output.names) ? output.names.map(String) : [];
    results.characters = { names, approved: automatic };
    run.stageResults = results;
    run.currentStage = "characters";
    if (automatic) {
      await transition(deps, run, "characters_ready");
      run.currentStage = "scenes";
      run.status = "running";
      await deps.runs.save(run);
      await enqueueNew(deps, run, "scene.breakdown", null, {});
      return;
    }
    run.status = "waiting_for_approval";
    await deps.runs.save(run);
    return;
  }

  if (job.jobType === "scene.breakdown") {
    const items = Array.isArray(output.items) ? (output.items as SceneItem[]) : [];
    results.scenes = { approved: automatic, items };
    run.stageResults = results;
    run.currentStage = "scenes";
    if (automatic) {
      await transition(deps, run, "scenes_ready");
      await transition(deps, run, "generating");
      run.currentStage = "media";
      run.status = "running";
      await deps.runs.save(run);
      for (const scene of items) {
        await enqueueNew(deps, run, "video.scene", scene.sceneNumber, { sceneNumber: scene.sceneNumber });
      }
      return;
    }
    run.status = "waiting_for_approval";
    await deps.runs.save(run);
    return;
  }

  if (job.jobType === "video.scene") {
    const items = scenesOf(run).map((scene) =>
      scene.sceneNumber === job.sceneNumber ? { ...scene, videoReady: true, failed: false } : scene
    );
    results.scenes = { approved: true, items };
    run.stageResults = results;
    run.currentStage = "media";
    const pending = items.some((scene) => !scene.videoReady && !scene.failed);
    if (pending) {
      run.status = "running";
      await deps.runs.save(run);
      return;
    }
    const ready = items.length > 0 && items.every((scene) => scene.videoReady);
    if (ready && automatic) {
      await transition(deps, run, "rendering");
      run.currentStage = "render";
      run.status = "running";
      await deps.runs.save(run);
      await enqueueNew(deps, run, "render.final", null, {});
      return;
    }
    run.status = ready ? "waiting_for_approval" : "running";
    await deps.runs.save(run);
    return;
  }

  results.render = { ready: true };
  run.stageResults = results;
  run.currentStage = "done";
  run.status = "completed";
  run.completedAt = new Date().toISOString();
  await transition(deps, run, "completed");
  await deps.runs.save(run);
}

export async function processGenerationJob(deps: PipelineDeps, jobId: string): Promise<void> {
  const job = await deps.jobs.findById(jobId);
  if (!job || job.status === "cancelled" || job.status === "completed") return;
  const run = await deps.runs.findOwned(job.clerkUserId, job.runId);
  const project = await deps.projects.findOwned(job.clerkUserId, job.projectId);
  if (!run || !project) {
    throw new JobError("The job does not match a project", "ownership", false);
  }

  job.status = "processing";
  job.attempts += 1;
  job.startedAt = job.startedAt ?? new Date().toISOString();
  job.progress = { stage: job.jobType, message: stageMessage(job) };
  await deps.jobs.save(job);

  try {
    const output = await deps.engines.run(job, run);
    job.status = "completed";
    job.output = output;
    job.error = null;
    job.completedAt = new Date().toISOString();
    job.progress = { stage: job.jobType, message: stageMessage(job) };
    await deps.jobs.save(job);
    const fresh = await deps.runs.findOwned(job.clerkUserId, job.runId);
    if (!fresh) return;
    await afterSuccess(deps, fresh, job, output);
  } catch (error) {
    const failure =
      error instanceof JobError ? error : new JobError("The stage failed", "stage_failed", true);
    const retry = failure.retryable && job.attempts < job.maxAttempts;
    if (retry) {
      job.status = "queued";
      job.error = { code: failure.code, message: failure.message, retryable: true };
      job.progress = { stage: job.jobType, message: `${stageMessage(job)}. Retrying` };
      await deps.jobs.save(job);
      throw failure;
    }
    job.status = "failed";
    job.error = { code: failure.code, message: failure.message, retryable: false };
    job.completedAt = new Date().toISOString();
    job.progress = { stage: job.jobType, message: failure.message };
    await deps.jobs.save(job);
    const fresh = await deps.runs.findOwned(job.clerkUserId, job.runId);
    const current = await deps.projects.findOwned(job.clerkUserId, job.projectId);
    if (fresh && current && job.jobType === "video.scene") {
      const items = scenesOf(fresh).map((scene) =>
        scene.sceneNumber === job.sceneNumber ? { ...scene, failed: true, videoReady: false } : scene
      );
      fresh.stageResults = { ...fresh.stageResults, scenes: { approved: true, items } };
      fresh.status = "running";
      await deps.runs.save(fresh);
    } else if (fresh && current) {
      await failProject(deps, fresh, current.status);
    }
    throw new JobError(failure.message, failure.code, false);
  }
}

export async function enqueueForRun(
  deps: PipelineDeps,
  run: RunRecord,
  jobType: JobRecord["jobType"],
  sceneNumber: number | null,
  input: Record<string, unknown>
): Promise<JobRecord> {
  return enqueueNew(deps, run, jobType, sceneNumber, input);
}

export async function reconcileOpenJobs(deps: PipelineDeps): Promise<number> {
  const open = await deps.jobs.listOpen();
  let count = 0;
  for (const job of open) {
    if (job.attempts >= job.maxAttempts) continue;
    if (job.status === "processing") {
      job.status = "queued";
      job.progress = { stage: job.jobType, message: "Queued again after a restart" };
      await deps.jobs.save(job);
    }
    await deps.queue.enqueue(job);
    count += 1;
  }
  return count;
}
