import { describe, expect, it } from "vitest";
import { createStoryDraftService } from "@/lib/services/storyDraftService";
import {
  stableFindingId,
  normalizeFindingIds,
  type EpisodeValidation,
  type EpisodeValidationFinding,
} from "@/lib/validation/casna";
import type { StoryRecord, StoryStructure, ScreenplayScene, GeneratedStory } from "@/lib/validation/story";
import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import type { RequestAuth } from "@/lib/auth/session";

const userId = "user_owner";
const projectId = "a".repeat(24);
const storyId = "b".repeat(24);
const now = new Date().toISOString();

const actor: RequestAuth = {
  userId,
  isAdmin: false,
  email: "",
  name: "",
  imageUrl: "",
};

function project(): ProjectRecord {
  return {
    id: projectId,
    title: "Test Drama",
    originalStoryIdea: "A test story.",
    genre: "thriller",
    language: "en",
    visualStyle: "naturalistic",
    tone: "serious",
    targetDurationSeconds: 300,
    aspectRatio: "16:9",
    status: "draft",
    workflowMode: "guided",
    productionType: "mystery_crime_thriller",
    productionMode: "standalone",
    sceneRange: { min: 6, max: 8 },
    createdAt: now,
    updatedAt: now,
  };
}

function scene(n: number): ScreenplayScene {
  return {
    sceneNumber: n,
    heading: "INT. ROOM - DAY",
    location: "Room",
    timeOfDay: "Day",
    charactersPresent: ["Ada"],
    visualDescription: "A quiet room.",
    action: "Ada enters and looks around.",
    dialogue: [{ characterName: "Ada", line: "What happened here?" }],
  };
}

function structure(): StoryStructure {
  return {
    act1: {
      introduction: "Ada arrives.",
      mainCharacters: "Ada is the protagonist.",
      setting: "A room.",
      initialSituation: "Ada enters.",
      incitingIncident: "She finds a clue.",
    },
    act2: {
      risingTension: "Ada investigates.",
      obstacles: "The truth is hidden.",
      characterDecisions: "Ada presses on.",
      turningPoint: "She discovers the secret.",
    },
    act3: {
      climax: "Ada confronts the truth.",
      resolution: "The secret is revealed.",
      finalOutcome: "Ada leaves changed.",
    },
  };
}

function generatedStory(): GeneratedStory {
  return {
    title: "Test Drama",
    synopsis: "Ada investigates a mystery and confronts the truth.",
    structure: structure(),
    screenplay: [scene(1)],
  };
}

function finding(
  overrides: Partial<EpisodeValidationFinding> &
    Pick<EpisodeValidationFinding, "category" | "severity" | "message">,
): EpisodeValidationFinding {
  return {
    code: "test_validator",
    resolutionStatus: "open",
    ...overrides,
  };
}

function validation(findings: EpisodeValidationFinding[]): EpisodeValidation {
  return {
    passed: findings.every((f) => f.severity !== "error"),
    findings,
    validatedAt: now,
  };
}

