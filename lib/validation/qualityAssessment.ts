import { z } from "zod";

export const qualityDimensionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  score: z.number().int().min(0).max(100),
  maxScore: z.number().int().min(1).max(100).default(100),
  findings: z.array(
    z.object({
      severity: z.enum(["error", "warning", "info"]),
      message: z.string().trim().min(1).max(1000),
      category: z.string().trim().min(1).max(80).default("general"),
    })
  ).max(50).default([]),
});

export const qualityAssessmentSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  dimensions: z.array(qualityDimensionSchema).min(1).max(10),
  blockingFindings: z.array(
    z.object({
      dimension: z.string().trim().max(80),
      message: z.string().trim().min(1).max(1000),
    })
  ).max(20).default([]),
  recommendation: z.enum(["approve", "revise", "reject"]).default("revise"),
  summary: z.string().trim().max(2000).default(""),
  assessedAt: z.string().trim().min(1),
});

export type QualityDimension = z.infer<typeof qualityDimensionSchema>;
export type QualityAssessment = z.infer<typeof qualityAssessmentSchema>;

export type ValidationFinding = {
  category: string;
  severity: "error" | "warning" | "info";
  message: string;
  sceneNumber?: number;
};

export type CritiqueFinding = {
  severity: "error" | "warning" | "info";
  message: string;
  category?: string;
};