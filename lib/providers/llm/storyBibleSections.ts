import { createHash } from "node:crypto";
import { log } from "@/lib/log";
import { JobError } from "@/lib/pipeline/types";
import {
  STORY_BIBLE_SECTIONS,
  storyBibleContentSchema,
  type StoryBibleContent,
  type StoryBibleSection,
} from "@/lib/validation/storyBible";
import {
  storyBibleSectionSchema,
  validateStoryBibleTaskResult,
  type StoryBibleTaskInput,
} from "@/lib/providers/llm/storyBibleTask";
import type { LLMProvider } from "@/lib/providers/llm/types";

export const STORY_BIBLE_SECTION_LABELS: Record<StoryBibleSection, string> = {
  identity: "Identity",
  world: "World",
  characters: "Characters",
  narrative: "Narrative",
  guidelines: "Guidelines",
  canon: "Canon",
};

// A single slow local section must not consume the whole fallback chain, but a
// 4B model on CPU can legitimately need several minutes for characters or canon.
// The budget also covers earlier cloud attempts when Ollama is the last slot, so
// a 3-cloud worst case still leaves Ollama its full per-attempt timeout.
export const STORY_BIBLE_SECTION_SEQUENCE_TIMEOUT_MS = 900_000;

export type StoryBibleSectionRun = {
  section: StoryBibleSection;
  provider: string;
  model: string;
  fallbackFrom: string | null;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type StoryBibleSectionsState = {
  version: 1;
  fingerprint: string;
  sections: Partial<StoryBibleContent>;
  runs: Partial<Record<StoryBibleSection, StoryBibleSectionRun>>;
  failedSection?: StoryBibleSection;
  error?: { code: string; message: string };
};

export type StoryBibleSectionsScope = {
  projectId: string;
  expectedDraftRevision: number;
};

export type StoryBibleSectionsResult = {
  content: StoryBibleContent;
  state: StoryBibleSectionsState;
};

type LooseSection = Record<string, unknown>;

const clip = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;

const clipList = (items: string[], maxItems: number, maxChars: number): string[] =>
  items.slice(0, maxItems).map((item) => clip(item, maxChars));

function isSection(value: string): value is StoryBibleSection {
  return (STORY_BIBLE_SECTIONS as readonly string[]).includes(value);
}

export function storyBibleSectionsFingerprint(
  base: StoryBibleTaskInput,
  scope: StoryBibleSectionsScope
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      projectId: scope.projectId,
      expectedDraftRevision: scope.expectedDraftRevision,
      mode: base.mode,
      title: base.title ?? "",
      idea: base.idea,
      creativeDirection: base.creativeDirection ?? "",
      instruction: base.instruction ?? "",
      freshInterpretation: Boolean(base.freshInterpretation),
      project: base.project ?? null,
    }))
    .digest("hex")
    .slice(0, 20);
}

function identityBrief(identity: StoryBibleContent["identity"]): LooseSection {
  return {
    title: identity.title,
    genres: identity.genres,
    subgenres: identity.subgenres.slice(0, 4),
    centralPremise: clip(identity.centralPremise, 900),
    narrativeConcept: clip(identity.narrativeConcept, 700),
    toneAndAtmosphere: clip(identity.toneAndAtmosphere, 400),
    targetAudience: clip(identity.targetAudience, 200),
    centralConflict: clip(identity.centralConflict, 700),
  };
}

function worldBrief(world: StoryBibleContent["world"]): LooseSection {
  return {
    description: clip(world.description, 900),
    geographyAndLocations: world.geographyAndLocations.map((location) => ({
      name: location.name,
      description: clip(location.description, 250),
      storyFunction: clip(location.storyFunction, 180),
    })),
    socialStructuresAndCultures: clipList(world.socialStructuresAndCultures, 10, 250),
    historyAndPastEvents: clipList(world.historyAndPastEvents, 12, 250),
    rules: clipList(world.rules, 16, 300),
    definingSystems: world.definingSystems.map((system) => ({
      name: system.name,
      description: clip(system.description, 300),
      limitations: clipList(system.limitations, 8, 180),
      consequences: clipList(system.consequences, 8, 180),
    })),
  };
}

