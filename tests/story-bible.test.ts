import { describe, expect, it } from "vitest";
import { createStoryBibleService } from "@/lib/services/storyBibleService";
import { storyBibleDraftSchema } from "@/lib/validation/storyBible";
import type { RequestAuth } from "@/lib/auth/session";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { StoryBibleDraft, StoryBibleRecord, StoryBibleSnapshot } from "@/lib/validation/storyBible";

const owner: RequestAuth = { userId: "owner", isAdmin: false, email: "", name: "", imageUrl: "" };
const other: RequestAuth = { ...owner, userId: "other" };
const projectId = "a".repeat(24);

type OwnedProject = ProjectRecord & { clerkUserId: string };

function project(clerkUserId: string): OwnedProject {
  return {
    id: projectId,
    title: "Pilot",
    originalStoryIdea: "",
    genre: "family",
    language: "en",
    visualStyle: "realistic",
    tone: "dramatic",
    targetDurationSeconds: 60,
    aspectRatio: "16:9",
    status: "draft",
    workflowMode: "guided",
    productionType: "fictional_drama",
    productionMode: "serialized",
    createdAt: "",
    updatedAt: "",
    clerkUserId,
  };
}

function memory() {
  let row: StoryBibleRecord | null = null;
  let id = 0;
  const projects = [project(owner.userId)];
  const repo = {
    async findOwned(userId: string, pid: string) {
      if (pid !== projectId || !projects.some((item) => item.clerkUserId === userId)) return null;
      return row;
    },
    async saveDraft(userId: string, pid: string, draft: StoryBibleDraft) {
      if (pid !== projectId || !projects.some((item) => item.clerkUserId === userId)) return null;
      id += 1;
      row = {
        ...draft,
        sourceIdea: draft.sourceIdea ?? "",
        creativeDirection: draft.creativeDirection ?? "",
        creatorDecisions: draft.creatorDecisions ?? [],
        id: "b".repeat(24),
        clerkUserId: userId,
        projectId: pid,
        approvedVersion: row?.approvedVersion ?? 0,
        draftRevision: (row?.draftRevision ?? 0) + 1,
        approvedSnapshot: row?.approvedSnapshot ?? null,
        approvedSnapshots: row?.approvedSnapshots ?? [],
        generationStatus: row?.generationStatus ?? "idle",
        generationJobId: row?.generationJobId ?? null,
        generationError: row?.generationError ?? null,
        createdAt: "",
        updatedAt: String(id),
      };
      return row;
    },
    async approve(userId: string, pid: string, expectedVersion: number, expectedRevision: number) {
      if (!row || row.clerkUserId !== userId || pid !== projectId || row.approvedVersion !== expectedVersion || row.draftRevision !== expectedRevision) return null;
      const snapshot: StoryBibleSnapshot = {
        premise: row.premise,
        worldRules: [...row.worldRules],
        themes: [...row.themes],
        boundaries: [...row.boundaries],
        canonFacts: [...row.canonFacts],
        version: expectedVersion + 1,
        createdAt: "now",
      };
      row = { ...row, approvedVersion: snapshot.version, approvedSnapshot: snapshot, approvedSnapshots: [...row.approvedSnapshots, snapshot] };
      return row;
    },
  };
  return { repo, projects, get row() { return row; } };
}

describe("Story Bible approval", () => {
  it("keeps saved drafts out of generation context until explicit approval", async () => {
    const store = memory();
    const service = createStoryBibleService(store.repo, {
      async findOwned(userId, pid) { return store.projects.find((item) => item.id === pid && item.clerkUserId === userId) ?? null; },
    });
    const initial = await service.get(owner, projectId);
    const draft = await service.save(owner, projectId, storyBibleDraftSchema.parse({
      premise: "A family protects an old secret.",
      canonFacts: ["The clock stopped at midnight."],
    }));
    expect(draft.approvedSnapshot).toBeNull();
    const approved = await service.approve(owner, projectId, initial.approvedVersion, draft.draftRevision);
    expect(approved.approvedSnapshot?.premise).toContain("family");
    expect(approved.approvedSnapshots).toHaveLength(1);
  });

  it("rejects stale approvals after the draft changes", async () => {
    const store = memory();
    const service = createStoryBibleService(store.repo, {
      async findOwned(userId, pid) { return store.projects.find((item) => item.id === pid && item.clerkUserId === userId) ?? null; },
    });
    const initial = await service.get(owner, projectId);
    const oldDraft = await service.save(owner, projectId, { premise: "Version one", worldRules: [], themes: [], boundaries: [], canonFacts: [] });
    await service.save(owner, projectId, { premise: "Version two", worldRules: [], themes: [], boundaries: [], canonFacts: [] });
    await expect(service.approve(owner, projectId, initial.approvedVersion, oldDraft.draftRevision)).rejects.toMatchObject({ code: "stale_bible" });
    expect(store.row?.approvedSnapshots).toHaveLength(0);
  });

  it("retains prior approved snapshots as history", async () => {
    const store = memory();
    const service = createStoryBibleService(store.repo, {
      async findOwned(userId, pid) { return store.projects.find((item) => item.id === pid && item.clerkUserId === userId) ?? null; },
    });
    const initial = await service.get(owner, projectId);
    const firstDraft = await service.save(owner, projectId, { premise: "First canon", worldRules: [], themes: [], boundaries: [], canonFacts: [] });
    const first = await service.approve(owner, projectId, initial.approvedVersion, firstDraft.draftRevision);
    const secondDraft = await service.save(owner, projectId, { premise: "Updated canon", worldRules: [], themes: [], boundaries: [], canonFacts: [] });
    const second = await service.approve(owner, projectId, first.approvedVersion, secondDraft.draftRevision);
    expect(second.approvedSnapshots.map((snapshot) => snapshot.premise)).toEqual(["First canon", "Updated canon"]);
  });

  it("scopes reads, saves, and approvals to the project owner", async () => {
    const store = memory();
    const service = createStoryBibleService(store.repo, {
      async findOwned(userId, pid) { return store.projects.find((item) => item.id === pid && item.clerkUserId === userId) ?? null; },
    });
    await expect(service.get(other, projectId)).rejects.toMatchObject({ code: "not_found" });
    await expect(service.save(other, projectId, { premise: "No", worldRules: [], themes: [], boundaries: [], canonFacts: [] })).rejects.toMatchObject({ code: "not_found" });
  });

  it("prevents changing canon while a production is active", async () => {
    const store = memory();
    const service = createStoryBibleService(store.repo, {
      async findOwned(userId, pid) {
        const value = store.projects.find((item) => item.id === pid && item.clerkUserId === userId);
        return value ? { ...value, status: "generating" as const } : null;
      },
    });
    await expect(service.save(owner, projectId, { premise: "No mid-run edits", worldRules: [], themes: [], boundaries: [], canonFacts: [] })).rejects.toMatchObject({ code: "project_busy" });
  });
});
