import { describe, expect, it } from "vitest";
import { canTransition } from "@/lib/domain/projectStatus";
import { projectInputSchema } from "@/lib/validation/project";
import { storyUserPrompt } from "@/lib/providers/llm/prompt";
import { decodeCursor, encodeCursor } from "@/lib/repositories/cursor";
import { ownedQuery } from "@/lib/repositories/ownership";
import { safeErrorMessage } from "@/lib/http/errors";
import { createProjectService, type ProjectRepositoryPort } from "@/lib/services/projectService";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { RequestAuth } from "@/lib/auth/session";

const owner: RequestAuth = {
  userId: "user_owner",
  isAdmin: false,
  email: "owner@example.com",
  name: "Owner",
  imageUrl: "",
};

const stranger: RequestAuth = {
  userId: "user_stranger",
  isAdmin: false,
  email: "stranger@example.com",
  name: "Stranger",
  imageUrl: "",
};

const validInput = {
  title: "The courtyard",
  originalStoryIdea: "Two people keep a family secret.",
  genre: "romance",
  language: "en",
  visualStyle: "realistic",
  tone: "quiet",
  targetDurationSeconds: 60,
  aspectRatio: "16:9",
  productionType: "fictional_drama",
  productionMode: "serialized",
};

function memory() {
  const rows: Array<ProjectRecord & { clerkUserId: string }> = [];
  let sequence = 0;
  const keys = new Map<string, string>();
  const nextId = () => {
    sequence += 1;
    return sequence.toString(16).padStart(24, "0");
  };
  const port: ProjectRepositoryPort = {
    async list(clerkUserId, cursor, limit, status) {
      const ordered = rows
        .filter((row) => row.clerkUserId === clerkUserId)
        .filter((row) => (status ? row.status === status : true))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
      const filtered = cursor
        ? ordered.filter(
            (row) =>
              row.updatedAt < cursor.updatedAt ||
              (row.updatedAt === cursor.updatedAt && row.id < cursor.id)
          )
        : ordered;
      return filtered.slice(0, limit);
    },
    async counts(clerkUserId) {
      const counts: Partial<Record<ProjectRecord["status"], number>> = {};
      for (const row of rows) {
        if (row.clerkUserId !== clerkUserId) continue;
        counts[row.status] = (counts[row.status] ?? 0) + 1;
      }
      return counts;
    },
    async findOwned(clerkUserId, id) {
      return rows.find((row) => row.clerkUserId === clerkUserId && row.id === id) ?? null;
    },
    async findByIdempotency(clerkUserId, idempotencyKey) {
      const id = keys.get(`${clerkUserId}:${idempotencyKey}`);
      return rows.find((row) => row.id === id) ?? null;
    },
    async insert(input) {
      if (input.idempotencyKey) {
        const existing = await this.findByIdempotency(input.clerkUserId, input.idempotencyKey);
        if (existing) return existing;
      }
      const now = new Date().toISOString();
      const record: ProjectRecord & { clerkUserId: string } = {
        id: nextId(),
        clerkUserId: input.clerkUserId,
        title: input.title,
        originalStoryIdea: input.originalStoryIdea,
        genre: input.genre,
        language: input.language,
        visualStyle: input.visualStyle,
        tone: input.tone,
        targetDurationSeconds: input.targetDurationSeconds,
        aspectRatio: input.aspectRatio,
        status: input.status,
        workflowMode: input.workflowMode,
        productionType: input.productionType,
        productionMode: input.productionMode,
        createdAt: now,
        updatedAt: now,
      };
      if (input.idempotencyKey) keys.set(`${input.clerkUserId}:${input.idempotencyKey}`, record.id);
      rows.push(record);
      return record;
    },
    async update(clerkUserId, id, patch) {
      const row = rows.find((item) => item.clerkUserId === clerkUserId && item.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updatedAt: new Date().toISOString() });
      return row;
    },
    async remove(clerkUserId, id) {
      const index = rows.findIndex((item) => item.clerkUserId === clerkUserId && item.id === id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
  };
  return { rows, port };
}

function service() {
  const store = memory();
  return {
    store,
    api: createProjectService(store.port, { upsert: async () => undefined }),
  };
}

describe("project status", () => {
  it("allows the production path and blocks skips", () => {
    expect(canTransition("draft", "planning")).toBe(true);
    expect(canTransition("draft", "completed")).toBe(false);
    expect(canTransition("draft", "archived")).toBe(true);
    expect(canTransition("archived", "draft")).toBe(true);
    expect(canTransition("generating", "archived")).toBe(false);
    expect(canTransition("failed", "story_ready")).toBe(false);
    expect(canTransition("failed", "story_ready", "story_ready")).toBe(true);
    expect(canTransition("failed", "completed", "story_ready")).toBe(false);
  });
});

describe("project schema", () => {
  it("accepts supported short and extended runtimes, while rejecting unsupported values", () => {
    expect(projectInputSchema.parse(validInput).targetDurationSeconds).toBe(60);
    expect(projectInputSchema.parse({ ...validInput, targetDurationSeconds: 900 }).targetDurationSeconds).toBe(900);
    expect(projectInputSchema.safeParse({ ...validInput, title: "  " }).success).toBe(false);
    expect(projectInputSchema.safeParse({ ...validInput, targetDurationSeconds: 600 }).success).toBe(true);
    expect(projectInputSchema.safeParse({ ...validInput, targetDurationSeconds: 86400 }).success).toBe(false);
  });

  it("defaults legacy profile fields and rejects unknown continuity modes", () => {
    const { productionMode: _mode, productionType: _type, ...legacy } = validInput;
    expect(projectInputSchema.parse(legacy)).toMatchObject({
      productionType: "fictional_drama",
      productionMode: "standalone",
    });
    expect(projectInputSchema.safeParse({ ...validInput, productionMode: "shared" }).success).toBe(false);
    expect(projectInputSchema.safeParse({ ...validInput, productionType: "unlisted" }).success).toBe(false);
  });

  it("accepts all requested content categories and guides story generation", () => {
    const ids = [
      "fictional_drama",
      "science_fiction_fantasy",
      "mystery_crime_thriller",
      "historical_stories",
      "romance_human_interest",
      "documentary_educational",
      "philosophical",
      "comedy_satire_animation",
    ];
    for (const productionType of ids) {
      expect(projectInputSchema.safeParse({ ...validInput, productionType }).success).toBe(true);
    }
    const documentary = projectInputSchema.parse({ ...validInput, productionType: "documentary_educational" });
    const prompt = storyUserPrompt({
      title: documentary.title,
      idea: documentary.originalStoryIdea,
      genre: documentary.genre,
      language: documentary.language,
      visualStyle: documentary.visualStyle,
      tone: documentary.tone,
      aspectRatio: documentary.aspectRatio,
      targetDurationSeconds: documentary.targetDurationSeconds,
      productionType: documentary.productionType,
    });
    expect(prompt).toContain("do not invent factual claims");
    expect(prompt).toContain("does not yet provide a research-verification stage");
  });

  it("passes an extended target duration through to the story prompt", () => {
    const project = projectInputSchema.parse({ ...validInput, targetDurationSeconds: 600 });
    const prompt = storyUserPrompt({
      title: project.title,
      idea: project.originalStoryIdea,
      genre: project.genre,
      language: project.language,
      visualStyle: project.visualStyle,
      tone: project.tone,
      aspectRatio: project.aspectRatio,
      targetDurationSeconds: project.targetDurationSeconds,
    });
    expect(prompt).toContain("Target duration: 600 seconds, about 10 minutes.");
    expect(prompt).toContain("including targets longer than three minutes");
  });
});

describe("ownership filters", () => {
  it("always includes the user id", () => {
    expect(ownedQuery("user_owner")).toEqual({ clerkUserId: "user_owner" });
    expect(ownedQuery("user_owner", "a".repeat(24))).toEqual({
      clerkUserId: "user_owner",
      _id: "a".repeat(24),
    });
    expect(() => ownedQuery("")).toThrow(/user id/);
  });
});

describe("project service", () => {
  it("keeps a project with its owner", async () => {
    const { api } = service();
    const created = await api.create(owner, projectInputSchema.parse(validInput), null);
    expect(created.status).toBe("draft");
    expect(created.workflowMode).toBe("guided");
    expect(created.productionMode).toBe("serialized");
    await expect(api.get(stranger, created.id)).rejects.toMatchObject({ code: "not_found" });
    const copy = await api.duplicate(owner, created.id);
    expect(copy.title.startsWith("Copy of ")).toBe(true);
    expect(copy.originalStoryIdea).toBe(validInput.originalStoryIdea);
    expect(copy.productionMode).toBe("serialized");
    expect(copy.productionType).toBe("fictional_drama");
    expect(copy.id).not.toBe(created.id);
  });

  it("returns the same project for a repeated idempotency key", async () => {
    const { api } = service();
    const input = projectInputSchema.parse(validInput);
    const first = await api.create(owner, input, "key-12345678");
    const second = await api.create(owner, input, "key-12345678");
    expect(second.id).toBe(first.id);
  });

  it("refuses edits after archive and restores to draft", async () => {
    const { api } = service();
    const created = await api.create(owner, projectInputSchema.parse(validInput), null);
    const archived = await api.archive(owner, created.id);
    expect(archived.status).toBe("archived");
    await expect(
      api.update(owner, created.id, projectInputSchema.parse(validInput))
    ).rejects.toMatchObject({ code: "project_archived" });
    const restored = await api.restore(owner, created.id);
    expect(restored.status).toBe("draft");
  });
});

describe("cursors and errors", () => {
  it("round-trips a cursor and hides connection strings", () => {
    const token = encodeCursor({
      updatedAt: "2026-10-31T12:00:00.000Z",
      id: "a".repeat(24),
    });
    expect(decodeCursor(token)?.id).toBe("a".repeat(24));
    expect(() => decodeCursor("not-a-cursor")).toThrow(/invalid_cursor/);
    expect(safeErrorMessage(new Error("failed mongodb+srv://user:pass@host/db"))).toContain("[redacted]");
    expect(safeErrorMessage(new Error("failed mongodb+srv://user:pass@host/db"))).not.toContain("pass");
  });
});
