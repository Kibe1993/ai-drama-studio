import "server-only";
import type { ExternalToolProvider, ToolConnectionConfig } from "./types";
import type { ToolType } from "@/lib/validation/toolConfig";

const registry = new Map<ToolType, ExternalToolProvider>();

export function registerToolProvider(provider: ExternalToolProvider): void {
  registry.set(provider.toolType, provider);
}

export function getToolProvider(toolType: ToolType): ExternalToolProvider | undefined {
  return registry.get(toolType);
}

export function listToolProviders(): ExternalToolProvider[] {
  return Array.from(registry.values());
}

export function buildConnectionConfig(config: {
  endpoint?: string;
  executablePath?: string;
  workingDirectory?: string;
  apiKey?: string;
  config: Record<string, unknown>;
}): ToolConnectionConfig {
  return {
    endpoint: config.endpoint || undefined,
    executablePath: config.executablePath || undefined,
    workingDirectory: config.workingDirectory || undefined,
    apiKey: config.apiKey || undefined,
    config: config.config ?? {},
  };
}