import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default("");
const list = (maxItems: number, maxLen: number) => z.array(text(maxLen)).max(maxItems);

/**
 * A character's current state in the continuity ledger — their location,
 * knowledge, motivations, relationships, and emotional/physical state.
 */
export const characterStateSchema = z.object({
  name: text(80),
  currentLocation: text(200),
  currentObjective: text(400),
  knowledge: list(12, 300),
  beliefs: list(8, 300),
  motivations: list(6, 300),
  emotionalState: text(300),
  physicalState: optionalText(300),
  relationships: z.array(
    z.object({
      characterName: text(80),
      relationship: text(300),
      tensionOrChange: text(300),
    })
  ).max(12),
});

/**
 * An event that has happened in an approved episode. Events are ordered and
 * form the causal chain the next episode must build on.
 */
export const continuityEventSchema = z.object({
  episodeNumber: z.number().int().positive().max(100),
  event: text(400),
  consequence: text(400),
  affectedCharacters: list(8, 80),
  revealedInformation: list(6, 300),
});

/**
 * A location or object and its current state in the continuity ledger.
 */
export const continuityLocationStateSchema = z.object({
  name: text(120),
  currentState: text(400),
  lastSeenEpisode: z.number().int().positive().max(100),
});

export const continuityObjectStateSchema = z.object({
  name: text(120),
  ownership: text(200),
  condition: text(300),
  lastSeenEpisode: z.number().int().positive().max(100),
});

/**
 * An unresolved story thread — a question or mystery intentionally left open.
 */
export const unresolvedThreadSchema = z.object({
  thread: text(400),
  introducedInEpisode: z.number().int().positive().max(100),
  status: z.enum(["open", "developing", "resolved"]),
});

/**
 * The complete continuity ledger. This is the authoritative state of the
 * story world after all approved episodes. It is updated only when an episode
 * is approved, never for draft episodes.
 */
export const continuityLedgerSchema = z.object({
  events: z.array(continuityEventSchema).max(200),
  characterStates: z.array(characterStateSchema).max(24),
  locationStates: z.array(continuityLocationStateSchema).max(30),
  objectStates: z.array(continuityObjectStateSchema).max(30),
  revealedSecrets: list(20, 400),
  unresolvedThreads: z.array(unresolvedThreadSchema).max(30),
  consequences: list(20, 400),
  timelineNotes: optionalText(800),
});

export type CharacterState = z.infer<typeof characterStateSchema>;
export type ContinuityEvent = z.infer<typeof continuityEventSchema>;
export type ContinuityLocationState = z.infer<typeof continuityLocationStateSchema>;
export type ContinuityObjectState = z.infer<typeof continuityObjectStateSchema>;
export type UnresolvedThread = z.infer<typeof unresolvedThreadSchema>;
export type ContinuityLedger = z.infer<typeof continuityLedgerSchema>;

export type ContinuityLedgerRecord = ContinuityLedger & {
  id: string;
  clerkUserId: string;
  projectId: string;
  /** The episode number this ledger was current as of. */
  asOfEpisode: number;
  /** The approved Season Plan version this ledger is bound to. */
  basedOnPlanVersion: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};
