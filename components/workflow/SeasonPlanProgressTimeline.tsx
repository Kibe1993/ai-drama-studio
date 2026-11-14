"use client";

import type { SeasonPlanProgressEvent } from "@/lib/pipeline/seasonPlanEngine";

const STAGE_LABELS: Record<SeasonPlanProgressEvent["stage"], string> = {
  init: "Init",
  architecture: "Architecture",
  episode_details: "Episode Details",
  validation: "Validation",
  saving: "Saving",
  complete: "Complete",
};

const STAGE_COLORS: Record<SeasonPlanProgressEvent["stage"], string> = {
  init: "text-[#6f675d]",
  architecture: "text-[#dfc18a]",
  episode_details: "text-[#f3efe6]",
  validation: "text-[#c4a574]",
  saving: "text-[#c4a574]",
  complete: "text-[#c4a574]",
};

function statusGlyph(status: SeasonPlanProgressEvent["status"]): string {
  switch (status) {
    case "completed": return "✓";
    case "failed": return "✗";
    case "started": return "○";
    case "provider_attempt": return "→";
    case "provider_success": return "✓";
    case "provider_failed": return "✗";
    default: return "●";
  }
}

function statusColor(status: SeasonPlanProgressEvent["status"]): string {
  switch (status) {
    case "completed":
    case "provider_success":
      return "text-[#c4a574]";
    case "failed":
    case "provider_failed":
      return "text-[#e7b2a8]";
    case "started":
      return "text-[#6f675d]";
    default:
      return "text-[#dfc18a]";
  }
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatTime(ts: number, baseTs: number): string {
  const elapsed = ts - baseTs;
  if (elapsed <= 0) return "0s";
  return `+${formatElapsed(elapsed)}`;
}

function eventMetadata(event: SeasonPlanProgressEvent): string | null {
  const parts: string[] = [];
  if (event.provider) {
    parts.push(event.model ? `${event.provider} / ${event.model}` : event.provider);
  }
  if (event.fallbackFrom) {
    parts.push(`fallback from ${event.fallbackFrom}`);
  }
  if (event.latencyMs != null) {
    parts.push(formatElapsed(event.latencyMs));
  }
  if (event.completedEpisodes != null && event.totalEpisodes != null) {
    parts.push(`${event.completedEpisodes}/${event.totalEpisodes} episodes`);
  }
  if (event.batch != null && event.totalBatches != null && event.totalBatches > 1) {
    parts.push(`batch ${event.batch}/${event.totalBatches}`);
  }
  if (event.errorCount != null && event.errorCount > 0) {
    parts.push(`${event.errorCount} error${event.errorCount === 1 ? "" : "s"}`);
  }
  if (event.warningCount != null && event.warningCount > 0) {
    parts.push(`${event.warningCount} warning${event.warningCount === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function episodeProgressPercent(events: SeasonPlanProgressEvent[]): number | null {
  let latest: SeasonPlanProgressEvent | null = null;
  for (const event of events) {
    if (event.stage === "episode_details" && event.completedEpisodes != null && event.totalEpisodes != null) {
      latest = event;
    }
  }
  if (!latest || !latest.totalEpisodes || latest.totalEpisodes === 0) return null;
  return Math.min(100, Math.round((latest.completedEpisodes! / latest.totalEpisodes) * 100));
}

export function SeasonPlanProgressTimeline({ events }: { events: SeasonPlanProgressEvent[] }) {
  if (events.length === 0) return null;

  const baseTs = events[0].ts;
  const progressPercent = episodeProgressPercent(events);

  return (
    <div className="rounded border border-[#39342d] p-4" role="status" aria-label="Season plan generation progress">
      {progressPercent != null ? (
        <div className="mb-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#2e2a25]">
            <div
              className="h-full rounded-full bg-[#c4a574] transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      ) : null}
      <ol className="grid gap-1.5">
        {events.map((event, index) => {
          const meta = eventMetadata(event);
          return (
            <li key={index} className="flex items-start gap-2 text-sm">
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-xs ${statusColor(event.status)}`}
                aria-hidden="true"
              >
                {statusGlyph(event.status)}
              </span>
              <div className="min-w-0 flex-1">
                <span className={`text-xs font-medium uppercase tracking-wide ${STAGE_COLORS[event.stage]}`}>
                  {STAGE_LABELS[event.stage]}
                </span>
                <span className="ml-2 text-[#cfc6b8]">{event.message}</span>
                {meta ? (
                  <span className="ml-2 text-xs text-[#6f675d]">{meta}</span>
                ) : null}
                <span className="ml-2 text-xs text-[#6f675d]">{formatTime(event.ts, baseTs)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}