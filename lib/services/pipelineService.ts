import type { RequestAuth } from "@/lib/auth/session";
import type { WorkflowMode } from "@/lib/domain/projectCatalog";
import { canTransition } from "@/lib/domain/projectStatus";
import { StudioError } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { isObjectId } from "@/lib/repositories/ownership";
import { validateEpisodeScreenplay } from "@/lib/domain/screenplayValidation";
import { canonFromApprovedSources, prepareWorkingCanon, resolveWorkingCanon } from "@/lib/domain/narrativeControl";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { CanonState } from "@/lib/validation/narrativeControl";
import { screenplayEditSchema } from "@/lib/validation/story";
import { enqueueForRun } from "@/lib/pipeline/processJob";
import { sceneHasStoredVideo } from "@/lib/pipeline/mediaEvidence";
import { resolveSceneRange } from "@/lib/providers/llm/budget";
import type { PipelineDeps } from "@/lib/pipeline/ports";
import type { JobRecord, RunRecord } from "@/lib/pipeline/types";
import type { StoryRecord } from "@/lib/validation/story";
import type { EpisodeValidation } from "@/lib/validation/casna";

const ACTIVE = new Set(["pending", "running", "waiting_for_approval"]);

function requireProjectId(id: string) {
  if (!isObjectId(id)) throw new StudioError("That project id is not valid", 400, "invalid_id");
}

async function ownedRun(deps: PipelineDeps, actor: RequestAuth, projectId: string): Promise<RunRecord> {
  const run = await deps.runs.findLatest(actor.userId, projectId);
  if (!run) throw new StudioError("No production run exists for this project. Call pipeline.start first to create a production run at the story stage.", 409, "run_required");
  return run;
}

/**
 * Production builds on approved canon. Every stage after the episode screenplay
 * — beginning with character extraction — requires an approved Story Bible.
 */
