import type { RequestAuth } from "@/lib/auth/session";
import type { WorkflowMode } from "@/lib/domain/projectCatalog";
import { canTransition } from "@/lib/domain/projectStatus";
import { StudioError } from "@/lib/http/errors";
import { isObjectId } from "@/lib/repositories/ownership";
import { enqueueForRun } from "@/lib/pipeline/processJob";
import { sceneHasStoredVideo } from "@/lib/pipeline/mediaEvidence";
import type { PipelineDeps } from "@/lib/pipeline/ports";
import type { JobRecord, RunRecord } from "@/lib/pipeline/types";
import type { StoryRecord } from "@/lib/validation/story";

const ACTIVE = new Set(["pending", "running", "waiting_for_approval"]);

function requireProjectId(id: string) {
  if (!isObjectId(id)) throw new StudioError("That project id is not valid", 400, "invalid_id");
}

async function ownedRun(deps: PipelineDeps, actor: RequestAuth, projectId: string): Promise<RunRecord> {
  const run = await deps.runs.findLatest(actor.userId, projectId);
  if (!run) throw new StudioError("Start a production before this step", 409, "run_required");
  return run;
}

async function existingCharacterJob(deps: PipelineDeps, runId: string): Promise<JobRecord | null> {
  const jobs = await deps.jobs.listForRun(runId);
  return jobs.find((job) => job.jobType === "character.extract" && job.status !== "cancelled") ?? null;
}

async function acceptStory(
  deps: PipelineDeps,
  actor: RequestAuth,
  projectId: string,
  run: RunRecord,
  story: StoryRecord
): Promise<{ story: StoryRecord; job: JobRecord }> {
  const project = await deps.projects.findOwned(actor.userId, projectId);
  if (!project) throw new StudioError("Project not found", 404, "not_found");
  const saved = await deps.stories.markApproved(actor.userId, story.id);
  if (!saved || saved.status !== "approved") {
    throw new StudioError("This story cannot be approved", 409, "story_unavailable");
  }
  if (run.stageResults.story) {
    run.stageResults.story.approved = true;
    run.stageResults.story.storyId = saved.id;
    run.stageResults.story.title = saved.title;
    run.stageResults.story.synopsis = saved.synopsis;
  }
  if (run.episode && deps.episodes) {
    await deps.episodes.updateStatus(actor.userId, projectId, run.episode.id, "story_approved", saved.id);
  }
  if (project.status === "planning") {
    if (!canTransition(project.status, "story_ready")) {
      throw new StudioError("The story cannot be accepted yet", 409, "invalid_transition");
    }
    await deps.projects.update(actor.userId, projectId, { status: "story_ready" });
  }
  run.currentStage = "characters";
  run.status = "running";
  await deps.runs.save(run);
  const job =
    (await existingCharacterJob(deps, run.id)) ??
    (await enqueueForRun(deps, run, "character.extract", null, {}));
  return { story: saved, job };
}