function draft(overrides: Partial<StoryRecord> = {}): StoryRecord {
  return {
    ...generatedStory(),
    id: storyId,
    clerkUserId: userId,
    projectId,
    productionRunId: null,
    status: "awaiting_approval",
    version: 1,
    provider: "stub",
    model: "stub",
    fallbackFrom: null,
    validationFindings: validation([]),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

type ResolveDeps = {
  findOwned?: () => StoryRecord | null;
  findProjectDraft?: () => StoryRecord | null;
  updateFindingResolution?: (
    findingId: string,
    resolution: { status: string; note?: string; resolvedAt: string },
  ) => StoryRecord | null;
  updateValidationFindings?: (v: EpisodeValidation) => StoryRecord | null;
};

function service(deps: ResolveDeps = {}) {
  const base = draft();
  return createStoryDraftService({
    projects: {
      async findOwned() {
        return project();
      },
      async update() {
        return project();
      },
    },
    stories: {
      async findOwned() {
        if (deps.findOwned) return deps.findOwned();
        return base;
      },
      async findProjectDraft() {
        if (deps.findProjectDraft) return deps.findProjectDraft();
        return base;
      },
      async markApproved() {
        return { ...base, status: "approved" as const };
      },
      async updateFindingResolution(
        _clerk: string,
        _storyId: string,
        findingId: string,
        resolution: { status: string; note?: string; resolvedAt: string },
      ) {
        return deps.updateFindingResolution?.(findingId, resolution) ?? null;
      },
      async updateValidationFindings(
        _clerk: string,
        _storyId: string,
        v: EpisodeValidation,
      ) {
        return deps.updateValidationFindings?.(v) ?? null;
      },
    },
    jobs: {
      async listByKeyPrefix() {
        return [];
      },
    },
    queueFactory: () => ({ async enqueue() {} }),
    bibles: {
      async findApproved() {
        return null;
      },
    },
    narrativeCanon: {
      async latest() {
        return null;
      },
      async commit(input: { expectedVersion: number; state: import("@/lib/validation/narrativeControl").CanonState }) {
        return { ...input.state, version: input.expectedVersion + 1 };
      },
    },
  } as never);
}

describe("finding resolution regression", () => {
  it("resolves a finding with a valid id", async () => {
    const f = finding({
      id: "abc123def456abcd",
      category: "continuity",
      severity: "error",
      message: "Character not introduced.",
    });
    const d = draft({ validationFindings: validation([f]) });
    const svc = service({
      findOwned: () => d,
      findProjectDraft: () => d,
      updateFindingResolution: (findingId, resolution) => ({
        ...d,
        validationFindings: {
          ...d.validationFindings!,
          findings: [
            {
              ...f,
              resolutionStatus: resolution.status as EpisodeValidationFinding["resolutionStatus"],
              resolvedAt: resolution.resolvedAt,
            },
          ],
        },
      }),
    });

    const result = await svc.resolveFinding(actor, projectId, storyId, {
      findingId: f.id!,
      status: "resolved",
    });

    expect(result.validationFindings?.findings[0]?.resolutionStatus).toBe("resolved");
    expect(result.validationFindings?.findings[0]?.id).toBe(f.id);
  });

  it("normalizes a legacy finding without an id via stableFindingId", async () => {
    const legacyFinding = finding({
      category: "continuity",
      severity: "error",
      message: "Character not introduced.",
      sceneNumber: 1,
    });
    const normalizedId = stableFindingId(
      legacyFinding.category,
      legacyFinding.message,
      legacyFinding.sceneNumber,
    );
    const normalized = normalizeFindingIds(validation([legacyFinding]));
    expect(normalized.findings[0]?.id).toBe(normalizedId);

    const d = draft({ validationFindings: normalized });
    const svc = service({
      findOwned: () => d,
      findProjectDraft: () => d,
      updateFindingResolution: (findingId, resolution) => ({
        ...d,
        validationFindings: {
          ...d.validationFindings!,
          findings: [
            {
              ...normalized.findings[0]!,
              resolutionStatus: resolution.status as EpisodeValidationFinding["resolutionStatus"],
              resolvedAt: resolution.resolvedAt,
            },
          ],
        },
      }),
    });

    const result = await svc.resolveFinding(actor, projectId, storyId, {
      findingId: normalizedId,
      status: "resolved",
    });

    expect(result.validationFindings?.findings[0]?.resolutionStatus).toBe("resolved");
  });

  it("rejects a synthetic React key as finding id with finding_not_found", async () => {
    const f = finding({
      id: "real_id_1234567",
      category: "continuity",
      severity: "error",
      message: "Character not introduced.",
      sceneNumber: 1,
    });
    const d = draft({ validationFindings: validation([f]) });
    const svc = service({
      findOwned: () => d,
      findProjectDraft: () => d,
    });

    await expect(
      svc.resolveFinding(actor, projectId, storyId, {
        findingId: "continuity:error:1:0",
        status: "resolved",
      }),
    ).rejects.toMatchObject({ code: "finding_not_found", status: 404 });
  });

  it("returns finding_not_found for an unknown finding id", async () => {
    const f = finding({
      id: "known_id_1234567",
      category: "continuity",
      severity: "error",
      message: "Character not introduced.",
    });
    const d = draft({ validationFindings: validation([f]) });
    const svc = service({
      findOwned: () => d,
      findProjectDraft: () => d,
    });

    await expect(
      svc.resolveFinding(actor, projectId, storyId, {
        findingId: "nonexistent_id_1",
        status: "resolved",
      }),
    ).rejects.toMatchObject({ code: "finding_not_found", status: 404 });
  });

  it("returns not_found for a missing story, not finding_not_found", async () => {
    const svc = service({
      findOwned: () => null,
    });

    await expect(
      svc.resolveFinding(actor, projectId, storyId, {
        findingId: "any_finding_id_",
        status: "resolved",
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("returns save_failed when repository cannot match the finding", async () => {
    const f = finding({
      id: "orphan_id_1234567",
      category: "continuity",
      severity: "error",
      message: "Character not introduced.",
    });
    const d = draft({ validationFindings: validation([f]) });
    const svc = service({
      findOwned: () => d,
      findProjectDraft: () => d,
      updateFindingResolution: () => null,
    });

    await expect(
      svc.resolveFinding(actor, projectId, storyId, {
        findingId: f.id!,
        status: "resolved",
      }),
    ).rejects.toMatchObject({ code: "save_failed", status: 500 });
  });

  it("preserves other findings and their resolution metadata", async () => {
    const f1 = finding({
      id: "finding_one_id_1",
      category: "continuity",
      severity: "error",
      message: "First issue.",
    });
    const f2 = finding({
      id: "finding_two_id_2",
      category: "completeness",
      severity: "warning",
      message: "Second issue.",
      resolutionStatus: "accepted_as_intentional",
      resolutionNote: "Intentional choice.",
      resolvedAt: "2026-01-01T00:00:00Z",
    });
    const d = draft({ validationFindings: validation([f1, f2]) });
    const svc = service({
      findOwned: () => d,
      findProjectDraft: () => d,
      updateFindingResolution: (findingId, resolution) => ({
        ...d,
        validationFindings: {
          ...d.validationFindings!,
          findings: d.validationFindings!.findings.map((f) =>
            f.id === findingId
              ? {
                  ...f,
                  resolutionStatus: resolution.status as EpisodeValidationFinding["resolutionStatus"],
                  resolvedAt: resolution.resolvedAt,
                }
              : f,
          ),
        },
      }),
    });

    const result = await svc.resolveFinding(actor, projectId, storyId, {
      findingId: f1.id!,
      status: "resolved",
    });

    const findings = result.validationFindings?.findings;
    expect(findings).toHaveLength(2);
    const resolved = findings?.find((f) => f.id === f1.id);
    const untouched = findings?.find((f) => f.id === f2.id);
    expect(resolved?.resolutionStatus).toBe("resolved");
    expect(untouched?.resolutionStatus).toBe("accepted_as_intentional");
    expect(untouched?.resolutionNote).toBe("Intentional choice.");
    expect(untouched?.resolvedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("revalidation produces findings that can subsequently be resolved", async () => {
    const d = draft({ validationFindings: null });
    let revalidated: StoryRecord | null = null;
    const svc = service({
      findOwned: () => revalidated ?? d,
      findProjectDraft: () => revalidated ?? d,
      updateValidationFindings: (v) => {
        revalidated = { ...d, validationFindings: v };
        return revalidated;
      },
      updateFindingResolution: (findingId, resolution) => {
        if (!revalidated) return null;
        return {
          ...revalidated,
          validationFindings: {
            ...revalidated.validationFindings!,
            findings: revalidated.validationFindings!.findings.map((f) =>
              f.id === findingId
                ? {
                    ...f,
                    resolutionStatus: resolution.status as EpisodeValidationFinding["resolutionStatus"],
                    resolvedAt: resolution.resolvedAt,
                  }
                : f,
            ),
          },
        };
      },
    });

    const revalidatedStory = await svc.revalidate(actor, projectId, storyId);
    const findings = revalidatedStory.validationFindings?.findings ?? [];
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.id).toBeTruthy();
      expect(f.id!.length).toBeGreaterThanOrEqual(1);
    }

    const target = findings[0]!;
    const result = await svc.resolveFinding(actor, projectId, storyId, {
      findingId: target.id!,
      status: "resolved",
    });

    const resolvedFinding = result.validationFindings?.findings.find((f) => f.id === target.id);
    expect(resolvedFinding?.resolutionStatus).toBe("resolved");
  });

  it("rejects a stale revision with stale_revision", async () => {
    const oldDraft = draft({
      id: "e".repeat(24),
      version: 1,
      validationFindings: validation([
        finding({
          id: "stale_finding_id",
          category: "continuity",
          severity: "error",
          message: "Old issue.",
        }),
      ]),
    });
    const newDraft = draft({
      id: "f".repeat(24),
      version: 2,
      validationFindings: validation([]),
    });
    const svc = service({
      findOwned: () => oldDraft,
      findProjectDraft: () => newDraft,
    });

    await expect(
      svc.resolveFinding(actor, projectId, oldDraft.id, {
        findingId: "stale_finding_id",
        status: "resolved",
      }),
    ).rejects.toMatchObject({ code: "stale_revision", status: 409 });
  });
});