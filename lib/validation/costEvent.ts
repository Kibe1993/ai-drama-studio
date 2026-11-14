import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

export const costEventSchema = z.object({
  projectId: objectId,
  generationJobId: objectId.nullable().optional(),
  provider: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(160),
  usage: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  estimatedCostCents: z.number().int().min(0).default(0),
  billable: z.boolean().default(false),
  kind: z.enum(["generation", "render"]).default("generation"),
});

export type CostEventInput = z.infer<typeof costEventSchema>;
export type CostEventRecord = CostEventInput & {
  id: string;
  clerkUserId: string;
  createdAt: string;
  updatedAt: string;
};