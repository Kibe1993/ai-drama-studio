import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { RichValidationFinding } from "@/lib/validation/seasonPlanValidation";
import type { CanonicalEntityRegistry } from "@/lib/validation/canonicalRegistry";
import { makeFindingId } from "@/lib/validation/seasonPlanValidation";
import { resolveCanonicalId, isIntroducedBy, hasAppearedBy, hasSupportedExplanation } from "@/lib/domain/canonicalRegistry";

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function isPlaceholder(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 5) return true;
  if (/^(todo|tbd|placeholder|n\/a|none|null|undefined|lorem ipsum|xxx+)$/.test(t)) return true;
  if (/^\[.*\]$/.test(t)) return true;
  if (/^<.*>$/.test(t)) return true;
  return false;
}

export function validateSeasonStructure(
  plan: SeasonPlan,
  expectedEpisodeCount?: number,
): RichValidationFinding[] {
  const findings: RichValidationFinding[] = [];
  const episodes = plan.episodeProgression;

  if (expectedEpisodeCount && episodes.length !== expectedEpisodeCount) {
    findings.push({
      findingId: makeFindingId("struct"),
      category: "structural",
      severity: "blocking",
      message: `The season plan has ${episodes.length} episode${episodes.length === 1 ? "" : "s"} but the project specifies ${expectedEpisodeCount}.`,
      explanation: "The number of episodes must match the project's configured episode count.",
      whyItMatters: "An incomplete or over-complete plan cannot drive correct episode generation.",
      recommendation: `Regenerate the plan with exactly ${expectedEpisodeCount} episodes.`,
      requiresHumanReview: false,
      source: "deterministic",
    });
  }

  if (episodes.length === 0) {
    findings.push({
      findingId: makeFindingId("struct"),
      category: "structural",
      severity: "blocking",
      message: "The season plan has no episodes.",
      recommendation: "Regenerate the plan with at least one episode.",
      requiresHumanReview: false,
      source: "deterministic",
    });
    return findings;
  }

  const seenNumbers = new Set<number>();
  const seenTitles = new Set<string>();
  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i]!;
    const expectedNum = i + 1;

    if (seenNumbers.has(ep.episodeNumber)) {
      findings.push({
        findingId: makeFindingId("struct"),
        category: "episode_indexing",
        severity: "blocking",
        episodeNumber: ep.episodeNumber,
        message: `Episode number ${ep.episodeNumber} is duplicated.`,
        recommendation: "Assign a unique episode number to each episode.",
        requiresHumanReview: false,
        source: "deterministic",
      });
    }
    seenNumbers.add(ep.episodeNumber);

    if (ep.episodeNumber !== expectedNum) {
      findings.push({
        findingId: makeFindingId("struct"),
        category: "episode_indexing",
        severity: "blocking",
        episodeNumber: ep.episodeNumber,
        message: `Episode ${ep.episodeNumber} is out of sequence; expected position ${expectedNum}.`,
        recommendation: `Reorder episodes so episode ${expectedNum} is at position ${expectedNum}.`,
        requiresHumanReview: false,
        source: "deterministic",
      });
    }

    const normTitle = normalize(ep.workingTitle);
    if (seenTitles.has(normTitle)) {
      findings.push({
        findingId: makeFindingId("struct"),
        category: "episode_differentiation",
        severity: "high",
        episodeNumber: ep.episodeNumber,
        message: `Episode ${ep.episodeNumber} has the same working title as an earlier episode.`,
        recommendation: "Give each episode a distinct working title.",
        requiresHumanReview: false,
        source: "deterministic",
      });
    }
    seenTitles.add(normTitle);

    const requiredFields: Array<[keyof EpisodePlanItem, string]> = [
      ["workingTitle", "working title"],
      ["narrativePurpose", "narrative purpose"],
      ["startingSituation", "starting situation"],
      ["mainObjective", "main objective"],
      ["centralConflict", "central conflict"],
      ["storyContribution", "story contribution"],
      ["endingOrCliffhanger", "ending or cliffhanger"],
      ["continuityRequirements", "continuity requirements"],
      ["characterDevelopment", "character development"],
    ];
    for (const [field, label] of requiredFields) {
      const value = String(ep[field] ?? "").trim();
      if (isPlaceholder(value)) {
        findings.push({
          findingId: makeFindingId("struct"),
          category: "structural",
          severity: "blocking",
          episodeNumber: ep.episodeNumber,
          affectedField: String(field),
          message: `Episode ${ep.episodeNumber} is missing meaningful ${label}.`,
          explanation: `The ${label} field is empty, too short, or contains a placeholder.`,
          whyItMatters: "Every episode must have complete narrative content to drive screenplay generation.",
          recommendation: `Provide a substantive ${label} for episode ${ep.episodeNumber}.`,
          requiresHumanReview: false,
          source: "deterministic",
        });
      }
    }

    if (ep.majorStoryBeats.length === 0) {
      findings.push({
        findingId: makeFindingId("struct"),
        category: "structural",
        severity: "high",
        episodeNumber: ep.episodeNumber,
        affectedField: "majorStoryBeats",
        message: `Episode ${ep.episodeNumber} has no story beats.`,
        recommendation: "Add at least one major story beat.",
        requiresHumanReview: false,
        source: "deterministic",
      });
    }
  }

  return findings;
}

