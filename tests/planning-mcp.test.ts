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

vi.mock("@/lib/services/pipelineService", () => ({
  createPipelineService: vi.fn(() => ({
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
  })),
}));

vi.mock("@/lib/pipeline/live", () => ({
  livePipelineDeps: vi.fn(() => ({})),
}));

vi.mock("@/lib/services/renderService", () => ({
  createRenderService: vi.fn(() => ({ triggerRender: vi.fn() })),
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

vi.mock("@/lib/services/planningService", () => ({
  planningService: {
    get: vi.fn(),
    listVersions: vi.fn(),
    createOrUpdate: vi.fn(),
    submit: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
  },
}));

vi.mock("@/lib/services/productionDesignService", () => ({
  productionDesignService: { getByScene: vi.fn(), update: vi.fn(), generateShotList: vi.fn() },
}));

vi.mock("@/lib/services/toolConfigService", () => ({
  toolConfigService: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

vi.mock("@/lib/services/comfyUIService", () => ({
  comfyUIService: { getStatus: vi.fn(), generateImage: vi.fn() },
}));

vi.mock("@/lib/services/veoService", () => ({
  veoService: { generateVideo: vi.fn() },
}));

vi.mock("@/lib/services/chatService", () => ({
  chatService: { streamChat: vi.fn(), listConversations: vi.fn(), getConversation: vi.fn() },
}));

vi.mock("@/lib/providers/external", () => ({
  initializeExternalProviders: vi.fn(),
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

vi.mock("@/lib/mcp/activityLog", () => ({
  logActivity: vi.fn(),
  getActivityLog: vi.fn(),
}));

import { planningService } from "@/lib/services/planningService";
import { createMcpServer } from "@/lib/mcp/server";

const ACTOR = "user_planning_mcp_test";

const mockGet = vi.mocked(planningService.get);
const mockCreateOrUpdate = vi.mocked(planningService.createOrUpdate);
const mockSubmit = vi.mocked(planningService.submit);
const mockApprove = vi.mocked(planningService.approve);
const mockReject = vi.mocked(planningService.reject);

type PlanningDoc = {
  id: string;
  version: number;
  status: "draft" | "submitted" | "approved" | "rejected";
  rejectionReason: string | null;
  concept: { logline: string; synopsis: string; elevatorPitch: string };
  themes: string[];
  centralQuestion: string;
  mainConflict: string;
  audience: { demographic: string; tone: string; contentRating: string };
  narrativeDirection: { structure: string; pov: string; pacing: string };
  alternativeDirections: unknown[];
  references: unknown[];
};

function makeDoc(overrides?: Partial<PlanningDoc>): PlanningDoc {
  return {
    id: "plan_001",
    version: 1,
    status: "draft",
    rejectionReason: null,
    concept: { logline: "", synopsis: "", elevatorPitch: "" },
    themes: [],
    centralQuestion: "",
    mainConflict: "",
    audience: { demographic: "", tone: "", contentRating: "" },
    narrativeDirection: { structure: "", pov: "", pacing: "" },
    alternativeDirections: [],
    references: [],
    ...overrides,
  };
}

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

describe("MCP planning.update: all 12 fields", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves all 12 fields and maps them into the nested document structure", async () => {
    mockGet.mockResolvedValue(null as never);
    const saved = makeDoc({
      concept: { logline: "A cop hunts a ghost.", synopsis: "Full synopsis.", elevatorPitch: "It's Die Hard meets The Sixth Sense." },
      themes: ["justice", "grief"],
      centralQuestion: "Can Mara outrun her past?",
      mainConflict: "Mara vs. the phantom.",
      audience: { demographic: "Adults 25-45", tone: "Tense", contentRating: "R" },
      narrativeDirection: { structure: "Three-act", pov: "First person", pacing: "Fast" },
    });
    mockCreateOrUpdate.mockResolvedValue(saved as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "planning.update",
        arguments: {
          projectId: "p1",
          logline: "A cop hunts a ghost.",
          synopsis: "Full synopsis.",
          elevatorPitch: "It's Die Hard meets The Sixth Sense.",
          themes: ["justice", "grief"],
          centralQuestion: "Can Mara outrun her past?",
          mainConflict: "Mara vs. the phantom.",
          demographic: "Adults 25-45",
          audienceTone: "Tense",
          contentRating: "R",
          structure: "Three-act",
          pov: "First person",
          pacing: "Fast",
        },
      });

      expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      const callArgs = mockCreateOrUpdate.mock.calls[0]!;
      expect(callArgs[0]).toMatchObject({ userId: ACTOR });
      expect(callArgs[1]).toBe("p1");
      expect(callArgs[2]).toEqual({
        concept: { logline: "A cop hunts a ghost.", synopsis: "Full synopsis.", elevatorPitch: "It's Die Hard meets The Sixth Sense." },
        themes: ["justice", "grief"],
        centralQuestion: "Can Mara outrun her past?",
        mainConflict: "Mara vs. the phantom.",
        audience: { demographic: "Adults 25-45", tone: "Tense", contentRating: "R" },
        narrativeDirection: { structure: "Three-act", pov: "First person", pacing: "Fast" },
        alternativeDirections: [],
        references: [],
      });
      expect(parseResult(result as never)).toEqual(saved);
    } finally {
      await server.close();
    }
  });

  it("planning.get returns the full planning document with all 12 fields", async () => {
    const doc = makeDoc({
      concept: { logline: "Logline.", synopsis: "Synopsis.", elevatorPitch: "Pitch." },
      themes: ["hope"],
      centralQuestion: "Question?",
      mainConflict: "Conflict.",
      audience: { demographic: "Teens", tone: "Light", contentRating: "PG" },
      narrativeDirection: { structure: "Episodic", pov: "Omniscient", pacing: "Slow" },
    });
    mockGet.mockResolvedValue(doc as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "planning.get",
        arguments: { projectId: "p1" },
      });
      expect(mockGet).toHaveBeenCalledWith(expect.objectContaining({ userId: ACTOR }), "p1");
      expect(parseResult(result as never)).toEqual(doc);
    } finally {
      await server.close();
    }
  });
});

describe("MCP planning.update: partial updates preserve existing fields", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updating only pacing preserves previously saved audience and concept fields", async () => {
    const existing = makeDoc({
      concept: { logline: "Existing logline.", synopsis: "Existing synopsis.", elevatorPitch: "Existing pitch." },
      themes: ["existing-theme"],
      centralQuestion: "Existing question?",
      mainConflict: "Existing conflict.",
      audience: { demographic: "Existing demographic", tone: "Existing tone", contentRating: "Existing rating" },
      narrativeDirection: { structure: "Existing structure", pov: "Existing pov", pacing: "Old pacing" },
    });
    mockGet.mockResolvedValue(existing as never);
    const updated = makeDoc({
      ...existing,
      narrativeDirection: { ...existing.narrativeDirection, pacing: "New pacing" },
    });
    mockCreateOrUpdate.mockResolvedValue(updated as never);

    const { client, server } = await connectClient();
    try {
      await client.callTool({
        name: "planning.update",
        arguments: {
          projectId: "p1",
          pacing: "New pacing",
        },
      });

      expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      const data = mockCreateOrUpdate.mock.calls[0]![2];
      expect(data).toEqual({
        concept: { logline: "Existing logline.", synopsis: "Existing synopsis.", elevatorPitch: "Existing pitch." },
        themes: ["existing-theme"],
        centralQuestion: "Existing question?",
        mainConflict: "Existing conflict.",
        audience: { demographic: "Existing demographic", tone: "Existing tone", contentRating: "Existing rating" },
        narrativeDirection: { structure: "Existing structure", pov: "Existing pov", pacing: "New pacing" },
        alternativeDirections: [],
        references: [],
      });
    } finally {
      await server.close();
    }
  });

  it("updating only demographic preserves previously saved narrative direction", async () => {
    const existing = makeDoc({
      audience: { demographic: "Old", tone: "Keep", contentRating: "Keep" },
      narrativeDirection: { structure: "Keep", pov: "Keep", pacing: "Keep" },
    });
    mockGet.mockResolvedValue(existing as never);
    mockCreateOrUpdate.mockResolvedValue(existing as never);

    const { client, server } = await connectClient();
    try {
      await client.callTool({
        name: "planning.update",
        arguments: { projectId: "p1", demographic: "New demographic" },
      });

      const data = mockCreateOrUpdate.mock.calls[0]![2];
      expect(data.audience).toEqual({ demographic: "New demographic", tone: "Keep", contentRating: "Keep" });
      expect(data.narrativeDirection).toEqual({ structure: "Keep", pov: "Keep", pacing: "Keep" });
    } finally {
      await server.close();
    }
  });

  it("updating only elevatorPitch preserves previously saved logline and synopsis", async () => {
    const existing = makeDoc({
      concept: { logline: "Keep logline", synopsis: "Keep synopsis", elevatorPitch: "Old pitch" },
    });
    mockGet.mockResolvedValue(existing as never);
    mockCreateOrUpdate.mockResolvedValue(existing as never);

    const { client, server } = await connectClient();
    try {
      await client.callTool({
        name: "planning.update",
        arguments: { projectId: "p1", elevatorPitch: "New pitch" },
      });

      const data = mockCreateOrUpdate.mock.calls[0]![2];
      expect(data.concept).toEqual({ logline: "Keep logline", synopsis: "Keep synopsis", elevatorPitch: "New pitch" });
    } finally {
      await server.close();
    }
  });
});

