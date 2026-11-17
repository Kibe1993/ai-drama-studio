import { createHash } from "node:crypto";
import { describeWorldRule, proposedIntervalConflict } from "@/lib/domain/narrativeControl/worldRules";
import type { EpisodeValidation } from "@/lib/validation/casna";
import type { GeneratedStory } from "@/lib/validation/story";
import { storyContractSchema, type ContractLayer, type StoryContract } from "@/lib/validation/storyContract";

const LOSS = /\b(disappears?|disappearances?|erases?|erased|vanishes?|vanished|sacrifice|sacrifices)\b|\btakes?\b[^.?!]{0,40}\b(resident|person|people|someone|victim|life|lives|memory|memories)\b/i;

/**
 * Hash the draft the contract was built from. Approval rejects a contract
 * whose hash does not match the draft being approved.
 */
export function hashStoryDraft(story: Pick<GeneratedStory, "title" | "synopsis" | "structure" | "screenplay">): string {
  const body = JSON.stringify({
    title: story.title,
    synopsis: story.synopsis,
    structure: story.structure,
    screenplay: story.screenplay.map((scene) => ({
      sceneNumber: scene.sceneNumber,
      heading: scene.heading,
      location: scene.location,
      action: scene.action,
      visualDescription: scene.visualDescription,
      dialogue: scene.dialogue.map((line) => `${line.characterName}: ${line.line}`),
    })),
  });
  return createHash("sha256").update(body).digest("hex");
}

export function deriveStoryContract(input: {
  story: GeneratedStory;
  validation: EpisodeValidation;
  creatorIdea?: string;
  semantic: ContractLayer;
}): StoryContract {
  const idea = input.creatorIdea ?? "";
  const premise = [input.story.synopsis, input.story.structure.act2.risingTension, input.story.structure.act3.resolution].join(" ");
  const screenplay = input.story.screenplay.map((scene) => [scene.action, ...scene.dialogue.map((line) => line.line)].join(" ")).join("\n");
  const names = new Map<string, { source: string; evidence: string }>();
  for (const scene of input.story.screenplay) {
    for (const name of scene.charactersPresent) {
      if (!names.has(name)) {
        names.set(name, { source: `story.screenplay.scene${scene.sceneNumber}`, evidence: scene.action.slice(0, 180) });
      }
    }
  }
  const described = describeWorldRule(premise);
  const rules = LOSS.test(premise) && (described.canonicalInterval || /\bevery\b/i.test(premise))
    ? [{
        description: premise.match(/[^.?!]*\bevery\b[^.?!]*/i)?.[0]?.trim().slice(0, 400) || premise.slice(0, 400),
        intervalCount: described.canonicalInterval?.count ?? null,
        intervalUnit: described.canonicalInterval?.unit ?? null,
        approvalStatus: "proposed" as const,
        source: "story.synopsis",
        evidence: premise.slice(0, 240),
      }]
    : [];
  const beats: { description: string; source: string }[] = [
    { description: input.story.structure.act1.incitingIncident, source: "story.structure.act1.incitingIncident" },
    { description: input.story.structure.act2.turningPoint, source: "story.structure.act2.turningPoint" },
    { description: input.story.structure.act3.climax, source: "story.structure.act3.climax" },
    { description: input.story.structure.act3.resolution, source: "story.structure.act3.resolution" },
  ];
  const contract = {
    version: 1 as const,
    status: "provisional" as const,
    draftHash: hashStoryDraft(input.story),
    layers: layerReport(input.validation, input.semantic),
    characters: [...names.entries()].slice(0, 40).map(([name, item]) => ({
      name,
      role: idea.toLocaleLowerCase().includes(name.toLocaleLowerCase()) ? "creator" as const : "proposed" as const,
      source: item.source,
      evidence: item.evidence,
    })),
    rules,
    events: beats.map((beat) => ({
      description: beat.description.slice(0, 400),
      sceneNumber: sceneFor(input.story, beat.description),
      source: beat.source,
      evidence: beat.description.slice(0, 240),
      dramatized: sceneFor(input.story, beat.description) != null,
    })),
    scenes: input.story.screenplay.map((scene) => ({
      sceneNumber: scene.sceneNumber,
      location: scene.location,
      characters: scene.charactersPresent,
      purpose: scene.heading.slice(0, 240),
      outcome: scene.action.slice(0, 400),
    })),
  };
  return storyContractSchema.parse(contract);
}

export function contractMatchesDraft(contract: StoryContract, story: Pick<GeneratedStory, "title" | "synopsis" | "structure" | "screenplay">): boolean {
  return contract.draftHash === hashStoryDraft(story);
}

function sceneFor(story: GeneratedStory, beat: string): number | null {
  const words = beat.toLocaleLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 6);
  if (words.length === 0) return null;
  const scene = story.screenplay.find((item) => {
    const text = `${item.action} ${item.dialogue.map((line) => line.line).join(" ")}`.toLocaleLowerCase();
    const hits = words.filter((word) => text.includes(word));
    return hits.length >= Math.min(2, words.length);
  });
  return scene?.sceneNumber ?? null;
}

export function bibleBreaksContract(rules: string[], contract: StoryContract): string | null {
  for (const rule of contract.rules) {
    const conflict = proposedIntervalConflict(rule.description, rules.join("\n"));
    if (conflict) return conflict.proposed;
  }
  return null;
}

function layerReport(validation: EpisodeValidation, semantic: ContractLayer): StoryContract["layers"] {
  const errors = validation.findings.filter((finding) => finding.severity === "error");
  const has = (codes: string[]) => errors.some((finding) => codes.includes(finding.code ?? "") || codes.includes(finding.category));
  return {
    structural: has(["scene_count", "scene_action", "completeness"]) ? "failed" : "passed",
    agreement: has(["draft_agreement", "draft_mechanism", "draft_choice", "agreement", "continuity"]) ? "failed" : "passed",
    worldRules: has(["world_rules"]) ? "failed" : "passed",
    knowledge: has(["knowledge", "implication"])
      ? "failed"
      : validation.narrativeValidationLayers?.includes("deterministic")
        ? "passed"
        : "not_executed",
    causal: has(["draft_causality", "causal"]) ? "failed" : "passed",
    semantic,
  };
}