export function validateReferenceIntegrity(
  plan: SeasonPlan,
  bible: StoryBibleContent | null,
  registry?: CanonicalEntityRegistry,
): RichValidationFinding[] {
  const findings: RichValidationFinding[] = [];
  if (!bible) return findings;

  const bibleCharNames = new Set(
    bible.characters.characters.map((c) => normalize(c.name))
  );
  const bibleLocationNames = new Set(
    bible.world.geographyAndLocations.map((l) => normalize(l.name))
  );

  for (const ep of plan.episodeProgression) {
    const mentionedInEp = new Set<string>();
    const allText = [
      ep.characterDevelopment,
      ep.startingSituation,
      ep.mainObjective,
      ep.centralConflict,
      ep.endingOrCliffhanger,
      ...ep.majorStoryBeats,
      ...ep.importantEvents,
      ...ep.informationRevealed,
    ].join(" ");

    for (const char of bible.characters.characters) {
      const normName = normalize(char.name);
      if (allText.toLowerCase().includes(normName)) {
        mentionedInEp.add(normName);
      }
    }

    for (const arc of ep.characterArcChanges) {
      const normName = normalize(arc.name);
      if (!bibleCharNames.has(normName)) {
        let isIntroduced = false;
        if (registry) {
          const canonicalId = resolveCanonicalId(registry, arc.name, "character");
          if (canonicalId) {
            isIntroduced = isIntroducedBy(registry, canonicalId, ep.episodeNumber);
          }
        } else {
          isIntroduced = ep.characterDevelopment.toLowerCase().includes("introduce") &&
            allText.toLowerCase().includes(normName);
        }
        if (!isIntroduced) {
          findings.push({
            findingId: makeFindingId("ref"),
            category: "unknown_entity_reference",
            severity: "high",
            episodeNumber: ep.episodeNumber,
            affectedField: "characterArcChanges",
            message: `Episode ${ep.episodeNumber} references character "${arc.name}" who is not in the Story Bible.`,
            canonIssueType: "UNKNOWN_ENTITY_REFERENCE",
            explanation: `The character "${arc.name}" appears in characterArcChanges but is not established in the approved Story Bible.`,
            whyItMatters: "Referencing unknown characters can lead to inconsistent character identities across episodes.",
            recommendation: `Either add "${arc.name}" to the Story Bible or use an established character name.`,
            requiresHumanReview: true,
            source: "deterministic",
          });
        }
      } else if (registry) {
        const canonicalId = resolveCanonicalId(registry, arc.name, "character");
        if (canonicalId && !hasAppearedBy(registry, canonicalId, ep.episodeNumber)) {
          if (!hasSupportedExplanation(allText)) {
            const firstApp = registry.lifecycles.find((lc) => lc.canonicalId === canonicalId)?.firstAppearanceEpisode;
            if (firstApp && firstApp > ep.episodeNumber) {
              findings.push({
                findingId: makeFindingId("ref"),
                category: "unknown_entity_reference",
                severity: "medium",
                episodeNumber: ep.episodeNumber,
                affectedField: "characterArcChanges",
                message: `Episode ${ep.episodeNumber} references character "${arc.name}" before their planned introduction in episode ${firstApp}.`,
                canonIssueType: "UNKNOWN_ENTITY_REFERENCE",
                explanation: `The character "${arc.name}" is first introduced in episode ${firstApp} but is referenced earlier without a supported explanation (flashback, foreshadowing, etc.).`,
                whyItMatters: "Pre-introduction references without narrative justification break continuity.",
                recommendation: `Add a flashback, foreshadowing, or other explicit explanation for the early reference.`,
                requiresHumanReview: false,
                source: "deterministic",
              });
            }
          }
        }
      }
    }

    for (const rel of ep.relationshipChanges) {
      const normFrom = normalize(rel.from);
      const normTo = normalize(rel.to);
      if (!bibleCharNames.has(normFrom)) {
        let isIntroduced = false;
        if (registry) {
          const canonicalId = resolveCanonicalId(registry, rel.from, "character");
          if (canonicalId) {
            isIntroduced = isIntroducedBy(registry, canonicalId, ep.episodeNumber);
          }
        }
        if (!isIntroduced) {
          findings.push({
            findingId: makeFindingId("ref"),
            category: "unknown_entity_reference",
            severity: "high",
            episodeNumber: ep.episodeNumber,
            affectedField: "relationshipChanges",
            message: `Episode ${ep.episodeNumber} relationship change references unknown character "${rel.from}".`,
            canonIssueType: "UNKNOWN_ENTITY_REFERENCE",
            recommendation: `Use an established character name from the Story Bible.`,
            requiresHumanReview: true,
            source: "deterministic",
          });
        }
      }
      if (!bibleCharNames.has(normTo)) {
        let isIntroduced = false;
        if (registry) {
          const canonicalId = resolveCanonicalId(registry, rel.to, "character");
          if (canonicalId) {
            isIntroduced = isIntroducedBy(registry, canonicalId, ep.episodeNumber);
          }
        }
        if (!isIntroduced) {
          findings.push({
            findingId: makeFindingId("ref"),
            category: "unknown_entity_reference",
            severity: "high",
            episodeNumber: ep.episodeNumber,
            affectedField: "relationshipChanges",
            message: `Episode ${ep.episodeNumber} relationship change references unknown character "${rel.to}".`,
            canonIssueType: "UNKNOWN_ENTITY_REFERENCE",
            recommendation: `Use an established character name from the Story Bible.`,
            requiresHumanReview: true,
            source: "deterministic",
          });
        }
      }
    }

    for (const loc of ep.locationChanges) {
      const normName = normalize(loc.name);
      if (!bibleLocationNames.has(normName)) {
        let isIntroduced = false;
        if (registry) {
          const canonicalId = resolveCanonicalId(registry, loc.name, "location");
          if (canonicalId) {
            isIntroduced = isIntroducedBy(registry, canonicalId, ep.episodeNumber);
          }
        } else {
          isIntroduced = loc.change.toLowerCase().includes("introduce") ||
            loc.change.toLowerCase().includes("discover") ||
            loc.change.toLowerCase().includes("new");
        }
        if (!isIntroduced) {
          findings.push({
            findingId: makeFindingId("ref"),
            category: "unknown_entity_reference",
            severity: "medium",
            episodeNumber: ep.episodeNumber,
            affectedField: "locationChanges",
            message: `Episode ${ep.episodeNumber} references location "${loc.name}" not established in the Story Bible.`,
            canonIssueType: "UNKNOWN_ENTITY_REFERENCE",
            recommendation: `Either add "${loc.name}" to the Story Bible world or mark it as a new location introduction.`,
            requiresHumanReview: false,
            source: "deterministic",
          });
        }
      } else if (registry) {
        const canonicalId = resolveCanonicalId(registry, loc.name, "location");
        if (canonicalId && !hasAppearedBy(registry, canonicalId, ep.episodeNumber)) {
          if (!hasSupportedExplanation(allText)) {
            const firstApp = registry.lifecycles.find((lc) => lc.canonicalId === canonicalId)?.firstAppearanceEpisode;
            if (firstApp && firstApp > ep.episodeNumber) {
              findings.push({
                findingId: makeFindingId("ref"),
                category: "unknown_entity_reference",
                severity: "medium",
                episodeNumber: ep.episodeNumber,
                affectedField: "locationChanges",
                message: `Episode ${ep.episodeNumber} visits location "${loc.name}" before its planned introduction in episode ${firstApp}.`,
                canonIssueType: "UNKNOWN_ENTITY_REFERENCE",
                explanation: `The location "${loc.name}" is first introduced in episode ${firstApp} but is visited earlier without a supported explanation.`,
                whyItMatters: "Pre-introduction visits without narrative justification break continuity.",
                recommendation: `Add a flashback or other explicit explanation for the early visit.`,
                requiresHumanReview: false,
                source: "deterministic",
              });
            }
          }
        }
      }
    }

    for (const obj of ep.objectChanges) {
      const normName = normalize(obj.name);
      const isIntroduced = obj.condition.toLowerCase().includes("introduce") ||
        obj.condition.toLowerCase().includes("discover") ||
        obj.condition.toLowerCase().includes("find") ||
        obj.condition.toLowerCase().includes("new");
      if (!isIntroduced) {
        const mentionedEarlier = plan.episodeProgression
          .filter((e) => e.episodeNumber < ep.episodeNumber)
          .some((e) =>
            e.objectChanges.some((o) => normalize(o.name) === normName) ||
            e.importantEvents.some((ev) => ev.toLowerCase().includes(normName)) ||
            e.informationRevealed.some((r) => r.toLowerCase().includes(normName))
          );
        if (!mentionedEarlier) {
          findings.push({
            findingId: makeFindingId("ref"),
            category: "unknown_entity_reference",
            severity: "medium",
            episodeNumber: ep.episodeNumber,
            affectedField: "objectChanges",
            message: `Episode ${ep.episodeNumber} uses object "${obj.name}" without prior introduction.`,
            canonIssueType: "UNKNOWN_ENTITY_REFERENCE",
            explanation: `The object "${obj.name}" appears in objectChanges but was not introduced in the Story Bible or earlier episodes.`,
            whyItMatters: "Objects appearing without introduction break narrative continuity.",
            recommendation: `Introduce "${obj.name}" in an earlier episode or in the Story Bible.`,
            requiresHumanReview: false,
            source: "deterministic",
          });
        }
      }
    }
  }

  return findings;
}

