"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StoryReview } from "@/components/production/StoryReview";
import { ActionableFindings } from "@/components/production/ActionableFindings";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/hooks/api";
import {
  useApproveStoryDraft,
  useStartStoryDraft,
  useStoryDraft,
  useStoryDraftJob,
  useRevalidateStoryDraft,
} from "@/hooks/useStoryDraft";
import { validationPassesForApproval } from "@/lib/validation/casna";
import type { Project } from "@/hooks/useProjects";
import type { StoryDraftRequest } from "@/lib/validation/story";

export function StoryDraftWorkspace({ project }: { project: Project }) {
  const router = useRouter();
  const projectId = project.id;
  const query = useStoryDraft(projectId);
  const start = useStartStoryDraft(projectId);
  const approve = useApproveStoryDraft(projectId);
  const [instruction, setInstruction] = useState("");

  const story = query.data?.story ?? null;
  const job = query.data?.job ?? null;
  const jobId = job?.id ?? null;
  const jobQuery = useStoryDraftJob(projectId, jobId);
  const activeJob = jobQuery.data?.job ?? job;
  const revalidate = useRevalidateStoryDraft(projectId, story?.id);
  const isGenerating =
    activeJob?.status === "queued" || activeJob?.status === "processing";
  const isFailed = activeJob?.status === "failed" || story?.status === "failed";
  const isApproved = story?.status === "approved";
  const pending = start.isPending || approve.isPending || revalidate.isPending || isGenerating;

  const validationFindings = story?.validationFindings;
  const hasValidationErrors = Boolean(
    validationFindings && !validationPassesForApproval(validationFindings),
  );

  function startGeneration(operation: StoryDraftRequest["operation"]) {
    setInstruction("");
    start.mutate({
      operation,
      instruction: instruction.trim() || undefined,
      creativeDirection: project.tone || undefined,
    });
  }

  function fixAllBlocking() {
    const blockingFindings = validationFindings?.findings.filter(
      (f) => f.severity === "error" && f.resolutionStatus !== "accepted_as_intentional" && f.resolutionStatus !== "resolved",
    ) ?? [];
    const summary = blockingFindings.map((f, i) => `${i + 1}. ${f.message}`).join("\n");
    start.mutate({
      operation: "revise",
      instruction: `Fix all blocking validation issues:\n${summary}`,
      creativeDirection: project.tone || undefined,
    });
  }

  const blockingFindingCount = validationFindings?.findings.filter(
    (f) => f.severity === "error" && f.resolutionStatus !== "accepted_as_intentional" && f.resolutionStatus !== "resolved",
  ).length ?? 0;

  const error = start.error ?? approve.error;
  const errorMessage =
    error instanceof ApiError
      ? error.message
      : error
      ? "The story draft request could not be completed."
      : null;
  const errorFindings = error instanceof ApiError ? error.findings : undefined;
  const jobError =
    activeJob?.status === "failed"
      ? activeJob.error?.message ?? "Story generation failed."
      : null;


  return (
    <div className="mt-6 grid gap-6">
      {query.isLoading ? <p className="text-[#a39b8f]">Loading story draft</p> : null}
      {query.isError ? <p className="text-[#e7b2a8]">The story draft could not be loaded.</p> : null}

      {isGenerating && activeJob ? (
        <div className="rounded border border-[#39342d] p-4">
          <p role="status" className="text-sm text-[#dfc18a]">
            {activeJob.progress?.message ?? "Generating story draft…"}
          </p>
        </div>
      ) : null}

      {isFailed ? (
        <div className="rounded border border-[#6b3a32] p-4">
          <p role="alert" className="text-sm text-[#e7b2a8]">
            {jobError ?? "Story generation failed. You can retry."}
          </p>
          {activeJob?.error?.findings && activeJob.error.findings.length > 0 ? (
            <ul className="mt-2 grid gap-1">
              {activeJob.error.findings.map((finding, index) => (
                <li key={index} className={`text-xs ${finding.severity === "error" ? "text-[#e7b2a8]" : "text-[#a39b8f]"}`}>
                  [{finding.severity}] {finding.category}
                  {finding.sceneNumber ? ` (scene ${finding.sceneNumber})` : ""}: {finding.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {story && story.status === "awaiting_approval" && hasValidationErrors && !isGenerating ? (
        <div className="rounded border border-[#6b3a32] p-4">
          <p className="text-sm text-[#dfc18a]">
            Needs revision — {blockingFindingCount} blocking issue{blockingFindingCount > 1 ? "s" : ""} found.
            The complete story is shown below. Use “Fix all blocking issues”, revise with instructions, or regenerate.
          </p>
        </div>
      ) : null}

      {story && story.status === "awaiting_approval" && !hasValidationErrors && !isGenerating ? (
        <div className="rounded border border-[#3a4a32] p-4">
          <p className="text-sm text-[#7a9a6a]">
            Ready for approval — validation passed.
          </p>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded border border-[#6b3a32] p-4">
          <p role="alert" className="text-sm text-[#e7b2a8]">{errorMessage}</p>
          {errorFindings && errorFindings.length > 0 ? (
            <ul className="mt-2 grid gap-1">
              {errorFindings.map((finding, index) => (
                <li key={index} className={`text-xs ${finding.severity === "error" ? "text-[#e7b2a8]" : "text-[#a39b8f]"}`}>
                  [{finding.severity}] {finding.category}
                  {finding.sceneNumber ? ` (scene ${finding.sceneNumber})` : ""}: {finding.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {story && validationFindings && validationFindings.findings.length > 0 ? (
        <ActionableFindings
          validation={validationFindings}
          projectId={projectId}
          storyId={story.id}
          disabled={pending}
        />
      ) : null}

      {story ? <StoryReview story={story} hideValidationFindings /> : null}

      {story && story.provider ? (
        <p className="text-sm text-[#a39b8f]">
          Generated by {story.provider}{story.model ? ` (${story.model})` : ""}.
        </p>
      ) : null}

      {isApproved ? (
        <div className="rounded border border-[#39342d] p-4">
          <p className="text-sm text-[#c4a574]">Story approved — version {story.version}.</p>
          <p className="mt-1 text-xs text-[#a39b8f]">
            You can revise the story at any time. Revising an approved story will flag the Story Bible for review.
          </p>
        </div>
      ) : null}

      {/* Revision instructions */}
      {story && !isApproved ? (
        <div className="grid gap-2 text-sm">
          {hasValidationErrors ? (
            <p className="text-xs text-[#dfc18a]">
              The draft has validation errors listed above. Describe how to fix them, or regenerate from scratch.
            </p>
          ) : null}
          <label className="grid gap-2">
            <span>Revision instructions (optional)</span>
            <textarea
              className="studio-field min-h-24"
              maxLength={2000}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={hasValidationErrors
                ? "e.g. Fix scene 3: the character Sarah has not been introduced yet. Add her entrance before her dialogue."
                : "Describe changes you want, or leave blank to regenerate from scratch"}
            />
          </label>
        </div>
      ) : null}

      {isApproved ? (
        <label className="grid gap-2 text-sm">
          <span>Request changes (optional)</span>
          <textarea
            className="studio-field min-h-20"
            maxLength={2000}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Describe what you'd like to change in the approved story"
          />
        </label>
      ) : null}

      {/* Action buttons — one obvious next action */}
      <div className="flex flex-wrap gap-3">
        {!story || story.status === "failed" ? (
          <Button disabled={pending} onClick={() => startGeneration("generate")}>
            {isGenerating ? "Generating…" : start.isPending ? "Queueing…" : "Generate story draft"}
          </Button>
        ) : null}

        {story && story.status === "awaiting_approval" && hasValidationErrors && !isGenerating ? (
          <Button disabled={pending} onClick={fixAllBlocking}>
            Fix all blocking issues ({blockingFindingCount})
          </Button>
        ) : null}

        {story && story.status === "awaiting_approval" && !isGenerating ? (
          <Button disabled={pending} onClick={() => startGeneration("revise")}>
            {isGenerating ? "Generating…" : instruction.trim() ? "Revise draft" : "Revise (add instructions below)"}
          </Button>
        ) : null}

        {story && story.status === "awaiting_approval" && !isGenerating ? (
          <Button variant="quiet" disabled={pending} onClick={() => startGeneration("regenerate")}>
            Regenerate from scratch
          </Button>
        ) : null}

        {story && story.status === "awaiting_approval" && !isGenerating ? (
          <Button variant="quiet" disabled={pending} onClick={() => revalidate.mutate()}>
            {revalidate.isPending ? "Revalidating…" : "Revalidate"}
          </Button>
        ) : null}

        {story && story.status === "awaiting_approval" && !isGenerating ? (
          <Button disabled={pending || hasValidationErrors} onClick={() => approve.mutate(story.id)}>
            {approve.isPending ? "Approving…" : hasValidationErrors ? "Resolve validation errors first" : "Approve story and continue"}
          </Button>
        ) : null}

        {isApproved && instruction.trim() ? (
          <Button disabled={pending} onClick={() => startGeneration("revise")}>
            {isGenerating ? "Generating…" : "Revise approved story"}
          </Button>
        ) : null}

        {isApproved && !isGenerating ? (
          <Button onClick={() => router.push(`/projects/${projectId}/plan`)}>
            Continue to Season Plan →
          </Button>
        ) : null}
      </div>

      {!story && !isGenerating ? (
        <p className="text-sm text-[#a39b8f]">
          The story draft is generated from your project idea and settings. Review it, request changes if needed, then approve to proceed.
        </p>
      ) : null}
    </div>
  );
}
