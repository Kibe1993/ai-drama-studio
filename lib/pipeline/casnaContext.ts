import type { ContinuityLedgerRecord } from "@/lib/validation/continuityLedger";
import type { EpisodeRecord } from "@/lib/validation/episode";
import type { EpisodePlan, EpisodeValidation } from "@/lib/validation/casna";
import type { SeasonPlanRecord } from "@/lib/validation/seasonPlan";
import type { StoryRecord } from "@/lib/validation/story";
import {
  episodeGenerationGate,
  previousApprovedEpisode,
  type CasnaGate,
} from "@/lib/domain/casna";
import { deriveEpisodePlan, validateEpisodePlan } from "@/lib/domain/episodePlan";
import type { PreviousEpisode } from "@/lib/domain/screenplayValidation";

export type CasnaPlanPort = {
  findApproved(clerkUserId: string, projectId: string): Promise<SeasonPlanRecord | null>;
  findLatest(clerkUserId: string, projectId: string): Promise<SeasonPlanRecord | null>;
};

export type CasnaLedgerPort = {
  findLatest(clerkUserId: string, projectId: string): Promise<ContinuityLedgerRecord | null>;
};

export type CasnaEpisodePort = {
  listOwned(clerkUserId: string, projectId: string): Promise<EpisodeRecord[] | null>;
};

export type CasnaStoryPort = {
  findOwned(clerkUserId: string, id: string): Promise<StoryRecord | null>;
};

export type CasnaEpisodeContext = {
  /** Whether the backend permits generating this episode at all. */
  gate: CasnaGate;
  plan: SeasonPlanRecord | null;
  latestPlan: SeasonPlanRecord | null;
  ledger: ContinuityLedgerRecord | null;
  /** Stage F: what this episode inherits and intends. */
  episodePlan: EpisodePlan | null;
  /** Stage F validation against the approved Season Plan. */
  episodePlanValidation: EpisodeValidation | null;
  previousEpisodes: PreviousEpisode[];
  previousEpisode: { episodeNumber: number; title: string; synopsis: string } | null;
};

/**
 * A token-bounded projection of the context for the screenplay prompt. The full
 * plan and ledger are kept out of the prompt to leave room for the screenplay
 * itself; the fields here are the ones that constrain what happens next.
 */
export function compactCasnaPromptContext(context: CasnaEpisodeContext): {
  seasonPlan: unknown | null;
  episodePlan: unknown | null;
  continuityLedger: unknown | null;
  previousEpisode: { episodeNumber: number; title: string; synopsis: string } | null;
} {
  const plan = context.plan;
  return {
    seasonPlan: plan
      ? {
          seasonObjective: plan.seasonObjective,
          centralConflict: plan.centralConflictOrMystery,
          intendedConclusion: plan.intendedSeasonConclusion,
          upcomingEpisodes: plan.episodeProgression
            .filter((item) => item.episodeNumber >= (context.episodePlan?.episodeNumber ?? 1))
            .slice(0, 3)
            .map((item) => ({
              episodeNumber: item.episodeNumber,
              workingTitle: item.workingTitle,
              narrativePurpose: item.narrativePurpose,
              endingOrCliffhanger: item.endingOrCliffhanger,
            })),
        }
      : null,
    episodePlan: context.episodePlan,
    continuityLedger: context.ledger
      ? {
          events: context.ledger.events.slice(-8).map((event) => ({
            episode: event.episodeNumber,
            event: event.event,
            consequence: event.consequence,
          })),
          characterStates: context.ledger.characterStates.map((state) => ({
            name: state.name,
            location: state.currentLocation,
            objective: state.currentObjective,
            emotionalState: state.emotionalState,
            physicalState: state.physicalState,
            knowledge: state.knowledge.slice(-6),
            beliefs: state.beliefs.slice(-4),
            motivations: state.motivations.slice(-4),
            relationships: state.relationships.slice(-6).map((rel) => ({
              characterName: rel.characterName,
              relationship: rel.relationship,
              tensionOrChange: rel.tensionOrChange,
            })),
          })),
          locationStates: context.ledger.locationStates.slice(-10).map((loc) => ({
            name: loc.name,
            currentState: loc.currentState,
            lastSeenEpisode: loc.lastSeenEpisode,
          })),
          objectStates: context.ledger.objectStates.slice(-10).map((obj) => ({
            name: obj.name,
            ownership: obj.ownership,
            condition: obj.condition,
            lastSeenEpisode: obj.lastSeenEpisode,
          })),
          revealedSecrets: context.ledger.revealedSecrets.slice(-8),
          unresolvedThreads: context.ledger.unresolvedThreads
            .filter((thread) => thread.status !== "resolved")
            .slice(-6)
            .map((thread) => thread.thread),
          consequences: context.ledger.consequences.slice(-8),
        }
      : null,
    previousEpisode: context.previousEpisode,
  };
}

