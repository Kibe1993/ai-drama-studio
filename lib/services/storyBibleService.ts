import "server-only";
import type { RequestAuth } from "@/lib/auth/session";
import { isBusyStatus } from "@/lib/domain/projectCatalog";
import { isObjectId } from "@/lib/repositories/ownership";
import { projectRepository, type ProjectRecord } from "@/lib/repositories/projectRepository";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { StudioError } from "@/lib/http/errors";
import type { StoryBibleDraft, StoryBibleRecord } from "@/lib/validation/storyBible";

export type StoryBiblePort = Pick<typeof storyBibleRepository, "findOwned" | "saveDraft" | "approve">;
type ProjectReader = Pick<typeof projectRepository, "findOwned">;

function bibleHasContent(bible: StoryBibleRecord | null): boolean {
  if (!bible) return false;
  return (
    Boolean(bible.content) ||
    bible.premise.trim().length > 0 ||
    bible.worldRules.length > 0 ||
    bible.themes.length > 0 ||
    bible.boundaries.length > 0 ||
    bible.canonFacts.length > 0
  );
}

export function createStoryBibleService(
  repository: StoryBiblePort,
  projects: ProjectReader,
) {
  function requireId(projectId: string) {
    if (!isObjectId(projectId)) throw new StudioError("That project id is not valid", 400, "invalid_id");
  }

  async function editableProject(actor: RequestAuth, projectId: string): Promise<ProjectRecord> {
    const project = await projects.findOwned(actor.userId, projectId);
    if (!project) throw new StudioError("Project not found", 404, "not_found");
    if (project.status === "archived" || isBusyStatus(project.status)) {
      throw new StudioError("Wait until production is idle before editing the Story Bible", 409, "project_busy");
    }
    return project;
  }

  return {
    async get(actor: RequestAuth, projectId: string): Promise<StoryBibleRecord | null> {
      requireId(projectId);
      return repository.findOwned(actor.userId, projectId);
    },
    async ensureExists(actor: RequestAuth, projectId: string): Promise<StoryBibleRecord> {
      requireId(projectId);
      const existing = await repository.findOwned(actor.userId, projectId);
      if (existing) return existing;
      const created = await repository.saveDraft(
        actor.userId,
        projectId,
        { premise: "", worldRules: [], themes: [], boundaries: [], canonFacts: [] }
      );
      if (!created) throw new StudioError("Project not found", 404, "not_found");
      return created;
    },
    async save(actor: RequestAuth, projectId: string, draft: StoryBibleDraft) {
      requireId(projectId);
      await editableProject(actor, projectId);
      const bible = await repository.saveDraft(actor.userId, projectId, draft);
      if (!bible) throw new StudioError("Project not found", 404, "not_found");
      return bible;
    },
    async approve(actor: RequestAuth, projectId: string, expectedVersion: number, expectedDraftRevision: number) {
      requireId(projectId);
      await editableProject(actor, projectId);
      const current = await repository.findOwned(actor.userId, projectId);
      // An empty or partially generated Bible cannot be mistaken for approved canon.
      if (!bibleHasContent(current)) {
        throw new StudioError("Generate the Story Bible before approving it", 409, "bible_incomplete");
      }
      const bible = await repository.approve(actor.userId, projectId, expectedVersion, expectedDraftRevision);
      if (!bible) throw new StudioError("The Story Bible changed or could not be approved. Reload and review it.", 409, "stale_bible");
      return bible;
    },
  };
}

export const storyBibleService = createStoryBibleService(storyBibleRepository, projectRepository);
