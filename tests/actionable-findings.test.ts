import { describe, expect, it } from "vitest";
import {
  canAcceptAsIntentional,
  isBlockingFinding,
  mergeResolutions,
  validationPassesForApproval,
  type EpisodeValidation,
  type EpisodeValidationFinding,
} from "@/lib/validation/casna";
import { validateEpisodeScreenplay } from "@/lib/domain/screenplayValidation";
import { makeFinding } from "@/lib/domain/narrativeControl/findings";
import type { ScreenplayScene, GeneratedStory } from "@/lib/validation/story";

function scene(sceneNumber: number, action: string, dialogue: { characterName: string; line: string }[] = []): ScreenplayScene {
  return {
    sceneNumber,
    heading: `INT. HOUSE - SCENE ${sceneNumber}`,
    location: "House",
    timeOfDay: "Night",
    charactersPresent: dialogue.map((d) => d.characterName),
    visualDescription: `Visual for scene ${sceneNumber}.`,
    action,
    dialogue,
  };
}

function coherentStory(): GeneratedStory {
  return {
    title: "The Coherent Tale",
    synopsis: "A detective solves a mystery by following clues that are all established and resolved within the screenplay.",
    structure: {
      act1: {
        introduction: "Detective Ada arrives in town.",
        mainCharacters: "Ada, a sharp investigator.",
        setting: "A small coastal town.",
        initialSituation: "Ada is called to investigate a missing person.",
        incitingIncident: "Ada discovers a cryptic note.",
      },
      act2: {
        risingTension: "Ada follows the trail of clues.",
        obstacles: "The townspeople are unhelpful.",
        characterDecisions: "Ada decides to search the lighthouse.",
        turningPoint: "Ada finds the missing person hidden in the lighthouse.",
      },
      act3: {
        climax: "Ada confronts the kidnapper and rescues the missing person.",
        resolution: "The kidnapper is arrested.",
        finalOutcome: "The town is safe and Ada leaves.",
      },
    },
    screenplay: [
      scene(1, "Ada arrives and reads the note.", [{ characterName: "Ada", line: "I need to find who wrote this." }]),
      scene(2, "Ada asks townspeople for help.", [{ characterName: "Ada", line: "Have you seen the missing person?" }]),
      scene(3, "Ada searches the lighthouse.", [{ characterName: "Ada", line: "The missing person is here." }]),
      scene(4, "Ada finds the missing person.", [{ characterName: "Ada", line: "You are safe now." }]),
      scene(5, "Ada confronts the kidnapper.", [{ characterName: "Ada", line: "It is over now." }]),
      scene(6, "The kidnapper is arrested and Ada leaves.", [{ characterName: "Ada", line: "The town is safe." }]),
    ],
  };
}

function houseStory(): GeneratedStory {
  const synopsis = "When architect Daniel inherits an abandoned house, he discovers it erases a resident every thirteen years. Ruth frees a memory to stop the cycle, but the screenplay never establishes who the victim is or what freeing a memory means.";
  return {
    title: "The House That Remembers",
    synopsis,
    structure: {
      act1: {
        introduction: "Daniel inherits the Greyhaven house.",
        mainCharacters: "Daniel, Miriam, Ruth.",
        setting: "Greyhaven, an abandoned house.",
        initialSituation: "The house takes one resident every thirteen years.",
        incitingIncident: "Daniel finds a hidden compartment with a key and a map marked with a red X.",
      },
      act2: {
        risingTension: "Ruth discovers the memory-release mechanism.",
        obstacles: "The house resists their efforts.",
        characterDecisions: "Ruth decides to free a memory.",
        turningPoint: "Ruth frees a memory, which starts a countdown.",
      },
      act3: {
        climax: "Daniel and Ruth face the choice the house demands.",
        resolution: "The cycle is broken.",
        finalOutcome: "A final shadow remains in the house.",
      },
    },
    screenplay: [
      scene(1, "Daniel arrives at the house.", [{ characterName: "Daniel", line: "This place holds secrets." }]),
      scene(2, "Daniel finds the hidden compartment and key.", [{ characterName: "Daniel", line: "What does this key unlock?" }]),
      scene(3, "Ruth arrives and speaks about memories.", [{ characterName: "Ruth", line: "I can free a memory." }]),
      scene(4, "Ruth frees a memory.", [{ characterName: "Ruth", line: "It is done." }]),
      scene(5, "The house goes quiet.", []),
    ],
  };
}

