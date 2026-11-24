import { describe, expect, it, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("@/lib/repositories/projectRepository", () => ({
  projectRepository: {
    list: vi.fn(),
    findOwned: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    counts: vi.fn(),
    findByIdempotency: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/storyRepository", () => ({
  storyRepository: {
    findProjectDraft: vi.fn(),
    findOwned: vi.fn(),
    updateScreenplay: vi.fn(),
    upsertAwaiting: vi.fn(),
    markApproved: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/storyBibleRepository", () => ({
  storyBibleRepository: {
    findOwned: vi.fn(),
    saveDraft: vi.fn(),
    findApproved: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/episodeRepository", () => ({
  episodeRepository: {
    listOwned: vi.fn(),
    findOwned: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/narrativeCanonRepository", () => ({
  narrativeCanonRepository: {
    latest: vi.fn(),
    at: vi.fn(),
    commit: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/canonicalEntityRepository", () => ({
  canonicalEntityRepository: {
    listByProject: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/mediaAssetRepository", () => ({
  mediaAssetRepository: {
    listProject: vi.fn(),
    createVerified: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/renderJobRepository", () => ({
  renderJobRepository: {
    create: vi.fn(),
    findOwned: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/timelineRepository", () => ({
  timelineRepository: {
    findOwned: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/productionSceneRepository", () => ({
  productionSceneRepository: {
    listForRun: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/seasonPlanRepository", () => ({
  seasonPlanRepository: {
    findLatest: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/productionRunRepository", () => ({
  productionRunRepository: {
    findLatest: vi.fn(),
  },
}));

vi.mock("@/lib/canon/store", () => ({
  canonStore: {
    getLatestSequence: vi.fn(),
    append: vi.fn(),
  },
}));

import { projectRepository } from "@/lib/repositories/projectRepository";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { narrativeCanonRepository } from "@/lib/repositories/narrativeCanonRepository";
import { canonicalEntityRepository } from "@/lib/repositories/canonicalEntityRepository";
import { mediaAssetRepository } from "@/lib/repositories/mediaAssetRepository";
import { renderJobRepository } from "@/lib/repositories/renderJobRepository";
import { timelineRepository } from "@/lib/repositories/timelineRepository";
import { createMcpServer } from "@/lib/mcp/server";

const ACTOR = "user_mcp_test_001";

async function connectClient() {
  const server = createMcpServer(ACTOR);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, server };
}

function parseResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  const text = result.content[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

describe("MCP server: project tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("project.list returns projects from the repository", async () => {
    const mockProjects = [
      { id: "p1", title: "Project A", status: "planning" },
      { id: "p2", title: "Project B", status: "completed" },
    ];
    vi.mocked(projectRepository.list).mockResolvedValue(mockProjects as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({ name: "project.list", arguments: { limit: 10 } });
      expect(projectRepository.list).toHaveBeenCalledWith(ACTOR, null, 10, undefined);
      expect(parseResult(result as never)).toEqual(mockProjects);
    } finally {
      await server.close();
    }
  });

  it("project.get returns a single project", async () => {
    const mockProject = { id: "p1", title: "Test", status: "planning" };
    vi.mocked(projectRepository.findOwned).mockResolvedValue(mockProject as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({ name: "project.get", arguments: { projectId: "p1" } });
      expect(projectRepository.findOwned).toHaveBeenCalledWith(ACTOR, "p1");
      expect(parseResult(result as never)).toEqual(mockProject);
    } finally {
      await server.close();
    }
  });

  it("project.get returns error for missing project", async () => {
    vi.mocked(projectRepository.findOwned).mockResolvedValue(null);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({ name: "project.get", arguments: { projectId: "missing" } });
      const parsed = parseResult(result as never) as { error: string };
      expect(parsed.error).toContain("not found");
    } finally {
      await server.close();
    }
  });

  it("project.create creates a project with the actor user", async () => {
    const mockProject = { id: "p1", title: "New", status: "planning" };
    vi.mocked(projectRepository.insert).mockResolvedValue(mockProject as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "project.create",
        arguments: { title: "New", originalStoryIdea: "A test story" },
      });
      expect(projectRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({ clerkUserId: ACTOR, title: "New", originalStoryIdea: "A test story" }),
      );
      expect(parseResult(result as never)).toEqual(mockProject);
    } finally {
      await server.close();
    }
  });

  it("project.delete removes a project", async () => {
    vi.mocked(projectRepository.remove).mockResolvedValue(true);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({ name: "project.delete", arguments: { projectId: "p1" } });
      expect(projectRepository.remove).toHaveBeenCalledWith(ACTOR, "p1");
      expect(parseResult(result as never)).toEqual({ deleted: true });
    } finally {
      await server.close();
    }
  });
});

describe("MCP server: document tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("document.get retrieves the Story Bible", async () => {
    const mockBible = { id: "b1", projectId: "p1", premise: "A test premise" };
    vi.mocked(storyBibleRepository.findOwned).mockResolvedValue(mockBible as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "document.get",
        arguments: { projectId: "p1", documentType: "bible" },
      });
      expect(storyBibleRepository.findOwned).toHaveBeenCalledWith(ACTOR, "p1");
      expect(parseResult(result as never)).toEqual(mockBible);
    } finally {
      await server.close();
    }
  });

  it("document.get retrieves the story draft", async () => {
    const mockStory = { id: "s1", title: "Test Story", screenplay: [] };
    vi.mocked(storyRepository.findProjectDraft).mockResolvedValue(mockStory as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "document.get",
        arguments: { projectId: "p1", documentType: "story" },
      });
      expect(storyRepository.findProjectDraft).toHaveBeenCalledWith(ACTOR, "p1");
      expect(parseResult(result as never)).toEqual(mockStory);
    } finally {
      await server.close();
    }
  });

  it("document.export returns JSON string", async () => {
    const mockBible = { id: "b1", premise: "Test" };
    vi.mocked(storyBibleRepository.findOwned).mockResolvedValue(mockBible as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "document.export",
        arguments: { projectId: "p1", documentType: "bible" },
      });
      const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
      expect(text).toContain('"premise": "Test"');
    } finally {
      await server.close();
    }
  });
});

