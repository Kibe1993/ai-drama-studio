import { log } from "@/lib/log";
import type { ProjectPort } from "@/lib/pipeline/ports";
import { createMockEngines } from "@/lib/pipeline/mockEngines";
import { JobError, type EngineSet, type JobRecord, type RunRecord } from "@/lib/pipeline/types";
import { assertCharacters, assertScenes } from "@/lib/providers/llm/stageTasks";
import { storyBibleBrief, renderStoryBibleBrief } from "@/lib/providers/llm/storyBibleSections";
import type { LLMProvider, StoryModelResult } from "@/lib/providers/llm/types";
import type { StoryDraft } from "@/lib/repositories/storyRepository";
import type { StoryRecord } from "@/lib/validation/story";
import type { StoryBibleSnapshot } from "@/lib/validation/storyBible";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import { compactCasnaPromptContext, type CasnaEpisodeContext } from "@/lib/pipeline/casnaContext";
import { validateEpisodeScreenplay } from "@/lib/domain/screenplayValidation";
import { adjudicateCriticFindings, assembleNarrativeContext, canonFromApprovedSources, prepareWorkingCanon, renderNarrativeContext, type CanonPort } from "@/lib/domain/narrativeControl";
import { mergeSceneRepair, repairSceneNumbers } from "@/lib/providers/llm/repairScenes";
import type { SceneRepairRecord } from "@/lib/validation/story";

/** Bounded targeted-repair rounds before falling back to full regeneration. */
const MAX_SCENE_REPAIR_ROUNDS = 2;

