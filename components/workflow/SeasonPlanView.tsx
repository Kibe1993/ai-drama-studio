"use client";

import type { SeasonPlanRecord } from "@/lib/validation/seasonPlan";
import { Button } from "@/components/ui/button";

export function SeasonPlanView({
  plan,
  onRegenerateEpisode,
  disabled,
}: {
  plan: SeasonPlanRecord;
  onRegenerateEpisode?: (episodeNumber: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-6">
      {/* Season overview */}
      <section className="rounded border border-[#39342d] p-4">
        <h3 className="font-display text-xl">Season Overview</h3>
        <div className="mt-3 grid gap-3 text-sm text-[#cfc6b8]">
          <div>
            <p className="text-xs text-[#a39b8f]">Season objective</p>
            <p>{plan.seasonObjective}</p>
          </div>
          <div>
            <p className="text-xs text-[#a39b8f]">Central conflict / mystery</p>
            <p>{plan.centralConflictOrMystery}</p>
          </div>
          <div>
            <p className="text-xs text-[#a39b8f]">Main character objectives</p>
            <p>{plan.mainCharacterObjectives}</p>
          </div>
          <div>
            <p className="text-xs text-[#a39b8f]">Overall character development</p>
            <p>{plan.overallCharacterDevelopment}</p>
          </div>
        </div>
      </section>

      {/* Story direction */}
      <section className="rounded border border-[#39342d] p-4">
        <h3 className="font-display text-xl">Story Direction</h3>
        <div className="mt-3 grid gap-3 text-sm text-[#cfc6b8]">
          <div>
            <p className="text-xs text-[#a39b8f]">Beginning</p>
            <p>{plan.beginningDirection}</p>
          </div>
          <div>
            <p className="text-xs text-[#a39b8f]">Middle</p>
            <p>{plan.middleDirection}</p>
          </div>
          <div>
            <p className="text-xs text-[#a39b8f]">Ending</p>
            <p>{plan.endingDirection}</p>
          </div>
          <div>
            <p className="text-xs text-[#a39b8f]">Intended season conclusion</p>
            <p>{plan.intendedSeasonConclusion}</p>
          </div>
        </div>
      </section>

      {/* Lists */}
      {plan.majorStoryDevelopments.length > 0 ? (
        <section className="rounded border border-[#39342d] p-4">
          <h3 className="font-display text-lg">Major Story Developments</h3>
          <ul className="mt-2 list-disc pl-5 text-sm text-[#cfc6b8]">
            {plan.majorStoryDevelopments.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </section>
      ) : null}

      {plan.importantRevelations.length > 0 ? (
        <section className="rounded border border-[#39342d] p-4">
          <h3 className="font-display text-lg">Important Revelations</h3>
          <ul className="mt-2 list-disc pl-5 text-sm text-[#cfc6b8]">
            {plan.importantRevelations.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </section>
      ) : null}

      {plan.relationshipChanges.length > 0 ? (
        <section className="rounded border border-[#39342d] p-4">
          <h3 className="font-display text-lg">Relationship Changes</h3>
          <ul className="mt-2 list-disc pl-5 text-sm text-[#cfc6b8]">
            {plan.relationshipChanges.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </section>
      ) : null}

      {plan.consequencesCarriedBetween.length > 0 ? (
        <section className="rounded border border-[#39342d] p-4">
          <h3 className="font-display text-lg">Consequences Carried Between Episodes</h3>
          <ul className="mt-2 list-disc pl-5 text-sm text-[#cfc6b8]">
            {plan.consequencesCarriedBetween.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </section>
      ) : null}

      {plan.setupAndPayoff.length > 0 ? (
        <section className="rounded border border-[#39342d] p-4">
          <h3 className="font-display text-lg">Setup and Payoff</h3>
          <ul className="mt-2 list-disc pl-5 text-sm text-[#cfc6b8]">
            {plan.setupAndPayoff.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </section>
      ) : null}

      {plan.unresolvedQuestions.length > 0 ? (
        <section className="rounded border border-[#39342d] p-4">
          <h3 className="font-display text-lg">Unresolved Questions</h3>
          <ul className="mt-2 list-disc pl-5 text-sm text-[#cfc6b8]">
            {plan.unresolvedQuestions.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </section>
      ) : null}

      {/* Episode progression */}
      <section className="rounded border border-[#39342d] p-4">
        <h3 className="font-display text-xl">Episode Progression</h3>
        <div className="mt-3 grid gap-4">
          {plan.episodeProgression.map((episode) => (
            <article key={episode.episodeNumber} className="border border-[#2e2a25] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-[#f3efe6]">
                  Episode {episode.episodeNumber}: {episode.workingTitle}
                </p>
                {onRegenerateEpisode ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={disabled}
                    onClick={() => onRegenerateEpisode(episode.episodeNumber)}
                  >
                    Regenerate this episode
                  </Button>
                ) : null}
              </div>
              <div className="mt-2 grid gap-2 text-sm text-[#cfc6b8]">
                <p><span className="text-xs text-[#a39b8f]">Narrative purpose: </span>{episode.narrativePurpose}</p>
                <p><span className="text-xs text-[#a39b8f]">Starting situation: </span>{episode.startingSituation}</p>
                <p><span className="text-xs text-[#a39b8f]">Main objective: </span>{episode.mainObjective}</p>
                <p><span className="text-xs text-[#a39b8f]">Central conflict: </span>{episode.centralConflict}</p>
                <p><span className="text-xs text-[#a39b8f]">Character development: </span>{episode.characterDevelopment}</p>
                <p><span className="text-xs text-[#a39b8f]">Story contribution: </span>{episode.storyContribution}</p>
                <p><span className="text-xs text-[#a39b8f]">Ending / cliffhanger: </span>{episode.endingOrCliffhanger}</p>
                <p><span className="text-xs text-[#a39b8f]">Continuity requirements: </span>{episode.continuityRequirements}</p>
                {episode.characterArcChanges.length > 0 ? (
                  <p>
                    <span className="text-xs text-[#a39b8f]">Character arcs: </span>
                    {episode.characterArcChanges.map((change) => `${change.name} — ${change.change}`).join("; ")}
                  </p>
                ) : null}
                {episode.relationshipChanges.length > 0 ? (
                  <p>
                    <span className="text-xs text-[#a39b8f]">Relationships: </span>
                    {episode.relationshipChanges
                      .map((change) => `${change.from} → ${change.to}: ${change.change}`)
                      .join("; ")}
                  </p>
                ) : null}
                {episode.objectChanges.length > 0 ? (
                  <p>
                    <span className="text-xs text-[#a39b8f]">Objects: </span>
                    {episode.objectChanges
                      .map((change) => `${change.name} (${change.ownership}, ${change.condition})`)
                      .join("; ")}
                  </p>
                ) : null}
                {episode.locationChanges.length > 0 ? (
                  <p>
                    <span className="text-xs text-[#a39b8f]">Locations: </span>
                    {episode.locationChanges.map((change) => `${change.name}: ${change.change}`).join("; ")}
                  </p>
                ) : null}
              </div>
              {episode.majorStoryBeats.length > 0 ? (
                <div className="mt-2">
                  <p className="text-xs text-[#a39b8f]">Major story beats</p>
                  <ul className="list-disc pl-5 text-sm text-[#cfc6b8]">
                    {episode.majorStoryBeats.map((beat, i) => <li key={i}>{beat}</li>)}
                  </ul>
                </div>
              ) : null}
              {episode.informationRevealed.length > 0 ? (
                <div className="mt-2">
                  <p className="text-xs text-[#a39b8f]">Information revealed</p>
                  <ul className="list-disc pl-5 text-sm text-[#cfc6b8]">
                    {episode.informationRevealed.map((info, i) => <li key={i}>{info}</li>)}
                  </ul>
                </div>
              ) : null}
              {episode.importantEvents.length > 0 ? (
                <div className="mt-2">
                  <p className="text-xs text-[#a39b8f]">Important events</p>
                  <ul className="list-disc pl-5 text-sm text-[#cfc6b8]">
                    {episode.importantEvents.map((event, i) => <li key={i}>{event}</li>)}
                  </ul>
                </div>
              ) : null}
              {episode.consequences.length > 0 ? (
                <div className="mt-2">
                  <p className="text-xs text-[#a39b8f]">Consequences</p>
                  <ul className="list-disc pl-5 text-sm text-[#cfc6b8]">
                    {episode.consequences.map((consequence, i) => <li key={i}>{consequence}</li>)}
                  </ul>
                </div>
              ) : null}
              {episode.unresolvedThreads.length > 0 ? (
                <div className="mt-2">
                  <p className="text-xs text-[#a39b8f]">Unresolved threads</p>
                  <ul className="list-disc pl-5 text-sm text-[#cfc6b8]">
                    {episode.unresolvedThreads.map((thread, i) => <li key={i}>{thread}</li>)}
                  </ul>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {/* Provider info */}
      {plan.provider ? (
        <p className="text-sm text-[#a39b8f]">
          Generated by {plan.provider}{plan.model ? ` (${plan.model})` : ""}. Version {plan.version}. Based on Story Bible v{plan.basedOnBibleVersion}.
        </p>
      ) : null}
    </div>
  );
}