function charactersBrief(characters: StoryBibleContent["characters"]): LooseSection {
  return {
    characters: characters.characters.map((character) => ({
      name: character.name,
      storyRole: character.storyRole,
      roleDescription: clip(character.roleDescription, 220),
      personality: clip(character.personality, 260),
      motivations: clipList(character.motivations, 8, 160),
      fearsAndWeaknesses: clipList(character.fearsAndWeaknesses, 8, 160),
      relationships: character.relationships.map((relationship) => ({
        characterName: relationship.characterName,
        relationship: clip(relationship.relationship, 120),
        tensionOrChange: clip(relationship.tensionOrChange, 120),
      })),
    })),
    relationshipDynamics: clipList(characters.relationshipDynamics, 12, 220),
  };
}

function narrativeBrief(narrative: StoryBibleContent["narrative"]): LooseSection {
  return {
    mainStoryline: clip(narrative.mainStoryline, 1200),
    majorConflicts: clipList(narrative.majorConflicts, 10, 300),
    longTermDirection: clip(narrative.longTermDirection, 800),
    subplots: clipList(narrative.subplots, 10, 250),
    unresolvedMysteries: clipList(narrative.unresolvedMysteries, 10, 220),
    potentialFutureRevelations: clipList(narrative.potentialFutureRevelations, 10, 220),
    majorNarrativeQuestions: clipList(narrative.majorNarrativeQuestions, 10, 200),
    serializedEndingGuidance: clip(narrative.serializedEndingGuidance, 400),
  };
}

function guidelinesBrief(guidelines: StoryBibleContent["guidelines"]): LooseSection {
  return {
    mainThemes: clipList(guidelines.mainThemes, 8, 200),
    secondaryThemes: clipList(guidelines.secondaryThemes, 10, 200),
    storytellingStyle: clip(guidelines.storytellingStyle, 500),
    boundaries: clipList(guidelines.boundaries, 16, 250),
    mustRemainConsistent: clipList(guidelines.mustRemainConsistent, 20, 250),
  };
}

function canonBrief(canon: StoryBibleContent["canon"]): LooseSection {
  return {
    confirmedFacts: clipList(canon.confirmedFacts, 40, 300),
    proposedDetails: clipList(canon.proposedDetails, 30, 250),
    unresolvedQuestions: clipList(canon.unresolvedQuestions, 20, 220),
    hiddenInformation: clipList(canon.hiddenInformation, 16, 250),
    characterKnowledge: canon.characterKnowledge.map((knowledge) => ({
      characterName: knowledge.characterName,
      knows: clipList(knowledge.knows, 10, 180),
      believes: clipList(knowledge.believes, 10, 150),
    })),
    audienceKnowledge: clipList(canon.audienceKnowledge, 20, 220),
  };
}

/**
 * Builds a compact, section-specific view of the bible so a local model never
 * receives the whole document. "prior" follows the canonical generation order;
 * "siblings" is used for a section revision so every other section can act as a
 * consistency check without re-sending their full text.
 */
export function storyBibleSectionContext(
  section: StoryBibleSection,
  sections: Partial<StoryBibleContent>,
  mode: "prior" | "siblings" = "prior"
): Partial<Record<StoryBibleSection, unknown>> {
  const sectionIndex = STORY_BIBLE_SECTIONS.indexOf(section);
  const include = (candidate: StoryBibleSection) =>
    candidate !== section &&
    (mode === "siblings" || STORY_BIBLE_SECTIONS.indexOf(candidate) < sectionIndex);
  const context: Partial<Record<StoryBibleSection, unknown>> = {};
  if (include("identity") && sections.identity) context.identity = identityBrief(sections.identity);
  if (include("world") && sections.world) context.world = worldBrief(sections.world);
  if (include("characters") && sections.characters) context.characters = charactersBrief(sections.characters);
  if (include("narrative") && sections.narrative) context.narrative = narrativeBrief(sections.narrative);
  if (include("guidelines") && sections.guidelines) context.guidelines = guidelinesBrief(sections.guidelines);
  if (include("canon") && sections.canon) context.canon = canonBrief(sections.canon);
  return context;
}