export type StoryWriter = {
  upsertAwaiting(input: StoryDraft): Promise<{ id: string; title: string; synopsis: string }>;
  findForRun(clerkUserId: string, productionRunId: string): Promise<StoryRecord | null>;
  /** The approved project-level story draft a season is built on. */
  findProjectDraft?(clerkUserId: string, projectId: string): Promise<StoryRecord | null>;
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
  /** CASNA Stages E/F/G/H: approved plan, ledger, and prior approved episodes. */
  casna?: {
    load(input: {
      clerkUserId: string;
      projectId: string;
      productionMode: string;
      episodeNumber: number;
      bibleApprovedVersion: number;
      withScreenplays?: boolean;
    }): Promise<CasnaEpisodeContext>;
  };
  /** CASNA: opt-in continuity critique. Confirmed canon breaches block; the rest stay warnings. */
  semanticCritique?: boolean;
  /** Persisted narrative canon. Absent in unit tests, which keep the derived snapshot in memory. */
  narrativeCanon?: CanonPort;
  /** Canon Fact Log extraction service. */
  canonExtraction?: {
    extractAndCommit(input: {
      clerkUserId: string;
      projectId: string;
      episodeId: string;
      storyId: string;
      episodeNumber: number;
      jobId: string;
    }): Promise<{ committed: number; issues: number; status: string }>;
  };
  onStoryStatus?: (job: JobRecord, message: string) => Promise<void>;
}): EngineSet {
  const mocks = createMockEngines();
  return {
    failNext: mocks.failNext.bind(mocks),
    async run(job: JobRecord, run: RunRecord) {
      if (job.jobType === "character.extract") return extractCharacters(options, job, run);
      if (job.jobType === "scene.breakdown") return breakDownScenes(options, job, run);
      if (job.jobType === "canon.extract") {
        if (!options.canonExtraction) {
          throw new JobError("Canon extraction is not configured.", "not_configured", false);
        }
        const storyId =
          typeof (job.input as { storyId?: unknown }).storyId === "string"
            ? (job.input as { storyId: string }).storyId
            : "";
        if (!storyId) {
          throw new JobError("Story ID is required for canon extraction.", "invalid_input", false);
        }
        const episodeId = run.episode?.id ?? "";
        const episodeNumber = run.episode?.number ?? 1;
        const result = await options.canonExtraction.extractAndCommit({
          clerkUserId: job.clerkUserId,
          projectId: job.projectId,
          episodeId,
          storyId,
          episodeNumber,
          jobId: job.id,
        });
        return { ...result };
      }
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

      // CASNA Stage E/F: for a serialized drama, load the approved Season Plan,
      // the Continuity Ledger, and earlier approved episodes before deciding what
      // this episode is allowed to be.
      const episodeNumber = run.episode?.number ?? 1;
      const casna = project.productionMode === "serialized" && options.casna
        ? await options.casna.load({
            clerkUserId: job.clerkUserId,
            projectId: project.id,
            productionMode: project.productionMode,
            episodeNumber,
            bibleApprovedVersion: approvedBible?.version ?? run.episode?.baseSnapshotVersion ?? 0,
            withScreenplays: true,
          })
        : null;
      if (casna && !casna.gate.allowed) {
        throw new JobError(casna.gate.reason ?? "This episode is locked.", casna.gate.code, false);
      }
      if (casna?.episodePlanValidation && !casna.episodePlanValidation.passed) {
        const errors = casna.episodePlanValidation.findings.filter((f) => f.severity === "error");
        const summary = errors.length > 0
          ? errors.map((e, i) => `${i + 1}. ${e.message}`).join("\n")
          : "The episode plan conflicts with the approved Season Plan.";
        throw new JobError(
          summary,
          "plan_conflict",
          false,
          { findings: casna.episodePlanValidation.findings },
        );
      }
      const casnaPrompt = casna ? compactCasnaPromptContext(casna) : null;

      const approvedEpisodeContext = project.productionMode === "serialized" && run.episode
        ? await options.continuity?.getPriorEpisodeContext(job.clerkUserId, project.id, run.episode.number)
        : undefined;
      // CASNA Stage A/E: the episode is developed from the approved project-level
      // story draft as well as the Story Bible, so the season keeps one story.
      const projectDraft = options.stories.findProjectDraft
        ? await options.stories.findProjectDraft(job.clerkUserId, project.id)
        : null;
      const storyDraftContext =
        projectDraft && projectDraft.status === "approved" ? formatStoryDraft(projectDraft) : undefined;
      const continuityContext = [
        formatContinuityContext(approvedBible, project),
        storyDraftContext,
        approvedEpisodeContext,
      ]
        .filter(Boolean).join("\n\nPrior approved episode continuity:\n");
      const derivedCanon = canonFromApprovedSources({
        projectId: project.id,
        bible: approvedBible?.content ?? null,
        ledger: casna?.ledger ?? null,
        bibleVersion: approvedBible?.version ?? run.episode?.baseSnapshotVersion ?? 0,
        planVersion: casna?.plan?.version ?? 0,
      });
      const narrativeCanon = await prepareWorkingCanon({
        port: options.narrativeCanon,
        clerkUserId: job.clerkUserId,
        projectId: project.id,
        derived: derivedCanon,
      });
      const narrativePacket = assembleNarrativeContext({
        canon: narrativeCanon,
        request: {
          taskId: job.id,
          projectId: project.id,
          narrativeVersion: narrativeCanon.version,
          targetArtifact: "screenplay",
          targetId: String(episodeNumber),
          episode: episodeNumber,
          objective: `Write episode ${episodeNumber} inside the approved canon.`,
          allowedChangeIds: [],
        },
      });
      const narrativeAuthority = narrativeCanon.facts.length > 0 || narrativeCanon.rules.length > 0
        ? renderNarrativeContext(narrativeCanon, narrativePacket)
        : undefined;
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
          bibleContext: approvedBible?.content ? renderStoryBibleBrief(approvedBible.content) : undefined,
          seasonPlan: casnaPrompt?.seasonPlan ?? null,
          episodePlan: casnaPrompt?.episodePlan ?? null,
          continuityLedger: casnaPrompt?.continuityLedger ?? null,
          previousEpisode: casnaPrompt?.previousEpisode ?? null,
          narrativeAuthority,
        },
        {
          runId: run.id,
          jobId: job.id,
          onStatus: (message) => options.onStoryStatus?.(job, message),
        }
      );
      const trace = storyTrace(generated, options.llm);
      const seriesTitle = approvedBible?.content?.identity.title ?? project.title;
      const episodeTarget = run.episode?.targetDurationSeconds ?? project.targetDurationSeconds;

      // CASNA Stage H: validate the finished screenplay against approved canon
      // before it is presented for approval.
      let screenplay = generated.screenplay;
      let validation = casna
        ? validateEpisodeScreenplay({
            episodeNumber,
            seriesTitle,
            story: { title: generated.title, synopsis: generated.synopsis, screenplay },
            targetDurationSeconds: episodeTarget,
            bible: approvedBible?.content ?? null,
            seasonPlan: casna.plan,
            episodePlan: casna.episodePlan,
            ledger: casna.ledger,
            previousEpisodes: casna.previousEpisodes,
            canon: narrativeCanon,
            structure: generated.structure,
            sceneRange: project.sceneRange,
          })
        : null;
      const repairHistory: SceneRepairRecord[] = [];

      // Repair only the scenes the findings point at, then fall back to the
      // job's bounded retry when a repair cannot resolve the problem.
      while (
        validation &&
        !validation.passed &&
        casna &&
        options.llm.repairScenes &&
        repairHistory.length < MAX_SCENE_REPAIR_ROUNDS
      ) {
        const targets = repairSceneNumbers(validation.findings);
        if (targets.length === 0) break;
        const findingsBefore = validation.findings.filter((finding) => finding.severity === "error").length;
        let repaired;
        try {
          repaired = await options.llm.repairScenes(
            {
              seriesTitle,
              episodeNumber,
              targetDurationSeconds: episodeTarget,
              screenplay,
              findings: validation.findings,
              episodePlan: casna.episodePlan,
              seasonPlan: casnaPrompt?.seasonPlan ?? null,
              continuityLedger: casnaPrompt?.continuityLedger ?? null,
            },
            {
              runId: run.id,
              jobId: job.id,
              onStatus: (message) => options.onStoryStatus?.(job, message),
            }
          );
        } catch (error) {
          log.error("pipeline", "scene repair failed", {
            jobId: job.id,
            runId: run.id,
            detail: error instanceof Error ? error.message : "unknown",
          });
          break;
        }
        const merged = mergeSceneRepair(screenplay, repaired.screenplay, targets);
        if (!merged) {
          log.error("pipeline", "scene repair returned an unusable merge", {
            jobId: job.id,
            runId: run.id,
            targets: targets.join(","),
          });
          break;
        }
        screenplay = merged;
        validation = validateEpisodeScreenplay({
          episodeNumber,
          seriesTitle,
          story: { title: generated.title, synopsis: generated.synopsis, screenplay },
          targetDurationSeconds: episodeTarget,
          bible: approvedBible?.content ?? null,
          seasonPlan: casna.plan,
          episodePlan: casna.episodePlan,
          ledger: casna.ledger,
          previousEpisodes: casna.previousEpisodes,
          canon: narrativeCanon,
          structure: generated.structure,
          sceneRange: project.sceneRange,
        });
        repairHistory.push({
          attempt: repairHistory.length + 1,
          sceneNumbers: targets,
          findingsBefore,
          findingsAfter: validation.findings.filter((finding) => finding.severity === "error").length,
          resolved: validation.passed,
          provider: repaired.provider,
          model: repaired.model,
        });
        log.info("pipeline", "scene repair applied", {
          jobId: job.id,
          runId: run.id,
          attempt: repairHistory.length,
          scenes: targets.join(","),
          passed: validation.passed,
        });
      }

      // Critic errors block the draft. Only a confirmed breach is treated as canon, and the critic does not write it.
      if (options.semanticCritique && options.llm.critiqueStory && casna && validation) {
        try {
          const critique = await options.llm.critiqueStory(
            {
              seriesTitle,
              episodeNumber,
              synopsis: generated.synopsis,
              screenplay,
              episodePlan: casna.episodePlan,
              seasonPlan: casnaPrompt?.seasonPlan ?? null,
              continuityLedger: casnaPrompt?.continuityLedger ?? null,
              bibleBrief: approvedBible?.content ? storyBibleBrief(approvedBible.content) : null,
            },
            {
              runId: run.id,
              jobId: job.id,
              onStatus: (message) => options.onStoryStatus?.(job, message),
            }
          );
          if (critique.findings.length > 0) {
            const adjudicated = adjudicateCriticFindings({
              canon: narrativeCanon,
              episode: episodeNumber,
              scenes: screenplay.map((scene) => ({
                sceneNumber: scene.sceneNumber,
                text: [
                  scene.heading,
                  scene.action,
                  scene.visualDescription,
                  ...scene.dialogue.map((line) => `${line.characterName}: ${line.line}`),
                ].join("\n"),
              })),
              findings: critique.findings,
            });
            const blocked = adjudicated.some((finding) => finding.severity === "error");
            validation = {
              ...validation,
              passed: validation.passed && !blocked,
              validatedAt: new Date().toISOString(),
              findings: [...validation.findings, ...adjudicated],
            };
          }
          log.info("pipeline", "continuity critique complete", {
            jobId: job.id,
            runId: run.id,
            findings: critique.findings.length,
            provider: critique.provider ?? "",
          });
        } catch (error) {
          log.error("pipeline", "continuity critique failed", {
            jobId: job.id,
            runId: run.id,
            detail: error instanceof Error ? error.message : "unknown",
          });
        }
      }

      log.info("pipeline", "story ready", {
        title: generated.title,
        scenes: screenplay.length,
        provider: trace.provider,
        model: trace.model,
        fallbackFrom: trace.fallbackFrom ?? "",
        hasSeasonPlan: Boolean(casna?.plan),
        hasLedger: Boolean(casna?.ledger),
        validationPassed: validation?.passed ?? null,
        validationErrors: validation?.findings.filter((finding) => finding.severity === "error").length ?? 0,
        repairRounds: repairHistory.length,
        canonVersion: narrativeCanon.version,
        canonCommitted: false,
        artifactsStale: false,
      });
      if (validation && !validation.passed) {
        const errors = validation.findings.filter((f) => f.severity === "error");
        const summary = errors.length > 0
          ? errors.map((e, i) => `${i + 1}. ${e.message}`).join("\n")
          : "The screenplay conflicts with approved canon.";
        throw new JobError(
          summary,
          "screenplay_conflict",
          false,
          {
            kind: "narrative_validation",
            findings: validation.findings,
            canonVersion: narrativeCanon.version,
            canonCommitted: false,
            artifactsStale: false,
          },
        );
      }
      const saved = await options.stories.upsertAwaiting({
        title: generated.title,
        synopsis: generated.synopsis,
        structure: generated.structure,
        screenplay,
        provider: trace.provider,
        model: trace.model,
        fallbackFrom: trace.fallbackFrom,
        clerkUserId: job.clerkUserId,
        projectId: project.id,
        productionRunId: run.id,
        episodeId: run.episode?.id ?? null,
        plan: casna?.episodePlan ?? null,
        validationFindings: validation,
        repairHistory,
        sourceCanonVersion: narrativeCanon.version,
      });
      return {
        title: saved.title,
        synopsis: saved.synopsis,
        storyId: saved.id,
        sourceCanonVersion: narrativeCanon.version,
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
  if (snapshot.content) {
    return `Approved Story Bible:\n${JSON.stringify(storyBibleBrief(snapshot.content))}`;
  }
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

/** A compact projection of the approved project-level story draft. */
function formatStoryDraft(draft: StoryRecord): string {
  const { act1, act2, act3 } = draft.structure;
  return [
    `Approved story draft: ${draft.title}`,
    `Synopsis: ${draft.synopsis}`,
    `Beginning: ${act1.initialSituation} ${act1.incitingIncident}`,
    `Turn: ${act2.turningPoint}`,
    `Intended outcome: ${act3.finalOutcome}`,
  ].join("\n");
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
