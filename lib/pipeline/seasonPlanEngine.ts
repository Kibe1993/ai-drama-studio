import { log } from "@/lib/log";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import { JobError, type JobRecord } from "@/lib/pipeline/types";
import type { LLMProvider } from "@/lib/providers/llm/types";
import {
  seasonPlanRequestSchema,
  type SeasonPlan,
  type SeasonPlanRecord,
} from "@/lib/validation/seasonPlan";
import { seasonPlanBibleReference, type SeasonPlanPrompt } from "@/lib/providers/llm/seasonPlanTask";
import { validateSeasonPlan } from "@/lib/domain/seasonPlanValidation";
import { bibleFingerprint } from "@/lib/domain/seasonPlanVersion";
import { storyFoundation } from "@/lib/domain/workflow";
import type { SeasonPlanDraft } from "@/lib/repositories/seasonPlanRepository";
import type { StoryBibleRecord } from "@/lib/validation/storyBible";
import type { StoryRecord } from "@/lib/validation/story";

type PlanWriter = {
  insert(input: SeasonPlanDraft): Promise<SeasonPlanRecord>;
  findLatest(clerkUserId: string, projectId: string): Promise<SeasonPlanRecord | null>;
  saveValidationFindings(
    clerkUserId: string,
    planId: string,
    findings: NonNullable<SeasonPlanRecord["validationFindings"]>
  ): Promise<SeasonPlanRecord | null>;
};

type BibleReader = {
  findOwned(clerkUserId: string, projectId: string): Promise<StoryBibleRecord | null>;
};

type StoryReader = {
  findProjectDraft(clerkUserId: string, projectId: string): Promise<StoryRecord | null>;
};

type EpisodeReader = {
  listOwned(
    clerkUserId: string,
    projectId: string
  ): Promise<{ episodeNumber: number; title: string; premise: string }[] | null>;
};

type LedgerReader = {
  findLatest(
    clerkUserId: string,
    projectId: string
  ): Promise<{
    events: { episodeNumber: number; event: string; consequence: string }[];
    consequences: string[];
    unresolvedThreads: { thread: string; status: string }[];
  } | null>;
};

/**
 * The CASNA Season Plan engine. Develops a complete episode sequence plan from
 * the approved Story Bible and story draft, validates it, and persists it for
 * creator approval. Run as a run-less background job, like the story draft and
 * Story Bible engines.
 */
export function createSeasonPlanEngine(
  llm: LLMProvider,
  plans: PlanWriter,
  bibles: BibleReader,
  stories: StoryReader,
  updateProgress?: (job: JobRecord, message: string) => Promise<void>,
  episodes?: EpisodeReader,
  ledgers?: LedgerReader
) {
  return {
    async run(job: JobRecord, project: ProjectRecord) {
      if (job.jobType !== "seasonPlan.generate" || job.runId !== null) {
        throw new JobError("Invalid season plan job scope.", "invalid_job", false);
      }
      const parsed = seasonPlanRequestSchema.safeParse(job.input);
      if (!parsed.success) throw new JobError("The season plan request is invalid.", "invalid_input", false);
      const request = parsed.data;

      // Load approved foundation
      const bible = await bibles.findOwned(job.clerkUserId, job.projectId);
      if (!bible || bible.approvedVersion === 0 || !bible.approvedSnapshot?.content) {
        throw new JobError("Approve the Story Bible before generating a season plan.", "bible_required", false);
      }
      const story = await stories.findProjectDraft(job.clerkUserId, job.projectId);
      if (!story || story.status !== "approved") {
        throw new JobError("Approve the story draft before generating a season plan.", "story_required", false);
      }

      const bibleContent = bible.approvedSnapshot.content;
      const fingerprint = bibleFingerprint(bible.approvedVersion, bibleContent);
      const previous = await plans.findLatest(job.clerkUserId, job.projectId);
      const produced = episodes ? (await episodes.listOwned(job.clerkUserId, job.projectId)) ?? [] : [];
      const ledger = ledgers ? await ledgers.findLatest(job.clerkUserId, job.projectId) : null;

      log.info("season-plan", "engine started", {
        projectId: job.projectId, jobId: job.id, operation: request.operation,
        bibleVersion: bible.approvedVersion, hasPrevious: Boolean(previous),
        targetEpisodeNumber: request.targetEpisodeNumber ?? null,
      });

      const prompt: SeasonPlanPrompt = {
        seriesTitle: bibleContent.identity.title || project.title,
        storyBible: seasonPlanBibleReference(bibleContent),
        storyFoundation: storyFoundation(story),
        creativeDirection: bible.creativeDirection || project.tone || "",
        tone: project.tone,
        genre: project.genre,
        language: project.language,
        productionMode: project.productionMode,
        episodeCount: request.episodeCount ?? previous?.episodeProgression.length ?? 6,
        operation: request.operation,
        instruction: request.instruction,
        targetEpisodeNumber: request.targetEpisodeNumber,
        previousEpisodes: produced.map((episode) => ({
          episodeNumber: episode.episodeNumber,
          title: episode.title,
          premise: episode.premise,
        })),
        previousPlan:
          request.operation === "revise" || request.targetEpisodeNumber
            ? previous ?? undefined
            : undefined,
        continuityContext: ledgerContext(ledger),
      };

      const generated = await llm.generateSeasonPlan!(prompt, {
        jobId: job.id,
        // A six-episode plan can be truncated by a small/fast provider, then
        // time out on a free fallback before the local model is reached. Give
        // the sequence enough wall clock that Ollama remains a real last resort.
        sequenceTimeoutMs: 600_000,
        onStatus: async (message) => {
          log.info("season-plan", "provider progress", { jobId: job.id, projectId: job.projectId, message });
          await updateProgress?.(job, message);
        },
      });

      // A targeted revision replaces one episode and keeps everything else the
      // creator already approved, rather than silently rewriting the season.
      const plan = request.targetEpisodeNumber
        ? mergeTargetedRevision(previous, generated.plan, request.targetEpisodeNumber)
        : generated.plan;

      // Stage C: Validate the plan
      await updateProgress?.(job, "Validating season plan");
      const findings = validateSeasonPlan(plan, bibleContent);
      log.info("season-plan", "validation complete", {
        projectId: job.projectId, jobId: job.id, passed: findings.passed,
        errorCount: findings.findings.filter((f) => f.severity === "error").length,
        warningCount: findings.findings.filter((f) => f.severity === "warning").length,
      });

      const draft: SeasonPlanDraft = {
        ...plan,
        clerkUserId: job.clerkUserId,
        projectId: job.projectId,
        basedOnBibleVersion: bible.approvedVersion,
        basedOnBibleFingerprint: fingerprint,
        provider: generated.provider || llm.id,
        model: generated.model || llm.model,
        fallbackFrom: generated.fallbackFrom ?? null,
      };
      const saved = await plans.insert(draft);

      // Save validation findings on the persisted record
      await plans.saveValidationFindings(job.clerkUserId, saved.id, findings);

      log.info("season-plan", "saved", {
        projectId: job.projectId, jobId: job.id, planId: saved.id, version: saved.version,
        provider: draft.provider, model: draft.model, passed: findings.passed,
      });

      return {
        planId: saved.id,
        version: saved.version,
        passed: findings.passed,
        findingCount: findings.findings.length,
        provider: draft.provider,
        model: draft.model,
        fallbackFrom: draft.fallbackFrom,
        attempts: generated.attempts ?? [],
      };
    },
  };
}

