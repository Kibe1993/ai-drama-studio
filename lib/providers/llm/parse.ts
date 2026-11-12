import { log } from "@/lib/log";
import { JobError } from "@/lib/pipeline/types";
import { safeProviderDetail } from "@/lib/providers/llm/errors";
import { repairStoryPayload } from "@/lib/providers/llm/repairStory";
import { generatedStorySchema, type GeneratedStory } from "@/lib/validation/story";
import type { ZodType } from "zod";

function storyJsonText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) return body.slice(start, end + 1);
  return body;
}

export function parseStory(providerName: string, text: string): GeneratedStory {
  const trimmed = storyJsonText(text);
  if (!trimmed) {
    throw new JobError(`${providerName} returned an empty story.`, "empty_response", false);
  }
  let parsed: unknown;
  try {
    parsed = repairStoryPayload(JSON.parse(trimmed));
  } catch {
    log.error("llm", "invalid json", {
      provider: providerName,
      detail: safeProviderDetail(trimmed.slice(0, 180)),
    });
    throw new JobError(`${providerName} returned a story that was not valid JSON.`, "invalid_json", false);
  }
  const result = generatedStorySchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const keys = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed).slice(0, 12).join(",") : "";
    log.error("llm", "invalid schema", {
      provider: providerName,
      path: issue?.path.join(".") ?? "",
      detail: issue?.message ?? "schema mismatch",
      fields: keys,
    });
    throw new JobError(
      `${providerName} returned a story that did not match the screenplay schema.`,
      "invalid_schema",
      false
    );
  }
  return result.data;
}

export function parseStructured<T>(providerName: string, text: string, schema: ZodType<T>, noun: string): T {
  const trimmed = storyJsonText(text);
  if (!trimmed) {
    throw new JobError(`${providerName} returned an empty ${noun}.`, "empty_response", false);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    log.error("llm", "invalid json", {
      provider: providerName,
      detail: safeProviderDetail(trimmed.slice(0, 180)),
    });
    throw new JobError(`${providerName} returned a ${noun} that was not valid JSON.`, "invalid_json", false);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const keys = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed).slice(0, 12).join(",") : "";
    log.error("llm", "invalid schema", {
      provider: providerName,
      path: issue?.path.join(".") ?? "",
      detail: issue?.message ?? "schema mismatch",
      fields: keys,
    });
    throw new JobError(`${providerName} returned a ${noun} that did not match the schema.`, "invalid_schema", false);
  }
  return result.data;
}
