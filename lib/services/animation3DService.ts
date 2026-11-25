import "server-only";
import { StudioError } from "@/lib/http/errors";
import { toolConfigRepository } from "@/lib/repositories/toolConfigRepository";
import { getToolProvider, buildConnectionConfig } from "@/lib/providers/external/registry";
import type { ToolConfigRecord, ToolType } from "@/lib/validation/toolConfig";
import type { ExternalToolProvider } from "@/lib/providers/external/types";
import type { MakeHumanParams, MixamoAnimation } from "@/lib/providers/external/animation3d";

const TOOL_3D_TYPES: ToolType[] = ["blender", "makehuman", "mixamo"];

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

const MIXAMO_ANIMATION_CATALOG: MixamoAnimation[] = [
  { id: "idle", name: "Idle", category: "Idle", description: "Standing idle pose" },
  { id: "walk", name: "Walk", category: "Locomotion", description: "Standard walk cycle" },
  { id: "run", name: "Run", category: "Locomotion", description: "Running cycle" },
  { id: "jump", name: "Jump", category: "Action", description: "Jump animation" },
  { id: "wave", name: "Wave", category: "Gesture", description: "Hand wave greeting" },
  { id: "talk", name: "Talk", category: "Gesture", description: "Talking gesture" },
  { id: "sit", name: "Sit", category: "Pose", description: "Sitting pose" },
  { id: "laugh", name: "Laugh", category: "Gesture", description: "Laughing animation" },
  { id: "clap", name: "Clap", category: "Gesture", description: "Clapping animation" },
  { id: "dance", name: "Dance", category: "Action", description: "Dancing animation" },
  { id: "punch", name: "Punch", category: "Combat", description: "Punch attack" },
  { id: "kick", name: "Kick", category: "Combat", description: "Kick attack" },
  { id: "fall", name: "Fall", category: "Action", description: "Falling animation" },
  { id: "turn", name: "Turn", category: "Locomotion", description: "Turn around" },
  { id: "crouch", name: "Crouch", category: "Pose", description: "Crouching pose" },
];

export const animation3DService = {
  async listTools(userId: string): Promise<ToolConfigRecord[]> {
    const tools = await toolConfigRepository.list(userId);
    return tools.filter((t) => TOOL_3D_TYPES.includes(t.toolType));
  },

  async listMixamoAnimations(): Promise<MixamoAnimation[]> {
    return MIXAMO_ANIMATION_CATALOG;
  },

  async generateCharacterModel(
    userId: string,
    params: MakeHumanParams & { outputPath: string }
  ): Promise<{ operationId: string; status: string }> {
    const { provider, config } = await getProvider(userId, "makehuman");
    const connectionConfig = buildConnectionConfig(config);
    const handle = await provider.execute(connectionConfig, {
      inputs: { ...params, projectFile: "makehuman_default" },
      outputPath: params.outputPath,
    });
    return { operationId: handle.operationId, status: handle.status };
  },

  async importRig(
    userId: string,
    filePath: string
  ): Promise<{ filePath: string; format: string; files: string[]; count: number }> {
    const { provider, config } = await getProvider(userId, "mixamo");
    const connectionConfig = buildConnectionConfig(config);
    if (!provider.importResult) throw new StudioError("Mixamo does not support import", 501, "not_supported");
    const result = await provider.importResult(connectionConfig, filePath);
    const files = (result.metadata?.files as string[] | undefined) ?? [];
    return {
      filePath: result.filePath,
      format: result.format,
      files,
      count: (result.metadata?.count as number | undefined) ?? files.length,
    };
  },

  async renderAnimation(
    userId: string,
    input: { projectFile: string; outputPath?: string }
  ): Promise<{ operationId: string; status: string }> {
    const { provider, config } = await getProvider(userId, "blender");
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
    const result = await provider.poll(connectionConfig, { toolType, operationId, status: "submitted" });
    if (result.status === "completed") return { status: "completed", outputPaths: result.outputPaths };
    if (result.status === "failed") return { status: "failed", error: { code: result.code, message: result.message } };
    return { status: "processing" };
  },
};