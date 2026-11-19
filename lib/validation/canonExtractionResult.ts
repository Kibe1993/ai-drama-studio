import { z } from "zod";
import {
  CANON_FACT_KINDS,
  NARRATIVE_MODES,
} from "@/lib/canon/schema";

export const EVENT_TYPES = ["concrete", "perceptual", "ambiguous"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const extractedFactSchema = z.object({
  kind: z.enum(CANON_FACT_KINDS),
  targetId: z.string().trim().min(1).max(160),
  payload: z.unknown(),
  narrativeMode: z.enum(NARRATIVE_MODES),
  eventType: z.enum(EVENT_TYPES).optional(),
  confidence: z.number().min(0).max(1),
  quote: z.string().trim().min(1).max(4000),
  sceneNumber: z.number().int().min(1).max(500),
  asserterId: z.string().trim().min(1).max(160).nullable().default(null),
  reason: z.string().trim().max(800).default(""),
});
export type ExtractedFact = z.infer<typeof extractedFactSchema>;

export const canonExtractionResultSchema = z.object({
  facts: z.array(extractedFactSchema).max(200),
});
export type CanonExtractionResult = z.infer<typeof canonExtractionResultSchema>;

export const CANON_EXTRACTION_RESULT_JSON_SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [...CANON_FACT_KINDS],
          },
          targetId: { type: "string", maxLength: 160 },
          payload: {},
          narrativeMode: {
            type: "string",
            enum: [...NARRATIVE_MODES],
          },
          eventType: {
            type: "string",
            enum: [...EVENT_TYPES],
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          quote: { type: "string", maxLength: 4000 },
          sceneNumber: { type: "integer", minimum: 1, maximum: 500 },
          asserterId: { type: ["string", "null"], maxLength: 160 },
          reason: { type: "string", maxLength: 800 },
        },
        required: [
          "kind",
          "targetId",
          "payload",
          "narrativeMode",
          "confidence",
          "quote",
          "sceneNumber",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["facts"],
  additionalProperties: false,
} as const;