import { log } from "@/lib/log";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { ProjectStoryDraft } from "@/lib/repositories/storyRepository";
import { JobError, type JobRecord } from "@/lib/pipeline/types";
import type { LLMProvider, StoryModelResult } from "@/lib/providers/llm/types";
import {
  storyDraftGenerationJobInputSchema,
  type StoryRecord,
} from "@/lib/validation/story";

type ProgressWriter = (job: JobRecord, message: string) => Promise<void>;

type DraftReader = {
  findProjectDraft(clerkUserId: string, projectId: string): Promise<StoryRecord | null>;
  upsertProjectDraft(input: ProjectStoryDraft): Promise<{ id: string; title: string; synopsis: string }>;
};

/**
 * The run-less story draft engine. It develops the project-level Story Draft
 * that Stage 2 of the guided workflow reviews and approves, before any episode
 * or production run exists. Episode screenplays still use the run-scoped
 * `story.generate` engine and are untouched by this.
 */
export function createStoryDraftEngine(
  llm: LLMProvider,
  stories: DraftReader,
  updateProgress?: ProgressWriter
) {
  return {
    async run(job: JobRecord, project: ProjectRecord) {
      if (job.jobType !== "story.draft" || job.runId !== null) {
        throw new JobError("Invalid story draft job scope.", "invalid_job", false);
      }
      const parsed = storyDraftGenerationJobInputSchema.safeParse(job.input);
      if (!parsed.success) throw new JobError("The story draft request is invalid.", "invalid_input", false);
      const request = parsed.data;
      const previous = await stories.findProjectDraft(job.clerkUserId, job.projectId);
      const knowledge = buildContext(request.operation, request.instruction, request.creativeDirection, previous);

      log.info("story-draft", "engine started", {
        projectId: job.projectId, jobId: job.id, operation: request.operation, hasPrevious: Boolean(previous),
      });
      const generated = await llm.generateStory(
        {
          title: project.title,
          idea: project.originalStoryIdea,
          genre: project.genre,
          language: project.language,
          visualStyle: project.visualStyle,
          tone: project.tone,
          targetDurationSeconds: project.targetDurationSeconds,
          aspectRatio: project.aspectRatio,
          productionType: project.productionType,
          continuityContext: knowledge,
        },
        {
          jobId: job.id,
          onStatus: async (message) => {
            await updateProgress?.(job, message);
          },
        }
      );
      const trace = traceOf(generated, llm);
      const saved = await stories.upsertProjectDraft({
        title: generated.title,
        synopsis: generated.synopsis,
        structure: generated.structure,
        screenplay: generated.screenplay,
        clerkUserId: job.clerkUserId,
        projectId: job.projectId,
        provider: trace.provider,
        model: trace.model,
        fallbackFrom: trace.fallbackFrom,
      });
      log.info("story-draft", "saved", {
        projectId: job.projectId, jobId: job.id, storyId: saved.id, scenes: generated.screenplay.length,
        provider: trace.provider, model: trace.model,
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

function traceOf(generated: StoryModelResult, llm: LLMProvider) {
  return {
    provider: generated.provider || llm.id,
    model: generated.model || llm.model,
    fallbackFrom: generated.fallbackFrom ?? null,
    attempts: generated.attempts ?? [],
  };
}

/** Builds the extra guidance handed to the provider as continuity context. */
function buildContext(
  operation: string,
  instruction: string,
  creativeDirection: string,
  previous: StoryRecord | null
): string | undefined {
  const parts: string[] = [];
  if (creativeDirection) parts.push(`Creative direction:\n${creativeDirection}`);
  if (operation === "revise" && previous) {
    parts.push(
      `The current draft is:\nTitle: ${previous.title}\nSynopsis: ${previous.synopsis}\n` +
        `Keep everything the creator did not ask to change.`
    );
  }
  if (instruction) parts.push(`Required changes:\n${instruction}`);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}
