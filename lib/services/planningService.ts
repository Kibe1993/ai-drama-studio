import "server-only";
import type { RequestAuth } from "@/lib/auth/session";
import { isObjectId } from "@/lib/repositories/ownership";
import { planningRepository } from "@/lib/repositories/planningRepository";
import { projectRepository } from "@/lib/repositories/projectRepository";
import { StudioError } from "@/lib/http/errors";
import type { PlanningDocumentInput } from "@/lib/validation/planning";

export function createPlanningService() {
  async function loadProject(actor: RequestAuth, projectId: string) {
    if (!isObjectId(projectId)) throw new StudioError("That project id is not valid", 400, "invalid_id");
    const project = await projectRepository.findOwned(actor.userId, projectId);
    if (!project) throw new StudioError("Project not found", 404, "not_found");
    return project;
  }

  async function get(actor: RequestAuth, projectId: string) {
    await loadProject(actor, projectId);
    return planningRepository.findLatest(actor.userId, projectId);
  }

  async function listVersions(actor: RequestAuth, projectId: string) {
    await loadProject(actor, projectId);
    return planningRepository.listVersions(actor.userId, projectId);
  }

  async function createOrUpdate(actor: RequestAuth, projectId: string, data: PlanningDocumentInput) {
    await loadProject(actor, projectId);
    const existing = await planningRepository.findLatest(actor.userId, projectId);
    if (existing && (existing.status === "draft" || existing.status === "rejected")) {
      const updated = await planningRepository.update(actor.userId, existing.id, data);
      if (!updated) throw new StudioError("Planning document not found", 404, "not_found");
      return updated;
    }
    return planningRepository.create(actor.userId, projectId, data);
  }

  async function submit(actor: RequestAuth, projectId: string) {
    await loadProject(actor, projectId);
    const latest = await planningRepository.findLatest(actor.userId, projectId);
    if (!latest) throw new StudioError("No planning document to submit", 404, "not_found");
    if (latest.status !== "draft" && latest.status !== "rejected") {
      throw new StudioError(`Cannot submit planning document in status "${latest.status}"`, 409, "invalid_status");
    }
    const result = await planningRepository.submit(actor.userId, latest.id);
    if (!result) throw new StudioError("Planning document not found", 404, "not_found");
    return result;
  }

  async function approve(actor: RequestAuth, projectId: string, expectedVersion: number) {
    await loadProject(actor, projectId);
    const latest = await planningRepository.findLatest(actor.userId, projectId);
    if (!latest) throw new StudioError("No planning document to approve", 404, "not_found");
    if (latest.version !== expectedVersion) {
      throw new StudioError("Version mismatch — re-fetch and try again", 409, "version_conflict");
    }
    if (latest.status !== "submitted") {
      throw new StudioError("Planning document must be submitted before approval", 409, "invalid_status");
    }
    const result = await planningRepository.approve(actor.userId, latest.id, expectedVersion);
    if (!result) throw new StudioError("Planning document not found or version mismatch", 404, "not_found");
    return result;
  }

  async function reject(actor: RequestAuth, projectId: string, expectedVersion: number, reason: string) {
    await loadProject(actor, projectId);
    const latest = await planningRepository.findLatest(actor.userId, projectId);
    if (!latest) throw new StudioError("No planning document to reject", 404, "not_found");
    if (latest.version !== expectedVersion) {
      throw new StudioError("Version mismatch — re-fetch and try again", 409, "version_conflict");
    }
    const result = await planningRepository.reject(actor.userId, latest.id, expectedVersion, reason);
    if (!result) throw new StudioError("Planning document not found or version mismatch", 404, "not_found");
    return result;
  }

  return { get, listVersions, createOrUpdate, submit, approve, reject };
}

export const planningService = createPlanningService();