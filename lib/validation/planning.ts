import { z } from "zod";

export const PLANNING_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;

export const alternativeDirectionSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  pros: z.array(z.string().trim().max(500)).max(10).default([]),
  cons: z.array(z.string().trim().max(500)).max(10).default([]),
  selected: z.boolean().default(false),
});

export const planningReferenceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.string().trim().max(50).default("other"),
  relevance: z.string().trim().max(500).default(""),
});

export const planningDocumentSchema = z.object({
  concept: z.object({
    logline: z.string().trim().max(500).default(""),
    synopsis: z.string().trim().max(10000).default(""),
    elevatorPitch: z.string().trim().max(1000).default(""),
  }).default({ logline: "", synopsis: "", elevatorPitch: "" }),
  themes: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  centralQuestion: z.string().trim().max(1000).default(""),
  mainConflict: z.string().trim().max(2000).default(""),
  audience: z.object({
    demographic: z.string().trim().max(500).default(""),
    tone: z.string().trim().max(200).default(""),
    contentRating: z.string().trim().max(50).default(""),
  }).default({ demographic: "", tone: "", contentRating: "" }),
  narrativeDirection: z.object({
    structure: z.string().trim().max(200).default(""),
    pov: z.string().trim().max(200).default(""),
    pacing: z.string().trim().max(200).default(""),
  }).default({ structure: "", pov: "", pacing: "" }),
  alternativeDirections: z.array(alternativeDirectionSchema).max(5).default([]),
  references: z.array(planningReferenceSchema).max(20).default([]),
});

export const planningApprovalSchema = z.object({
  expectedVersion: z.number().int().min(1),
  rejectionReason: z.string().trim().max(2000).optional(),
});

export type PlanningDocumentInput = z.infer<typeof planningDocumentSchema>;
export type PlanningStatus = (typeof PLANNING_STATUSES)[number];

export type PlanningDocumentRecord = PlanningDocumentInput & {
  id: string;
  clerkUserId: string;
  projectId: string;
  version: number;
  status: PlanningStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
};