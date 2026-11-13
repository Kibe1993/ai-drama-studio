import { log } from "@/lib/log";
import { JobError, type JobRecord } from "@/lib/pipeline/types";
import { episodeSuggestionReference } from "@/lib/pipeline/episodeSuggestionContext";
import { compactCasnaPromptContext, type CasnaEpisodeContext } from "@/lib/pipeline/casnaContext";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { LLMProvider } from "@/lib/providers/llm/types";
import { episodeGenerationGate, nextEpisodeNumber } from "@/lib/domain/casna";

type SuggestLLM = Pick<LLMProvider, "generateEpisodeSuggestion">;
import { episodeSuggestionSchema } from "@/lib/validation/episode";

type EpisodeRepository = Pick<typeof import("@/lib/repositories/episodeRepository").episodeRepository, "listOwned" | "create">;
type BibleRepository = Pick<typeof import("@/lib/repositories/storyBibleRepository").storyBibleRepository, "findOwned">;
type RunRepository = Pick<typeof import("@/lib/repositories/productionRunRepository").productionRunRepository, "findLatest">;
type PlanRepository = Pick<typeof import("@/lib/repositories/seasonPlanRepository").seasonPlanRepository, "findApproved" | "findLatest">;
type LedgerRepository = Pick<typeof import("@/lib/repositories/continuityLedgerRepository").continuityLedgerRepository, "findLatest">;

type CasnaLoader = {
  load(input: {
    clerkUserId: string;
    projectId: string;
    productionMode: string;
    episodeNumber: number;
    bibleApprovedVersion: number;
    withScreenplays?: boolean;
  }): Promise<CasnaEpisodeContext>;
};

type ProgressWriter = (job: JobRecord, message: string) => Promise<void>;

const ACTIVE_RUNS = new Set(["pending", "running", "waiting_for_approval"]);

export function createEpisodeSuggestEngine(
  llm: SuggestLLM,
  episodes: EpisodeRepository,
  bibles: BibleRepository,
  runs: RunRepository,
  updateProgress?: ProgressWriter,
  plans?: PlanRepository,
  ledgers?: LedgerRepository,
  casna?: CasnaLoader,
) {
  return {
    async run(job: JobRecord, project: ProjectRecord) {
      if (job.jobType !== "episodeSuggest.generate" || job.runId !== null) {
        throw new JobError("Invalid episode suggestion job scope.", "invalid_job", false);
      }
      const startedAt = Date.now();
      log.info("episode-suggest", "engine started", { projectId: job.projectId, jobId: job.id });
      const latestRun = await runs.findLatest(job.clerkUserId, job.projectId);
      if (latestRun && ACTIVE_RUNS.has(latestRun.status)) {
        throw new JobError("A production is active; episode proposals wait until it is idle.", "episode_run_active", false);
      }
      const existing = await episodes.listOwned(job.clerkUserId, job.projectId);
      if (!existing) throw new JobError("The project for this episode request was not found.", "not_found", false);
      const bible = await bibles.findOwned(job.clerkUserId, job.projectId);
      const snapshotVersion = bible?.approvedVersion ?? 0;
      // An AI-proposed episode is still an episode: approved canon is required
      // before one is written, in every production mode.
      if (snapshotVersion === 0) {
        throw new JobError("Approve the Story Bible before creating episodes.", "bible_required", false);
      }
      const reference = episodeSuggestionReference(project, bible ?? null);
      if (!reference) {
        throw new JobError("Develop a Story Bible or set a story idea before asking AI to propose an episode.", "reference_required", false);
      }
      if (!llm.generateEpisodeSuggestion) {
        throw new JobError("No configured AI provider can propose an episode.", "configuration", false);
      }

      // CASNA: Load Season Plan and Continuity Ledger for sequential generation
      const approvedPlan = plans ? await plans.findApproved(job.clerkUserId, job.projectId) : null;
      const latestPlan = plans ? await plans.findLatest(job.clerkUserId, job.projectId) : null;
      const ledger = ledgers ? await ledgers.findLatest(job.clerkUserId, job.projectId) : null;
      const targetEpisodeNumber = nextEpisodeNumber(existing);
      // The service checked this gate when the job was queued; check it again so
      // a plan revision or a newly approved episode cannot be overtaken by a
      // stale queued job.
      const gate = episodeGenerationGate({
        productionMode: project.productionMode,
        bibleApprovedVersion: snapshotVersion,
        approvedPlan,
        latestPlan,
        ledger,
        episodes: existing,
        targetEpisodeNumber,
      });
      if (!gate.allowed) {
        throw new JobError(gate.reason ?? "This episode is locked.", gate.code, false);
      }
      const previousEpisodes = existing.map((episode) => ({
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        premise: episode.premise,
      }));
      // One derivation path for the plan, ledger, and prior-episode context.
      const context = casna
        ? await casna.load({
            clerkUserId: job.clerkUserId,
            projectId: job.projectId,
            productionMode: project.productionMode,
            episodeNumber: targetEpisodeNumber,
            bibleApprovedVersion: snapshotVersion,
            withScreenplays: false,
          })
        : null;
      const compact = context ? compactCasnaPromptContext(context) : null;
      const contextEpisodes = context
        ? context.previousEpisodes.map((episode) => ({
            episodeNumber: episode.episodeNumber,
            title: episode.title,
            premise: episode.synopsis,
          }))
        : previousEpisodes;

      const generated = await llm.generateEpisodeSuggestion(
        {
          seriesTitle: bible?.content?.identity.title || project.title,
          targetDurationSeconds: project.targetDurationSeconds,
          episodeNumber: targetEpisodeNumber,
          productionMode: project.productionMode,
          previousEpisodes: contextEpisodes,
          storyBible: reference,
          seasonPlan: compact?.seasonPlan ?? null,
          continuityLedger: compact?.continuityLedger ?? null,
          episodePlan: compact?.episodePlan ?? null,
        },
        {
          jobId: job.id,
          onStatus: async (message) => {
            log.info("episode-suggest", "provider progress", { jobId: job.id, projectId: job.projectId, message });
            await updateProgress?.(job, message);
          },
        }
      );
      const suggestion = episodeSuggestionSchema.parse(generated.suggestion);
      const episode = await episodes.create(
        job.clerkUserId,
        job.projectId,
        {
          title: suggestion.title,
          premise: suggestion.premise,
          targetDurationSeconds: project.targetDurationSeconds,
        },
        snapshotVersion,
        approvedPlan?.version ?? 0
      );
      if (!episode) throw new JobError("The project for this episode request was not found.", "not_found", false);
      log.info("episode-suggest", "episode created", {
        projectId: job.projectId, jobId: job.id,
        episodeId: episode.id, episodeNumber: episode.episodeNumber,
        provider: generated.provider ?? "unknown", model: generated.model ?? "unknown",
        hasPlan: Boolean(approvedPlan), hasLedger: Boolean(ledger),
        ms: Date.now() - startedAt,
      });
      return {
        episodeId: episode.id,
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        provider: generated.provider ?? "unknown",
        model: generated.model ?? "unknown",
        fallbackFrom: generated.fallbackFrom ?? null,
        usedSeasonPlan: Boolean(approvedPlan),
        usedContinuityLedger: Boolean(ledger),
      };
    },
    // The episode row is only written after a successful suggestion, so a
    // failed job has no side effects to unwind.
    async fail() {},
  };
}

export type EpisodeSuggestEngine = ReturnType<typeof createEpisodeSuggestEngine>;
