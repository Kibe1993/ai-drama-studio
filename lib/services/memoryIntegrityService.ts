import "server-only";
import { projectMemoryRepository, type ProjectMemoryRecord, type ProjectMemoryCategory, type ProjectMemorySource } from "@/lib/repositories/projectMemoryRepository";

export type MemoryConflict = {
  category: ProjectMemoryCategory;
  key: string;
  existing: ProjectMemoryRecord;
  proposed: { value: string; source: ProjectMemorySource };
  resolution: "supersede" | "reject_proposed" | "require_user_decision";
};

export const memoryIntegrityService = {
  async detectConflict(
    clerkUserId: string,
    projectId: string,
    category: ProjectMemoryCategory,
    key: string,
    proposedValue: string,
  ): Promise<MemoryConflict | null> {
    const existing = await projectMemoryRepository.find(clerkUserId, projectId, category, key);
    if (!existing) return null;
    if (existing.value === proposedValue) return null;

    let resolution: MemoryConflict["resolution"];
    if (existing.status === "confirmed" && existing.source === "user_decision") {
      resolution = "require_user_decision";
    } else if (existing.status === "proposed") {
      resolution = "supersede";
    } else {
      resolution = "reject_proposed";
    }

    return {
      category,
      key,
      existing,
      proposed: { value: proposedValue, source: "assistant_proposal" },
      resolution,
    };
  },

  async safeUpsert(
    clerkUserId: string,
    input: {
      projectId: string;
      category: ProjectMemoryCategory;
      key: string;
      value: string;
      source: ProjectMemorySource;
      status?: "confirmed" | "proposed";
      conversationId?: string | null;
    },
  ): Promise<{ record: ProjectMemoryRecord; conflict: MemoryConflict | null }> {
    const conflict = await this.detectConflict(
      clerkUserId,
      input.projectId,
      input.category,
      input.key,
      input.value,
    );

    if (conflict) {
      if (conflict.resolution === "require_user_decision") {
        return {
          record: conflict.existing,
          conflict,
        };
      }
      if (conflict.resolution === "supersede") {
        const record = await projectMemoryRepository.supersede(
          clerkUserId,
          input.projectId,
          input.category,
          input.key,
          input.value,
          input.source,
        );
        return { record, conflict };
      }
      return {
        record: await projectMemoryRepository.create(clerkUserId, {
          ...input,
          status: "proposed",
        }),
        conflict,
      };
    }

    const record = await projectMemoryRepository.create(clerkUserId, {
      ...input,
      status: input.status ?? "proposed",
    });
    return { record, conflict: null };
  },

  async approveMemory(
    clerkUserId: string,
    memoryId: string,
  ): Promise<void> {
    await projectMemoryRepository.updateStatus(clerkUserId, memoryId, "confirmed");
  },

  async rejectMemory(
    clerkUserId: string,
    memoryId: string,
  ): Promise<void> {
    await projectMemoryRepository.updateStatus(clerkUserId, memoryId, "rejected");
  },
};