/**
 * Compact view of every available section for consumers that need the whole
 * bible at a glance (for example an episode suggestion) without receiving the
 * full document.
 */
export function storyBibleBrief(sections: Partial<StoryBibleContent>): Partial<Record<StoryBibleSection, unknown>> {
  const context: Partial<Record<StoryBibleSection, unknown>> = {};
  if (sections.identity) context.identity = identityBrief(sections.identity);
  if (sections.world) context.world = worldBrief(sections.world);
  if (sections.characters) context.characters = charactersBrief(sections.characters);
  if (sections.narrative) context.narrative = narrativeBrief(sections.narrative);
  if (sections.guidelines) context.guidelines = guidelinesBrief(sections.guidelines);
  if (sections.canon) context.canon = canonBrief(sections.canon);
  return context;
}

function joinList(items: unknown): string | undefined {
  if (!Array.isArray(items) || items.length === 0) return undefined;
  return items.join("; ");
}

/**
 * Renders the Story Bible brief as readable text for inclusion in an LLM
 * generation prompt.  Each section is labelled so the model can distinguish
 * creative direction (characters, world, narrative, guidelines) from formal
 * canon (confirmed facts, character knowledge, audience knowledge).
 *
 * Returns `undefined` when no sections are available, so callers can omit the
 * field entirely instead of sending an empty string.
 */
