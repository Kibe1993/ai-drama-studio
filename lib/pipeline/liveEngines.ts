import { log } from "@/lib/log";
import type { ProjectPort } from "@/lib/pipeline/ports";
import { createMockEngines } from "@/lib/pipeline/mockEngines";
import { JobError, type EngineSet, type JobRecord, type RunRecord } from "@/lib/pipeline/types";
import { assertCharacters, assertScenes } from "@/lib/providers/llm/stageTasks";
import type { LLMProvider, StoryModelResult } from "@/lib/providers/llm/types";
import type { StoryDraft } from "@/lib/repositories/storyRepository";
import type { StoryRecord } from "@/lib/validation/story";
import type { StoryBibleSnapshot } from "@/lib/validation/storyBible";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";

export type StoryWriter = {
  upsertAwaiting(input: StoryDraft): Promise<{ id: string; title: string; synopsis: string }>;
  findForRun(clerkUserId: string, productionRunId: string): Promise<StoryRecord | null>;
};

/**
 * Live engines call the free language providers for the story, characters, and scenes.
 * Video and render stages stay on the mock engines.
 */
export function createLiveEngines(options: {
  llm: LLMProvider;
  stories: StoryWriter;
  projects: ProjectPort;
  storyBible?: {
    findApproved(clerkUserId: string, projectId: string): Promise<StoryBibleSnapshot | null>;
    findApprovedVersion?(clerkUserId: string, projectId: string, version: number): Promise<StoryBibleSnapshot | null>;
  };
  continuity?: {
    getPriorEpisodeContext(clerkUserId: string, projectId: string, beforeEpisodeNumber: number): Promise<string | undefined>;
  };
  onStoryStatus?: (job: JobRecord, message: string) => Promise<void>;
}): EngineSet {
  const mocks = createMockEngines();
  return {
    failNext: mocks.failNext.bind(mocks),
    async run(job: JobRecord, run: RunRecord) {
      if (job.jobType === "character.extract") return extractCharacters(options, job, run);
      if (job.jobType === "scene.breakdown") return breakDownScenes(options, job, run);
      if (job.jobType !== "story.generate") {
        log.info("pipeline", "mock engine", { jobType: job.jobType, jobId: job.id, sceneNumber: job.sceneNumber ?? "" });
        return mocks.run(job, run);
      }
      log.info("pipeline", "story engine", { jobId: job.id, projectId: job.projectId, runId: run.id });
      const project = await options.projects.findOwned(job.clerkUserId, job.projectId);
      if (!project || project.id !== run.projectId) {
        throw new JobError("The job does not match a project", "ownership", false);
      }
      const approvedBible = run.episode?.baseSnapshotVersion && options.storyBible?.findApprovedVersion
        ? await options.storyBible.findApprovedVersion(job.clerkUserId, project.id, run.episode.baseSnapshotVersion)
        : await options.storyBible?.findApproved(job.clerkUserId, project.id);
      const approvedEpisodeContext = project.productionMode === "serialized" && run.episode
        ? await options.continuity?.getPriorEpisodeContext(job.clerkUserId, project.id, run.episode.number)
        : undefined;
      const continuityContext = [formatContinuityContext(approvedBible, project), approvedEpisodeContext]
        .filter(Boolean).join("\n\nPrior approved episode continuity:\n");
      const generated = await options.llm.generateStory(
        {
          title: run.episode?.title || project.title,
          idea: [project.originalStoryIdea, run.episode?.premise].filter(Boolean).join("\n\nEpisode premise:\n"),
          genre: project.genre,
          language: project.language,
          visualStyle: project.visualStyle,
          tone: project.tone,
          targetDurationSeconds: run.episode?.targetDurationSeconds ?? project.targetDurationSeconds,
          aspectRatio: project.aspectRatio,
          productionType: project.productionType,
          continuityContext: continuityContext || undefined,
        },
        {
          runId: run.id,
          jobId: job.id,
          onStatus: (message) => options.onStoryStatus?.(job, message),
        }
      );
      const trace = storyTrace(generated, options.llm);
      log.info("pipeline", "story ready", {
        title: generated.title,
        scenes: generated.screenplay.length,
        provider: trace.provider,
        model: trace.model,
        fallbackFrom: trace.fallbackFrom ?? "",
      });
      const saved = await options.stories.upsertAwaiting({
        title: generated.title,
        synopsis: generated.synopsis,
        structure: generated.structure,
        screenplay: generated.screenplay,
        provider: trace.provider,
        model: trace.model,
        fallbackFrom: trace.fallbackFrom,
        clerkUserId: job.clerkUserId,
        projectId: project.id,
        productionRunId: run.id,
          episodeId: run.episode?.id ?? null,
      });
      return {
        title: saved.title,
        synopsis: saved.synopsis,
        storyId: saved.id,
        provider: trace.provider,
        model: trace.model,
        fallbackFrom: trace.fallbackFrom,
        attempts: trace.attempts,
      };
    },
  };
}

