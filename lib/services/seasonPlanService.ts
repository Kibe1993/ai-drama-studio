import "server-only";
import { createHash } from "node:crypto";
import type { RequestAuth } from "@/lib/auth/session";
import { isBusyStatus } from "@/lib/domain/projectCatalog";
import { bibleFingerprint } from "@/lib/domain/seasonPlanVersion";
import { validateSeasonPlan } from "@/lib/domain/seasonPlanValidation";
import { isObjectId } from "@/lib/repositories/ownership";
import { projectRepository } from "@/lib/repositories/projectRepository";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { seasonPlanRepository } from "@/lib/repositories/seasonPlanRepository";
import { continuityLedgerRepository } from "@/lib/repositories/continuityLedgerRepository";
import { episodeRepository } from "@/lib/repositories/episodeRepository";
import { generationJobRepository } from "@/lib/repositories/generationJobRepository";
import { StudioError } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { livePipelineDeps } from "@/lib/pipeline/live";
import { stageMessage } from "@/lib/pipeline/messages";
import {
  seasonPlanRequestSchema,
  seasonPlanUpdateRequestSchema,
} from "@/lib/validation/seasonPlan";

const OPEN = new Set(["queued", "processing"]);
const MAX_ATTEMPTS = 3;

export function keyPrefix(projectId: string): string {
  return `seasonPlan:${projectId}`;
}