const RELATIONSHIP_KEYWORDS = {
  parent: ["father", "mother", "parent", "dad", "mom", "papa", "mama"],
  child: ["son", "daughter", "child", "kid"],
  sibling: ["brother", "sister", "sibling"],
  spouse: ["husband", "wife", "spouse", "married"],
} as const;

function detectRelationshipType(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [type, keywords] of Object.entries(RELATIONSHIP_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return type;
    }
  }
  return null;
}

export function validateRelationshipIntegrity(
  plan: SeasonPlan,
  bible: StoryBibleContent | null,
): RichValidationFinding[] {
  const findings: RichValidationFinding[] = [];
  if (!bible) return findings;

  const bibleRelationships: Array<{
    from: string;
    to: string;
    type: string | null;
    raw: string;
  }> = [];
  for (const char of bible.characters.characters) {
    for (const rel of char.relationships) {
      bibleRelationships.push({
        from: normalize(char.name),
        to: normalize(rel.characterName),
        type: detectRelationshipType(rel.relationship),
        raw: rel.relationship,
      });
    }
  }

  for (const ep of plan.episodeProgression) {
    for (const relChange of ep.relationshipChanges) {
      const fromName = normalize(relChange.from);
      const toName = normalize(relChange.to);
      const changeType = detectRelationshipType(relChange.change);

      if (!changeType) continue;

      for (const bibleRel of bibleRelationships) {
        if (bibleRel.type === "parent" && changeType === "child" &&
            bibleRel.from === fromName && bibleRel.to === toName) {
          continue;
        }
        if (bibleRel.type === "child" && changeType === "parent" &&
            bibleRel.from === fromName && bibleRel.to === toName) {
          findings.push({
            findingId: makeFindingId("rel"),
            category: "relationship_integrity",
            severity: "blocking",
            episodeNumber: ep.episodeNumber,
            affectedField: "relationshipChanges",
            message: `Episode ${ep.episodeNumber} describes ${relChange.from} as the ${changeType} of ${relChange.to}, but the Story Bible establishes ${relChange.from} as the ${bibleRel.type} of ${relChange.to}.`,
            canonIssueType: "RELATIONSHIP_CONTRADICTION",
            explanation: `Bible: "${bibleRel.from} is the ${bibleRel.type} of ${bibleRel.to}". Plan: "${relChange.from} is described as the ${changeType} of ${relChange.to}".`,
            whyItMatters: "Reversed parent-child relationships are fundamental canon contradictions.",
            recommendation: `Correct the relationship in episode ${ep.episodeNumber} to match the Story Bible.`,
            evidence: [bibleRel.raw, relChange.change],
            requiresHumanReview: true,
            source: "deterministic",
          });
        }
        if (bibleRel.type === "parent" && changeType === "child" &&
            bibleRel.to === fromName && bibleRel.from === toName) {
          continue;
        }
        if (bibleRel.type === "child" && changeType === "parent" &&
            bibleRel.to === fromName && bibleRel.from === toName) {
          continue;
        }
      }

      const changeLower = relChange.change.toLowerCase();
      if (/\b(son|daughter)\b/.test(changeLower)) {
        for (const bibleRel of bibleRelationships) {
          if (bibleRel.type === "parent" &&
              bibleRel.to === fromName &&
              bibleRel.from === toName) {
            continue;
          }
          if (bibleRel.type === "child" &&
              bibleRel.from === fromName &&
              bibleRel.to === toName) {
            findings.push({
              findingId: makeFindingId("rel"),
              category: "relationship_integrity",
              severity: "blocking",
              episodeNumber: ep.episodeNumber,
              affectedField: "relationshipChanges",
              message: `Episode ${ep.episodeNumber} describes ${relChange.from} as a child (son/daughter) of ${relChange.to}, but the Story Bible establishes the opposite: ${bibleRel.from} is the child of ${bibleRel.to}.`,
              canonIssueType: "RELATIONSHIP_CONTRADICTION",
              explanation: `The parent-child relationship is reversed in episode ${ep.episodeNumber}.`,
              whyItMatters: "Reversed parent-child relationships are fundamental canon contradictions.",
              recommendation: `Correct the relationship to match the Story Bible.`,
              evidence: [bibleRel.raw, relChange.change],
              requiresHumanReview: true,
              source: "deterministic",
            });
          }
        }
      }
    }
  }

  return findings;
}

