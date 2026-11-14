import "server-only";
import { connectDB } from "@/lib/db/connect";
import { projectModel } from "@/lib/models/project";
import { costEventRepository } from "@/lib/repositories/costEventRepository";
import type { CostEventRecord } from "@/lib/validation/costEvent";

export type CostGuardDeps = {
  sumByProject?: (clerkUserId: string, projectId: string) => Promise<number>;
};

export class CostGuard {
  constructor(private readonly deps: CostGuardDeps = {}) {}

  async check(actor: { userId: string }, projectId: string, estimatedCostCents: number): Promise<void> {
    const Project = projectModel(await connectDB());
    const project = await Project.findOne({ clerkUserId: actor.userId, _id: projectId })
      .select({ costLimitCents: 1 })
      .lean<{ costLimitCents: number | null } | null>();
    if (!project) return;
    const limit = project.costLimitCents;
    if (limit === null || limit === undefined) return;
    const sum = await (this.deps.sumByProject ?? costEventRepository.sumByProject)(actor.userId, projectId);
    if (sum + Math.max(0, estimatedCostCents) > limit) {
      throw new Error("cost_limit_exceeded");
    }
  }

  async record(
    clerkUserId: string,
    input: Omit<CostEventRecord, "id" | "clerkUserId" | "createdAt" | "updatedAt">
  ): Promise<CostEventRecord> {
    return costEventRepository.create(clerkUserId, input);
  }
}

export function createCostGuard(deps?: CostGuardDeps): CostGuard {
  return new CostGuard(deps);
}