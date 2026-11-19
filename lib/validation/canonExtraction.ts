import { z } from "zod";
import {
  continuityLocationStateSchema,
  continuityObjectStateSchema,
  unresolvedThreadSchema,
} from "@/lib/validation/continuityLedger";

const text = (max: number) => z.string().trim().min(1).max(max);
const list = (maxItems: number, maxLen: number) => z.array(text(maxLen)).max(maxItems);

/**
 * The raw canon facts the LLM extracts from an approved screenplay. This is the
 * response schema sent to the model and the first Zod validation pass.
 *
 * Every field is required (may be an empty array) — the model may find
 * nothing worth suggesting, in which case all arrays are empty.
 */
export const canonExtractionResponseSchema = z.object({
  events: z
    .array(
      z.object({
        event: text(400),
        consequence: text(400),
        affectedCharacters: list(8, 80),
        revealedInformation: list(6, 300),
      })
    )
    .max(10),
  characterKnowledge: z
    .array(
      z.object({
        characterName: text(80),
        knowledge: list(6, 300),
      })
    )
    .max(12),
  characterBeliefs: z
    .array(
      z.object({
        characterName: text(80),
        beliefs: list(4, 300),
      })
    )
    .max(12),
  characterMotivations: z
    .array(
      z.object({
        characterName: text(80),
        motivations: list(4, 300),
      })
    )
    .max(12),
  relationshipChanges: z
    .array(
      z.object({
        characterName: text(80),
        relationships: z
          .array(
            z.object({
              characterName: text(80),
              relationship: text(300),
              tensionOrChange: text(300),
            })
          )
          .max(6),
      })
    )
    .max(12),
  revealedSecrets: list(10, 400),
  unresolvedThreads: z.array(unresolvedThreadSchema).max(10),
  locationStates: z.array(continuityLocationStateSchema).max(10),
  objectStates: z.array(continuityObjectStateSchema).max(10),
});

export type CanonExtractionResponse = z.infer<typeof canonExtractionResponseSchema>;

/**
 * A stored canon suggestion — the LLM extraction result plus review metadata.
 * The creator sees this in the UI and can accept or reject individual fields.
 * Accepted suggestions are merged into the next Continuity Ledger version.
 */
export const canonSuggestionSchema = canonExtractionResponseSchema.extend({
  episodeNumber: z.number().int().positive().max(100),
  storyId: text(200),
  createdAt: z.string().min(1),
  status: z.enum(["pending", "accepted", "rejected"]).default("pending"),
});

export type CanonSuggestion = z.infer<typeof canonSuggestionSchema>;

/**
 * JSON schema sent to the LLM for constrained output. Mirrors
 * canonExtractionResponseSchema but as a plain JSON-Schema object.
 */
export const CANON_EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          event: { type: "string", maxLength: 400 },
          consequence: { type: "string", maxLength: 400 },
          affectedCharacters: { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } },
          revealedInformation: { type: "array", maxItems: 6, items: { type: "string", maxLength: 300 } },
        },
        required: ["event", "consequence", "affectedCharacters", "revealedInformation"],
        additionalProperties: false,
      },
    },
    characterKnowledge: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          characterName: { type: "string", maxLength: 80 },
          knowledge: { type: "array", maxItems: 6, items: { type: "string", maxLength: 300 } },
        },
        required: ["characterName", "knowledge"],
        additionalProperties: false,
      },
    },
    characterBeliefs: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          characterName: { type: "string", maxLength: 80 },
          beliefs: { type: "array", maxItems: 4, items: { type: "string", maxLength: 300 } },
        },
        required: ["characterName", "beliefs"],
        additionalProperties: false,
      },
    },
    characterMotivations: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          characterName: { type: "string", maxLength: 80 },
          motivations: { type: "array", maxItems: 4, items: { type: "string", maxLength: 300 } },
        },
        required: ["characterName", "motivations"],
        additionalProperties: false,
      },
    },
    relationshipChanges: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          characterName: { type: "string", maxLength: 80 },
          relationships: {
            type: "array",
            maxItems: 6,
            items: {
              type: "object",
              properties: {
                characterName: { type: "string", maxLength: 80 },
                relationship: { type: "string", maxLength: 300 },
                tensionOrChange: { type: "string", maxLength: 300 },
              },
              required: ["characterName", "relationship", "tensionOrChange"],
              additionalProperties: false,
            },
          },
        },
        required: ["characterName", "relationships"],
        additionalProperties: false,
      },
    },
    revealedSecrets: { type: "array", maxItems: 10, items: { type: "string", maxLength: 400 } },
    unresolvedThreads: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          thread: { type: "string", maxLength: 400 },
          introducedInEpisode: { type: "integer", minimum: 1, maximum: 100 },
          status: { type: "string", enum: ["open", "developing", "resolved"] },
        },
        required: ["thread", "introducedInEpisode", "status"],
        additionalProperties: false,
      },
    },
    locationStates: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          name: { type: "string", maxLength: 120 },
          currentState: { type: "string", maxLength: 400 },
          lastSeenEpisode: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["name", "currentState", "lastSeenEpisode"],
        additionalProperties: false,
      },
    },
    objectStates: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          name: { type: "string", maxLength: 120 },
          ownership: { type: "string", maxLength: 200 },
          condition: { type: "string", maxLength: 300 },
          lastSeenEpisode: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["name", "ownership", "condition", "lastSeenEpisode"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "events",
    "characterKnowledge",
    "characterBeliefs",
    "characterMotivations",
    "relationshipChanges",
    "revealedSecrets",
    "unresolvedThreads",
    "locationStates",
    "objectStates",
  ],
  additionalProperties: false,
} as const;