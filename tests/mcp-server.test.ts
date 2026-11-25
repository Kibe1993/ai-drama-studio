import { describe, expect, it, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("@/lib/services/projectService", () => ({
  projectService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    summary: vi.fn(),
    duplicate: vi.fn(),
    archive: vi.fn(),
  },
}));

vi.mock("@/lib/services/storyBibleService", () => ({
  storyBibleService: {
    save: vi.fn(),
    get: vi.fn(),
    approve: vi.fn(),
  },
}));

const mockPipelineService = {
  get: vi.fn(),
  start: vi.fn(),
  generateStory: vi.fn(),
  approveStory: vi.fn(),
  updateStory: vi.fn(),
  approve: vi.fn(),
  generateScenes: vi.fn(),
  retry: vi.fn(),
  retryScene: vi.fn(),
  cancel: vi.fn(),
};
vi.mock("@/lib/services/pipelineService", () => ({
  createPipelineService: vi.fn(() => mockPipelineService),
}));

vi.mock("@/lib/pipeline/live", () => ({
  livePipelineDeps: vi.fn(() => ({})),
}));

const mockTriggerRender = vi.fn();
vi.mock("@/lib/services/renderService", () => ({
  createRenderService: vi.fn(() => ({ triggerRender: mockTriggerRender })),
}));

vi.mock("@/lib/services/workflowService", () => ({
  workflowService: { get: vi.fn() },
}));

vi.mock("@/lib/services/episodeService", () => ({
  episodeService: { list: vi.fn(), create: vi.fn(), requestGenerate: vi.fn() },
}));

vi.mock("@/lib/services/productionSceneService", () => ({
  productionSceneService: { list: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/services/seasonPlanService", () => ({
  seasonPlanService: { get: vi.fn(), start: vi.fn(), update: vi.fn(), approve: vi.fn() },
}));

vi.mock("@/lib/services/storyDraftService", () => ({
  storyDraftService: { get: vi.fn(), approve: vi.fn(), cancel: vi.fn(), start: vi.fn() },
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
    update: vi.fn(),
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
    findOwned: vi.fn(),
    create: vi.fn(),
    approve: vi.fn(),
    updateVisualProfile: vi.fn(),
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
    findOwned: vi.fn(),
    insert: vi.fn(),
    save: vi.fn(),
  },
}));

vi.mock("@/lib/canon/store", () => ({
  canonStore: {
    getLatestSequence: vi.fn(),
    append: vi.fn(),
    latestState: vi.fn(),
  },
}));

vi.mock("@/lib/canon/bridge", () => ({
  derivedToCanonState: vi.fn(),
}));

