import { createHash } from "node:crypto";
import { log } from "@/lib/log";
import { JobError } from "@/lib/pipeline/types";
import {
  generatedStorySchema,
  type GeneratedStory,
  type ScreenplayScene,
} from "@/lib/validation/story";
import type {
  AttemptRecord,
  LLMProvider,
  StoryModelResult,
  StoryPrompt,
} from "@/lib/providers/llm/types";
import { resolveSceneRange, type SceneRange } from "@/lib/providers/llm/budget";

export const STORY_DRAFT_PARTS = [
  "opening",
  "inciting_incident",
  "investigation",
  "escalation",
  "climax",
  "resolution",
] as const;

export type StoryDraftPart = (typeof STORY_DRAFT_PARTS)[number];

export const STORY_DRAFT_PART_LABELS: Record<StoryDraftPart, string> = {
  opening: "Opening",
  inciting_incident: "Inciting Incident",
  investigation: "Investigation and Complications",
  escalation: "Escalation",
  climax: "Climax",
  resolution: "Resolution",
};

export const STORY_DRAFT_PART_OBJECTIVES: Record<StoryDraftPart, string> = {
  opening:
    "Establish the setting, introduce the protagonist, present the central situation, and deliver an initial hook.",
  inciting_incident:
    "Deliver the event that disrupts the status quo and establishes the central conflict.",
  investigation:
    "Develop the conflict through discoveries and complications. Increase tension as the protagonist pursues their goal.",
  escalation:
    "Deepen the mystery or conflict, expose contradictions, and increase the consequences of failure.",
  climax:
    "Build to the major confrontation, revelation, or decisive event that resolves the central conflict.",
  resolution:
    "Resolve the central movement, respect the intended ending, and leave serialized questions open.",
};

export type StoryDraftPartRun = {
  part: StoryDraftPart;
  provider: string;
  model: string;
  fallbackFrom: string | null;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type StoryDraftPartsState = {
  version: 1;
  fingerprint: string;
  parts: Partial<Record<StoryDraftPart, GeneratedStory>>;
  runs: Partial<Record<StoryDraftPart, StoryDraftPartRun>>;
  failedPart?: StoryDraftPart;
  error?: { code: string; message: string };
};

export type StoryDraftPartsScope = {
  projectId: string;
  operation: string;
  sourceBibleVersion?: number;
};

export type StoryDraftPartsResult = {
  story: GeneratedStory;
  state: StoryDraftPartsState;
  provider: string;
  model: string;
  fallbackFrom: string | null;
  attempts: AttemptRecord[];
};

const clip = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;

function isPart(value: string): value is StoryDraftPart {
  return (STORY_DRAFT_PARTS as readonly string[]).includes(value);
}

export function storyDraftPartsFingerprint(
  base: StoryPrompt,
  scope: StoryDraftPartsScope
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      projectId: scope.projectId,
      operation: scope.operation,
      sourceBibleVersion: scope.sourceBibleVersion ?? null,
      title: base.title,
      idea: base.idea,
      genre: base.genre,
      bibleContext: base.bibleContext ?? "",
      narrativeAuthority: base.narrativeAuthority ?? "",
      continuityContext: base.continuityContext ?? "",
    }))
    .digest("hex")
    .slice(0, 20);
}

export function parseStoryDraftPartsState(
  output: Record<string, unknown> | null | undefined
): StoryDraftPartsState | null {
  const raw = output?.storyDraftParts;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as {
    version?: unknown;
    fingerprint?: unknown;
    parts?: unknown;
    runs?: unknown;
    failedPart?: unknown;
    error?: unknown;
  };
  if (candidate.version !== 1 || typeof candidate.fingerprint !== "string") return null;
  if (!candidate.parts || typeof candidate.parts !== "object") return null;

  const parts: Partial<Record<StoryDraftPart, GeneratedStory>> = {};
  for (const part of STORY_DRAFT_PARTS) {
    const value = (candidate.parts as Record<string, unknown>)[part];
    if (value === undefined) continue;
    const parsed = generatedStorySchema.safeParse(value);
    if (parsed.success) parts[part] = parsed.data;
  }

  return {
    version: 1,
    fingerprint: candidate.fingerprint,
    parts,
    runs: candidate.runs && typeof candidate.runs === "object"
      ? candidate.runs as Partial<Record<StoryDraftPart, StoryDraftPartRun>>
      : {},
    ...(typeof candidate.failedPart === "string" && isPart(candidate.failedPart)
      ? { failedPart: candidate.failedPart }
      : {}),
    ...(candidate.error && typeof candidate.error === "object"
      ? { error: candidate.error as { code: string; message: string } }
      : {}),
  };
}

