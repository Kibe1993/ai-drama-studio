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
import { storyDraftRequestSchema } from "@/lib/validation/story";

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
  };
}

export const storyDraftService = createStoryDraftService();
