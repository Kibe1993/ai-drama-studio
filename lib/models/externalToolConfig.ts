import { Schema, type Connection, type Model } from "mongoose";
import {
  TOOL_TYPES,
  TOOL_STATUSES,
  TOOL_CATEGORIES,
} from "@/lib/validation/toolConfig";

const ExternalToolConfigSchema = new Schema({
  clerkUserId: { type: String, required: true },
  toolType: { type: String, enum: TOOL_TYPES, required: true },
  displayName: { type: String, required: true, maxlength: 80 },
  category: { type: String, enum: TOOL_CATEGORIES, required: true },
  enabled: { type: Boolean, default: false },
  endpoint: { type: String, default: null, maxlength: 500 },
  executablePath: { type: String, default: null, maxlength: 500 },
  workingDirectory: { type: String, default: null, maxlength: 500 },
  apiKey: { type: String, default: null, maxlength: 200 },
  config: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: TOOL_STATUSES, default: "not_installed" },
  lastHealthCheck: { type: Date, default: null },
  lastHealthCheckResult: { type: Schema.Types.Mixed, default: null },
}, { timestamps: true, collection: "externalToolConfigs" });

ExternalToolConfigSchema.index(
  { clerkUserId: 1, toolType: 1 },
  { unique: true }
);
ExternalToolConfigSchema.index({ clerkUserId: 1, category: 1, enabled: 1 });

export function externalToolConfigModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.ExternalToolConfig;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("ExternalToolConfig", ExternalToolConfigSchema) as unknown as Model<Record<string, unknown>>;
}