function summarizeScenes(scenes: ScreenplayScene[]): string {
  return scenes.map((scene) => {
    const chars = scene.charactersPresent.join(", ");
    return `Scene ${scene.sceneNumber}: ${scene.heading} [${chars}] — ${clip(scene.action, 150)}`;
  }).join("\n");
}

const COMPACT_BIBLE_CONTEXT_MAX = 5_000;
const COMPACT_NARRATIVE_AUTHORITY_MAX = 3_000;
const COMPACT_AUTHORITY_MAX = 6_000;

function buildPartPrompt(
  base: StoryPrompt,
  part: StoryDraftPart,
  index: number,
  total: number,
  previousScenes: ScreenplayScene[],
  sceneRange: SceneRange,
): StoryPrompt {
  const label = STORY_DRAFT_PART_LABELS[part];
  const objective = STORY_DRAFT_PART_OBJECTIVES[part];
  const partMin = Math.max(1, Math.floor(sceneRange.min / total));
  const partMax = Math.max(partMin + 1, Math.ceil(sceneRange.max / total));

  const lines: string[] = [
    `SEQUENTIAL STORY DRAFT — Part ${index + 1} of ${total}`,
    `Part: ${label}`,
    `Objective: ${objective}`,
    `Write ONLY the scenes for this part. Do not write scenes for other parts.`,
    `Write approximately ${partMin}–${partMax} scenes for this part.`,
  ];

  if (previousScenes.length > 0) {
    lines.push(
      `Previous parts have been written. Continue from where they left off.`,
      `Do not repeat scenes or events from previous parts.`,
      `Previous scenes:`,
      summarizeScenes(previousScenes),
    );
  }

  const partContext = lines.join("\n\n");

  const compact = index > 0;
  const bibleContext = compact && base.bibleContext
    ? clip(base.bibleContext, COMPACT_BIBLE_CONTEXT_MAX)
    : base.bibleContext;
  const narrativeAuthority = compact && base.narrativeAuthority
    ? clip(base.narrativeAuthority, COMPACT_NARRATIVE_AUTHORITY_MAX)
    : base.narrativeAuthority;
  const authority = compact && base.authority
    ? clip(base.authority, COMPACT_AUTHORITY_MAX)
    : base.authority;

  return {
    ...base,
    bibleContext,
    narrativeAuthority,
    authority,
    continuityContext: [base.continuityContext, partContext].filter(Boolean).join("\n\n"),
  };
}

function collectPreviousScenes(parts: Partial<Record<StoryDraftPart, GeneratedStory>>): ScreenplayScene[] {
  const scenes: ScreenplayScene[] = [];
  for (const part of STORY_DRAFT_PARTS) {
    const story = parts[part];
    if (story) scenes.push(...story.screenplay);
  }
  return scenes;
}

function mergeParts(parts: Partial<Record<StoryDraftPart, GeneratedStory>>): GeneratedStory {
  const opening = parts.opening;
  const inciting = parts.inciting_incident;
  const investigation = parts.investigation;
  const escalation = parts.escalation;
  const climax = parts.climax;
  const resolution = parts.resolution;

  if (!opening || !inciting || !investigation || !escalation || !climax || !resolution) {
    throw new JobError("Cannot merge incomplete story draft parts.", "invalid_schema", false);
  }

  const title = opening.title;
  const synopsis = clip(
    [opening, inciting, investigation, escalation, climax, resolution]
      .map((p) => p.synopsis)
      .join(" "),
    2000,
  );

  const structure = {
    act1: {
      introduction: opening.structure.act1.introduction,
      mainCharacters: opening.structure.act1.mainCharacters,
      setting: opening.structure.act1.setting,
      initialSituation: opening.structure.act1.initialSituation,
      incitingIncident: inciting.structure.act1.incitingIncident,
    },
    act2: {
      risingTension: investigation.structure.act2.risingTension,
      obstacles: investigation.structure.act2.obstacles,
      characterDecisions: investigation.structure.act2.characterDecisions,
      turningPoint: escalation.structure.act2.turningPoint,
    },
    act3: {
      climax: climax.structure.act3.climax,
      resolution: resolution.structure.act3.resolution,
      finalOutcome: resolution.structure.act3.finalOutcome,
    },
  };

  const allScenes = [opening, inciting, investigation, escalation, climax, resolution]
    .flatMap((p) => p.screenplay);
  const screenplay = allScenes.slice(0, 40).map((scene, i) => ({
    ...scene,
    sceneNumber: i + 1,
  }));

  const merged = { title, synopsis, structure, screenplay };
  const validated = generatedStorySchema.safeParse(merged);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    throw new JobError(
      `The merged story draft is invalid: ${issue?.path.join(".") || "unknown field"}.`,
      "invalid_schema",
      false,
    );
  }
  return validated.data;
}

