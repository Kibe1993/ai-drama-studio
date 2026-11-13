import { canTransition } from "@/lib/domain/projectStatus";
import { log } from "@/lib/log";
import type { ProjectStatus } from "@/lib/domain/projectCatalog";
import { stageMessage } from "@/lib/pipeline/messages";
import type { PipelineDeps } from "@/lib/pipeline/ports";
import { readStoredVideoEvidence, sceneHasStoredVideo } from "@/lib/pipeline/mediaEvidence";
import { LlmSequenceError } from "@/lib/providers/llm/manager";
import {
  JobError,
  type CharacterResult,
  type JobRecord,
  type MediaStatus,
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
  if (open) {
    log.info("pipeline", "reuse open job", { jobType, jobId: open.id, runId: run.id });
    return open;
  }
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
    log.info("pipeline", "enqueued", { jobType, jobId: job.id, projectId: run.projectId, runId: run.id });
  } catch (error) {
    job.progress = { stage: jobType, message: "Waiting for the job queue" };
    await deps.jobs.save(job);
    log.error("pipeline", "queue unavailable", {
      jobType,
      jobId: job.id,
      detail: error instanceof Error ? error.message : "enqueue failed",
    });
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

async function cancelQueuedVideoJobs(deps: PipelineDeps, run: RunRecord, exceptJobId: string): Promise<void> {
  const jobs = await deps.jobs.listForRun(run.id);
  for (const job of jobs) {
    if (job.id === exceptJobId || job.jobType !== "video.scene" || job.status !== "queued") continue;
    job.status = "cancelled";
    job.error = {
      code: "media_unavailable",
      message: "No real video provider is available for this run.",
      retryable: false,
    };
    job.progress = { stage: job.jobType, message: "Unavailable: no real video was generated" };
    job.completedAt = new Date().toISOString();
    await deps.jobs.save(job);
  }
}

async function afterSuccess(deps: PipelineDeps, run: RunRecord, job: JobRecord, output: Record<string, unknown>) {
  const automatic = run.workflowMode === "automatic";
  const results: StageResults = { ...run.stageResults };

  if (job.jobType === "story.generate") {
    results.story = {
      title: String(output.title ?? "Untitled"),
      synopsis: String(output.synopsis ?? ""),
      approved: false,
      storyId: typeof output.storyId === "string" ? output.storyId : undefined,
    };
    run.stageResults = results;
    run.currentStage = "story";
    run.status = "waiting_for_approval";
    await deps.runs.save(run);
    return;
  }

  if (job.jobType === "character.extract") {
    const profiles = Array.isArray(output.profiles) ? output.profiles : [];
    const names = profiles.length > 0
      ? profiles.map((profile) => String((profile as { name?: unknown }).name ?? "")).filter(Boolean)
      : Array.isArray(output.names)
        ? output.names.map(String)
        : [];
    if (deps.continuity && profiles.length > 0) {
      const storyId = run.stageResults.story?.storyId;
      if (!storyId) throw new JobError("Character records require a saved story.", "dependency", false);
      await deps.continuity.persistCharacters(
        job.clerkUserId,
        run,
        storyId,
        profiles as NonNullable<CharacterResult["profiles"]>
      );
      if (run.workflowMode === "automatic") {
        await deps.continuity.approveCharactersForRun(job.clerkUserId, job.projectId, run.id);
      }
    }
    results.characters = {
      names,
      profiles: profiles as CharacterResult["profiles"],
      approved: automatic,
      provider: typeof output.provider === "string" ? output.provider : undefined,
      model: typeof output.model === "string" ? output.model : undefined,
      fallbackFrom: typeof output.fallbackFrom === "string" ? output.fallbackFrom : null,
    };
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
    let items = Array.isArray(output.items) ? (output.items as SceneItem[]) : [];
    if (deps.scenes && !output.mock) {
      const storyId = run.stageResults.story?.storyId;
      if (!storyId) throw new JobError("Scene records require a saved approved story.", "dependency", false);
      const persisted = await deps.scenes.persistBreakdown(job.clerkUserId, run, storyId, items);
      items = persisted.map((scene) => ({
        ...scene,
        videoReady: scene.videoReady,
        videoStatus: scene.videoStatus,
        videoAssetId: scene.videoAssetId ?? undefined,
        failed: scene.failed,
      }));
      await deps.continuity?.persistSceneCanon(job.clerkUserId, run, storyId, items);
      if (automatic) await deps.continuity?.approveScenesForRun(job.clerkUserId, job.projectId, run.id);
    }
    results.scenes = {
      approved: automatic,
      items,
      provider: typeof output.provider === "string" ? output.provider : undefined,
      model: typeof output.model === "string" ? output.model : undefined,
      fallbackFrom: typeof output.fallbackFrom === "string" ? output.fallbackFrom : null,
    };
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
    const evidence = readStoredVideoEvidence(output.videoAsset);
    const isMock = output.mock === true;
    const isReady = !isMock && evidence !== null;
    const videoStatus: MediaStatus = isMock ? "mock" : isReady ? "completed" : "unavailable";
    const scenes = scenesOf(run);
    const matched = scenes.some((scene) => scene.sceneNumber === job.sceneNumber);
    const items = scenes.map((scene) => {
      if (scene.sceneNumber === job.sceneNumber) {
        return {
          ...scene,
          videoReady: isReady,
          videoStatus,
          videoAssetId: isReady ? evidence?.mediaAssetId : undefined,
          failed: false,
        };
      }
      if (!isReady && !sceneHasStoredVideo(scene) && !scene.failed) {
        return { ...scene, videoReady: false, videoStatus: "unavailable" as const };
      }
      return scene;
    });
    results.scenes = { ...(run.stageResults.scenes ?? { approved: true, items: [] }), approved: true, items };
    run.stageResults = results;
    run.currentStage = "media";
    if (!isReady || !matched) {
      run.status = "unavailable";
      await deps.runs.save(run);
      if (run.episode && deps.episodes) await deps.episodes.updateStatus(job.clerkUserId, job.projectId, run.episode.id, "unavailable");
      await cancelQueuedVideoJobs(deps, run, job.id);
      log.error("pipeline", "video unavailable", {
        jobId: job.id,
        runId: run.id,
        reason: isMock ? "mock_output" : matched ? "missing_validated_asset" : "scene_missing",
      });
      return;
    }

    const pending = items.some((scene) => !sceneHasStoredVideo(scene) && !scene.failed);
    if (pending) {
      run.status = "running";
      await deps.runs.save(run);
      return;
    }
    const ready = items.length > 0 && items.every(sceneHasStoredVideo);
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

  const finalVideo = readStoredVideoEvidence(output.finalVideoAsset);
  if (output.mock === true || !finalVideo) {
    results.render = { ready: false, status: output.mock === true ? "mock" : "unavailable" };
    run.stageResults = results;
    run.currentStage = "render";
    run.status = "unavailable";
    await deps.runs.save(run);
    if (run.episode && deps.episodes) await deps.episodes.updateStatus(job.clerkUserId, job.projectId, run.episode.id, "unavailable");
    log.error("pipeline", "render unavailable", {
      jobId: job.id,
      runId: run.id,
      reason: output.mock === true ? "mock_output" : "missing_validated_asset",
    });
    return;
  }

  results.render = { ready: true, status: "completed", mediaAssetId: finalVideo.mediaAssetId };
  run.stageResults = results;
  run.currentStage = "done";
  run.status = "completed";
  run.completedAt = new Date().toISOString();
  await transition(deps, run, "completed");
  await deps.runs.save(run);
  if (run.episode && deps.episodes) await deps.episodes.updateStatus(job.clerkUserId, job.projectId, run.episode.id, "completed");
}

export async function processGenerationJob(deps: PipelineDeps, jobId: string): Promise<void> {
  const job = await deps.jobs.findById(jobId);
  if (!job || job.status === "cancelled" || job.status === "completed") return;
  if (job.jobType === "story.draft") {
    const started = Date.now();
    const project = await deps.projects.findOwned(job.clerkUserId, job.projectId);
    if (!deps.storyDraftEngine || job.runId !== null || !project) {
      log.error("worker", "story draft job rejected", {
        jobId: job.id, projectId: job.projectId, hasEngine: Boolean(deps.storyDraftEngine),
        hasProject: Boolean(project), runIdPresent: Boolean(job.runId),
      });
      throw new JobError("The story draft job does not match a project.", "ownership", false);
    }
    job.status = "processing";
    job.attempts += 1;
    job.startedAt = job.startedAt ?? new Date().toISOString();
    job.progress = { stage: job.jobType, message: stageMessage(job) };
    await deps.jobs.save(job);
    log.info("worker", "story draft job started", { jobId: job.id, projectId: job.projectId, attempt: job.attempts, maxAttempts: job.maxAttempts, runId: "none" });
    try {
      const output = await deps.storyDraftEngine.run(job, project);
      job.status = "completed";
      job.output = output;
      job.provider = typeof output.provider === "string" ? output.provider : job.provider;
      job.model = typeof output.model === "string" ? output.model : job.model;
      job.error = null;
      job.completedAt = new Date().toISOString();
      job.progress = { stage: job.jobType, message: "Story draft ready for review" };
      await deps.jobs.save(job);
      log.info("worker", "story draft job completed", { jobType: job.jobType, jobId: job.id, provider: job.provider, model: job.model, ms: Date.now() - started });
      return;
    } catch (error) {
      if (error instanceof LlmSequenceError) {
        job.output = { ...(job.output ?? {}), attempts: error.attempts };
      }
      const detail = error instanceof Error ? error.message : String(error);
      const failure = error instanceof JobError ? error : new JobError("Story draft generation failed.", "stage_failed", true);
      const retry = failure.retryable && job.attempts < job.maxAttempts;
      if (retry) {
        job.status = "queued";
        job.error = { code: failure.code, message: failure.message, retryable: true };
        job.progress = { stage: job.jobType, message: "Developing story draft. Retrying" };
        await deps.jobs.save(job);
        log.error("worker", "story draft job retry", { jobId: job.id, projectId: job.projectId, code: failure.code, attempt: job.attempts, detail, ms: Date.now() - started });
        throw failure;
      }
      // No draft is persisted on failure, so an approved draft stays intact and
      // the workflow does not advance.
      job.status = "failed";
      job.error = { code: failure.code, message: failure.message, retryable: false };
      job.completedAt = new Date().toISOString();
      job.progress = { stage: job.jobType, message: failure.message };
      await deps.jobs.save(job);
      log.error("worker", "story draft job failed", { jobId: job.id, projectId: job.projectId, code: failure.code, attempt: job.attempts, detail, ms: Date.now() - started });
      throw new JobError(failure.message, failure.code, false);
    }
  }
  if (job.jobType === "storyBible.generate") {
    const started = Date.now();
    const project = await deps.projects.findOwned(job.clerkUserId, job.projectId);
    if (!deps.storyBibleEngine || job.runId !== null || !project) {
      log.error("worker", "story bible job rejected", {
        jobId: job.id, projectId: job.projectId, hasEngine: Boolean(deps.storyBibleEngine),
        hasProject: Boolean(project), runIdPresent: Boolean(job.runId),
      });
      throw new JobError("The Story Bible job does not match a project.", "ownership", false);
    }
    job.status = "processing";
    job.attempts += 1;
    job.startedAt = job.startedAt ?? new Date().toISOString();
    job.progress = { stage: job.jobType, message: stageMessage(job) };
    await deps.jobs.save(job);
    log.info("worker", "story bible job started", { jobId: job.id, projectId: job.projectId, attempt: job.attempts, maxAttempts: job.maxAttempts, runId: "none" });
    try {
      const output = await deps.storyBibleEngine.run(job, project);
      job.status = "completed";
      job.output = output;
      job.provider = typeof output.provider === "string" ? output.provider : job.provider;
      job.model = typeof output.model === "string" ? output.model : job.model;
      job.error = null;
      job.completedAt = new Date().toISOString();
      job.progress = { stage: job.jobType, message: "Story Bible ready for review" };
      await deps.jobs.save(job);
      log.info("worker", "story bible job completed", { jobType: job.jobType, jobId: job.id, provider: job.provider, model: job.model, ms: Date.now() - started });
      return;
    } catch (error) {
      if (error instanceof LlmSequenceError) {
        job.output = { ...(job.output ?? {}), attempts: error.attempts };
      }
      const failure = error instanceof JobError ? error : new JobError("Story Bible generation failed.", "stage_failed", true);
      const partial = job.output?.storyBibleSections as
        | { sections?: Record<string, unknown>; failedSection?: string }
        | undefined;
      const preservedCount = partial?.sections && typeof partial.sections === "object"
        ? Object.keys(partial.sections).length
        : 0;
      // Sectioned generation can resume: a retry replays only the failed section
      // because completed sections live in job.output. Without preserved
      // sections, replaying an exhausted provider chain is still avoided.
      const retry = failure.retryable && job.attempts < job.maxAttempts
        && (!(error instanceof LlmSequenceError) || preservedCount > 0);
      if (retry) {
        job.status = "queued";
        job.error = { code: failure.code, message: failure.message, retryable: true };
        job.progress = {
          stage: job.jobType,
          message: preservedCount > 0
            ? `Developing Story Bible. Retrying ${partial?.failedSection ?? "failed"} section (${preservedCount} preserved)`
            : "Developing Story Bible. Retrying",
        };
        await deps.jobs.save(job);
        log.error("worker", "story bible job retry", {
          jobId: job.id, projectId: job.projectId, code: failure.code,
          attempt: job.attempts, preservedSections: preservedCount, ms: Date.now() - started,
        });
        throw failure;
      }
      job.status = "failed";
      job.error = { code: failure.code, message: failure.message, retryable: false };
      job.completedAt = new Date().toISOString();
      job.progress = { stage: job.jobType, message: failure.message };
      await deps.jobs.save(job);
      await deps.storyBibleEngine.fail(job, failure.message);
      log.error("worker", "story bible job failed", { jobId: job.id, projectId: job.projectId, code: failure.code, attempt: job.attempts, ms: Date.now() - started });
      throw new JobError(failure.message, failure.code, false);
    }
  }
  if (job.jobType === "episodeSuggest.generate") {
    const started = Date.now();
    const project = await deps.projects.findOwned(job.clerkUserId, job.projectId);
    if (!deps.episodeSuggestEngine || job.runId !== null || !project) {
      log.error("worker", "episode suggestion job rejected", {
        jobId: job.id, projectId: job.projectId, hasEngine: Boolean(deps.episodeSuggestEngine),
        hasProject: Boolean(project), runIdPresent: Boolean(job.runId),
      });
      throw new JobError("The episode suggestion job does not match a project.", "ownership", false);
    }
    job.status = "processing";
    job.attempts += 1;
    job.startedAt = job.startedAt ?? new Date().toISOString();
    job.progress = { stage: job.jobType, message: stageMessage(job) };
    await deps.jobs.save(job);
    log.info("worker", "episode suggestion job started", { jobId: job.id, projectId: job.projectId, attempt: job.attempts, maxAttempts: job.maxAttempts, runId: "none" });
    try {
      const output = await deps.episodeSuggestEngine.run(job, project);
      job.status = "completed";
      job.output = output;
      job.provider = typeof output.provider === "string" ? output.provider : job.provider;
      job.model = typeof output.model === "string" ? output.model : job.model;
      job.error = null;
      job.completedAt = new Date().toISOString();
      job.progress = { stage: job.jobType, message: `Episode ${output.episodeNumber ?? ""} proposal ready: ${String(output.title ?? "Untitled")}` };
      await deps.jobs.save(job);
      log.info("worker", "episode suggestion job completed", { jobType: job.jobType, jobId: job.id, provider: job.provider, model: job.model, ms: Date.now() - started });
      return;
    } catch (error) {
      if (error instanceof LlmSequenceError) {
        job.output = { ...(job.output ?? {}), attempts: error.attempts };
      }
      const failure = error instanceof JobError ? error : new JobError("Episode suggestion failed.", "stage_failed", true);
      // Gate failures (busy project, missing canon, no reference) will not heal
      // on a retry; only transient provider failures requeue.
      const retry = failure.retryable && job.attempts < job.maxAttempts;
      if (retry) {
        job.status = "queued";
        job.error = { code: failure.code, message: failure.message, retryable: true };
        job.progress = { stage: job.jobType, message: "Developing episode idea. Retrying" };
        await deps.jobs.save(job);
        log.error("worker", "episode suggestion job retry", { jobId: job.id, projectId: job.projectId, code: failure.code, attempt: job.attempts, ms: Date.now() - started });
        throw failure;
      }
      job.status = "failed";
      job.error = { code: failure.code, message: failure.message, retryable: false };
      job.completedAt = new Date().toISOString();
      job.progress = { stage: job.jobType, message: failure.message };
      await deps.jobs.save(job);
      await deps.episodeSuggestEngine.fail(job, failure.message);
      log.error("worker", "episode suggestion job failed", { jobId: job.id, projectId: job.projectId, code: failure.code, attempt: job.attempts, ms: Date.now() - started });
      throw new JobError(failure.message, failure.code, false);
    }
  }
  if (job.jobType === "seasonPlan.generate") {
    const started = Date.now();
    const project = await deps.projects.findOwned(job.clerkUserId, job.projectId);
    if (!deps.seasonPlanEngine || job.runId !== null || !project) {
      log.error("worker", "season plan job rejected", {
        jobId: job.id, projectId: job.projectId, hasEngine: Boolean(deps.seasonPlanEngine),
        hasProject: Boolean(project), runIdPresent: Boolean(job.runId),
      });
      throw new JobError("The season plan job does not match a project.", "ownership", false);
    }
    job.status = "processing";
    job.attempts += 1;
    job.startedAt = job.startedAt ?? new Date().toISOString();
    job.progress = { stage: job.jobType, message: stageMessage(job) };
    await deps.jobs.save(job);
    log.info("worker", "season plan job started", { jobId: job.id, projectId: job.projectId, attempt: job.attempts, maxAttempts: job.maxAttempts, runId: "none" });
    try {
      const output = await deps.seasonPlanEngine.run(job, project);
      job.status = "completed";
      job.output = output;
      job.provider = typeof output.provider === "string" ? output.provider : job.provider;
      job.model = typeof output.model === "string" ? output.model : job.model;
      job.error = null;
      job.completedAt = new Date().toISOString();
      job.progress = { stage: job.jobType, message: `Season plan ready for review${output.passed ? "" : " (with validation findings)"}` };
      await deps.jobs.save(job);
      log.info("worker", "season plan job completed", { jobType: job.jobType, jobId: job.id, provider: job.provider, model: job.model, passed: output.passed, ms: Date.now() - started });
      return;
    } catch (error) {
      if (error instanceof LlmSequenceError) {
        job.output = { ...(job.output ?? {}), attempts: error.attempts };
      }
      const failure = error instanceof JobError ? error : new JobError("Season plan generation failed.", "stage_failed", true);
      const retry = failure.retryable && job.attempts < job.maxAttempts;
      if (retry) {
        job.status = "queued";
        job.error = { code: failure.code, message: failure.message, retryable: true };
        job.progress = { stage: job.jobType, message: "Developing season plan. Retrying" };
        await deps.jobs.save(job);
        log.error("worker", "season plan job retry", { jobId: job.id, projectId: job.projectId, code: failure.code, attempt: job.attempts, ms: Date.now() - started });
        throw failure;
      }
      job.status = "failed";
      job.error = { code: failure.code, message: failure.message, retryable: false };
      job.completedAt = new Date().toISOString();
      job.progress = { stage: job.jobType, message: failure.message };
      await deps.jobs.save(job);
      log.error("worker", "season plan job failed", { jobId: job.id, projectId: job.projectId, code: failure.code, attempt: job.attempts, ms: Date.now() - started });
      throw new JobError(failure.message, failure.code, false);
    }
  }
  if (job.runId === null) throw new JobError("The job does not match a production run.", "ownership", false);
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
  const started = Date.now();
  log.info("worker", "start", {
    jobType: job.jobType,
    jobId: job.id,
    projectId: job.projectId,
    attempt: job.attempts,
    sceneNumber: job.sceneNumber ?? "",
  });

  try {
    const output = await deps.engines.run(job, run);
    job.status = "completed";
    job.output = output;
    if (typeof output.provider === "string") job.provider = output.provider;
    if (typeof output.model === "string") job.model = output.model;
    job.error = null;
    job.completedAt = new Date().toISOString();
    job.progress = {
      stage: job.jobType,
      message: output.mock === true ? "MOCK output processed; no real media generated" : stageMessage(job),
    };
    await deps.jobs.save(job);
    const fresh = await deps.runs.findOwned(job.clerkUserId, job.runId);
    if (!fresh) return;
    await afterSuccess(deps, fresh, job, output);
    log.info("worker", output.mock === true ? "mock output processed" : "completed", {
      jobType: job.jobType,
      jobId: job.id,
      provider: job.provider,
      model: job.model,
      outputStatus: output.mock === true ? "MOCK" : "COMPLETED",
      ms: Date.now() - started,
    });
  } catch (error) {
    if (error instanceof LlmSequenceError) {
      job.output = { ...(job.output ?? {}), attempts: error.attempts };
    }
    const failure =
      error instanceof JobError ? error : new JobError("The stage failed", "stage_failed", true);
    const retry = failure.retryable && job.attempts < job.maxAttempts;
    if (retry) {
      job.status = "queued";
      job.error = { code: failure.code, message: failure.message, retryable: true };
      job.progress = { stage: job.jobType, message: `${stageMessage(job)}. Retrying` };
      await deps.jobs.save(job);
      log.error("worker", "retry", { jobType: job.jobType, jobId: job.id, code: failure.code, attempt: job.attempts });
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
      const items = scenesOf(fresh).map((scene) => {
        if (scene.sceneNumber === job.sceneNumber) {
          return { ...scene, failed: true, videoReady: false, videoStatus: "failed" as const, videoAssetId: undefined };
        }
        if (!sceneHasStoredVideo(scene) && !scene.failed) {
          return { ...scene, videoReady: false, videoStatus: "unavailable" as const };
        }
        return scene;
      });
      fresh.stageResults = {
        ...fresh.stageResults,
        scenes: { ...(fresh.stageResults.scenes ?? { approved: true, items: [] }), approved: true, items },
      };
      fresh.status = "unavailable";
      await deps.runs.save(fresh);
      if (fresh.episode && deps.episodes) await deps.episodes.updateStatus(job.clerkUserId, job.projectId, fresh.episode.id, "unavailable");
      await cancelQueuedVideoJobs(deps, fresh, job.id);
    } else if (fresh && current) {
      if (fresh.episode && deps.episodes) await deps.episodes.updateStatus(job.clerkUserId, job.projectId, fresh.episode.id, "failed");
      await failProject(deps, fresh, current.status);
    }
    log.error("worker", "failed", { jobType: job.jobType, jobId: job.id, code: failure.code, ms: Date.now() - started });
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
