import { generationJobRepository } from "@/lib/repositories/generationJobRepository";
import { productionRunRepository } from "@/lib/repositories/productionRunRepository";
import { projectRepository } from "@/lib/repositories/projectRepository";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { episodeRepository } from "@/lib/repositories/episodeRepository";
import { productionSceneRepository } from "@/lib/repositories/productionSceneRepository";
import { continuityRepository } from "@/lib/repositories/continuityRepository";
import { seasonPlanRepository } from "@/lib/repositories/seasonPlanRepository";
import { continuityLedgerRepository } from "@/lib/repositories/continuityLedgerRepository";
import { createBullQueue } from "@/lib/pipeline/bullQueue";
import { createLiveEngines } from "@/lib/pipeline/liveEngines";
import { createEpisodeSuggestEngine } from "@/lib/pipeline/episodeSuggestEngine";
import { createSeasonPlanEngine } from "@/lib/pipeline/seasonPlanEngine";
import { createCasnaContext } from "@/lib/pipeline/casnaContext";
import { continuityService } from "@/lib/services/continuityService";
import { createCanonExtractionService } from "@/lib/services/canonExtractionService";
import { createCanonFactExtractionService } from "@/lib/services/canonFactExtractionService";
import { createCanonExtractionDispatcher } from "@/lib/services/canonExtractionDispatcher";
import { canonExtractionOutboxRepository } from "@/lib/repositories/canonExtractionOutboxRepository";
import type { PipelineDeps } from "@/lib/pipeline/ports";
import { createStoryProvider } from "@/lib/providers/llm/registry";
import type { LLMProvider } from "@/lib/providers/llm/types";
import { createRedisConnection } from "@/lib/pipeline/redis";
import { createStoryBibleEngine } from "@/lib/pipeline/storyBibleEngine";
import { createStoryDraftEngine } from "@/lib/pipeline/storyDraftEngine";
import { narrativeCanonRepository } from "@/lib/repositories/narrativeCanonRepository";
import { canonStore } from "@/lib/canon/store";
import { canonLockRepository } from "@/lib/repositories/canonLockRepository";
import type { JobQueue } from "@/lib/pipeline/types";

function unavailableQueue(): JobQueue {
  return {
    async enqueue() {
      throw new Error("queue_unavailable");
    },
  };
}

function makeCanonFactLLMPort(llm: LLMProvider): {
  request(system: string, prompt: string): Promise<{ text: string }>;
} {
  return {
    async request(system: string, prompt: string) {
      if (!llm.generateCanonFacts) {
        throw new Error("The configured LLM provider does not support canon fact extraction.");
      }
      const result = await llm.generateCanonFacts({ system, prompt });
      return { text: result.text };
    },
  };
}

export { makeCanonFactLLMPort };

export function livePipelineDeps(): PipelineDeps {
  if (cachedDeps) return cachedDeps;
  cachedDeps = buildLivePipelineDeps();
  return cachedDeps;
}

let cachedDeps: PipelineDeps | null = null;
let cachedLlm: ReturnType<typeof createStoryProvider> | null = null;

function getLlm() {
  if (cachedLlm) return cachedLlm;
  cachedLlm = createStoryProvider();
  return cachedLlm;
}

function buildLivePipelineDeps(): PipelineDeps {
  const connection = createRedisConnection();
  const llm = getLlm();
  const casnaContext = createCasnaContext({
    plans: seasonPlanRepository,
    ledgers: continuityLedgerRepository,
    episodes: episodeRepository,
    stories: storyRepository,
  });
  return {
    projects: projectRepository,
    runs: productionRunRepository,
    jobs: generationJobRepository,
    stories: storyRepository,
    episodes: episodeRepository,
    scenes: productionSceneRepository,
    continuity: continuityRepository,
    bibles: storyBibleRepository,
    casna: {
      load: casnaContext.load,
      /**
       * @deprecated LEGACY continuity ledger write path.
       *
       * The writer prompt and the continuity gate still depend on the old
       * ContinuityLedger, so this hook remains active during Step 2 of the
       * Canon Authority rebuild. It will be removed in Step 6 (Legacy
       * Consolidation) once all readers have migrated to the Canon Fact Log.
       *
       * Do NOT add new readers of the old ledger. New code must read from
       * `canonStore.latestState()` instead.
       */
      onEpisodeApproved: continuityService.onEpisodeApproved,
    },
    narrativeCanon: narrativeCanonRepository,
    queue: connection ? createBullQueue(connection) : unavailableQueue(),
    storyDraftEngine: createStoryDraftEngine(llm, storyRepository, async (job, message) => {
      const current = await generationJobRepository.findById(job.id);
      if (!current || current.status !== "processing") return;
      current.progress = { stage: current.jobType, message };
      await generationJobRepository.save(current);
    }, narrativeCanonRepository, { bible: storyBibleRepository }),
    storyBibleEngine: createStoryBibleEngine(llm, storyBibleRepository, async (job, message, output) => {
      const current = await generationJobRepository.findById(job.id);
      if (!current || current.status !== "processing") return;
      current.progress = { stage: current.jobType, message };
      if (output !== undefined) current.output = output;
      await generationJobRepository.save(current);
    }),
    episodeSuggestEngine: createEpisodeSuggestEngine(llm, episodeRepository, storyBibleRepository, productionRunRepository, async (job, message) => {
      const current = await generationJobRepository.findById(job.id);
      if (!current || current.status !== "processing") return;
      current.progress = { stage: current.jobType, message };
      await generationJobRepository.save(current);
    }, seasonPlanRepository, continuityLedgerRepository, casnaContext),
    seasonPlanEngine: createSeasonPlanEngine(llm, seasonPlanRepository, storyBibleRepository, storyRepository, async (job, message, output) => {
      const current = await generationJobRepository.findById(job.id);
      if (!current || current.status !== "processing") return;
      current.progress = { stage: current.jobType, message };
      if (output !== undefined) current.output = output;
      await generationJobRepository.save(current);
    }, episodeRepository, continuityLedgerRepository),
    engines: createLiveEngines({
      llm,
      stories: storyRepository,
      projects: projectRepository,
      storyBible: storyBibleRepository,
      continuity: continuityRepository,
      casna: casnaContext,
      semanticCritique: /^(1|true|yes)$/i.test(process.env.CASNA_SEMANTIC_VALIDATION?.trim() ?? ""),
      narrativeCanon: narrativeCanonRepository,
      canonExtraction: createCanonFactExtractionService(
        makeCanonFactLLMPort(llm),
        storyRepository,
        episodeRepository,
        canonStore,
        canonLockRepository,
        continuityLedgerRepository,
      ),
      onStoryStatus: async (job, message) => {
        const current = await generationJobRepository.findById(job.id);
        if (!current || current.status !== "processing") return;
        current.progress = { stage: current.jobType, message };
        await generationJobRepository.save(current);
      },
    }),
  };
}
export function liveCanonExtractionService() {
  return createCanonExtractionService(getLlm(), storyRepository, continuityLedgerRepository);
}
export function liveCanonFactExtractionService() {
  return createCanonFactExtractionService(
    makeCanonFactLLMPort(getLlm()),
    storyRepository,
    episodeRepository,
    canonStore,
    canonLockRepository,
    continuityLedgerRepository,
  );
}

export function liveCanonExtractionDispatcher() {
  return createCanonExtractionDispatcher(
    liveCanonFactExtractionService(),
    episodeRepository,
    storyRepository,
    canonExtractionOutboxRepository,
  );
}
