import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectService } from "@/lib/services/projectService";
import { storyBibleService } from "@/lib/services/storyBibleService";
import { createPipelineService } from "@/lib/services/pipelineService";
import { livePipelineDeps } from "@/lib/pipeline/live";
import { createRenderService } from "@/lib/services/renderService";
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
import { derivedToCanonState } from "@/lib/canon/bridge";
import type { RequestAuth } from "@/lib/auth/session";
import { GENRES, LANGUAGES, VISUAL_STYLES, ASPECT_RATIOS, PRODUCTION_TYPES } from "@/lib/domain/projectCatalog";

const genreIds = GENRES.map((g) => g.id) as [(typeof GENRES)[number]["id"], ...(typeof GENRES)[number]["id"][]];
const languageIds = LANGUAGES.map((l) => l.id) as [(typeof LANGUAGES)[number]["id"], ...(typeof LANGUAGES)[number]["id"][]];
const visualStyleIds = VISUAL_STYLES.map((v) => v.id) as [(typeof VISUAL_STYLES)[number]["id"], ...(typeof VISUAL_STYLES)[number]["id"][]];
const aspectRatioIds = ASPECT_RATIOS.map((a) => a.id) as [(typeof ASPECT_RATIOS)[number]["id"], ...(typeof ASPECT_RATIOS)[number]["id"][]];
const productionTypeIds = PRODUCTION_TYPES.map((p) => p.id) as [(typeof PRODUCTION_TYPES)[number]["id"], ...(typeof PRODUCTION_TYPES)[number]["id"][]];

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

function makeActor(clerkUserId: string): RequestAuth {
  return { userId: clerkUserId, isAdmin: false, email: "", name: "MCP", imageUrl: "" };
}

function logTool(tool: string, clerkUserId: string, detail: string): void {
  const ts = new Date().toISOString();
  console.log(`[MCP] ${ts} tool=${tool} user=${clerkUserId} ${detail}`);
}

export function createMcpServer(clerkUserId: string): McpServer {
  const actor = makeActor(clerkUserId);
  const server = new McpServer({
    name: "ai-drama-studio",
    version: "1.0.0",
  });

  registerProjectTools(server, actor, clerkUserId);
  registerDocumentTools(server, actor, clerkUserId);
  registerCanonTools(server, clerkUserId);
  registerMediaTools(server, clerkUserId);
  registerRenderTools(server, actor, clerkUserId);
  registerResources(server, clerkUserId);

  return server;
}

