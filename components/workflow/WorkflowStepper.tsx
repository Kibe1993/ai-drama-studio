"use client";

import Link from "next/link";
import { useWorkflow } from "@/hooks/useWorkflow";
import type { WorkflowStepState } from "@/lib/domain/workflow";
import { WORKFLOW_STAGE_LABELS, WORKFLOW_STAGE_PATH, WORKFLOW_STAGES } from "@/lib/domain/workflow";

const STATE_STYLES: Record<WorkflowStepState, { dot: string; text: string; label: string }> = {
  completed: { dot: "bg-[#c4a574] text-[#1a1815]", text: "text-[#cfc6b8]", label: "Completed" },
  awaiting_approval: { dot: "bg-[#dfc18a] text-[#1a1815]", text: "text-[#dfc18a]", label: "Needs your approval" },
  current: { dot: "bg-[#f3efe6] text-[#1a1815]", text: "text-[#f3efe6]", label: "Current stage" },
  upcoming: { dot: "bg-[#39342d] text-[#6f675d]", text: "text-[#6f675d]", label: "Upcoming" },
};

export function WorkflowStepper({ projectId }: { projectId: string }) {
  const query = useWorkflow(projectId);
  const workflow = query.data;

  if (!workflow) {
    return (
      <nav className="mt-6 flex flex-wrap gap-2 text-sm text-[#6f675d]">
        {WORKFLOW_STAGES.map((stage) => (
          <span key={stage} className="rounded border border-[#2e2a25] px-3 py-1.5">
            {WORKFLOW_STAGE_LABELS[stage]}
          </span>
        ))}
      </nav>
    );
  }

  return (
    <nav className="mt-6" aria-label="Workflow progress">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        {workflow.steps.map((step, index) => {
          const style = STATE_STYLES[step.state];
          const href = `/projects/${projectId}/${WORKFLOW_STAGE_PATH[step.stage]}`;
          const isUpcoming = step.state === "upcoming";
          return (
            <li key={step.stage} className="flex items-center gap-2">
              {index > 0 ? <span className="text-[#39342d]" aria-hidden="true">→</span> : null}
              <Link
                href={href}
                className={`flex items-center gap-2 rounded border px-3 py-1.5 transition-colors ${
                  isUpcoming
                    ? "border-[#2e2a25] opacity-60 hover:opacity-100"
                    : "border-[#39342d] hover:border-[#c4a574]"
                } ${style.text}`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium ${style.dot}`}
                  aria-hidden="true"
                >
                  {step.state === "completed" ? "✓" : index + 1}
                </span>
                <span>{step.label}</span>
              </Link>
              {step.state === "awaiting_approval" ? (
                <span className="text-xs text-[#dfc18a]" title={style.label}>
                  ●
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {workflow.blockedReason ? (
        <p className="mt-3 text-sm text-[#dfc18a]">{workflow.blockedReason}</p>
      ) : null}
    </nav>
  );
}
