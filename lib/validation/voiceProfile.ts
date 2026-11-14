import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

export const voiceProfileSchema = z.object({
  projectId: objectId,
  canonicalEntityId: objectId,
  voiceDescription: z.string().trim().max(500).default(""),
  preferredProvider: z.string().trim().max(80).default(""),
  voiceIdentifier: z.string().trim().max(160).default(""),
  language: z.string().trim().max(20).default("en"),
  accent: z.string().trim().max(80).default(""),
  speakingStyle: z.string().trim().max(300).default(""),
  emotionalCharacteristics: z.string().trim().max(400).default(""),
  status: z.enum(["draft", "approved"]).default("draft"),
  idempotencyKey: z.string().trim().min(8).max(180),
});

export type VoiceProfileInput = z.infer<typeof voiceProfileSchema>;
export type VoiceProfileRecord = VoiceProfileInput & {
  id: string;
  clerkUserId: string;
  createdAt: string;
  updatedAt: string;
};