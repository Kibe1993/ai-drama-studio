"use client";

import type { EpisodePlan, EpisodeValidation } from "@/lib/validation/casna";

/**
 * CASNA Stages F and H, shown to the creator before approval: what this episode
 * set out to do and inherit, and what the screenplay validation found.
 */
export function EpisodePlanReview({
  plan,
  validation,
}: {
  plan: EpisodePlan;
  validation: EpisodeValidation | null;
}) {
  const errors = validation?.findings.filter((finding) => finding.severity === "error") ?? [];
  const warnings = validation?.findings.filter((finding) => finding.severity === "warning") ?? [];

  return (
    <details className="mt-4 rounded border border-[#39342d] p-4" open={errors.length > 0}>
      <summary className="cursor-pointer font-display text-lg text-[#f3efe6]">
        Episode {plan.episodeNumber} plan — {plan.workingTitle}
      </summary>
      <div className="mt-4 grid gap-3 text-sm text-[#cfc6b8]">
        <p>
          <span className="text-[#c4a574]">Purpose: </span>
          {plan.narrativePurpose}
        </p>
        <p>
          <span className="text-[#c4a574]">Inherits: </span>
          {plan.inheritsFrom.length > 0 ? plan.inheritsFrom.join(" · ") : "Nothing yet — this opens the season."}
        </p>
        <p>
          <span className="text-[#c4a574]">Intends: </span>
          {plan.intendsToAchieve}
        </p>
        <p>
          <span className="text-[#c4a574]">New developments: </span>
          {plan.newDevelopments.join(" · ") || "None"}
        </p>
        <p>
          <span className="text-[#c4a574]">Carries forward: </span>
          {plan.carryForward}
        </p>
        <p className="text-xs text-[#a39b8f]">
          Planned from approved Season Plan version {plan.sourcePlanVersion}. These developments are proposals
          until you approve the episode.
        </p>
      </div>

      <div className="mt-4 border-t border-[#2e2a25] pt-3">
        <p className="text-sm text-[#c4a574]">
          Validation:{" "}
          {validation
            ? validation.passed
              ? `Passed${warnings.length ? ` with ${warnings.length} note${warnings.length === 1 ? "" : "s"}` : ""}`
              : `${errors.length} error${errors.length === 1 ? "" : "s"} — this episode cannot be approved`
            : "not run"}
        </p>
        {errors.length > 0 ? (
          <ul className="mt-2 grid gap-1">
            {errors.map((finding, index) => (
              <li key={`error-${index}`} className="text-xs text-[#e7b2a8]">
                [{finding.category}
                {finding.sceneNumber ? ` · scene ${finding.sceneNumber}` : ""}] {finding.message}
              </li>
            ))}
          </ul>
        ) : null}
        {warnings.length > 0 ? (
          <ul className="mt-2 grid gap-1">
            {warnings.map((finding, index) => (
              <li key={`warning-${index}`} className="text-xs text-[#a39b8f]">
                [{finding.category}
                {finding.sceneNumber ? ` · scene ${finding.sceneNumber}` : ""}] {finding.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
