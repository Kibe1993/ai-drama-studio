"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Copy, Check, Wrench, Eye, Activity } from "lucide-react";
import styles from "./AssistantHandoffPanel.module.css";
import { useProject } from "@/hooks/useProjects";
import {
  WORKFLOW_STAGE_LABELS,
  type WorkflowStage,
} from "@/lib/domain/workflow";

type StageHandoff = {
  task: string;
  contextTools: string[];
  tools: string[];
};

const STAGE_HANDOFF: Record<WorkflowStage, StageHandoff> = {
  project_setup: {
    task: "Review the project configuration and suggest improvements to genre, tone, visual style, and target audience.",
    contextTools: ["project.get", "project.context"],
    tools: ["project.update"],
  },
  planning: {
    task: "Propose a creative concept, themes, premise, target audience, and narrative direction for this drama.",
    contextTools: ["project.get", "project.context", "planning.get"],
    tools: ["planning.update", "planning.submit"],
  },
  bible: {
    task: "Draft the six Story Bible sections: identity, world, characters, narrative, guidelines, and canon. Submit each section for creator review.",
    contextTools: ["project.get", "project.context", "document.get"],
    tools: ["document.update", "bible.approve"],
  },
  episodes: {
    task: "Propose a season plan with episode arcs, outlines, and cliffhangers. Create episodes after the plan is approved.",
    contextTools: ["project.context", "seasonPlan.get", "episode.list"],
    tools: ["seasonPlan.start", "seasonPlan.update", "seasonPlan.approve", "episode.create"],
  },
  characters: {
    task: "Propose character profiles, relationships, voice descriptions, and location details based on the season plan and story bible.",
    contextTools: ["project.context", "entity.list", "document.get"],
    tools: ["entity.create", "entity.approve", "entity.updateVisualProfile", "voice.assign"],
  },
  scenes: {
    task: "Break the screenplay into ordered scenes with objectives, locations, characters, and emotional progression. Propose shot plans.",
    contextTools: ["project.context", "scene.list", "document.get"],
    tools: ["scene.create", "scene.update", "scene.approveShotPlan"],
  },
  story: {
    task: "Draft the screenplay in 6 sequential parts: opening, inciting incident, investigation, escalation, climax, resolution. Each part is persisted independently.",
    contextTools: ["project.context", "document.get"],
    tools: ["story.createDraft", "episode.updateScreenplay", "story.approve"],
  },
  canon: {
    task: "Query the canon, propose new facts, and resolve contradictions. Canon facts require creator approval.",
    contextTools: ["canon.query", "canon.summary", "project.context"],
    tools: ["canon.add"],
  },
  production_design: {
    task: "Propose shot lists, camera directions, lighting plans, and storyboard descriptions based on the approved screenplay and scene breakdown.",
    contextTools: ["project.context", "productionDesign.get", "scene.list"],
    tools: ["productionDesign.update", "productionDesign.generateShotList"],
  },
  audio: {
    task: "Generate TTS audio for dialogue and narration. Assign voice profiles to characters.",
    contextTools: ["project.context", "media.list", "entity.list"],
    tools: ["media.generate_audio", "voice.assign"],
  },
  video: {
    task: "Generate or upload video assets for scenes and shots. Track shot-level footage.",
    contextTools: ["project.context", "media.list", "scene.list"],
    tools: ["media.upload"],
  },
  timeline: {
    task: "Assemble clips on tracks (video, dialogue, narration, music, SFX, subtitle). Trim, reorder, and set transitions. Validate and approve the timeline.",
    contextTools: ["timeline.get", "timeline.findByEpisode", "project.context"],
    tools: ["timeline.approve"],
  },
  rendering: {
    task: "Start render jobs, check status, and download final output.",
    contextTools: ["project.context", "render.status", "media.list"],
    tools: ["render.start"],
  },
};

type ActivityEntry = {
  id: string;
  timestamp: string;
  tool: string;
  projectId: string | null;
  detail: string;
  result: "success" | "error";
  assistantName: string | null;
};

