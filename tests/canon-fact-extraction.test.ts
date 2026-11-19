import { describe, it, expect, vi } from "vitest";
import { InMemoryCanonFactStore } from "@/lib/canon/inMemoryStore";
import type { CanonFactEntry, DerivedCanonState } from "@/lib/canon/schema";
import { createCanonFactExtractionService } from "@/lib/services/canonFactExtractionService";
import { createCanonExtractionDispatcher } from "@/lib/services/canonExtractionDispatcher";
import { makeCanonFactLLMPort, liveCanonExtractionDispatcher } from "@/lib/pipeline/live";
import { compareCanonShadow } from "@/lib/domain/canonShadowComparison";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
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
  claimPendingGlobal: ReturnType<typeof vi.fn>;
  findPending: ReturnType<typeof vi.fn>;
};

function makeMockOutboxPort(): MockOutboxPort {
  return {
    enqueue: vi.fn(async () => ({ enqueued: true as const })),
    markCompleted: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    claimPending: vi.fn(async () => []),
    claimPendingGlobal: vi.fn(async () => []),
    findPending: vi.fn(async () => []),
  };
}

type MockStoryPort = {
  findOwned: ReturnType<typeof vi.fn>;
  saveCanonExtractionIssues: ReturnType<typeof vi.fn>;
  getCanonExtractionIssues: ReturnType<typeof vi.fn>;
  updateIssueStatus: ReturnType<typeof vi.fn>;
  claimIssue: ReturnType<typeof vi.fn>;
  finalizeIssue: ReturnType<typeof vi.fn>;
  rollbackIssue: ReturnType<typeof vi.fn>;
};

function makeMockStoryPort(story: StoryRecord, issues: CanonExtractionIssueRecord[] = []): MockStoryPort {
  return {
    findOwned: vi.fn(async () => story),
    saveCanonExtractionIssues: vi.fn(async () => story),
    getCanonExtractionIssues: vi.fn(async () => issues),
    updateIssueStatus: vi.fn(async () => null),
    claimIssue: vi.fn(async () => null),
    finalizeIssue: vi.fn(async () => null),
    rollbackIssue: vi.fn(async () => null),
  };
}

type MockEpisodePort = {
  findOwned: ReturnType<typeof vi.fn>;
  updateCanonExtractionStatus: ReturnType<typeof vi.fn>;
  findApprovedWithoutExtraction: ReturnType<typeof vi.fn>;
  findExtractionProcessing: ReturnType<typeof vi.fn>;
  findAllExtractionCandidates: ReturnType<typeof vi.fn>;
};

