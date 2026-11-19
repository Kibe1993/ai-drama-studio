import type {
  NarrativeMode,
  AssertionKind,
  FactualStatus,
} from "@/lib/canon/schema";
import type { EvidenceElementType } from "@/lib/domain/evidenceVerification";

export type EventType = "concrete" | "perceptual" | "ambiguous";

export type ClassificationInput = {
  elementType: EvidenceElementType;
  narrativeMode: NarrativeMode;
  /** Only meaningful for non-dialogue elements. */
  eventType?: EventType;
};

export type ClassificationIssue = {
  code: string;
  message: string;
};

export type ClassificationResult = {
  assertionKind: AssertionKind;
  factualStatus: FactualStatus;
  issue?: ClassificationIssue;
};

const SUBJECTIVE_MODES: ReadonlySet<NarrativeMode> = new Set([
  "dream",
  "vision",
  "speculation",
  "lie",
]);

export function inferNarrativeModeFromHeading(heading: string): NarrativeMode | null {
  const upper = heading.toUpperCase();
  if (upper.includes("FLASHBACK")) return "flashback";
  if (upper.includes("DREAM")) return "dream";
  if (upper.includes("VISION")) return "vision";
  return null;
}

export function classifyAssertion(input: ClassificationInput): ClassificationResult {
  if (input.elementType === "dialogue") {
    return {
      assertionKind: "character_statement",
      factualStatus: "not_established",
    };
  }

  if (SUBJECTIVE_MODES.has(input.narrativeMode)) {
    return {
      assertionKind: "character_experience",
      factualStatus: "not_established",
      issue: {
        code: "ambiguous_narrative_mode",
        message: `Narrative mode "${input.narrativeMode}" is subjective; classified as not_established.`,
      },
    };
  }

  const eventType = input.eventType ?? "ambiguous";

  if (eventType === "concrete") {
    return {
      assertionKind: "event",
      factualStatus: "established",
    };
  }

  return {
    assertionKind: "character_experience",
    factualStatus: "not_established",
    issue:
      eventType === "ambiguous"
        ? {
            code: "ambiguous_event_type",
            message:
              "Event type is ambiguous; classified as character_experience + not_established.",
          }
        : undefined,
  };
}