export function progressMessage(state: StoryDraftPartsState): string {
  const done = Object.keys(state.parts).length;
  if (state.failedPart) {
    return `Story Draft: ${STORY_DRAFT_PART_LABELS[state.failedPart]} part failed; ${done} of ${STORY_DRAFT_PARTS.length} parts preserved`;
  }
  return `Story Draft: ${done} of ${STORY_DRAFT_PARTS.length} parts ready`;
}

export type GenerateStoryDraftPartsOptions = {
  jobId: string;
  scope: StoryDraftPartsScope;
  cached?: StoryDraftPartsState | null;
  sceneRange?: SceneRange | null;
  onStatus?: (message: string) => void | Promise<void>;
  onProgress?: (state: StoryDraftPartsState) => void | Promise<void>;
  signal?: AbortSignal;
  checkCancellation?: () => Promise<boolean>;
};

async function persistProgress(
  options: GenerateStoryDraftPartsOptions,
  state: StoryDraftPartsState,
): Promise<void> {
  try {
    await options.onProgress?.(state);
  } catch (error) {
    log.error("story-draft", "part progress persistence failed", {
      jobId: options.jobId,
      detail: error instanceof Error ? error.message : "unknown",
    });
  }
}

const CANCELLATION_POLL_MS = 5_000;

