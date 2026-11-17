import "server-only";
import { createHash } from "node:crypto";
import type { RequestAuth } from "@/lib/auth/session";
import { isBusyStatus } from "@/lib/domain/projectCatalog";
import { canTransition } from "@/lib/domain/projectStatus";
import { StudioError } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { livePipelineDeps } from "@/lib/pipeline/live";
import { stageMessage } from "@/lib/pipeline/messages";
import { generationJobRepository } from "@/lib/repositories/generationJobRepository";
import { isObjectId } from "@/lib/repositories/ownership";
import { projectRepository } from "@/lib/repositories/projectRepository";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { storyDraftRequestSchema, findingResolutionRequestSchema } from "@/lib/validation/story";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { narrativeCanonRepository } from "@/lib/repositories/narrativeCanonRepository";
import { canonFromApprovedSources, prepareWorkingCanon, resolveWorkingCanon, type CanonPort } from "@/lib/domain/narrativeControl";
import { contractMatchesDraft } from "@/lib/domain/storyContract";
import { validateEpisodeScreenplay } from "@/lib/domain/screenplayValidation";
import {
  canAcceptAsIntentional,
  isBlockingFinding,
  mergeResolutions,
  validationPassesForApproval,

} from "@/lib/validation/casna";
import type { StoryBibleSnapshot } from "@/lib/validation/storyBible";

const OPEN = new Set(["queued", "processing"]);
const MAX_ATTEMPTS = 3;

export function keyPrefix(projectId: string): string {
  return `storyDraft:${projectId}`;
}

