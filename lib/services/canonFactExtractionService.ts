import { log } from "@/lib/log";
import { JobError } from "@/lib/pipeline/types";
import { canonStore, CanonFactConflict } from "@/lib/canon/store";
import { canonLockRepository } from "@/lib/repositories/canonLockRepository";

import { episodeRepository } from "@/lib/repositories/episodeRepository";
import { storyRepository, type CanonExtractionIssueRecord } from "@/lib/repositories/storyRepository";
import type { StoryRecord } from "@/lib/validation/story";
import type { ScreenplayScene } from "@/lib/validation/story";
import type { CanonFactEntry, Evidence } from "@/lib/canon/schema";

import type { ExtractedFact } from "@/lib/validation/canonExtractionResult";
import { canonExtractionResultSchema } from "@/lib/validation/canonExtractionResult";
import {
  buildCanonFactExtractionPrompt,
} from "@/lib/providers/llm/prompts/canonExtractionPrompt";
import {
  computeEntryId,
  computeSourceHash,
} from "@/lib/domain/canonFactIdentity";
import {
  verifyEvidenceInScene,
  computeEvidencePosition,
} from "@/lib/domain/evidenceVerification";
import {
  classifyAssertion,
  inferNarrativeModeFromHeading,
} from "@/lib/domain/assertionClassification";
import {
  reconcileBatch,
  type PreparedFact,
  type ReconciledFact,
} from "@/lib/domain/canonReconciliation";

export type CanonExtractionResult = {
  committed: number;
  issues: number;
  status:
    | "canon_committed"
    | "canon_committed_with_issues"
    | "extraction_failed";
};

type LLMPort = {
  request(
    system: string,
    prompt: string,
  ): Promise<{ text: string }>;
};

type StoryPort = Pick<
  typeof storyRepository,
  "findOwned" | "saveCanonExtractionIssues" | "getCanonExtractionIssues" | "updateIssueStatus"
>;

type EpisodePort = Pick<
  typeof episodeRepository,
  "findOwned" | "updateCanonExtractionStatus"
>;

type CanonPort = Pick<
  typeof canonStore,
  "appendBatch" | "getLatestSequence" | "latestState"
>;

type LockPort = Pick<
  typeof canonLockRepository,
  "acquire" | "release" | "renew"
>;


function parseLLMResponse(text: string): ExtractedFact[] {
  const json = JSON.parse(text);
  const parsed = canonExtractionResultSchema.parse(json);
  return parsed.facts;
}

function buildEvidence(
  fact: ExtractedFact,
  story: StoryRecord,
  episodeId: string,
  sourceHash: string,
): Evidence {
  return {
    quote: fact.quote,
    sceneNumber: fact.sceneNumber,
    episode: story.episodeId ? parseInt(story.episodeId, 10) || 1 : 1,
    episodeId,
    storyId: story.id,
    storyVersion: story.version,
    sourceHash,
  };
}

