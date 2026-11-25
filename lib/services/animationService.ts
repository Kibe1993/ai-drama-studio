import "server-only";
import { StudioError } from "@/lib/http/errors";
import { toolConfigRepository } from "@/lib/repositories/toolConfigRepository";
import { getToolProvider, buildConnectionConfig } from "@/lib/providers/external/registry";
import type { ToolConfigRecord, ToolType } from "@/lib/validation/toolConfig";
import type { ExternalToolProvider } from "@/lib/providers/external/types";

const ANIMATION_2D_TOOLS: ToolType[] = ["synfig", "opentoonz", "pencil2d", "blender"];

async function getToolConfig(userId: string, toolType: ToolType): Promise<ToolConfigRecord> {
  const config = await toolConfigRepository.findByToolType(userId, toolType);
  if (!config) throw new StudioError(`${toolType} not configured`, 404, "tool_not_configured");
  if (!config.enabled) throw new StudioError(`${toolType} is not enabled`, 403, "tool_disabled");
  return config;
}

async function getProvider(userId: string, toolType: ToolType): Promise<{ provider: ExternalToolProvider; config: ToolConfigRecord }> {
  const config = await getToolConfig(userId, toolType);
  const provider = getToolProvider(toolType);
  if (!provider) throw new StudioError(`${toolType} provider not registered`, 503, "provider_not_registered");
  return { provider, config };
}

export type AnimationExportResult = {
  toolType: ToolType;
  filePath: string;
  message: string;
};

export type AnimationImportResult = {
  toolType: ToolType;
  filePath: string;
  format: string;
  files: string[];
  count: number;
};

export const animationService = {
  async listTools(userId: string): Promise<ToolConfigRecord[]> {
    const tools = await toolConfigRepository.list(userId);
    return tools.filter((t) => ANIMATION_2D_TOOLS.includes(t.toolType));
  },

  async exportToTool(
    userId: string,
    toolType: ToolType,
    input: { projectId: string; assetIds: string[]; format: string; outputPath: string }
  ): Promise<AnimationExportResult> {
    const { provider, config } = await getProvider(userId, toolType);
    const connectionConfig = buildConnectionConfig(config);
    if (!provider.exportProject) throw new StudioError(`${toolType} does not support export`, 501, "not_supported");
    const result = await provider.exportProject(connectionConfig, input);
    return {
      toolType,
      filePath: result.filePath,
      message: `Exported ${input.assetIds.length} asset(s) for ${toolType}. Open the manifest in ${config.displayName} to begin animation.`,
    };
  },

  async importFromTool(
    userId: string,
    toolType: ToolType,
    filePath: string
  ): Promise<AnimationImportResult> {
    const { provider, config } = await getProvider(userId, toolType);
    const connectionConfig = buildConnectionConfig(config);
    if (!provider.importResult) throw new StudioError(`${toolType} does not support import`, 501, "not_supported");
    const result = await provider.importResult(connectionConfig, filePath);
    const files = (result.metadata?.files as string[] | undefined) ?? [];
    return {
      toolType,
      filePath: result.filePath,
      format: result.format,
      files,
      count: (result.metadata?.count as number | undefined) ?? files.length,
    };
  },

  async render(userId: string, toolType: ToolType, input: { projectFile: string; outputPath?: string }): Promise<{ operationId: string; status: string }> {
    const { provider, config } = await getProvider(userId, toolType);
    const connectionConfig = buildConnectionConfig(config);
    const handle = await provider.execute(connectionConfig, {
      inputs: { projectFile: input.projectFile },
      outputPath: input.outputPath,
    });
    return { operationId: handle.operationId, status: handle.status };
  },

  async pollRender(userId: string, toolType: ToolType, operationId: string): Promise<{ status: string; outputPaths?: string[]; error?: { code: string; message: string } }> {
    const { provider, config } = await getProvider(userId, toolType);
    const connectionConfig = buildConnectionConfig(config);
    const result = await provider.poll(connectionConfig, {
      toolType,
      operationId,
      status: "submitted",
    });
    if (result.status === "completed") {
      return { status: "completed", outputPaths: result.outputPaths };
    }
    if (result.status === "failed") {
      return { status: "failed", error: { code: result.code, message: result.message } };
    }
    return { status: "processing" };
  },
};