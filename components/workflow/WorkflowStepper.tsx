"use client";

import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WORKFLOW_STAGE_PATH,
  type WorkflowStep,
  type WorkflowStepState,
} from "@/lib/domain/workflow";

function stateLabel(state: WorkflowStepState): string | null {
  if (state === "awaiting_approval") return "Needs approval";
  if (state === "upcoming") return "Locked";
  return null;
}

/**
 * The guided progression: Story Bible → Story draft → Season Plan → Episodes → Production.
 * Completed and current stages link; upcoming stages are shown but locked.
 */
export function WorkflowStepper({
  projectId,
  steps,
  activeStage,
}: {
  projectId: string;
  steps: WorkflowStep[];
  activeStage: string;
}) {
  return (
    <ol className="mt-6 flex flex-wrap items-stretch gap-2 text-sm">
      {steps.map((step, index) => {
        const href = `/projects/${projectId}/${WORKFLOW_STAGE_PATH[step.stage]}`;
        const reachable = step.state !== "upcoming";
        const active = step.stage === activeStage;
        const note = stateLabel(step.state);
        const content = (
          <>
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                  step.state === "completed" && "border-[#6f8f6a] bg-[#26301f] text-[#bcd8b1]",
                  step.state === "current" && "border-[#c4a574] text-[#f3efe6]",
                  step.state === "awaiting_approval" && "border-[#dfc18a] text-[#dfc18a]",
                  step.state === "upcoming" && "border-[#4a453d] text-[#6f675d]"
                )}
              >
                {step.state === "completed" ? <Check size={12} strokeWidth={2.5} /> : step.state === "upcoming" ? <Lock size={11} strokeWidth={2} /> : index + 1}
              </span>
              <span className={cn("text-[#cfc6b8]", active && "text-[#f3efe6]")}>{step.label}</span>
            </span>
            {note ? (
              <span className={cn("mt-1 block text-xs", step.state === "awaiting_approval" ? "text-[#dfc18a]" : "text-[#6f675d]")}>
                {note}
              </span>
            ) : null}
          </>
        );
        return (
          <li key={step.stage} className="min-w-[150px] flex-1">
            {reachable ? (
              <Link
                href={href}
                className={cn(
                  "block h-full border px-3 py-2",
                  active ? "border-[#c4a574] bg-[#241f19]" : "border-[#2e2a25] hover:border-[#4a453d]"
                )}
              >
                {content}
              </Link>
            ) : (
              <div aria-disabled className="block h-full border border-[#2e2a25] px-3 py-2 opacity-70">
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
