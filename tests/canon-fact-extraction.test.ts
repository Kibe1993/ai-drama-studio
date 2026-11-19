import { describe, it, expect, vi } from "vitest";
import { InMemoryCanonFactStore } from "@/lib/canon/inMemoryStore";
import type { CanonFactEntry, DerivedCanonState } from "@/lib/canon/schema";
import { createCanonFactExtractionService } from "@/lib/services/canonFactExtractionService";
import { createCanonExtractionDispatcher } from "@/lib/services/canonExtractionDispatcher";
import type { StoryRecord } from "@/lib/validation/story";
import type { ScreenplayScene } from "@/lib/validation/story";
import type { EpisodeRecord } from "@/lib/validation/episode";
import type { CanonExtractionIssueRecord } from "@/lib/repositories/storyRepository";
import type { ExtractedFact } from "@/lib/validation/canonExtractionResult";

const CLERK = "user-1";
const PROJECT = "proj-1";
const EPISODE_ID = "ep-1";
const STORY_ID = "story-1";
const JOB_ID = "job-1";

function makeScene(overrides: Partial<ScreenplayScene> = {}): ScreenplayScene {
  return {
    sceneNumber: 1,
    heading: "INT. LIVING ROOM - DAY",
    location: "Living Room",
    timeOfDay: "Day",
    charactersPresent: ["ALICE"],
    visualDescription: "Alice sits on the couch.",
    action: "Alice picks up a photo.",
    dialogue: [{ characterName: "ALICE", line: "I remember this day." }],
    ...overrides,
  };
}

