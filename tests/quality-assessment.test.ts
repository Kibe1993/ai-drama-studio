import { describe, expect, it } from "vitest";
import {
  computeQualityAssessment,
  shouldBlockApproval,
} from "@/lib/domain/qualityAssessment";
import type { ValidationFinding, CritiqueFinding } from "@/lib/validation/qualityAssessment";

describe("Quality Assessment", () => {
  describe("computeQualityAssessment", () => {
    it("returns a perfect score when there are no findings", () => {
      const assessment = computeQualityAssessment([], []);
      expect(assessment.overallScore).toBe(100);
      expect(assessment.recommendation).toBe("approve");
      expect(assessment.blockingFindings).toHaveLength(0);
    });

    it("penalizes errors more than warnings", () => {
      const errorFindings: ValidationFinding[] = [
        { category: "canon", severity: "error", message: "Canon violation" },
      ];
      const warningFindings: ValidationFinding[] = [
        { category: "canon", severity: "warning", message: "Minor issue" },
      ];
      const errorAssessment = computeQualityAssessment(errorFindings, []);
      const warningAssessment = computeQualityAssessment(warningFindings, []);
      expect(errorAssessment.overallScore).toBeLessThan(warningAssessment.overallScore);
    });

    it("creates a dimension for each validation category", () => {
      const findings: ValidationFinding[] = [
        { category: "completeness", severity: "warning", message: "Issue" },
        { category: "canon", severity: "warning", message: "Issue" },
        { category: "continuity", severity: "warning", message: "Issue" },
        { category: "repetition", severity: "warning", message: "Issue" },
        { category: "structure", severity: "warning", message: "Issue" },
      ];
      const assessment = computeQualityAssessment(findings, []);
      const dimensionNames = assessment.dimensions.map((d) => d.name);
      expect(dimensionNames).toContain("completeness");
      expect(dimensionNames).toContain("canon");
      expect(dimensionNames).toContain("continuity");
      expect(dimensionNames).toContain("repetition");
      expect(dimensionNames).toContain("structure");
    });

    it("creates a semantic dimension when critique findings are provided", () => {
      const critiqueFindings: CritiqueFinding[] = [
        { severity: "warning", message: "Timeline issue", category: "timeline" },
      ];
      const assessment = computeQualityAssessment([], critiqueFindings);
      expect(assessment.dimensions.find((d) => d.name === "semantic")).toBeDefined();
    });

    it("adds blocking findings for error-severity findings", () => {
      const findings: ValidationFinding[] = [
        { category: "canon", severity: "error", message: "Canon violation" },
        { category: "completeness", severity: "warning", message: "Minor issue" },
      ];
      const assessment = computeQualityAssessment(findings, []);
      expect(assessment.blockingFindings).toHaveLength(1);
      expect(assessment.blockingFindings[0].dimension).toBe("canon");
    });

    it("recommends reject when score is very low", () => {
      const findings: ValidationFinding[] = [
        { category: "completeness", severity: "error", message: "E1" },
        { category: "completeness", severity: "error", message: "E2" },
        { category: "completeness", severity: "error", message: "E3" },
        { category: "completeness", severity: "error", message: "E4" },
        { category: "canon", severity: "error", message: "E5" },
        { category: "canon", severity: "error", message: "E6" },
        { category: "canon", severity: "error", message: "E7" },
        { category: "canon", severity: "error", message: "E8" },
        { category: "continuity", severity: "error", message: "E9" },
        { category: "continuity", severity: "error", message: "E10" },
        { category: "continuity", severity: "error", message: "E11" },
        { category: "continuity", severity: "error", message: "E12" },
        { category: "structure", severity: "error", message: "E13" },
        { category: "structure", severity: "error", message: "E14" },
        { category: "structure", severity: "error", message: "E15" },
        { category: "structure", severity: "error", message: "E16" },
        { category: "repetition", severity: "error", message: "E17" },
        { category: "repetition", severity: "error", message: "E18" },
        { category: "repetition", severity: "error", message: "E19" },
        { category: "repetition", severity: "error", message: "E20" },
      ];
      const assessment = computeQualityAssessment(findings, []);
      expect(assessment.overallScore).toBeLessThan(30);
      expect(assessment.recommendation).toBe("reject");
    });

    it("recommends revise for moderate scores", () => {
      const findings: ValidationFinding[] = [
        { category: "completeness", severity: "error", message: "E1" },
        { category: "completeness", severity: "error", message: "E2" },
        { category: "canon", severity: "error", message: "E3" },
        { category: "continuity", severity: "warning", message: "W1" },
        { category: "continuity", severity: "warning", message: "W2" },
        { category: "continuity", severity: "warning", message: "W3" },
        { category: "structure", severity: "warning", message: "W4" },
        { category: "structure", severity: "warning", message: "W5" },
        { category: "structure", severity: "warning", message: "W6" },
        { category: "repetition", severity: "warning", message: "W7" },
        { category: "repetition", severity: "warning", message: "W8" },
        { category: "repetition", severity: "warning", message: "W9" },
      ];
      const assessment = computeQualityAssessment(findings, []);
      expect(assessment.overallScore).toBeGreaterThanOrEqual(30);
      expect(assessment.overallScore).toBeLessThan(75);
      expect(assessment.recommendation).toBe("revise");
    });

    it("respects custom thresholds", () => {
      const findings: ValidationFinding[] = [
        { category: "completeness", severity: "error", message: "E1" },
        { category: "canon", severity: "warning", message: "W1" },
        { category: "canon", severity: "warning", message: "W2" },
        { category: "canon", severity: "warning", message: "W3" },
        { category: "continuity", severity: "warning", message: "W4" },
        { category: "continuity", severity: "warning", message: "W5" },
        { category: "continuity", severity: "warning", message: "W6" },
        { category: "structure", severity: "warning", message: "W7" },
        { category: "structure", severity: "warning", message: "W8" },
        { category: "structure", severity: "warning", message: "W9" },
        { category: "repetition", severity: "warning", message: "W10" },
        { category: "repetition", severity: "warning", message: "W11" },
        { category: "repetition", severity: "warning", message: "W12" },
      ];
      const assessment = computeQualityAssessment(findings, [], {
        approveThreshold: 95,
        rejectThreshold: 10,
      });
      expect(assessment.recommendation).toBe("revise");
    });

    it("includes a summary with the overall score", () => {
      const assessment = computeQualityAssessment([], []);
      expect(assessment.summary).toContain("100/100");
      expect(assessment.summary).toContain("Recommended for approval");
    });
  });

  describe("shouldBlockApproval", () => {
    it("blocks when recommendation is reject", () => {
      const assessment = computeQualityAssessment([
        { category: "canon", severity: "error", message: "E1" },
        { category: "completeness", severity: "error", message: "E2" },
        { category: "continuity", severity: "error", message: "E3" },
        { category: "structure", severity: "error", message: "E4" },
      ], []);
      expect(shouldBlockApproval(assessment)).toBe(true);
    });

    it("blocks when there are blocking findings", () => {
      const assessment = computeQualityAssessment([
        { category: "canon", severity: "error", message: "Canon violation" },
      ], []);
      expect(shouldBlockApproval(assessment)).toBe(true);
    });

    it("does not block when score is high and no blocking findings", () => {
      const assessment = computeQualityAssessment([], []);
      expect(shouldBlockApproval(assessment)).toBe(false);
    });

    it("blocks when score is below a custom threshold", () => {
      const findings: ValidationFinding[] = [
        { category: "completeness", severity: "warning", message: "W1" },
        { category: "completeness", severity: "warning", message: "W2" },
        { category: "canon", severity: "warning", message: "W3" },
        { category: "canon", severity: "warning", message: "W4" },
        { category: "continuity", severity: "warning", message: "W5" },
        { category: "continuity", severity: "warning", message: "W6" },
        { category: "structure", severity: "warning", message: "W7" },
        { category: "structure", severity: "warning", message: "W8" },
        { category: "repetition", severity: "warning", message: "W9" },
        { category: "repetition", severity: "warning", message: "W10" },
      ];
      const assessment = computeQualityAssessment(findings, []);
      expect(shouldBlockApproval(assessment, 95)).toBe(true);
    });
  });
});