export async function generateStoryDraftParts(
  llm: LLMProvider,
  base: StoryPrompt,
  options: GenerateStoryDraftPartsOptions,
): Promise<StoryDraftPartsResult> {
  const fingerprint = storyDraftPartsFingerprint(base, options.scope);
  const cached = options.cached?.fingerprint === fingerprint ? options.cached : null;
  const state: StoryDraftPartsState = {
    version: 1,
    fingerprint,
    parts: cached ? { ...cached.parts } : {},
    runs: cached ? { ...cached.runs } : {},
  };

  const sceneRange = options.sceneRange
    ? resolveSceneRange(base.targetDurationSeconds, options.sceneRange)
    : resolveSceneRange(base.targetDurationSeconds, base.sceneRange);

  let preferredProvider: string | undefined;
  for (const part of STORY_DRAFT_PARTS) {
    const run = state.runs[part];
    if (run?.provider && run.provider !== "unknown" && run.provider !== "mixed") {
      preferredProvider = run.provider;
      break;
    }
  }

  const controller = new AbortController();
  const interval = options.checkCancellation
    ? setInterval(() => {
        void options.checkCancellation!().then((cancelled) => {
          if (cancelled) controller.abort();
        }).catch(() => { /* ignore polling errors */ });
      }, CANCELLATION_POLL_MS)
    : null;

  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    for (let index = 0; index < STORY_DRAFT_PARTS.length; index += 1) {
      const part = STORY_DRAFT_PARTS[index]!;
      if (state.parts[part] !== undefined) continue;

      if (controller.signal.aborted) {
        state.failedPart = part;
        state.error = { code: "cancelled", message: "Story draft generation was cancelled." };
        await persistProgress(options, state);
        throw new JobError("Story draft generation was cancelled.", "cancelled", false);
      }

      if (options.checkCancellation) {
        try {
          if (await options.checkCancellation()) {
            controller.abort();
            state.failedPart = part;
            state.error = { code: "cancelled", message: "Story draft generation was cancelled." };
            await persistProgress(options, state);
            throw new JobError("Story draft generation was cancelled.", "cancelled", false);
          }
        } catch (error) {
          if (error instanceof JobError && error.code === "cancelled") throw error;
        }
      }

      const label = STORY_DRAFT_PART_LABELS[part];
      await options.onStatus?.(`Story Draft: writing ${label} (${index + 1}/${STORY_DRAFT_PARTS.length})`);

      const previousScenes = collectPreviousScenes(state.parts);
      const prompt = buildPartPrompt(base, part, index, STORY_DRAFT_PARTS.length, previousScenes, sceneRange);

      const started = Date.now();
      log.info("story-draft", "part started", {
        jobId: options.jobId,
        part,
        order: `${index + 1}/${STORY_DRAFT_PARTS.length}`,
      });

      try {
        const generated: StoryModelResult = await llm.generateStory(prompt, {
          jobId: options.jobId,
          signal: controller.signal,
          onStatus: options.onStatus,
          preferredProvider,
        });

        state.parts[part] = {
          title: generated.title,
          synopsis: generated.synopsis,
          structure: generated.structure,
          screenplay: generated.screenplay,
        };
        state.runs[part] = {
          part,
          provider: generated.provider ?? "unknown",
          model: generated.model ?? "unknown",
          fallbackFrom: generated.fallbackFrom ?? null,
          durationMs: Date.now() - started,
          ...(generated.usage?.inputTokens !== undefined ? { inputTokens: generated.usage.inputTokens } : {}),
          ...(generated.usage?.outputTokens !== undefined ? { outputTokens: generated.usage.outputTokens } : {}),
        };
        if (generated.provider && generated.provider !== "unknown" && generated.provider !== "mixed") {
          preferredProvider = generated.provider;
        }
        delete state.failedPart;
        delete state.error;
        log.info("story-draft", "part completed", {
          jobId: options.jobId,
          part,
          provider: state.runs[part]?.provider,
          model: state.runs[part]?.model,
          fallbackFrom: state.runs[part]?.fallbackFrom ?? "none",
          ms: state.runs[part]?.durationMs,
          outputTokens: state.runs[part]?.outputTokens ?? "",
        });
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          state.failedPart = part;
          state.error = { code: "cancelled", message: "Story draft generation was cancelled." };
          await persistProgress(options, state);
          throw new JobError("Story draft generation was cancelled.", "cancelled", false);
        }
        const failure = error instanceof JobError
          ? error
          : new JobError(`The ${label.toLowerCase()} part could not be generated.`, "part_failed", true);
        state.failedPart = part;
        state.error = { code: failure.code, message: failure.message };
        log.error("story-draft", "part failed", {
          jobId: options.jobId,
          part,
          code: failure.code,
          retryable: failure.retryable,
          completedParts: Object.keys(state.parts).length,
          ms: Date.now() - started,
        });
        await persistProgress(options, state);
        throw new JobError(`${label} part failed: ${failure.message}`, failure.code, failure.retryable);
      }
      await persistProgress(options, state);
    }

    const story = mergeParts(state.parts);
    const runs = Object.values(state.runs).filter(Boolean) as StoryDraftPartRun[];
    const providers = [...new Set(runs.map((r) => r.provider))];
    const models = [...new Set(runs.map((r) => r.model))];
    const allAttempts: AttemptRecord[] = [];
    for (const run of runs) {
      allAttempts.push({
        provider: run.provider,
        model: run.model,
        durationMs: run.durationMs,
        success: true,
        category: "story_draft_part",
        httpStatus: null,
        ...(run.inputTokens !== undefined ? { inputTokens: run.inputTokens } : {}),
        ...(run.outputTokens !== undefined ? { outputTokens: run.outputTokens } : {}),
        fallback: run.fallbackFrom !== null,
      });
    }
    return {
      story,
      state,
      provider: providers.length === 1 ? providers[0]! : providers.length > 1 ? "mixed" : "unknown",
      model: models.length === 1 ? models[0]! : models.length > 1 ? "mixed" : "unknown",
      fallbackFrom: runs.find((r) => r.fallbackFrom)?.fallbackFrom ?? null,
      attempts: allAttempts,
    };
  } finally {
    if (interval) clearInterval(interval);
  }
}