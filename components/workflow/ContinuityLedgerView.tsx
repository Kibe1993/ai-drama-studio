"use client";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/hooks/api";
import { useContinuity, useRebuildContinuity } from "@/hooks/useSeasonPlan";

export function ContinuityLedgerView({ projectId }: { projectId: string }) {
  const query = useContinuity(projectId);
  const rebuild = useRebuildContinuity(projectId);
  const ledger = query.data?.ledger;
  const proposed = query.data?.proposedDevelopments ?? [];
  const canRebuild = query.data?.canRebuild ?? false;

  if (query.isLoading) return <p className="text-sm text-[#a39b8f]">Loading continuity</p>;
  if (query.isError) return null;
  if (!ledger && proposed.length === 0 && !canRebuild) return null;

  return (
    <details className="mt-6 rounded border border-[#39342d] p-4">
      <summary className="cursor-pointer font-display text-lg text-[#f3efe6]">
        Continuity Ledger (as of episode {ledger?.asOfEpisode ?? 0})
      </summary>

      {!ledger ? (
        <div className="mt-4 rounded border border-[#6b5a32] p-3">
          <p className="text-sm text-[#dfc18a]">No continuity record yet</p>
          <p className="mt-1 text-xs text-[#a39b8f]">
            Episodes were approved before continuity was recorded. You can rebuild the ledger from the
            approved Season Plan and approved episodes. Unapproved drafts are never read.
          </p>
          {canRebuild ? (
            <div className="mt-3">
              <Button
                size="sm"
                disabled={rebuild.isPending}
                onClick={() => rebuild.mutate()}
              >
                {rebuild.isPending ? "Rebuilding…" : "Rebuild continuity from approved episodes"}
              </Button>
              {rebuild.data ? (
                <p role="status" className="mt-2 text-xs text-[#c4a574]">
                  Rebuilt from {rebuild.data.replayedEpisodes} approved episode
                  {rebuild.data.replayedEpisodes === 1 ? "" : "s"}.
                </p>
              ) : null}
              {rebuild.error ? (
                <p role="alert" className="mt-2 text-xs text-[#e7b2a8]">
                  {rebuild.error instanceof ApiError ? rebuild.error.message : "The rebuild failed."}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {proposed.length > 0 ? (
        <section className="mt-4 rounded border border-[#6b5a32] p-3">
          <p className="text-sm text-[#dfc18a]">Proposed developments (awaiting approval)</p>
          <p className="mt-1 text-xs text-[#a39b8f]">
            These are proposals from an unapproved episode plan. They are not established canon and are not
            given to later episodes as canon.
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm text-[#cfc6b8]">
            {proposed.map((development, index) => (
              <li key={index}>
                <span className="text-xs text-[#a39b8f]">[Proposed for ep {development.episodeNumber}]</span>{" "}
                {development.development}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!ledger ? null : (
        <div className="mt-4 grid gap-4">
          {ledger.events.length > 0 ? (
            <section>
              <p className="text-sm text-[#c4a574]">Established Events</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-[#cfc6b8]">
                {ledger.events.map((event, i) => (
                  <li key={i}>
                    <span className="text-xs text-[#a39b8f]">[Ep {event.episodeNumber}]</span> {event.event}
                    {event.consequence ? <span className="text-[#a39b8f]"> → {event.consequence}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {ledger.characterStates.length > 0 ? (
            <section>
              <p className="text-sm text-[#c4a574]">Character States</p>
              <div className="mt-1 grid gap-2">
                {ledger.characterStates.map((character, i) => (
                  <div key={i} className="border border-[#2e2a25] p-2 text-sm text-[#cfc6b8]">
                    <p className="text-[#f3efe6]">{character.name}</p>
                    <p className="text-xs">Location: {character.currentLocation}</p>
                    <p className="text-xs">Objective: {character.currentObjective}</p>
                    <p className="text-xs">Emotional state: {character.emotionalState}</p>
                    {character.relationships.length > 0 ? (
                      <p className="text-xs">
                        Relationships:{" "}
                        {character.relationships
                          .map((relationship) => `${relationship.characterName} — ${relationship.relationship}`)
                          .join("; ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {ledger.objectStates.length > 0 ? (
            <section>
              <p className="text-sm text-[#c4a574]">Objects</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-[#cfc6b8]">
                {ledger.objectStates.map((object, i) => (
                  <li key={i}>
                    {object.name}: {object.ownership} · {object.condition}
                    <span className="text-xs text-[#a39b8f]"> [Ep {object.lastSeenEpisode}]</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {ledger.locationStates.length > 0 ? (
            <section>
              <p className="text-sm text-[#c4a574]">Locations</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-[#cfc6b8]">
                {ledger.locationStates.map((location, i) => (
                  <li key={i}>
                    {location.name}: {location.currentState}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {ledger.unresolvedThreads.length > 0 ? (
            <section>
              <p className="text-sm text-[#c4a574]">Unresolved Threads</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-[#cfc6b8]">
                {ledger.unresolvedThreads.map((thread, i) => (
                  <li key={i}>
                    {thread.thread}
                    <span className="text-xs text-[#a39b8f]"> [Ep {thread.introducedInEpisode}, {thread.status}]</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {ledger.revealedSecrets.length > 0 ? (
            <section>
              <p className="text-sm text-[#c4a574]">Revealed Secrets</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-[#cfc6b8]">
                {ledger.revealedSecrets.map((secret, i) => <li key={i}>{secret}</li>)}
              </ul>
            </section>
          ) : null}

          {ledger.consequences.length > 0 ? (
            <section>
              <p className="text-sm text-[#c4a574]">Active Consequences</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-[#cfc6b8]">
                {ledger.consequences.map((consequence, i) => <li key={i}>{consequence}</li>)}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </details>
  );
}
