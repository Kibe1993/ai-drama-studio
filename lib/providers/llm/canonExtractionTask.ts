import { parseStructured } from "@/lib/providers/llm/parse";
import type { StoryCallOptions, TokenUsage } from "@/lib/providers/llm/types";
import {
  CANON_EXTRACTION_RESPONSE_SCHEMA,
  canonExtractionResponseSchema,
  type CanonExtractionResponse,
} from "@/lib/validation/canonExtraction";
import type { ScreenplayScene } from "@/lib/validation/story";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import { buildCanonExtractionPrompt } from "@/lib/domain/canonExtraction";

export type CanonExtractionPrompt = {
  seriesTitle: string;
  episodeNumber: number;
  screenplay: ScreenplayScene[];
  ledger: ContinuityLedger | null;
};

export type CanonExtractionTaskTransport = {
  label: string;
  request(
    system: string,
    prompt: string,
    schema: Record<string, unknown>,
    signal: AbortSignal,
    maxOutputTokens?: number
  ): Promise<{ text: string; usage?: TokenUsage; truncated?: boolean }>;
};

function signalOf(options: StoryCallOptions): AbortSignal {
  return options.signal ?? AbortSignal.timeout(120_000);
}

export function canonExtractionInstructions(input: CanonExtractionPrompt): { system: string; prompt: string } {
  return buildCanonExtractionPrompt({
    screenplay: input.screenplay,
    ledger: input.ledger,
    episodeNumber: input.episodeNumber,
    seriesTitle: input.seriesTitle,
  });
}

export async function requestCanonExtraction(
  transport: CanonExtractionTaskTransport,
  input: CanonExtractionPrompt,
  options: StoryCallOptions = {}
): Promise<{ response: CanonExtractionResponse; usage?: TokenUsage }> {
  const instructions = canonExtractionInstructions(input);
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    CANON_EXTRACTION_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    signalOf(options),
    8_000
  );
  const parsed = parseStructured(
    transport.label,
    response.text,
    canonExtractionResponseSchema,
    "canon extraction",
    undefined,
    response.truncated
  );
  return { response: parsed, usage: response.usage };
}