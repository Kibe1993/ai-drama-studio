import "server-only";
import type { ToolType, HealthCheckResult } from "@/lib/validation/toolConfig";

export type ToolCapability = {
  hasApi: boolean;
  supportsHeadless: boolean;
  supportsWorkflow: boolean;
  supportsFileImport: boolean;
  supportsFileExport: boolean;
  supportedFileFormats: readonly string[];
};

export type WorkflowInfo = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  inputs?: Record<string, { type: string; required: boolean; default?: unknown }>;
};

export type ExecuteParams = {
  workflowId?: string;
  inputs: Record<string, unknown>;
  outputPath?: string;
  timeoutMs?: number;
};

export type JobHandle = {
  toolType: ToolType;
  operationId: string;
  status: "submitted";
};

export type PollResult =
  | { status: "processing"; progress?: number }
  | { status: "completed"; outputPaths: string[]; metadata?: Record<string, unknown> }
  | { status: "failed"; code: string; message: string };

export type ExportParams = {
  projectId: string;
  assetIds: string[];
  format: string;
  outputPath: string;
};

export type ImportResult = {
  filePath: string;
  format: string;
  metadata?: Record<string, unknown>;
};

export interface ExternalToolProvider {
  readonly id: string;
  readonly toolType: ToolType;
  readonly capabilities: ToolCapability;

  healthCheck(config: ToolConnectionConfig): Promise<HealthCheckResult>;
  listWorkflows?(config: ToolConnectionConfig): Promise<WorkflowInfo[]>;
  execute(config: ToolConnectionConfig, params: ExecuteParams): Promise<JobHandle>;
  poll(config: ToolConnectionConfig, handle: JobHandle): Promise<PollResult>;
  cancel?(config: ToolConnectionConfig, handle: JobHandle): Promise<void>;
  exportProject?(config: ToolConnectionConfig, params: ExportParams): Promise<{ filePath: string }>;
  importResult?(config: ToolConnectionConfig, filePath: string): Promise<ImportResult>;
}

export type ToolConnectionConfig = {
  endpoint?: string;
  executablePath?: string;
  workingDirectory?: string;
  apiKey?: string;
  config: Record<string, unknown>;
};