export function renderStoryBibleBrief(sections: Partial<StoryBibleContent>): string | undefined {
  const brief = storyBibleBrief(sections);
  const parts: string[] = [];

  if (brief.identity) {
    const id = brief.identity as Record<string, unknown>;
    const lines: string[] = ["[IDENTITY]"];
    if (id.title) lines.push(`Title: ${id.title}`);
    const genres = joinList(id.genres);
    if (genres) lines.push(`Genres: ${genres}`);
    if (typeof id.centralPremise === "string" && id.centralPremise) lines.push(`Central premise: ${id.centralPremise}`);
    if (typeof id.narrativeConcept === "string" && id.narrativeConcept) lines.push(`Narrative concept: ${id.narrativeConcept}`);
    if (typeof id.toneAndAtmosphere === "string" && id.toneAndAtmosphere) lines.push(`Tone: ${id.toneAndAtmosphere}`);
    if (typeof id.centralConflict === "string" && id.centralConflict) lines.push(`Central conflict: ${id.centralConflict}`);
    parts.push(lines.join("\n"));
  }

  if (brief.world) {
    const w = brief.world as Record<string, unknown>;
    const lines: string[] = ["[WORLD]"];
    if (typeof w.description === "string" && w.description) lines.push(`Description: ${w.description}`);
    if (Array.isArray(w.geographyAndLocations) && w.geographyAndLocations.length) {
      lines.push("Locations:");
      for (const loc of w.geographyAndLocations) {
        const l = loc as Record<string, unknown>;
        const fn = typeof l.storyFunction === "string" && l.storyFunction ? ` (${l.storyFunction})` : "";
        lines.push(`- ${l.name}: ${l.description}${fn}`);
      }
    }
    const cultures = joinList(w.socialStructuresAndCultures);
    if (cultures) lines.push(`Cultures: ${cultures}`);
    const history = joinList(w.historyAndPastEvents);
    if (history) lines.push(`History: ${history}`);
    const rules = joinList(w.rules);
    if (rules) lines.push(`Rules: ${rules}`);
    if (Array.isArray(w.definingSystems) && w.definingSystems.length) {
      lines.push("Systems:");
      for (const sys of w.definingSystems) {
        const s = sys as Record<string, unknown>;
        lines.push(`- ${s.name}: ${s.description}`);
        const lim = joinList(s.limitations);
        if (lim) lines.push(`  Limitations: ${lim}`);
        const con = joinList(s.consequences);
        if (con) lines.push(`  Consequences: ${con}`);
      }
    }
    parts.push(lines.join("\n"));
  }

  if (brief.characters) {
    const ch = brief.characters as Record<string, unknown>;
    const lines: string[] = ["[CHARACTERS]"];
    if (Array.isArray(ch.characters)) {
      for (const c of ch.characters) {
        const char = c as Record<string, unknown>;
        lines.push(`- ${char.name} (${char.storyRole}): ${char.roleDescription}`);
        if (typeof char.personality === "string" && char.personality) lines.push(`  Personality: ${char.personality}`);
        const mot = joinList(char.motivations);
        if (mot) lines.push(`  Motivations: ${mot}`);
        const fears = joinList(char.fearsAndWeaknesses);
        if (fears) lines.push(`  Fears: ${fears}`);
        if (Array.isArray(char.relationships) && char.relationships.length) {
          for (const r of char.relationships) {
            const rel = r as Record<string, unknown>;
            const tension = typeof rel.tensionOrChange === "string" && rel.tensionOrChange ? ` (tension: ${rel.tensionOrChange})` : "";
            lines.push(`  -> ${rel.characterName}: ${rel.relationship}${tension}`);
          }
        }
      }
    }
    const dynamics = joinList(ch.relationshipDynamics);
    if (dynamics) lines.push(`Relationship dynamics: ${dynamics}`);
    parts.push(lines.join("\n"));
  }

  if (brief.narrative) {
    const n = brief.narrative as Record<string, unknown>;
    const lines: string[] = ["[NARRATIVE]"];
    if (typeof n.mainStoryline === "string" && n.mainStoryline) lines.push(`Main storyline: ${n.mainStoryline}`);
    const conflicts = joinList(n.majorConflicts);
    if (conflicts) lines.push(`Major conflicts: ${conflicts}`);
    if (typeof n.longTermDirection === "string" && n.longTermDirection) lines.push(`Long-term direction: ${n.longTermDirection}`);
    const subplots = joinList(n.subplots);
    if (subplots) lines.push(`Subplots: ${subplots}`);
    const mysteries = joinList(n.unresolvedMysteries);
    if (mysteries) lines.push(`Unresolved mysteries: ${mysteries}`);
    const futureRevelations = joinList(n.potentialFutureRevelations);
    if (futureRevelations) lines.push(`Potential future revelations: ${futureRevelations}`);
    const questions = joinList(n.majorNarrativeQuestions);
    if (questions) lines.push(`Major narrative questions: ${questions}`);
    if (typeof n.serializedEndingGuidance === "string" && n.serializedEndingGuidance) lines.push(`Ending guidance: ${n.serializedEndingGuidance}`);
    parts.push(lines.join("\n"));
  }

  if (brief.guidelines) {
    const g = brief.guidelines as Record<string, unknown>;
    const lines: string[] = ["[GUIDELINES]"];
    const themes = joinList(g.mainThemes);
    if (themes) lines.push(`Main themes: ${themes}`);
    const secondaryThemes = joinList(g.secondaryThemes);
    if (secondaryThemes) lines.push(`Secondary themes: ${secondaryThemes}`);
    if (typeof g.storytellingStyle === "string" && g.storytellingStyle) lines.push(`Storytelling style: ${g.storytellingStyle}`);
    const boundaries = joinList(g.boundaries);
    if (boundaries) lines.push(`Boundaries: ${boundaries}`);
    const consistent = joinList(g.mustRemainConsistent);
    if (consistent) lines.push(`Must remain consistent: ${consistent}`);
    parts.push(lines.join("\n"));
  }

  if (brief.canon) {
    const c = brief.canon as Record<string, unknown>;
    const lines: string[] = ["[CANON]"];
    const facts = joinList(c.confirmedFacts);
    if (facts) lines.push(`Confirmed facts: ${facts}`);
    const hidden = joinList(c.hiddenInformation);
    if (hidden) lines.push(`Hidden information (not yet revealed to audience): ${hidden}`);
    const proposed = joinList(c.proposedDetails);
    if (proposed) lines.push(`Proposed details (provisional, not canon): ${proposed}`);
    const unresolved = joinList(c.unresolvedQuestions);
    if (unresolved) lines.push(`Unresolved questions: ${unresolved}`);
    if (Array.isArray(c.characterKnowledge) && c.characterKnowledge.length) {
      lines.push("Character knowledge:");
      for (const ck of c.characterKnowledge) {
        const k = ck as Record<string, unknown>;
        const knows = joinList(k.knows) ?? "";
        const believes = joinList(k.believes);
        lines.push(`- ${k.characterName}: knows ${knows}${believes ? `; believes ${believes}` : ""}`);
      }
    }
    const audience = joinList(c.audienceKnowledge);
    if (audience) lines.push(`Audience knowledge: ${audience}`);
    parts.push(lines.join("\n"));
  }

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function buildStoryBibleSectionTask(
  base: StoryBibleTaskInput,
  section: StoryBibleSection,
  options: {
    sections: Partial<StoryBibleContent>;
    contextMode?: "prior" | "siblings";
    current?: Partial<Record<StoryBibleSection, unknown>>;
    approved?: Partial<Record<StoryBibleSection, unknown>>;
  }
): StoryBibleTaskInput {
  return {
    ...base,
    mode: "section",
    section,
    current: options.current,
    approved: options.approved,
    contextSections: storyBibleSectionContext(section, options.sections, options.contextMode ?? "prior"),
    creatorDecisions: (base.creatorDecisions ?? []).slice(-8).map((decision) => clip(decision, 300)),
  };
}

export function parseStoryBibleSectionsState(
  output: Record<string, unknown> | null | undefined
): StoryBibleSectionsState | null {
  const raw = output?.storyBibleSections;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as {
    version?: unknown;
    fingerprint?: unknown;
    sections?: unknown;
    runs?: unknown;
    failedSection?: unknown;
    error?: unknown;
  };
  if (candidate.version !== 1 || typeof candidate.fingerprint !== "string") return null;
  if (!candidate.sections || typeof candidate.sections !== "object") return null;

  const sections: Partial<StoryBibleContent> = {};
  for (const section of STORY_BIBLE_SECTIONS) {
    const value = (candidate.sections as Record<string, unknown>)[section];
    if (value === undefined) continue;
    const parsed = storyBibleSectionSchema(section).safeParse(value);
    if (parsed.success) (sections as Record<string, unknown>)[section] = parsed.data;
  }

  return {
    version: 1,
    fingerprint: candidate.fingerprint,
    sections,
    runs: candidate.runs && typeof candidate.runs === "object"
      ? candidate.runs as Partial<Record<StoryBibleSection, StoryBibleSectionRun>>
      : {},
    ...(typeof candidate.failedSection === "string" && isSection(candidate.failedSection)
      ? { failedSection: candidate.failedSection }
      : {}),
    ...(candidate.error && typeof candidate.error === "object"
      ? { error: candidate.error as { code: string; message: string } }
      : {}),
  };
}

async function persistProgress(
  options: GenerateStoryBibleSectionsOptions,
  state: StoryBibleSectionsState
): Promise<void> {
  try {
    await options.onProgress?.(state);
  } catch (error) {
    log.error("story-bible", "section progress persistence failed", {
      jobId: options.jobId,
      detail: error instanceof Error ? error.message : "unknown",
    });
  }
}

export type GenerateStoryBibleSectionsOptions = {
  jobId: string;
  scope: StoryBibleSectionsScope;
  cached?: StoryBibleSectionsState | null;
  current?: StoryBibleContent | null;
  approved?: StoryBibleContent | null;
  includeCurrent?: boolean;
  includeApproved?: boolean;
  contextMode?: "prior" | "siblings";
  onStatus?: (message: string) => void | Promise<void>;
  onProgress?: (state: StoryBibleSectionsState) => void | Promise<void>;
  signal?: AbortSignal;
};

export async function generateStoryBibleSections(
  llm: LLMProvider,
  base: StoryBibleTaskInput,
  options: GenerateStoryBibleSectionsOptions
): Promise<StoryBibleSectionsResult> {
  if (!llm.generateStoryBible) {
    throw new JobError("No configured AI provider can develop a Story Bible.", "configuration", false);
  }
  const fingerprint = storyBibleSectionsFingerprint(base, options.scope);
  const cached = options.cached?.fingerprint === fingerprint ? options.cached : null;
  const state: StoryBibleSectionsState = {
    version: 1,
    fingerprint,
    sections: cached ? { ...cached.sections } : {},
    runs: cached ? { ...cached.runs } : {},
  };

  for (let index = 0; index < STORY_BIBLE_SECTIONS.length; index += 1) {
    const section = STORY_BIBLE_SECTIONS[index]!;
    if (state.sections[section] !== undefined) continue;
    const label = STORY_BIBLE_SECTION_LABELS[section];
    await options.onStatus?.(`Developing Story Bible: ${label} (${index + 1}/${STORY_BIBLE_SECTIONS.length})`);

    const task = buildStoryBibleSectionTask(base, section, {
      sections: state.sections,
      contextMode: options.contextMode ?? "prior",
      current: options.includeCurrent && options.current?.[section] !== undefined
        ? { [section]: options.current[section] }
        : undefined,
      approved: options.includeApproved && options.approved?.[section] !== undefined
        ? { [section]: options.approved[section] }
        : undefined,
    });

    const started = Date.now();
    log.info("story-bible", "section started", {
      jobId: options.jobId,
      section,
      order: `${index + 1}/${STORY_BIBLE_SECTIONS.length}`,
    });

    try {
      const generated = await llm.generateStoryBible(task, {
        jobId: options.jobId,
        signal: options.signal,
        onStatus: options.onStatus,
        sequenceTimeoutMs: STORY_BIBLE_SECTION_SEQUENCE_TIMEOUT_MS,
      });
      const validated = validateStoryBibleTaskResult(task, generated.result);
      if (validated.mode !== "section" || validated.section !== section) {
        throw new JobError("The provider returned the wrong Story Bible section.", "invalid_schema", false);
      }
      Object.assign(state.sections, { [section]: validated.value });
      state.runs[section] = {
        section,
        provider: generated.provider ?? "unknown",
        model: generated.model ?? "unknown",
        fallbackFrom: generated.fallbackFrom ?? null,
        durationMs: Date.now() - started,
        ...(generated.usage?.inputTokens !== undefined ? { inputTokens: generated.usage.inputTokens } : {}),
        ...(generated.usage?.outputTokens !== undefined ? { outputTokens: generated.usage.outputTokens } : {}),
      };
      delete state.failedSection;
      delete state.error;
      log.info("story-bible", "section completed", {
        jobId: options.jobId,
        section,
        provider: state.runs[section]?.provider,
        model: state.runs[section]?.model,
        fallbackFrom: state.runs[section]?.fallbackFrom ?? "none",
        ms: state.runs[section]?.durationMs,
        outputTokens: state.runs[section]?.outputTokens ?? "",
      });
    } catch (error) {
      const failure = error instanceof JobError
        ? error
        : new JobError(`The ${label.toLowerCase()} section could not be generated.`, "section_failed", true);
      state.failedSection = section;
      state.error = { code: failure.code, message: failure.message };
      log.error("story-bible", "section failed", {
        jobId: options.jobId,
        section,
        code: failure.code,
        retryable: failure.retryable,
        completedSections: Object.keys(state.sections).length,
        ms: Date.now() - started,
      });
      await persistProgress(options, state);
      throw new JobError(`${label} section failed: ${failure.message}`, failure.code, failure.retryable);
    }
    await persistProgress(options, state);
  }

  const content = storyBibleContentSchema.safeParse(state.sections);
  if (!content.success) {
    const issue = content.error.issues[0];
    throw new JobError(
      `The assembled Story Bible is incomplete: ${issue?.path.join(".") || "unknown field"}.`,
      "invalid_schema",
      false
    );
  }
  return { content: content.data, state };
}
