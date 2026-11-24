import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { workflowService } from "@/lib/services/workflowService";
import { planningService } from "@/lib/services/planningService";
import { seasonPlanService } from "@/lib/services/seasonPlanService";
import { createStorageProvider } from "@/lib/providers/storage/registry";
import { createVisualAssetService } from "@/lib/services/visualAssetService";
import { productionSceneService } from "@/lib/services/productionSceneService";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";

type Context = { params: Promise<{ projectId: string }> };

type PendingItem = {
  id: string;
  type: "story" | "bible" | "planning" | "plan" | "entity" | "scene" | "episode" | "media";
  label: string;
  description: string;
  href: string;
  status: string;
};

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;

    const items: PendingItem[] = [];

    const visualAssetService = createVisualAssetService(createStorageProvider());

    const [workflow, planning, planResult, characters, environments, objects, sceneResult, storyDraft, bible] = await Promise.allSettled([
      workflowService.get(actor, projectId),
      planningService.get(actor, projectId),
      seasonPlanService.get(actor, projectId),
      visualAssetService.listEntities(actor, projectId, "character"),
      visualAssetService.listEntities(actor, projectId, "location"),
      visualAssetService.listEntities(actor, projectId, "object"),
      productionSceneService.list(actor, projectId),
      storyRepository.findProjectDraft(actor.userId, projectId),
      storyBibleRepository.findOwned(actor.userId, projectId),
    ]);

    if (workflow.status === "fulfilled") {
      const wf = workflow.value;
      if (wf.story.awaitingApproval) {
        items.push({
          id: "story-draft",
          type: "story",
          label: "Story Draft",
          description: "Story draft is awaiting approval",
          href: `/projects/${projectId}/story`,
          status: "awaiting_approval",
        });
      }
      if (wf.bible.draftReady && !wf.bible.approved) {
        items.push({
          id: "story-bible",
          type: "bible",
          label: "Story Bible",
          description: `Story Bible draft v${wf.bible.draftRevision} ready for approval`,
          href: `/projects/${projectId}/bible`,
          status: "draft_ready",
        });
      }
      if (wf.plan.awaitingApproval) {
        items.push({
          id: "season-plan",
          type: "plan",
          label: "Season Plan",
          description: "Season plan is awaiting approval",
          href: `/projects/${projectId}/episodes`,
          status: "awaiting_approval",
        });
      }
      if (wf.plan.needsReview) {
        items.push({
          id: "season-plan-review",
          type: "plan",
          label: "Season Plan Review",
          description: "Story Bible changed since plan was approved — review for continuity",
          href: `/projects/${projectId}/episodes`,
          status: "needs_review",
        });
      }
      const needingReview = wf.episodes.needingReview;
      if (needingReview > 0) {
        items.push({
          id: "episodes-needing-review",
          type: "episode",
          label: `${needingReview} Episode${needingReview > 1 ? "s" : ""} Need${needingReview > 1 ? "" : "s"} Review`,
          description: `${needingReview} episode${needingReview > 1 ? "s were" : " was"} written from an older approved version`,
          href: `/projects/${projectId}/episodes`,
          status: "needs_review",
        });
      }
    }

    if (planning.status === "fulfilled" && planning.value) {
      const p = planning.value;
      if (p.status === "submitted") {
        items.push({
          id: p.id,
          type: "planning",
          label: "Planning Document",
          description: `Planning document v${p.version} submitted for review`,
          href: `/projects/${projectId}/planning`,
          status: "submitted",
        });
      }
    }

    if (planResult.status === "fulfilled" && planResult.value?.plan) {
      const plan = planResult.value.plan;
      if (plan.status === "awaiting_approval") {
        items.push({
          id: plan.id,
          type: "plan",
          label: "Season Plan",
          description: `Season plan v${plan.version} awaiting approval`,
          href: `/projects/${projectId}/episodes`,
          status: "awaiting_approval",
        });
      }
    }

    const allEntities = [
      ...(characters.status === "fulfilled" ? characters.value : []),
      ...(environments.status === "fulfilled" ? environments.value : []),
      ...(objects.status === "fulfilled" ? objects.value : []),
    ];
    for (const entity of allEntities) {
      if (entity.status === "pending_review") {
        items.push({
          id: entity.id,
          type: "entity",
          label: entity.name,
          description: `${entity.entityType} pending review`,
          href: `/projects/${projectId}/characters`,
          status: "pending_review",
        });
      }
    }

    if (sceneResult.status === "fulfilled") {
      for (const scene of sceneResult.value.scenes) {
        if (!scene.approvedAt) {
          items.push({
            id: scene.id,
            type: "scene",
            label: `Scene ${scene.sceneNumber}: ${scene.title}`,
            description: `Scene ${scene.sceneNumber} not yet approved`,
            href: `/projects/${projectId}/scenes`,
            status: "draft",
          });
        }
      }
    }

    if (storyDraft.status === "fulfilled" && storyDraft.value && storyDraft.value.status === "awaiting_approval") {
      if (!items.some((i) => i.type === "story")) {
        items.push({
          id: storyDraft.value.id,
          type: "story",
          label: "Story Draft",
          description: "Story draft is awaiting approval",
          href: `/projects/${projectId}/story`,
          status: "awaiting_approval",
        });
      }
    }

    if (bible.status === "fulfilled" && bible.value && !bible.value.approvedVersion && bible.value.draftRevision > 0) {
      if (!items.some((i) => i.type === "bible")) {
        items.push({
          id: bible.value.id,
          type: "bible",
          label: "Story Bible",
          description: `Story Bible draft v${bible.value.draftRevision} ready for approval`,
          href: `/projects/${projectId}/bible`,
          status: "draft_ready",
        });
      }
    }

    return jsonData({ items, total: items.length });
  });
}