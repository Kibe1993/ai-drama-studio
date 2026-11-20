export {
  CANON_FACT_SCHEMA_VERSION,
  CANON_FACT_KINDS,
  CANON_FACT_OPERATIONS,
  NARRATIVE_MODES,
  ASSERTION_KINDS,
  FACTUAL_STATUSES,
  type CanonFactKind,
  type CanonFactOperation,
  type NarrativeMode,
  type AssertionKind,
  type FactualStatus,
  type Evidence,
  type CanonFactEntry,
  type SubjectiveFact,
  type DerivedCanonState,
  type FactClassification,
  evidenceSchema,
  canonFactEntrySchema,
  subjectiveFactSchema,
  derivedCanonStateSchema,
  emptyDerivedCanonState,
  parsePayload,
  defaultFactualStatus,
} from "@/lib/canon/schema";

export {
  reduceCanon,
  reduceCanonIncremental,
  ReduceError,
  type ReduceMode,
} from "@/lib/canon/reduce";

export { canonFactModel } from "@/lib/canon/model";

export { canonStore, CanonFactConflict } from "@/lib/canon/store";
export { InMemoryCanonFactStore, CanonFactConflict as InMemoryCanonFactConflict } from "@/lib/canon/inMemoryStore";export { derivedToCanonState } from "@/lib/canon/bridge";
export { verifyAgainstCanonLog, type CanonVerificationInput, type CanonVerificationResult } from "@/lib/canon/verifier";export { buildCanonView, buildCanonViewForEpisode, type ViewPurpose, type CanonViewInput, type CanonView } from "@/lib/canon/views";