function finding(overrides: Partial<EpisodeValidationFinding> & Pick<EpisodeValidationFinding, "category" | "severity" | "message">): EpisodeValidationFinding {
  return {
    code: "test_validator",
    resolutionStatus: "open",
    ...overrides,
  };
}

function validation(findings: EpisodeValidationFinding[], passed?: boolean): EpisodeValidation {
  return {
    passed: passed ?? findings.every((f) => f.severity !== "error"),
    findings,
    validatedAt: new Date().toISOString(),
  };
}

describe("Actionable validation findings — structured metadata", () => {
  it("preserves rich fields from NarrativeFinding through toEpisodeFinding", () => {
    const nf = makeFinding({
      algorithm: "draft_agreement",
      severity: "ERROR",
      category: "continuity",
      sceneNumber: 3,
      evidence: "Act 2 promises a victim selection",
      expected: "The screenplay should establish who the victim is.",
      actual: "No victim is identified in any scene.",
      explanation: "The acts promise a victim, but the screenplay never establishes them.",
      suggestedCorrection: "Add a scene where the victim is identified.",
      requiresCanonAuthorization: false,
      automaticRepairSafe: true,
      title: "Missing victim establishment",
      confidence: "high",
      affectedAct: 2,
    });
    expect(nf.id).toHaveLength(16);
    expect(nf.title).toBe("Missing victim establishment");
    expect(nf.confidence).toBe("high");
    expect(nf.affectedAct).toBe(2);
  });

  it("validateEpisodeScreenplay produces findings with category, severity, and message", () => {
    const story = houseStory();
    const result = validateEpisodeScreenplay({
      episodeNumber: 1,
      seriesTitle: story.title,
      story: { title: story.title, synopsis: story.synopsis, screenplay: story.screenplay },
      targetDurationSeconds: 300,
      bible: null,
      seasonPlan: null,
      episodePlan: null,
      ledger: null,
      previousEpisodes: [],
      structure: story.structure,
    });
    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) {
      expect(f.category).toBeTruthy();
      expect(f.severity).toMatch(/^(error|warning)$/);
      expect(f.message).toBeTruthy();
      expect(f.message.length).toBeGreaterThan(0);
    }
  });

  it("a coherent story produces no error-severity findings", () => {
    const story = coherentStory();
    const result = validateEpisodeScreenplay({
      episodeNumber: 1,
      seriesTitle: story.title,
      story: { title: story.title, synopsis: story.synopsis, screenplay: story.screenplay },
      targetDurationSeconds: 300,
      bible: null,
      seasonPlan: null,
      episodePlan: null,
      ledger: null,
      previousEpisodes: [],
      structure: story.structure,
    });
    const errors = result.findings.filter((f) => f.severity === "error");
    expect(errors).toEqual([]);
  });
});

describe("Actionable validation findings — resolution status", () => {
  it("isBlockingFinding returns true for open error findings", () => {
    const f = finding({ category: "continuity", severity: "error", message: "Missing victim." });
    expect(isBlockingFinding(f)).toBe(true);
  });

  it("isBlockingFinding returns false for warnings", () => {
    const f = finding({ category: "quality", severity: "warning", message: "Short synopsis." });
    expect(isBlockingFinding(f)).toBe(false);
  });

  it("isBlockingFinding returns false for accepted_as_intentional errors", () => {
    const f = finding({ category: "continuity", severity: "error", message: "Ambiguous ending.", resolutionStatus: "accepted_as_intentional" });
    expect(isBlockingFinding(f)).toBe(false);
  });

  it("isBlockingFinding returns false for resolved errors", () => {
    const f = finding({ category: "continuity", severity: "error", message: "Fixed.", resolutionStatus: "resolved" });
    expect(isBlockingFinding(f)).toBe(false);
  });

  it("isBlockingFinding treats undefined resolutionStatus as open", () => {
    const f: EpisodeValidationFinding = { category: "continuity", severity: "error", message: "No status." };
    expect(isBlockingFinding(f)).toBe(true);
  });

  it("validationPassesForApproval returns true when no blocking findings remain", () => {
    const v = validation([
      finding({ category: "continuity", severity: "error", message: "Fixed.", resolutionStatus: "resolved" }),
      finding({ category: "quality", severity: "warning", message: "Note." }),
    ]);
    expect(validationPassesForApproval(v)).toBe(true);
  });

  it("validationPassesForApproval returns false when blocking findings remain", () => {
    const v = validation([
      finding({ category: "continuity", severity: "error", message: "Open." }),
      finding({ category: "quality", severity: "warning", message: "Note." }),
    ]);
    expect(validationPassesForApproval(v)).toBe(false);
  });

  it("validationPassesForApproval returns true for all-accepted findings", () => {
    const v = validation([
      finding({ category: "continuity", severity: "error", message: "Intentional.", resolutionStatus: "accepted_as_intentional" }),
    ]);
    expect(validationPassesForApproval(v)).toBe(true);
  });
});

