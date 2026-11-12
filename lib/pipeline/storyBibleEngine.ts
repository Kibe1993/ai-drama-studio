import { JobError, type JobRecord } from "@/lib/pipeline/types";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import { legacyStoryBibleFields, storyBibleContentSchema, storyBibleGenerationJobInputSchema, type StoryBibleContent, type StoryBibleDraft } from "@/lib/validation/storyBible";
import { mergeStoryBibleResult, validateStoryBibleTaskResult, type StoryBibleTaskInput } from "@/lib/providers/llm/storyBibleTask";
import {
  buildStoryBibleSectionTask,
  generateStoryBibleSections,
  parseStoryBibleSectionsState,
  STORY_BIBLE_SECTION_SEQUENCE_TIMEOUT_MS,
  type StoryBibleSectionRun,
  type StoryBibleSectionsState,
} from "@/lib/providers/llm/storyBibleSections";
import type { LLMProvider, StoryBibleModelResult } from "@/lib/providers/llm/types";
import { log } from "@/lib/log";

type Repository = Pick<
  typeof import("@/lib/repositories/storyBibleRepository").storyBibleRepository,
  "findOwned" | "markGenerationProcessing" | "completeGeneration" | "failGeneration"
>;

type ProgressWriter = (job: JobRecord, message: string, output?: Record<string, unknown>) => Promise<void>;

function progressMessage(state: StoryBibleSectionsState): string {
  const done = Object.keys(state.sections).length;
  if (state.failedSection) {
    return `Story Bible: ${state.failedSection} section failed; ${done} of 6 sections preserved`;
  }
  return `Story Bible: ${done} of 6 sections ready`;
}

function providerSummary(
  state: StoryBibleSectionsState | null,
  generated: { provider?: string; model?: string; fallbackFrom?: string | null } | null
) {
  if (!state) {
    return {
      provider: generated?.provider ?? "unknown",
      model: generated?.model ?? "unknown",
      fallbackFrom: generated?.fallbackFrom ?? null,
      sections: undefined,
    };
  }
  const runs = Object.values(state.runs).filter(Boolean) as StoryBibleSectionRun[];
  const providers = [...new Set(runs.map((run) => run.provider))];
  const models = [...new Set(runs.map((run) => run.model))];
  return {
    provider: providers.length === 1 ? providers[0]! : providers.length > 1 ? "mixed" : "unknown",
    model: models.length === 1 ? models[0]! : models.length > 1 ? "mixed" : "unknown",
    fallbackFrom: runs.find((run) => run.fallbackFrom)?.fallbackFrom ?? null,
    sections: state.runs,
  };
}

