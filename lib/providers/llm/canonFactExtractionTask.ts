import type { StoryCallOptions, TokenUsage } from "@/lib/providers/llm/types";
import {
  CANON_EXTRACTION_RESULT_JSON_SCHEMA,
} from "@/lib/validation/canonExtractionResult";
import type { StageTransport } from "@/lib/providers/llm/stageTasks";

export type CanonFactExtractionTaskInput = {
  system: string;
  prompt: string;
};

export type CanonFactExtractionTaskTransport = StageTransport;

function signalOf(options: StoryCallOptions): AbortSignal {
  return options.signal ?? AbortSignal.timeout(120_000);
}

export async function requestCanonFactExtraction(
  transport: CanonFactExtractionTaskTransport,
  input: CanonFactExtractionTaskInput,
  options: StoryCallOptions = {}
): Promise<{ text: string; usage?: TokenUsage; truncated?: boolean }> {
  const response = await transport.request(
    input.system,
    input.prompt,
    CANON_EXTRACTION_RESULT_JSON_SCHEMA as unknown as Record<string, unknown>,
    signalOf(options),
    8_000
  );
  return { text: response.text, usage: response.usage, truncated: response.truncated };
}