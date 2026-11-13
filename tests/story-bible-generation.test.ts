import { describe, expect, it, vi } from "vitest";
import { createStoryBibleEngine } from "@/lib/pipeline/storyBibleEngine";
import { JobError, type JobRecord } from "@/lib/pipeline/types";
import { StoryProviderManager, type ProviderSlot } from "@/lib/providers/llm/manager";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import { mergeStoryBibleResult, requestStoryBible, validateStoryBibleTaskResult, type StoryBibleTaskInput, type StoryBibleTaskTransport } from "@/lib/providers/llm/storyBibleTask";
import {
  storyBibleSectionsFingerprint,
  type StoryBibleSectionRun,
  type StoryBibleSectionsState,
} from "@/lib/providers/llm/storyBibleSections";
import type { LLMProvider, StoryBibleModelResult } from "@/lib/providers/llm/types";
import {
  STORY_BIBLE_SECTIONS,
  storyBibleContentSchema,
  type StoryBibleContent,
  type StoryBibleDraft,
  type StoryBibleRecord,
  type StoryBibleSection,
  type StoryBibleSnapshot,
} from "@/lib/validation/storyBible";

const content = storyBibleContentSchema.parse({
  identity: { title: "The Inheritance", genres: ["family drama"], subgenres: [], centralPremise: "Two sisters uncover a secret tied to their family home.", narrativeConcept: "A serialized family mystery.", toneAndAtmosphere: "Intimate and tense.", targetAudience: "Adults", centralConflict: "Truth threatens the family." },
  world: { description: "A contemporary coastal town.", geographyAndLocations: [{ name: "The House", description: "A weathered family home.", storyFunction: "The inheritance." }, { name: "Harbor", description: "A working harbor.", storyFunction: "The community." }], socialStructuresAndCultures: ["The town is close-knit."], historyAndPastEvents: ["The family built the harbor warehouse."], rules: ["The property cannot be sold while the trust is contested."], definingSystems: [] },
  characters: { characters: ["Mara", "Nia"].map((name) => ({ name, storyRole: "protagonist", roleDescription: "A sister", physicalDescription: "Unspecified", personality: "Guarded", background: "Raised in town", motivations: ["Protect family"], fearsAndWeaknesses: ["Losing trust"], abilitiesAndLimitations: ["Resourceful"], relationships: [], secrets: [], developmentPotential: "Learn to trust" })), relationshipDynamics: ["Love and resentment coexist."] },
  narrative: { mainStoryline: "The sisters investigate the trust.", majorConflicts: ["Family loyalty versus truth"], longTermDirection: "Reveal the family history over seasons.", subplots: [], unresolvedMysteries: ["Who altered the deed?"], potentialFutureRevelations: [], majorNarrativeQuestions: [], serializedEndingGuidance: "End seasons with a consequence, not a final resolution." },
  guidelines: { mainThemes: ["Family"], secondaryThemes: [], storytellingStyle: "Grounded", boundaries: ["Do not resolve the deed mystery in season one."], mustRemainConsistent: ["The house remains in the family trust."] },
  canon: { confirmedFacts: ["The trust controls the house."], proposedDetails: [], unresolvedQuestions: ["Who altered the deed?"], hiddenInformation: [], characterKnowledge: [], audienceKnowledge: [] },
});

const project: ProjectRecord = {
  id: "a".repeat(24), title: "The Inheritance", originalStoryIdea: "Two sisters inherit a house with a secret.", genre: "family", language: "en", visualStyle: "realistic", tone: "dramatic", targetDurationSeconds: 300, aspectRatio: "16:9", status: "draft", workflowMode: "guided", productionType: "fictional_drama", productionMode: "serialized", createdAt: "", updatedAt: "",
};

const jobInput = {
  operation: "generate" as const,
  expectedDraftRevision: 2,
  title: project.title,
  idea: project.originalStoryIdea,
  creativeDirection: "",
  instruction: "",
  freshInterpretation: false,
};

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "b".repeat(24), clerkUserId: "owner", projectId: project.id, runId: null, sceneNumber: null, jobType: "storyBible.generate", provider: "pending", model: "pending",
    input: { ...jobInput },
    output: null, status: "queued", progress: { stage: "storyBible.generate", message: "queued" }, attempts: 0, maxAttempts: 3, error: null, idempotencyKey: "key", bullJobId: null, startedAt: null, completedAt: null,
    ...overrides,
  };
}

