import "server-only";
import type { RequestAuth } from "@/lib/auth/session";
import { isBusyStatus } from "@/lib/domain/projectCatalog";
import { storyApprovedForProject } from "@/lib/domain/workflow";
import { isObjectId } from "@/lib/repositories/ownership";
import { projectRepository, type ProjectRecord } from "@/lib/repositories/projectRepository";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { bibleBreaksContract } from "@/lib/domain/storyContract";
import { StudioError } from "@/lib/http/errors";
import type { StoryBibleDraft, StoryBibleRecord } from "@/lib/validation/storyBible";

export type StoryBiblePort = Pick<typeof storyBibleRepository, "findOwned" | "saveDraft" | "approve">;
type ProjectReader = Pick<typeof projectRepository, "findOwned">;
type StoryReader = Pick<typeof storyRepository, "findProjectDraft">;

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
  stories: StoryReader = storyRepository
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

  /**
   * The Story Bible builds on an approved story. The workflow gate is enforced
   * here, not just in the interface, so a Bible cannot be edited or approved
   * before the story draft is accepted.
   */
  async function requireApprovedStory(actor: RequestAuth, projectId: string, project: ProjectRecord) {
    const draft = await stories.findProjectDraft(actor.userId, projectId);
    if (!storyApprovedForProject(project.status, draft?.status ?? null)) {
      throw new StudioError("Approve the story draft before developing the Story Bible", 409, "story_required");
    }
  }

  return {
    async get(actor: RequestAuth, projectId: string) {
      requireId(projectId);
      const bible = await repository.findOwned(actor.userId, projectId) ?? await repository.saveDraft(
        actor.userId,
        projectId,
        { premise: "", worldRules: [], themes: [], boundaries: [], canonFacts: [] }
      );
      if (!bible) throw new StudioError("Project not found", 404, "not_found");
      return bible;
    },
    async save(actor: RequestAuth, projectId: string, draft: StoryBibleDraft) {
      requireId(projectId);
      const project = await editableProject(actor, projectId);
      await requireApprovedStory(actor, projectId, project);
      const bible = await repository.saveDraft(actor.userId, projectId, draft);
      if (!bible) throw new StudioError("Project not found", 404, "not_found");
      return bible;
    },
    async approve(actor: RequestAuth, projectId: string, expectedVersion: number, expectedDraftRevision: number) {
      requireId(projectId);
      const project = await editableProject(actor, projectId);
      await requireApprovedStory(actor, projectId, project);
      const current = await repository.findOwned(actor.userId, projectId);
      // An empty or partially generated Bible cannot be mistaken for approved canon.
      if (!bibleHasContent(current)) {
        throw new StudioError("Generate the Story Bible before approving it", 409, "bible_incomplete");
      }
      const draft = await stories.findProjectDraft(actor.userId, projectId);
      const bibleRules = [
        ...(current?.content?.world.rules ?? []),
        ...(current?.worldRules ?? []),
      ];
      const conflict = draft?.storyContract ? bibleBreaksContract(bibleRules, draft.storyContract) : null;
      if (conflict) {
        throw new StudioError(
          `The Story Bible changes an interval the approved story established: ${conflict}`,
          409,
          "story_invalid",
        );
      }
      const bible = await repository.approve(actor.userId, projectId, expectedVersion, expectedDraftRevision);
      if (!bible) throw new StudioError("The Story Bible changed or could not be approved. Reload and review it.", 409, "stale_bible");
      return bible;
    },
  };
}

export const storyBibleService = createStoryBibleService(storyBibleRepository, projectRepository);