/**
 * CASNA Stages E and F: assemble everything a screenplay needs to continue an
 * already-established story — the approved Season Plan, the episode-specific
 * plan derived from it, the Continuity Ledger, and previous approved episodes.
 *
 * Kept out of the provider layer so the same context is used for generation,
 * validation, and the UI, and can be unit tested with in-memory ports.
 */
export function createCasnaContext(deps: {
  plans: CasnaPlanPort;
  ledgers: CasnaLedgerPort;
  episodes: CasnaEpisodePort;
  stories: CasnaStoryPort;
}) {
  return {
    async load(input: {
      clerkUserId: string;
      projectId: string;
      productionMode: string;
      episodeNumber: number;
      bibleApprovedVersion: number;
      /** Load full screenplays for prior episodes (needed for repetition checks). */
      withScreenplays?: boolean;
    }): Promise<CasnaEpisodeContext> {
      const { clerkUserId, projectId, episodeNumber, productionMode } = input;
      const [approvedPlan, latestPlan, ledger, episodes] = await Promise.all([
        deps.plans.findApproved(clerkUserId, projectId),
        deps.plans.findLatest(clerkUserId, projectId),
        deps.ledgers.findLatest(clerkUserId, projectId),
        deps.episodes.listOwned(clerkUserId, projectId),
      ]);

      const gate = episodeGenerationGate({
        productionMode,
        bibleApprovedVersion: input.bibleApprovedVersion,
        approvedPlan,
        latestPlan,
        ledger,
        episodes: episodes ?? [],
        targetEpisodeNumber: episodeNumber,
      });

      const previousEpisodes: PreviousEpisode[] = [];
      if (gate.allowed || approvedPlan) {
        for (const episode of (episodes ?? [])
          .filter((row) => row.episodeNumber < episodeNumber && row.currentStoryId)
          .sort((a, b) => a.episodeNumber - b.episodeNumber)) {
          const story = await deps.stories.findOwned(clerkUserId, episode.currentStoryId!);
          if (!story || story.status !== "approved") continue;
          previousEpisodes.push({
            episodeNumber: episode.episodeNumber,
            title: story.title,
            synopsis: story.synopsis,
            screenplay: input.withScreenplays ? story.screenplay : [],
          });
        }
      }

      const previousEpisode = previousApprovedEpisode(episodes ?? [], episodeNumber);
      const previousStory = previousEpisode?.currentStoryId
        ? previousEpisodes.find((row) => row.episodeNumber === previousEpisode.episodeNumber) ?? null
        : null;
      const previousSummary = previousStory
        ? {
            episodeNumber: previousStory.episodeNumber,
            title: previousStory.title,
            synopsis: previousStory.synopsis,
          }
        : null;

      const episodePlan = approvedPlan
        ? deriveEpisodePlan({
            plan: approvedPlan,
            ledger,
            previousEpisode: previousSummary,
            episodeNumber,
          })
        : null;
      const episodePlanValidation =
        episodePlan && approvedPlan
          ? validateEpisodePlan({
              episodePlan,
              plan: approvedPlan,
              previousEpisode: previousSummary,
            })
          : null;

      return {
        gate,
        plan: approvedPlan,
        latestPlan,
        ledger,
        episodePlan,
        episodePlanValidation,
        previousEpisodes,
        previousEpisode: previousSummary,
      };
    },
  };
}
