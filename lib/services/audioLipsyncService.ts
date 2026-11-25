import "server-only";
import { StudioError } from "@/lib/http/errors";
import { toolConfigRepository } from "@/lib/repositories/toolConfigRepository";
import { getToolProvider, buildConnectionConfig } from "@/lib/providers/external/registry";
import type { ToolConfigRecord, ToolType } from "@/lib/validation/toolConfig";
import type { ExternalToolProvider } from "@/lib/providers/external/types";
import type { LipSyncParams, AudioEditParams } from "@/lib/providers/external/audioLipsync";

const AUDIO_TOOLS: ToolType[] = ["audacity", "wav2lip", "sadtalker", "kokoro"];

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

export const audioLipsyncService = {
  async listTools(userId: string): Promise<ToolConfigRecord[]> {
    const tools = await toolConfigRepository.list(userId);
    return tools.filter((t) => AUDIO_TOOLS.includes(t.toolType));
  },

  async generateLipSync(userId: string, params: LipSyncParams): Promise<{ operationId: string; status: string }> {
    const { provider, config } = await getProvider(userId, params.tool);
    const connectionConfig = buildConnectionConfig(config);
    const handle = await provider.execute(connectionConfig, {
      inputs: { projectFile: params.faceImage, audioFile: params.audioFile },
      outputPath: params.outputPath,
    });
    return { operationId: handle.operationId, status: handle.status };
  },

  async editAudio(userId: string, params: AudioEditParams): Promise<{ operationId: string; status: string }> {
    const { provider, config } = await getProvider(userId, "audacity");
    const connectionConfig = buildConnectionConfig(config);
    const handle = await provider.execute(connectionConfig, {
      inputs: { projectFile: params.inputFile, operations: params.operations },
      outputPath: params.outputFile,
    });
    return { operationId: handle.operationId, status: handle.status };
  },

  async pollRender(userId: string, toolType: ToolType, operationId: string): Promise<{ status: string; outputPaths?: string[]; error?: { code: string; message: string } }> {
    const { provider, config } = await getProvider(userId, toolType);
    const connectionConfig = buildConnectionConfig(config);
    const result = await provider.poll(connectionConfig, { toolType, operationId, status: "submitted" });
    if (result.status === "completed") return { status: "completed", outputPaths: result.outputPaths };
    if (result.status === "failed") return { status: "failed", error: { code: result.code, message: result.message } };
    return { status: "processing" };
  },
};