function buildHandoffPrompt(projectId: string, projectTitle: string, stage: WorkflowStage): string {
  const info = STAGE_HANDOFF[stage];
  const stageLabel = WORKFLOW_STAGE_LABELS[stage];
  const lines: string[] = [];
  lines.push(`You are working on the "${projectTitle}" drama project in AI Drama Studio.`);
  lines.push(`Current stage: ${stageLabel}`);
  lines.push("");
  lines.push(`Your task: ${info.task}`);
  lines.push("");
  lines.push("To get started, call these MCP tools to retrieve context:");
  for (const tool of info.contextTools) lines.push(`  - ${tool}`);
  lines.push("");
  lines.push("Then use these tools to propose changes:");
  for (const tool of info.tools) lines.push(`  - ${tool}`);
  lines.push("");
  lines.push("All changes require creator approval. Use confirm=true for document updates.");
  lines.push(`Project ID: ${projectId}`);
  return lines.join("\n");
}

export function AssistantHandoffPanel({ projectId, stage }: {
  projectId: string;
  stage: WorkflowStage;
}) {
  const projectQuery = useProject(projectId);
  const projectTitle = projectQuery.data?.project.title ?? "Untitled project";
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setEndpoint(`${window.location.origin}/api/mcp`);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setActivitiesLoading(true);
    fetch(`/api/mcp/activity?projectId=${encodeURIComponent(projectId)}&limit=5`)
      .then((res) => res.json())
      .then((data) => {
        setActivities(data.entries ?? []);
        setActivitiesLoading(false);
      })
      .catch(() => setActivitiesLoading(false));
  }, [open, projectId]);

  const handoffPrompt = buildHandoffPrompt(projectId, projectTitle, stage);
  const info = STAGE_HANDOFF[stage];
  const stageLabel = WORKFLOW_STAGE_LABELS[stage];

  const copyPrompt = useCallback(() => {
    navigator.clipboard.writeText(handoffPrompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [handoffPrompt]);

  return (
    <div className={styles.panel}>
      <button type="button" className={styles.header} onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className={styles.headerLeft}>
          <span className={styles.headerBadge}>MCP</span>
          <span className={styles.headerTitle}>Assistant handoff — {stageLabel}</span>
        </div>
        <div className={styles.headerRight}>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {open ? (
        <div className={styles.body}>
          <p className={styles.task}>{info.task}</p>

          <div>
            <div className={styles.sectionLabel}>Context tools (read)</div>
            <div className={styles.toolList}>
              {info.contextTools.map((tool) => (
                <span key={tool} className={`${styles.toolChip} ${styles.toolChipContext}`}>
                  <Eye size={11} /> {tool}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className={styles.sectionLabel}>Action tools (write)</div>
            <div className={styles.toolList}>
              {info.tools.map((tool) => (
                <span key={tool} className={styles.toolChip}>
                  <Wrench size={11} /> {tool}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className={styles.sectionLabel}>Handoff prompt — paste into your AI assistant</div>
            <div className={styles.promptBox}>
              <button type="button" className={styles.copyButton} onClick={copyPrompt} disabled={copied}>
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <pre className={styles.promptText}>{handoffPrompt}</pre>
            </div>
          </div>

          <div className={styles.actions}>
            <Link href="/mcp" className={styles.link}>Full MCP settings →</Link>
            <span className={styles.endpoint}>{endpoint}</span>
          </div>

          <div>
            <div className={styles.sectionLabel}><Activity size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: "0.25rem" }} />Recent activity for this project</div>
            {activitiesLoading ? (
              <p className={styles.activityLoading}>Loading…</p>
            ) : activities.length === 0 ? (
              <p className={styles.activityEmpty}>No MCP activity yet for this project.</p>
            ) : (
              <div className={styles.activityList}>
                {activities.map((entry) => (
                  <div key={entry.id} className={styles.activityItem}>
                    <span className={`${styles.activityDot} ${entry.result === "success" ? styles.activityDotSuccess : styles.activityDotError}`} />
                    <span className={styles.activityTime}>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                    <span className={styles.activityTool}>{entry.tool}</span>
                    <span className={styles.activityDetail}>{entry.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}