import { z } from "zod";
import {
  canonEntitySchema,
  canonStateSchema,
  proposedChangeSchema,
  type CanonEntity,
  type CanonState,
  type ProposedChange,
} from "@/lib/validation/narrativeControl";

export function defineCanon(
  input: Partial<z.input<typeof canonStateSchema>> & { projectId: string },
): CanonState {
  return canonStateSchema.parse({ version: 0, ...input });
}

export function defineEntity(
  input: Partial<z.input<typeof canonEntitySchema>> & Pick<CanonEntity, "id" | "kind" | "name">,
): CanonEntity {
  return canonEntitySchema.parse(input);
}

export function proposeChange(
  input: Pick<ProposedChange, "id" | "kind" | "targetKind" | "targetId"> & Partial<ProposedChange>,
): ProposedChange {
  return proposedChangeSchema.parse(input);
}
