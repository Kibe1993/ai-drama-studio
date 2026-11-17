import { log } from "@/lib/log";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { ProjectStoryDraft } from "@/lib/repositories/storyRepository";
import { JobError, type JobRecord } from "@/lib/pipeline/types";
import type { LLMProvider, StoryModelResult, StoryPrompt } from "@/lib/providers/llm/types";
import {
  adjudicateCriticFindings,
  assembleNarrativeContext,
  canonFromApprovedSources,
  makeFinding,
  prepareWorkingCanon,
  renderNarrativeContext,
  runControlledRevision,
  DEFAULT_MAX_REVISION_ROUNDS,
  type CanonPort,
} from "@/lib/domain/narrativeControl";
import { storyBibleBrief } from "@/lib/providers/llm/storyBibleSections";
import { deriveStoryContract } from "@/lib/domain/storyContract";
import type { ContractLayer } from "@/lib/validation/storyContract";
import type { ControlDecision } from "@/lib/domain/narrativeControl/orchestrator";
import { validateEpisodeScreenplay } from "@/lib/domain/screenplayValidation";
import type { CanonState } from "@/lib/validation/narrativeControl";
import type { EpisodeValidation, EpisodeValidationFinding } from "@/lib/validation/casna";
import type { StoryBibleContent, StoryBibleSnapshot } from "@/lib/validation/storyBible";
import {
  storyDraftGenerationJobInputSchema,
  type GeneratedStory,
  type StoryRecord,
} from "@/lib/validation/story";

type ProgressWriter = (job: JobRecord, message: string) => Promise<void>;

type DraftReader = {
  findProjectDraft(clerkUserId: string, projectId: string): Promise<StoryRecord | null>;
  upsertProjectDraft(input: ProjectStoryDraft): Promise<{ id: string; title: string; synopsis: string }>;
};

