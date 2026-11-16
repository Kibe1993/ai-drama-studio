import type { CanonEntity } from "@/lib/validation/narrativeControl";
import { makeFinding, type NarrativeFinding } from "@/lib/domain/narrativeControl/findings";

export type EntityUse = "physical" | "mention" | "absent";

/**
 * Check one use of an entity against its recorded lifecycle.
 * Absence is not a defect. A first appearance in the episode that introduces
 * the entity is valid. Physical participation before that appearance is not.
 */
export function validateEntityUse(
  entity: CanonEntity,
  episode: number,
  use: EntityUse,
  options: { flashback?: boolean; sceneNumber?: number | null } = {},
): NarrativeFinding[] {
  if (use === "absent") return [];

  const flashback = options.flashback === true;
  const findings: NarrativeFinding[] = [];

  if (
    use === "physical"
    && entity.firstAppearanceEpisode !== null
    && episode < entity.firstAppearanceEpisode
    && !flashback
  ) {
    findings.push(makeFinding({
      algorithm: "temporal",
      severity: "ERROR",
      category: "chronology",
      entityId: entity.id,
      episode,
      sceneNumber: options.sceneNumber ?? null,
      evidence: entity.name,
      expected: `No physical appearance before episode ${entity.firstAppearanceEpisode}.`,
      actual: `Physical appearance in episode ${episode}.`,
      explanation: `${entity.name} is physically present in episode ${episode}, but the canon introduces that appearance in episode ${entity.firstAppearanceEpisode}.`,
      suggestedCorrection: "Move the appearance, or record an earlier appearance or a flashback.",
      automaticRepairSafe: false,
    }));
  }

  if (
    use === "physical"
    && entity.endedEpisode !== null
    && episode > entity.endedEpisode
    && !flashback
    && !entity.permitsNonlivingAppearance
  ) {
    findings.push(makeFinding({
      algorithm: "temporal",
      severity: "ERROR",
      category: "chronology",
      entityId: entity.id,
      episode,
      sceneNumber: options.sceneNumber ?? null,
      evidence: entity.name,
      expected: "A flashback, recording, or canon exception after the entity's ending.",
      actual: `Physical use in episode ${episode} after episode ${entity.endedEpisode}.`,
      explanation: `${entity.name} is ${entity.lifecycle} after episode ${entity.endedEpisode} and still appears physically in episode ${episode}.`,
      suggestedCorrection: "Mark the scene as a flashback or record an approved exception.",
      automaticRepairSafe: false,
    }));
  }

  return findings;
}

export function sceneLooksLikeFlashback(text: string): boolean {
  const value = text.toLocaleLowerCase();
  return value.includes("flashback") || value.includes("memory") || value.includes("dream") || value.includes("recording");
}