function registerProjectTools(server: McpServer, actor: RequestAuth, clerkUserId: string): void {
  server.tool(
    "project.list",
    "List all projects for the current user. Returns an array of projects with id, title, status, and metadata.",
    {
      limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of projects to return"),
      status: z.string().optional().describe("Filter by project status"),
    },
    async (args) => {
      return run(async () => {
        const result = await projectService.list(actor, null, (args.status as never) ?? null);
        return result.projects.slice(0, args.limit ?? 20);
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
        return await projectService.get(actor, args.projectId);
      });
    },
  );

  server.tool(
    "project.create",
    "Create a new drama project. Required: title and originalStoryIdea. Optional: genre, language, visualStyle, tone, targetDurationSeconds, aspectRatio.",
    {
      title: z.string().min(1).max(200).describe("Project title"),
      originalStoryIdea: z.string().min(1).max(10000).describe("The core story idea or premise"),
      genre: z.enum(genreIds).default("family").describe("Story genre"),
      language: z.enum(languageIds).default("en").describe("Story language code"),
      visualStyle: z.enum(visualStyleIds).default("realistic").describe("Visual style for production"),
      tone: z.string().default("quiet").describe("Story tone"),
      targetDurationSeconds: z.number().int().positive().max(3600).default(60).describe("Target episode duration in seconds"),
      aspectRatio: z.enum(aspectRatioIds).default("16:9").describe("Video aspect ratio"),
      productionType: z.enum(productionTypeIds).default("fictional_drama").describe("Production type"),
      productionMode: z.enum(["standalone", "serialized", "anthology"]).default("standalone").describe("Production mode"),
    },
    async (args) => {
      return run(async () => {
        logTool("project.create", clerkUserId, `title="${args.title}"`);
        return await projectService.create(actor, {
          title: args.title,
          originalStoryIdea: args.originalStoryIdea,
          genre: args.genre,
          language: args.language,
          visualStyle: args.visualStyle,
          tone: args.tone,
          targetDurationSeconds: args.targetDurationSeconds,
          aspectRatio: args.aspectRatio,
          productionType: args.productionType,
          productionMode: args.productionMode,
        }, null);
      });
    },
  );

  server.tool(
    "project.update",
    "Update an existing project's metadata. All fields are optional — only provided fields are updated. Cannot update archived or in-production projects.",
    {
      projectId: z.string().describe("The project ID to update"),
      title: z.string().min(1).max(200).optional(),
      originalStoryIdea: z.string().min(1).max(10000).optional(),
      genre: z.enum(genreIds).optional(),
      language: z.enum(languageIds).optional(),
      visualStyle: z.enum(visualStyleIds).optional(),
      tone: z.string().optional(),
      targetDurationSeconds: z.number().int().positive().max(3600).optional(),
      aspectRatio: z.enum(aspectRatioIds).optional(),
      productionType: z.enum(productionTypeIds).optional(),
      productionMode: z.enum(["standalone", "serialized", "anthology"]).optional(),
    },
    async (args) => {
      return run(async () => {
        logTool("project.update", clerkUserId, `projectId=${args.projectId}`);
        const current = await projectService.get(actor, args.projectId);
        return await projectService.update(actor, args.projectId, {
          title: args.title ?? current.title,
          originalStoryIdea: args.originalStoryIdea ?? current.originalStoryIdea,
          genre: args.genre ?? current.genre,
          language: args.language ?? current.language,
          visualStyle: args.visualStyle ?? current.visualStyle,
          tone: args.tone ?? current.tone,
          targetDurationSeconds: args.targetDurationSeconds ?? current.targetDurationSeconds,
          aspectRatio: args.aspectRatio ?? current.aspectRatio,
          productionType: args.productionType ?? current.productionType,
          productionMode: args.productionMode ?? current.productionMode,
        });
      });
    },
  );

  server.tool(
    "project.delete",
    "Delete a project permanently. Requires confirmProjectName to match the project title exactly. This prevents accidental deletion. Note: only the project record is deleted; child documents (stories, episodes, media) may remain as orphans.",
    {
      projectId: z.string().describe("The project ID to delete"),
      confirmProjectName: z.string().describe("Must exactly match the project title to confirm deletion"),
    },
    async (args) => {
      return run(async () => {
        const project = await projectService.get(actor, args.projectId);
        if (project.title !== args.confirmProjectName) {
          throw new Error(`Confirmation failed: confirmProjectName "${args.confirmProjectName}" does not match project title "${project.title}"`);
        }
        logTool("project.delete", clerkUserId, `projectId=${args.projectId} title="${project.title}"`);
        return await projectService.remove(actor, args.projectId);
      });
    },
  );
}