function bible(overrides: Partial<StoryBibleRecord> = {}): StoryBibleRecord {
  return {
    premise: content.identity.centralPremise, worldRules: content.world.rules, themes: content.guidelines.mainThemes, boundaries: content.guidelines.boundaries, canonFacts: content.canon.confirmedFacts,
    content, sourceIdea: project.originalStoryIdea, creativeDirection: "", creatorDecisions: [], id: "c".repeat(24), clerkUserId: "owner", projectId: project.id,
    approvedVersion: 0, draftRevision: 2, basedOnStoryId: null, approvedSnapshot: null, approvedSnapshots: [], generationStatus: "queued", generationJobId: "b".repeat(24), generationError: null, createdAt: "", updatedAt: "", ...overrides,
  };
}

function approvedSnapshot(): StoryBibleSnapshot {
  return {
    premise: content.identity.centralPremise,
    worldRules: content.world.rules,
    themes: content.guidelines.mainThemes,
    boundaries: content.guidelines.boundaries,
    canonFacts: content.canon.confirmedFacts,
    content,
    sourceIdea: project.originalStoryIdea,
    creativeDirection: "",
    creatorDecisions: [],
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function sectionResult(section: StoryBibleSection, value: StoryBibleContent[StoryBibleSection] = content[section]): StoryBibleModelResult {
  return {
    result: { mode: "section", section, value },
    provider: "ollama",
    model: "gemma3:4b",
    fallbackFrom: null,
  };
}

function fakeProvider(
  handler: (input: StoryBibleTaskInput, call: number) => Promise<StoryBibleModelResult>
) {
  const calls: StoryBibleTaskInput[] = [];
  const provider = {
    id: "ollama",
    model: "gemma3:4b",
    generateStory: vi.fn(),
    generateCharacters: vi.fn(),
    generateScenes: vi.fn(),
    generateStoryBible: vi.fn(async (input: StoryBibleTaskInput) => {
      calls.push(input);
      return await handler(input, calls.length);
    }),
  } as unknown as LLMProvider;
  return { provider, calls };
}

type CompleteInput = { clerkUserId: string; projectId: string; jobId: string; expectedDraftRevision: number; draft: StoryBibleDraft };

function repoFor(record: StoryBibleRecord) {
  const complete = vi.fn(async (input: CompleteInput) => ({
    ...record,
    draftRevision: input.expectedDraftRevision + 1,
    generationStatus: "idle" as const,
  }));
  const fail = vi.fn(async () => undefined);
  return {
    complete,
    fail,
    repo: {
      findOwned: vi.fn(async () => record),
      markGenerationProcessing: vi.fn(async () => true),
      completeGeneration: complete,
      failGeneration: fail,
    },
  };
}

function cachedState(): StoryBibleSectionsState {
  const fingerprint = storyBibleSectionsFingerprint(
    {
      mode: "generate",
      title: project.title,
      idea: project.originalStoryIdea,
      creativeDirection: "",
      instruction: "",
      freshInterpretation: false,
      creatorDecisions: [],
      project: {
        productionType: project.productionType,
        productionMode: project.productionMode,
        genre: project.genre,
        language: project.language,
        tone: project.tone,
      },
    },
    { projectId: project.id, expectedDraftRevision: 2 }
  );
  const run = (section: StoryBibleSection): StoryBibleSectionRun => ({
    section, provider: "ollama", model: "gemma3:4b", fallbackFrom: null, durationMs: 1,
  });
  return {
    version: 1,
    fingerprint,
    sections: { identity: content.identity, world: content.world },
    runs: { identity: run("identity"), world: run("world") },
  };
}

describe("sectioned Story Bible generation", () => {
  it("develops all six sections with the local provider and saves one complete draft", async () => {
    const { provider, calls } = fakeProvider(async (input) => sectionResult(input.section!));
    const record = bible();
    const { repo, complete, fail } = repoFor(record);
    const progressCalls: Array<{ jobId: string; message: string; hasSections: boolean }> = [];
    const progress = vi.fn(async (job: JobRecord, message: string, output?: Record<string, unknown>) => {
      progressCalls.push({
        jobId: job.id,
        message,
        hasSections: Boolean((output?.storyBibleSections as { sections?: object } | undefined)?.sections),
      });
    });

    const output = await createStoryBibleEngine(provider, repo, progress).run(makeJob(), project);

    expect(calls.map((call) => call.section)).toEqual([...STORY_BIBLE_SECTIONS]);
    expect(calls.every((call) => call.mode === "section")).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    expect(fail).not.toHaveBeenCalled();
    expect(complete.mock.calls[0]?.[0].draft.content).toEqual(content);
    expect(progressCalls.at(-1)?.message).toBe("Story Bible: 6 of 6 sections ready");
    expect(progressCalls.at(-1)?.hasSections).toBe(true);
    expect(output).toMatchObject({ provider: "ollama", model: "gemma3:4b", draftRevision: 3 });
    const sections = (output as { sections?: Partial<Record<StoryBibleSection, StoryBibleSectionRun>> }).sections ?? {};
    expect(Object.keys(sections)).toEqual([...STORY_BIBLE_SECTIONS]);
    expect(sections.canon?.provider).toBe("ollama");
  });

  it("passes only compact, relevant earlier sections so a local prompt stays small", async () => {
    const { provider, calls } = fakeProvider(async (input) => sectionResult(input.section!));
    const { repo } = repoFor(bible());

    await createStoryBibleEngine(provider, repo).run(makeJob(), project);
    const bySection = new Map(calls.map((call) => [call.section, call]));

    expect(bySection.get("identity")?.contextSections).toEqual({});
    expect(Object.keys(bySection.get("world")?.contextSections ?? {})).toEqual(["identity"]);
    expect(Object.keys(bySection.get("characters")?.contextSections ?? {})).toEqual(["identity", "world"]);
    expect(Object.keys(bySection.get("canon")?.contextSections ?? {})).toEqual([
      "identity", "world", "characters", "narrative", "guidelines",
    ]);
    const canonContext = JSON.stringify(bySection.get("canon")?.contextSections);
    expect(canonContext.length).toBeLessThan(JSON.stringify(content).length);
    expect(canonContext).toContain("Mara");
    expect(canonContext).toContain("The House");
    expect(canonContext).not.toContain("confirmedFacts");
    expect(canonContext).not.toContain("abilitiesAndLimitations");
  });

  it("keeps the per-section provider fallback chain and records mixed providers", async () => {
    const ollamaSlot = {
      id: "ollama",
      model: "gemma3:4b",
      configured: true,
      timeoutMs: 10_000,
      generateStoryBible: vi.fn(async (input: StoryBibleTaskInput) => {
        if (input.section === "characters") {
          throw new JobError("Ollama is temporarily busy.", "provider_unavailable", true);
        }
        return { result: { mode: "section" as const, section: input.section!, value: content[input.section!] } };
      }),
    } as unknown as ProviderSlot;
    const groqSlot = {
      id: "groq",
      model: "llama-free",
      configured: true,
      timeoutMs: 10_000,
      generateStoryBible: vi.fn(async (input: StoryBibleTaskInput) => ({
        result: { mode: "section" as const, section: input.section!, value: content[input.section!] },
      })),
    } as unknown as ProviderSlot;
    const manager = new StoryProviderManager({
      slots: [ollamaSlot, groqSlot],
      freeOnly: true,
      sequenceTimeoutMs: 60_000,
      providerTimeoutMs: 10_000,
    });
    const { repo, complete } = repoFor(bible());

    const output = await createStoryBibleEngine(manager, repo).run(makeJob(), project);

    expect(complete).toHaveBeenCalledOnce();
    expect(output.provider).toBe("mixed");
    const sections = (output as { sections?: Partial<Record<StoryBibleSection, StoryBibleSectionRun>> }).sections ?? {};
    expect(sections.identity?.provider).toBe("ollama");
    expect(sections.characters?.provider).toBe("groq");
    expect(sections.characters?.fallbackFrom).toBe("ollama");
    expect(sections.narrative?.provider).toBe("ollama");
    expect(groqSlot.generateStoryBible).toHaveBeenCalledOnce();
  });

  it("preserves completed sections and never saves a partial draft when one section is invalid", async () => {
    const { provider } = fakeProvider(async (input) => {
      if (input.section === "characters") {
        return {
          result: { mode: "section", section: "characters", value: { characters: [], relationshipDynamics: [] } },
          provider: "ollama",
          model: "gemma3:4b",
        } as unknown as StoryBibleModelResult;
      }
      return sectionResult(input.section!);
    });
    const record = bible();
    const { repo, complete, fail } = repoFor(record);
    const job = makeJob();

    await expect(createStoryBibleEngine(provider, repo).run(job, project)).rejects.toThrow(
      "Characters section failed"
    );

    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
    const state = job.output?.storyBibleSections as StoryBibleSectionsState;
    expect(Object.keys(state.sections)).toEqual(["identity", "world"]);
    expect(state.failedSection).toBe("characters");
    expect(state.error?.code).toBe("invalid_schema");
  });

  it("resumes a retry from the sections that already passed", async () => {
    const { provider, calls } = fakeProvider(async (input) => sectionResult(input.section!));
    const { repo, complete } = repoFor(bible());
    const job = makeJob({ output: { storyBibleSections: cachedState() } });

    await createStoryBibleEngine(provider, repo).run(job, project);

    expect(calls.map((call) => call.section)).toEqual([
      "characters", "narrative", "guidelines", "canon",
    ]);
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]?.[0].draft.content).toEqual(content);
  });

  it("regenerates cached sections when the request no longer matches their fingerprint", async () => {
    const stale: StoryBibleSectionsState = {
      ...cachedState(),
      fingerprint: "stale-fingerprint",
      sections: { identity: content.identity, world: content.world, characters: content.characters },
      runs: {},
    };
    const { provider, calls } = fakeProvider(async (input) => sectionResult(input.section!));
    const { repo, complete } = repoFor(bible());
    const job = makeJob({ output: { storyBibleSections: stale } });

    await createStoryBibleEngine(provider, repo).run(job, project);

    expect(calls.map((call) => call.section)).toEqual([...STORY_BIBLE_SECTIONS]);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("retains completed sections and lets the job retry when every provider fails one section", async () => {
    const failing = (id: string) => ({
      id,
      model: `${id}-model`,
      configured: true,
      timeoutMs: 10_000,
      generateStoryBible: vi.fn(async (input: StoryBibleTaskInput) => {
        if (input.section === "characters") {
          throw new JobError(`${id} timed out.`, "timeout", true);
        }
        return { result: { mode: "section" as const, section: input.section!, value: content[input.section!] } };
      }),
    } as unknown as ProviderSlot);
    const manager = new StoryProviderManager({
      slots: [failing("ollama"), failing("groq")],
      sequenceTimeoutMs: 60_000,
      providerTimeoutMs: 10_000,
    });
    const { repo, complete, fail } = repoFor(bible());
    const job = makeJob();

    let caught: unknown;
    try {
      await createStoryBibleEngine(manager, repo).run(job, project);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(JobError);
    expect((caught as JobError).code).toBe("timeout");
    expect((caught as JobError).retryable).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
    const state = job.output?.storyBibleSections as StoryBibleSectionsState;
    expect(Object.keys(state.sections)).toEqual(["identity", "world"]);
    expect(state.failedSection).toBe("characters");
  });

  it("leaves the existing draft and approved snapshot untouched when generation fails", async () => {
    const snapshot = approvedSnapshot();
    const record = bible({ approvedVersion: 1, approvedSnapshot: snapshot });
    const before = structuredClone(record);
    const { provider } = fakeProvider(async () => {
      throw new JobError("The provider returned an invalid Story Bible section.", "invalid_schema", false);
    });
    const { repo, complete } = repoFor(record);

    await expect(createStoryBibleEngine(provider, repo).run(makeJob(), project)).rejects.toThrow("Identity section failed");

    expect(complete).not.toHaveBeenCalled();
    expect(record.content).toEqual(before.content);
    expect(record.approvedSnapshot).toEqual(before.approvedSnapshot);
    expect(record.approvedVersion).toBe(1);
    expect(record.draftRevision).toBe(2);
  });

  it("regenerates the whole bible while retaining approved canon unless a fresh interpretation is requested", async () => {
    const generated: StoryBibleContent = {
      ...content,
      identity: { ...content.identity, title: "Generated Title", centralPremise: "A generated premise." },
      world: { ...content.world, rules: ["A new rule from regeneration."] },
    };
    const { provider } = fakeProvider(async (input) => sectionResult(input.section!, generated[input.section!]));
    const record = bible({ approvedVersion: 1, approvedSnapshot: approvedSnapshot() });
    const { repo, complete } = repoFor(record);
    const job = makeJob({
      input: { ...jobInput, operation: "regenerate", title: "" },
    });

    await createStoryBibleEngine(provider, repo).run(job, project);

    const saved = complete.mock.calls[0]?.[0].draft.content;
    expect(saved?.identity.title).toBe("The Inheritance");
    expect(saved?.identity.centralPremise).toBe(content.identity.centralPremise);
    expect(saved?.world.rules).toEqual([
      "The property cannot be sold while the trust is contested.",
      "A new rule from regeneration.",
    ]);
    expect(record.approvedSnapshot).toEqual(approvedSnapshot());
  });

  it("keeps a fresh interpretation when the creator explicitly requests one", async () => {
    const generated: StoryBibleContent = {
      ...content,
      identity: { ...content.identity, title: "Generated Title", centralPremise: "A generated premise." },
    };
    const { provider } = fakeProvider(async (input) => sectionResult(input.section!, generated[input.section!]));
    const { repo, complete } = repoFor(bible({ approvedVersion: 1, approvedSnapshot: approvedSnapshot() }));
    const job = makeJob({
      input: { ...jobInput, operation: "regenerate", title: "", freshInterpretation: true },
    });

    await createStoryBibleEngine(provider, repo).run(job, project);

    const saved = complete.mock.calls[0]?.[0].draft.content;
    expect(saved?.identity.title).toBe("Generated Title");
    expect(saved?.identity.centralPremise).toBe("A generated premise.");
  });

  it("regenerates a single section against its sibling sections and preserves the rest", async () => {
    const updatedWorld = { ...content.world, description: "A rain-soaked coastal town shaped by a shipping strike." };
    const { provider, calls } = fakeProvider(async () => sectionResult("world", updatedWorld));
    const { repo, complete } = repoFor(bible());
    const job = makeJob({
      input: {
        operation: "section",
        expectedDraftRevision: 2,
        title: project.title,
        idea: project.originalStoryIdea,
        creativeDirection: "",
        instruction: "Make the harbor feel more dangerous.",
        section: "world",
        freshInterpretation: false,
      },
    });

    const output = await createStoryBibleEngine(provider, repo).run(job, project);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.section).toBe("world");
    expect(Object.keys(calls[0]?.current ?? {})).toEqual(["world"]);
    expect(Object.keys(calls[0]?.contextSections ?? {})).toEqual([
      "identity", "characters", "narrative", "guidelines", "canon",
    ]);
    const saved = complete.mock.calls[0]?.[0].draft.content;
    expect(saved?.world).toEqual(updatedWorld);
    expect(saved?.identity).toEqual(content.identity);
    expect(saved?.characters).toEqual(content.characters);
    expect(saved?.canon).toEqual(content.canon);
    expect(output).toMatchObject({ provider: "ollama", section: "world", draftRevision: 3 });
  });

  it("merges a section response without changing other sections", () => {
    const updatedWorld = { ...content.world, description: "A rain-soaked coastal town shaped by a shipping strike." };
    const result = mergeStoryBibleResult(content, { mode: "section", section: "world", value: updatedWorld });
    expect(result.world).toEqual(updatedWorld);
    expect(result.identity).toEqual(content.identity);
    expect(result.characters).toEqual(content.characters);
    expect(result.canon).toEqual(content.canon);
  });

  it("spells out the exact section keys for providers without schema enforcement", async () => {
    let prompt = "";
    const transport: StoryBibleTaskTransport = {
      label: "Groq",
      request: async (_system, text) => {
        prompt = text;
        return { text: JSON.stringify(content.world) };
      },
    };
    const result = await requestStoryBible(transport, {
      mode: "section",
      section: "world",
      title: project.title,
      idea: project.originalStoryIdea,
    });

    expect(result.result).toEqual({ mode: "section", section: "world", value: content.world });
    expect(prompt).toContain("geographyAndLocations");
    expect(prompt).toContain("socialStructuresAndCultures");
    expect(prompt).toContain("historyAndPastEvents");
    expect(prompt).toContain('"description"');
    expect(prompt).toContain("do not rename, replace, or omit");
  });

  it("rejects a stale generation lock before calling any provider", async () => {
    const { provider, calls } = fakeProvider(async (input) => sectionResult(input.section!));
    const record = bible({ draftRevision: 3 });
    const { repo } = repoFor(record);

    await expect(createStoryBibleEngine(provider, repo).run(makeJob(), project)).rejects.toThrow("stale");

    expect(calls).toHaveLength(0);
    expect(repo.markGenerationProcessing).not.toHaveBeenCalled();
  });

  it("rejects a section that contains JSON fragments instead of prose", () => {
    const task: StoryBibleTaskInput = { mode: "section", section: "identity", idea: "x" };
    const value = {
      ...content.identity,
      centralPremise: 'A family secret. ", "description": "A dilapidated pub in Saltwind Cove.',
    };

    expect(() => validateStoryBibleTaskResult(task, { mode: "section", section: "identity", value }))
      .toThrow(/corrupted JSON fragments/);
  });

  it("rejects a section with a repeated closing-brace run", () => {
    const task: StoryBibleTaskInput = { mode: "section", section: "identity", idea: "x" };
    const value = {
      ...content.identity,
      narrativeConcept: "A serialized family mystery. }  }  }  }  }",
    };

    expect(() => validateStoryBibleTaskResult(task, { mode: "section", section: "identity", value }))
      .toThrow(/corrupted JSON fragments/);
  });

  it("accepts a clean section response", () => {
    const task: StoryBibleTaskInput = { mode: "section", section: "identity", idea: "x" };

    expect(validateStoryBibleTaskResult(task, { mode: "section", section: "identity", value: content.identity }))
      .toMatchObject({ mode: "section", section: "identity" });
  });
});