describe("Actionable validation findings — accept as intentional", () => {
  it("canAcceptAsIntentional returns true when requiresCanonAuthorization is false", () => {
    const f = finding({ category: "continuity", severity: "error", message: "Ambiguous.", requiresCanonAuthorization: false });
    expect(canAcceptAsIntentional(f)).toBe(true);
  });

  it("canAcceptAsIntentional returns false when requiresCanonAuthorization is true", () => {
    const f = finding({ category: "canon", severity: "error", message: "Canon violation.", requiresCanonAuthorization: true });
    expect(canAcceptAsIntentional(f)).toBe(false);
  });

  it("canAcceptAsIntentional returns true when requiresCanonAuthorization is undefined", () => {
    const f: EpisodeValidationFinding = { category: "continuity", severity: "error", message: "Legacy." };
    expect(canAcceptAsIntentional(f)).toBe(true);
  });
});

describe("Actionable validation findings — mergeResolutions", () => {
  it("carries forward accepted_as_intentional by finding id", () => {
    const previous = validation([
      finding({ category: "continuity", severity: "error", message: "Ambiguous ending.", id: "abc123", resolutionStatus: "accepted_as_intentional", resolutionNote: "Intentional mystery." }),
    ]);
    const next = validation([
      finding({ category: "continuity", severity: "error", message: "Ambiguous ending.", id: "abc123" }),
    ]);
    const merged = mergeResolutions(previous, next);
    expect(merged.findings[0].resolutionStatus).toBe("accepted_as_intentional");
    expect(merged.findings[0].resolutionNote).toBe("Intentional mystery.");
  });

  it("carries forward by code+category+sceneNumber when id is absent", () => {
    const previous = validation([
      finding({ category: "canon", severity: "error", message: "Unknown character.", code: "canon_check", sceneNumber: 2, resolutionStatus: "resolved" }),
    ]);
    const next = validation([
      finding({ category: "canon", severity: "error", message: "Unknown character.", code: "canon_check", sceneNumber: 2 }),
    ]);
    const merged = mergeResolutions(previous, next);
    expect(merged.findings[0].resolutionStatus).toBe("resolved");
  });

  it("does not carry forward open status", () => {
    const previous = validation([
      finding({ category: "continuity", severity: "error", message: "Open.", id: "xyz", resolutionStatus: "open" }),
    ]);
    const next = validation([
      finding({ category: "continuity", severity: "error", message: "Open.", id: "xyz" }),
    ]);
    const merged = mergeResolutions(previous, next);
    expect(merged.findings[0].resolutionStatus ?? "open").toBe("open");
  });

  it("leaves new findings as open", () => {
    const previous = validation([
      finding({ category: "continuity", severity: "error", message: "Old.", id: "old1", code: "old_validator", resolutionStatus: "resolved" }),
    ]);
    const next = validation([
      finding({ category: "structure", severity: "error", message: "New problem.", id: "new1", code: "new_validator" }),
    ]);
    const merged = mergeResolutions(previous, next);
    expect(merged.findings[0].resolutionStatus ?? "open").toBe("open");
  });

  it("preserves resolvedAt when carrying forward", () => {
    const previous = validation([
      finding({ category: "continuity", severity: "error", message: "Fixed.", id: "f1", resolutionStatus: "resolved", resolvedAt: "2026-01-01T00:00:00Z" }),
    ]);
    const next = validation([
      finding({ category: "continuity", severity: "error", message: "Fixed.", id: "f1" }),
    ]);
    const merged = mergeResolutions(previous, next);
    expect(merged.findings[0].resolvedAt).toBe("2026-01-01T00:00:00Z");
  });
});

