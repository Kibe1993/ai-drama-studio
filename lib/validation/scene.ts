import { z } from "zod";
import { dialogueLineSchema } from "@/lib/validation/story";

export const shotPlanSchema = z.object({
  shotNumber: z.number().int().positive().max(20),
  purpose: z.string().trim().min(1).max(240),
  framing: z.string().trim().max(120).default(""),
  cameraDirection: z.string().trim().max(300).default(""),
  action: z.string().trim().max(500).default(""),
  estimatedDurationSeconds: z.number().int().positive().max(180).nullable().default(null),
});

export const sceneEditSchema = z.object({
  title: z.string().trim().min(1).max(160),
  location: z.string().trim().min(1).max(160),
  interiorExterior: z.enum(["interior", "exterior", ""]),
  timeOfDay: z.string().trim().min(1).max(40),
  charactersPresent: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  visualDescription: z.string().trim().min(1).max(1200),
  action: z.string().trim().min(1).max(1200),
  dialogue: z.array(dialogueLineSchema).max(12),
  cameraDirection: z.string().trim().max(400),
  estimatedDurationSeconds: z.number().int().positive().max(180).nullable(),
  shotPlan: z.array(shotPlanSchema).max(20),
});

export type SceneEdit = z.infer<typeof sceneEditSchema>;
export type ShotPlan = z.infer<typeof shotPlanSchema>;
export type SceneRecord = SceneEdit & {
  id: string;
  clerkUserId: string;
  projectId: string;
  productionRunId: string;
  episodeId: string | null;
  storyId: string;
  sceneNumber: number;
  videoReady: boolean;
  videoStatus: "pending" | "processing" | "mock" | "completed" | "failed" | "unavailable";
  videoAssetId: string | null;
  failed: boolean;
  createdAt: string;
  updatedAt: string;
};
