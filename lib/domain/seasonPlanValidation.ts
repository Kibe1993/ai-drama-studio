import type {
  SeasonPlan,
  SeasonPlanValidationFindings,
  ValidationFinding,
} from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import { runDeterministicValidation, toLegacyFindings } from "@/lib/domain/planValidation";

/**
 * CASNA Stage C: Validate a Season Plan before it is presented for approval.
 *
 * This is an application-level structural validation, not a prompt-level check.
 * It examines the plan for continuity, progression, repetition, character
 * development, and narrative structure issues. It is deterministic and does
 * not call an LLM.
 *
 * The validation returns structured findings. Errors must be addressed before
 * approval; warnings are informational.

 *
 * This function delegates to the Season Plan Validation and Continuity Engine
 * (lib/domain/planValidation/) and converts the rich findings to the legacy
 * format for backward compatibility with the existing approval gate.
 */
export function validateSeasonPlan(
  plan: SeasonPlan,
  bible: StoryBibleContent | null
): SeasonPlanValidationFindings {
  const richFindings = runDeterministicValidation(plan, bible);
  const legacyFindings = toLegacyFindings(richFindings);
  const findings: ValidationFinding[] = legacyFindings.map((f) => ({
    category: f.category as ValidationFinding["category"],
    severity: f.severity,
    episodeNumber: f.episodeNumber,
    message: f.message,
  }));
  const passed = !findings.some((f) => f.severity === "error");
  return {
    passed,
    findings,
    validatedAt: new Date().toISOString(),
  };
}
