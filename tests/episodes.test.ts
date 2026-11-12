import { describe, expect, it } from "vitest";
import type { RequestAuth } from "@/lib/auth/session";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { EpisodeRecord } from "@/lib/validation/episode";
import type { StoryBibleRecord } from "@/lib/validation/storyBible";
import { createEpisodeService } from "@/lib/services/episodeService";

const actor: RequestAuth = {
  userId: "episode-owner",
  isAdmin: false,
  email: "owner@example.com",
  name: "Owner",
  imageUrl: "",
};
const projectId = "a".repeat(24);
const now = new Date().toISOString();

function project(productionMode: ProjectRecord["productionMode"]): ProjectRecord {
  return {
    id: projectId,
    title: "The inheritance",
    originalStoryIdea: "A family uncovers a secret.",
    genre: "family",
    language: "en",
    visualStyle: "realistic",
    tone: "dramatic",
    targetDurationSeconds: 300,
    aspectRatio: "16:9",
    status: "draft",
    workflowMode: "guided",
    productionType: "fictional_drama",
    productionMode,
    createdAt: now,
    updatedAt: now,
  };
}

function harness(mode: ProjectRecord["productionMode"], approvedVersion = 0) {
  const episodes: EpisodeRecord[] = [];
  const projects = [project(mode)];
  const service = createEpisodeService(
    {
      async listOwned(userId, id) {
        return userId === actor.userId && id === projectId ? episodes : null;
      },
      async create(userId, id, input, baseSnapshotVersion) {
        if (userId !== actor.userId || id !== projectId) return null;
        const row: EpisodeRecord = {
          ...input,
          id: String(episodes.length + 1).padStart(24, "0"),
          clerkUserId: userId,
          projectId: id,
          episodeNumber: episodes.length + 1,
          status: "draft",
          currentStoryId: null,
          baseSnapshotVersion,
          createdAt: now,
          updatedAt: now,
        };
        episodes.push(row);
        return row;
      },
    },
    { async findOwned(userId, id) { return userId === actor.userId && id === projectId ? projects[0]! : null; } },
    { async findLatest() { return null; } },
    { async findOwned(userId, id) {
      if (userId !== actor.userId || id !== projectId || approvedVersion === 0) return null;
      return { approvedVersion } as unknown as StoryBibleRecord;
    } },
  );
  return { service, episodes };
}

describe("episode continuity", () => {
  it("numbers episodes in order and binds later serialized episodes to an approved canon version", async () => {
    const { service, episodes } = harness("serialized", 3);
    const first = await service.create(actor, projectId, { title: "Arrival", premise: "The secret surfaces.", targetDurationSeconds: 300 });
    const second = await service.create(actor, projectId, { title: "Consequences", premise: "The family responds.", targetDurationSeconds: 600 });
    expect([first.episodeNumber, second.episodeNumber]).toEqual([1, 2]);
    expect(first.baseSnapshotVersion).toBe(3);
    expect(second.baseSnapshotVersion).toBe(3);
    expect(episodes).toHaveLength(2);
  });

  it("requires approved canon before creating the next serialized episode", async () => {
    const { service } = harness("serialized");
    await service.create(actor, projectId, { title: "Arrival", premise: "", targetDurationSeconds: 300 });
    await expect(service.create(actor, projectId, { title: "Aftermath", premise: "", targetDurationSeconds: 300 }))
      .rejects.toMatchObject({ code: "canon_required" });
  });

  it("does not expose another owner's project episodes", async () => {
    const { service } = harness("standalone");
    await expect(service.list({ ...actor, userId: "another-user" }, projectId))
      .rejects.toMatchObject({ code: "not_found" });
  });
});
