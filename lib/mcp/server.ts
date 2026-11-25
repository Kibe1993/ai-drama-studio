import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectService } from "@/lib/services/projectService";
import { storyBibleService } from "@/lib/services/storyBibleService";
import { createPipelineService } from "@/lib/services/pipelineService";
import { livePipelineDeps } from "@/lib/pipeline/live";
import { createRenderService } from "@/lib/services/renderService";
import { workflowService } from "@/lib/services/workflowService";
import { episodeService } from "@/lib/services/episodeService";
import { productionSceneService } from "@/lib/services/productionSceneService";
import { seasonPlanService } from "@/lib/services/seasonPlanService";
import { storyDraftService } from "@/lib/services/storyDraftService";
import { planningService } from "@/lib/services/planningService";
import { productionDesignService } from "@/lib/services/productionDesignService";

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
import { productionRunRepository } from "@/lib/repositories/productionRunRepository";
import { canonStore } from "@/lib/canon/store";
import { derivedToCanonState } from "@/lib/canon/bridge";
import { logActivity, getActivityLog } from "./activityLog";
import type { RequestAuth } from "@/lib/auth/session";
import { GENRES, LANGUAGES, VISUAL_STYLES, ASPECT_RATIOS, PRODUCTION_TYPES } from "@/lib/domain/projectCatalog";
import { storyStructureSchema, screenplaySceneSchema } from "@/lib/validation/story";
import { LLM_GENERATION_ENABLED } from "@/lib/config";
import { toolConfigService } from "@/lib/services/toolConfigService";
import { TOOL_TYPES, TOOL_CATEGORIES } from "@/lib/validation/toolConfig";

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
  registerPipelineTools(server, actor, clerkUserId);
  registerEntityTools(server, clerkUserId);
  registerEpisodeTools(server, actor, clerkUserId);
  registerSceneTools(server, actor, clerkUserId);
  registerSeasonPlanTools(server, actor, clerkUserId);
  registerTimelineTools(server, clerkUserId);
  registerApprovalTools(server, actor, clerkUserId);
  registerContextTool(server, actor, clerkUserId);
  registerActivityTools(server, actor, clerkUserId);
  registerPlanningTools(server, actor, clerkUserId);
  registerProductionDesignTools(server, actor, clerkUserId);
  registerVoiceTools(server, actor, clerkUserId);
  registerToolIntegrationTools(server, actor, clerkUserId);
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