function makeMockEpisodePort(episode: EpisodeRecord): MockEpisodePort {
  return {
    findOwned: vi.fn(async () => episode),
    updateCanonExtractionStatus: vi.fn(async () => episode),
    findApprovedWithoutExtraction: vi.fn(async () => []),
    findExtractionProcessing: vi.fn(async () => []),
    findAllExtractionCandidates: vi.fn(async () => []),
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

    function makeIssue(overrides: Partial<CanonExtractionIssueRecord> = {}): CanonExtractionIssueRecord {
      return {
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
        ...overrides,
      };
    }

    it("successful accepted resolution commits fact and finalizes issue", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = makeLLMPort();
      const locks = makeMockLockPort(store);
      const issue = makeIssue();

      const stories = makeMockStoryPort(story, [issue]);
      stories.claimIssue = vi.fn(async () => ({ ...issue, status: "accepting" }));
      stories.finalizeIssue = vi.fn(async () => ({ ...issue, status: "accepted", resolvedAt: new Date().toISOString() }));
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(llm, stories, episodes, canon, locks);

      const result = await service.resolveIssue({
        clerkUserId: CLERK, projectId: PROJECT, storyId: STORY_ID,
        episodeId: EPISODE_ID, episodeNumber: 1, issueId: "issue-1",
        decision: "accepted", jobId: JOB_ID,
      });

      expect(result.resolved).toBe(true);
      expect(stories.claimIssue).toHaveBeenCalledTimes(1);
      expect(stories.finalizeIssue).toHaveBeenCalledTimes(1);
      expect(stories.rollbackIssue).not.toHaveBeenCalled();
      expect(store.list(PROJECT)).toHaveLength(1);
    });

    it("two workers: second worker fails to claim when first holds the issue", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = makeLLMPort();
      const locks = makeMockLockPort(store);
      const issue = makeIssue();

      const stories = makeMockStoryPort(story, [issue]);
      stories.claimIssue = vi.fn(async () => null);
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(llm, stories, episodes, canon, locks);

      const result = await service.resolveIssue({
        clerkUserId: CLERK, projectId: PROJECT, storyId: STORY_ID,
        episodeId: EPISODE_ID, episodeNumber: 1, issueId: "issue-1",
        decision: "accepted", jobId: JOB_ID,
      });

      expect(result.resolved).toBe(false);
      expect(stories.finalizeIssue).not.toHaveBeenCalled();
      expect(store.list(PROJECT)).toHaveLength(0);
    });

    it("fact insertion failure rolls back issue to pending_review", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = makeLLMPort();
      const locks = makeMockLockPort(store);
      const issue = makeIssue();

      const stories = makeMockStoryPort(story, [issue]);
      stories.claimIssue = vi.fn(async () => ({ ...issue, status: "accepting" }));
      stories.rollbackIssue = vi.fn(async () => ({ ...issue, status: "pending_review" }));

      const failingCanon: CanonPort = {
        ...canon,
        async appendBatch() {
          throw new Error("Database connection lost");
        },
      };
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(llm, stories, episodes, failingCanon, locks);

      await expect(
        service.resolveIssue({
          clerkUserId: CLERK, projectId: PROJECT, storyId: STORY_ID,
          episodeId: EPISODE_ID, episodeNumber: 1, issueId: "issue-1",
          decision: "accepted", jobId: JOB_ID,
        }),
      ).rejects.toThrow("Database connection lost");

      expect(stories.rollbackIssue).toHaveBeenCalledTimes(1);
      expect(stories.finalizeIssue).not.toHaveBeenCalled();
      expect(store.list(PROJECT)).toHaveLength(0);
    });

    it("finalize failure returns false but fact remains committed", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = makeLLMPort();
      const locks = makeMockLockPort(store);
      const issue = makeIssue();

      const stories = makeMockStoryPort(story, [issue]);
      stories.claimIssue = vi.fn(async () => ({ ...issue, status: "accepting" }));
      stories.finalizeIssue = vi.fn(async () => null);
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(llm, stories, episodes, canon, locks);

      const result = await service.resolveIssue({
        clerkUserId: CLERK, projectId: PROJECT, storyId: STORY_ID,
        episodeId: EPISODE_ID, episodeNumber: 1, issueId: "issue-1",
        decision: "accepted", jobId: JOB_ID,
      });

      expect(result.resolved).toBe(false);
      expect(stories.claimIssue).toHaveBeenCalledTimes(1);
      expect(stories.finalizeIssue).toHaveBeenCalledTimes(1);
      expect(stories.rollbackIssue).not.toHaveBeenCalled();
      expect(store.list(PROJECT)).toHaveLength(1);
    });

    it("retry after interrupted resolution: issue in accepting state returns false", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = makeLLMPort();
      const locks = makeMockLockPort(store);
      const issue = makeIssue({ status: "accepting" });

      const stories = makeMockStoryPort(story, [issue]);
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(llm, stories, episodes, canon, locks);

      const result = await service.resolveIssue({
        clerkUserId: CLERK, projectId: PROJECT, storyId: STORY_ID,
        episodeId: EPISODE_ID, episodeNumber: 1, issueId: "issue-1",
        decision: "accepted", jobId: JOB_ID,
      });

      expect(result.resolved).toBe(false);
      expect(stories.claimIssue).not.toHaveBeenCalled();
    });

    it("duplicate resolution attempt returns false for already-accepted issue", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const llm = makeLLMPort();
      const locks = makeMockLockPort(store);
      const issue = makeIssue({ status: "accepted", resolvedAt: new Date().toISOString() });

      const stories = makeMockStoryPort(story, [issue]);
      const episodes = makeMockEpisodePort(episode);

      const service = createCanonFactExtractionService(llm, stories, episodes, canon, locks);

      const result = await service.resolveIssue({
        clerkUserId: CLERK, projectId: PROJECT, storyId: STORY_ID,
        episodeId: EPISODE_ID, episodeNumber: 1, issueId: "issue-1",
        decision: "accepted", jobId: JOB_ID,
      });

      expect(result.resolved).toBe(false);
      expect(stories.claimIssue).not.toHaveBeenCalled();
    });
  });

  describe("production LLM provider wiring (B1)", () => {
    it("invokes the real LLM provider and commits returned facts", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const locks = makeMockLockPort(store);
      const stories = makeMockStoryPort(story);
      const episodes = makeMockEpisodePort(episode);

      const fact = makeExtractedFact();
      const generateCanonFacts = vi.fn(async () => ({
        text: JSON.stringify({ facts: [fact] }),
      }));
      const llm = { generateCanonFacts };

      const port = makeCanonFactLLMPort(llm as never);
      const service = createCanonFactExtractionService(port, stories, episodes, canon, locks);

      const result = await service.extractAndCommit({
        clerkUserId: CLERK,
        projectId: PROJECT,
        episodeId: EPISODE_ID,
        storyId: STORY_ID,
        episodeNumber: 1,
        jobId: JOB_ID,
      });

      expect(generateCanonFacts).toHaveBeenCalledTimes(1);
      expect(result.committed).toBe(1);
      expect(result.status).toBe("canon_committed");
      expect(store.list(PROJECT)).toHaveLength(1);
    });

    it("propagates provider errors as extraction_failed, not empty success", async () => {
      const store = new InMemoryCanonFactStore();
      const canon = wrapInMemoryStore(store);
      const story = makeStory();
      const episode = makeEpisode();
      const locks = makeMockLockPort(store);
      const stories = makeMockStoryPort(story);
      const episodes = makeMockEpisodePort(episode);

      const generateCanonFacts = vi.fn(async () => {
        throw new Error("Provider rate limited");
      });
      const llm = { generateCanonFacts };

      const port = makeCanonFactLLMPort(llm as never);
      const service = createCanonFactExtractionService(port, stories, episodes, canon, locks);

      const result = await service.extractAndCommit({
        clerkUserId: CLERK,
        projectId: PROJECT,
        episodeId: EPISODE_ID,
        storyId: STORY_ID,
        episodeNumber: 1,
        jobId: JOB_ID,
      });

      expect(generateCanonFacts).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("extraction_failed");
      expect(result.committed).toBe(0);
      expect(store.list(PROJECT)).toHaveLength(0);
    });

    it("throws when provider lacks generateCanonFacts capability", async () => {
      const llm = {} as never;
      const port = makeCanonFactLLMPort(llm);

      await expect(
        port.request("system", "prompt"),
      ).rejects.toThrow("does not support canon fact extraction");
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
      findAllExtractionCandidates: vi.fn(async () => [{ clerkUserId: CLERK, projectId: PROJECT }]),
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
      findAllExtractionCandidates: vi.fn(async () => [{ clerkUserId: CLERK, projectId: PROJECT }]),
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
      findAllExtractionCandidates: vi.fn(async () => []),
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
      findAllExtractionCandidates: vi.fn(async () => []),
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
      findAllExtractionCandidates: vi.fn(async () => [{ clerkUserId: CLERK, projectId: PROJECT }]),
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

  it("runGlobal discovers candidates and dispatches globally", async () => {
    const extraction = makeExtractionPort();
    const episode = makeEpisode();
    const story = makeStory();

    const episodes = {
      findOwned: vi.fn(async () => episode),
      updateCanonExtractionStatus: vi.fn(async () => episode),
      findApprovedWithoutExtraction: vi.fn(async () => [episode]),
      findExtractionProcessing: vi.fn(async () => []),
      findAllExtractionCandidates: vi.fn(async () => [{ clerkUserId: CLERK, projectId: PROJECT }]),
    };
    const stories = {
      findOwned: vi.fn(async () => story),
    };
    const outbox = makeMockOutboxPort();

    const dispatcher = createCanonExtractionDispatcher(
      extraction, episodes, stories, outbox,
    );

    const result = await dispatcher.runGlobal({});

    expect(episodes.findAllExtractionCandidates).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(result.enqueued).toBe(1);
  });

  it("runGlobal dispatches pending events across all users", async () => {
    const extraction = makeExtractionPort();
    const episode = makeEpisode();

    const episodes = {
      findOwned: vi.fn(async () => episode),
      updateCanonExtractionStatus: vi.fn(async () => episode),
      findApprovedWithoutExtraction: vi.fn(async () => []),
      findExtractionProcessing: vi.fn(async () => []),
      findAllExtractionCandidates: vi.fn(async () => []),
    };
    const stories = {
      findOwned: vi.fn(async () => makeStory()),
    };
    const outbox = makeMockOutboxPort();
    outbox.claimPendingGlobal = vi.fn(async () => [
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

    const result = await dispatcher.runGlobal({});

    expect(outbox.claimPendingGlobal).toHaveBeenCalledTimes(1);
    expect(result.dispatched).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(extraction.extractAndCommit).toHaveBeenCalledTimes(1);
  });

  it("runGlobal continues when reconcileCrashes throws for one candidate", async () => {
    const extraction = makeExtractionPort();
    const episode = makeEpisode();
    const story = makeStory();

    const episodes = {
      findOwned: vi.fn(async () => episode),
      updateCanonExtractionStatus: vi.fn(async () => episode),
      findApprovedWithoutExtraction: vi.fn(async () => [episode]),
      findExtractionProcessing: vi.fn(async () => []),
      findAllExtractionCandidates: vi.fn(async () => [
        { clerkUserId: "user-bad", projectId: "proj-bad" },
        { clerkUserId: CLERK, projectId: PROJECT },
      ]),
    };
    const stories = {
      findOwned: vi.fn(async (clerkUserId: string) => {
        if (clerkUserId === "user-bad") return null;
        return story;
      }),
    };
    const outbox = makeMockOutboxPort();

    const dispatcher = createCanonExtractionDispatcher(
      extraction, episodes, stories, outbox,
    );

    const result = await dispatcher.runGlobal({});

    expect(result.enqueued).toBe(1);
  });

  it("liveCanonExtractionDispatcher returns a dispatcher with runGlobal (B2 worker wiring)", () => {
    const dispatcher = liveCanonExtractionDispatcher();
    expect(typeof dispatcher.runGlobal).toBe("function");
    expect(typeof dispatcher.run).toBe("function");
    expect(typeof dispatcher.reconcileCrashes).toBe("function");
    expect(typeof dispatcher.dispatchPending).toBe("function");
    expect(typeof dispatcher.dispatchPendingGlobal).toBe("function");
  });
});
describe("canon shadow comparison (Step 2 corrections)", () => {
  it("scripted fake LLM commits facts with verified evidence episode number", async () => {
    const store = new InMemoryCanonFactStore();
    const canon = wrapInMemoryStore(store);
    const story = makeStory({ episodeId: "ep-7" });
    const episode = makeEpisode({ episodeNumber: 7 });
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
      episodeId: "ep-7",
      storyId: STORY_ID,
      episodeNumber: 7,
      jobId: JOB_ID,
    });

    expect(result.committed).toBe(1);
    expect(result.status).toBe("canon_committed");
    const entries = store.list(PROJECT);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.evidence).not.toBeNull();
    expect(entries[0]!.evidence!.episode).toBe(7);
    expect(entries[0]!.evidence!.episodeId).toBe("ep-7");
  });

  it("a quote not in the scene is rejected into issues, not committed", async () => {
    const store = new InMemoryCanonFactStore();
    const canon = wrapInMemoryStore(store);
    const story = makeStory();
    const episode = makeEpisode();
    const llm = makeLLMPort([
      makeExtractedFact({
        quote: "This exact text appears nowhere in the screenplay scene.",
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

    expect(result.committed).toBe(0);
    expect(result.issues).toBe(1);
    expect(result.status).toBe("canon_committed_with_issues");
    expect(store.list(PROJECT)).toHaveLength(0);
    expect(stories.saveCanonExtractionIssues).toHaveBeenCalledTimes(1);
    const savedIssues = stories.saveCanonExtractionIssues.mock.calls[0]![2] as CanonExtractionIssueRecord[];
    expect(savedIssues[0]!.code).toBe("quote_not_found");
  });

  it("empty extraction on a multi-scene screenplay yields extraction_failed", async () => {
    const store = new InMemoryCanonFactStore();
    const canon = wrapInMemoryStore(store);
    const multiSceneStory = makeStory({
      screenplay: [
        makeScene({ sceneNumber: 1 }),
        makeScene({ sceneNumber: 2, heading: "EXT. GARDEN - DAY" }),
        makeScene({ sceneNumber: 3, heading: "INT. KITCHEN - NIGHT" }),
      ],
    });
    const episode = makeEpisode();
    const llm = makeLLMPort([]);
    const locks = makeMockLockPort(store);
    const stories = makeMockStoryPort(multiSceneStory);
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
    expect(result.issues).toBe(0);
    expect(store.list(PROJECT)).toHaveLength(0);
    expect(episodes.updateCanonExtractionStatus).toHaveBeenCalledWith(
      CLERK, PROJECT, EPISODE_ID, "extraction_failed",
      expect.any(String),
    );
  });

  it("shadow diff reports a planted plan-vs-screenplay mismatch", () => {
    const ledger: ContinuityLedger = {
      events: [],
      characterStates: [
        {
          name: "Alice",
          currentLocation: "Living Room",
          currentObjective: "Find the hidden treasure chest",
          knowledge: ["The treasure is buried in the garden"],
          beliefs: [],
          motivations: [],
          emotionalState: "determined and hopeful",
          physicalState: "",
          relationships: [],
        },
      ],
      locationStates: [],
      objectStates: [],
      revealedSecrets: [],
      unresolvedThreads: [],
      consequences: [],
      timelineNotes: "",
    };

    const canonState: DerivedCanonState = {
      schemaVersion: 1,
      projectId: PROJECT,
      sequence: 1,
      asOfEpisode: 1,
      factCount: 1,
      entities: [
        {
          id: "char-alice",
          kind: "character",
          name: "Alice",
          aliases: [],
          description: "The protagonist.",
          role: "protagonist",
          motivations: [],
          goals: ["Escape the locked room"],
          firstIntroductionEpisode: 1,
          firstAppearanceEpisode: 1,
          appearances: [1],
          lifecycle: "active",
          arc: "panicked and desperate",
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
      ],
      relationships: [],
      events: [],
      threads: [],
      facts: [],
      knowledge: [],
      rules: [],
      retracted: [],
      subjective: [],
    };

    const diff = compareCanonShadow(ledger, canonState);

    expect(diff.characterStateDifferences.length).toBeGreaterThanOrEqual(2);
    const objectiveDiff = diff.characterStateDifferences.find(
      (d) => d.field === "currentObjective",
    );
    expect(objectiveDiff).toBeDefined();
    expect(objectiveDiff!.ledgerValue).toBe("Find the hidden treasure chest");
    expect(objectiveDiff!.canonValue).toBe("Escape the locked room");

    const emotionalDiff = diff.characterStateDifferences.find(
      (d) => d.field === "emotionalState",
    );
    expect(emotionalDiff).toBeDefined();
    expect(emotionalDiff!.ledgerValue).toBe("determined and hopeful");
    expect(emotionalDiff!.canonValue).toBe("panicked and desperate");

    const knowledgeDiff = diff.characterStateDifferences.find(
      (d) => d.field === "knowledge",
    );
    expect(knowledgeDiff).toBeDefined();
    expect(knowledgeDiff!.ledgerValue).toBe("The treasure is buried in the garden");
    expect(knowledgeDiff!.canonValue).toBe("(not found in canon)");
  });
});