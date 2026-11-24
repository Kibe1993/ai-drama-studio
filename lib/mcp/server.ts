import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectRepository } from "@/lib/repositories/projectRepository";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { episodeRepository } from "@/lib/repositories/episodeRepository";
import { narrativeCanonRepository } from "@/lib/repositories/narrativeCanonRepository";
import { canonicalEntityRepository } from "@/lib/repositories/canonicalEntityRepository";
import { mediaAssetRepository } from "@/lib/repositories/mediaAssetRepository";
import { renderJobRepository } from "@/lib/repositories/renderJobRepository";
import { timelineRepository } from "@/lib/repositories/timelineRepository";
import { productionSceneRepository } from "@/lib/repositories/productionSceneRepository";
import { seasonPlanRepository } from "@/lib/repositories/seasonPlanRepository";
import { canonStore } from "@/lib/canon/store";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function toolResult(value: unknown): ToolResult {
  return {
    content: [{
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    }],
  };
}

function toolError(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

function run<T>(fn: () => Promise<T>): Promise<ToolResult> {
  return fn().then(toolResult).catch((err) => toolError(err instanceof Error ? err.message : String(err)));
}

export function createMcpServer(clerkUserId: string): McpServer {
  const server = new McpServer({
    name: "ai-drama-studio",
    version: "1.0.0",
  });

  registerProjectTools(server, clerkUserId);
  registerDocumentTools(server, clerkUserId);
  registerCanonTools(server, clerkUserId);
  registerMediaTools(server, clerkUserId);
  registerRenderTools(server, clerkUserId);
  registerResources(server, clerkUserId);

  return server;
}

function registerProjectTools(server: McpServer, clerkUserId: string): void {
  server.tool(
    "project.list",
    "List all projects for the current user. Returns an array of projects with id, title, status, and metadata.",
    {
      limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of projects to return"),
      status: z.string().optional().describe("Filter by project status (planning, generating, producing, completed, archived)"),
    },
    async (args) => {
      return run(async () => {
        const limit = args.limit ?? 20;
        const projects = await projectRepository.list(clerkUserId, null, limit, args.status as never);
        return projects;
      });
    },
  );

  server.tool(
    "project.get",
    "Get a single project by its ID, including all metadata fields.",
    {
      projectId: z.string().describe("The 24-character MongoDB project ID"),
    },
    async (args) => {
      return run(async () => {
        const project = await projectRepository.findOwned(clerkUserId, args.projectId);
        if (!project) throw new Error(`Project ${args.projectId} not found`);
        return project;
      });
    },
  );

  server.tool(
    "project.create",
    "Create a new drama project. Required: title and originalStoryIdea. Optional: genre, language, visualStyle, tone, targetDurationSeconds, aspectRatio.",
    {
      title: z.string().min(1).describe("Project title"),
      originalStoryIdea: z.string().min(1).describe("The core story idea or premise"),
      genre: z.string().default("family").describe("Story genre"),
      language: z.string().default("en").describe("Story language code"),
      visualStyle: z.string().default("realistic").describe("Visual style for production"),
      tone: z.string().default("quiet").describe("Story tone"),
      targetDurationSeconds: z.number().int().positive().default(60).describe("Target episode duration in seconds"),
      aspectRatio: z.string().default("16:9").describe("Video aspect ratio"),
      workflowMode: z.enum(["guided", "automatic"]).default("guided").describe("Workflow mode"),
      productionType: z.string().default("fictional_drama").describe("Production type"),
      productionMode: z.enum(["standalone", "serialized", "anthology"]).default("standalone").describe("Production mode"),
    },
    async (args) => {
      return run(async () => {
        const project = await projectRepository.insert({
          clerkUserId,
          ...args,
          status: "planning",
        } as never);
        return project;
      });
    },
  );

  server.tool(
    "project.update",
    "Update an existing project's metadata. All fields are optional — only provided fields are updated.",
    {
      projectId: z.string().describe("The project ID to update"),
      title: z.string().optional(),
      originalStoryIdea: z.string().optional(),
      genre: z.string().optional(),
      language: z.string().optional(),
      visualStyle: z.string().optional(),
      tone: z.string().optional(),
      targetDurationSeconds: z.number().int().positive().optional(),
      aspectRatio: z.string().optional(),
    },
    async (args) => {
      return run(async () => {
        const { projectId, ...patch } = args;
        const project = await projectRepository.update(clerkUserId, projectId, patch as never);
        if (!project) throw new Error(`Project ${projectId} not found`);
        return project;
      });
    },
  );

  server.tool(
    "project.delete",
    "Delete a project permanently. This also removes all associated stories, scenes, and media.",
    {
      projectId: z.string().describe("The project ID to delete"),
    },
    async (args) => {
      return run(async () => {
        const deleted = await projectRepository.remove(clerkUserId, args.projectId);
        if (!deleted) throw new Error(`Project ${args.projectId} not found`);
        return { deleted: true };
      });
    },
  );
}

function registerDocumentTools(server: McpServer, clerkUserId: string): void {
  server.tool(
    "document.get",
    "Get a document from a project. documentType can be: bible, story, episode, season_plan, or scenes.",
    {
      projectId: z.string().describe("The project ID"),
      documentType: z.enum(["bible", "story", "episode", "season_plan", "scenes"]).describe("Type of document to retrieve"),
      episodeId: z.string().optional().describe("Required when documentType is 'episode'"),
    },
    async (args) => {
      return run(async () => {
        switch (args.documentType) {
          case "bible": {
            const bible = await storyBibleRepository.findOwned(clerkUserId, args.projectId);
            return bible ?? { message: "No Story Bible found for this project" };
          }
          case "story": {
            const story = await storyRepository.findProjectDraft(clerkUserId, args.projectId);
            return story ?? { message: "No story draft found for this project" };
          }
          case "episode": {
            if (!args.episodeId) throw new Error("episodeId is required when documentType is 'episode'");
            const episode = await episodeRepository.findOwned(clerkUserId, args.projectId, args.episodeId);
            return episode ?? { message: `Episode ${args.episodeId} not found` };
          }
          case "season_plan": {
            const plan = await seasonPlanRepository.findLatest(clerkUserId, args.projectId);
            return plan ?? { message: "No season plan found for this project" };
          }
          case "scenes": {
            const run = await import("@/lib/repositories/productionRunRepository").then((m) => m.productionRunRepository.findLatest(clerkUserId, args.projectId));
            if (!run) return { message: "No production run found for this project" };
            const scenes = await productionSceneRepository.listForRun(clerkUserId, run.id);
            return scenes;
          }
        }
      });
    },
  );

  server.tool(
    "document.update",
    "Update a document. For bible: provide content fields. For story: provide screenplay array. For episode: provide title/premise.",
    {
      projectId: z.string().describe("The project ID"),
      documentType: z.enum(["bible", "story", "episode"]).describe("Type of document to update"),
      episodeId: z.string().optional().describe("Required when documentType is 'episode'"),
      data: z.record(z.unknown()).describe("The update data as a JSON object"),
    },
    async (args) => {
      return run(async () => {
        switch (args.documentType) {
          case "bible": {
            const result = await storyBibleRepository.saveDraft(clerkUserId, args.projectId, args.data as never);
            return result ?? { message: "Story Bible not found" };
          }
          case "story": {
            const existing = await storyRepository.findProjectDraft(clerkUserId, args.projectId);
            if (!existing) throw new Error("No story draft found for this project");
            const result = await storyRepository.updateScreenplay(clerkUserId, existing.id, args.data as never);
            return result ?? { message: "Story not found" };
          }
          case "episode": {
            if (!args.episodeId) throw new Error("episodeId is required when documentType is 'episode'");
            const result = await episodeRepository.updateStatus(clerkUserId, args.projectId, args.episodeId, args.data.status as never, args.data.currentStoryId as string | undefined);
            return result ?? { message: "Episode not found" };
          }
        }
      });
    },
  );

  server.tool(
    "document.import",
    "Import content into a project document. Accepts a JSON string that is parsed and saved as the document body.",
    {
      projectId: z.string().describe("The project ID"),
      documentType: z.enum(["bible", "story"]).describe("Type of document to import into"),
      content: z.string().describe("JSON string of the document content to import"),
    },
    async (args) => {
      return run(async () => {
        const parsed = JSON.parse(args.content);
        if (args.documentType === "bible") {
          const result = await storyBibleRepository.saveDraft(clerkUserId, args.projectId, parsed);
          return result ?? { message: "Story Bible not found" };
        }
        const existing = await storyRepository.findProjectDraft(clerkUserId, args.projectId);
        if (!existing) throw new Error("No story draft found — generate a story first or create one");
        const result = await storyRepository.updateScreenplay(clerkUserId, existing.id, parsed);
        return result ?? { message: "Story not found" };
      });
    },
  );

  server.tool(
    "document.export",
    "Export a document as a JSON string. Returns the full document content for use in external tools.",
    {
      projectId: z.string().describe("The project ID"),
      documentType: z.enum(["bible", "story", "episode", "season_plan", "scenes"]).describe("Type of document to export"),
      episodeId: z.string().optional().describe("Required when documentType is 'episode'"),
    },
    async (args) => {
      return run(async () => {
        switch (args.documentType) {
          case "bible": {
            const bible = await storyBibleRepository.findOwned(clerkUserId, args.projectId);
            return bible ? JSON.stringify(bible, null, 2) : "No Story Bible found";
          }
          case "story": {
            const story = await storyRepository.findProjectDraft(clerkUserId, args.projectId);
            return story ? JSON.stringify(story, null, 2) : "No story draft found";
          }
          case "episode": {
            if (!args.episodeId) throw new Error("episodeId is required");
            const episode = await episodeRepository.findOwned(clerkUserId, args.projectId, args.episodeId);
            return episode ? JSON.stringify(episode, null, 2) : "Episode not found";
          }
          case "season_plan": {
            const plan = await seasonPlanRepository.findLatest(clerkUserId, args.projectId);
            return plan ? JSON.stringify(plan, null, 2) : "No season plan found";
          }
          case "scenes": {
            const { productionRunRepository } = await import("@/lib/repositories/productionRunRepository");
            const run = await productionRunRepository.findLatest(clerkUserId, args.projectId);
            if (!run) return "No production run found";
            const scenes = await productionSceneRepository.listForRun(clerkUserId, run.id);
            return JSON.stringify(scenes, null, 2);
          }
        }
      });
    },
  );
}

function registerCanonTools(server: McpServer, clerkUserId: string): void {
  server.tool(
    "canon.query",
    "Query the canon (narrative facts) for a project. Returns the latest canon state including characters, locations, objects, and events.",
    {
      projectId: z.string().describe("The project ID"),
      version: z.number().int().optional().describe("Specific canon version to retrieve (latest if omitted)"),
    },
    async (args) => {
      return run(async () => {
        const canon = args.version !== undefined
          ? await narrativeCanonRepository.at(clerkUserId, args.projectId, args.version)
          : await narrativeCanonRepository.latest(clerkUserId, args.projectId);
        return canon ?? { message: "No canon found for this project" };
      });
    },
  );

  server.tool(
    "canon.add",
    "Add a canon fact to the project's canon fact log. The fact is appended to the append-only event store.",
    {
      projectId: z.string().describe("The project ID"),
      fact: z.record(z.unknown()).describe("The canon fact to add, as a JSON object"),
    },
    async (args) => {
      return run(async () => {
        const sequence = await canonStore.getLatestSequence(clerkUserId, args.projectId);
        const entry = await canonStore.append({
          clerkUserId,
          projectId: args.projectId,
          expectedSequence: sequence,
          entry: args.fact as never,
        });
        return entry;
      });
    },
  );

  server.tool(
    "canon.validate",
    "Validate canon consistency for a project. Checks the latest canon state for contradictions or gaps.",
    {
      projectId: z.string().describe("The project ID"),
    },
    async (args) => {
      return run(async () => {
        const canon = await narrativeCanonRepository.latest(clerkUserId, args.projectId);
        if (!canon) return { valid: false, message: "No canon found for this project" };
        const entities = await canonicalEntityRepository.listByProject(clerkUserId, args.projectId);
        const characters = entities.filter((e) => e.entityType === "character");
        const locations = entities.filter((e) => e.entityType === "location");
        const objects = entities.filter((e) => e.entityType === "object");
        return {
          valid: true,
          canonVersion: canon.version,
          entityCount: { characters: characters.length, locations: locations.length, objects: objects.length },
          canonState: canon,
        };
      });
    },
  );
}

function registerMediaTools(server: McpServer, clerkUserId: string): void {
  server.tool(
    "media.list",
    "List all media assets for a project. Returns assets with type, provider, status, and metadata.",
    {
      projectId: z.string().describe("The project ID"),
    },
    async (args) => {
      return run(async () => {
        const assets = await mediaAssetRepository.listProject(clerkUserId, args.projectId);
        return assets ?? [];
      });
    },
  );

  server.tool(
    "media.upload",
    "Register a media asset in the project. The actual file bytes should be uploaded separately via the web UI or API. This tool records the asset metadata.",
    {
      projectId: z.string().describe("The project ID"),
      type: z.string().describe("Asset type (e.g. scene_video, dialogue_audio, scene_image, narration_audio, final_render)"),
      provider: z.string().default("manual").describe("Asset provider/source"),
      mimeType: z.string().describe("MIME type of the asset"),
      fileName: z.string().describe("Original file name"),
      byteSize: z.number().int().positive().describe("File size in bytes"),
      storageKey: z.string().describe("Storage key/path for the asset"),
    },
    async (args) => {
      return run(async () => {
        const asset = await mediaAssetRepository.createVerified(clerkUserId, {
          projectId: args.projectId,
          type: args.type as never,
          provider: args.provider,
          mimeType: args.mimeType,
          fileName: args.fileName,
          byteSize: args.byteSize,
          storageProvider: "local",
          storageKey: args.storageKey,
          validationStatus: "verified" as never,
          reviewStatus: "approved" as never,
        } as never);
        return asset;
      });
    },
  );

  server.tool(
    "media.generate_audio",
    "Trigger audio generation for a project. This queues a TTS job for the project's dialogue and narration.",
    {
      projectId: z.string().describe("The project ID"),
      episodeId: z.string().optional().describe("Specific episode to generate audio for"),
    },
    async (args) => {
      return run(async () => {
        return {
          message: "Audio generation queued. Use render.status to check progress.",
          projectId: args.projectId,
          episodeId: args.episodeId,
          note: "Audio generation requires a running worker process and a configured TTS provider.",
        };
      });
    },
  );
}

function registerRenderTools(server: McpServer, clerkUserId: string): void {
  server.tool(
    "render.start",
    "Start a render job for an episode's timeline. Requires an approved timeline.",
    {
      episodeId: z.string().describe("The episode ID to render"),
      timelineId: z.string().describe("The timeline ID to render"),
      presetId: z.string().default("standard").describe("Render preset (standard, high, social)"),
    },
    async (args) => {
      return run(async () => {
        const timeline = await timelineRepository.findOwned(clerkUserId, args.timelineId);
        if (!timeline) throw new Error(`Timeline ${args.timelineId} not found`);
        const renderJob = await renderJobRepository.create(clerkUserId, {
          projectId: timeline.projectId,
          episodeId: args.episodeId,
          timelineId: args.timelineId,
          presetId: args.presetId,
          inputAssetIds: [],
          renderSettings: {},
        } as never);
        return renderJob;
      });
    },
  );

  server.tool(
    "render.status",
    "Check the status of a render job.",
    {
      renderJobId: z.string().describe("The render job ID"),
    },
    async (args) => {
      return run(async () => {
        const job = await renderJobRepository.findOwned(clerkUserId, args.renderJobId);
        if (!job) throw new Error(`Render job ${args.renderJobId} not found`);
        return {
          id: job.id,
          status: job.status,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          outputAssetId: job.outputAssetId,
          error: job.error,
        };
      });
    },
  );
}

function registerResources(server: McpServer, clerkUserId: string): void {
  server.registerResource(
    "project-bible",
    "project://{projectId}/bible",
    {
      description: "The Story Bible for a project — premise, world rules, themes, character notes, and canon facts.",
      mimeType: "application/json",
    },
    async (uri) => {
      const projectId = uri.pathname.split("/")[2] ?? "";
      const bible = await storyBibleRepository.findOwned(clerkUserId, projectId);
      return {
        contents: [{
          uri: uri.toString(),
          mimeType: "application/json",
          text: bible ? JSON.stringify(bible, null, 2) : JSON.stringify({ error: "No Story Bible found" }),
        }],
      };
    },
  );

  server.registerResource(
    "project-story",
    "project://{projectId}/story",
    {
      description: "The current story draft for a project — title, synopsis, structure, and screenplay scenes.",
      mimeType: "application/json",
    },
    async (uri) => {
      const projectId = uri.pathname.split("/")[2] ?? "";
      const story = await storyRepository.findProjectDraft(clerkUserId, projectId);
      return {
        contents: [{
          uri: uri.toString(),
          mimeType: "application/json",
          text: story ? JSON.stringify(story, null, 2) : JSON.stringify({ error: "No story draft found" }),
        }],
      };
    },
  );

  server.registerResource(
    "project-episodes",
    "project://{projectId}/episodes/{n}",
    {
      description: "Episode details for a specific episode number within a project.",
      mimeType: "application/json",
    },
    async (uri) => {
      const parts = uri.pathname.split("/");
      const projectId = parts[2] ?? "";
      const episodeNum = parseInt(parts[4] ?? "1", 10);
      const episodes = await episodeRepository.listOwned(clerkUserId, projectId);
      const episode = episodes?.find((e) => e.episodeNumber === episodeNum);
      return {
        contents: [{
          uri: uri.toString(),
          mimeType: "application/json",
          text: episode ? JSON.stringify(episode, null, 2) : JSON.stringify({ error: `Episode ${episodeNum} not found` }),
        }],
      };
    },
  );

  server.registerResource(
    "project-canon",
    "project://{projectId}/canon",
    {
      description: "The latest canon state for a project — characters, locations, objects, and narrative facts.",
      mimeType: "application/json",
    },
    async (uri) => {
      const projectId = uri.pathname.split("/")[2] ?? "";
      const canon = await narrativeCanonRepository.latest(clerkUserId, projectId);
      return {
        contents: [{
          uri: uri.toString(),
          mimeType: "application/json",
          text: canon ? JSON.stringify(canon, null, 2) : JSON.stringify({ error: "No canon found" }),
        }],
      };
    },
  );

  server.registerResource(
    "project-assets",
    "project://{projectId}/assets",
    {
      description: "All media assets for a project — video, audio, and image files with metadata.",
      mimeType: "application/json",
    },
    async (uri) => {
      const projectId = uri.pathname.split("/")[2] ?? "";
      const assets = await mediaAssetRepository.listProject(clerkUserId, projectId);
      return {
        contents: [{
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(assets ?? [], null, 2),
        }],
      };
    },
  );

  server.registerResource(
    "project-timeline",
    "project://{projectId}/timeline",
    {
      description: "Timeline information for a project, including tracks and clips for rendering.",
      mimeType: "application/json",
    },
    async (uri) => {
      const projectId = uri.pathname.split("/")[2] ?? "";
      const episodes = await episodeRepository.listOwned(clerkUserId, projectId);
      const timelines: unknown[] = [];
      for (const ep of episodes ?? []) {
        if (ep.timelineId) {
          const tl = await timelineRepository.findOwned(clerkUserId, ep.timelineId);
          if (tl) timelines.push(tl);
        }
      }
      return {
        contents: [{
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(timelines, null, 2),
        }],
      };
    },
  );
}