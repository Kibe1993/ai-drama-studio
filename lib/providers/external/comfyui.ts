import "server-only";
import type { ExternalToolProvider, ToolConnectionConfig, WorkflowInfo, ExecuteParams, JobHandle, PollResult, ToolCapability } from "./types";
import type { ToolType, HealthCheckResult } from "@/lib/validation/toolConfig";

const COMFYUI_CAPABILITIES: ToolCapability = {
  hasApi: true,
  supportsHeadless: true,
  supportsWorkflow: true,
  supportsFileImport: false,
  supportsFileExport: false,
  supportedFileFormats: ["image/png", "image/jpeg", "image/webp"],
};

type ComfyUIPromptResponse = {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, unknown>;
};

type ComfyUIHistoryEntry = {
  status: {
    completed: boolean;
    status_str: string;
    messages: Array<[string, unknown]>;
  };
  outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
};

export class ComfyUIProvider implements ExternalToolProvider {
  readonly id = "comfyui";
  readonly toolType: ToolType = "comfyui";
  readonly capabilities = COMFYUI_CAPABILITIES;

  private baseUrl(config: ToolConnectionConfig): string {
    const endpoint = config.endpoint?.replace(/\/$/, "");
    if (!endpoint) throw new Error("ComfyUI endpoint not configured");
    return endpoint;
  }

  async healthCheck(config: ToolConnectionConfig): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const base = this.baseUrl(config);
      const response = await fetch(`${base}/system_stats`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        return {
          status: "unhealthy",
          message: `ComfyUI returned HTTP ${response.status}`,
          checkedAt: new Date().toISOString(),
          responseTimeMs: Date.now() - start,
        };
      }
      const data = await response.json() as { system: { comfyui_version: string }; devices: Array<{ name: string; type: string }> };
      const gpu = data.devices?.find((d) => d.type === "cuda") ?? data.devices?.[0];
      return {
        status: "healthy",
        message: `ComfyUI ${data.system?.comfyui_version ?? "unknown"} — ${gpu?.name ?? "no GPU detected"}`,
        details: { version: data.system?.comfyui_version, devices: data.devices },
        checkedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - start,
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : "Connection failed",
        checkedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - start,
      };
    }
  }

  async listWorkflows(config: ToolConnectionConfig): Promise<WorkflowInfo[]> {
    const stored = config.config?.workflows;
    if (!Array.isArray(stored)) return [];
    return stored as WorkflowInfo[];
  }

  async listModels(config: ToolConnectionConfig): Promise<{ checkpoints: string[]; loras: string[] }> {
    const base = this.baseUrl(config);
    const response = await fetch(`${base}/object_info/CheckpointLoaderSimple`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { checkpoints: [], loras: [] };
    const data = await response.json() as {
      CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[], unknown] } } };
    };
    const checkpoints = data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];

    const loraResponse = await fetch(`${base}/object_info/LoraLoader`, {
      signal: AbortSignal.timeout(10000),
    });
    let loras: string[] = [];
    if (loraResponse.ok) {
      const loraData = await loraResponse.json() as {
        LoraLoader?: { input?: { required?: { lora_name?: [string[], unknown] } } };
      };
      loras = loraData.LoraLoader?.input?.required?.lora_name?.[0] ?? [];
    }
    return { checkpoints, loras };
  }

  async execute(config: ToolConnectionConfig, params: ExecuteParams): Promise<JobHandle> {
    const base = this.baseUrl(config);
    const workflow = params.inputs.workflow ?? params.inputs;
    const response = await fetch(`${base}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: "ai-drama-studio" }),
      signal: AbortSignal.timeout(params.timeoutMs ?? 30000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`ComfyUI prompt submission failed: HTTP ${response.status} ${text}`);
    }
    const data = await response.json() as ComfyUIPromptResponse;
    return {
      toolType: "comfyui",
      operationId: data.prompt_id,
      status: "submitted",
    };
  }

  async poll(config: ToolConnectionConfig, handle: JobHandle): Promise<PollResult> {
    const base = this.baseUrl(config);
    const response = await fetch(`${base}/history/${handle.operationId}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return { status: "processing" };
    }
    const data = await response.json() as Record<string, ComfyUIHistoryEntry>;
    const entry = data[handle.operationId];
    if (!entry) return { status: "processing" };

    if (entry.status?.status_str === "error" || entry.status?.status_str === "failed") {
      const errorMsg = entry.status.messages
        ?.find((m) => m[0] === "execution_error")
        ?.[1] as { exception_message?: string } | undefined;
      return {
        status: "failed",
        code: "comfyui_execution_error",
        message: errorMsg?.exception_message ?? "ComfyUI workflow execution failed",
      };
    }

    if (entry.status?.completed && entry.outputs) {
      const outputPaths: string[] = [];
      for (const nodeId of Object.keys(entry.outputs)) {
        const output = entry.outputs[nodeId];
        if (output.images) {
          for (const img of output.images) {
            const url = `${base}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(img.type)}`;
            outputPaths.push(url);
          }
        }
      }
      if (outputPaths.length === 0) {
        return { status: "failed", code: "no_output", message: "ComfyUI completed but produced no images" };
      }
      return { status: "completed", outputPaths, metadata: { promptId: handle.operationId } };
    }
    return { status: "processing" };
  }

  async cancel(config: ToolConnectionConfig, handle: JobHandle): Promise<void> {
    const base = this.baseUrl(config);
    await fetch(`${base}/queue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delete: [handle.operationId] }),
      signal: AbortSignal.timeout(10000),
    });
  }

  async fetchImage(config: ToolConnectionConfig, imageUrl: string): Promise<Uint8Array> {
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Failed to fetch image: HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }
}