export function createPipelineService(deps: PipelineDeps) {
  const service = {
    async get(actor: RequestAuth, projectId: string) {
      requireProjectId(projectId);
      const project = await deps.projects.findOwned(actor.userId, projectId);
      if (!project) throw new StudioError("Project not found", 404, "not_found");
      const run = await deps.runs.findLatest(actor.userId, projectId);
      const jobs = run ? await deps.jobs.listForRun(run.id) : [];
      const story = run ? await deps.stories.findForRun(actor.userId, run.id) : null;
      const scenes = run && deps.scenes ? await deps.scenes.listForRun(actor.userId, run.id) : [];
      return { run, jobs, story, scenes };
    },

    async start(actor: RequestAuth, projectId: string, workflowMode: WorkflowMode, episodeId?: string) {
      requireProjectId(projectId);
      const project = await deps.projects.findOwned(actor.userId, projectId);
      if (!project) throw new StudioError("Project not found", 404, "not_found");
      const latest = await deps.runs.findLatest(actor.userId, projectId);
      if (latest && ACTIVE.has(latest.status)) {
        throw new StudioError("A production is already in progress", 409, "run_active");
      }
      const episode = episodeId
        ? await deps.episodes?.findOwned(actor.userId, projectId, episodeId)
        : await deps.episodes?.ensureFirst(actor.userId, projectId, project.title, project.targetDurationSeconds);
      if (episodeId && !episode) throw new StudioError("Episode not found", 404, "episode_not_found");
      if (episode && episode.status !== "draft") throw new StudioError("This episode is not available to start", 409, "episode_unavailable");
      if (episode && deps.episodes && project.productionMode === "serialized" && episode.episodeNumber > 1 && episode.baseSnapshotVersion === 0) {
        throw new StudioError("Serialized episode has no approved canon snapshot", 409, "canon_required");
      }
      if (project.status !== "planning" && !canTransition(project.status, "planning", latest?.retryCheckpoint ?? undefined)) {
        throw new StudioError("This project cannot start production", 409, "invalid_transition");
      }
      const run = await deps.runs.insert({
        clerkUserId: actor.userId,
        projectId,
        episode: episode ? {
          id: episode.id,
          number: episode.episodeNumber,
          title: episode.title,
          premise: episode.premise,
          targetDurationSeconds: episode.targetDurationSeconds,
          baseSnapshotVersion: episode.baseSnapshotVersion,
        } : null,
        workflowMode,
        currentStage: "story",
        status: "running",
        stageResults: {},
        retryCheckpoint: project.status,
        startedAt: new Date().toISOString(),
        completedAt: null,
      });
      if (project.status !== "planning") await deps.projects.update(actor.userId, projectId, { status: "planning" });
      if (episode && deps.episodes) await deps.episodes.updateStatus(actor.userId, projectId, episode.id, "in_production");
      return run;
    },

    async generateStory(actor: RequestAuth, projectId: string) {
      const run = await ownedRun(deps, actor, projectId);
      const project = await deps.projects.findOwned(actor.userId, projectId);
      if (
        project?.status === "failed" &&
        run.currentStage === "story" &&
        !run.stageResults.story?.approved
      ) {
        return service.retry(actor, projectId);
      }
      if (!project || project.status !== "planning" || run.stageResults.story?.approved) {
        throw new StudioError("The story step is not available", 409, "stage_unavailable");
      }
      return enqueueForRun(deps, run, "story.generate", null, {
        idea: project.originalStoryIdea,
      });
    },

    async approveStory(actor: RequestAuth, projectId: string, storyId: string) {
      requireProjectId(projectId);
      if (!isObjectId(storyId)) throw new StudioError("That story id is not valid", 400, "invalid_id");
      const run = await ownedRun(deps, actor, projectId);
      let story = await deps.stories.findOwned(actor.userId, storyId);
      if (!story || story.projectId !== projectId || story.productionRunId !== run.id) {
        throw new StudioError("Story not found", 404, "not_found");
      }
      if (story.status === "failed") {
        throw new StudioError("A failed story cannot be approved", 409, "story_failed");
      }
      if (story.status === "approved" || run.stageResults.story?.approved) {
        if (story.status !== "approved") {
          const marked = await deps.stories.markApproved(actor.userId, story.id);
          if (!marked) throw new StudioError("This story cannot be approved", 409, "story_unavailable");
          story = marked;
        }
        if (run.stageResults.story && !run.stageResults.story.approved) {
          run.stageResults.story.approved = true;
          run.currentStage = "characters";
          run.status = "running";
          await deps.runs.save(run);
        }
        if (run.episode && deps.episodes) await deps.episodes.updateStatus(actor.userId, projectId, run.episode.id, "story_approved", story.id);
        const project = await deps.projects.findOwned(actor.userId, projectId);
        if (project?.status === "planning" && canTransition(project.status, "story_ready")) {
          await deps.projects.update(actor.userId, projectId, { status: "story_ready" });
        }
        const job =
          (await existingCharacterJob(deps, run.id)) ??
          (await enqueueForRun(deps, run, "character.extract", null, {}));
        return { story, job, alreadyApproved: true as const };
      }
      if (run.status !== "waiting_for_approval" || run.currentStage !== "story" || !run.stageResults.story) {
        throw new StudioError("This story is not waiting for approval", 409, "not_waiting");
      }
      const approved = await acceptStory(deps, actor, projectId, run, story);
      return { story: approved.story, job: approved.job, alreadyApproved: false as const };
    },

    async approve(actor: RequestAuth, projectId: string) {
      const run = await ownedRun(deps, actor, projectId);
      if (run.currentStage === "story" && run.stageResults.story?.storyId) {
        const result = await this.approveStory(actor, projectId, run.stageResults.story.storyId);
        return result.job ?? result.story;
      }
      if (run.stageResults.story?.approved && run.currentStage === "story") {
        return enqueueForRun(deps, run, "character.extract", null, {});
      }
      if (run.status !== "waiting_for_approval") {
        throw new StudioError("This stage is not waiting for approval", 409, "not_waiting");
      }
      const project = await deps.projects.findOwned(actor.userId, projectId);
      if (!project) throw new StudioError("Project not found", 404, "not_found");

      if (run.currentStage === "story" && run.stageResults.story) {
        run.stageResults.story.approved = true;
        if (run.episode && deps.episodes && run.stageResults.story.storyId) {
          await deps.episodes.updateStatus(actor.userId, projectId, run.episode.id, "story_approved", run.stageResults.story.storyId);
        }
        if (!canTransition(project.status, "story_ready")) {
          throw new StudioError("The story cannot be accepted yet", 409, "invalid_transition");
        }
        await deps.projects.update(actor.userId, projectId, { status: "story_ready" });
        run.currentStage = "characters";
        run.status = "running";
        await deps.runs.save(run);
        return enqueueForRun(deps, run, "character.extract", null, {});
      }

      if (run.currentStage === "characters" && run.stageResults.characters) {
        await deps.continuity?.approveCharactersForRun(actor.userId, projectId, run.id);
        run.stageResults.characters.approved = true;
        if (!canTransition(project.status, "characters_ready")) {
          throw new StudioError("The characters cannot be accepted yet", 409, "invalid_transition");
        }
        await deps.projects.update(actor.userId, projectId, { status: "characters_ready" });
        run.currentStage = "scenes";
        run.status = "running";
        await deps.runs.save(run);
        return enqueueForRun(deps, run, "scene.breakdown", null, {});
      }

      if (run.currentStage === "scenes" && run.stageResults.scenes) {
        await deps.continuity?.approveScenesForRun(actor.userId, projectId, run.id);
        run.stageResults.scenes.approved = true;
        if (!canTransition(project.status, "scenes_ready") || !canTransition("scenes_ready", "generating")) {
          throw new StudioError("The scenes cannot be accepted yet", 409, "invalid_transition");
        }
        await deps.projects.update(actor.userId, projectId, { status: "scenes_ready" });
        await deps.projects.update(actor.userId, projectId, { status: "generating" });
        run.currentStage = "media";
        run.status = "running";
        await deps.runs.save(run);
        const jobs = [];
        for (const scene of run.stageResults.scenes.items) {
          jobs.push(
            await enqueueForRun(deps, run, "video.scene", scene.sceneNumber, {
              sceneNumber: scene.sceneNumber,
            })
          );
        }
        return jobs[0];
      }

      if (run.currentStage === "media") {
        const items = run.stageResults.scenes?.items ?? [];
        if (items.length === 0 || items.some((scene) => !sceneHasStoredVideo(scene))) {
          throw new StudioError(
            "Every scene needs a validated, stored video asset before rendering",
            409,
            "media_incomplete"
          );
        }
        if (!canTransition(project.status, "rendering")) {
          throw new StudioError("Rendering cannot start yet", 409, "invalid_transition");
        }
        await deps.projects.update(actor.userId, projectId, { status: "rendering" });
        run.currentStage = "render";
        run.status = "running";
        await deps.runs.save(run);
        return enqueueForRun(deps, run, "render.final", null, {});
      }

      throw new StudioError("Nothing is waiting for approval", 409, "not_waiting");
    },

    async generateScenes(actor: RequestAuth, projectId: string) {
      const run = await ownedRun(deps, actor, projectId);
      if (!run.stageResults.story?.approved || !run.stageResults.characters?.approved) {
        throw new StudioError("Scenes require an approved story and characters", 409, "dependency");
      }
      return enqueueForRun(deps, run, "scene.breakdown", null, {});
    },

    async retry(actor: RequestAuth, projectId: string) {
      const run = await ownedRun(deps, actor, projectId);
      const project = await deps.projects.findOwned(actor.userId, projectId);
      if (!project) throw new StudioError("Project not found", 404, "not_found");
      if (project.status !== "failed" || !run.retryCheckpoint) {
        throw new StudioError("This production cannot be retried", 409, "retry_unavailable");
      }
      if (!canTransition(project.status, run.retryCheckpoint, run.retryCheckpoint)) {
        throw new StudioError("This production cannot be retried", 409, "invalid_transition");
      }
      await deps.projects.update(actor.userId, projectId, { status: run.retryCheckpoint });
      run.status = "running";
      await deps.runs.save(run);
      if (run.currentStage === "story") return enqueueForRun(deps, run, "story.generate", null, {});
      if (run.currentStage === "characters") return enqueueForRun(deps, run, "character.extract", null, {});
      if (run.currentStage === "scenes") return enqueueForRun(deps, run, "scene.breakdown", null, {});
      if (run.currentStage === "media") {
        const scenes = run.stageResults.scenes?.items ?? [];
        const retryableScenes = scenes.filter((scene) => !sceneHasStoredVideo(scene));
        if (retryableScenes.length === 0) {
          throw new StudioError("There are no unavailable scene videos to retry", 409, "retry_unavailable");
        }
        for (const scene of retryableScenes) {
          scene.videoReady = false;
          scene.videoStatus = "pending";
          scene.videoAssetId = undefined;
          scene.failed = false;
        }
        run.status = "running";
        await deps.runs.save(run);
        let first: JobRecord | null = null;
        for (const scene of retryableScenes) {
          const job = await enqueueForRun(deps, run, "video.scene", scene.sceneNumber, {
            sceneNumber: scene.sceneNumber,
          });
          first ??= job;
        }
        if (first) return first;
      }
      if (run.currentStage === "render") return enqueueForRun(deps, run, "render.final", null, {});
      throw new StudioError("This production cannot be retried", 409, "retry_unavailable");
    },

    async retryScene(actor: RequestAuth, projectId: string, sceneNumber: number) {
      const run = await ownedRun(deps, actor, projectId);
      const scene = run.stageResults.scenes?.items.find((item) => item.sceneNumber === sceneNumber);
      if (!scene?.failed) throw new StudioError("That scene is not failed", 409, "scene_not_failed");
      scene.failed = false;
      await deps.runs.save(run);
      return enqueueForRun(deps, run, "video.scene", sceneNumber, { sceneNumber });
    },

    async cancel(actor: RequestAuth, projectId: string) {
      const run = await ownedRun(deps, actor, projectId);
      const jobs = await deps.jobs.listForRun(run.id);
      for (const job of jobs) {
        if (job.status === "queued" || job.status === "processing") {
          job.status = "cancelled";
          job.completedAt = new Date().toISOString();
          await deps.jobs.save(job);
        }
      }
      const project = await deps.projects.findOwned(actor.userId, projectId);
      if (project && canTransition(project.status, "failed")) {
        run.retryCheckpoint = project.status;
        await deps.projects.update(actor.userId, projectId, { status: "failed" });
      }
      run.status = "cancelled";
      await deps.runs.save(run);
      return run;
    },
  };
  return service;
}