function registerToolIntegrationTools(server: McpServer, actor: RequestAuth, clerkUserId: string): void {
  server.tool(
    "tools.list",
    "List all configured external tools and their connection status. Status is evidence-based: not_installed → installed → configured → connected → available.",
    {},
    async () => {
      return run(async () => {
        return await toolConfigService.list(clerkUserId);
      });
    },
  );

  server.tool(
    "tools.get",
    "Get details of a specific external tool configuration by tool ID.",
    {
      toolId: z.string().describe("The tool configuration ID"),
    },
    async (args) => {
      return run(async () => {
        return await toolConfigService.findById(clerkUserId, args.toolId);
      });
    },
  );

  server.tool(
    "tools.configure",
    "Update configuration for an external tool. Fields: displayName, enabled, endpoint, executablePath, workingDirectory, apiKey, config.",
    {
      toolId: z.string().describe("The tool configuration ID"),
      displayName: z.string().min(1).max(80).optional(),
      enabled: z.boolean().optional(),
      endpoint: z.string().optional(),
      executablePath: z.string().optional(),
      workingDirectory: z.string().optional(),
      apiKey: z.string().optional(),
      config: z.record(z.unknown()).optional(),
    },
    async (args) => {
      return run(async () => {
        const { toolId, ...update } = args;
        return await toolConfigService.update(clerkUserId, toolId, update);
      });
    },
  );

  server.tool(
    "tools.healthCheck",
    "Run a health check on a specific tool. Returns updated status and health check result. Status transitions require evidence.",
    {
      toolId: z.string().describe("The tool configuration ID"),
    },
    async (args) => {
      return run(async () => {
        return await toolConfigService.runHealthCheck(clerkUserId, args.toolId);
      });
    },
  );

  server.tool(
    "tools.healthCheckAll",
    "Run health checks on all enabled tools. Returns array of results.",
    {},
    async () => {
      return run(async () => {
        return await toolConfigService.runHealthCheckAll(clerkUserId);
      });
    },
  );

  server.tool(
    "tools.listByCategory",
    "List tools filtered by category. Categories: image_generation, video_generation, animation_2d, animation_3d, character_creation, audio_tts, audio_editing, lip_sync, rendering, animation_codec, cloud_generation.",
    {
      category: z.enum(TOOL_CATEGORIES).describe("Tool category to filter by"),
    },
    async (args) => {
      return run(async () => {
        return await toolConfigService.listByCategory(clerkUserId, args.category);
      });
    },
  );

  server.tool(
    "tools.enable",
    "Enable a tool by its tool type (e.g. comfyui, blender, synfig). Returns updated configuration.",
    {
      toolType: z.enum(TOOL_TYPES).describe("The tool type identifier"),
    },
    async (args) => {
      return run(async () => {
        const config = await toolConfigService.findByToolType(clerkUserId, args.toolType);
        if (!config) throw new Error(`No configuration found for ${args.toolType}`);
        return await toolConfigService.update(clerkUserId, config.id, { enabled: true });
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
    "story.createDraft",
    "Create a project-level story draft from externally authored content. The draft is saved in awaiting_approval status, ready for review and approval. This bypasses LLM generation entirely.",
    {
      projectId: z.string().describe("The project ID"),
      title: z.string().min(1).max(120).describe("Story title"),
      synopsis: z.string().min(1).max(2000).describe("Story synopsis"),
      structure: storyStructureSchema.describe("Three-act structure breakdown"),
      screenplay: z.array(screenplaySceneSchema).min(1).max(40).describe("Screenplay scenes (1-40 scenes)"),
    },
    async (args) => {
      logTool("story.createDraft", clerkUserId, `projectId=${args.projectId}`);
      return run(async () => {
        await projectService.get(actor, args.projectId);
        const result = await storyRepository.upsertProjectDraft({
          clerkUserId,
          projectId: args.projectId,
          title: args.title,
          synopsis: args.synopsis,
          structure: args.structure,
          screenplay: args.screenplay,
          provider: "external",
          model: "mcp",
        });
        logActivity("story.createDraft", clerkUserId, args.projectId, `Created story draft: ${args.title}`, "success");
        return result;
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

function registerPipelineTools(server: McpServer, actor: RequestAuth, clerkUserId: string): void {
  const pipelineService = createPipelineService(livePipelineDeps());

  server.tool(
    "pipeline.get",
    "Get the current pipeline state for a project — current stage, run status, and what's awaiting action.",
    { projectId: z.string().describe("The project ID") },
    async (args) => {
      return run(async () => {
        const [pipeline, workflow] = await Promise.all([
          pipelineService.get(actor, args.projectId),
          workflowService.get(actor, args.projectId),
        ]);
        return { pipeline, workflow };
      });
    },
  );

  server.tool(
    "pipeline.start",
    "Start the production pipeline for a project. Requires an approved Story Bible. This kicks off the story → characters → scenes → render workflow.",
    {
      projectId: z.string().describe("The project ID"),
      workflowMode: z.enum(["guided", "automatic"]).default("guided").describe("Workflow mode"),
      episodeId: z.string().optional().describe("Specific episode ID to run (optional)"),
    },
    async (args) => {
      return run(async () => {
        if (!LLM_GENERATION_ENABLED) {
          throw new Error("LLM generation is disabled (LLM_GENERATION_ENABLED=false). Use story.createDraft to create content manually via MCP, then pipeline.approveStory with skipAutoAdvance=true.");
        }
        logTool("pipeline.start", clerkUserId, `projectId=${args.projectId}`);
        const result = await pipelineService.start(actor, args.projectId, args.workflowMode, args.episodeId);
        logActivity("pipeline.start", clerkUserId, args.projectId, `Started pipeline in ${args.workflowMode} mode`, "success");
        return result;
      });
    },
  );

  server.tool(
    "pipeline.generateStory",
    "Generate the story draft for a project. The story is generated by the LLM and saved as a draft awaiting approval.",
    { projectId: z.string().describe("The project ID") },
    async (args) => {
      return run(async () => {
        if (!LLM_GENERATION_ENABLED) {
          throw new Error("LLM generation is disabled (LLM_GENERATION_ENABLED=false). Use story.createDraft to create the story content manually via MCP.");
        }
        logTool("pipeline.generateStory", clerkUserId, `projectId=${args.projectId}`);
        return await pipelineService.generateStory(actor, args.projectId);
      });
    },
  );

  server.tool(
    "pipeline.approveStory",
    "Approve the generated story draft. This advances the pipeline to the next stage (character extraction). Set skipAutoAdvance=true to approve without enqueuing the LLM character extraction job — the pipeline will wait for manual character creation via MCP.",
    {
      projectId: z.string().describe("The project ID"),
      storyId: z.string().describe("The story ID to approve"),
      skipAutoAdvance: z.boolean().default(false).describe("If true, do not enqueue the LLM character extraction job. The pipeline moves to the characters stage and waits for manual input."),
    },
    async (args) => {
      return run(async () => {
        logTool("pipeline.approveStory", clerkUserId, `projectId=${args.projectId} storyId=${args.storyId} skipAutoAdvance=${args.skipAutoAdvance}`);
        const result = await pipelineService.approveStory(actor, args.projectId, args.storyId, args.skipAutoAdvance);
        logActivity("pipeline.approveStory", clerkUserId, args.projectId, `Approved story ${args.storyId}${args.skipAutoAdvance ? " (auto-advance skipped)" : ""}`, "success");
        return result;
      });
    },
  );

  server.tool(
    "pipeline.approve",
    "Approve the current pipeline stage and advance to the next. Used for character and scene approval gates. Set skipAutoAdvance=true to approve without enqueuing the next LLM job.",
    {
      projectId: z.string().describe("The project ID"),
      skipAutoAdvance: z.boolean().default(false).describe("If true, do not enqueue the next LLM job. The pipeline moves to the next stage and waits for manual input via MCP."),
    },
    async (args) => {
      return run(async () => {
        logTool("pipeline.approve", clerkUserId, `projectId=${args.projectId} skipAutoAdvance=${args.skipAutoAdvance}`);
        const result = await pipelineService.approve(actor, args.projectId, args.skipAutoAdvance);
        logActivity("pipeline.approve", clerkUserId, args.projectId, `Approved pipeline stage${args.skipAutoAdvance ? " (auto-advance skipped)" : ""}`, "success");
        return result;
      });
    },
  );

  server.tool(
    "pipeline.advance",
    "Advance the pipeline to the next stage without enqueuing any LLM job. The current stage is marked approved and the pipeline moves to the next stage in waiting_for_approval status, ready for manual content creation via MCP.",
    { projectId: z.string().describe("The project ID") },
    async (args) => {
      return run(async () => {
        logTool("pipeline.advance", clerkUserId, `projectId=${args.projectId}`);
        const result = await pipelineService.approve(actor, args.projectId, true);
        logActivity("pipeline.advance", clerkUserId, args.projectId, "Advanced pipeline stage (no LLM)", "success");
        return result;
      });
    },
  );

  server.tool(
    "pipeline.generateScenes",
    "Generate the scene breakdown for the project. Requires approved story and characters.",
    { projectId: z.string().describe("The project ID") },
    async (args) => {
      return run(async () => {
        if (!LLM_GENERATION_ENABLED) {
          throw new Error("LLM generation is disabled (LLM_GENERATION_ENABLED=false). Use scene.create to create scenes manually via MCP.");
        }
        logTool("pipeline.generateScenes", clerkUserId, `projectId=${args.projectId}`);
        return await pipelineService.generateScenes(actor, args.projectId);
      });
    },
  );

  server.tool(
    "pipeline.cancel",
    "Cancel the current pipeline run for a project.",
    { projectId: z.string().describe("The project ID") },
    async (args) => {
      return run(async () => {
        logTool("pipeline.cancel", clerkUserId, `projectId=${args.projectId}`);
        return await pipelineService.cancel(actor, args.projectId);
      });
    },
  );
}

function registerEntityTools(server: McpServer, clerkUserId: string): void {
  server.tool(
    "entity.list",
    "List canonical entities (characters, locations, objects) for a project. These are the approved and pending entities extracted from the story bible and canon.",
    {
      projectId: z.string().describe("The project ID"),
      entityType: z.enum(["character", "location", "object"]).optional().describe("Filter by entity type"),
    },
    async (args) => {
      return run(async () => {
        return await canonicalEntityRepository.listByProject(clerkUserId, args.projectId, args.entityType);
      });
    },
  );

  server.tool(
    "entity.get",
    "Get a single canonical entity by its ID, including its visual profile and status.",
    { entityId: z.string().describe("The entity ID") },
    async (args) => {
      return run(async () => {
        const entity = await canonicalEntityRepository.findOwned(clerkUserId, args.entityId);
        if (!entity) throw new Error(`Entity ${args.entityId} not found`);
        return entity;
      });
    },
  );

  server.tool(
    "entity.create",
    "Create a new canonical entity (character, location, or object). The entity is saved with 'pending_review' status and must be approved before it becomes part of the approved canon.",
    {
      projectId: z.string().describe("The project ID"),
      entityType: z.enum(["character", "location", "object"]).describe("Type of entity"),
      name: z.string().min(1).max(200).describe("Entity name"),
      description: z.string().max(2000).optional().describe("Entity description"),
      confirm: z.boolean().default(false).describe("Set to true to create. Default false returns a preview."),
    },
    async (args) => {
      return run(async () => {
        if (!args.confirm) {
          return {
            preview: true,
            message: "This is a preview. Call again with confirm=true to create the entity.",
            projectId: args.projectId,
            entityType: args.entityType,
            name: args.name,
          };
        }
        logTool("entity.create", clerkUserId, `projectId=${args.projectId} type=${args.entityType} name="${args.name}"`);
        const entity = await canonicalEntityRepository.create(clerkUserId, {
          projectId: args.projectId,
          entityType: args.entityType,
          name: args.name,
          normalizedName: args.name.toLowerCase().trim(),
          description: args.description,
        });
        logActivity("entity.create", clerkUserId, args.projectId, `Created ${args.entityType} "${args.name}"`, "success");
        return entity;
      });
    },
  );

  server.tool(
    "entity.approve",
    "Approve a pending canonical entity. Once approved, the entity becomes part of the canonical reference for the project.",
    { entityId: z.string().describe("The entity ID to approve") },
    async (args) => {
      return run(async () => {
        logTool("entity.approve", clerkUserId, `entityId=${args.entityId}`);
        const result = await canonicalEntityRepository.approve(clerkUserId, args.entityId);
        if (!result) throw new Error(`Entity ${args.entityId} not found`);
        logActivity("entity.approve", clerkUserId, null, `Approved entity ${args.entityId}`, "success");
        return result;
      });
    },
  );

  server.tool(
    "entity.updateVisualProfile",
    "Update the visual profile for a canonical entity (e.g. appearance, clothing, physical traits for characters; visual characteristics for locations).",
    {
      entityId: z.string().describe("The entity ID"),
      visualProfile: z.record(z.string(), z.unknown()).describe("Visual profile as a JSON object"),
    },
    async (args) => {
      return run(async () => {
        logTool("entity.updateVisualProfile", clerkUserId, `entityId=${args.entityId}`);
        const result = await canonicalEntityRepository.updateVisualProfile(clerkUserId, args.entityId, args.visualProfile);
        if (!result) throw new Error(`Entity ${args.entityId} not found`);
        return result;
      });
    },
  );
}

function registerEpisodeTools(server: McpServer, actor: RequestAuth, clerkUserId: string): void {
  server.tool(
    "episode.list",
    "List all episodes for a project, including their status, timeline, and render information.",
    { projectId: z.string().describe("The project ID") },
    async (args) => {
      return run(async () => {
        return await episodeService.list(actor, args.projectId);
      });
    },
  );

  server.tool(
    "episode.get",
    "Get a single episode by ID, including its full details.",
    {
      projectId: z.string().describe("The project ID"),
      episodeId: z.string().describe("The episode ID"),
    },
    async (args) => {
      return run(async () => {
        const episode = await episodeRepository.findOwned(clerkUserId, args.projectId, args.episodeId);
        if (!episode) throw new Error(`Episode ${args.episodeId} not found`);
        return episode;
      });
    },
  );

  server.tool(
    "episode.create",
    "Create a new episode for a project. The episode is created in 'draft' status.",
    {
      projectId: z.string().describe("The project ID"),
      title: z.string().min(1).max(200).describe("Episode title"),
      premise: z.string().max(5000).optional().describe("Episode premise"),
      targetDurationSeconds: z.number().int().positive().max(3600).default(60).describe("Target duration in seconds"),
    },
    async (args) => {
      return run(async () => {
        logTool("episode.create", clerkUserId, `projectId=${args.projectId} title="${args.title}"`);
        return await episodeService.create(actor, args.projectId, {
          title: args.title,
          premise: args.premise ?? "",
          targetDurationSeconds: args.targetDurationSeconds,
        });
      });
    },
  );

  server.tool(
    "episode.updateScreenplay",
    "Update the screenplay of the story linked to an episode. The story must be in awaiting_approval status. Accepts title, synopsis, and screenplay scenes.",
    {
      projectId: z.string().describe("The project ID"),
      episodeId: z.string().describe("The episode ID"),
      title: z.string().min(1).max(120).optional().describe("New story title (optional)"),
      synopsis: z.string().min(1).max(2000).optional().describe("New story synopsis (optional)"),
      screenplay: z.array(screenplaySceneSchema).min(1).max(40).describe("The full screenplay scenes array"),
    },
    async (args) => {
      logTool("episode.updateScreenplay", clerkUserId, `projectId=${args.projectId} episodeId=${args.episodeId}`);
      return run(async () => {
        const episode = await episodeRepository.findOwned(clerkUserId, args.projectId, args.episodeId);
        if (!episode) throw new Error(`Episode ${args.episodeId} not found`);
        if (!episode.currentStoryId) {
          throw new Error("This episode has no associated story. Start the pipeline or generate a story draft first.");
        }
        const story = await storyRepository.findOwned(clerkUserId, episode.currentStoryId);
        if (!story) throw new Error("The story linked to this episode was not found.");
        if (story.status === "approved") {
          throw new Error("This story is already approved. Create a new story draft to make changes.");
        }
        const result = await storyRepository.updateScreenplay(clerkUserId, story.id, {
          ...(args.title ? { title: args.title } : {}),
          ...(args.synopsis ? { synopsis: args.synopsis } : {}),
          screenplay: args.screenplay,
          validationFindings: null,
        });
        if (!result) throw new Error("The screenplay could not be updated. The story may have been approved concurrently.");
        logActivity("episode.updateScreenplay", clerkUserId, args.projectId, `Updated screenplay for episode ${args.episodeId}`, "success");
        return result;
      });
    },
  );
}

function registerSceneTools(server: McpServer, actor: RequestAuth, clerkUserId: string): void {
  server.tool(
    "scene.list",
    "List all production scenes for a project, including their scene numbers, status, and shot plans.",
    { projectId: z.string().describe("The project ID") },
    async (args) => {
      return run(async () => {
        return await productionSceneService.list(actor, args.projectId);
      });
    },
  );

  server.tool(
    "scene.create",
    "Manually create a production scene. Requires the pipeline to be at the scenes stage (waiting for approval).",
    {
      projectId: z.string().describe("The project ID"),
      sceneNumber: z.number().int().positive().describe("The scene number (must be unique within the run)"),
      title: z.string().min(1).max(160).describe("Scene title"),
      location: z.string().min(1).max(160).describe("Scene location"),
      interiorExterior: z.enum(["interior", "exterior", ""]).default("").describe("Interior or exterior"),
      timeOfDay: z.string().min(1).max(40).describe("Time of day (e.g. DAY, NIGHT, DAWN)"),
      charactersPresent: z.array(z.string().min(1).max(80)).min(1).max(8).describe("Characters present in the scene"),
      visualDescription: z.string().min(1).max(1200).describe("Visual description of the scene"),
      action: z.string().min(1).max(1200).describe("Action description"),
      dialogue: z.array(z.object({
        characterName: z.string().min(1).max(80),
        line: z.string().min(1).max(500),
      })).max(12).default([]).describe("Dialogue lines"),
      cameraDirection: z.string().max(400).default("").describe("Camera direction notes"),
      estimatedDurationSeconds: z.number().int().positive().max(180).nullable().default(null).describe("Estimated duration in seconds"),
    },
    async (args) => {
      logTool("scene.create", clerkUserId, `projectId=${args.projectId} scene=${args.sceneNumber}`);
      return run(async () => {
        const result = await productionSceneService.create(actor, args.projectId, args.sceneNumber, {
          title: args.title,
          location: args.location,
          interiorExterior: args.interiorExterior,
          timeOfDay: args.timeOfDay,
          charactersPresent: args.charactersPresent,
          visualDescription: args.visualDescription,
          action: args.action,
          dialogue: args.dialogue,
          cameraDirection: args.cameraDirection,
          estimatedDurationSeconds: args.estimatedDurationSeconds,
          shotPlan: [],
        });
        logActivity("scene.create", clerkUserId, args.projectId, `Created scene ${args.sceneNumber}: ${args.title}`, "success");
        return result;
      });
    },
  );

  server.tool(
    "scene.get",
    "Get a single production scene by its ID, including shot plan and production status.",
    { sceneId: z.string().describe("The scene ID") },
    async (args) => {
      return run(async () => {
        const scene = await productionSceneRepository.findById(clerkUserId, args.sceneId);
        if (!scene) throw new Error(`Scene ${args.sceneId} not found`);
        return scene;
      });
    },
  );

  server.tool(
    "scene.update",
    "Update a production scene's editable fields (description, notes, shot plan). Use confirm=true to apply.",
    {
      projectId: z.string().describe("The project ID"),
      sceneNumber: z.number().int().positive().describe("The scene number to update"),
      description: z.string().max(5000).optional().describe("Scene description"),
      notes: z.string().max(5000).optional().describe("Director notes"),
      confirm: z.boolean().default(false).describe("Set to true to apply. Default false returns a preview."),
    },
    async (args) => {
      return run(async () => {
        if (!args.confirm) {
          return {
            preview: true,
            message: "This is a preview. Call again with confirm=true to apply.",
            ...args,
          };
        }
        logTool("scene.update", clerkUserId, `projectId=${args.projectId} scene=${args.sceneNumber}`);
        return await productionSceneService.update(actor, args.projectId, args.sceneNumber, {
          description: args.description,
          notes: args.notes,
        } as never);
      });
    },
  );

  server.tool(
    "scene.approveShotPlan",
    "Approve the shot plan for a scene. This is required before shot production can begin.",
    {
      sceneId: z.string().describe("The scene ID"),
      shotPlan: z.array(z.record(z.string(), z.unknown())).optional().describe("Optional shot plan to set before approving"),
    },
    async (args) => {
      return run(async () => {
        logTool("scene.approveShotPlan", clerkUserId, `sceneId=${args.sceneId}`);
        const result = await productionSceneRepository.approveShotPlan(clerkUserId, args.sceneId, args.shotPlan as never);
        if (!result) throw new Error(`Scene ${args.sceneId} not found`);
        logActivity("scene.approveShotPlan", clerkUserId, null, `Approved shot plan for scene ${args.sceneId}`, "success");
        return result;
      });
    },
  );
}

function registerSeasonPlanTools(server: McpServer, actor: RequestAuth, clerkUserId: string): void {
  server.tool(
    "seasonPlan.get",
    "Get the current season plan for a project, including episode outlines, arcs, and validation status.",
    { projectId: z.string().describe("The project ID") },
    async (args) => {
      return run(async () => {
        return await seasonPlanService.get(actor, args.projectId);
      });
    },
  );

  server.tool(
    "seasonPlan.listVersions",
    "List all versions of the season plan for a project, including their approval status.",
    { projectId: z.string().describe("The project ID") },
    async (args) => {
      return run(async () => {
        return await seasonPlanRepository.listVersions(clerkUserId, args.projectId);
      });
    },
  );

  server.tool(
    "seasonPlan.start",
    "Create a new season plan for a project. The plan is saved as a draft awaiting approval. Use confirm=true to apply.",
    {
      projectId: z.string().describe("The project ID"),
      plan: z.string().max(500000).describe("Season plan content as a JSON string"),
      confirm: z.boolean().default(false).describe("Set to true to apply. Default false returns a preview."),
    },
    async (args) => {
      return run(async () => {
        const parsed = JSON.parse(args.plan);
        if (!args.confirm) {
          return {
            preview: true,
            message: "This is a preview. Call again with confirm=true to apply.",
            projectId: args.projectId,
          };
        }
        logTool("seasonPlan.start", clerkUserId, `projectId=${args.projectId}`);
        return await seasonPlanService.start(actor, args.projectId, parsed);
      });
    },
  );

  server.tool(
    "seasonPlan.update",
    "Update an existing season plan. Use confirm=true to apply.",
    {
      projectId: z.string().describe("The project ID"),
      planId: z.string().describe("The plan ID to update"),
      plan: z.string().max(500000).describe("Updated season plan content as a JSON string"),
      confirm: z.boolean().default(false).describe("Set to true to apply. Default false returns a preview."),
    },
    async (args) => {
      return run(async () => {
        const parsed = JSON.parse(args.plan);
        if (!args.confirm) {
          return { preview: true, message: "This is a preview. Call again with confirm=true to apply." };
        }
        logTool("seasonPlan.update", clerkUserId, `projectId=${args.projectId} planId=${args.planId}`);
        return await seasonPlanService.update(actor, args.projectId, args.planId, parsed);
      });
    },
  );

  server.tool(
    "seasonPlan.approve",
    "Approve the season plan. Once approved, it becomes the authoritative plan for episode development.",
    {
      projectId: z.string().describe("The project ID"),
      planId: z.string().describe("The plan ID to approve"),
    },
    async (args) => {
      return run(async () => {
        logTool("seasonPlan.approve", clerkUserId, `projectId=${args.projectId} planId=${args.planId}`);
        const result = await seasonPlanService.approve(actor, args.projectId, args.planId);
        logActivity("seasonPlan.approve", clerkUserId, args.projectId, `Approved season plan ${args.planId}`, "success");
        return result;
      });
    },
  );
}

function registerTimelineTools(server: McpServer, clerkUserId: string): void {
  server.tool(
    "timeline.get",
    "Get a timeline by its ID, including all tracks, clips, and validation status.",
    { timelineId: z.string().describe("The timeline ID") },
    async (args) => {
      return run(async () => {
        const timeline = await timelineRepository.findOwned(clerkUserId, args.timelineId);
        if (!timeline) throw new Error(`Timeline ${args.timelineId} not found`);
        return timeline;
      });
    },
  );

  server.tool(
    "timeline.findByEpisode",
    "Find the timeline associated with an episode, if one exists.",
    { episodeId: z.string().describe("The episode ID") },
    async (args) => {
      return run(async () => {
        return await timelineRepository.findByEpisode(clerkUserId, args.episodeId);
      });
    },
  );

  server.tool(
    "timeline.approve",
    "Approve a timeline. This is required before rendering can begin.",
    { timelineId: z.string().describe("The timeline ID to approve") },
    async (args) => {
      return run(async () => {
        logTool("timeline.approve", clerkUserId, `timelineId=${args.timelineId}`);
        const result = await timelineRepository.approve(clerkUserId, args.timelineId);
        if (!result) throw new Error(`Timeline ${args.timelineId} not found`);
        logActivity("timeline.approve", clerkUserId, null, `Approved timeline ${args.timelineId}`, "success");
        return result;
      });
    },
  );
}

function registerApprovalTools(server: McpServer, actor: RequestAuth, clerkUserId: string): void {
  server.tool(
    "bible.approve",
    "Approve the Story Bible for a project. Once approved, the bible becomes the authoritative reference for all subsequent production stages.",
    {
      projectId: z.string().describe("The project ID"),
      expectedVersion: z.number().int().min(0).describe("Expected current version (for optimistic concurrency)"),
      expectedDraftRevision: z.number().int().min(0).describe("Expected current draft revision"),
    },
    async (args) => {
      return run(async () => {
        logTool("bible.approve", clerkUserId, `projectId=${args.projectId}`);
        const result = await storyBibleService.approve(actor, args.projectId, args.expectedVersion, args.expectedDraftRevision);
        logActivity("bible.approve", clerkUserId, args.projectId, "Approved Story Bible", "success");
        return result;
      });
    },
  );

  server.tool(
    "story.approve",
    "Approve the story draft for a project. Once approved, the story advances to character extraction.",
    {
      projectId: z.string().describe("The project ID"),
      storyId: z.string().describe("The story ID to approve"),
    },
    async (args) => {
      return run(async () => {
        logTool("story.approve", clerkUserId, `projectId=${args.projectId} storyId=${args.storyId}`);
        const result = await storyDraftService.approve(actor, args.projectId, args.storyId);
        logActivity("story.approve", clerkUserId, args.projectId, `Approved story ${args.storyId}`, "success");
        return result;
      });
    },
  );
}

function registerContextTool(server: McpServer, actor: RequestAuth, clerkUserId: string): void {
  server.tool(
    "project.context",
    "Retrieve contextual information for a project or specific entity. This returns related data — for an episode, it includes the screenplay, scenes, characters, locations, and relevant canon. Use this to give an AI assistant the context it needs without retrieving the entire project.",
    {
      projectId: z.string().describe("The project ID"),
      focus: z.enum(["project", "episode", "scene", "character", "story", "bible", "canon", "pipeline"]).describe("What to focus the context on"),
      entityId: z.string().optional().describe("The specific entity ID (required for episode, scene, character focuses)"),
    },
    async (args) => {
      return run(async () => {
        const context: Record<string, unknown> = {};

        const project = await projectService.get(actor, args.projectId);
        context.project = {
          id: project.id,
          title: project.title,
          status: project.status,
          genre: project.genre,
          language: project.language,
          productionType: project.productionType,
          productionMode: project.productionMode,
          targetDurationSeconds: project.targetDurationSeconds,
          aspectRatio: project.aspectRatio,
        };

        if (args.focus === "pipeline" || args.focus === "project") {
          try {
            const workflow = await workflowService.get(actor, args.projectId);
            context.workflow = workflow;
          } catch { /* workflow may not exist yet */ }
        }

        if (args.focus === "bible" || args.focus === "project" || args.focus === "story" || args.focus === "canon") {
          try {
            const bible = await storyBibleRepository.findOwned(clerkUserId, args.projectId);
            if (bible) context.bible = bible;
          } catch { /* bible may not exist */ }
        }

        if (args.focus === "story" || args.focus === "project" || args.focus === "canon") {
          try {
            const story = await storyRepository.findProjectDraft(clerkUserId, args.projectId);
            if (story) context.story = story;
          } catch { /* story may not exist */ }
        }

        if (args.focus === "canon" || args.focus === "project" || args.focus === "character") {
          try {
            const canon = await narrativeCanonRepository.latest(clerkUserId, args.projectId);
            if (canon) context.canon = canon;
          } catch { /* canon may not exist */ }
        }

        if (args.focus === "character" || args.focus === "project" || args.focus === "canon") {
          try {
            const entities = await canonicalEntityRepository.listByProject(clerkUserId, args.projectId);
            context.entities = entities;
          } catch { /* entities may not exist */ }
        }

        if (args.focus === "episode" && args.entityId) {
          const episode = await episodeRepository.findOwned(clerkUserId, args.projectId, args.entityId);
          if (!episode) throw new Error(`Episode ${args.entityId} not found`);
          context.episode = episode;

          try {
            const timeline = await timelineRepository.findByEpisode(clerkUserId, args.entityId);
            if (timeline) context.timeline = timeline;
          } catch { /* timeline may not exist */ }

          try {
            const scenes = await productionSceneService.list(actor, args.projectId);
            context.scenes = scenes;
          } catch { /* scenes may not exist */ }
        }

        if (args.focus === "scene" && args.entityId) {
          const scene = await productionSceneRepository.findById(clerkUserId, args.entityId);
          if (!scene) throw new Error(`Scene ${args.entityId} not found`);
          context.scene = scene;
        }

        if (args.focus === "character" && args.entityId) {
          const entity = await canonicalEntityRepository.findOwned(clerkUserId, args.entityId);
          if (!entity) throw new Error(`Entity ${args.entityId} not found`);
          context.entity = entity;
        }

        return context;
      });
    },
  );
}

function registerActivityTools(server: McpServer, actor: RequestAuth, clerkUserId: string): void {
  server.tool(
    "activity.list",
    "List recent MCP activity for the current user — tool calls, approvals, and operations across all projects. Useful for tracking which assistant did what.",
    {
      projectId: z.string().optional().describe("Filter by project ID"),
      limit: z.number().int().min(1).max(200).default(50).describe("Maximum entries to return"),
      tool: z.string().optional().describe("Filter by tool name"),
    },
    async (args) => {
      return run(async () => {
        return getActivityLog(clerkUserId, {
          projectId: args.projectId,
          limit: args.limit,
          tool: args.tool,
        });
      });
    },
  );

  server.tool(
    "review.listPending",
    "List all pending items for a project — drafts awaiting approval, entities pending review, unapproved scenes, submitted planning docs, and episodes needing review. Use this to see what the creator needs to act on.",
    {
      projectId: z.string().describe("The project ID"),
    },
    async (args) => {
      logTool("review.listPending", clerkUserId, `projectId=${args.projectId}`);
      return run(async () => {
        const items: Array<{
          type: string;
          label: string;
          description: string;
          status: string;
        }> = [];

        const [workflow, planning, planResult, characters, environments, objects, sceneResult, storyDraft, bible] = await Promise.allSettled([
          workflowService.get(actor, args.projectId),
          planningService.get(actor, args.projectId),
          seasonPlanService.get(actor, args.projectId),
          canonicalEntityRepository.listByProject(clerkUserId, args.projectId, "character"),
          canonicalEntityRepository.listByProject(clerkUserId, args.projectId, "location"),
          canonicalEntityRepository.listByProject(clerkUserId, args.projectId, "object"),
          productionSceneService.list(actor, args.projectId),
          storyRepository.findProjectDraft(clerkUserId, args.projectId),
          storyBibleRepository.findOwned(clerkUserId, args.projectId),
        ]);

        if (workflow.status === "fulfilled") {
          const wf = workflow.value;
          if (wf.story.awaitingApproval) {
            items.push({ type: "story", label: "Story Draft", description: "Story draft is awaiting approval", status: "awaiting_approval" });
          }
          if (wf.bible.draftReady && !wf.bible.approved) {
            items.push({ type: "bible", label: "Story Bible", description: `Story Bible draft v${wf.bible.draftRevision} ready for approval`, status: "draft_ready" });
          }
          if (wf.plan.awaitingApproval) {
            items.push({ type: "plan", label: "Season Plan", description: "Season plan is awaiting approval", status: "awaiting_approval" });
          }
          if (wf.plan.needsReview) {
            items.push({ type: "plan", label: "Season Plan Review", description: "Story Bible changed since plan was approved", status: "needs_review" });
          }
          if (wf.episodes.needingReview > 0) {
            items.push({ type: "episode", label: `${wf.episodes.needingReview} Episodes Need Review`, description: "Written from older approved version", status: "needs_review" });
          }
        }

        if (planning.status === "fulfilled" && planning.value?.status === "submitted") {
          items.push({ type: "planning", label: "Planning Document", description: `v${planning.value.version} submitted for review`, status: "submitted" });
        }

        if (planResult.status === "fulfilled" && planResult.value?.plan?.status === "awaiting_approval") {
          if (!items.some((i) => i.type === "plan")) {
            items.push({ type: "plan", label: "Season Plan", description: `v${planResult.value.plan.version} awaiting approval`, status: "awaiting_approval" });
          }
        }

        const allEntities = [
          ...(characters.status === "fulfilled" ? characters.value : []),
          ...(environments.status === "fulfilled" ? environments.value : []),
          ...(objects.status === "fulfilled" ? objects.value : []),
        ];
        for (const entity of allEntities) {
          if (entity.status === "pending_review") {
            items.push({ type: "entity", label: entity.name, description: `${entity.entityType} pending review`, status: "pending_review" });
          }
        }

        if (sceneResult.status === "fulfilled") {
          for (const scene of sceneResult.value.scenes) {
            if (!scene.approvedAt) {
              items.push({ type: "scene", label: `Scene ${scene.sceneNumber}: ${scene.title}`, description: "Not yet approved", status: "draft" });
            }
          }
        }

        if (storyDraft.status === "fulfilled" && storyDraft.value?.status === "awaiting_approval") {
          if (!items.some((i) => i.type === "story")) {
            items.push({ type: "story", label: "Story Draft", description: "Story draft is awaiting approval", status: "awaiting_approval" });
          }
        }

        if (bible.status === "fulfilled" && bible.value && !bible.value.approvedVersion && bible.value.draftRevision > 0) {
          if (!items.some((i) => i.type === "bible")) {
            items.push({ type: "bible", label: "Story Bible", description: `draft v${bible.value.draftRevision} ready for approval`, status: "draft_ready" });
          }
        }

        return { items, total: items.length };
      });
    },
  );
}

function registerPlanningTools(server: McpServer, actor: RequestAuth, clerkUserId: string): void {
  server.tool(
    "planning.get",
    "Get the creative planning document for a project — concept, themes, audience, narrative direction.",
    { projectId: z.string().describe("The project ID") },
    async (args) => {
      logTool("planning.get", clerkUserId, `projectId=${args.projectId}`);
      return run(async () => {
        return await planningService.get(actor, args.projectId);
      });
    },
  );

  server.tool(
    "planning.update",
    "Create or update the creative planning document. Submits for creator approval.",
    {
      projectId: z.string().describe("The project ID"),
      logline: z.string().max(500).optional().describe("One-sentence logline"),
      synopsis: z.string().max(10000).optional().describe("Story synopsis"),
      themes: z.array(z.string()).max(20).optional().describe("Story themes"),
      centralQuestion: z.string().max(1000).optional().describe("Central dramatic question"),
      mainConflict: z.string().max(2000).optional().describe("Main conflict description"),
    },
    async (args) => {
      logTool("planning.update", clerkUserId, `projectId=${args.projectId}`);
      return run(async () => {
        const existing = await planningService.get(actor, args.projectId);
        const data = {
          concept: { logline: args.logline ?? existing?.concept.logline ?? "", synopsis: args.synopsis ?? existing?.concept.synopsis ?? "", elevatorPitch: existing?.concept.elevatorPitch ?? "" },
          themes: args.themes ?? existing?.themes ?? [],
          centralQuestion: args.centralQuestion ?? existing?.centralQuestion ?? "",
          mainConflict: args.mainConflict ?? existing?.mainConflict ?? "",
          audience: existing?.audience ?? { demographic: "", tone: "", contentRating: "" },
          narrativeDirection: existing?.narrativeDirection ?? { structure: "", pov: "", pacing: "" },
          alternativeDirections: existing?.alternativeDirections ?? [],
          references: existing?.references ?? [],
        };
        return await planningService.createOrUpdate(actor, args.projectId, data);
      });
    },
  );

  server.tool(
    "planning.submit",
    "Submit the creative planning document for creator review. Transitions status from draft/rejected to submitted.",
    {
      projectId: z.string().describe("The project ID"),
    },
    async (args) => {
      logTool("planning.submit", clerkUserId, `projectId=${args.projectId}`);
      return run(async () => {
        const result = await planningService.submit(actor, args.projectId);
        logActivity("planning.submit", clerkUserId, args.projectId, "Submitted planning document for review", "success");
        return result;
      });
    },
  );

  server.tool(
    "planning.approve",
    "Approve or reject the creative planning document. Only the creator can approve.",
    {
      projectId: z.string().describe("The project ID"),
      expectedVersion: z.number().int().min(1).describe("Current version for optimistic locking"),
      rejectionReason: z.string().max(2000).optional().describe("Reason for rejection (if rejecting)"),
    },
    async (args) => {
      logTool("planning.approve", clerkUserId, `projectId=${args.projectId}`);
      return run(async () => {
        if (args.rejectionReason) {
          return await planningService.reject(actor, args.projectId, args.expectedVersion, args.rejectionReason);
        }
        return await planningService.approve(actor, args.projectId, args.expectedVersion);
      });
    },
  );
}

function registerProductionDesignTools(server: McpServer, actor: RequestAuth, clerkUserId: string): void {
  server.tool(
    "productionDesign.get",
    "Get the production design for a scene — shot list, camera directions, lighting, staging.",
    {
      projectId: z.string().describe("The project ID"),
      sceneId: z.string().describe("The scene ID"),
    },
    async (args) => {
      logTool("productionDesign.get", clerkUserId, `sceneId=${args.sceneId}`);
      return run(async () => {
        return await productionDesignService.getByScene(actor, args.projectId, args.sceneId);
      });
    },
  );

  server.tool(
    "productionDesign.update",
    "Create or update the production design for a scene. Includes shot list, location design, and character staging.",
    {
      projectId: z.string().describe("The project ID"),
      sceneId: z.string().describe("The scene ID"),
      shotList: z.array(z.object({
        shotNumber: z.number().int().min(1),
        type: z.string().max(50).default("medium"),
        cameraDirection: z.string().max(500).default(""),
        cameraMovement: z.string().max(200).default(""),
        lens: z.string().max(100).default(""),
        framing: z.string().max(200).default(""),
        duration: z.number().min(0).default(0),
        lightingSetup: z.string().max(500).default(""),
        lightingNotes: z.string().max(2000).default(""),
        storyboardDescription: z.string().max(5000).default(""),
        visualContinuityNotes: z.string().max(2000).default(""),
      })).max(50).default([]).describe("Shot list for the scene"),
      locationDressing: z.string().max(2000).optional().describe("Location dressing description"),
      locationProps: z.string().max(2000).optional().describe("Location props description"),
      locationAtmosphere: z.string().max(2000).optional().describe("Location atmosphere description"),
    },
    async (args) => {
      logTool("productionDesign.update", clerkUserId, `sceneId=${args.sceneId}`);
      return run(async () => {
        return await productionDesignService.createOrUpdate(actor, args.projectId, args.sceneId, {
          shotList: args.shotList,
          locationDesign: {
            dressing: args.locationDressing ?? "",
            props: args.locationProps ?? "",
            atmosphere: args.locationAtmosphere ?? "",
          },
          characterStaging: [],
        });
      });
    },
  );

  server.tool(
    "productionDesign.generateShotList",
    "Returns the scene data needed to author a shot list. This is a hint tool — it does not generate content. Use productionDesign.update to save the actual shot list.",
    {
      projectId: z.string().describe("The project ID"),
      sceneId: z.string().describe("The scene ID"),
    },
    async (args) => {
      logTool("productionDesign.generateShotList", clerkUserId, `sceneId=${args.sceneId}`);
      return run(async () => {
        const scene = await productionSceneRepository.findById(clerkUserId, args.sceneId);
        if (!scene) return { error: "Scene not found" };
        return { message: "Use this scene data to author a shot list, then save it via productionDesign.update.", scene };
      });
    },
  );
}

function registerVoiceTools(server: McpServer, actor: RequestAuth, clerkUserId: string): void {
  server.tool(
    "voice.assign",
    "Assign a voice profile to a character entity.",
    {
      projectId: z.string().describe("The project ID"),
      characterId: z.string().describe("The canonical entity ID for the character"),
      voiceProfileId: z.string().describe("The voice profile ID to assign"),
    },
    async (args) => {
      logTool("voice.assign", clerkUserId, `characterId=${args.characterId}`);
      return run(async () => {
        await canonicalEntityRepository.updateVisualProfile(clerkUserId, args.characterId, { voiceProfileId: args.voiceProfileId });
        logActivity("voice.assign", clerkUserId, args.projectId, `Assigned voice ${args.voiceProfileId} to character ${args.characterId}`, "success");
        return { success: true, characterId: args.characterId, voiceProfileId: args.voiceProfileId };
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

  server.registerResource(
    "project-characters",
    "project://{projectId}/characters",
    {
      description: "All canonical entities (characters, locations, objects) for a project with their profiles and approval status.",
      mimeType: "application/json",
    },
    async (uri) => {
      const projectId = uri.pathname.split("/")[2] ?? "";
      const entities = await canonicalEntityRepository.listByProject(clerkUserId, projectId);
      return {
        contents: [{
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(entities, null, 2),
        }],
      };
    },
  );

  server.registerResource(
    "project-scenes",
    "project://{projectId}/scenes",
    {
      description: "All production scenes for a project — scene numbers, descriptions, shot plans, and production status.",
      mimeType: "application/json",
    },
    async (uri) => {
      const projectId = uri.pathname.split("/")[2] ?? "";
      const run = await productionRunRepository.findLatest(clerkUserId, projectId);
      const scenes = run ? await productionSceneRepository.listForRun(clerkUserId, run.id) : [];
      return {
        contents: [{
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(scenes, null, 2),
        }],
      };
    },
  );

  server.registerResource(
    "project-season-plan",
    "project://{projectId}/season-plan",
    {
      description: "The current season plan for a project — episode outlines, arcs, and validation status.",
      mimeType: "application/json",
    },
    async (uri) => {
      const projectId = uri.pathname.split("/")[2] ?? "";
      const plan = await seasonPlanRepository.findLatest(clerkUserId, projectId);
      return {
        contents: [{
          uri: uri.toString(),
          mimeType: "application/json",
          text: plan ? JSON.stringify(plan, null, 2) : JSON.stringify({ error: "No season plan found" }),
        }],
      };
    },
  );
}