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
import type { PipelineDeps } from "@/lib/pipeline/ports";
import { createStoryProvider } from "@/lib/providers/llm/registry";
import { createRedisConnection } from "@/lib/pipeline/redis";
import { createStoryBibleEngine } from "@/lib/pipeline/storyBibleEngine";
import { createStoryDraftEngine } from "@/lib/pipeline/storyDraftEngine";
import { narrativeCanonRepository } from "@/lib/repositories/narrativeCanonRepository";
import type { JobQueue } from "@/lib/pipeline/types";

function unavailableQueue(): JobQueue {
  return {
    async enqueue() {
      throw new Error("queue_unavailable");
    },
  };
}

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
      canonExtraction: createCanonFactExtractionService({
        async request() {
          return { text: JSON.stringify({ facts: [] }) };
        },
      }),
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