/**
 * Keep the season-level plan and every other episode exactly as they were and
 * replace only the episode the creator asked to regenerate.
 */
export function mergeTargetedRevision(
  previous: SeasonPlanRecord | null,
  generated: SeasonPlan,
  targetEpisodeNumber: number
): SeasonPlan {
  if (!previous) return generated;
  const replacement = generated.episodeProgression.find(
    (item) => item.episodeNumber === targetEpisodeNumber
  );
  if (!replacement) return generated;
  const episodes = previous.episodeProgression.map((item) =>
    item.episodeNumber === targetEpisodeNumber ? replacement : item
  );
  if (!episodes.some((item) => item.episodeNumber === targetEpisodeNumber)) {
    episodes.push(replacement);
  }
  episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
  return {
    seasonObjective: previous.seasonObjective,
    centralConflictOrMystery: previous.centralConflictOrMystery,
    mainCharacterObjectives: previous.mainCharacterObjectives,
    overallCharacterDevelopment: previous.overallCharacterDevelopment,
    majorStoryDevelopments: previous.majorStoryDevelopments,
    beginningDirection: previous.beginningDirection,
    middleDirection: previous.middleDirection,
    endingDirection: previous.endingDirection,
    episodeProgression: episodes,
    importantRevelations: previous.importantRevelations,
    relationshipChanges: previous.relationshipChanges,
    consequencesCarriedBetween: previous.consequencesCarriedBetween,
    setupAndPayoff: previous.setupAndPayoff,
    unresolvedQuestions: previous.unresolvedQuestions,
    intendedSeasonConclusion: previous.intendedSeasonConclusion,
  };
}

function ledgerContext(
  ledger: {
    events: { episodeNumber: number; event: string; consequence: string }[];
    consequences: string[];
    unresolvedThreads: { thread: string; status: string }[];
  } | null
): string | undefined {
  if (!ledger) return undefined;
  const lines = [
    ...ledger.events.slice(-6).map((event) => `Episode ${event.episodeNumber}: ${event.event} -> ${event.consequence}`),
    ...ledger.consequences.slice(-6).map((consequence) => `Active consequence: ${consequence}`),
    ...ledger.unresolvedThreads
      .filter((thread) => thread.status !== "resolved")
      .slice(-6)
      .map((thread) => `Open thread: ${thread.thread}`),
  ];
  return lines.length ? lines.join("\n") : undefined;
}
