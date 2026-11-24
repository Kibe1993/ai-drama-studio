import "server-only";
import type { RequestAuth } from "@/lib/auth/session";
import { isObjectId } from "@/lib/repositories/ownership";
import { productionDesignRepository } from "@/lib/repositories/productionDesignRepository";
import { projectRepository } from "@/lib/repositories/projectRepository";
import { StudioError } from "@/lib/http/errors";
import type { ProductionDesignInput } from "@/lib/validation/productionDesign";

export function createProductionDesignService() {
  async function loadProject(actor: RequestAuth, projectId: string) {
    if (!isObjectId(projectId)) throw new StudioError("That project id is not valid", 400, "invalid_id");
    const project = await projectRepository.findOwned(actor.userId, projectId);
    if (!project) throw new StudioError("Project not found", 404, "not_found");
    return project;
  }

  async function getByScene(actor: RequestAuth, projectId: string, sceneId: string) {
    await loadProject(actor, projectId);
    return productionDesignRepository.findByScene(actor.userId, sceneId);
  }

  async function listForProject(actor: RequestAuth, projectId: string) {
    await loadProject(actor, projectId);
    return productionDesignRepository.listForProject(actor.userId, projectId);
  }

  async function createOrUpdate(actor: RequestAuth, projectId: string, sceneId: string, data: ProductionDesignInput) {
    await loadProject(actor, projectId);
    if (!isObjectId(sceneId)) throw new StudioError("Invalid scene id", 400, "invalid_id");
    const existing = await productionDesignRepository.findByScene(actor.userId, sceneId);
    if (existing && (existing.status === "draft" || existing.status === "rejected")) {
      const updated = await productionDesignRepository.update(actor.userId, existing.id, data);
      if (!updated) throw new StudioError("Production design not found", 404, "not_found");
      return updated;
    }
    return productionDesignRepository.create(actor.userId, projectId, sceneId, data);
  }

  async function approve(actor: RequestAuth, projectId: string, sceneId: string, expectedVersion: number) {
    await loadProject(actor, projectId);
    const existing = await productionDesignRepository.findByScene(actor.userId, sceneId);
    if (!existing) throw new StudioError("No production design found for scene", 404, "not_found");
    if (existing.version !== expectedVersion) {
      throw new StudioError("Version mismatch — re-fetch and try again", 409, "version_conflict");
    }
    const result = await productionDesignRepository.approve(actor.userId, existing.id, expectedVersion);
    if (!result) throw new StudioError("Production design not found or version mismatch", 404, "not_found");
    return result;
  }

  return { getByScene, listForProject, createOrUpdate, approve };
}

export const productionDesignService = createProductionDesignService();