type DraftSources = {
  bible?: {
    findApproved(clerkUserId: string, projectId: string): Promise<StoryBibleSnapshot | null>;
  } | null;
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
  updateProgress?: ProgressWriter,
  canon?: CanonPort | null,
  sources?: DraftSources | null,
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
      const targetFinding: EpisodeValidationFinding | null = (() => {
        if (request.operation !== "targeted_revision" || !request.targetFindingId || !previous?.validationFindings) return null;
        return previous.validationFindings.findings.find((f) => f.id === request.targetFindingId) ?? null;
      })();
      if (request.operation === "targeted_revision" && !targetFinding) {
        throw new JobError(
          "The specified validation finding was not found on the current draft. Revalidate and try again.",
          "finding_not_found",
          false,
        );
      }
      const bible = await sources?.bible?.findApproved(job.clerkUserId, job.projectId) ?? null;
      const derived = bible?.content
        ? canonFromApprovedSources({
            projectId: job.projectId,
            bible: bible.content,
            bibleVersion: bible.version,
          })
        : null;
      const working = derived
        ? await prepareWorkingCanon({
            clerkUserId: job.clerkUserId,
            projectId: job.projectId,
            derived,
            port: canon,
          })
        : null;
      const knowledge = buildContext(request.operation, request.instruction, request.creativeDirection, previous, targetFinding);
      const authority = working ? narrativeAuthority(working, job.projectId, request.instruction || request.operation) : undefined;
      const continuityContext = [knowledge, previous ? screenplayContext(previous) : undefined].filter(Boolean).join("\n\n") || undefined;
      const promptBase: StoryPrompt = {
        title: project.title,
        idea: project.originalStoryIdea,
        genre: project.genre,
        language: project.language,
        visualStyle: project.visualStyle,
        tone: project.tone,
        targetDurationSeconds: project.targetDurationSeconds,
        aspectRatio: project.aspectRatio,
        productionType: project.productionType,
        continuityContext,
        narrativeAuthority: authority,
        sceneRange: project.sceneRange,
      };

      log.info("story-draft", "engine started", {
        projectId: job.projectId,
        jobId: job.id,
        operation: request.operation,
        hasPrevious: Boolean(previous),
        canonVersion: working?.version ?? null,
        screenplayIncluded: Boolean(previous && request.operation === "revise"),
        canonCommitted: false,
      });

      let current = await llm.generateStory(promptBase, {
        jobId: job.id,
        onStatus: async (message) => {
          await updateProgress?.(job, message);
        },
      });
      let validation: EpisodeValidation | null = null;
      let rounds = 1;
      let semantic: ContractLayer = "not_executed";

      if (working) {
        const cycle = await runControlledRevision({
          canon: working,
          episode: 1,
          text: renderStory(current),
          maxRounds: Math.max(1, DEFAULT_MAX_REVISION_ROUNDS - 1),
          provider: current.provider || llm.id,
          request: {
            taskId: job.id,
            projectId: job.projectId,
            narrativeVersion: working.version,
            targetArtifact: "story_revision",
            targetId: job.projectId,
            episode: 1,
            objective: request.instruction || request.operation,
            allowedChangeIds: [],
          },
          assess: () => decisionFromValidation(working, validateDraft(project, current, working, bible?.content ?? null)),
          propose: async ({ findings, round }) => {
            const correction = findings
              .map((finding) => `- ${finding.explanation} Evidence: ${finding.evidence || "the proposal"}. Correction: ${finding.suggestedCorrection || "Restore the canonical fact."}`)
              .join("\n");
            current = await llm.generateStory({
              ...promptBase,
              continuityContext: [
                continuityContext,
                `Targeted revision, round ${round}. Change only the defective elements. Do not rewrite protected canon.`,
                correction,
              ].filter(Boolean).join("\n\n"),
            }, {
              jobId: job.id,
              onStatus: async (message) => {
                await updateProgress?.(job, message);
              },
            });
            return {
              taskId: job.id,
              projectId: job.projectId,
              narrativeVersion: working.version,
              proposedContent: renderStory(current),
              proposedChanges: [],
              newEntities: [],
              newFacts: [],
              modifiedFacts: [],
              dependencies: [],
              uncertainties: [],
            };
          },
        });
        rounds = cycle.rounds;
        validation = validateDraft(project, current, working, bible?.content ?? null);
        const accepted = validation.passed && cycle.decision === "approve";
        log.info("story-draft", "revision reviewed", {
          projectId: job.projectId,
          jobId: job.id,
          operation: request.operation,
          canonVersion: working.version,
          screenplayIncluded: Boolean(previous),
          layers: (validation.narrativeValidationLayers ?? []).join(","),
          errors: validation.findings.filter((finding) => finding.severity === "error").length,
          warnings: validation.findings.filter((finding) => finding.severity === "warning").length,
          round: rounds,
          accepted,
          canonCommitted: false,
          artifactsStale: false,
          decision: cycle.decision,
        });
        if (!accepted) {
          const errors = validation.findings.filter((f) => f.severity === "error");
          const summary = errors.length > 0
            ? errors.map((e, i) => `${i + 1}. ${e.message}`).join("\n")
            : "The revision conflicts with approved canon.";
          throw new JobError(
            summary,
            "narrative_rejected",
            false,
            {
              kind: "narrative_validation",
              findings: validation.findings,
              canonVersion: working.version,
              rounds,
              canonCommitted: false,
              artifactsStale: false,
            },
          );
        }
      } else {
        validation = validateDraft(project, current, null, null);
        if (!validation.passed) {
          const errors = validation.findings.filter((f) => f.severity === "error");
          const summary = errors.length > 0
            ? errors.map((e, i) => `${i + 1}. ${e.message}`).join("\n")
            : "The draft's synopsis, acts, and screenplay do not agree.";
          throw new JobError(
            summary,
            "narrative_rejected",
            false,
            {
              kind: "narrative_validation",
              findings: validation.findings,
              canonCommitted: false,
              artifactsStale: false,
            },
          );
        }
      }

      if (validation && working && llm.critiqueStory) {
        const reviewed = await applyStoryCritique({
          llm,
          project,
          story: current,
          bible: bible?.content ?? null,
          canon: working,
          validation,
          job,
        });
        validation = reviewed.validation;
        semantic = reviewed.semantic;
        if (!validation.passed) {
          const errors = validation.findings.filter((f) => f.severity === "error");
          const summary = errors.length > 0
            ? errors.map((e, i) => `${i + 1}. ${e.message}`).join("\n")
            : "The revision conflicts with approved canon.";
          throw new JobError(
            summary,
            "narrative_rejected",
            false,
            {
              kind: "narrative_validation",
              findings: validation.findings,
              canonVersion: working.version,
              rounds,
              canonCommitted: false,
              artifactsStale: false,
            },
          );
        }
      }

      const trace = traceOf(current, llm);
      const storyContract = validation
        ? deriveStoryContract({
            story: current,
            validation,
            creatorIdea: project.originalStoryIdea,
            semantic,
          })
        : null;
      const saved = await stories.upsertProjectDraft({
        title: current.title,
        synopsis: current.synopsis,
        structure: current.structure,
        screenplay: current.screenplay,
        clerkUserId: job.clerkUserId,
        projectId: job.projectId,
        provider: trace.provider,
        model: trace.model,
        fallbackFrom: trace.fallbackFrom,
        validationFindings: validation,
        sourceCanonVersion: working?.version ?? null,
        storyContract,
      });
      log.info("story-draft", "saved", {
        projectId: job.projectId,
        jobId: job.id,
        storyId: saved.id,
        scenes: current.screenplay.length,
        provider: trace.provider,
        model: trace.model,
        canonVersion: working?.version ?? null,
        accepted: true,
        canonCommitted: false,
        artifactsStale: false,
        round: rounds,
      });
      return {
        title: saved.title,
        synopsis: saved.synopsis,
        storyId: saved.id,
        provider: trace.provider,
        model: trace.model,
        fallbackFrom: trace.fallbackFrom,
        attempts: trace.attempts,
        canonVersion: working?.version ?? null,
        validationPassed: validation?.passed ?? null,
      };
    },
  };
}

