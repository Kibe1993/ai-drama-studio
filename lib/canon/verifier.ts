import type { DerivedCanonState } from "@/lib/canon/schema";
import { derivedToCanonState } from "@/lib/canon/bridge";
import {
  agreementFindings,
  causalFindings,
  contradictionChanges,
  evaluateProposal,
  validateThreads,
  type NarrativeFinding,
} from "@/lib/domain/narrativeControl";
import type { ValidationLayer } from "@/lib/validation/narrativeControl";
import type { ScreenplayScene, StoryStructure } from "@/lib/validation/story";

/**
 * The dedicated canon-log verifier. Reconstructs a CanonState snapshot from
 * the append-only fact log and runs the existing narrativeControl validators
 * against a proposed screenplay. Concrete contradictions produce ERROR
 * severity findings that block approval.
 */

export type CanonVerificationInput = {
  episodeNumber: number;
  synopsis: string;
  screenplay: ScreenplayScene[];
  structure?: StoryStructure | null;
  canonState: DerivedCanonState;
  requireCanonCoverage?: boolean;
  basedOnBibleVersion?: number;
  basedOnPlanVersion?: number;
};

export type CanonVerificationResult = {
  passed: boolean;
  findings: NarrativeFinding[];
  canonVersion: number;
  decision: "approve" | "reject" | "needs_authorization";
  layers: ValidationLayer[];
};

function spokenSceneText(scene: ScreenplayScene): string {
  const dialogue = scene.dialogue
    .map((line) => `${line.characterName}: ${line.line}`)
    .join("\n");
  return [scene.heading, scene.visualDescription, scene.action, dialogue]
    .filter(Boolean)
    .join(" ");
}

function actSummary(structure: StoryStructure): string {
  const { act1, act2, act3 } = structure;
  return [
    act1.initialSituation,
    act1.incitingIncident,
    act2.turningPoint,
    act3.climax,
    act3.finalOutcome,
  ].join(" ");
}

export function verifyAgainstCanonLog(
  input: CanonVerificationInput,
): CanonVerificationResult {
  const canon = derivedToCanonState(input.canonState, {
    basedOnBibleVersion: input.basedOnBibleVersion,
    basedOnPlanVersion: input.basedOnPlanVersion,
  });

  const actText = input.structure ? actSummary(input.structure) : "";
  const spoken = input.screenplay.map(spokenSceneText).join("\n");
  const proposedContent = [input.synopsis, actText, spoken].filter(Boolean).join("\n");

  const decision = evaluateProposal({
    canon,
    episode: input.episodeNumber,
    provider: "canon-verifier",
    scenes: input.screenplay.map((scene) => ({
      sceneNumber: scene.sceneNumber,
      charactersPresent: scene.charactersPresent,
      location: scene.location,
      text: spokenSceneText(scene),
    })),
    response: {
      taskId: `canon-verify-${input.episodeNumber}`,
      projectId: canon.projectId,
      narrativeVersion: canon.version,
      proposedContent,
      proposedChanges: contradictionChanges(canon, input.episodeNumber, proposedContent),
      newEntities: [],
      newFacts: [],
      modifiedFacts: [],
      dependencies: [],
      uncertainties: [],
    },
  });

  const findings = [...decision.findings];

  // The orchestrator only runs thread/causal checks when proposed changes
  // touch the event/thread graph. The verifier always runs them — a
  // screenplay must not coexist with broken thread or causal metadata.
  findings.push(...validateThreads(canon));
  findings.push(...causalFindings(canon));

  const agreements = agreementFindings({
    canon,
    episode: input.episodeNumber,
    synopsis: input.synopsis,
    acts: actText,
    screenplayText: spoken,
    endingText: input.screenplay.slice(-2).map(spokenSceneText).join("\n"),
    requireCanonCoverage: input.requireCanonCoverage === true,
  });
  findings.push(...agreements);

  const hasErrors = findings.some((f) => f.severity === "ERROR");
  const needsAuth = findings.some((f) => f.requiresCanonAuthorization);

  let resultDecision: "approve" | "reject" | "needs_authorization";
  if (needsAuth) {
    resultDecision = "needs_authorization";
  } else if (hasErrors) {
    resultDecision = "reject";
  } else {
    resultDecision = "approve";
  }

  return {
    passed: !hasErrors,
    findings,
    canonVersion: canon.version,
    decision: resultDecision,
    layers: decision.layers,
  };
}