export function createSeasonPlanService(deps = {
  projects: projectRepository,
  bibles: storyBibleRepository,
  stories: storyRepository,
  plans: seasonPlanRepository,
  ledgers: continuityLedgerRepository,
  episodes: episodeRepository,
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
    /** Get the latest season plan and its generation job, if any. */
    async get(actor: RequestAuth, projectId: string) {
      await loadProject(actor, projectId);
      const plan = await deps.plans.findLatest(actor.userId, projectId);
      const jobs = await deps.jobs.listByKeyPrefix(keyPrefix(projectId));
      const job = jobs.find((item) => OPEN.has(item.status)) ?? jobs[jobs.length - 1] ?? null;
      const ledger = await deps.ledgers.findLatest(actor.userId, projectId);
      return { plan, job, ledger };
    },

    /** Start a season plan generation job (Stage B). */
    async start(actor: RequestAuth, projectId: string, raw: unknown) {
      const project = await loadProject(actor, projectId);
      if (project.status === "archived") {
        throw new StudioError("This project is archived", 409, "project_archived");
      }
      if (isBusyStatus(project.status)) {
        throw new StudioError("Wait until production is idle before developing the season plan", 409, "project_busy");
      }
      const parsed = seasonPlanRequestSchema.safeParse(raw ?? {});
      if (!parsed.success) {
        throw new StudioError(parsed.error.issues[0]?.message ?? "Check the request", 400, "invalid_input");
      }
      // Gate: Story Bible must be approved, with an approved snapshot to plan from.
      const bible = await deps.bibles.findOwned(actor.userId, projectId);
      if (!bible || bible.approvedVersion === 0 || !bible.approvedSnapshot?.content) {
        throw new StudioError("Approve the Story Bible before generating a season plan", 409, "bible_required");
      }
      // Gate: Story draft must be approved
      const story = await deps.stories.findProjectDraft(actor.userId, projectId);
      if (!story || story.status !== "approved") {
        throw new StudioError("Approve the story draft before generating a season plan", 409, "story_required");
      }
      const existing = await deps.jobs.listByKeyPrefix(keyPrefix(projectId));
      const open = existing.find((item) => OPEN.has(item.status));
      if (open) {
        return { plan: await deps.plans.findLatest(actor.userId, projectId), job: open };
      }
      const queue = deps.queueFactory();
      if (!queue) {
        throw new StudioError("The background job queue is not configured. Set REDIS_URL and start Redis.", 503, "queue_unavailable");
      }
      const input: Record<string, unknown> = {
        operation: parsed.data.operation,
        instruction: parsed.data.instruction ?? "",
      };
      if (parsed.data.episodeCount !== undefined) input.episodeCount = parsed.data.episodeCount;
      if (parsed.data.targetEpisodeNumber !== undefined) {
        input.targetEpisodeNumber = parsed.data.targetEpisodeNumber;
      }
      const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 20);
      let job;
      try {
        job = await deps.jobs.insert({
          clerkUserId: actor.userId,
          projectId,
          runId: null,
          sceneNumber: null,
          jobType: "seasonPlan.generate",
          provider: "pending",
          model: "pending",
          input,
          output: null,
          status: "queued",
          progress: { stage: "seasonPlan.generate", message: stageMessage({ jobType: "seasonPlan.generate", sceneNumber: null }) },
          attempts: 0,
          maxAttempts: MAX_ATTEMPTS,
          error: null,
          idempotencyKey: `${keyPrefix(projectId)}:${existing.length + 1}:${digest}`,
          bullJobId: null,
          startedAt: null,
          completedAt: null,
        });
      } catch (error) {
        // The unique idempotency key lost a race with another request. Return the
        // job that won instead of starting a second generation.
        const raced = (await deps.jobs.listByKeyPrefix(keyPrefix(projectId))).find((item) => OPEN.has(item.status));
        if (raced) {
          log.info("season-plan", "duplicate generation request joined open job", { projectId, jobId: raced.id });
          return { plan: await deps.plans.findLatest(actor.userId, projectId), job: raced };
        }
        log.error("season-plan", "job insert failed", {
          projectId,
          detail: error instanceof Error ? error.message : "unknown",
        });
        throw new StudioError("The season plan request could not be queued.", 503, "generation_failed");
      }
      log.info("season-plan", "job persisted", {
        projectId, jobId: job.id, operation: input.operation, status: job.status,
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
        throw new StudioError("The season plan could not be queued. Start Redis and try again.", 503, "queue_unavailable");
      }
      return { plan: null, job };
    },

    /**
     * Save a creator's manual edit as a new plan version (Stage D).
     *
     * The edit is validated immediately so the creator sees the same structured
     * findings the generator would produce, and the previous version is kept.
     * `expectedVersion` rejects a save that would overwrite a concurrent
     * regeneration.
     */
    async update(actor: RequestAuth, projectId: string, planId: string, raw: unknown) {
      await loadProject(actor, projectId);
      if (!isObjectId(planId)) throw new StudioError("That plan id is not valid", 400, "invalid_id");
      const parsed = seasonPlanUpdateRequestSchema.safeParse(raw);
      if (!parsed.success) {
        throw new StudioError(parsed.error.issues[0]?.message ?? "Check the plan", 400, "invalid_input");
      }
      const bible = await deps.bibles.findOwned(actor.userId, projectId);
      if (!bible || bible.approvedVersion === 0 || !bible.approvedSnapshot?.content) {
        throw new StudioError("Approve the Story Bible before editing a season plan", 409, "bible_required");
      }
      const latest = await deps.plans.findLatest(actor.userId, projectId);
      if (!latest || latest.id !== planId) {
        throw new StudioError("Season plan not found", 404, "not_found");
      }
      if (latest.version !== parsed.data.expectedVersion) {
        throw new StudioError(
          "This plan changed while you were editing it. Reload before saving your changes.",
          409,
          "plan_conflict"
        );
      }
      const findings = validateSeasonPlan(parsed.data.plan, bible.approvedSnapshot.content);
      const saved = await deps.plans.insert({
        ...parsed.data.plan,
        clerkUserId: actor.userId,
        projectId,
        basedOnBibleVersion: bible.approvedVersion,
        basedOnBibleFingerprint: bibleFingerprint(bible.approvedVersion, bible.approvedSnapshot.content),
        provider: latest.provider,
        model: latest.model,
        fallbackFrom: latest.fallbackFrom,
      });
      const withFindings = await deps.plans.saveValidationFindings(actor.userId, saved.id, findings);
      log.info("season-plan", "creator edit saved", {
        projectId, planId: saved.id, version: saved.version, passed: findings.passed,
      });
      return withFindings ?? saved;
    },

    /** Approve a season plan (Stage D). */
    async approve(actor: RequestAuth, projectId: string, planId: string) {
      await loadProject(actor, projectId);
      if (!isObjectId(planId)) throw new StudioError("That plan id is not valid", 400, "invalid_id");
      const plan = await deps.plans.findLatest(actor.userId, projectId);
      if (!plan || plan.id !== planId) {
        throw new StudioError("Season plan not found", 404, "not_found");
      }
      if (plan.status === "failed") {
        throw new StudioError("A failed season plan cannot be approved", 409, "plan_failed");
      }
      if (plan.status === "approved") {
        return plan;
      }
      const bible = await deps.bibles.findOwned(actor.userId, projectId);
      if (!bible || bible.approvedVersion === 0) {
        throw new StudioError("Approve the Story Bible before approving a season plan", 409, "bible_required");
      }
      // A plan developed from an older Story Bible must not become the source of
      // truth for new episodes.
      if (plan.basedOnBibleVersion !== bible.approvedVersion) {
        throw new StudioError(
          "The Story Bible changed after this plan was developed. Regenerate the plan before approving it.",
          409,
          "plan_stale"
        );
      }
      // Gate: validation must have passed (no error-severity findings)
      if (plan.validationFindings && !plan.validationFindings.passed) {
        throw new StudioError("The season plan has validation errors. Revise it before approving.", 409, "plan_validation_failed");
      }
      const saved = await deps.plans.markApproved(actor.userId, planId);
      if (!saved || saved.status !== "approved") {
        throw new StudioError("Generate a complete season plan before approving it", 409, "plan_required");
      }
      log.info("season-plan", "approved", { projectId, planId: saved.id, version: saved.version });
      return saved;
    },
  };
}

export const seasonPlanService = createSeasonPlanService();