async function requireApprovedBible(deps: PipelineDeps, actor: RequestAuth, projectId: string): Promise<number> {
  if (!deps.bibles) return 0;
  const bible = await deps.bibles.findOwned(actor.userId, projectId);
  if (!bible || bible.approvedVersion === 0) {
    throw new StudioError("Approve the Story Bible before beginning production", 409, "bible_required");
  }
  return bible.approvedVersion;
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
  story: StoryRecord,
  skipAutoAdvance?: boolean,
): Promise<{ story: StoryRecord; job: JobRecord | null }> {
  const project = await deps.projects.findOwned(actor.userId, projectId);
  if (!project) throw new StudioError("Project not found", 404, "not_found");
  await requireApprovedBible(deps, actor, projectId);
  const saved = await deps.stories.markApproved(actor.userId, story.id);
  if (!saved || saved.status !== "approved") {
    throw new StudioError("This story cannot be approved", 409, "story_unavailable");
  }
  // CASNA Stage I: only an approved episode may change canon. If the ledger
  // cannot be updated, roll the approval back so the two never diverge.
  if (deps.casna && run.episode) {
    try {
      await deps.casna.onEpisodeApproved({
        clerkUserId: actor.userId,
        projectId,
        episodeNumber: run.episode.number,
        story: saved,
      });
    } catch {
      if (deps.stories.revertApproval) {
        await deps.stories.revertApproval(actor.userId, saved.id);
      }
      throw new StudioError(
        "The episode was not approved because its continuity record could not be saved. Try approving it again.",
        503,
        "canon_update_failed"
      );
    }

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
  if (skipAutoAdvance) {
    run.status = "waiting_for_approval";
    run.stageResults.characters = { approved: false, names: [] };
  } else {
    run.status = "running";
  }
  await deps.runs.save(run);
  if (skipAutoAdvance) return { story: saved, job: null };
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
      const bibleApprovedVersion = await requireApprovedBible(deps, actor, projectId);
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
      // CASNA Stage E: episodes are generated in order, from an approved and
      // current Season Plan, only after every earlier episode is approved.
      if (deps.casna && episode) {
        const context = await deps.casna.load({
          clerkUserId: actor.userId,
          projectId,
          productionMode: project.productionMode,
          episodeNumber: episode.episodeNumber,
          bibleApprovedVersion,
        });
        if (!context.gate.allowed) {
          throw new StudioError(context.gate.reason ?? "This episode is locked.", 409, context.gate.code);
        }
        if (context.episodePlanValidation && !context.episodePlanValidation.passed) {
          const error = context.episodePlanValidation.findings.find((finding) => finding.severity === "error");
          throw new StudioError(
            error?.message ?? "The episode plan conflicts with the approved Season Plan.",
            409,
            "plan_conflict"
          );
        }
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

    async approveStory(actor: RequestAuth, projectId: string, storyId: string, skipAutoAdvance?: boolean) {
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
      // CASNA Stage H: a screenplay that failed canon validation can never be
      // approved into the story's established canon.
      if (story.validationFindings && !story.validationFindings.passed) {
        const errors = story.validationFindings.findings.filter((f) => f.severity === "error");
        const summary = errors.length > 0
          ? errors.map((e, i) => `${i + 1}. ${e.message}`).join("\n")
          : "This screenplay did not pass canon validation. Regenerate it before approving.";
        throw new StudioError(
          summary,
          409,
          "story_invalid",
          errors,
        );
      }
      if (story.status === "approved" || run.stageResults.story?.approved) {
        await requireApprovedBible(deps, actor, projectId);
        if (story.status !== "approved") {
          const marked = await deps.stories.markApproved(actor.userId, story.id);
          if (!marked) throw new StudioError("This story cannot be approved", 409, "story_unavailable");
          story = marked;
        }
        if (run.stageResults.story && !run.stageResults.story.approved) {
          run.stageResults.story.approved = true;
          run.currentStage = "characters";
          run.status = skipAutoAdvance ? "waiting_for_approval" : "running";
          if (skipAutoAdvance) run.stageResults.characters = { approved: false, names: [] };
          await deps.runs.save(run);
        }
        if (run.episode && deps.episodes) await deps.episodes.updateStatus(actor.userId, projectId, run.episode.id, "story_approved", story.id);
        // Idempotent: re-approval after a partial failure re-applies canon only
        // when the ledger has not already caught up with this episode.
        if (deps.casna && run.episode) {
          try {
            await deps.casna.onEpisodeApproved({
              clerkUserId: actor.userId,
              projectId,
              episodeNumber: run.episode.number,
              story,
            });
          } catch {
            if (deps.stories.revertApproval) {
              await deps.stories.revertApproval(actor.userId, story.id);
            }
            throw new StudioError(
              "The episode was not approved because its continuity record could not be saved. Try approving it again.",
              503,
              "canon_update_failed"
            );
          }
        }
        const project = await deps.projects.findOwned(actor.userId, projectId);
        if (project?.status === "planning" && canTransition(project.status, "story_ready")) {
          await deps.projects.update(actor.userId, projectId, { status: "story_ready" });
        }
        if (skipAutoAdvance) return { story, job: null, alreadyApproved: true as const };
        const job =
          (await existingCharacterJob(deps, run.id)) ??
          (await enqueueForRun(deps, run, "character.extract", null, {}));
        return { story, job, alreadyApproved: true as const };
      }
      if (run.status !== "waiting_for_approval" || run.currentStage !== "story" || !run.stageResults.story) {
        throw new StudioError("This story is not waiting for approval", 409, "not_waiting");
      }
      // The pacing gate runs during generation, but a story could still be
      // persisted below its floor if a stage was bypassed or a legacy record
      // predates the rule. Enforce it at the approval boundary too so an
      // incomplete screenplay can never be approved into the pipeline.
      const project = await deps.projects.findOwned(actor.userId, projectId);
      if (!project) throw new StudioError("Project not found", 404, "not_found");
      const targetSeconds = run.episode?.targetDurationSeconds ?? project.targetDurationSeconds;
      const enforced = await enforceStoryCanon(deps, actor.userId, projectId, story, {
        episodeNumber: run.episode?.number ?? 1,
        targetDurationSeconds: targetSeconds,
        sceneRange: project.sceneRange,
        seriesTitle: project.title,
        productionMode: project.productionMode,
      });
      if (enforced && !enforced.passed) {
        const errors = enforced.findings.filter((f) => f.severity === "error");
        const summary = errors.length > 0
          ? errors.map((e, i) => `${i + 1}. ${e.message}`).join("\n")
          : "This screenplay did not pass canon validation. Regenerate it before approving.";
        throw new StudioError(
          summary,
          409,
          "story_invalid",
          errors,
        );
      }
      const range = resolveSceneRange(targetSeconds, project.sceneRange);
      if (story.screenplay.length < range.min || story.screenplay.length > range.max) {
        throw new StudioError(
          `This story has ${story.screenplay.length} screenplay scene${story.screenplay.length === 1 ? "" : "s"} but a ${targetSeconds}-second episode needs ${range.min} to ${range.max}. Generate the episode again before approving.`,
          409,
          "story_incomplete"
        );
      }
      const approved = await acceptStory(deps, actor, projectId, run, story, skipAutoAdvance);
      return { story: approved.story, job: approved.job, alreadyApproved: false as const };
    },

    /**
     * CASNA: save a creator's manual screenplay revision before approval.
     *
     * The edited screenplay is revalidated against the same canon a generated
     * one is. An approved story is immutable here; it must be regenerated as a
     * new episode revision instead.
     */
    async updateStory(actor: RequestAuth, projectId: string, storyId: string, raw: unknown) {
      requireProjectId(projectId);
      if (!isObjectId(storyId)) throw new StudioError("That story id is not valid", 400, "invalid_id");
      const run = await ownedRun(deps, actor, projectId);
      const story = await deps.stories.findOwned(actor.userId, storyId);
      if (!story || story.projectId !== projectId || story.productionRunId !== run.id) {
        throw new StudioError("Story not found", 404, "not_found");
      }
      if (story.status !== "awaiting_approval") {
        throw new StudioError(
          "Only a screenplay awaiting approval can be edited.",
          409,
          "story_locked"
        );
      }
      const parsed = screenplayEditSchema.safeParse(raw);
      if (!parsed.success) {
        throw new StudioError(parsed.error.issues[0]?.message ?? "Check the screenplay", 400, "invalid_input");
      }
      if (parsed.data.expectedUpdatedAt && parsed.data.expectedUpdatedAt !== story.updatedAt) {
        throw new StudioError(
          "This screenplay changed while you were editing it. Reload before saving.",
          409,
          "story_modified"
        );
      }
      let validationFindings = story.validationFindings ?? null;
      const project = await deps.projects.findOwned(actor.userId, projectId);
      const bibleSnapshot = run.episode
        ? run.episode.baseSnapshotVersion > 0 && deps.bibles?.findApprovedVersion
          ? await deps.bibles.findApprovedVersion(actor.userId, projectId, run.episode.baseSnapshotVersion)
          : (await deps.bibles?.findApproved?.(actor.userId, projectId)) ?? null
        : null;
      const canon = await workingCanonFor(deps, actor.userId, projectId, bibleSnapshot?.content ?? null, bibleSnapshot?.version ?? 0);
      if (deps.casna && run.episode) {
        const context = await deps.casna.load({
          clerkUserId: actor.userId,
          projectId,
          productionMode: "serialized",
          episodeNumber: run.episode.number,
          bibleApprovedVersion: bibleSnapshot?.version ?? run.episode.baseSnapshotVersion,
          withScreenplays: true,
        });
        validationFindings = validateEpisodeScreenplay({
          episodeNumber: run.episode.number,
          seriesTitle: bibleSnapshot?.content?.identity.title ?? project?.title ?? "the series",
          story: {
            title: parsed.data.title ?? story.title,
            synopsis: parsed.data.synopsis ?? story.synopsis,
            screenplay: parsed.data.screenplay,
          },
          targetDurationSeconds: run.episode.targetDurationSeconds,
          bible: bibleSnapshot?.content ?? null,
          seasonPlan: context.plan,
          episodePlan: context.episodePlan,
          ledger: context.ledger,
          previousEpisodes: context.previousEpisodes,
          canon,
          structure: story.structure,
          sceneRange: project?.sceneRange,
        });
      } else if (canon && run.episode) {
        validationFindings = validateEpisodeScreenplay({
          episodeNumber: run.episode.number,
          seriesTitle: project?.title ?? "the series",
          story: {
            title: parsed.data.title ?? story.title,
            synopsis: parsed.data.synopsis ?? story.synopsis,
            screenplay: parsed.data.screenplay,
          },
          targetDurationSeconds: run.episode.targetDurationSeconds,
          bible: bibleSnapshot?.content ?? null,
          seasonPlan: null,
          episodePlan: null,
          ledger: null,
          previousEpisodes: [],
          canon,
          structure: story.structure,
          sceneRange: project?.sceneRange,
        });
      } else if (!validationFindings || validationFindings.passed) {
        validationFindings = {
          passed: false,
          findings: [{
            category: "canon",
            severity: "error",
            code: "canon_unavailable",
            message: "Narrative canon was not loaded, so this screenplay cannot be marked valid.",
          }],
          validatedAt: new Date().toISOString(),
        };
      }
      if (!validationFindings.passed) {
        const errors = validationFindings.findings.filter((f) => f.severity === "error");
        const summary = errors.length > 0
          ? errors.map((e, i) => `${i + 1}. ${e.message}`).join("\n")
          : "This screenplay conflicts with approved canon, so the previous version was kept.";
        throw new StudioError(
          summary,
          409,
          "story_invalid",
          errors,
        );
      }
      if (!deps.stories.updateScreenplay) {
        throw new StudioError("Screenplay editing is not available.", 503, "editing_unavailable");
      }
      const saved = await deps.stories.updateScreenplay(actor.userId, story.id, {
        title: parsed.data.title,
        synopsis: parsed.data.synopsis,
        screenplay: parsed.data.screenplay,
        validationFindings,
        expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      });
      if (!saved) {
        throw new StudioError(
          "This screenplay changed while you were editing it. Reload before saving.",
          409,
          "story_modified"
        );
      }
      log.info("pipeline", "screenplay edited", {
        projectId,
        storyId: saved.id,
        scenes: saved.screenplay.length,
        validationPassed: saved.validationFindings?.passed ?? null,
      });
      return { story: saved };
    },

    async approve(actor: RequestAuth, projectId: string, skipAutoAdvance?: boolean) {
      const run = await ownedRun(deps, actor, projectId);
      if (run.currentStage === "story" && run.stageResults.story?.storyId) {
        const result = await this.approveStory(actor, projectId, run.stageResults.story.storyId, skipAutoAdvance);
        return result.job ?? result.story;
      }
      if (run.stageResults.story?.approved && run.currentStage === "story") {
        await requireApprovedBible(deps, actor, projectId);
        if (skipAutoAdvance) {
          run.currentStage = "characters";
          run.status = "waiting_for_approval";
          run.stageResults.characters = { approved: false, names: [] };
          await deps.runs.save(run);
          return { message: "Story approved. Characters stage ready for manual input (auto-advance skipped)." };
        }
        return enqueueForRun(deps, run, "character.extract", null, {});
      }
      if (run.status !== "waiting_for_approval") {
        throw new StudioError("This stage is not waiting for approval", 409, "not_waiting");
      }
      const project = await deps.projects.findOwned(actor.userId, projectId);
      if (!project) throw new StudioError("Project not found", 404, "not_found");

      if (run.currentStage === "story" && run.stageResults.story) {
        await requireApprovedBible(deps, actor, projectId);
        run.stageResults.story.approved = true;
        if (run.episode && deps.episodes && run.stageResults.story.storyId) {
          await deps.episodes.updateStatus(actor.userId, projectId, run.episode.id, "story_approved", run.stageResults.story.storyId);
        }
        if (!canTransition(project.status, "story_ready")) {
          throw new StudioError("The story cannot be accepted yet", 409, "invalid_transition");
        }
        await deps.projects.update(actor.userId, projectId, { status: "story_ready" });
        run.currentStage = "characters";
        run.status = skipAutoAdvance ? "waiting_for_approval" : "running";
        if (skipAutoAdvance) run.stageResults.characters = { approved: false, names: [] };
        await deps.runs.save(run);
        if (skipAutoAdvance) return { message: "Story approved. Characters stage ready for manual input (auto-advance skipped)." };
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
        run.status = skipAutoAdvance ? "waiting_for_approval" : "running";
        if (skipAutoAdvance) run.stageResults.scenes = { approved: false, items: [] };
        await deps.runs.save(run);
        if (skipAutoAdvance) return { message: "Characters approved. Scenes stage ready for manual input (auto-advance skipped)." };
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
        run.status = skipAutoAdvance ? "waiting_for_approval" : "running";
        await deps.runs.save(run);
        if (skipAutoAdvance) return { message: "Scenes approved. Media stage ready for manual input (auto-advance skipped)." };
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
        run.status = skipAutoAdvance ? "waiting_for_approval" : "running";
        await deps.runs.save(run);
        if (skipAutoAdvance) return { message: "Media approved. Render stage ready for manual input (auto-advance skipped)." };
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

function isUsableBible(content: StoryBibleContent | null | undefined): content is StoryBibleContent {
  return Boolean(
    content
    && Array.isArray(content.characters?.characters)
    && Array.isArray(content.world?.rules)
    && Array.isArray(content.canon?.confirmedFacts),
  );
}

async function workingCanonFor(
  deps: PipelineDeps,
  clerkUserId: string,
  projectId: string,
  content: StoryBibleContent | null | undefined,
  bibleVersion: number,
): Promise<CanonState | null> {
  if (!isUsableBible(content) && !deps.narrativeCanon) return null;
  const derived = isUsableBible(content)
    ? canonFromApprovedSources({ projectId, bible: content, bibleVersion })
    : null;
  if (!derived) {
    const stored = await deps.narrativeCanon?.latest(clerkUserId, projectId) ?? null;
    return stored;
  }
  return prepareWorkingCanon({
    clerkUserId,
    projectId,
    derived,
    port: deps.narrativeCanon,
  });
}

async function enforceStoryCanon(
  deps: PipelineDeps,
  clerkUserId: string,
  projectId: string,
  story: StoryRecord,
  scope: {
    episodeNumber: number;
    targetDurationSeconds: number;
    sceneRange?: { min: number; max: number } | null;
    seriesTitle: string;
    productionMode?: string;
  },
): Promise<EpisodeValidation | null> {
  if (!deps.bibles?.findApproved && !deps.narrativeCanon) return null;
  const bible = await deps.bibles?.findApproved?.(clerkUserId, projectId) ?? null;
  const canon = await workingCanonFor(deps, clerkUserId, projectId, bible?.content, bible?.version ?? 0);
  const canonLogState = deps.canonFactLog
    ? await deps.canonFactLog.latestState(clerkUserId, projectId).catch(() => null)
    : null;
  if (!canon && !canonLogState) return null;
  if (!canonLogState && canon && canon.facts.length === 0 && canon.rules.length === 0) return null;
  let seasonPlan = null;
  let episodePlan = null;
  let ledger = null;
  let previousEpisodes: Parameters<typeof validateEpisodeScreenplay>[0]["previousEpisodes"] = [];
  if (deps.casna && scope.productionMode) {
    try {
      const context = await deps.casna.load({
        clerkUserId,
        projectId,
        productionMode: scope.productionMode,
        episodeNumber: scope.episodeNumber,
        bibleApprovedVersion: bible?.version ?? 0,
      });
      seasonPlan = context.plan;
      episodePlan = context.episodePlan;
      ledger = context.ledger;
      previousEpisodes = context.previousEpisodes;
    } catch {
      // If the CASNA context cannot be loaded, fall back to canon-only validation.
    }
  }
  const validation = validateEpisodeScreenplay({
    episodeNumber: scope.episodeNumber,
    seriesTitle: scope.seriesTitle,
    story: { title: story.title, synopsis: story.synopsis, screenplay: story.screenplay },
    targetDurationSeconds: scope.targetDurationSeconds,
    bible: isUsableBible(bible?.content) ? bible.content : null,
    seasonPlan,
    episodePlan,
    ledger,
    previousEpisodes,
    canon,
    canonLogState,
    canonBasedOnBibleVersion: bible?.version,
    canonBasedOnPlanVersion: seasonPlan?.version,
    structure: story.structure,
    sceneRange: scope.sceneRange,
  });
  if (!validation.passed) return validation;
  if (deps.narrativeCanon && canon) {
    const committed = await resolveWorkingCanon({
      clerkUserId,
      projectId,
      derived: canon,
      port: deps.narrativeCanon,
    });
    await deps.stories.recordCanonVersion?.(clerkUserId, story.id, committed.version);
    log.info("pipeline", "canon committed on approval", {
      projectId,
      storyId: story.id,
      canonVersion: committed.version,
      canonCommitted: true,
      artifactsStale: true,
    });
  }
  return validation;
}
