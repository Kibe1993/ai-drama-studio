"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  EpisodePlanItem,
  SeasonPlan,
  SeasonPlanRecord,
} from "@/lib/validation/seasonPlan";

const SCALAR_SEASON_FIELDS = [
  ["seasonObjective", "Season objective", 1200],
  ["centralConflictOrMystery", "Central conflict or mystery", 1000],
  ["mainCharacterObjectives", "Main character objectives", 1000],
  ["overallCharacterDevelopment", "Overall character development", 1000],
  ["beginningDirection", "Beginning direction", 800],
  ["middleDirection", "Middle direction", 800],
  ["endingDirection", "Ending direction", 800],
  ["intendedSeasonConclusion", "Intended season conclusion", 1000],
] as const;

const LIST_SEASON_FIELDS = [
  ["majorStoryDevelopments", "Major story developments"],
  ["importantRevelations", "Important revelations"],
  ["relationshipChanges", "Relationship changes"],
  ["consequencesCarriedBetween", "Consequences carried between episodes"],
  ["setupAndPayoff", "Setup and payoff"],
  ["unresolvedQuestions", "Unresolved questions"],
] as const;

const SCALAR_EPISODE_FIELDS = [
  ["workingTitle", "Working title", 120],
  ["narrativePurpose", "Narrative purpose", 600],
  ["startingSituation", "Starting situation", 800],
  ["mainObjective", "Main objective", 600],
  ["centralConflict", "Central conflict", 600],
  ["characterDevelopment", "Character development", 800],
  ["storyContribution", "How it advances the season", 600],
  ["endingOrCliffhanger", "Ending or cliffhanger", 600],
  ["continuityRequirements", "Continuity requirements", 600],
] as const;

const LIST_EPISODE_FIELDS = [
  ["majorStoryBeats", "Major story beats"],
  ["informationRevealed", "Information revealed"],
  ["importantEvents", "Important events"],
  ["consequences", "Consequences"],
  ["unresolvedThreads", "Unresolved threads"],
] as const;

type ScalarSeasonKey = (typeof SCALAR_SEASON_FIELDS)[number][0];
type ListSeasonKey = (typeof LIST_SEASON_FIELDS)[number][0];

/**
 * CASNA Stage D: the creator may edit the plan directly before approving it.
 * Every save becomes a new plan version on the server and is re-validated.
 */
