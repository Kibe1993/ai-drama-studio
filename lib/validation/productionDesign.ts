import { z } from "zod";

export const PRODUCTION_DESIGN_STATUSES = ["draft", "approved", "rejected"] as const;

export const shotSchema = z.object({
  shotNumber: z.number().int().min(1),
  type: z.string().trim().max(50).default("medium"),
  cameraDirection: z.string().trim().max(500).default(""),
  cameraMovement: z.string().trim().max(200).default(""),
  lens: z.string().trim().max(100).default(""),
  framing: z.string().trim().max(200).default(""),
  duration: z.number().min(0).default(0),
  lightingSetup: z.string().trim().max(500).default(""),
  lightingNotes: z.string().trim().max(2000).default(""),
  storyboardDescription: z.string().trim().max(5000).default(""),
  visualContinuityNotes: z.string().trim().max(2000).default(""),
});

export const characterStagingSchema = z.object({
  characterId: z.string().trim().min(1),
  position: z.string().trim().max(200).default(""),
  action: z.string().trim().max(500).default(""),
});

export const productionDesignSchema = z.object({
  shotList: z.array(shotSchema).max(50).default([]),
  locationDesign: z.object({
    dressing: z.string().trim().max(2000).default(""),
    props: z.string().trim().max(2000).default(""),
    atmosphere: z.string().trim().max(2000).default(""),
  }).default({ dressing: "", props: "", atmosphere: "" }),
  characterStaging: z.array(characterStagingSchema).max(20).default([]),
});

export type ProductionDesignInput = z.infer<typeof productionDesignSchema>;
export type ProductionDesignStatus = (typeof PRODUCTION_DESIGN_STATUSES)[number];

export type ProductionDesignRecord = ProductionDesignInput & {
  id: string;
  clerkUserId: string;
  projectId: string;
  sceneId: string;
  version: number;
  status: ProductionDesignStatus;
  createdAt: string;
  updatedAt: string;
};