export function createStoryBibleEngine(
  llm: LLMProvider,
  repository: Repository,
  updateProgress?: ProgressWriter
) {
  return {
    async run(job: JobRecord, project: ProjectRecord) {
      if (job.jobType !== "storyBible.generate" || job.runId !== null) {
        throw new JobError("Invalid Story Bible job scope.", "invalid_job", false);
      }
      const input = storyBibleGenerationJobInputSchema.safeParse(job.input);
      if (!input.success) throw new JobError("The Story Bible request is invalid.", "invalid_input", false);
      const request = input.data;
      const startedAt = Date.now();
      log.info("story-bible", "engine started", {
        projectId: job.projectId, jobId: job.id, operation: request.operation,
        expectedRevision: request.expectedDraftRevision,
      });
      const bible = await repository.findOwned(job.clerkUserId, job.projectId);
      if (!bible || bible.generationJobId !== job.id || bible.draftRevision !== request.expectedDraftRevision) {
        log.error("story-bible", "stale job rejected", { projectId: job.projectId, jobId: job.id, expectedRevision: request.expectedDraftRevision, currentRevision: bible?.draftRevision ?? "missing" });
        throw new JobError("This Story Bible request is stale. Start a new request from the current draft.", "stale_generation", false);
      }
      if (!(await repository.markGenerationProcessing(job.clerkUserId, job.projectId, job.id))) {
        log.error("story-bible", "processing transition rejected", { projectId: job.projectId, jobId: job.id, code: "stale_generation" });
        throw new JobError("This Story Bible request is no longer active.", "stale_generation", false);
      }
      log.info("story-bible", "draft locked for generation", { projectId: job.projectId, jobId: job.id, draftRevision: bible.draftRevision });

      const approved = bible.approvedSnapshot?.content;
      const base: StoryBibleTaskInput = {
        mode: request.operation,
        title: request.title || project.title,
        idea: request.idea,
        creativeDirection: request.creativeDirection,
        instruction: request.instruction,
        section: request.section,
        freshInterpretation: request.freshInterpretation,
        creatorDecisions: bible.creatorDecisions,
        project: {
          productionType: project.productionType,
          productionMode: project.productionMode,
          genre: project.genre,
          language: project.language,
          tone: project.tone,
        },
      };
      try {
        if (!llm.generateStoryBible) throw new JobError("No configured AI provider can develop a Story Bible.", "configuration", false);
        const sectioned = request.operation === "generate" || request.operation === "regenerate";
        let content: StoryBibleContent;
        let sectionState: StoryBibleSectionsState | null = null;
        let generated: StoryBibleModelResult | null = null;

        if (sectioned) {
          const includePreserved = request.operation === "regenerate" && !request.freshInterpretation;
          const result = await generateStoryBibleSections(llm, base, {
            jobId: job.id,
            scope: { projectId: job.projectId, expectedDraftRevision: request.expectedDraftRevision },
            cached: parseStoryBibleSectionsState(job.output),
            current: includePreserved ? bible.content ?? null : null,
            approved: includePreserved ? approved ?? null : null,
            includeCurrent: includePreserved,
            includeApproved: includePreserved,
            onStatus: async (message) => {
              log.info("story-bible", "provider progress", { jobId: job.id, projectId: project.id, message });
              await updateProgress?.(job, message, job.output ?? undefined);
            },
            onProgress: async (state) => {
              job.output = { ...(job.output ?? {}), storyBibleSections: state };
              await updateProgress?.(job, progressMessage(state), job.output);
            },
          });
          content = result.content;
          sectionState = result.state;
          log.info("story-bible", "sections assembled", {
            projectId: project.id, jobId: job.id,
            sections: Object.keys(result.state.sections).length,
            ms: Date.now() - startedAt,
          });
        } else {
          const task = request.operation === "section"
            ? buildStoryBibleSectionTask(base, request.section!, {
              sections: bible.content ?? {},
              contextMode: "siblings",
              current: bible.content ? { [request.section!]: bible.content[request.section!] } : undefined,
              approved: approved && !request.freshInterpretation
                ? { [request.section!]: approved[request.section!] }
                : undefined,
            })
            : { ...base, current: bible.content ?? undefined, approved };
          generated = await llm.generateStoryBible(task, {
            jobId: job.id,
            ...(task.mode === "section" ? { sequenceTimeoutMs: STORY_BIBLE_SECTION_SEQUENCE_TIMEOUT_MS } : {}),
            onStatus: async (message) => {
              log.info("story-bible", "provider progress", { jobId: job.id, projectId: project.id, message });
              await updateProgress?.(job, message, job.output ?? undefined);
            },
          });
          const validated = validateStoryBibleTaskResult(task, generated.result);
          content = mergeStoryBibleResult(bible.content ?? null, validated);
        }

        // Keep accepted canon and commitments stable during full regeneration unless
        // the creator explicitly requests a fresh interpretation.
        if (request.operation === "regenerate" && !request.freshInterpretation && approved) {
          content = storyBibleContentSchema.parse({
            ...content,
            identity: {
              ...content.identity,
              title: request.title || approved.identity.title,
              centralPremise: approved.identity.centralPremise,
            },
            world: {
              ...content.world,
              rules: [...new Set([...approved.world.rules, ...content.world.rules])],
              geographyAndLocations: [...approved.world.geographyAndLocations, ...content.world.geographyAndLocations.filter((next) => !approved.world.geographyAndLocations.some((old) => old.name.toLowerCase() === next.name.toLowerCase()))],
              historyAndPastEvents: [...new Set([...approved.world.historyAndPastEvents, ...content.world.historyAndPastEvents])],
            },
            canon: { ...content.canon, confirmedFacts: [...new Set([...approved.canon.confirmedFacts, ...content.canon.confirmedFacts])] },
            guidelines: {
              ...content.guidelines,
              boundaries: [...new Set([...approved.guidelines.boundaries, ...content.guidelines.boundaries])],
              mustRemainConsistent: [...new Set([...approved.guidelines.mustRemainConsistent, ...content.guidelines.mustRemainConsistent])],
            },
            characters: {
              ...content.characters,
              relationshipDynamics: [...new Set([...approved.characters.relationshipDynamics, ...content.characters.relationshipDynamics])],
              characters: [
                ...approved.characters.characters,
                ...content.characters.characters.filter((next) => !approved.characters.characters.some((old) => old.name.toLowerCase() === next.name.toLowerCase())),
              ],
            },
          });
        }
        const decisions = request.instruction
          ? [...new Set([...bible.creatorDecisions, request.instruction])].slice(-40)
          : bible.creatorDecisions;
        const draft: StoryBibleDraft = {
          ...legacyStoryBibleFields(content), content,
          sourceIdea: request.idea,
          creativeDirection: request.creativeDirection,
          creatorDecisions: decisions,
        };
        const saved = await repository.completeGeneration({
          clerkUserId: job.clerkUserId,
          projectId: job.projectId,
          jobId: job.id,
          expectedDraftRevision: request.expectedDraftRevision,
          draft,
        });
        if (!saved) throw new JobError("The draft changed while this Story Bible was being developed. Its result was not saved.", "stale_generation", false);
        const summary = providerSummary(sectionState, generated);
        log.info("story-bible", "saved", {
          projectId: project.id, jobId: job.id, provider: summary.provider, model: summary.model,
          revision: saved.draftRevision, ms: Date.now() - startedAt,
        });
        return {
          provider: summary.provider,
          model: summary.model,
          fallbackFrom: summary.fallbackFrom,
          ...(summary.sections ? { sections: summary.sections } : { section: request.section }),
          draftRevision: saved.draftRevision,
        };
      } catch (error) {
        const message = error instanceof JobError ? error.message : "Story Bible generation failed. Your existing draft was preserved.";
        log.error("story-bible", "engine failed", {
          projectId: job.projectId, jobId: job.id,
          code: error instanceof JobError ? error.code : "provider_or_persistence_error",
          retryable: error instanceof JobError ? error.retryable : true,
          ms: Date.now() - startedAt,
        });
        if (!(error instanceof JobError) || !error.retryable) {
          await repository.failGeneration(job.clerkUserId, job.projectId, job.id, message);
        }
        throw error;
      }
    },
    fail(job: JobRecord, message: string) {
      return repository.failGeneration(job.clerkUserId, job.projectId, job.id, message);
    },
  };
}
