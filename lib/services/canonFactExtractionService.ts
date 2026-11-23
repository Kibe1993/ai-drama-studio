import { log } from "@/lib/log";
import { JobError } from "@/lib/pipeline/types";
import { canonStore, CanonFactConflict } from "@/lib/canon/store";


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
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import { compareCanonShadow, logShadowDiff } from "@/lib/domain/canonShadowComparison";

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
  "findOwned" | "saveCanonExtractionIssues" | "getCanonExtractionIssues" | "updateIssueStatus" | "claimIssue" | "finalizeIssue" | "rollbackIssue"
>;

type EpisodePort = Pick<
  typeof episodeRepository,
  "findOwned" | "updateCanonExtractionStatus"
>;

type CanonPort = Pick<
  typeof canonStore,
  "appendBatch" | "getLatestSequence" | "latestState"
>;


type LedgerPort = {
  findLatest(clerkUserId: string, projectId: string): Promise<{ events: unknown[]; characterStates: unknown[]; locationStates: unknown[]; objectStates: unknown[]; revealedSecrets: string[]; unresolvedThreads: unknown[]; consequences: string[]; timelineNotes: string } | null>;
};


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
  episodeNumber: number,
): Evidence {
  return {
    quote: fact.quote,
    sceneNumber: fact.sceneNumber,
    episode: episodeNumber,
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
  const evidence = buildEvidence(fact, story, episodeId, sourceHash, episodeNumber);

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

  ledger?: LedgerPort,
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

      if (extractedFacts.length === 0 && story.screenplay.length >= 3) {
        const message = "Extraction returned zero facts for a screenplay with 3+ scenes.";
        await episodes.updateCanonExtractionStatus(
          input.clerkUserId,
          input.projectId,
          input.episodeId,
          "extraction_failed",
          message,
        );
        return { committed: 0, issues: 0, status: "extraction_failed" };
      }

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
                evidence: buildEvidence(fact, story, input.episodeId, sourceHash, input.episodeNumber),
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

        if (ledger) {
          try {
            const [legacyLedger, canonState] = await Promise.all([
              ledger.findLatest(input.clerkUserId, input.projectId),
              canon.latestState(input.clerkUserId, input.projectId),
            ]);
            const diff = compareCanonShadow(
              legacyLedger as ContinuityLedger | null,
              canonState,
            );
            logShadowDiff(diff, {
              projectId: input.projectId,
              episodeId: input.episodeId,
              episodeNumber: input.episodeNumber,
            });
          } catch {
            // Shadow comparison is log-only and must never block extraction.
          }
        }

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

      const claimed = await stories.claimIssue(
        input.clerkUserId,
        input.storyId,
        input.issueId,
      );
      if (!claimed) return { resolved: false };

      const prepared: PreparedFact = issue.fact;

      try {
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
          });
        }
      } catch (error) {
        await stories.rollbackIssue(
          input.clerkUserId,
          input.storyId,
          input.issueId,
        );
        throw error;
      }

      const finalized = await stories.finalizeIssue(
        input.clerkUserId,
        input.storyId,
        input.issueId,
        {
          status: "accepted",
          resolvedAt: new Date().toISOString(),
        },
      );

      return { resolved: finalized !== null };
    },
  };
}