function prepareFact(
  fact: ExtractedFact,
  story: StoryRecord,
  episodeId: string,
  sourceHash: string,
  episodeNumber: number,
  scene: ScreenplayScene,
): { prepared: PreparedFact } | { issue: { code: string; message: string; fact: PreparedFact } } {
  const evidence = buildEvidence(fact, story, episodeId, sourceHash);

  const verification = verifyEvidenceInScene(scene, fact.quote);
  if (!verification.ok) {
    const partialFact: PreparedFact = {
      id: computeEntryId({
        episodeNumber,
        sceneNumber: fact.sceneNumber,
        kind: fact.kind,
        targetId: fact.targetId,
        payload: fact.payload,
        evidence,
      }),
      episode: episodeNumber,
      sourceStoryId: story.id,
      kind: fact.kind,
      targetId: fact.targetId,
      payload: fact.payload,
      evidence,
      narrativeMode: fact.narrativeMode,
      assertionKind: "character_statement",
      factualStatus: "not_established",
      asserterId: fact.asserterId,
      reason: fact.reason,
      extractor: "canon-extraction",
      evidencePosition: 0,
      sceneNumber: fact.sceneNumber,
    };
    return {
      issue: {
        code: verification.code,
        message:
          verification.code === "quote_not_found"
            ? `Quote not found in scene ${fact.sceneNumber}.`
            : `Quote appears ${verification.occurrences.length} times in scene ${fact.sceneNumber}.`,
        fact: partialFact,
      },
    };
  }

  const narrativeMode =
    inferNarrativeModeFromHeading(scene.heading) ?? fact.narrativeMode;

  const classification = classifyAssertion({
    elementType: verification.locator.elementType,
    narrativeMode,
    eventType: fact.eventType,
  });

  const entryId = computeEntryId({
    episodeNumber,
    sceneNumber: fact.sceneNumber,
    kind: fact.kind,
    targetId: fact.targetId,
    payload: fact.payload,
    evidence,
  });

  const evidencePosition = computeEvidencePosition(verification.locator);

  const prepared: PreparedFact = {
    id: entryId,
    episode: episodeNumber,
    sourceStoryId: story.id,
    kind: fact.kind,
    targetId: fact.targetId,
    payload: fact.payload,
    evidence,
    narrativeMode,
    assertionKind: classification.assertionKind,
    factualStatus: classification.factualStatus,
    asserterId: fact.asserterId,
    reason: fact.reason || classification.issue?.message || "extraction",
    extractor: "canon-extraction",
    evidencePosition,
    sceneNumber: fact.sceneNumber,
  };

  return { prepared };
}

function toEntryInput(
  fact: ReconciledFact,
): Omit<CanonFactEntry, "sequence" | "projectId" | "createdAt" | "commitBatchId"> {
  return {
    id: fact.id,
    episode: fact.episode,
    sourceStoryId: fact.sourceStoryId,
    operation: fact.operation,
    kind: fact.kind,
    targetId: fact.targetId,
    payload: fact.payload,
    newClassification: null,
    evidence: fact.evidence,
    narrativeMode: fact.narrativeMode,
    assertionKind: fact.assertionKind,
    factualStatus: fact.factualStatus,
    asserterId: fact.asserterId,
    reason: fact.reason,
    extractor: fact.extractor,
  };
}

