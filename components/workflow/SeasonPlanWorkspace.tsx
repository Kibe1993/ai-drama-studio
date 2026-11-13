"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/hooks/api";
import {
  useApproveSeasonPlan,
  useStartSeasonPlan,
  useSeasonPlan,
  useUpdateSeasonPlan,
} from "@/hooks/useSeasonPlan";
import { SeasonPlanView } from "@/components/workflow/SeasonPlanView";
import { SeasonPlanEditor } from "@/components/workflow/SeasonPlanEditor";
import { useWorkflow } from "@/hooks/useWorkflow";
import type { Project } from "@/hooks/useProjects";
import type { SeasonPlan, SeasonPlanRequest } from "@/lib/validation/seasonPlan";

export function SeasonPlanWorkspace({ project }: { project: Project }) {
  const router = useRouter();
  const projectId = project.id;
  const query = useSeasonPlan(projectId);
  const workflow = useWorkflow(projectId);
  const start = useStartSeasonPlan(projectId);
  const approve = useApproveSeasonPlan(projectId);
  const update = useUpdateSeasonPlan(projectId);
  const [instruction, setInstruction] = useState("");
  const [episodeCount, setEpisodeCount] = useState(6);
  const [editing, setEditing] = useState(false);

  const plan = query.data?.plan ?? null;
  const job = query.data?.job ?? null;
  const isGenerating = job?.status === "queued" || job?.status === "processing";
  const isFailed = job?.status === "failed" || plan?.status === "failed";
  const isApproved = plan?.status === "approved";
  const pending = start.isPending || approve.isPending || update.isPending || isGenerating;

  function startGeneration(operation: SeasonPlanRequest["operation"], targetEpisodeNumber?: number) {
    start.mutate({
      operation,
      instruction:
        instruction.trim() ||
        (targetEpisodeNumber ? `Regenerate only episode ${targetEpisodeNumber}.` : undefined),
      episodeCount: plan?.episodeProgression.length ?? episodeCount,
      targetEpisodeNumber,
    });
  }

  function regenerateEpisode(episodeNumber: number) {
    startGeneration("revise", episodeNumber);
  }

  function saveEdit(next: SeasonPlan) {
    if (!plan) return;
    update.mutate(
      { planId: plan.id, expectedVersion: plan.version, plan: next },
      { onSuccess: () => setEditing(false) }
    );
  }

  const error = start.error ?? approve.error ?? update.error;
  const errorMessage =
    error instanceof ApiError
      ? error.message
      : error
        ? "The season plan request could not be completed."
        : null;
  const jobError =
    job?.status === "failed"
      ? job.error?.message ?? "Season plan generation failed."
      : null;

  const validationFindings = plan?.validationFindings;
  const hasValidationErrors = Boolean(validationFindings && !validationFindings.passed);

  return (
    <div className="mt-6 grid gap-6">
      {query.isLoading ? <p className="text-[#a39b8f]">Loading season plan</p> : null}
      {query.isError ? <p className="text-[#e7b2a8]">The season plan could not be loaded.</p> : null}

      {workflow.data?.plan.needsReview ? (
        <div className="rounded border border-[#6b3a32] p-4">
          <p role="alert" className="text-sm text-[#dfc18a]">
            The approved Story Bible changed after this plan was approved. Regenerate the plan so it reflects the
            current canon, then approve the new version. Episode generation stays locked until you do.
          </p>
        </div>
      ) : null}

      {isGenerating && job ? (
        <div className="rounded border border-[#39342d] p-4">
          <p role="status" className="text-sm text-[#dfc18a]">
            {job.progress?.message ?? "Generating season plan…"}
          </p>
        </div>
      ) : null}

      {isFailed ? (
        <div className="rounded border border-[#6b3a32] p-4">
          <p role="alert" className="text-sm text-[#e7b2a8]">
            {jobError ?? "Season plan generation failed. You can retry."}
          </p>
        </div>
      ) : null}

      {errorMessage ? (
        <p role="alert" className="text-sm text-[#e7b2a8]">{errorMessage}</p>
      ) : null}

      {plan && !isGenerating ? (
        <div>
          {editing ? (
            <SeasonPlanEditor
              plan={plan}
              pending={update.isPending}
              onSave={saveEdit}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <SeasonPlanView
              plan={plan}
              disabled={pending}
              onRegenerateEpisode={regenerateEpisode}
            />
          )}
        </div>
      ) : null}

      {/* Validation findings */}
      {validationFindings && validationFindings.findings.length > 0 ? (
        <div className="rounded border border-[#39342d] p-4">
          <p className="text-sm text-[#cfc6b8]">
            Validation: {validationFindings.passed ? "Passed with notes" : "Issues found"}
          </p>
          <ul className="mt-2 grid gap-1">
            {validationFindings.findings.map((finding, index) => (
              <li key={index} className={`text-xs ${finding.severity === "error" ? "text-[#e7b2a8]" : "text-[#a39b8f]"}`}>
                [{finding.severity}] {finding.category}
                {finding.episodeNumber ? ` (ep ${finding.episodeNumber})` : ""}: {finding.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isApproved ? (
        <div className="rounded border border-[#39342d] p-4">
          <p className="text-sm text-[#c4a574]">Season Plan approved — version {plan.version}.</p>
          <p className="mt-1 text-xs text-[#a39b8f]">
            You can edit the plan at any time. Saving a change or regenerating an episode creates a new
            version and sends you back to approval; episodes already produced are flagged for continuity review.
          </p>
        </div>
      ) : null}

      {/* Episode count selector */}
      {!isApproved && !plan ? (
        <label className="grid gap-2 text-sm">
          <span>Number of episodes to plan</span>
          <select
            className="studio-field"
            value={episodeCount}
            onChange={(e) => setEpisodeCount(Number(e.target.value))}
            disabled={pending}
          >
            {[3, 4, 5, 6, 8, 10, 12].map((n) => (
              <option key={n} value={n}>{n} episodes</option>
            ))}
          </select>
        </label>
      ) : null}

      {/* Revision instructions */}
      {plan && !editing ? (
        <label className="grid gap-2 text-sm">
          <span>Request changes (optional)</span>
          <textarea
            className="studio-field min-h-20"
            maxLength={2000}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Describe changes you want. Use the per-episode button to regenerate only one section."
          />
        </label>
      ) : null}

      {/* Action buttons — one obvious next action */}
      {!editing ? (
        <div className="flex flex-wrap gap-3">
          {!plan || plan.status === "failed" ? (
            <Button disabled={pending} onClick={() => startGeneration("generate")}>
              {isGenerating ? "Generating…" : start.isPending ? "Queueing…" : "Generate season plan"}
            </Button>
          ) : null}

          {plan && plan.status === "awaiting_approval" && instruction.trim() ? (
            <Button disabled={pending} onClick={() => startGeneration("revise")}>
              {isGenerating ? "Generating…" : "Revise plan"}
            </Button>
          ) : null}

          {plan && plan.status === "awaiting_approval" && !instruction.trim() ? (
            <Button variant="quiet" disabled={pending} onClick={() => startGeneration("regenerate")}>
              {isGenerating ? "Generating…" : "Regenerate plan"}
            </Button>
          ) : null}

          {plan && plan.status === "awaiting_approval" && !hasValidationErrors ? (
            <Button disabled={pending} onClick={() => approve.mutate(plan.id)}>
              {approve.isPending ? "Approving…" : "Approve plan and continue"}
            </Button>
          ) : null}

          {plan && plan.status === "awaiting_approval" && hasValidationErrors ? (
            <p className="text-sm text-[#dfc18a]">
              Resolve validation errors before approving. Edit the plan, then save and re-validate.
            </p>
          ) : null}

          {plan ? (
            <Button variant="quiet" disabled={pending} onClick={() => setEditing(true)}>
              Edit plan
            </Button>
          ) : null}

          {workflow.data?.plan.needsReview ? (
            <Button disabled={pending} onClick={() => startGeneration("regenerate")}>
              {isGenerating ? "Generating…" : "Regenerate plan from current canon"}
            </Button>
          ) : null}

          {isApproved && instruction.trim() ? (
            <Button disabled={pending} onClick={() => startGeneration("revise")}>
              {isGenerating ? "Generating…" : "Revise approved plan"}
            </Button>
          ) : null}

          {isApproved && !isGenerating ? (
            <Button onClick={() => router.push(`/projects/${projectId}/episodes`)}>
              Continue to Episodes →
            </Button>
          ) : null}
        </div>
      ) : null}

      {!plan && !isGenerating ? (
        <p className="text-sm text-[#a39b8f]">
          The season plan describes how the entire season develops — the central conflict, episode-by-episode progression,
          character development, revelations, and the intended conclusion. Generate it from your approved Story Bible,
          review and edit it, then approve to unlock episode creation.
        </p>
      ) : null}
    </div>
  );
}