import { projectService } from "@/lib/services/projectService";
import { storyBibleService } from "@/lib/services/storyBibleService";
import { createRenderService } from "@/lib/services/renderService";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { narrativeCanonRepository } from "@/lib/repositories/narrativeCanonRepository";
import { canonicalEntityRepository } from "@/lib/repositories/canonicalEntityRepository";
import { mediaAssetRepository } from "@/lib/repositories/mediaAssetRepository";
import { renderJobRepository } from "@/lib/repositories/renderJobRepository";
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

  it("project.list returns projects from the service", async () => {
    const mockProjects = [
      { id: "p1", title: "Project A", status: "draft" },
      { id: "p2", title: "Project B", status: "completed" },
    ];
    vi.mocked(projectService.list).mockResolvedValue({ projects: mockProjects, nextCursor: null } as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({ name: "project.list", arguments: { limit: 10 } });
      expect(projectService.list).toHaveBeenCalled();
      expect(parseResult(result as never)).toEqual(mockProjects);
    } finally {
      await server.close();
    }
  });

  it("project.get returns a single project", async () => {
    const mockProject = { id: "p1", title: "Test", status: "draft" };
    vi.mocked(projectService.get).mockResolvedValue(mockProject as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({ name: "project.get", arguments: { projectId: "p1" } });
      expect(projectService.get).toHaveBeenCalledWith(expect.objectContaining({ userId: ACTOR }), "p1");
      expect(parseResult(result as never)).toEqual(mockProject);
    } finally {
      await server.close();
    }
  });

  it("project.get returns error for missing project", async () => {
    vi.mocked(projectService.get).mockRejectedValue(new Error("Project not found"));

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({ name: "project.get", arguments: { projectId: "missing" } });
      const parsed = parseResult(result as never) as { error: string };
      expect(parsed.error).toContain("not found");
    } finally {
      await server.close();
    }
  });

  it("project.create creates a project via the service", async () => {
    const mockProject = { id: "p1", title: "New", status: "draft" };
    vi.mocked(projectService.create).mockResolvedValue(mockProject as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "project.create",
        arguments: { title: "New", originalStoryIdea: "A test story" },
      });
      expect(projectService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ACTOR }),
        expect.objectContaining({ title: "New", originalStoryIdea: "A test story" }),
        null,
      );
      expect(parseResult(result as never)).toEqual(mockProject);
    } finally {
      await server.close();
    }
  });

  it("project.delete removes a project with confirmation", async () => {
    vi.mocked(projectService.get).mockResolvedValue({ id: "p1", title: "My Project", status: "draft" } as never);
    vi.mocked(projectService.remove).mockResolvedValue(true as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "project.delete",
        arguments: { projectId: "p1", confirmProjectName: "My Project" },
      });
      expect(projectService.remove).toHaveBeenCalledWith(expect.objectContaining({ userId: ACTOR }), "p1");
      const parsed = parseResult(result as never);
      expect(parsed).toEqual(true);
    } finally {
      await server.close();
    }
  });

  it("project.delete fails without matching confirmation", async () => {
    vi.mocked(projectService.get).mockResolvedValue({ id: "p1", title: "My Project", status: "draft" } as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "project.delete",
        arguments: { projectId: "p1", confirmProjectName: "Wrong Name" },
      });
      const parsed = parseResult(result as never) as { error: string };
      expect(parsed.error).toContain("Confirmation failed");
      expect(projectService.remove).not.toHaveBeenCalled();
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

  it("canon.summary returns entity counts", async () => {
    vi.mocked(narrativeCanonRepository.latest).mockResolvedValue({ version: 1, knowledge: [] } as never);
    vi.mocked(canonicalEntityRepository.listByProject).mockResolvedValue([
      { id: "c1", entityType: "character", name: "Ada" },
      { id: "c2", entityType: "character", name: "Father" },
      { id: "l1", entityType: "location", name: "Courtyard" },
    ] as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "canon.summary",
        arguments: { projectId: "p1" },
      });
      const parsed = parseResult(result as never) as { canonVersion: number; entityCount: { characters: number; locations: number } };
      expect(parsed.canonVersion).toBe(1);
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

  it("render.start creates a render job via the service", async () => {
    vi.mocked(createRenderService).mockReturnValue({ triggerRender: mockTriggerRender } as never);
    mockTriggerRender.mockResolvedValue({ id: "r1", status: "queued" } as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "render.start",
        arguments: { episodeId: "e1", timelineId: "t1", presetId: "landscape_16_9" },
      });
      expect(createRenderService).toHaveBeenCalled();
      expect(mockTriggerRender).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ACTOR }),
        "t1",
        "landscape_16_9",
      );
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
      expect(names).toContain("canon.summary");
      expect(names).toContain("media.list");
      expect(names).toContain("media.upload");
      expect(names).toContain("media.generate_audio");
      expect(names).toContain("render.start");
      expect(names).toContain("render.status");
      expect(names).toContain("pipeline.get");
      expect(names).toContain("pipeline.start");
      expect(names).toContain("pipeline.approveStory");
      expect(names).toContain("pipeline.approve");
      expect(names).toContain("pipeline.generateStory");
      expect(names).toContain("pipeline.generateScenes");
      expect(names).toContain("pipeline.cancel");
      expect(names).toContain("entity.list");
      expect(names).toContain("entity.get");
      expect(names).toContain("entity.create");
      expect(names).toContain("entity.approve");
      expect(names).toContain("entity.updateVisualProfile");
      expect(names).toContain("episode.list");
      expect(names).toContain("episode.get");
      expect(names).toContain("episode.create");
      expect(names).toContain("scene.list");
      expect(names).toContain("scene.get");
      expect(names).toContain("scene.update");
      expect(names).toContain("scene.approveShotPlan");
      expect(names).toContain("seasonPlan.get");
      expect(names).toContain("seasonPlan.listVersions");
      expect(names).toContain("seasonPlan.start");
      expect(names).toContain("seasonPlan.update");
      expect(names).toContain("seasonPlan.approve");
      expect(names).toContain("timeline.get");
      expect(names).toContain("timeline.findByEpisode");
      expect(names).toContain("timeline.approve");
      expect(names).toContain("bible.approve");
      expect(names).toContain("story.approve");
      expect(names).toContain("project.context");
      expect(names).toContain("activity.list");
      expect(names).toContain("planning.get");
      expect(names).toContain("planning.update");
      expect(names).toContain("planning.approve");
      expect(names).toContain("productionDesign.get");
      expect(names).toContain("productionDesign.update");
      expect(names).toContain("productionDesign.generateShotList");
      expect(names).toContain("voice.assign");
    } finally {
      await server.close();
    }
  });
});