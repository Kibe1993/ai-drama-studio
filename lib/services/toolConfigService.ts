import "server-only";
import { StudioError } from "@/lib/http/errors";
import { toolConfigRepository } from "@/lib/repositories/toolConfigRepository";
import { getToolProvider, buildConnectionConfig } from "@/lib/providers/external/registry";
import {
  type ToolConfigRecord,
  type ToolStatus,
  type HealthCheckResult,
  type ToolType,
  canTransitionTo,
  TOOL_DISPLAY_NAMES,
  TOOL_CATEGORY_MAP,
} from "@/lib/validation/toolConfig";

function determineStatus(result: HealthCheckResult, currentStatus: ToolStatus, enabled: boolean): ToolStatus {
  if (!enabled) return "unavailable";
  if (result.status === "healthy") return "available";
  if (result.status === "degraded") return "connected";
  if (result.status === "unhealthy") return "failed";
  return currentStatus;
}

export const toolHealthCheckService = {
  async checkTool(userId: string, toolId: string): Promise<{ config: ToolConfigRecord; result: HealthCheckResult }> {
    const config = await toolConfigRepository.findById(userId, toolId);
    if (!config) throw new StudioError("Tool configuration not found", 404, "not_found");

    const provider = getToolProvider(config.toolType);
    if (!provider) {
      const result: HealthCheckResult = {
        status: "unknown",
        message: `No provider registered for ${config.displayName}. Integration not yet implemented.`,
        checkedAt: new Date().toISOString(),
      };
      const updated = await toolConfigRepository.updateHealthCheck(userId, toolId, result, "unavailable");
      return { config: updated ?? config, result };
    }

    const connectionConfig = buildConnectionConfig(config);
    const start = Date.now();
    let result: HealthCheckResult;
    try {
      result = await provider.healthCheck(connectionConfig);
      if (!result.responseTimeMs) {
        result = { ...result, responseTimeMs: Date.now() - start };
      }
    } catch (error) {
      result = {
        status: "unhealthy",
        message: error instanceof Error ? error.message : "Health check failed",
        checkedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - start,
      };
    }

    const newStatus = determineStatus(result, config.status, config.enabled);
    const safeStatus = canTransitionTo(config.status, newStatus) ? newStatus : config.status;
    const updated = await toolConfigRepository.updateHealthCheck(userId, toolId, result, safeStatus);
    return { config: updated ?? config, result };
  },

  async checkAllTools(userId: string): Promise<{ config: ToolConfigRecord; result: HealthCheckResult }[]> {
    const tools = await toolConfigRepository.listEnabled(userId);
    const results: { config: ToolConfigRecord; result: HealthCheckResult }[] = [];
    for (const tool of tools) {
      try {
        const check = await this.checkTool(userId, tool.id);
        results.push(check);
      } catch {
        results.push({
          config: tool,
          result: {
            status: "unhealthy",
            message: "Health check error",
            checkedAt: new Date().toISOString(),
          },
        });
      }
    }
    return results;
  },

  async checkByToolType(userId: string, toolType: ToolType): Promise<{ config: ToolConfigRecord; result: HealthCheckResult } | null> {
    const config = await toolConfigRepository.findByToolType(userId, toolType);
    if (!config) return null;
    return this.checkTool(userId, config.id);
  },
};

export const toolConfigService = {
  async list(userId: string): Promise<ToolConfigRecord[]> {
    await toolConfigRepository.ensureDefaults(userId);
    return toolConfigRepository.list(userId);
  },

  async listByCategory(userId: string, category: string): Promise<ToolConfigRecord[]> {
    await toolConfigRepository.ensureDefaults(userId);
    return toolConfigRepository.listByCategory(userId, category);
  },

  async listEnabled(userId: string): Promise<ToolConfigRecord[]> {
    return toolConfigRepository.listEnabled(userId);
  },

  async findById(userId: string, id: string): Promise<ToolConfigRecord> {
    const config = await toolConfigRepository.findById(userId, id);
    if (!config) throw new StudioError("Tool configuration not found", 404, "not_found");
    return config;
  },

  async findByToolType(userId: string, toolType: ToolType): Promise<ToolConfigRecord | null> {
    return toolConfigRepository.findByToolType(userId, toolType);
  },

  async create(userId: string, input: { toolType: ToolType; displayName?: string; enabled?: boolean; endpoint?: string; executablePath?: string; workingDirectory?: string; apiKey?: string; config?: Record<string, unknown> }): Promise<ToolConfigRecord> {
    const existing = await toolConfigRepository.findByToolType(userId, input.toolType);
    if (existing) throw new StudioError("Tool already configured", 409, "tool_config_already_exists");
    const displayName = input.displayName ?? TOOL_DISPLAY_NAMES[input.toolType];
    const category = TOOL_CATEGORY_MAP[input.toolType];
    return toolConfigRepository.create(userId, {
      toolType: input.toolType,
      displayName,
      category,
      enabled: input.enabled ?? false,
      endpoint: input.endpoint,
      executablePath: input.executablePath,
      workingDirectory: input.workingDirectory,
      apiKey: input.apiKey,
      config: input.config ?? {},
    });
  },

  async update(userId: string, id: string, input: Partial<{ displayName: string; enabled: boolean; endpoint: string; executablePath: string; workingDirectory: string; apiKey: string; config: Record<string, unknown> }>): Promise<ToolConfigRecord> {
    const config = await toolConfigRepository.findById(userId, id);
    if (!config) throw new StudioError("Tool configuration not found", 404, "not_found");
    const updated = await toolConfigRepository.update(userId, id, input);
    if (!updated) throw new StudioError("Tool configuration not found", 404, "not_found");
    return updated;
  },

  async remove(userId: string, id: string): Promise<void> {
    const removed = await toolConfigRepository.remove(userId, id);
    if (!removed) throw new StudioError("Tool configuration not found", 404, "not_found");
  },

  async runHealthCheck(userId: string, id: string): Promise<{ config: ToolConfigRecord; result: HealthCheckResult }> {
    return toolHealthCheckService.checkTool(userId, id);
  },

  async runHealthCheckAll(userId: string): Promise<{ config: ToolConfigRecord; result: HealthCheckResult }[]> {
    return toolHealthCheckService.checkAllTools(userId);
  },
};