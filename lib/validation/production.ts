import { z } from "zod";

export const productionActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    workflowMode: z.enum(["guided", "automatic"]),
  }),
  z.object({ action: z.literal("story") }),
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("scenes") }),
  z.object({ action: z.literal("retry") }),
  z.object({
    action: z.literal("retryScene"),
    sceneNumber: z.number().int().positive(),
  }),
  z.object({ action: z.literal("cancel") }),
]);