async function applyStoryCritique(input: {
  llm: LLMProvider;
  project: ProjectRecord;
  story: GeneratedStory;
  bible: StoryBibleContent | null;
  canon: CanonState;
  validation: EpisodeValidation;
  job: JobRecord;
}): Promise<{ validation: EpisodeValidation; semantic: ContractLayer }> {
  if (!input.llm.critiqueStory) return { validation: input.validation, semantic: "not_executed" };
  try {
    const critique = await input.llm.critiqueStory(
      {
        seriesTitle: input.project.title,
        episodeNumber: 1,
        synopsis: input.story.synopsis,
        screenplay: input.story.screenplay,
        episodePlan: null,
        seasonPlan: null,
        continuityLedger: null,
        bibleBrief: input.bible ? storyBibleBrief(input.bible) : null,
      },
      { runId: input.job.id, jobId: input.job.id },
    );
    if (critique.findings.length === 0) return { validation: input.validation, semantic: "passed" };
    const adjudicated = adjudicateCriticFindings({
      canon: input.canon,
      episode: 1,
      scenes: input.story.screenplay.map((scene) => ({
        sceneNumber: scene.sceneNumber,
        text: [scene.heading, scene.action, scene.visualDescription, ...scene.dialogue.map((line) => `${line.characterName}: ${line.line}`)].join("\n"),
      })),
      findings: critique.findings,
    });
    const blocked = adjudicated.some((finding) => finding.severity === "error");
    log.info("story-draft", "continuity critique complete", {
      projectId: input.job.projectId,
      jobId: input.job.id,
      findings: critique.findings.length,
      blocked,
      canonCommitted: false,
    });
    return {
      validation: {
        ...input.validation,
        passed: input.validation.passed && !blocked,
        validatedAt: new Date().toISOString(),
        findings: [...input.validation.findings, ...adjudicated],
      },
      semantic: blocked ? "failed" : "passed",
    };
  } catch (error) {
    log.error("story-draft", "continuity critique failed", {
      projectId: input.job.projectId,
      jobId: input.job.id,
      detail: error instanceof Error ? error.message : "unknown",
    });
    return { validation: input.validation, semantic: "not_executed" };
  }
}

function validateDraft(
  project: ProjectRecord,
  story: GeneratedStory,
  canon: CanonState | null,
  bible: StoryBibleContent | null,
): EpisodeValidation {
  return validateEpisodeScreenplay({
    episodeNumber: 1,
    seriesTitle: project.title,
    story: { title: story.title, synopsis: story.synopsis, screenplay: story.screenplay },
    targetDurationSeconds: project.targetDurationSeconds,
    bible,
    seasonPlan: null,
    episodePlan: null,
    ledger: null,
    previousEpisodes: [],
    canon,
    structure: story.structure,
    sceneRange: project.sceneRange,
    requireCanonCoverage: canon != null,
  });
}

