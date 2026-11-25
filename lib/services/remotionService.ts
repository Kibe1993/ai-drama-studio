import "server-only";
import { StudioError } from "@/lib/http/errors";
import { toolConfigRepository } from "@/lib/repositories/toolConfigRepository";
import { getToolProvider, buildConnectionConfig } from "@/lib/providers/external/registry";
import type { ToolConfigRecord } from "@/lib/validation/toolConfig";
import type { RemotionComposition, RemotionRenderParams } from "@/lib/providers/external/remotion";
import { remotionProvider } from "@/lib/providers/external/remotion";

async function getConfig(userId: string): Promise<ToolConfigRecord> {
  const config = await toolConfigRepository.findByToolType(userId, "remotion");
  if (!config) throw new StudioError("Remotion not configured", 404, "tool_not_configured");
  if (!config.enabled) throw new StudioError("Remotion is not enabled", 403, "tool_disabled");
  return config;
}

export const remotionService = {
  async getStatus(userId: string): Promise<ToolConfigRecord> {
    return getConfig(userId);
  },

  async listCompositions(userId: string, entryPoint: string): Promise<RemotionComposition[]> {
    const config = await getConfig(userId);
    const connectionConfig = buildConnectionConfig(config);
    try {
      return await remotionProvider.listCompositions(connectionConfig, entryPoint);
    } catch (cause) {
      throw new StudioError(
        cause instanceof Error ? cause.message : "Failed to list compositions",
        500,
        "remotion_list_failed",
      );
    }
  },

  async render(userId: string, params: RemotionRenderParams): Promise<{ operationId: string; status: string }> {
    const config = await getConfig(userId);
    const connectionConfig = buildConnectionConfig(config);
    const provider = getToolProvider("remotion");
    if (!provider) throw new StudioError("Remotion provider not registered", 503, "provider_not_registered");
    try {
      const handle = await provider.execute(connectionConfig, {
        inputs: params,
        outputPath: params.outputPath,
      });
      return { operationId: handle.operationId, status: handle.status };
    } catch (cause) {
      throw new StudioError(
        cause instanceof Error ? cause.message : "Render failed",
        500,
        "remotion_render_failed",
      );
    }
  },

  async pollRender(userId: string, operationId: string): Promise<{ status: string; outputPaths?: string[] }> {
    const config = await getConfig(userId);
    const connectionConfig = buildConnectionConfig(config);
    const result = await remotionProvider.poll(connectionConfig, {
      toolType: "remotion",
      operationId,
      status: "submitted",
    });
    if (result.status === "completed") return { status: "completed", outputPaths: result.outputPaths };
    if (result.status === "failed") return { status: "failed" };
    return { status: "processing" };
  },
};