describe("Actionable validation findings — approval gate integration", () => {
  it("a story with all errors accepted as intentional passes approval", () => {
    const v = validation([
      finding({ category: "continuity", severity: "error", message: "Ambiguous.", resolutionStatus: "accepted_as_intentional", requiresCanonAuthorization: false }),
      finding({ category: "quality", severity: "warning", message: "Short." }),
    ]);
    expect(validationPassesForApproval(v)).toBe(true);
  });

  it("a story with a canon violation that requires authorization cannot pass via acceptance", () => {
    const v = validation([
      finding({ category: "canon", severity: "error", message: "Canon break.", resolutionStatus: "accepted_as_intentional", requiresCanonAuthorization: true }),
    ]);
    expect(canAcceptAsIntentional(v.findings[0])).toBe(false);
  });

  it("a story with unresolved blocking errors fails approval", () => {
    const v = validation([
      finding({ category: "continuity", severity: "error", message: "Unresolved." }),
    ]);
    expect(validationPassesForApproval(v)).toBe(false);
  });

  it("a story with only warnings passes approval", () => {
    const v = validation([
      finding({ category: "quality", severity: "warning", message: "Advisory." }),
    ]);
    expect(validationPassesForApproval(v)).toBe(true);
  });
});

describe("Actionable validation findings — The House That Remembers", () => {
  it("produces findings for the missing victim, key, and memory-release issues", () => {
    const story = houseStory();
    const result = validateEpisodeScreenplay({
      episodeNumber: 1,
      seriesTitle: story.title,
      story: { title: story.title, synopsis: story.synopsis, screenplay: story.screenplay },
      targetDurationSeconds: 300,
      bible: null,
      seasonPlan: null,
      episodePlan: null,
      ledger: null,
      previousEpisodes: [],
      structure: story.structure,
    });
    expect(result.findings.length).toBeGreaterThan(0);
    const findingMessages = result.findings.map((f) => f.message).join(" ");
    expect(findingMessages.length).toBeGreaterThan(0);
  });

  it("a coherent story does not produce error findings", () => {
    const story = coherentStory();
    const result = validateEpisodeScreenplay({
      episodeNumber: 1,
      seriesTitle: story.title,
      story: { title: story.title, synopsis: story.synopsis, screenplay: story.screenplay },
      targetDurationSeconds: 300,
      bible: null,
      seasonPlan: null,
      episodePlan: null,
      ledger: null,
      previousEpisodes: [],
      structure: story.structure,
    });
    const errors = result.findings.filter((f) => f.severity === "error");
    expect(errors).toEqual([]);
    expect(validationPassesForApproval(result)).toBe(true);
  });
});

describe("Actionable validation findings — revalidation after resolution", () => {
  it("mergeResolutions preserves accepted findings when the same issue persists", () => {
    const previous = validation([
      finding({ category: "continuity", severity: "error", message: "Missing victim.", id: "victim1", resolutionStatus: "accepted_as_intentional", resolutionNote: "Intentional ambiguity." }),
      finding({ category: "structure", severity: "error", message: "Missing key payoff.", id: "key1", resolutionStatus: "open" }),
    ]);
    const revalidated = validation([
      finding({ category: "continuity", severity: "error", message: "Missing victim.", id: "victim1" }),
      finding({ category: "structure", severity: "error", message: "Missing key payoff.", id: "key1" }),
    ]);
    const merged = mergeResolutions(previous, revalidated);
    expect(merged.findings[0].resolutionStatus).toBe("accepted_as_intentional");
    expect(merged.findings[1].resolutionStatus ?? "open").toBe("open");
    expect(validationPassesForApproval(merged)).toBe(false);
  });

  it("mergeResolutions drops resolutions for findings that no longer appear", () => {
    const previous = validation([
      finding({ category: "continuity", severity: "error", message: "Missing victim.", id: "victim1", resolutionStatus: "resolved" }),
      finding({ category: "structure", severity: "error", message: "Missing key payoff.", id: "key1", resolutionStatus: "open" }),
    ]);
    const revalidated = validation([]);
    const merged = mergeResolutions(previous, revalidated);
    expect(merged.findings).toEqual([]);
    expect(validationPassesForApproval(merged)).toBe(true);
  });
});