export function createCanonFactExtractionService(
  llm: LLMPort,
  stories: StoryPort = storyRepository,
  episodes: EpisodePort = episodeRepository,
  canon: CanonPort = canonStore,
  locks: LockPort = canonLockRepository,

) {
  return {
    async extractAndCommit(input: {
      clerkUserId: string;
      projectId: string;
      episodeId: string;
      storyId: string;
      episodeNumber: number;
      jobId: string;
    }): Promise<CanonExtractionResult> {
      const story = await stories.findOwned(input.clerkUserId, input.storyId);
      if (!story) {
        throw new JobError("Story not found for canon extraction.", "not_found", false);
      }
      if (story.status !== "approved") {
        throw new JobError("Story must be approved before canon extraction.", "story_not_approved", false);
      }

      const episode = await episodes.findOwned(
        input.clerkUserId,
        input.projectId,
        input.episodeId,
      );
      if (!episode) {
        throw new JobError("Episode not found for canon extraction.", "not_found", false);
      }

      const sourceHash = computeSourceHash(story.screenplay);
      const commitBatchId = `canon-extract:${input.episodeId}:${story.id}:${sourceHash}`;

      await episodes.updateCanonExtractionStatus(
        input.clerkUserId,
        input.projectId,
        input.episodeId,
        "extraction_processing",
      );

      const prompt = buildCanonFactExtractionPrompt({
        seriesTitle: story.title,
        episodeNumber: input.episodeNumber,
        screenplay: story.screenplay,
        currentCanon: null,
      });

      let llmResponse: { text: string };
      try {
        llmResponse = await llm.request(prompt.system, prompt.prompt);
      } catch (error) {
        const message = error instanceof Error ? error.message : "LLM request failed.";
        await episodes.updateCanonExtractionStatus(
          input.clerkUserId,
          input.projectId,
          input.episodeId,
          "extraction_failed",
          message,
        );
        return { committed: 0, issues: 0, status: "extraction_failed" };
      }

      let extractedFacts: ExtractedFact[];
      try {
        extractedFacts = parseLLMResponse(llmResponse.text);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to parse LLM response.";
        await episodes.updateCanonExtractionStatus(
          input.clerkUserId,
          input.projectId,
          input.episodeId,
          "extraction_failed",
          message,
        );
        return { committed: 0, issues: 0, status: "extraction_failed" };
      }

      const acquireResult = await locks.acquire({
        clerkUserId: input.clerkUserId,
        projectId: input.projectId,
        jobId: input.jobId,
      });

      if (!acquireResult.acquired) {
        throw new JobError("Could not acquire canon lock: held by another worker.", "canon_lock_busy", true);
      }

      const fencingToken = acquireResult.fencingToken;

      try {
        const baseState = await canon.latestState(
          input.clerkUserId,
          input.projectId,
        );

        const preparedFacts: PreparedFact[] = [];
        const evidenceIssues: CanonExtractionIssueRecord[] = [];

        for (const fact of extractedFacts) {
          const scene = story.screenplay.find(
            (s) => s.sceneNumber === fact.sceneNumber,
          );
          if (!scene) {
            evidenceIssues.push({
              factId: `missing-scene-${fact.sceneNumber}-${fact.targetId}`,
              code: "scene_not_found",
              message: `Scene ${fact.sceneNumber} not found in screenplay.`,
              fact: {
                id: `missing-scene-${fact.sceneNumber}-${fact.targetId}`,
                episode: input.episodeNumber,
                sourceStoryId: story.id,
                kind: fact.kind,
                targetId: fact.targetId,
                payload: fact.payload,
                evidence: buildEvidence(fact, story, input.episodeId, sourceHash),
                narrativeMode: fact.narrativeMode,
                assertionKind: "character_statement",
                factualStatus: "not_established",
                asserterId: fact.asserterId,
                reason: fact.reason,
                extractor: "canon-extraction",
                evidencePosition: 0,
                sceneNumber: fact.sceneNumber,
              },
              status: "pending_review",
              resolvedAt: null,
            });
            continue;
          }

          const result = prepareFact(fact, story, input.episodeId, sourceHash, input.episodeNumber, scene);
          if ("prepared" in result) {
            preparedFacts.push(result.prepared);
          } else {
            evidenceIssues.push({
              factId: result.issue.fact.id,
              code: result.issue.code,
              message: result.issue.message,
              fact: result.issue.fact,
              status: "pending_review",
              resolvedAt: null,
            });
          }
        }

        const reconciliation = reconcileBatch({
          projectId: input.projectId,
          baseState,
          facts: preparedFacts,
        });

        const allIssues: CanonExtractionIssueRecord[] = [
          ...evidenceIssues,
          ...reconciliation.issues.map((issue) => ({
            factId: issue.factId,
            code: issue.code,
            message: issue.message,
            fact: issue.fact,
            status: "pending_review" as const,
            resolvedAt: null as string | null,
          })),
        ];

        let committedCount = 0;
        if (reconciliation.committed.length > 0) {
          const expectedSequence = (await canon.getLatestSequence(
            input.clerkUserId,
            input.projectId,
          )) + 1;

          const entries = reconciliation.committed.map(toEntryInput);

          await canon.appendBatch({
            clerkUserId: input.clerkUserId,
            projectId: input.projectId,
            expectedSequence,
            commitBatchId,
            entries,
            fencing: {
              projectId: input.projectId,
              jobId: input.jobId,
              fencingToken,
            },
          });
          committedCount = reconciliation.committed.length;
        }

        if (allIssues.length > 0) {
          await stories.saveCanonExtractionIssues(
            input.clerkUserId,
            story.id,
            allIssues,
          );
        }

        const status = allIssues.length > 0 ? "canon_committed_with_issues" : "canon_committed";
        await episodes.updateCanonExtractionStatus(
          input.clerkUserId,
          input.projectId,
          input.episodeId,
          status,
        );


        log.info("canon-extraction", "canon facts extracted", {
          projectId: input.projectId,
          episodeId: input.episodeId,
          committed: committedCount,
          issues: allIssues.length,
          status,
        });

        return {
          committed: committedCount,
          issues: allIssues.length,
          status,
        };
      } catch (error) {
        if (error instanceof CanonFactConflict) {
          throw new JobError(
            `Canon fact conflict: ${error.message}`,
            "canon_fact_conflict",
            true,
          );
        }
        const message = error instanceof Error ? error.message : "Extraction failed.";
        await episodes.updateCanonExtractionStatus(
          input.clerkUserId,
          input.projectId,
          input.episodeId,
          "extraction_failed",
          message,
        );
        return { committed: 0, issues: 0, status: "extraction_failed" };
      } finally {
        await locks.release({
          clerkUserId: input.clerkUserId,
          projectId: input.projectId,
          jobId: input.jobId,
        });
      }
    },

    async resolveIssue(input: {
      clerkUserId: string;
      projectId: string;
      storyId: string;
      episodeId: string;
      episodeNumber: number;
      issueId: string;
      decision: "accepted" | "rejected";
      jobId: string;
    }): Promise<{ resolved: boolean }> {
      const issues = await stories.getCanonExtractionIssues(
        input.clerkUserId,
        input.storyId,
      );
      if (!issues) return { resolved: false };

      const issue = issues.find((i) => i.factId === input.issueId);
      if (!issue) return { resolved: false };
      if (issue.status !== "pending_review") return { resolved: false };

      if (input.decision === "rejected") {
        const updated = await stories.updateIssueStatus(
          input.clerkUserId,
          input.storyId,
          input.issueId,
          {
            status: "rejected",
            resolvedAt: new Date().toISOString(),
          },
        );
        return { resolved: updated !== null };
      }

      const story = await stories.findOwned(input.clerkUserId, input.storyId);
      if (!story) return { resolved: false };

      const sourceHash = computeSourceHash(story.screenplay);
      const issueCommitBatchId = `canon-issue-resolve:${input.episodeId}:${story.id}:${sourceHash}:${input.issueId}:accepted`;

      const acquireResult = await locks.acquire({
        clerkUserId: input.clerkUserId,
        projectId: input.projectId,
        jobId: input.jobId,
      });
      if (!acquireResult.acquired) {
        throw new JobError("Could not acquire canon lock for issue resolution.", "canon_lock_busy", true);
      }

      try {
        const claim = await stories.updateIssueStatus(
          input.clerkUserId,
          input.storyId,
          input.issueId,
          {
            status: "accepted",
            resolvedAt: new Date().toISOString(),
          },
        );
        if (!claim) return { resolved: false };

        const prepared: PreparedFact = issue.fact;
        const baseState = await canon.latestState(
          input.clerkUserId,
          input.projectId,
        );

        const reconciliation = reconcileBatch({
          projectId: input.projectId,
          baseState,
          facts: [prepared],
        });

        if (reconciliation.committed.length > 0) {
          const expectedSequence = (await canon.getLatestSequence(
            input.clerkUserId,
            input.projectId,
          )) + 1;

          await canon.appendBatch({
            clerkUserId: input.clerkUserId,
            projectId: input.projectId,
            expectedSequence,
            commitBatchId: issueCommitBatchId,
            entries: reconciliation.committed.map(toEntryInput),
            fencing: {
              projectId: input.projectId,
              jobId: input.jobId,
              fencingToken: acquireResult.fencingToken,
            },
          });
        }

        return { resolved: true };
      } finally {
        await locks.release({
          clerkUserId: input.clerkUserId,
          projectId: input.projectId,
          jobId: input.jobId,
        });
      }
    },
  };
}

export const canonFactExtractionService = createCanonFactExtractionService(
  {} as LLMPort,
);