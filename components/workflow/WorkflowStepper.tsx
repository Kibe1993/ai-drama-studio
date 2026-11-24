"use client";

import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WORKFLOW_STAGE_PATH,
  WORKFLOW_STAGE_PHASES,
  type WorkflowStep,
  type WorkflowStepState,
  type WorkflowStage,
} from "@/lib/domain/workflow";

function stateLabel(state: WorkflowStepState): string | null {
  if (state === "awaiting_approval") return "Needs approval";
  if (state === "upcoming") return "Locked";
  return null;
}

const PHASE_LABELS: Record<string, string> = {
  creative: "Creative",
  structural: "Structural",
  production: "Production",
  output: "Output",
};

export function WorkflowStepper({
  projectId,
  steps,
  activeStage,
}: {
  projectId: string;
  steps: WorkflowStep[];
  activeStage: string;
}) {
  const phases = ["creative", "structural", "production", "output"] as const;
  const stepMap = new Map(steps.map((s) => [s.stage, s]));

  return (
    <div className="mt-6 flex flex-wrap items-stretch gap-3 text-sm">
      {phases.map((phase) => {
        const phaseStages = (Object.keys(WORKFLOW_STAGE_PHASES) as WorkflowStage[]).filter(
          (stage) => WORKFLOW_STAGE_PHASES[stage] === phase
        );
        return (
          <div key={phase} className="flex-1 min-w-[180px]">
            <p className="text-xs text-[#6f675d] mb-1">{PHASE_LABELS[phase]}</p>
            <ol className="grid gap-1">
              {phaseStages.map((stage) => {
                const step = stepMap.get(stage);
                if (!step) return null;
                const href = `/projects/${projectId}/${WORKFLOW_STAGE_PATH[stage]}`;
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
                        {step.state === "completed" ? <Check size={12} strokeWidth={2.5} /> : step.state === "upcoming" ? <Lock size={11} strokeWidth={2} /> : ""}
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
                  <li key={step.stage}>
                    {reachable ? (
                      <Link
                        href={href}
                        className={cn(
                          "block border px-3 py-1.5 rounded",
                          active ? "border-[#c4a574] bg-[#241f19]" : "border-[#2e2a25] hover:border-[#4a453d]"
                        )}
                      >
                        {content}
                      </Link>
                    ) : (
                      <div aria-disabled className="block border border-[#2e2a25] px-3 py-1.5 rounded opacity-70">
                        {content}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