describe("MCP planning.update: backward compatibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calling with only the original 6 fields still works and defaults new fields to empty", async () => {
    mockGet.mockResolvedValue(null as never);
    const saved = makeDoc({
      concept: { logline: "L", synopsis: "S", elevatorPitch: "" },
      themes: ["t"],
      centralQuestion: "Q?",
      mainConflict: "C",
    });
    mockCreateOrUpdate.mockResolvedValue(saved as never);

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "planning.update",
        arguments: {
          projectId: "p1",
          logline: "L",
          synopsis: "S",
          themes: ["t"],
          centralQuestion: "Q?",
          mainConflict: "C",
        },
      });

      expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      const data = mockCreateOrUpdate.mock.calls[0]![2];
      expect(data).toEqual({
        concept: { logline: "L", synopsis: "S", elevatorPitch: "" },
        themes: ["t"],
        centralQuestion: "Q?",
        mainConflict: "C",
        audience: { demographic: "", tone: "", contentRating: "" },
        narrativeDirection: { structure: "", pov: "", pacing: "" },
        alternativeDirections: [],
        references: [],
      });
      expect(parseResult(result as never)).toEqual(saved);
    } finally {
      await server.close();
    }
  });

  it("calling with no fields (only projectId) preserves all existing values", async () => {
    const existing = makeDoc({
      concept: { logline: "L", synopsis: "S", elevatorPitch: "P" },
      themes: ["t"],
      centralQuestion: "Q?",
      mainConflict: "C",
      audience: { demographic: "D", tone: "T", contentRating: "CR" },
      narrativeDirection: { structure: "St", pov: "Pv", pacing: "Pa" },
    });
    mockGet.mockResolvedValue(existing as never);
    mockCreateOrUpdate.mockResolvedValue(existing as never);

    const { client, server } = await connectClient();
    try {
      await client.callTool({
        name: "planning.update",
        arguments: { projectId: "p1" },
      });

      const data = mockCreateOrUpdate.mock.calls[0]![2];
      expect(data).toEqual({
        concept: { logline: "L", synopsis: "S", elevatorPitch: "P" },
        themes: ["t"],
        centralQuestion: "Q?",
        mainConflict: "C",
        audience: { demographic: "D", tone: "T", contentRating: "CR" },
        narrativeDirection: { structure: "St", pov: "Pv", pacing: "Pa" },
        alternativeDirections: [],
        references: [],
      });
    } finally {
      await server.close();
    }
  });
});

