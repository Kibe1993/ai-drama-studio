import { log } from "@/lib/log";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import { JobError, type JobRecord } from "@/lib/pipeline/types";
import type { LLMProvider, AttemptRecord } from "@/lib/providers/llm/types";
import {
  seasonPlanRequestSchema,
  seasonArchitectureSchema,
  episodeDetailSchema,
  type SeasonPlan,
  type SeasonPlanRecord,
  type SeasonArchitecture,
  type EpisodeDetail,
  type EpisodeOutline,
} from "@/lib/validation/seasonPlan";
import {
  seasonPlanBibleReference,
  assembleSeasonPlan,
  type SeasonPlanPrompt,
  type SeasonArchitecturePrompt,
  type EpisodeDetailBatchPrompt,
} from "@/lib/providers/llm/seasonPlanTask";
import { validateSeasonPlan } from "@/lib/domain/seasonPlanValidation";
import { validateSeasonPlanRich } from "@/lib/domain/planValidation";
import { bibleFingerprint } from "@/lib/domain/seasonPlanVersion";
import { storyFoundation } from "@/lib/domain/workflow";
import type { SeasonPlanDraft } from "@/lib/repositories/seasonPlanRepository";
import type { StoryBibleRecord } from "@/lib/validation/storyBible";
import type { StoryRecord } from "@/lib/validation/story";

type ProgressWriter = (job: JobRecord, message: string, output?: Record<string, unknown>) => Promise<void>;

export type SeasonPlanProgressEvent = {
  ts: number;
  stage: "init" | "architecture" | "episode_details" | "validation" | "saving" | "complete";
  status: "started" | "progress" | "provider_attempt" | "provider_success" | "provider_failed" | "completed" | "failed";
  message: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  completedEpisodes?: number;
  totalEpisodes?: number;
  batch?: number;
  totalBatches?: number;
  passed?: boolean;
  errorCount?: number;
  warningCount?: number;
  fallbackFrom?: string | null;
};

function readProgressLog(output: Record<string, unknown> | null): SeasonPlanProgressEvent[] {
  if (!output || !Array.isArray(output.progressLog)) return [];
  return output.progressLog as SeasonPlanProgressEvent[];
}

