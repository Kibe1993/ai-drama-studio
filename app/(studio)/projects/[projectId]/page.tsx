"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectHeader } from "@/components/workflow/ProjectHeader";
import { Button } from "@/components/ui/button";
import { useWorkflow } from "@/hooks/useWorkflow";
import { useProject } from "@/hooks/useProjects";
import {
  WORKFLOW_STAGE_LABELS,
  WORKFLOW_STAGE_PATH,
  WORKFLOW_STAGE_PHASES,
  WORKFLOW_STAGES,
  type WorkflowStage,
} from "@/lib/domain/workflow";
import styles from "./dashboard.module.css";

const PHASE_LABELS: Record<string, string> = {
  creative: "Creative",
  structural: "Structural",
  production: "Production",
  output: "Output",
};

function ContinueButton({ projectId, stage }: { projectId: string; stage: WorkflowStage }) {
  return (
    <Link href={`/projects/${projectId}/${WORKFLOW_STAGE_PATH[stage]}`}>
      <Button>Continue to {WORKFLOW_STAGE_LABELS[stage]} →</Button>
    </Link>
  );
}

export default function ProjectPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const query = useProject(projectId);
  const workflow = useWorkflow(projectId);

  const project = query.data?.project;
  const stage = workflow.data?.stage;
  const steps = workflow.data?.steps ?? [];

  const phases = ["creative", "structural", "production", "output"] as const;
  const stepsByPhase = phases.map((phase) => ({
    phase,
    stages: WORKFLOW_STAGES.filter((s) => WORKFLOW_STAGE_PHASES[s] === phase),
  }));

  function stepState(s: WorkflowStage): string {
    const step = steps.find((st) => st.stage === s);
    return step?.state ?? "upcoming";
  }

  return (
    <div className={styles.page}>
      <ProjectHeader projectId={projectId} />
      {project && stage ? (
        <div className={styles.progressCard}>
          <p className={styles.currentStage}>You are at</p>
          <p className={styles.stageName}>{WORKFLOW_STAGE_LABELS[stage]}</p>
          <div className={styles.continueBtn}>
            <ContinueButton projectId={projectId} stage={stage} />
          </div>
          {workflow.data?.blockedReason ? (
            <p className={styles.blocked}>{workflow.data.blockedReason}</p>
          ) : null}

          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Story</p>
              <p className={styles.statValue}>{workflow.data?.story.approved ? "Approved" : workflow.data?.story.exists ? "Draft" : "—"}</p>
              {workflow.data?.story.awaitingApproval ? <p className={styles.statDetail}>Awaiting approval</p> : null}
            </div>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Story Bible</p>
              <p className={styles.statValue}>{workflow.data?.bible.approved ? `v${workflow.data.bible.approvedVersion}` : "—"}</p>
              {workflow.data?.bible.generating ? <p className={styles.statDetail}>Generating…</p> : null}
            </div>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Season Plan</p>
              <p className={styles.statValue}>{workflow.data?.plan.approved ? `v${workflow.data.plan.version}` : workflow.data?.plan.exists ? "Draft" : "—"}</p>
              {workflow.data?.plan.needsReview ? <p className={styles.statDetail}>Needs review</p> : null}
            </div>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Episodes</p>
              <p className={styles.statValue}>{workflow.data?.episodes.total ?? 0}</p>
              <p className={styles.statDetail}>{workflow.data?.episodes.open ?? 0} open · {workflow.data?.episodes.needingReview ?? 0} review</p>
            </div>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Production</p>
              <p className={styles.statValue}>{workflow.data?.production.started ? "Active" : "Idle"}</p>
            </div>
          </div>

          <div className={styles.pipeline}>
            <p className={styles.pipelineTitle}>Pipeline Progress</p>
            {stepsByPhase.map((group) => (
              <div key={group.phase} className={styles.phaseGroup}>
                <p className={styles.phaseLabel}>{PHASE_LABELS[group.phase]}</p>
                <div className={styles.phaseSteps}>
                  {group.stages.map((s) => {
                    const state = stepState(s);
                    const cls = state === "completed" ? styles.stepCompleted : state === "current" ? styles.stepCurrent : "";
                    const dotCls = state === "completed" ? styles.stepDotCompleted : state === "current" ? styles.stepDotCurrent : "";
                    return (
                      <Link
                        key={s}
                        href={`/projects/${projectId}/${WORKFLOW_STAGE_PATH[s]}`}
                        className={`${styles.stepLink} ${cls}`}
                      >
                        <span className={`${styles.stepDot} ${dotCls}`} />
                        {WORKFLOW_STAGE_LABELS[s]}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