describe("MCP planning.update: validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a logline exceeding 500 characters", async () => {
    const { client, server } = await connectClient();
    try {
      await client.callTool({
        name: "planning.update",
        arguments: { projectId: "p1", logline: "x".repeat(501) },
      });
      expect(mockCreateOrUpdate).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("rejects an elevatorPitch exceeding 1000 characters", async () => {
    const { client, server } = await connectClient();
    try {
      await client.callTool({
        name: "planning.update",
        arguments: { projectId: "p1", elevatorPitch: "x".repeat(1001) },
      });
      expect(mockCreateOrUpdate).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("rejects contentRating exceeding 50 characters", async () => {
    const { client, server } = await connectClient();
    try {
      await client.callTool({
        name: "planning.update",
        arguments: { projectId: "p1", contentRating: "x".repeat(51) },
      });
      expect(mockCreateOrUpdate).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("rejects more than 20 themes", async () => {
    const { client, server } = await connectClient();
    try {
      await client.callTool({
        name: "planning.update",
        arguments: { projectId: "p1", themes: Array.from({ length: 21 }, (_, i) => `theme-${i}`) },
      });
      expect(mockCreateOrUpdate).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});

describe("MCP planning.update: authorization and errors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an error when the project does not belong to the user", async () => {
    mockGet.mockRejectedValue(new Error("Project not found"));

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "planning.update",
        arguments: { projectId: "someone-elses-project", logline: "L" },
      });
      const parsed = parseResult(result as never) as { error: string };
      expect(parsed.error).toContain("not found");
      expect(mockCreateOrUpdate).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});

describe("MCP planning.update: does not auto-submit or auto-approve", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saving a planning document does not call submit or approve", async () => {
    mockGet.mockResolvedValue(null as never);
    mockCreateOrUpdate.mockResolvedValue(makeDoc({ status: "draft" }) as never);

    const { client, server } = await connectClient();
    try {
      await client.callTool({
        name: "planning.update",
        arguments: {
          projectId: "p1",
          logline: "L",
          synopsis: "S",
          elevatorPitch: "P",
          themes: ["t"],
          centralQuestion: "Q?",
          mainConflict: "C",
          demographic: "D",
          audienceTone: "T",
          contentRating: "CR",
          structure: "St",
          pov: "Pv",
          pacing: "Pa",
        },
      });

      expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      expect(mockSubmit).not.toHaveBeenCalled();
      expect(mockApprove).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("planning.submit is a separate tool that calls the submit service", async () => {
    mockSubmit.mockResolvedValue(makeDoc({ status: "submitted" }) as never);

    const { client, server } = await connectClient();
    try {
      await client.callTool({
        name: "planning.submit",
        arguments: { projectId: "p1" },
      });

      expect(mockSubmit).toHaveBeenCalledTimes(1);
      expect(mockCreateOrUpdate).not.toHaveBeenCalled();
      expect(mockApprove).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("planning.approve is a separate tool that calls the approve service", async () => {
    mockApprove.mockResolvedValue(makeDoc({ status: "approved", version: 1 }) as never);

    const { client, server } = await connectClient();
    try {
      await client.callTool({
        name: "planning.approve",
        arguments: { projectId: "p1", expectedVersion: 1 },
      });

      expect(mockApprove).toHaveBeenCalledTimes(1);
      expect(mockCreateOrUpdate).not.toHaveBeenCalled();
      expect(mockSubmit).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("planning.approve with rejectionReason calls reject instead of approve", async () => {
    mockReject.mockResolvedValue(makeDoc({ status: "rejected", version: 1, rejectionReason: "Bad" }) as never);

    const { client, server } = await connectClient();
    try {
      await client.callTool({
        name: "planning.approve",
        arguments: { projectId: "p1", expectedVersion: 1, rejectionReason: "Bad" },
      });

      expect(mockReject).toHaveBeenCalledTimes(1);
      expect(mockApprove).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});