export function createStoryDraftService(deps = {
  projects: projectRepository,
  stories: storyRepository,
  jobs: generationJobRepository,
  queueFactory: () => livePipelineDeps().queue,
  bibles: storyBibleRepository as {
    findApproved(clerkUserId: string, projectId: string): Promise<StoryBibleSnapshot | null>;
  },
  narrativeCanon: narrativeCanonRepository as CanonPort,
}) {
  async function loadProject(actor: RequestAuth, projectId: string) {
    if (!isObjectId(projectId)) throw new StudioError("That project id is not valid", 400, "invalid_id");
    const project = await deps.projects.findOwned(actor.userId, projectId);
    if (!project) throw new StudioError("Project not found", 404, "not_found");
    return project;
  }

  return {
    /** The project-level story draft and its latest generation job, if any. */
    async get(actor: RequestAuth, projectId: string) {
      await loadProject(actor, projectId);
      const story = await deps.stories.findProjectDraft(actor.userId, projectId);
      const jobs = await deps.jobs.listByKeyPrefix(keyPrefix(projectId));
      const job = jobs.find((item) => OPEN.has(item.status)) ?? jobs[jobs.length - 1] ?? null;
      return { story, job };
    },

    async start(actor: RequestAuth, projectId: string, raw: unknown) {
      const project = await loadProject(actor, projectId);
      if (project.status === "archived") {
        throw new StudioError("This project is archived", 409, "project_archived");
      }
      if (isBusyStatus(project.status)) {
        throw new StudioError("Wait until production is idle before developing the story draft", 409, "project_busy");
      }
      const bible = await deps.bibles.findApproved(actor.userId, projectId);
      if (!bible) {
        throw new StudioError("Approve the Story Bible before developing the story draft", 409, "bible_required");
      }
      const parsed = storyDraftRequestSchema.safeParse(raw ?? {});
      if (!parsed.success) {
        throw new StudioError(parsed.error.issues[0]?.message ?? "Check the request", 400, "invalid_input");
      }
      const existing = await deps.jobs.listByKeyPrefix(keyPrefix(projectId));
      const open = existing.find((item) => OPEN.has(item.status));
      if (open) {
        // A generation is already running: never queue a competing duplicate.
        return { story: await deps.stories.findProjectDraft(actor.userId, projectId), job: open };
      }
      const queue = deps.queueFactory();
      if (!queue) {
        throw new StudioError("The background job queue is not configured. Set REDIS_URL and start Redis.", 503, "queue_unavailable");
      }
      const input = {
        operation: parsed.data.operation,
        instruction: parsed.data.instruction ?? "",
        creativeDirection: parsed.data.creativeDirection ?? "",
        ...(parsed.data.targetFindingId ? { targetFindingId: parsed.data.targetFindingId } : {}),
        sourceBibleVersion: bible.version,
      };
      const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 20);
      const job = await deps.jobs.insert({
        clerkUserId: actor.userId,
        projectId,
        runId: null,
        sceneNumber: null,
        jobType: "story.draft",
        provider: "pending",
        model: "pending",
        input,
        output: null,
        status: "queued",
        progress: { stage: "story.draft", message: stageMessage({ jobType: "story.draft", sceneNumber: null }) },
        attempts: 0,
        maxAttempts: MAX_ATTEMPTS,
        error: null,
        idempotencyKey: `${keyPrefix(projectId)}:${existing.length + 1}:${digest}`,
        bullJobId: null,
        startedAt: null,
        completedAt: null,
      });
      log.info("story-draft", "job persisted", {
        projectId, jobId: job.id, operation: input.operation, runId: job.runId, status: job.status,
      });
      try {
        await queue.enqueue(job);
        job.bullJobId = job.id;
        await deps.jobs.save(job);
      } catch {
        job.status = "failed";
        job.error = { code: "queue_unavailable", message: "The job queue is unavailable.", retryable: false };
        job.completedAt = new Date().toISOString();
        await deps.jobs.save(job);
        throw new StudioError("The story draft could not be queued. Start Redis and try again.", 503, "queue_unavailable");
      }
      return { story: null, job };
    },

    async approve(actor: RequestAuth, projectId: string, storyId: string) {
      const project = await loadProject(actor, projectId);
      if (!isObjectId(storyId)) throw new StudioError("That story id is not valid", 400, "invalid_id");
      const draft = await deps.stories.findOwned(actor.userId, storyId);
      if (!draft || draft.projectId !== projectId || draft.productionRunId !== null) {
        throw new StudioError("Story draft not found", 404, "not_found");
      }
      if (draft.status === "failed") {
        throw new StudioError("A failed story draft cannot be approved", 409, "story_failed");
      }
      const bible = await deps.bibles.findApproved(actor.userId, projectId);
      if (!bible) {
        throw new StudioError("Approve the Story Bible before approving the story draft", 409, "bible_required");
      }
      if (bible?.content?.canon && bible.content.world && bible.content.characters) {
        const derived = canonFromApprovedSources({
          projectId,
          bible: bible.content,
          bibleVersion: bible.version,
        });
        const canon = await prepareWorkingCanon({
          clerkUserId: actor.userId,
          projectId,
          derived,
          port: deps.narrativeCanon,
        });
        const validation = validateEpisodeScreenplay({
          episodeNumber: 1,
          seriesTitle: project.title,
          story: { title: draft.title, synopsis: draft.synopsis, screenplay: draft.screenplay },
          targetDurationSeconds: project.targetDurationSeconds,
          bible: bible.content,
          seasonPlan: null,
          episodePlan: null,
          ledger: null,
          previousEpisodes: [],
          canon,
          structure: draft.structure,
          sceneRange: project.sceneRange,
          requireCanonCoverage: true,
        });
        if (!validation.passed || validation.narrativeCanonVersion === undefined) {
          const merged = draft.validationFindings
            ? mergeResolutions(draft.validationFindings, validation)
            : validation;
          if (!validationPassesForApproval(merged)) {
            const errors = merged.findings.filter((f) => isBlockingFinding(f));
            const summary = errors.length > 0
              ? errors.map((e, i) => `${i + 1}. ${e.message}`).join("\n")
              : "This draft was not validated against the current canon.";
            throw new StudioError(
              summary,
              409,
              "story_invalid",
              errors,
            );
          }
        }
        if (draft.sourceBibleVersion != null && bible.version > draft.sourceBibleVersion && validation.narrativeDecision === "reject") {
          throw new StudioError("This draft was generated from an older Story Bible. Revalidate against the current Bible before approving.", 409, "story_invalid");
        }
        if (draft.sourceCanonVersion != null && canon.version > draft.sourceCanonVersion && validation.narrativeDecision === "reject") {
          throw new StudioError("This draft was validated against an older canon.", 409, "story_invalid");
        }
        const committed = await resolveWorkingCanon({
          clerkUserId: actor.userId,
          projectId,
          derived: canon,
          port: deps.narrativeCanon,
        });
        log.info("story-draft", "canon committed on approval", {
          projectId,
          storyId: draft.id,
          canonVersion: committed.version,
          canonCommitted: committed.version !== canon.version || canon.version === 0,
          artifactsStale: committed.version !== canon.version || canon.version === 0,
        });
      } else {
        const documents = validateEpisodeScreenplay({
          episodeNumber: 1,
          seriesTitle: project.title,
          story: { title: draft.title, synopsis: draft.synopsis, screenplay: draft.screenplay },
          targetDurationSeconds: project.targetDurationSeconds,
          bible: null,
          seasonPlan: null,
          episodePlan: null,
          ledger: null,
          previousEpisodes: [],
          structure: draft.structure,
          sceneRange: project.sceneRange,
        });
        if (!documents.passed || (draft.validationFindings && !validationPassesForApproval(draft.validationFindings))) {
          const merged = draft.validationFindings
            ? mergeResolutions(draft.validationFindings, documents)
            : documents;
          if (!validationPassesForApproval(merged)) {
            const errors = merged.findings.filter((f) => isBlockingFinding(f));
            const summary = errors.length > 0
              ? errors.map((e, i) => `${i + 1}. ${e.message}`).join("\n")
              : "This draft did not pass canon validation.";
            throw new StudioError(
              summary,
              409,
              "story_invalid",
              errors,
            );
          }
        }
      }
      if (!draft.validationFindings || !draft.storyContract) {
        throw new StudioError("This draft has no completed validation, so it cannot be approved.", 409, "story_invalid");
      }
      if (!validationPassesForApproval(draft.validationFindings)) {
        const errors = draft.validationFindings.findings.filter((f) => isBlockingFinding(f));
        const summary = errors.length > 0
          ? errors.map((e, i) => `${i + 1}. ${e.message}`).join("\n")
          : "This draft has unresolved validation findings.";
        throw new StudioError(summary, 409, "story_invalid", errors);
      }
      if (!contractMatchesDraft(draft.storyContract, draft)) {
        throw new StudioError("The Story Contract does not match this draft revision.", 409, "story_invalid");
      }
      if (draft.storyContract.layers.structural !== "passed" || draft.storyContract.layers.agreement !== "passed") {
        throw new StudioError("Required validation layers did not pass.", 409, "story_invalid");
      }
      // Generation success is not approval: only a persisted, complete draft
      // that is awaiting approval may be accepted.
      const saved = draft.status === "approved" ? draft : await deps.stories.markApproved(actor.userId, storyId);
      if (!saved || saved.status !== "approved") {
        throw new StudioError("Generate a complete story draft before approving it", 409, "story_required");
      }
      if (project.status !== "story_ready" && canTransition(project.status, "story_ready")) {
        await deps.projects.update(actor.userId, projectId, { status: "story_ready" });
      }
      log.info("story-draft", "approved", { projectId, storyId: saved.id, version: saved.version });
      return saved;
    },

    /**
     * Update a single validation finding's resolution status. When a creator
     * accepts a finding as intentional, a note is required for substantive
     * warnings or errors. Findings that require canon authorization cannot be
     * accepted as intentional.
     */
    async resolveFinding(actor: RequestAuth, projectId: string, storyId: string, raw: unknown) {
      await loadProject(actor, projectId);
      if (!isObjectId(storyId)) throw new StudioError("That story id is not valid", 400, "invalid_id");
      const parsed = findingResolutionRequestSchema.safeParse(raw ?? {});
      if (!parsed.success) {
        throw new StudioError(parsed.error.issues[0]?.message ?? "Check the request", 400, "invalid_input");
      }
      const draft = await deps.stories.findOwned(actor.userId, storyId);
      if (!draft || draft.projectId !== projectId || draft.productionRunId !== null) {
        throw new StudioError("Story draft not found", 404, "not_found");
      }
      if (!draft.validationFindings) {
        throw new StudioError("This draft has no validation findings.", 409, "no_findings");
      }
      const finding = draft.validationFindings.findings.find((f) => f.id === parsed.data.findingId);
      if (!finding) {
        throw new StudioError("That finding was not found on this draft.", 404, "finding_not_found");
      }
      if (parsed.data.status === "accepted_as_intentional") {
        if (!canAcceptAsIntentional(finding)) {
          throw new StudioError(
            "This finding requires canon authorization and cannot be accepted as intentional. Revise the story to address it.",
            409,
            "cannot_accept",
          );
        }
        if (!parsed.data.note?.trim()) {
          throw new StudioError(
            "A short explanation is required when accepting a finding as intentional.",
            400,
            "note_required",
          );
        }
      }
      const updated = await deps.stories.updateFindingResolution(
        actor.userId,
        storyId,
        parsed.data.findingId,
        {
          status: parsed.data.status,
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
          resolvedAt: new Date().toISOString(),
        },
      );
      if (!updated) {
        throw new StudioError("The finding resolution could not be saved.", 500, "save_failed");
      }
      log.info("story-draft", "finding resolution updated", {
        projectId,
        storyId,
        findingId: parsed.data.findingId,
        status: parsed.data.status,
      });
      return updated;
    },

    /**
     * Re-run validation on the current draft without regenerating. This updates
     * the persisted validation findings, carrying forward any existing creator
     * resolutions for findings that still appear.
     */
    async revalidate(actor: RequestAuth, projectId: string, storyId: string) {
      const project = await loadProject(actor, projectId);
      if (!isObjectId(storyId)) throw new StudioError("That story id is not valid", 400, "invalid_id");
      const draft = await deps.stories.findOwned(actor.userId, storyId);
      if (!draft || draft.projectId !== projectId || draft.productionRunId !== null) {
        throw new StudioError("Story draft not found", 404, "not_found");
      }
      if (draft.status === "approved") {
        throw new StudioError("An approved story cannot be revalidated directly. Revise it first.", 409, "story_approved");
      }
      const bible = await deps.bibles.findApproved(actor.userId, projectId);
      const canon = bible?.content?.canon && bible.content.world && bible.content.characters
        ? await prepareWorkingCanon({
            clerkUserId: actor.userId,
            projectId,
            derived: canonFromApprovedSources({
              projectId,
              bible: bible.content,
              bibleVersion: bible.version,
            }),
            port: deps.narrativeCanon,
          })
        : null;
      const validation = validateEpisodeScreenplay({
        episodeNumber: 1,
        seriesTitle: project.title,
        story: { title: draft.title, synopsis: draft.synopsis, screenplay: draft.screenplay },
        targetDurationSeconds: project.targetDurationSeconds,
        bible: bible?.content ?? null,
        seasonPlan: null,
        episodePlan: null,
        ledger: null,
        previousEpisodes: [],
        ...(canon ? { canon } : {}),
        structure: draft.structure,
        sceneRange: project.sceneRange,
      });
      const updated = await deps.stories.updateValidationFindings(actor.userId, storyId, validation);
      if (!updated) {
        throw new StudioError("Revalidation could not be saved.", 500, "save_failed");
      }
      log.info("story-draft", "revalidated", {
        projectId,
        storyId,
        passed: validation.passed,
        findingCount: validation.findings.length,
      });
      return updated;
    },
  };
}

export const storyDraftService = createStoryDraftService();
