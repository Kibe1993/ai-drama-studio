"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectHeader } from "@/components/workflow/ProjectHeader";
import { api } from "@/hooks/api";
import styles from "./review.module.css";

type PendingItem = {
  id: string;
  type: "story" | "bible" | "planning" | "plan" | "entity" | "scene" | "episode" | "media";
  label: string;
  description: string;
  href: string;
  status: string;
};

type ActivityEntry = {
  id: string;
  timestamp: string;
  tool: string;
  detail: string;
  result: "success" | "error";
  assistantName: string | null;
};

const ICON_CLASS: Record<PendingItem["type"], string> = {
  story: styles.iconStory,
  bible: styles.iconBible,
  planning: styles.iconPlanning,
  plan: styles.iconPlan,
  entity: styles.iconEntity,
  scene: styles.iconScene,
  episode: styles.iconEpisode,
  media: styles.iconMedia,
};

const ICON_LABEL: Record<PendingItem["type"], string> = {
  story: "S",
  bible: "B",
  planning: "P",
  plan: "SP",
  entity: "E",
  scene: "Sc",
  episode: "Ep",
  media: "M",
};

function statusClass(status: string): string {
  if (status === "awaiting_approval") return styles.statusAwaiting;
  if (status === "draft" || status === "draft_ready") return styles.statusDraft;
  if (status === "pending_review") return styles.statusPending;
  if (status === "needs_review") return styles.statusNeedsReview;
  if (status === "submitted") return styles.statusSubmitted;
  return styles.statusDraft;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    awaiting_approval: "Awaiting approval",
    draft: "Draft",
    draft_ready: "Draft ready",
    pending_review: "Pending review",
    needs_review: "Needs review",
    submitted: "Submitted",
  };
  return map[status] ?? status;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ReviewPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reviewData, activityData] = await Promise.all([
        api<{ items: PendingItem[]; total: number }>(`/api/projects/${projectId}/review`),
        api<{ entries: ActivityEntry[] }>(`/api/mcp/activity?projectId=${projectId}&limit=20`).catch(() => ({ entries: [] as ActivityEntry[] })),
      ]);
      setItems(reviewData.items);
      setActivity(activityData.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load review items");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className={styles.page}>
      <ProjectHeader projectId={projectId} />
      <div className={styles.header}>
        <h1 className={styles.title}>Review Inbox</h1>
        <p className={styles.subtitle}>All pending items and recent AI assistant activity for this project.</p>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.loading}>Loading…</p> : null}

      {!loading && items && items.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nothing pending</p>
          <p>All items are approved or no drafts have been created yet.</p>
        </div>
      ) : null}

      <div className={styles.list}>
        {items?.map((item) => (
          <Link key={item.id} href={item.href} className={styles.item}>
            <div className={styles.itemLeft}>
              <span className={`${styles.itemIcon} ${ICON_CLASS[item.type]}`}>
                {ICON_LABEL[item.type]}
              </span>
              <div className={styles.itemText}>
                <span className={styles.itemLabel}>{item.label}</span>
                <span className={styles.itemDesc}>{item.description}</span>
              </div>
            </div>
            <span className={`${styles.itemStatus} ${statusClass(item.status)}`}>
              {statusLabel(item.status)}
            </span>
          </Link>
        ))}
      </div>

      {activity.length > 0 ? (
        <div className={styles.activitySection}>
          <p className={styles.activityTitle}>Recent AI Assistant Activity</p>
          <div className={styles.activityList}>
            {activity.map((entry) => (
              <div key={entry.id} className={styles.activityRow}>
                <span className={`${styles.activityDot} ${entry.result === "success" ? styles.dotSuccess : styles.dotError}`} />
                <span className={styles.activityTime}>{formatTime(entry.timestamp)}</span>
                <span className={styles.activityTool}>{entry.tool}</span>
                <span className={styles.activityDetail}>{entry.detail}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}