function registerDocumentTools(server: McpServer, actor: RequestAuth, clerkUserId: string): void {
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
    "Propose an update to a document. Returns a preview of the change. Set confirm=true to apply the change. For bible: provide content fields. For story: provide screenplay array. For episode: provide title/premise only (status changes are not allowed via MCP).",
    {
      projectId: z.string().describe("The project ID"),
      documentType: z.enum(["bible", "story", "episode"]).describe("Type of document to update"),
      episodeId: z.string().optional().describe("Required when documentType is 'episode'"),
      data: z.record(z.unknown()).describe("The update data as a JSON object"),
      confirm: z.boolean().default(false).describe("Set to true to apply the change. Default false returns a preview only."),
    },
    async (args) => {
      return run(async () => {
        if (!args.confirm) {
          return {
            preview: true,
            message: "This is a preview. Call again with confirm=true to apply the change.",
            documentType: args.documentType,
            projectId: args.projectId,
            proposedData: args.data,
          };
        }

        logTool("document.update", clerkUserId, `projectId=${args.projectId} type=${args.documentType}`);

        switch (args.documentType) {
          case "bible": {
            const result = await storyBibleService.save(actor, args.projectId, args.data as never);
            return result;
          }
          case "story": {
            const existing = await storyRepository.findProjectDraft(clerkUserId, args.projectId);
            if (!existing) throw new Error("No story draft found for this project");
            if (existing.status !== "awaiting_approval") {
              throw new Error(`Story is in status "${existing.status}". Only stories in "awaiting_approval" status can be updated.`);
            }
            const result = await storyRepository.updateScreenplay(clerkUserId, existing.id, args.data as never);
            return result ?? { message: "Story update returned no result" };
          }
          case "episode": {
            if (!args.episodeId) throw new Error("episodeId is required when documentType is 'episode'");
            const episode = await episodeRepository.findOwned(clerkUserId, args.projectId, args.episodeId);
            if (!episode) throw new Error(`Episode ${args.episodeId} not found`);
            const allowedFields = ["title", "premise", "synopsis"];
            const patch: Record<string, unknown> = {};
            for (const key of allowedFields) {
              if (key in args.data) patch[key] = args.data[key];
            }
            if (Object.keys(patch).length === 0) {
              throw new Error("No updatable fields provided. Allowed fields: title, premise, synopsis. Episode status cannot be changed via MCP.");
            }
            const result = await episodeRepository.update(clerkUserId, args.projectId, args.episodeId, patch as { title?: string; premise?: string; synopsis?: string });
            return result ?? { message: "Episode update returned no result" };
          }
        }
      });
    },
  );

  server.tool(
    "document.import",
    "Import content into a project document. Accepts a JSON string that is parsed and saved. Set confirm=true to apply.",
    {
      projectId: z.string().describe("The project ID"),
      documentType: z.enum(["bible", "story"]).describe("Type of document to import into"),
      content: z.string().max(500000).describe("JSON string of the document content to import"),
      confirm: z.boolean().default(false).describe("Set to true to apply the import. Default false returns a preview only."),
    },
    async (args) => {
      return run(async () => {
        const parsed = JSON.parse(args.content);

        if (!args.confirm) {
          return {
            preview: true,
            message: "This is a preview. Call again with confirm=true to apply the import.",
            documentType: args.documentType,
            projectId: args.projectId,
            parsedContent: parsed,
          };
        }

        logTool("document.import", clerkUserId, `projectId=${args.projectId} type=${args.documentType}`);

        if (args.documentType === "bible") {
          const result = await storyBibleService.save(actor, args.projectId, parsed);
          return result;
        }
        const existing = await storyRepository.findProjectDraft(clerkUserId, args.projectId);
        if (!existing) throw new Error("No story draft found — generate a story first or create one");
        if (existing.status !== "awaiting_approval") {
          throw new Error(`Story is in status "${existing.status}". Only stories in "awaiting_approval" status can be updated.`);
        }
        const result = await storyRepository.updateScreenplay(clerkUserId, existing.id, parsed);
        return result ?? { message: "Story import returned no result" };
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
    "Add a canon fact to the project's canon fact log. Set confirm=true to apply; default false returns a preview. When confirmed, the fact is appended to the append-only event store and a new canon state version is committed.",
    {
      projectId: z.string().describe("The project ID"),
      fact: z.record(z.unknown()).describe("The canon fact to add, as a JSON object"),
      confirm: z.boolean().default(false).describe("Set to true to apply. Default false returns a preview only."),
    },
    async (args) => {
      return run(async () => {
        if (!args.confirm) {
          return {
            preview: true,
            message: "This is a preview. Call again with confirm=true to apply the canon fact.",
            projectId: args.projectId,
            proposedFact: args.fact,
          };
        }

        logTool("canon.add", clerkUserId, `projectId=${args.projectId}`);

        const sequence = await canonStore.getLatestSequence(clerkUserId, args.projectId);
        const entry = await canonStore.append({
          clerkUserId,
          projectId: args.projectId,
          expectedSequence: sequence,
          entry: args.fact as never,
        });

        const canon = await canonStore.latestState(clerkUserId, args.projectId);
        const latest = await narrativeCanonRepository.latest(clerkUserId, args.projectId);
        const nextVersion = (latest?.version ?? 0) + 1;
        const canonState = derivedToCanonState(canon, {
          basedOnBibleVersion: latest?.basedOnBibleVersion ?? 0,
          basedOnPlanVersion: latest?.basedOnPlanVersion ?? 0,
        });
        await narrativeCanonRepository.commit({
          clerkUserId,
          projectId: args.projectId,
          expectedVersion: latest?.version ?? 0,
          state: { ...canonState, version: nextVersion },
          reason: `MCP canon.add: ${JSON.stringify(args.fact).slice(0, 100)}`,
        }).catch((err: unknown) => {
          console.error(`[MCP] canon state commit failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        });

        return entry;
      });
    },
  );

  server.tool(
    "canon.summary",
    "Get a summary of the canon state for a project — entity counts, version, and state snapshot. This is a summary tool, not a validator.",
    {
      projectId: z.string().describe("The project ID"),
    },
    async (args) => {
      return run(async () => {
        const canon = await narrativeCanonRepository.latest(clerkUserId, args.projectId);
        if (!canon) return { message: "No canon found for this project" };
        const entities = await canonicalEntityRepository.listByProject(clerkUserId, args.projectId);
        const characters = entities.filter((e) => e.entityType === "character");
        const locations = entities.filter((e) => e.entityType === "location");
        const objects = entities.filter((e) => e.entityType === "object");
        return {
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
    "Register a media asset in the project. The actual file bytes should be uploaded separately via the web UI or API. This tool records the asset metadata. The asset is created with reviewStatus=pending and validationStatus=pending — it must be reviewed and validated through the web UI before use.",
    {
      projectId: z.string().describe("The project ID"),
      type: z.enum(["scene_video", "dialogue_audio", "scene_image", "narration_audio", "final_render", "music", "sfx"]).describe("Asset type"),
      provider: z.string().default("manual").describe("Asset provider/source"),
      mimeType: z.string().max(200).describe("MIME type of the asset"),
      fileName: z.string().max(500).describe("Original file name"),
      byteSize: z.number().int().positive().describe("File size in bytes"),
      storageKey: z.string().max(1000).describe("Storage key/path for the asset"),
    },
    async (args) => {
      return run(async () => {
        logTool("media.upload", clerkUserId, `projectId=${args.projectId} type=${args.type}`);
        const asset = await mediaAssetRepository.createVerified(clerkUserId, {
          projectId: args.projectId,
          type: args.type,
          provider: args.provider,
          mimeType: args.mimeType,
          fileName: args.fileName,
          byteSize: args.byteSize,
          storageProvider: "local",
          storageKey: args.storageKey,
          validationStatus: "pending",
          reviewStatus: "pending",
        } as never);
        return asset;
      });
    },
  );

  server.tool(
    "media.generate_audio",
    "Audio generation is not available through MCP. TTS audio generation requires a running worker process and a configured Kokoro TTS provider. Use the web UI or the production API to trigger audio generation.",
    {
      projectId: z.string().describe("The project ID"),
      episodeId: z.string().optional().describe("Specific episode to generate audio for"),
    },
    async () => {
      return toolResult({
        supported: false,
        reason: "Audio generation is not available through MCP. Use the web UI at /projects/{projectId}/audio to trigger TTS generation.",
      });
    },
  );
}

function registerRenderTools(server: McpServer, actor: RequestAuth, clerkUserId: string): void {
  server.tool(
    "render.start",
    "Start a render job for an episode's timeline. Requires an approved timeline. Routes through the render service which validates the preset, checks timeline approval, collects assets, and enqueues the job.",
    {
      episodeId: z.string().describe("The episode ID to render"),
      timelineId: z.string().describe("The timeline ID to render"),
      presetId: z.enum(["standard", "high", "social"]).default("standard").describe("Render preset"),
    },
    async (args) => {
      return run(async () => {
        logTool("render.start", clerkUserId, `timeline=${args.timelineId} preset=${args.presetId}`);
        const renderService = createRenderService();
        return await renderService.triggerRender(actor, args.timelineId, args.presetId);
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