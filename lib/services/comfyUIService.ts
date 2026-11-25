import "server-only";
import { StudioError } from "@/lib/http/errors";
import { toolConfigRepository } from "@/lib/repositories/toolConfigRepository";
import { getToolProvider, buildConnectionConfig } from "@/lib/providers/external/registry";
import { ComfyUIProvider } from "@/lib/providers/external/comfyui";
import type { ToolConfigRecord } from "@/lib/validation/toolConfig";

export type ComfyUIWorkflow = {
  id: string;
  name: string;
  description?: string;
  category: "character_reference" | "scene_image" | "environment_reference" | "object_reference" | "shot_image";
  graph: Record<string, unknown>;
  inputs?: Record<string, { type: string; required: boolean; default?: unknown }>;
};

export type ComfyUIModelInfo = {
  checkpoints: string[];
  loras: string[];
};

export type ComfyUIExecutionResult = {
  promptId: string;
  status: "processing" | "completed" | "failed";
  imageUrls?: string[];
  error?: { code: string; message: string };
};

function assertComfyUIProvider(provider: unknown): ComfyUIProvider {
  if (!(provider instanceof ComfyUIProvider)) {
    throw new StudioError("ComfyUI provider not available", 503, "provider_unavailable");
  }
  return provider;
}

async function getComfyUIConfig(userId: string): Promise<ToolConfigRecord> {
  const config = await toolConfigRepository.findByToolType(userId, "comfyui");
  if (!config) throw new StudioError("ComfyUI not configured", 404, "tool_not_configured");
  if (!config.enabled) throw new StudioError("ComfyUI is not enabled", 403, "tool_disabled");
  return config;
}

async function getProvider(userId: string): Promise<{ provider: ComfyUIProvider; config: ToolConfigRecord }> {
  const config = await getComfyUIConfig(userId);
  const provider = getToolProvider("comfyui");
  if (!provider) throw new StudioError("ComfyUI provider not registered", 503, "provider_not_registered");
  return { provider: assertComfyUIProvider(provider), config };
}

export const comfyUIService = {
  async getWorkflows(userId: string): Promise<ComfyUIWorkflow[]> {
    const { provider, config } = await getProvider(userId);
    const connectionConfig = buildConnectionConfig(config);
    const workflows = config.config?.workflows;
    if (Array.isArray(workflows)) return workflows as ComfyUIWorkflow[];
    return [];
  },

  async saveWorkflow(userId: string, workflow: ComfyUIWorkflow): Promise<ToolConfigRecord> {
    const config = await getComfyUIConfig(userId);
    const existing = (config.config?.workflows as ComfyUIWorkflow[] | undefined) ?? [];
    const filtered = existing.filter((w) => w.id !== workflow.id);
    const newWorkflows = [...filtered, workflow];
    const updated = await toolConfigRepository.update(userId, config.id, {
      config: { ...config.config, workflows: newWorkflows },
    });
    if (!updated) throw new StudioError("Failed to save workflow", 500, "update_failed");
    return updated;
  },

  async removeWorkflow(userId: string, workflowId: string): Promise<ToolConfigRecord> {
    const config = await getComfyUIConfig(userId);
    const existing = (config.config?.workflows as ComfyUIWorkflow[] | undefined) ?? [];
    const filtered = existing.filter((w) => w.id !== workflowId);
    const result = await toolConfigRepository.update(userId, config.id, {
      config: { ...config.config, workflows: filtered },
    });
    if (!result) throw new StudioError("Failed to remove workflow", 500, "update_failed");
    return result;
  },

  async listModels(userId: string): Promise<ComfyUIModelInfo> {
    const { provider, config } = await getProvider(userId);
    const connectionConfig = buildConnectionConfig(config);
    return provider.listModels(connectionConfig);
  },

  async execute(userId: string, workflowId: string, inputs: Record<string, unknown>): Promise<ComfyUIExecutionResult> {
    const { provider, config } = await getProvider(userId);
    const connectionConfig = buildConnectionConfig(config);
    const workflows = (config.config?.workflows as ComfyUIWorkflow[] | undefined) ?? [];
    const workflow = workflows.find((w) => w.id === workflowId);
    if (!workflow) throw new StudioError("Workflow not found", 404, "workflow_not_found");

    const mergedGraph = { ...workflow.graph };
    for (const [key, value] of Object.entries(inputs)) {
      if (workflow.inputs?.[key]) {
        mergedGraph[key] = value;
      }
    }

    const handle = await provider.execute(connectionConfig, {
      workflowId,
      inputs: { workflow: mergedGraph },
    });

    return {
      promptId: handle.operationId,
      status: "processing",
    };
  },

  async poll(userId: string, promptId: string): Promise<ComfyUIExecutionResult> {
    const { provider, config } = await getProvider(userId);
    const connectionConfig = buildConnectionConfig(config);
    const result = await provider.poll(connectionConfig, {
      toolType: "comfyui",
      operationId: promptId,
      status: "submitted",
    });

    if (result.status === "completed") {
      return {
        promptId,
        status: "completed",
        imageUrls: result.outputPaths,
      };
    }
    if (result.status === "failed") {
      return {
        promptId,
        status: "failed",
        error: { code: result.code, message: result.message },
      };
    }
    return { promptId, status: "processing" };
  },

  async fetchImage(userId: string, imageUrl: string): Promise<Uint8Array> {
    const { provider, config } = await getProvider(userId);
    const connectionConfig = buildConnectionConfig(config);
    return provider.fetchImage(connectionConfig, imageUrl);
  },

  async cancel(userId: string, promptId: string): Promise<void> {
    const { provider, config } = await getProvider(userId);
    const connectionConfig = buildConnectionConfig(config);
    await provider.cancel(connectionConfig, {
      toolType: "comfyui",
      operationId: promptId,
      status: "submitted",
    });
  },
};