function decisionFromValidation(canon: CanonState, validation: EpisodeValidation): ControlDecision {
  const authorize = validation.narrativeDecision === "needs_authorization";
  const findings = validation.findings
    .filter((finding) => finding.severity === "error")
    .map((finding) => makeFinding({
      algorithm: finding.code ?? finding.category,
      severity: "ERROR",
      category: finding.category,
      explanation: finding.message,
      evidence: finding.evidence ?? finding.message,
      expected: "The approved canon.",
      actual: finding.evidence ?? finding.message,
      suggestedCorrection: finding.message,
      requiresCanonAuthorization: authorize,
    }));
  return {
    decision: validation.passed ? "approve" : authorize ? "needs_authorization" : "reject",
    canonVersion: canon.version,
    layers: validation.narrativeValidationLayers ?? ["deterministic"],
    findings,
    impact: { decisions: [], findings: [], requiresAuthorization: authorize },
    traces: [],
    retryable: false,
    provider: "application",
    nextCanon: validation.passed ? canon : null,
  };
}

function narrativeAuthority(canon: CanonState, projectId: string, objective: string): string | undefined {
  if (canon.facts.length === 0 && canon.rules.length === 0) return undefined;
  const packet = assembleNarrativeContext({
    canon,
    request: {
      taskId: `story-draft-${projectId}`,
      projectId,
      narrativeVersion: canon.version,
      targetArtifact: "story_revision",
      targetId: projectId,
      episode: 1,
      objective: objective || "Revise the story inside the committed canon.",
      allowedChangeIds: [],
    },
  });
  return renderNarrativeContext(canon, packet);
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
  previous: StoryRecord | null,
  targetFinding?: EpisodeValidationFinding | null,
): string | undefined {
  const parts: string[] = [];
  if (creativeDirection) parts.push(`Creative direction:\n${creativeDirection}`);
  if ((operation === "revise" || operation === "targeted_revision") && previous) {
    parts.push(
      `The current draft is:\nTitle: ${previous.title}\nSynopsis: ${previous.synopsis}\n` +
        `Keep everything the creator did not ask to change.`
    );
  }
  if (operation === "targeted_revision" && targetFinding) {
    const findingParts = [
      `Targeted revision for a single validation finding. Change only what is needed to address this issue. Do not rewrite the rest of the story.`,
      `Finding: ${targetFinding.message}`,
    ];
    if (targetFinding.title) findingParts.push(`Title: ${targetFinding.title}`);
    if (targetFinding.category) findingParts.push(`Category: ${targetFinding.category}`);
    if (targetFinding.sceneNumber) findingParts.push(`Affected scene: ${targetFinding.sceneNumber}`);
    if (targetFinding.affectedAct) findingParts.push(`Affected act: ${targetFinding.affectedAct}`);
    if (targetFinding.expected) findingParts.push(`Expected: ${targetFinding.expected}`);
    if (targetFinding.actual) findingParts.push(`Actual: ${targetFinding.actual}`);
    if (targetFinding.evidence) findingParts.push(`Evidence: ${targetFinding.evidence}`);
    if (targetFinding.suggestedCorrection) findingParts.push(`Suggested correction: ${targetFinding.suggestedCorrection}`);
    parts.push(findingParts.join("\n"));
  }
  if (instruction) parts.push(`Required changes:\n${instruction}`);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function screenplayContext(previous: StoryRecord): string {
  const scenes = previous.screenplay.slice(0, 12).map((scene) => {
    const lines = scene.dialogue.slice(0, 8).map((line) => `${line.characterName}: ${line.line}`).join("\n");
    return [
      `Scene ${scene.sceneNumber}. ${scene.heading}`,
      scene.action.slice(0, 500),
      lines,
    ].filter(Boolean).join("\n");
  });
  const body = scenes.join("\n\n").slice(0, 8000);
  return `Approved screenplay:\n${body}`;
}

function renderStory(story: GeneratedStory): string {
  const acts = [
    story.structure.act1.initialSituation,
    story.structure.act1.incitingIncident,
    story.structure.act2.turningPoint,
    story.structure.act3.climax,
    story.structure.act3.finalOutcome,
  ].join(" ");
  const scenes = story.screenplay.map((scene) =>
    [
      scene.action,
      ...scene.dialogue.map((line) => `${line.characterName}: ${line.line}`),
    ].join(" "),
  ).join("\n");
  return `${story.synopsis}\n${acts}\n${scenes}`;
}
