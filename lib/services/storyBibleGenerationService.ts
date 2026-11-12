import "server-only";
import { createHash } from "node:crypto";
import type { RequestAuth } from "@/lib/auth/session";
import { isBusyStatus } from "@/lib/domain/projectCatalog";
import { StudioError } from "@/lib/http/errors";
import { livePipelineDeps } from "@/lib/pipeline/live";
import { stageMessage } from "@/lib/pipeline/messages";
import { generationJobRepository } from "@/lib/repositories/generationJobRepository";
import { projectRepository } from "@/lib/repositories/projectRepository";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { storyBibleGenerationJobInputSchema, type StoryBibleGenerationJobInput, type StoryBibleRecord } from "@/lib/validation/storyBible";
import { log } from "@/lib/log";

const MAX_ATTEMPTS = 3;

function makeIdempotencyKey(projectId: string, input: StoryBibleGenerationJobInput, attempt: number) {
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 20);
  return `storyBible:${projectId}:${input.expectedDraftRevision}:${digest}:${attempt}`;
}

export function createStoryBibleGenerationService(deps = {
  projects: projectRepository,
  bibles: storyBibleRepository,
  jobs: generationJobRepository,
  queueFactory: () => livePipelineDeps().queue,
}) {
  return {
    async start(actor: RequestAuth, projectId: string, raw: unknown) {
      const project = await deps.projects.findOwned(actor.userId, projectId);
      if (!project) throw new StudioError("Project not found", 404, "not_found");
      if (project.status === "archived" || isBusyStatus(project.status)) {
        throw new StudioError("Wait until production is idle before developing its Story Bible", 409, "project_busy");
      }
      const bible = await deps.bibles.findOwned(actor.userId, projectId) ?? await deps.bibles.saveDraft(
        actor.userId, projectId, { premise: "", worldRules: [], themes: [], boundaries: [], canonFacts: [], sourceIdea: project.originalStoryIdea }
      );
      if (!bible) throw new StudioError("Project not found", 404, "not_found");

      const parsed = storyBibleGenerationJobInputSchema.safeParse({
        ...((raw && typeof raw === "object") ? raw : {}),
        expectedDraftRevision: bible.draftRevision,
        idea: (raw as { idea?: string } | null)?.idea?.trim() || bible.sourceIdea || project.originalStoryIdea || bible.premise,
        title: (raw as { title?: string } | null)?.title || bible.content?.identity.title || project.title,
        creativeDirection: (raw as { creativeDirection?: string } | null)?.creativeDirection || bible.creativeDirection || "",
      });
      if (!parsed.success) {
        log.error("story-bible", "request rejected", { projectId, code: "invalid_input", issueCount: parsed.error.issues.length });
        throw new StudioError(parsed.error.issues[0]?.message ?? "Add a story idea to continue.", 400, "invalid_input");
      }
      log.info("story-bible", "request accepted", {
        projectId,
        operation: parsed.data.operation,
        draftRevision: parsed.data.expectedDraftRevision,
        ideaChars: parsed.data.idea.length,
      });
      if (bible.generationStatus === "queued" || bible.generationStatus === "processing") {
        const existing = bible.generationJobId ? await deps.jobs.findById(bible.generationJobId) : null;
        if (existing && (existing.status === "queued" || existing.status === "processing")) {
          log.info("story-bible", "reusing open job", { projectId, jobId: existing.id, status: existing.status });
          return { bible, job: existing };
        }
      }
      const queue = deps.queueFactory();
      if (!queue) throw new StudioError("The background job queue is not configured. Set REDIS_URL and start Redis.", 503, "queue_unavailable");

      const keyPrefix = `storyBible:${projectId}:${parsed.data.expectedDraftRevision}`;
      const previous = await deps.jobs.listByKeyPrefix(keyPrefix);
      const idempotencyKey = makeIdempotencyKey(projectId, parsed.data, previous.length + 1);
      const job = await deps.jobs.insert({
        clerkUserId: actor.userId,
        projectId,
        runId: null,
        sceneNumber: null,
        jobType: "storyBible.generate",
        provider: "pending",
        model: "pending",
        input: parsed.data as Record<string, unknown>,
        output: null,
        status: "queued",
        progress: { stage: "storyBible.generate", message: stageMessage({ jobType: "storyBible.generate", sceneNumber: null }) },
        attempts: 0,
        maxAttempts: MAX_ATTEMPTS,
        error: null,
        idempotencyKey,
        bullJobId: null,
        startedAt: null,
        completedAt: null,
      });
      log.info("story-bible", "job persisted", { projectId, jobId: job.id, runId: job.runId, status: job.status });
      const marked = await deps.bibles.beginGeneration(actor.userId, projectId, bible.draftRevision, job.id);
      if (!marked) {
        job.status = "cancelled";
        job.completedAt = new Date().toISOString();
        job.error = { code: "stale_bible", message: "A newer Story Bible request is active.", retryable: false };
        await deps.jobs.save(job);
        throw new StudioError("The Story Bible changed or another request started. Reload and try again.", 409, "stale_bible");
      }
      try {
        log.info("story-bible", "queue submission started", { projectId, jobId: job.id });
        await queue.enqueue(job);
        job.bullJobId = job.id;
        await deps.jobs.save(job);
        log.info("story-bible", "job enqueued", { projectId, jobId: job.id, queue: "studio-llm" });
      } catch {
        await deps.bibles.failGeneration(actor.userId, projectId, job.id, "The job queue is unavailable. Your existing draft was preserved.");
        job.status = "failed";
        job.error = { code: "queue_unavailable", message: "The job queue is unavailable.", retryable: false };
        job.completedAt = new Date().toISOString();
        await deps.jobs.save(job);
        log.error("story-bible", "queue submission failed", { projectId, jobId: job.id, code: "queue_unavailable" });
        throw new StudioError("The Story Bible could not be queued. Start Redis and try again.", 503, "queue_unavailable");
      }
      return { bible: marked, job };
    },
  };
}

export const storyBibleGenerationService = createStoryBibleGenerationService();
export type { StoryBibleRecord };