function makeStory(overrides: Partial<StoryRecord> = {}): StoryRecord {
  return {
    title: "Test Story",
    synopsis: "A test story.",
    structure: {
      act1: {
        introduction: "Intro",
        mainCharacters: "Alice",
        setting: "Living room",
        initialSituation: "Alice is home",
        incitingIncident: "She finds a photo",
      },
      act2: {
        risingTension: "Tension",
        obstacles: "Obstacles",
        characterDecisions: "Decisions",
        turningPoint: "Turning point",
      },
      act3: {
        climax: "Climax",
        resolution: "Resolution",
        finalOutcome: "Outcome",
      },
    },
    screenplay: [makeScene()],
    id: STORY_ID,
    clerkUserId: CLERK,
    projectId: PROJECT,
    productionRunId: "run-1",
    episodeId: EPISODE_ID,
    status: "approved",
    version: 1,
    provider: "test",
    model: "test",
    fallbackFrom: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEpisode(overrides: Partial<EpisodeRecord> = {}): EpisodeRecord {
  return {
    id: EPISODE_ID,
    clerkUserId: CLERK,
    projectId: PROJECT,
    episodeNumber: 1,
    title: "Episode 1",
    premise: "",
    targetDurationSeconds: 180,
    status: "story_approved",
    currentStoryId: STORY_ID,
    baseSnapshotVersion: 0,
    basePlanVersion: 0,
    timelineId: null,
    renderAssetId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeExtractedFact(overrides: Partial<ExtractedFact> = {}): ExtractedFact {
  return {
    kind: "entity",
    targetId: "char-alice",
    payload: {
      id: "char-alice",
      kind: "character",
      name: "Alice",
      aliases: [],
      description: "The protagonist.",
      role: "protagonist",
      motivations: [],
      goals: [],
      firstIntroductionEpisode: 1,
      firstAppearanceEpisode: 1,
      appearances: [1],
      lifecycle: "active",
      arc: "",
      secrets: [],
      permitsNonlivingAppearance: false,
      endedEpisode: null,
      ownerId: null,
      locationId: null,
      properties: [],
      significance: "",
      transfers: [],
      modifications: [],
      locationRules: [],
    },
    narrativeMode: "present",
    eventType: "concrete",
    confidence: 0.9,
    quote: "Alice picks up a photo.",
    sceneNumber: 1,
    asserterId: null,
    reason: "Alice is introduced.",
    ...overrides,
  };
}

type CanonPort = {
  appendBatch(input: {
    clerkUserId: string;
    projectId: string;
    expectedSequence: number;
    commitBatchId: string;
    entries: Omit<CanonFactEntry, "sequence" | "projectId" | "createdAt" | "commitBatchId">[];
    fencing?: { projectId: string; jobId: string; fencingToken: number };
  }): Promise<CanonFactEntry[]>;
  getLatestSequence(clerkUserId: string, projectId: string): Promise<number>;
  latestState(clerkUserId: string, projectId: string, mode?: "strict" | "migration"): Promise<DerivedCanonState>;
};

function wrapInMemoryStore(store: InMemoryCanonFactStore): CanonPort {
  return {
    async appendBatch(input) {
      return store.appendBatch(input);
    },
    async getLatestSequence(_clerkUserId, projectId) {
      return store.getLatestSequence(projectId);
    },
    async latestState(_clerkUserId, projectId, mode) {
      return store.latestState(projectId, mode);
    },
  };
}

type MockLockPort = {
  acquire: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  renew: ReturnType<typeof vi.fn>;
};

function makeMockLockPort(store?: InMemoryCanonFactStore): MockLockPort {
  let currentToken = 0;
  return {
    acquire: vi.fn(async (_input: { clerkUserId: string; projectId: string; jobId: string }) => {
      currentToken += 1;
      if (store) {
        store.setLock(_input.projectId, {
          jobId: _input.jobId,
          fencingToken: currentToken,
          expiresAt: new Date(Date.now() + 60_000),
        });
      }
      return { acquired: true as const, fencingToken: currentToken };
    }),
    release: vi.fn(async (input: { clerkUserId: string; projectId: string; jobId: string }) => {
      if (store) {
        store.clearLock(input.projectId);
      }
    }),
    renew: vi.fn(async () => {
      return { renewed: true as const, fencingToken: currentToken };
    }),
  };
}

type MockOutboxPort = {
  enqueue: ReturnType<typeof vi.fn>;
  markCompleted: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
  claimPending: ReturnType<typeof vi.fn>;
  findPending: ReturnType<typeof vi.fn>;
};

function makeMockOutboxPort(): MockOutboxPort {
  return {
    enqueue: vi.fn(async () => ({ enqueued: true as const })),
    markCompleted: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    claimPending: vi.fn(async () => []),
    findPending: vi.fn(async () => []),
  };
}

type MockStoryPort = {
  findOwned: ReturnType<typeof vi.fn>;
  saveCanonExtractionIssues: ReturnType<typeof vi.fn>;
  getCanonExtractionIssues: ReturnType<typeof vi.fn>;
  updateIssueStatus: ReturnType<typeof vi.fn>;
};

function makeMockStoryPort(story: StoryRecord, issues: CanonExtractionIssueRecord[] = []): MockStoryPort {
  return {
    findOwned: vi.fn(async () => story),
    saveCanonExtractionIssues: vi.fn(async () => story),
    getCanonExtractionIssues: vi.fn(async () => issues),
    updateIssueStatus: vi.fn(async () => null),
  };
}

type MockEpisodePort = {
  findOwned: ReturnType<typeof vi.fn>;
  updateCanonExtractionStatus: ReturnType<typeof vi.fn>;
  findApprovedWithoutExtraction: ReturnType<typeof vi.fn>;
  findExtractionProcessing: ReturnType<typeof vi.fn>;
};

function makeMockEpisodePort(episode: EpisodeRecord): MockEpisodePort {
  return {
    findOwned: vi.fn(async () => episode),
    updateCanonExtractionStatus: vi.fn(async () => episode),
    findApprovedWithoutExtraction: vi.fn(async () => []),
    findExtractionProcessing: vi.fn(async () => []),
  };
}

function makeLLMPort(facts: ExtractedFact[] = []) {
  return {
    request: vi.fn(async () => ({
      text: JSON.stringify({ facts }),
    })),
  };
}

describe("canonFactExtractionService", () => {
  describe("extractAndCommit", () => {
    it("commits facts from LLM extraction", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = makeLLMPort([makeExtractedFact()]);
      const locks = makeMockLockPort(store);
      const stories = makeMockStoryPort(story);
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(
        llm, stories, episodes, canon, locks,
      );

      const result = await service.extractAndCommit({
        clerkUserId: CLERK,
        projectId: PROJECT,
        episodeId: EPISODE_ID,
        storyId: STORY_ID,
        episodeNumber: 1,
        jobId: JOB_ID,
      });

      expect(result.committed).toBe(1);
      expect(result.issues).toBe(0);
      expect(result.status).toBe("canon_committed");
      expect(store.list(PROJECT)).toHaveLength(1);
    });

    it("records issue when quote not found in scene", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = makeLLMPort([
        makeExtractedFact({ quote: "This text does not appear anywhere." }),
      ]);
      const locks = makeMockLockPort(store);
      const stories = makeMockStoryPort(story);
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(
        llm, stories, episodes, canon, locks,
      );

      const result = await service.extractAndCommit({
        clerkUserId: CLERK,
        projectId: PROJECT,
        episodeId: EPISODE_ID,
        storyId: STORY_ID,
        episodeNumber: 1,
        jobId: JOB_ID,
      });

      expect(result.committed).toBe(0);
      expect(result.issues).toBe(1);
      expect(result.status).toBe("canon_committed_with_issues");
      expect(stories.saveCanonExtractionIssues).toHaveBeenCalled();
    });

    it("records issue when scene not found", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = makeLLMPort([
        makeExtractedFact({ sceneNumber: 99 }),
      ]);
      const locks = makeMockLockPort(store);
      const stories = makeMockStoryPort(story);
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(
        llm, stories, episodes, canon, locks,
      );

      const result = await service.extractAndCommit({
        clerkUserId: CLERK,
        projectId: PROJECT,
        episodeId: EPISODE_ID,
        storyId: STORY_ID,
        episodeNumber: 1,
        jobId: JOB_ID,
      });

      expect(result.issues).toBe(1);
      expect(result.status).toBe("canon_committed_with_issues");
    });

    it("fails when story is not approved", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory({ status: "awaiting_approval" });
      const episode = makeEpisode();
      const llm = makeLLMPort();
      const locks = makeMockLockPort(store);
      const stories = makeMockStoryPort(story);
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(
        llm, stories, episodes, canon, locks,
      );

      await expect(
        service.extractAndCommit({
          clerkUserId: CLERK,
          projectId: PROJECT,
          episodeId: EPISODE_ID,
          storyId: STORY_ID,
          episodeNumber: 1,
          jobId: JOB_ID,
        }),
      ).rejects.toThrow();
    });

    it("returns extraction_failed when LLM fails", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = {
        request: vi.fn(async () => {
          throw new Error("LLM unavailable");
        }),
      };
      const locks = makeMockLockPort(store);
      const stories = makeMockStoryPort(story);
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(
        llm, stories, episodes, canon, locks,
      );

      const result = await service.extractAndCommit({
        clerkUserId: CLERK,
        projectId: PROJECT,
        episodeId: EPISODE_ID,
        storyId: STORY_ID,
        episodeNumber: 1,
        jobId: JOB_ID,
      });

      expect(result.status).toBe("extraction_failed");
      expect(result.committed).toBe(0);
    });

    it("returns extraction_failed when LLM returns invalid JSON", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = {
        request: vi.fn(async () => ({ text: "not json" })),
      };
      const locks = makeMockLockPort(store);
      const stories = makeMockStoryPort(story);
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(
        llm, stories, episodes, canon, locks,
      );

      const result = await service.extractAndCommit({
        clerkUserId: CLERK,
        projectId: PROJECT,
        episodeId: EPISODE_ID,
        storyId: STORY_ID,
        episodeNumber: 1,
        jobId: JOB_ID,
      });

      expect(result.status).toBe("extraction_failed");
    });

    it("handles empty extraction result", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = makeLLMPort([]);
      const locks = makeMockLockPort(store);
      const stories = makeMockStoryPort(story);
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(
        llm, stories, episodes, canon, locks,
      );

      const result = await service.extractAndCommit({
        clerkUserId: CLERK,
        projectId: PROJECT,
        episodeId: EPISODE_ID,
        storyId: STORY_ID,
        episodeNumber: 1,
        jobId: JOB_ID,
      });

      expect(result.committed).toBe(0);
      expect(result.issues).toBe(0);
      expect(result.status).toBe("canon_committed");
    });

    it("throws when lock cannot be acquired", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = makeLLMPort([makeExtractedFact()]);
      const locks = makeMockLockPort(store);
      locks.acquire.mockResolvedValueOnce({ acquired: false });

      const stories = makeMockStoryPort(story);
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(
        llm, stories, episodes, canon, locks,
      );

      await expect(
        service.extractAndCommit({
          clerkUserId: CLERK,
          projectId: PROJECT,
          episodeId: EPISODE_ID,
          storyId: STORY_ID,
          episodeNumber: 1,
          jobId: JOB_ID,
        }),
      ).rejects.toThrow();
    });

    it("dialogue facts are classified as character_statement + not_established", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = makeLLMPort([
        makeExtractedFact({
          kind: "fact",
          targetId: "f-memory",
          payload: {
            id: "f-memory",
            key: "alice-memory",
            statement: "Alice remembers this day.",
            classification: "CHARACTER_KNOWLEDGE",
            protected: false,
            audienceRevealEpisode: null,
          },
          quote: "I remember this day.",
          eventType: "concrete",
        }),
      ]);
      const locks = makeMockLockPort(store);
      const stories = makeMockStoryPort(story);
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(
        llm, stories, episodes, canon, locks,
      );

      const result = await service.extractAndCommit({
        clerkUserId: CLERK,
        projectId: PROJECT,
        episodeId: EPISODE_ID,
        storyId: STORY_ID,
        episodeNumber: 1,
        jobId: JOB_ID,
      });

      expect(result.committed).toBe(1);
      const entries = store.list(PROJECT);
      expect(entries[0]!.assertionKind).toBe("character_statement");
      expect(entries[0]!.factualStatus).toBe("not_established");
    });

    it("releases lock after extraction", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = makeLLMPort([makeExtractedFact()]);
      const locks = makeMockLockPort(store);
      const stories = makeMockStoryPort(story);
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(
        llm, stories, episodes, canon, locks,
      );

      await service.extractAndCommit({
        clerkUserId: CLERK,
        projectId: PROJECT,
        episodeId: EPISODE_ID,
        storyId: STORY_ID,
        episodeNumber: 1,
        jobId: JOB_ID,
      });

      expect(locks.release).toHaveBeenCalledWith({
        clerkUserId: CLERK,
        projectId: PROJECT,
        jobId: JOB_ID,
      });
    });
  });

  describe("resolveIssue", () => {
    it("rejects an issue without committing", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = makeLLMPort();
      const locks = makeMockLockPort(store);


      const issue: CanonExtractionIssueRecord = {
        factId: "issue-1",
        code: "test",
        message: "test issue",
        fact: {
          id: "issue-1",
          episode: 1,
          sourceStoryId: STORY_ID,
          kind: "entity",
          targetId: "char-bob",
          payload: { id: "char-bob", kind: "character", name: "Bob" },
          evidence: {
            quote: "test",
            sceneNumber: 1,
            episode: 1,
            episodeId: EPISODE_ID,
            storyId: STORY_ID,
            storyVersion: 1,
            sourceHash: "hash",
          },
          narrativeMode: "present",
          assertionKind: "event",
          factualStatus: "established",
          asserterId: null,
          reason: "test",
          extractor: "test",
          evidencePosition: 0,
          sceneNumber: 1,
        },
        status: "pending_review",
        resolvedAt: null,
      };

      const stories = makeMockStoryPort(story, [issue]);
      stories.updateIssueStatus = vi.fn(async () => ({
        ...issue,
        status: "rejected",
        resolvedAt: new Date().toISOString(),
      }));
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(
        llm, stories, episodes, canon, locks,
      );

      const result = await service.resolveIssue({
        clerkUserId: CLERK,
        projectId: PROJECT,
        storyId: STORY_ID,
        episodeId: EPISODE_ID,
        episodeNumber: 1,
        issueId: "issue-1",
        decision: "rejected",
        jobId: JOB_ID,
      });

      expect(result.resolved).toBe(true);
      expect(store.list(PROJECT)).toHaveLength(0);
    });

    it("returns false for non-existent issue", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = makeLLMPort();
      const locks = makeMockLockPort(store);

      const stories = makeMockStoryPort(story, []);
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(
        llm, stories, episodes, canon, locks,
      );

      const result = await service.resolveIssue({
        clerkUserId: CLERK,
        projectId: PROJECT,
        storyId: STORY_ID,
        episodeId: EPISODE_ID,
        episodeNumber: 1,
        issueId: "non-existent",
        decision: "accepted",
        jobId: JOB_ID,
      });

      expect(result.resolved).toBe(false);
    });
  });
});

