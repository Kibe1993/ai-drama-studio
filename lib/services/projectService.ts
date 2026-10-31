import "server-only";
import type { RequestAuth } from "@/lib/auth/session";
import {
  isBusyStatus,
  PROJECT_STATUSES,
  type ProjectStatus,
} from "@/lib/domain/projectCatalog";
import { canTransition } from "@/lib/domain/projectStatus";
import { StudioError } from "@/lib/http/errors";
import { decodeCursor, encodeCursor } from "@/lib/repositories/cursor";
import { isObjectId } from "@/lib/repositories/ownership";
import {
  projectRepository,
  type ProjectRecord,
  type ProjectWrite,
} from "@/lib/repositories/projectRepository";
import { upsertStudioUser } from "@/lib/repositories/userRepository";
import type { ProjectInput, ProjectUpdate } from "@/lib/validation/project";

const PAGE_SIZE = 12;

export type ProjectRepositoryPort = Pick<
  typeof projectRepository,
  "list" | "counts" | "findOwned" | "findByIdempotency" | "insert" | "update" | "remove"
>;

export type UserPort = {
  upsert: (actor: RequestAuth) => Promise<void>;
};

function requireId(id: string) {
  if (!isObjectId(id)) {
    throw new StudioError("That project id is not valid", 400, "invalid_id");
  }
}

function missing(): never {
  throw new StudioError("Project not found", 404, "not_found");
}

function assertEditable(status: ProjectStatus) {
  if (status === "archived") {
    throw new StudioError("Restore this project before editing it", 409, "project_archived");
  }
  if (isBusyStatus(status)) {
    throw new StudioError(
      "This project is in production and cannot be edited right now",
      409,
      "project_busy"
    );
  }
}

function copyTitle(title: string): string {
  const prefix = "Copy of ";
  const room = 120 - prefix.length;
  return `${prefix}${title.slice(0, room)}`;
}

export function createProjectService(projects: ProjectRepositoryPort, users: UserPort) {
  return {
    async list(actor: RequestAuth, cursorToken: string | null, status: ProjectStatus | null) {
      await users.upsert(actor);
      const cursor = decodeCursor(cursorToken);
      const rows = await projects.list(actor.userId, cursor, PAGE_SIZE + 1, status ?? undefined);
      const page = rows.slice(0, PAGE_SIZE);
      const last = page.at(-1);
      const nextCursor =
        rows.length > PAGE_SIZE && last
          ? encodeCursor({ updatedAt: last.updatedAt, id: last.id })
          : null;
      return { projects: page, nextCursor };
    },

    async summary(actor: RequestAuth) {
      await users.upsert(actor);
      const [counts, recent, completed] = await Promise.all([
        projects.counts(actor.userId),
        projects.list(actor.userId, null, 4),
        projects.list(actor.userId, null, 4, "completed"),
      ]);
      const byStatus = Object.fromEntries(
        PROJECT_STATUSES.map((status) => [status, counts[status] ?? 0])
      ) as Record<ProjectStatus, number>;
      return { counts: byStatus, recent, completed };
    },

    async get(actor: RequestAuth, id: string) {
      requireId(id);
      const project = await projects.findOwned(actor.userId, id);
      if (!project) missing();
      return project;
    },

    async create(actor: RequestAuth, input: ProjectInput, idempotencyKey: string | null) {
      await users.upsert(actor);
      if (idempotencyKey) {
        const existing = await projects.findByIdempotency(actor.userId, idempotencyKey);
        if (existing) return existing;
      }
      return projects.insert({
        clerkUserId: actor.userId,
        title: input.title,
        originalStoryIdea: input.originalStoryIdea,
        genre: input.genre,
        language: input.language,
        visualStyle: input.visualStyle,
        tone: input.tone,
        targetDurationSeconds: input.targetDurationSeconds,
        aspectRatio: input.aspectRatio,
        status: "draft",
        workflowMode: "guided",
        idempotencyKey,
      });
    },

    async update(actor: RequestAuth, id: string, input: ProjectUpdate) {
      const current = await this.get(actor, id);
      assertEditable(current.status);
      const updated = await projects.update(actor.userId, id, input);
      if (!updated) missing();
      return updated;
    },

    async duplicate(actor: RequestAuth, id: string) {
      const current = await this.get(actor, id);
      await users.upsert(actor);
      return projects.insert({
        clerkUserId: actor.userId,
        title: copyTitle(current.title),
        originalStoryIdea: current.originalStoryIdea,
        genre: current.genre,
        language: current.language,
        visualStyle: current.visualStyle,
        tone: current.tone,
        targetDurationSeconds: current.targetDurationSeconds,
        aspectRatio: current.aspectRatio,
        status: "draft",
        workflowMode: "guided",
      });
    },

    async archive(actor: RequestAuth, id: string) {
      const current = await this.get(actor, id);
      if (isBusyStatus(current.status)) {
        throw new StudioError(
          "Wait until production finishes before archiving",
          409,
          "project_busy"
        );
      }
      if (!canTransition(current.status, "archived")) {
        throw new StudioError("This project cannot be archived", 409, "invalid_transition");
      }
      const updated = await projects.update(actor.userId, id, { status: "archived" });
      if (!updated) missing();
      return updated;
    },

    async restore(actor: RequestAuth, id: string) {
      const current = await this.get(actor, id);
      if (!canTransition(current.status, "draft")) {
        throw new StudioError("This project cannot be restored", 409, "invalid_transition");
      }
      const updated = await projects.update(actor.userId, id, { status: "draft" });
      if (!updated) missing();
      return updated;
    },

    async remove(actor: RequestAuth, id: string) {
      const current = await this.get(actor, id);
      if (isBusyStatus(current.status)) {
        throw new StudioError(
          "Wait until production finishes before deleting",
          409,
          "project_busy"
        );
      }
      const deleted = await projects.remove(actor.userId, id);
      if (!deleted) missing();
      return { deleted: true };
    },
  };
}

export const projectService = createProjectService(projectRepository, {
  upsert: upsertStudioUser,
});

export type { ProjectRecord, ProjectWrite };