async function emitProgress(
  job: JobRecord,
  updateProgress: ProgressWriter | undefined,
  event: Omit<SeasonPlanProgressEvent, "ts">
): Promise<void> {
  const fullEvent: SeasonPlanProgressEvent = { ...event, ts: Date.now() };
  const output = job.output ?? {};
  const log = readProgressLog(output);
  job.output = { ...output, progressLog: [...log, fullEvent] };
  await updateProgress?.(job, event.message, job.output);
}

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
  updateProgress?: ProgressWriter,
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

      const [bible, story, previous, produced, ledger] = await Promise.all([
        bibles.findOwned(job.clerkUserId, job.projectId),
        stories.findProjectDraft(job.clerkUserId, job.projectId),
        plans.findLatest(job.clerkUserId, job.projectId),
        episodes ? episodes.listOwned(job.clerkUserId, job.projectId) : Promise.resolve(null),
        ledgers ? ledgers.findLatest(job.clerkUserId, job.projectId) : Promise.resolve(null),
      ]);
      if (!bible || bible.approvedVersion === 0 || !bible.approvedSnapshot?.content) {
        throw new JobError("Approve the Story Bible before generating a season plan.", "bible_required", false);
      }
      if (!story || story.status !== "approved") {
        throw new JobError("Approve the story draft before generating a season plan.", "story_required", false);
      }

      const bibleContent = bible.approvedSnapshot.content;
      const fingerprint = bibleFingerprint(bible.approvedVersion, bibleContent);
      const producedEpisodes = produced ?? [];

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
        previousEpisodes: producedEpisodes.map((episode) => ({
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

      const twoStageCapable =
        (request.operation === "generate" || request.operation === "regenerate") &&
        !request.targetEpisodeNumber &&
        Boolean(llm.generateSeasonArchitecture) &&
        Boolean(llm.generateEpisodeDetails);

      let plan: SeasonPlan;
      let provider: string | undefined;
      let model: string | undefined;
      let fallbackFrom: string | null | undefined;
      let attempts: AttemptRecord[] | undefined;

      if (twoStageCapable) {
        const cached = readSeasonPlanProgress(job.output);
        let architecture = cached?.architecture ?? null;

        if (architecture) {
          log.info("season-plan", "resuming with cached architecture", { jobId: job.id, projectId: job.projectId });
          await emitProgress(job, updateProgress, {
            stage: "architecture", status: "completed",
            message: "Season architecture resumed from checkpoint",
            completedEpisodes: architecture.episodeOutlines.length,
            totalEpisodes: architecture.episodeOutlines.length,
          });
        } else {
          await emitProgress(job, updateProgress, {
            stage: "architecture", status: "started",
            message: "Designing season architecture…",
          });
          const archPrompt: SeasonArchitecturePrompt = {
            seriesTitle: prompt.seriesTitle,
            storyBible: prompt.storyBible,
            storyFoundation: prompt.storyFoundation,
            creativeDirection: prompt.creativeDirection,
            tone: prompt.tone,
            genre: prompt.genre,
            language: prompt.language,
            productionMode: prompt.productionMode,
            episodeCount: prompt.episodeCount,
            previousEpisodes: prompt.previousEpisodes,
            continuityContext: prompt.continuityContext,
            operation: prompt.operation,
            instruction: prompt.instruction,
          };
          const archStart = Date.now();
          const archResult = await llm.generateSeasonArchitecture!(archPrompt, {
            jobId: job.id,
            sequenceTimeoutMs: 300_000,
            onStatus: async (message) => {
              log.info("season-plan", "architecture progress", { jobId: job.id, projectId: job.projectId, message });
              await emitProgress(job, updateProgress, {
                stage: "architecture", status: "progress", message,
              });
            },
          });
          architecture = archResult.architecture;
          provider = archResult.provider;
          model = archResult.model;
          fallbackFrom = archResult.fallbackFrom;
          attempts = archResult.attempts;
          job.output = { ...(job.output ?? {}), seasonArchitecture: architecture };
          await emitProgress(job, updateProgress, {
            stage: "architecture", status: "completed",
            message: `Season architecture ready — ${architecture.episodeOutlines.length} episodes planned`,
            provider: archResult.provider,
            model: archResult.model,
            latencyMs: Date.now() - archStart,
            fallbackFrom: archResult.fallbackFrom,
            totalEpisodes: architecture.episodeOutlines.length,
          });
        }

        const outlines = architecture.episodeOutlines;
        const batchSize = 6;
        let completedDetails: EpisodeDetail[] = cached?.episodeDetails ?? [];
        const completedNumbers = new Set(completedDetails.map((d) => d.episodeNumber));
        const pendingOutlines = outlines.filter((o) => !completedNumbers.has(o.episodeNumber));
        const batches = batchOutlines(pendingOutlines, batchSize);

        await emitProgress(job, updateProgress, {
          stage: "episode_details", status: "started",
          message: `Developing episode details — ${completedDetails.length} of ${outlines.length} ready`,
          completedEpisodes: completedDetails.length,
          totalEpisodes: outlines.length,
          batch: 0,
          totalBatches: batches.length,
        });

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex];
          const batchPrompt: EpisodeDetailBatchPrompt = {
            seriesTitle: prompt.seriesTitle,
            storyBible: prompt.storyBible,
            genre: prompt.genre,
            language: prompt.language,
            tone: prompt.tone,
            productionMode: prompt.productionMode,
            architecture,
            outlines: batch,
            previousEpisodes: prompt.previousEpisodes,
            continuityContext: prompt.continuityContext,
          };
          const batchResult = await llm.generateEpisodeDetails!(batchPrompt, {
            jobId: job.id,
            sequenceTimeoutMs: 300_000,
            onStatus: async (message) => {
              log.info("season-plan", "episode details progress", { jobId: job.id, projectId: job.projectId, message });
              await emitProgress(job, updateProgress, {
                stage: "episode_details", status: "progress", message,
                completedEpisodes: completedDetails.length,
                totalEpisodes: outlines.length,
                batch: batchIndex + 1,
                totalBatches: batches.length,
              });
            },
          });
          completedDetails = [...completedDetails, ...batchResult.batch.episodes];
          for (const ep of batchResult.batch.episodes) completedNumbers.add(ep.episodeNumber);
          job.output = { ...(job.output ?? {}), episodeDetails: completedDetails };
          const done = completedDetails.length;
          const total = outlines.length;
          await emitProgress(job, updateProgress, {
            stage: "episode_details", status: "progress",
            message: `Episode details: ${done} of ${total} ready`,
            completedEpisodes: done,
            totalEpisodes: total,
            batch: batchIndex + 1,
            totalBatches: batches.length,
            provider: batchResult.provider,
            model: batchResult.model,
          });
          if (!provider) provider = batchResult.provider;
          if (!model) model = batchResult.model;
          if (batchResult.fallbackFrom) fallbackFrom = batchResult.fallbackFrom;
          if (batchResult.attempts) attempts = [...(attempts ?? []), ...batchResult.attempts];
        }

        await emitProgress(job, updateProgress, {
          stage: "episode_details", status: "completed",
          message: `All ${outlines.length} episode details ready`,
          completedEpisodes: outlines.length,
          totalEpisodes: outlines.length,
        });

        plan = assembleSeasonPlan(architecture, completedDetails);
      } else {
        await emitProgress(job, updateProgress, {
          stage: "architecture", status: "started",
          message: "Generating season plan…",
        });
        const genStart = Date.now();
        const generated = await llm.generateSeasonPlan!(prompt, {
          jobId: job.id,
          sequenceTimeoutMs: 300_000,
          onStatus: async (message) => {
            log.info("season-plan", "provider progress", { jobId: job.id, projectId: job.projectId, message });
            await emitProgress(job, updateProgress, {
              stage: "architecture", status: "progress", message,
            });
          },
        });
        plan = request.targetEpisodeNumber
          ? mergeTargetedRevision(previous, generated.plan, request.targetEpisodeNumber)
          : generated.plan;
        provider = generated.provider;
        model = generated.model;
        fallbackFrom = generated.fallbackFrom;
        attempts = generated.attempts;
        await emitProgress(job, updateProgress, {
          stage: "architecture", status: "completed",
          message: `Season plan generated — ${plan.episodeProgression.length} episodes`,
          provider: generated.provider,
          model: generated.model,
          latencyMs: Date.now() - genStart,
          fallbackFrom: generated.fallbackFrom,
          totalEpisodes: plan.episodeProgression.length,
        });
      }

      // Stage C: Validate the plan
      await emitProgress(job, updateProgress, {
        stage: "validation", status: "started",
        message: "Validating season plan…",
      });
      const findings = validateSeasonPlan(plan, bibleContent);
      const errorCount = findings.findings.filter((f) => f.severity === "error").length;
      const warningCount = findings.findings.filter((f) => f.severity === "warning").length;
      log.info("season-plan", "validation complete", {
        projectId: job.projectId, jobId: job.id, passed: findings.passed,
        errorCount, warningCount,
      });
      await emitProgress(job, updateProgress, {
        stage: "validation", status: "completed",
        message: findings.passed
          ? `Validation passed — ${warningCount} warning${warningCount === 1 ? "" : "s"}`
          : `Validation found ${errorCount} error${errorCount === 1 ? "" : "s"} and ${warningCount} warning${warningCount === 1 ? "" : "s"}`,
        passed: findings.passed,
        errorCount,
        warningCount,
      });

      const draft: SeasonPlanDraft = {
        ...plan,
        clerkUserId: job.clerkUserId,
        projectId: job.projectId,
        basedOnBibleVersion: bible.approvedVersion,
        basedOnBibleFingerprint: fingerprint,
        provider: provider || llm.id,
        model: model || llm.model,
        fallbackFrom: fallbackFrom ?? null,
      };
      await emitProgress(job, updateProgress, {
        stage: "saving", status: "started",
        message: "Saving season plan…",
      });
      const saved = await plans.insert(draft);

      // Save validation findings on the persisted record
      await plans.saveValidationFindings(job.clerkUserId, saved.id, findings);

      // Also save the rich validation result from the Validation and Continuity Engine
      const richResult = validateSeasonPlanRich(plan, bibleContent, {
        bibleVersion: bible.approvedVersion,
        planVersion: saved.version,
      });
      if ("saveValidationResult" in plans && typeof plans.saveValidationResult === "function") {
        await plans.saveValidationResult(job.clerkUserId, saved.id, richResult);
      }
      log.info("season-plan", "rich validation saved", {
        projectId: job.projectId, planId: saved.id,
        overallSeverity: richResult.overallSeverity,
        deterministicFindings: richResult.deterministicFindingCount,
        passed: richResult.passed,
      });

      log.info("season-plan", "saved", {
        projectId: job.projectId, jobId: job.id, planId: saved.id, version: saved.version,
        provider: draft.provider, model: draft.model, passed: findings.passed,
      });

      await emitProgress(job, updateProgress, {
        stage: "complete", status: "completed",
        message: `Season plan saved — version ${saved.version}`,
        provider: draft.provider,
        model: draft.model,
        passed: findings.passed,
      });

      return {
        planId: saved.id,
        version: saved.version,
        passed: findings.passed,
        findingCount: findings.findings.length,
        provider: draft.provider,
        model: draft.model,
        fallbackFrom: draft.fallbackFrom,
        attempts: attempts ?? [],
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
function readSeasonPlanProgress(
  output: Record<string, unknown> | null
): { architecture: SeasonArchitecture; episodeDetails: EpisodeDetail[] } | null {
  if (!output) return null;
  const archRaw = output.seasonArchitecture;
  if (!archRaw) return null;
  const archParsed = seasonArchitectureSchema.safeParse(archRaw);
  if (!archParsed.success) return null;
  const detailsRaw = output.episodeDetails;
  if (!Array.isArray(detailsRaw)) return { architecture: archParsed.data, episodeDetails: [] };
  const details: EpisodeDetail[] = [];
  for (const item of detailsRaw) {
    const parsed = episodeDetailSchema.safeParse(item);
    if (parsed.success) details.push(parsed.data);
  }
  return { architecture: archParsed.data, episodeDetails: details };
}

function batchOutlines(outlines: EpisodeOutline[], batchSize: number): EpisodeOutline[][] {
  const batches: EpisodeOutline[][] = [];
  for (let i = 0; i < outlines.length; i += batchSize) {
    batches.push(outlines.slice(i, i + batchSize));
  }
  return batches;
}