describe("canonExtractionDispatcher", () => {
  function makeExtractionPort() {
    return {
      extractAndCommit: vi.fn(async () => ({
        committed: 1,
        issues: 0,
        status: "canon_committed",
      })),
    };
  }

  it("reconcileCrashes enqueues outbox for approved episodes without extraction", async () => {
    const extraction = makeExtractionPort();
    const episode = makeEpisode();
    const story = makeStory();

    const episodes = {
      findOwned: vi.fn(async () => episode),
      updateCanonExtractionStatus: vi.fn(async () => episode),
      findApprovedWithoutExtraction: vi.fn(async () => [episode]),
      findExtractionProcessing: vi.fn(async () => []),
    };
    const stories = {
      findOwned: vi.fn(async () => story),
    };
    const outbox = makeMockOutboxPort();

    const dispatcher = createCanonExtractionDispatcher(
      extraction, episodes, stories, outbox,
    );

    const result = await dispatcher.reconcileCrashes({
      clerkUserId: CLERK,
      projectId: PROJECT,
    });

    expect(result.enqueued).toBe(1);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it("reconcileCrashes enqueues outbox for orphaned processing episodes", async () => {
    const extraction = makeExtractionPort();
    const episode = makeEpisode();
    const story = makeStory();

    const episodes = {
      findOwned: vi.fn(async () => episode),
      updateCanonExtractionStatus: vi.fn(async () => episode),
      findApprovedWithoutExtraction: vi.fn(async () => []),
      findExtractionProcessing: vi.fn(async () => [episode]),
    };
    const stories = {
      findOwned: vi.fn(async () => story),
    };
    const outbox = makeMockOutboxPort();

    const dispatcher = createCanonExtractionDispatcher(
      extraction, episodes, stories, outbox,
    );

    const result = await dispatcher.reconcileCrashes({
      clerkUserId: CLERK,
      projectId: PROJECT,
    });

    expect(result.enqueued).toBe(1);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it("dispatchPending processes claimed outbox events", async () => {
    const extraction = makeExtractionPort();
    const episode = makeEpisode();

    const episodes = {
      findOwned: vi.fn(async () => episode),
      updateCanonExtractionStatus: vi.fn(async () => episode),
      findApprovedWithoutExtraction: vi.fn(async () => []),
      findExtractionProcessing: vi.fn(async () => []),
    };
    const stories = {
      findOwned: vi.fn(async () => makeStory()),
    };
    const outbox = makeMockOutboxPort();
    outbox.claimPending = vi.fn(async () => [
      {
        _id: "outbox-1" as never,
        clerkUserId: CLERK,
        projectId: PROJECT,
        episodeId: EPISODE_ID,
        storyId: STORY_ID,
        commitBatchId: "batch-1",
        status: "dispatched",
        error: null,
        createdAt: new Date(),
        dispatchedAt: new Date(),
        completedAt: null,
      },
    ]);

    const dispatcher = createCanonExtractionDispatcher(
      extraction, episodes, stories, outbox,
    );

    const result = await dispatcher.dispatchPending({
      clerkUserId: CLERK,
    });

    expect(result.dispatched).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(extraction.extractAndCommit).toHaveBeenCalledTimes(1);
    expect(outbox.markCompleted).toHaveBeenCalledTimes(1);
  });

  it("dispatchPending marks failed on extraction error", async () => {
    const extraction = {
      extractAndCommit: vi.fn(async () => {
        throw new Error("Extraction failed");
      }),
    };
    const episode = makeEpisode();

    const episodes = {
      findOwned: vi.fn(async () => episode),
      updateCanonExtractionStatus: vi.fn(async () => episode),
      findApprovedWithoutExtraction: vi.fn(async () => []),
      findExtractionProcessing: vi.fn(async () => []),
    };
    const stories = {
      findOwned: vi.fn(async () => makeStory()),
    };
    const outbox = makeMockOutboxPort();
    outbox.claimPending = vi.fn(async () => [
      {
        _id: "outbox-1" as never,
        clerkUserId: CLERK,
        projectId: PROJECT,
        episodeId: EPISODE_ID,
        storyId: STORY_ID,
        commitBatchId: "batch-1",
        status: "dispatched",
        error: null,
        createdAt: new Date(),
        dispatchedAt: new Date(),
        completedAt: null,
      },
    ]);

    const dispatcher = createCanonExtractionDispatcher(
      extraction, episodes, stories, outbox,
    );

    const result = await dispatcher.dispatchPending({
      clerkUserId: CLERK,
    });

    expect(result.dispatched).toBe(1);
    expect(result.failed).toBe(1);
    expect(outbox.markFailed).toHaveBeenCalledTimes(1);
  });

  it("run combines reconcile and dispatch", async () => {
    const extraction = makeExtractionPort();
    const episode = makeEpisode();
    const story = makeStory();

    const episodes = {
      findOwned: vi.fn(async () => episode),
      updateCanonExtractionStatus: vi.fn(async () => episode),
      findApprovedWithoutExtraction: vi.fn(async () => [episode]),
      findExtractionProcessing: vi.fn(async () => []),
    };
    const stories = {
      findOwned: vi.fn(async () => story),
    };
    const outbox = makeMockOutboxPort();

    const dispatcher = createCanonExtractionDispatcher(
      extraction, episodes, stories, outbox,
    );

    const result = await dispatcher.run({
      clerkUserId: CLERK,
      projectId: PROJECT,
    });

    expect(result.enqueued).toBe(1);
    expect(result.dispatched).toBe(0);
  });
});