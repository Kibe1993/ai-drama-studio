import { STORY_RESPONSE_SCHEMA } from "@/lib/validation/story";

/** OpenAI-compatible structured output. The schema is the same object Gemini already sends. */
export function jsonSchemaFormat(name: string, schema: Record<string, unknown>, strict = true) {
  return {
    type: "json_schema" as const,
    json_schema: {
      name,
      strict,
      schema,
    },
  };
}

export function storyJsonSchemaFormat(strict = true) {
  return jsonSchemaFormat("drama_screenplay", STORY_RESPONSE_SCHEMA as unknown as Record<string, unknown>, strict);
}