describe("MCP server: canon tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("canon.query returns the latest canon state", async () => {
    const mockCanon = { version: 3, knowledge: [] };
    vi.mocked(narrativeCanonRepository.latest).mockResolvedValue(mockCanon as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "canon.query",
        arguments: { projectId: "p1" },
      });
      expect(narrativeCanonRepository.latest).toHaveBeenCalledWith(ACTOR, "p1");
      expect(parseResult(result as never)).toEqual(mockCanon);
    } finally {
      await server.close();
    }
  });

  it("canon.query returns a specific version", async () => {
    const mockCanon = { version: 2, knowledge: [] };
    vi.mocked(narrativeCanonRepository.at).mockResolvedValue(mockCanon as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "canon.query",
        arguments: { projectId: "p1", version: 2 },
      });
      expect(narrativeCanonRepository.at).toHaveBeenCalledWith(ACTOR, "p1", 2);
      expect(parseResult(result as never)).toEqual(mockCanon);
    } finally {
      await server.close();
    }
  });

  it("canon.validate returns entity counts", async () => {
    vi.mocked(narrativeCanonRepository.latest).mockResolvedValue({ version: 1, knowledge: [] } as never);
    vi.mocked(canonicalEntityRepository.listByProject).mockResolvedValue([
      { id: "c1", entityType: "character", name: "Ada" },
      { id: "c2", entityType: "character", name: "Father" },
      { id: "l1", entityType: "location", name: "Courtyard" },
    ] as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "canon.validate",
        arguments: { projectId: "p1" },
      });
      const parsed = parseResult(result as never) as { valid: boolean; entityCount: { characters: number; locations: number } };
      expect(parsed.valid).toBe(true);
      expect(parsed.entityCount.characters).toBe(2);
      expect(parsed.entityCount.locations).toBe(1);
    } finally {
      await server.close();
    }
  });
});

describe("MCP server: media tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("media.list returns assets for a project", async () => {
    const mockAssets = [
      { id: "a1", type: "dialogue_audio", fileName: "line1.wav" },
      { id: "a2", type: "scene_image", fileName: "scene1.png" },
    ];
    vi.mocked(mediaAssetRepository.listProject).mockResolvedValue(mockAssets as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "media.list",
        arguments: { projectId: "p1" },
      });
      expect(mediaAssetRepository.listProject).toHaveBeenCalledWith(ACTOR, "p1");
      expect(parseResult(result as never)).toEqual(mockAssets);
    } finally {
      await server.close();
    }
  });
});

describe("MCP server: render tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("render.status returns render job status", async () => {
    vi.mocked(renderJobRepository.findOwned).mockResolvedValue({
      id: "r1",
      status: "completed",
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:05:00Z",
      outputAssetId: "a1",
      error: null,
    } as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "render.status",
        arguments: { renderJobId: "r1" },
      });
      expect(renderJobRepository.findOwned).toHaveBeenCalledWith(ACTOR, "r1");
      const parsed = parseResult(result as never) as { status: string };
      expect(parsed.status).toBe("completed");
    } finally {
      await server.close();
    }
  });

  it("render.start creates a render job", async () => {
    vi.mocked(timelineRepository.findOwned).mockResolvedValue({ id: "t1", projectId: "p1" } as never);
    vi.mocked(renderJobRepository.create).mockResolvedValue({ id: "r1", status: "queued" } as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "render.start",
        arguments: { episodeId: "e1", timelineId: "t1", presetId: "standard" },
      });
      expect(timelineRepository.findOwned).toHaveBeenCalledWith(ACTOR, "t1");
      expect(renderJobRepository.create).toHaveBeenCalled();
      const parsed = parseResult(result as never) as { id: string };
      expect(parsed.id).toBe("r1");
    } finally {
      await server.close();
    }
  });
});

describe("MCP server: tool listing", () => {
  it("lists all registered tools", async () => {
    const { client, server } = await connectClient();
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toContain("project.list");
      expect(names).toContain("project.get");
      expect(names).toContain("project.create");
      expect(names).toContain("project.update");
      expect(names).toContain("project.delete");
      expect(names).toContain("document.get");
      expect(names).toContain("document.update");
      expect(names).toContain("document.import");
      expect(names).toContain("document.export");
      expect(names).toContain("canon.query");
      expect(names).toContain("canon.add");
      expect(names).toContain("canon.validate");
      expect(names).toContain("media.list");
      expect(names).toContain("media.upload");
      expect(names).toContain("media.generate_audio");
      expect(names).toContain("render.start");
      expect(names).toContain("render.status");
    } finally {
      await server.close();
    }
  });
});