export function validateEpisodeIndexing(plan: SeasonPlan): RichValidationFinding[] {
  const findings: RichValidationFinding[] = [];
  const episodes = plan.episodeProgression;

  if (episodes.length > 0) {
    const first = episodes[0]!;
    if (first.episodeNumber !== 1) {
      findings.push({
        findingId: makeFindingId("idx"),
        category: "episode_indexing",
        severity: "blocking",
        episodeNumber: first.episodeNumber,
        message: `The first episode is numbered ${first.episodeNumber}; episode 1 must be the opening episode.`,
        recommendation: "Renumber episodes starting from 1.",
        requiresHumanReview: false,
        source: "deterministic",
      });
    }
  }

  for (let i = 1; i < episodes.length; i++) {
    const prev = episodes[i - 1]!;
    const curr = episodes[i]!;
    if (curr.episodeNumber <= prev.episodeNumber) {
      findings.push({
        findingId: makeFindingId("idx"),
        category: "episode_indexing",
        severity: "blocking",
        episodeNumber: curr.episodeNumber,
        message: `Episode ${curr.episodeNumber} does not follow episode ${prev.episodeNumber} in sequence.`,
        recommendation: "Ensure episodes are in ascending order.",
        requiresHumanReview: false,
        source: "deterministic",
      });
    }
  }

  if (episodes.length > 1) {
    const finale = episodes[episodes.length - 1]!;
    const earlyEpisodes = episodes.slice(0, Math.max(1, Math.floor(episodes.length / 3)));
    const finaleText = normalize(finale.endingOrCliffhanger + " " + finale.centralConflict);
    for (const early of earlyEpisodes) {
      const earlyText = normalize(early.endingOrCliffhanger + " " + early.centralConflict);
      if (earlyText.length > 50 && finaleText.length > 50) {
        const earlyWords = new Set(earlyText.split(/\s+/).filter((w) => w.length > 4));
        const finaleWords = new Set(finaleText.split(/\s+/).filter((w) => w.length > 4));
        let overlap = 0;
        for (const w of earlyWords) if (finaleWords.has(w)) overlap += 1;
        const ratio = overlap / Math.max(earlyWords.size, finaleWords.size);
        if (ratio > 0.6 && early.episodeNumber !== finale.episodeNumber) {
          findings.push({
            findingId: makeFindingId("idx"),
            category: "episode_indexing",
            severity: "medium",
            episodeNumber: early.episodeNumber,
            message: `Early episode ${early.episodeNumber} closely resembles the season finale (episode ${finale.episodeNumber}).`,
            explanation: "The season finale should not be treated as an ordinary early episode.",
            recommendation: "Differentiate early episodes from the finale.",
            requiresHumanReview: false,
            source: "deterministic",
          });
        }
      }
    }
  }

  return findings;
}