export function SeasonPlanEditor({
  plan,
  onSave,
  onCancel,
  pending,
}: {
  plan: SeasonPlanRecord;
  onSave: (next: SeasonPlan) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState<SeasonPlan>(() => toSeasonPlan(plan));

  function setScalar(key: ScalarSeasonKey, value: string) {
    setDraft((current) => ({ ...current, [key]: value }) as SeasonPlan);
  }

  function setList(key: ListSeasonKey, value: string) {
    setDraft(
      (current) =>
        ({
          ...current,
          [key]: value
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        }) as SeasonPlan
    );
  }

  function setEpisode(episodeNumber: number, patch: Partial<EpisodePlanItem>) {
    setDraft((current) => ({
      ...current,
      episodeProgression: current.episodeProgression.map((episode) =>
        episode.episodeNumber === episodeNumber ? { ...episode, ...patch } : episode
      ),
    }));
  }

  return (
    <div className="grid gap-4">
      <div className="rounded border border-[#39342d] p-4">
        <h3 className="font-display text-xl">Edit season plan</h3>
        <p className="mt-1 text-xs text-[#a39b8f]">
          Saving creates version {plan.version + 1} and re-runs validation. The previous version is kept.
        </p>
        <div className="mt-4 grid gap-4">
          {SCALAR_SEASON_FIELDS.map(([key, label]) => (
            <label key={key} className="grid gap-1 text-sm">
              <span className="text-[#c4a574]">{label}</span>
              <textarea
                className="studio-field min-h-20"
                value={draft[key]}
                onChange={(event) => setScalar(key, event.target.value)}
              />
            </label>
          ))}
          {LIST_SEASON_FIELDS.map(([key, label]) => (
            <label key={key} className="grid gap-1 text-sm">
              <span className="text-[#c4a574]">{label} (one per line)</span>
              <textarea
                className="studio-field min-h-16"
                value={draft[key].join("\n")}
                onChange={(event) => setList(key, event.target.value)}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="rounded border border-[#39342d] p-4">
        <h3 className="font-display text-xl">Episodes</h3>
        <div className="mt-3 grid gap-4">
          {draft.episodeProgression.map((episode) => (
            <details key={episode.episodeNumber} className="border border-[#2e2a25] p-3">
              <summary className="cursor-pointer text-sm text-[#f3efe6]">
                Episode {episode.episodeNumber}: {episode.workingTitle}
              </summary>
              <div className="mt-3 grid gap-3">
                {SCALAR_EPISODE_FIELDS.map(([key, label]) => (
                  <label key={key} className="grid gap-1 text-sm">
                    <span className="text-[#c4a574]">{label}</span>
                    <textarea
                      className="studio-field min-h-16"
                      value={episode[key]}
                      onChange={(event) =>
                        setEpisode(episode.episodeNumber, { [key]: event.target.value } as Partial<EpisodePlanItem>)
                      }
                    />
                  </label>
                ))}
                {LIST_EPISODE_FIELDS.map(([key, label]) => (
                  <label key={key} className="grid gap-1 text-sm">
                    <span className="text-[#c4a574]">{label} (one per line)</span>
                    <textarea
                      className="studio-field min-h-16"
                      value={episode[key].join("\n")}
                      onChange={(event) =>
                        setEpisode(episode.episodeNumber, {
                          [key]: event.target.value
                            .split("\n")
                            .map((line) => line.trim())
                            .filter(Boolean),
                        } as Partial<EpisodePlanItem>)
                      }
                    />
                  </label>
                ))}
                <label className="grid gap-1 text-sm">
                  <span className="text-[#c4a574]">Character arcs (Name — change)</span>
                  <textarea
                    className="studio-field min-h-16"
                    value={characterArcText(episode)}
                    onChange={(event) =>
                      setEpisode(episode.episodeNumber, {
                        characterArcChanges: parseCharacterArcs(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-[#c4a574]">Relationship changes (From &gt; To — change)</span>
                  <textarea
                    className="studio-field min-h-16"
                    value={relationshipText(episode)}
                    onChange={(event) =>
                      setEpisode(episode.episodeNumber, {
                        relationshipChanges: parseRelationships(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-[#c4a574]">Object changes (Name — owner — condition)</span>
                  <textarea
                    className="studio-field min-h-16"
                    value={objectText(episode)}
                    onChange={(event) =>
                      setEpisode(episode.episodeNumber, {
                        objectChanges: parseObjects(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-[#c4a574]">Location changes (Name — change)</span>
                  <textarea
                    className="studio-field min-h-16"
                    value={locationText(episode)}
                    onChange={(event) =>
                      setEpisode(episode.episodeNumber, {
                        locationChanges: parseLocations(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
            </details>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button disabled={pending} onClick={() => onSave(draft)}>
          {pending ? "Saving…" : "Save edit and re-validate"}
        </Button>
        <Button variant="quiet" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Strip record metadata so only the editable plan content is sent back. */
function toSeasonPlan(plan: SeasonPlanRecord): SeasonPlan {  return {
    seasonObjective: plan.seasonObjective,
    centralConflictOrMystery: plan.centralConflictOrMystery,
    mainCharacterObjectives: plan.mainCharacterObjectives,
    overallCharacterDevelopment: plan.overallCharacterDevelopment,
    majorStoryDevelopments: [...plan.majorStoryDevelopments],
    beginningDirection: plan.beginningDirection,
    middleDirection: plan.middleDirection,
    endingDirection: plan.endingDirection,
    episodeProgression: plan.episodeProgression.map((episode) => ({ ...episode })),
    importantRevelations: [...plan.importantRevelations],
    relationshipChanges: [...plan.relationshipChanges],
    consequencesCarriedBetween: [...plan.consequencesCarriedBetween],
    setupAndPayoff: [...plan.setupAndPayoff],
    unresolvedQuestions: [...plan.unresolvedQuestions],
    intendedSeasonConclusion: plan.intendedSeasonConclusion,
  };
}

type CharacterArc = EpisodePlanItem["characterArcChanges"][number];
type RelationshipChange = EpisodePlanItem["relationshipChanges"][number];
type ObjectChange = EpisodePlanItem["objectChanges"][number];
type LocationChange = EpisodePlanItem["locationChanges"][number];

const SEPARATOR = " — ";

function splitChangeLine(line: string, expected: number): string[] {
  const parts = line.split(SEPARATOR).map((part) => part.trim());
  while (parts.length < expected) parts.push("");
  return parts;
}

function characterArcText(episode: EpisodePlanItem): string {
  return episode.characterArcChanges.map((change) => `${change.name}${SEPARATOR}${change.change}`).join("\n");
}

function parseCharacterArcs(value: string): CharacterArc[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, change] = splitChangeLine(line, 2);
      return { name: name ?? "", change: change ?? "" };
    })
    .filter((change) => change.name && change.change);
}

function relationshipText(episode: EpisodePlanItem): string {
  return episode.relationshipChanges
    .map((change) => `${change.from} > ${change.to}${SEPARATOR}${change.change}`)
    .join("\n");
}

function parseRelationships(value: string): RelationshipChange[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pair, change] = splitChangeLine(line, 2);
      const [from, to] = (pair ?? "").split(">").map((part) => part.trim());
      return { from: from ?? "", to: to ?? "", change: change ?? "" };
    })
    .filter((change) => change.from && change.to && change.change);
}

function objectText(episode: EpisodePlanItem): string {
  return episode.objectChanges
    .map((change) => `${change.name}${SEPARATOR}${change.ownership}${SEPARATOR}${change.condition}`)
    .join("\n");
}

function parseObjects(value: string): ObjectChange[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ownership, condition] = splitChangeLine(line, 3);
      return { name: name ?? "", ownership: ownership ?? "", condition: condition ?? "" };
    })
    .filter((change) => change.name && change.ownership && change.condition);
}

function locationText(episode: EpisodePlanItem): string {
  return episode.locationChanges.map((change) => `${change.name}${SEPARATOR}${change.change}`).join("\n");
}

function parseLocations(value: string): LocationChange[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, change] = splitChangeLine(line, 2);
      return { name: name ?? "", change: change ?? "" };
    })
    .filter((change) => change.name && change.change);
}
