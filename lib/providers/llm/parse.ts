import { log } from "@/lib/log";
import { JobError } from "@/lib/pipeline/types";
import { safeProviderDetail } from "@/lib/providers/llm/errors";
import { repairStoryPayload, screenplayEntryCount } from "@/lib/providers/llm/repairStory";
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
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    log.error("llm", "invalid json", {
      provider: providerName,
      detail: safeProviderDetail(trimmed.slice(0, 180)),
    });
    throw new JobError(`${providerName} returned a story that was not valid JSON.`, "invalid_json", false);
  }
  const parsed = repairStoryPayload(raw);
  // A repaired entry count below the declared count means scenes arrived with
  // no usable content. That is what a token-truncated screenplay looks like
  // once the provider closes the JSON. Fail loudly instead of saving the
  // surviving fragment as a complete episode.
  const declaredScenes = screenplayEntryCount(raw);
  const repairedScenes = Array.isArray((parsed as { screenplay?: unknown }).screenplay)
    ? ((parsed as { screenplay: unknown[] }).screenplay.length)
    : 0;
  if (declaredScenes > repairedScenes) {
    log.error("llm", "incomplete screenplay", {
      provider: providerName,
      declaredScenes,
      repairedScenes,
    });
    throw new JobError(
      `${providerName} returned a screenplay with ${declaredScenes} scenes but only ${repairedScenes} were complete. The response was truncated.`,
      "invalid_schema",
      false
    );
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

export function parseStructured<T>(
  providerName: string,
  text: string,
  schema: ZodType<T>,
  noun: string,
  normalize?: (parsed: unknown) => unknown
): T {
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
      chars: trimmed.length,
      head: safeProviderDetail(trimmed.slice(0, 180)),
      tail: safeProviderDetail(trimmed.slice(-120)),
    });
    throw new JobError(`${providerName} returned a ${noun} that was not valid JSON.`, "invalid_json", false);
  }
  if (normalize) parsed = normalize(parsed);
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
