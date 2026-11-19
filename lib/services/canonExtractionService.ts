import type { LLMProvider } from "@/lib/providers/llm/types";
import type { CanonSuggestion, CanonExtractionResponse } from "@/lib/validation/canonExtraction";
import type { ContinuityLedgerRecord } from "@/lib/validation/continuityLedger";
import type { StoryRecord } from "@/lib/validation/story";
import { diffCanonSuggestions, hasSuggestionContent, applyCanonSuggestions } from "@/lib/domain/canonExtraction";
import { log } from "@/lib/log";

type LLMPort = Pick<LLMProvider, "generateCanonSuggestions">;
type StoryPort = {
  findOwned(clerkUserId: string, id: string): Promise<StoryRecord | null>;
  saveCanonSuggestions(clerkUserId: string, id: string, suggestions: CanonSuggestion): Promise<StoryRecord | null>;
  clearCanonSuggestions(clerkUserId: string, id: string): Promise<StoryRecord | null>;
};
type LedgerPort = {
  findLatest(clerkUserId: string, projectId: string): Promise<ContinuityLedgerRecord | null>;
  upsert(record: ContinuityLedgerRecord): Promise<ContinuityLedgerRecord>;
};

export type CanonExtractionResult = {
  stored: boolean;
  suggestion: CanonSuggestion | null;
  story: StoryRecord;
};

export type CanonAcceptResult = {
  accepted: boolean;
  ledger: ContinuityLedgerRecord | null;
  story: StoryRecord;
};

export function createCanonExtractionService(
  llm: LLMPort,
  stories: StoryPort,
  ledgers: LedgerPort,
) {
  return {
    /**
     * Run the LLM canon extraction pass on an approved screenplay and store
     * the diffed suggestions for creator review. Advisory only — failures
     * are logged and swallowed, never thrown.
     */
    async extractSuggestions(input: {
      clerkUserId: string;
      storyId: string;
      episodeNumber: number;
      seriesTitle: string;
    }): Promise<CanonExtractionResult> {
      const { clerkUserId, storyId, episodeNumber, seriesTitle } = input;

      const story = await stories.findOwned(clerkUserId, storyId);
      if (!story) {
        throw new Error("Story not found.");
      }
      if (story.status !== "approved") {
        throw new Error("Canon extraction requires an approved screenplay.");
      }

      const ledger = await ledgers.findLatest(clerkUserId, story.projectId);

      let response: CanonExtractionResponse;
      try {
        const result = await llm.generateCanonSuggestions!({
          seriesTitle,
          episodeNumber,
          screenplay: story.screenplay,
          ledger: ledger ?? null,
        });
        response = result.response;
      } catch (error) {
        log.info("canon-extraction", "LLM extraction failed, skipping", {
          storyId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { stored: false, suggestion: null, story };
      }

      const diffed = diffCanonSuggestions(response, ledger ?? null);
      if (!hasSuggestionContent(diffed)) {
        log.info("canon-extraction", "no new canon to suggest", { storyId });
        return { stored: false, suggestion: null, story };
      }

      const suggestion: CanonSuggestion = {
        ...diffed,
        episodeNumber,
        storyId,
        createdAt: new Date().toISOString(),
        status: "pending",
      };

      const updated = await stories.saveCanonSuggestions(clerkUserId, storyId, suggestion);
      return { stored: true, suggestion, story: updated ?? story };
    },

    /**
     * Apply accepted canon suggestions to the Continuity Ledger and clear
     * the suggestion from the story record. This is the only path by which
     * suggested canon becomes established canon.
     */
    async acceptSuggestions(input: {
      clerkUserId: string;
      storyId: string;
    }): Promise<CanonAcceptResult> {
      const { clerkUserId, storyId } = input;

      const story = await stories.findOwned(clerkUserId, storyId);
      if (!story) {
        throw new Error("Story not found.");
      }
      if (!story.canonSuggestions) {
        return { accepted: false, ledger: null, story };
      }

      const ledger = await ledgers.findLatest(clerkUserId, story.projectId);
      if (!ledger) {
        throw new Error("No continuity ledger found. Build the ledger first.");
      }

      const updatedLedgerData = applyCanonSuggestions(
        ledger,
        story.canonSuggestions,
        story.canonSuggestions.episodeNumber,
      );

      const savedLedger = await ledgers.upsert({
        ...updatedLedgerData,
        id: ledger.id,
        clerkUserId: ledger.clerkUserId,
        projectId: ledger.projectId,
        asOfEpisode: ledger.asOfEpisode,
        basedOnPlanVersion: ledger.basedOnPlanVersion,
        version: ledger.version + 1,
        createdAt: ledger.createdAt,
        updatedAt: new Date().toISOString(),
      });

      const acceptedSuggestion: CanonSuggestion = {
        ...story.canonSuggestions,
        status: "accepted",
      };
      const updatedStory = await stories.saveCanonSuggestions(clerkUserId, storyId, acceptedSuggestion);

      log.info("canon-extraction", "suggestions accepted", {
        storyId,
        ledgerVersion: savedLedger.version,
      });

      return { accepted: true, ledger: savedLedger, story: updatedStory ?? story };
    },

    /**
     * Reject the canon suggestions and clear them from the story record.
     */
    async rejectSuggestions(input: {
      clerkUserId: string;
      storyId: string;
    }): Promise<{ rejected: boolean; story: StoryRecord }> {
      const { clerkUserId, storyId } = input;

      const story = await stories.findOwned(clerkUserId, storyId);
      if (!story) {
        throw new Error("Story not found.");
      }
      if (!story.canonSuggestions) {
        return { rejected: false, story };
      }

      const updated = await stories.clearCanonSuggestions(clerkUserId, storyId);
      return { rejected: true, story: updated ?? story };
    },
  };
}