function formatContinuityContext(snapshot: StoryBibleSnapshot | null | undefined, project: ProjectRecord): string | undefined {
  if (!snapshot) return undefined;
  const facts = [
    snapshot.premise ? `Premise: ${snapshot.premise}` : "",
    snapshot.worldRules?.length ? `World rules: ${snapshot.worldRules.join("; ")}` : "",
    snapshot.themes?.length ? `Themes: ${snapshot.themes.join("; ")}` : "",
    snapshot.boundaries?.length ? `Boundaries: ${snapshot.boundaries.join("; ")}` : "",
    project.productionMode === "anthology" || !snapshot.canonFacts?.length
      ? ""
      : `Approved canon facts: ${snapshot.canonFacts?.join("; ")}`,
  ].filter(Boolean);
  return facts.length ? facts.join("\n") : undefined;
}

async function approvedStory(
  options: { stories: StoryWriter },
  job: JobRecord,
  run: RunRecord
): Promise<StoryRecord> {
  const story = await options.stories.findForRun(job.clerkUserId, run.id);
  if (!story || story.status !== "approved" || story.projectId !== job.projectId) {
    throw new JobError("This stage requires the approved story.", "dependency", false);
  }
  return story;
}

async function extractCharacters(
  options: {
    llm: LLMProvider;
    stories: StoryWriter;
    projects: ProjectPort;
    continuity?: { getPriorEpisodeContext(clerkUserId: string, projectId: string, beforeEpisodeNumber: number): Promise<string | undefined> };
    onStoryStatus?: (job: JobRecord, message: string) => Promise<void>;
  },
  job: JobRecord,
  run: RunRecord
) {
  const story = await approvedStory(options, job, run);
  const project = await options.projects.findOwned(job.clerkUserId, job.projectId);
  const continuityContext = project?.productionMode === "serialized" && run.episode
    ? await options.continuity?.getPriorEpisodeContext(job.clerkUserId, job.projectId, run.episode.number)
    : undefined;
  log.info("pipeline", "character engine", { jobId: job.id, projectId: job.projectId, runId: run.id });
  const generated = await options.llm.generateCharacters(
    { title: story.title, screenplay: story.screenplay, continuityContext },
    { runId: run.id, jobId: job.id, onStatus: (message) => options.onStoryStatus?.(job, message) }
  );
  assertCharacters(story.screenplay, generated.characters);
  const trace = storyTrace(generated, options.llm);
  log.info("pipeline", "characters ready", {
    count: generated.characters.length,
    provider: trace.provider,
    model: trace.model,
    fallbackFrom: trace.fallbackFrom ?? "",
  });
  return {
    names: generated.characters.map((character) => character.name),
    profiles: generated.characters,
    provider: trace.provider,
    model: trace.model,
    fallbackFrom: trace.fallbackFrom,
    attempts: trace.attempts,
  };
}

async function breakDownScenes(
  options: {
    llm: LLMProvider;
    stories: StoryWriter;
    projects: ProjectPort;
    continuity?: { getPriorEpisodeContext(clerkUserId: string, projectId: string, beforeEpisodeNumber: number): Promise<string | undefined> };
    onStoryStatus?: (job: JobRecord, message: string) => Promise<void>;
  },
  job: JobRecord,
  run: RunRecord
) {
  const story = await approvedStory(options, job, run);
  const project = await options.projects.findOwned(job.clerkUserId, job.projectId);
  if (!project) throw new JobError("The job does not match a project", "ownership", false);
  const names = run.stageResults.characters?.names ?? [];
  if (!run.stageResults.characters?.approved || names.length === 0) {
    throw new JobError("Scene breakdown requires approved characters.", "dependency", false);
  }
  const continuityContext = project.productionMode === "serialized" && run.episode
    ? await options.continuity?.getPriorEpisodeContext(job.clerkUserId, job.projectId, run.episode.number)
    : undefined;
  log.info("pipeline", "scene engine", { jobId: job.id, projectId: job.projectId, runId: run.id });
  const generated = await options.llm.generateScenes(
    {
      title: story.title,
      screenplay: story.screenplay,
      characterNames: names,
      targetDurationSeconds: run.episode?.targetDurationSeconds ?? project.targetDurationSeconds,
      continuityContext,
    },
    { runId: run.id, jobId: job.id, onStatus: (message) => options.onStoryStatus?.(job, message) }
  );
  assertScenes(
    { title: story.title, screenplay: story.screenplay, characterNames: names, targetDurationSeconds: run.episode?.targetDurationSeconds ?? project.targetDurationSeconds },
    generated.scenes
  );
  const trace = storyTrace(generated, options.llm);
  log.info("pipeline", "scenes ready", {
    count: generated.scenes.length,
    provider: trace.provider,
    model: trace.model,
    fallbackFrom: trace.fallbackFrom ?? "",
  });
  return {
    items: generated.scenes.map((scene) => ({
      ...scene,
      videoReady: false,
      videoStatus: "pending" as const,
      failed: false,
    })),
    provider: trace.provider,
    model: trace.model,
    fallbackFrom: trace.fallbackFrom,
    attempts: trace.attempts,
  };
}

function storyTrace(generated: { provider?: string; model?: string; fallbackFrom?: string | null; attempts?: StoryModelResult["attempts"] }, llm: LLMProvider) {
  return {
    provider: generated.provider || llm.id,
    model: generated.model || llm.model,
    fallbackFrom: generated.fallbackFrom ?? null,
    attempts: generated.attempts ?? [],
  };
}
