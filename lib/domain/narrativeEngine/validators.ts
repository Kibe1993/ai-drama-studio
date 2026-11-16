import type {
  NarrativeRegistry,
  NarrativeValidationFinding,
  EntityId,
} from "@/lib/validation/narrativeEngine";
import {
  normalizeEntityName,
  resolveEntity,
  audienceKnowsFact,
  getEntityLifecycleAtEpisode,

} from "@/lib/validation/narrativeEngine";

function finding(
  code: string,
  severity: "error" | "warning" | "info",
  episode: number,
  message: string,
  extras?: Partial<NarrativeValidationFinding>,
): NarrativeValidationFinding {
  return { code, severity, episode, message, ...extras };
}

export function validateCanonicalIdentities(registry: NarrativeRegistry): NarrativeValidationFinding[] {
  const findings: NarrativeValidationFinding[] = [];
  const seenNormalized = new Map<string, EntityId>();

  for (const entity of registry.entities) {
    const normalized = normalizeEntityName(entity.canonicalName);
    const existing = seenNormalized.get(normalized);
    if (existing && existing !== entity.id) {
      findings.push(finding(
        "DUPLICATE_CANONICAL_IDENTITY",
        "error",
        entity.firstAppearanceEpisode ?? 1,
        `Entities "${entity.canonicalName}" and another entity share the same normalized name.`,
        { entityId: entity.id, evidence: `Normalized: "${normalized}"` },
      ));
    }
    seenNormalized.set(normalized, entity.id);

    for (const alias of entity.aliases) {
      const aliasEntity = resolveEntity(alias.value, registry);
      if (aliasEntity && aliasEntity.id !== entity.id) {
        findings.push(finding(
          "ALIAS_CONFLICT",
          "error",
          entity.firstAppearanceEpisode ?? 1,
          `Alias "${alias.value}" resolves to both "${entity.canonicalName}" and "${aliasEntity.canonicalName}".`,
          { entityId: entity.id, evidence: `Alias "${alias.value}" is ambiguous` },
        ));
      }
    }
  }

  return findings;
}

export function validateEntityLifecycles(registry: NarrativeRegistry): NarrativeValidationFinding[] {
  const findings: NarrativeValidationFinding[] = [];

  for (const entity of registry.entities) {
    if (entity.type !== "character" && entity.type !== "location") continue;

    const firstIntro = entity.firstIntroductionEpisode;
    const firstApp = entity.firstAppearanceEpisode;

    if (firstApp !== undefined && firstIntro !== undefined && firstApp < firstIntro) {
      findings.push(finding(
        "APPEARANCE_BEFORE_INTRODUCTION",
        "error",
        firstApp,
        `Entity "${entity.canonicalName}" appears in episode ${firstApp} but is introduced in episode ${firstIntro}.`,
        { entityId: entity.id, sourceEpisode: firstApp, expectedEpisode: firstIntro },
      ));
    }

    for (const event of registry.events) {
      if (event.participants.includes(entity.id)) {
        const status = getEntityLifecycleAtEpisode(registry, entity.id, event.episode);
        if (status === "not_introduced" && event.type !== "arrival") {
          const hasForeshadowing = event.description.toLowerCase().includes("foreshadow") ||
            event.description.toLowerCase().includes("hint") ||
            event.description.toLowerCase().includes("mention");
          if (!hasForeshadowing) {
            findings.push(finding(
              "UNEXPLAINED_PRE_INTRODUCTION_REFERENCE",
              "error",
              event.episode,
              `Entity "${entity.canonicalName}" is referenced in episode ${event.episode} before its introduction.`,
              { entityId: entity.id, eventId: event.id, evidence: event.description.slice(0, 100) },
            ));
          }
        }
      }
    }

    if (entity.lifecycle === "deceased") {
      for (const event of registry.events) {
        if (event.participants.includes(entity.id) && event.type !== "death") {
          const isFlashback = event.description.toLowerCase().includes("flashback") ||
            event.description.toLowerCase().includes("memory") ||
            event.description.toLowerCase().includes("recording") ||
            event.description.toLowerCase().includes("dream");
          if (!isFlashback && firstApp !== undefined && event.episode > firstApp) {
            findings.push(finding(
              "DECEASED_ENTITY_ACTIVE",
              "warning",
              event.episode,
              `Deceased entity "${entity.canonicalName}" appears in episode ${event.episode} without flashback/recording context.`,
              { entityId: entity.id, eventId: event.id },
            ));
          }
        }
      }
    }
  }

  return findings;
}

export function validateEventChronology(registry: NarrativeRegistry): NarrativeValidationFinding[] {
  const findings: NarrativeValidationFinding[] = [];

  for (const event of registry.events) {
    if (event.audienceRevealEpisode !== undefined && event.audienceRevealEpisode < event.episode) {
      findings.push(finding(
        "AUDIENCE_REVEAL_BEFORE_EVENT",
        "error",
        event.audienceRevealEpisode,
        `Event "${event.description.slice(0, 60)}" is revealed to the audience in episode ${event.audienceRevealEpisode} but occurs in episode ${event.episode}.`,
        { eventId: event.id, sourceEpisode: event.audienceRevealEpisode, expectedEpisode: event.episode },
      ));
    }
  }

  for (let i = 0; i < registry.events.length; i++) {
    for (let j = i + 1; j < registry.events.length; j++) {
      const a = registry.events[i]!;
      const b = registry.events[j]!;
      if (a.occurrenceOrder !== undefined && b.occurrenceOrder !== undefined &&
        a.occurrenceOrder === b.occurrenceOrder && a.id !== b.id) {
        findings.push(finding(
          "DUPLICATE_OCCURRENCE_ORDER",
          "warning",
          a.episode,
          `Events "${a.description.slice(0, 40)}" and "${b.description.slice(0, 40)}" share occurrence order ${a.occurrenceOrder}.`,
          { eventId: a.id },
        ));
      }
    }
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();
  const eventMap = new Map(registry.events.map((e) => [e.id, e]));

  function dfs(eventId: string, path: string[]): boolean {
    if (recStack.has(eventId)) return true;
    if (visited.has(eventId)) return false;
    visited.add(eventId);
    recStack.add(eventId);
    const evt = eventMap.get(eventId);
    if (evt) {
      for (const dep of evt.causedBy) {
        if (dfs(dep, [...path, eventId])) return true;
      }
    }
    recStack.delete(eventId);
    return false;
  }

  for (const event of registry.events) {
    if (dfs(event.id, [])) {
      findings.push(finding(
        "CYCLIC_CAUSAL_DEPENDENCY",
        "error",
        event.episode,
        `Event "${event.description.slice(0, 60)}" is part of a cyclic causal dependency.`,
        { eventId: event.id },
      ));
      break;
    }
  }

  return findings;
}

export function validateCharacterKnowledge(registry: NarrativeRegistry): NarrativeValidationFinding[] {
  const findings: NarrativeValidationFinding[] = [];

  for (const event of registry.events) {
    for (const change of event.knowledgeChanges) {
      if (change.change === "learned") {
        for (const earlierEvent of registry.events) {
          if (earlierEvent.episode >= event.episode) continue;
          for (const earlierChange of earlierEvent.knowledgeChanges) {
            if (earlierChange.characterId === change.characterId &&
              earlierChange.factId === change.factId &&
              earlierChange.change === "learned") {
              findings.push(finding(
                "DUPLICATE_KNOWLEDGE_ACQUISITION",
                "info",
                event.episode,
                `Character ${change.characterId} learns fact ${change.factId} again in episode ${event.episode}.`,
                { entityId: change.characterId, eventId: event.id },
              ));
            }
          }
        }
      }

      if (change.change === "misled") {
        for (const laterEvent of registry.events) {
          if (laterEvent.episode <= event.episode) continue;
          for (const laterChange of laterEvent.knowledgeChanges) {
            if (laterChange.characterId === change.characterId &&
              laterChange.factId === change.factId &&
              laterChange.change === "corrected") {
              break;
            }
          }
        }
      }
    }
  }

  for (const event of registry.events) {
    if (event.type === "revelation") {
      for (const participant of event.participants) {
        for (const change of event.knowledgeChanges) {
          if (change.characterId === participant && change.change === "learned") {
            const factId = change.factId;
            const learnedEarlier = registry.events.some(
              (e) =>
                e.episode < event.episode &&
                e.knowledgeChanges.some(
                  (c) =>
                    c.characterId === participant &&
                    c.factId === factId &&
                    c.change === "learned",
                ),
            );
            if (!learnedEarlier) continue;
          }
        }

        for (const change of event.knowledgeChanges) {
          if (change.visibility === "audience_only" || change.visibility === "character_only") {
            const audienceKnows = audienceKnowsFact(registry, change.factId, event.episode - 1);
            if (change.visibility === "audience_only" && audienceKnows) {
              findings.push(finding(
                "PROTECTED_REVELATION_DISCLOSED_EARLY",
                "error",
                event.episode,
                `Protected revelation "${change.factId}" was already known to the audience before episode ${event.episode}.`,
                { entityId: participant, eventId: event.id },
              ));
            }
          }
        }
      }
    }
  }

  return findings;
}

export function validateRelationships(registry: NarrativeRegistry): NarrativeValidationFinding[] {
  const findings: NarrativeValidationFinding[] = [];

  for (const rel of registry.relationships) {
    const entityA = registry.entities.find((e) => e.id === rel.characterA);
    const entityB = registry.entities.find((e) => e.id === rel.characterB);

    if (!entityA) {
      findings.push(finding(
        "RELATIONSHIP_INVALID_ENTITY",
        "error",
        rel.introducedEpisode,
        `Relationship references unknown entity "${rel.characterA}".`,
        { entityId: rel.characterA },
      ));
    }
    if (!entityB) {
      findings.push(finding(
        "RELATIONSHIP_INVALID_ENTITY",
        "error",
        rel.introducedEpisode,
        `Relationship references unknown entity "${rel.characterB}".`,
        { entityId: rel.characterB },
      ));
    }

    if (entityA && entityA.firstIntroductionEpisode !== undefined &&
      rel.introducedEpisode < entityA.firstIntroductionEpisode) {
      const isHistorical = rel.initialState.toLowerCase().includes("historical") ||
        rel.initialState.toLowerCase().includes("past") ||
        rel.initialState.toLowerCase().includes("childhood");
      if (!isHistorical) {
        findings.push(finding(
          "RELATIONSHIP_BEFORE_ENTITY_INTRODUCTION",
          "warning",
          rel.introducedEpisode,
          `Relationship between "${entityA.canonicalName}" and "${entityB?.canonicalName ?? rel.characterB}" is established in episode ${rel.introducedEpisode}, before "${entityA.canonicalName}" is introduced in episode ${entityA.firstIntroductionEpisode}.`,
          { entityId: rel.characterA, sourceEpisode: rel.introducedEpisode, expectedEpisode: entityA.firstIntroductionEpisode },
        ));
      }
    }

    if (entityB && entityB.firstIntroductionEpisode !== undefined &&
      rel.introducedEpisode < entityB.firstIntroductionEpisode) {
      const isHistorical = rel.initialState.toLowerCase().includes("historical") ||
        rel.initialState.toLowerCase().includes("past") ||
        rel.initialState.toLowerCase().includes("childhood");
      if (!isHistorical) {
        findings.push(finding(
          "RELATIONSHIP_BEFORE_ENTITY_INTRODUCTION",
          "warning",
          rel.introducedEpisode,
          `Relationship between "${entityA?.canonicalName ?? rel.characterA}" and "${entityB.canonicalName}" is established in episode ${rel.introducedEpisode}, before "${entityB.canonicalName}" is introduced in episode ${entityB.firstIntroductionEpisode}.`,
          { entityId: rel.characterB, sourceEpisode: rel.introducedEpisode, expectedEpisode: entityB.firstIntroductionEpisode },
        ));
      }
    }

    for (let i = 1; i < rel.changes.length; i++) {
      const change = rel.changes[i]!;
      if (change.newState === change.previousState) {
        findings.push(finding(
          "RELATIONSHIP_NO_STATE_CHANGE",
          "info",
          change.episode,
          `Relationship between "${entityA?.canonicalName ?? rel.characterA}" and "${entityB?.canonicalName ?? rel.characterB}" records a change in episode ${change.episode} but state remains "${change.newState}".`,
          { entityId: rel.id },
        ));
      }
    }
  }

  return findings;
}

export function validateCausalContinuity(registry: NarrativeRegistry): NarrativeValidationFinding[] {
  const findings: NarrativeValidationFinding[] = [];

  for (let i = 1; i < registry.episodeStates.length; i++) {
    const prev = registry.episodeStates[i - 1]!;
    const curr = registry.episodeStates[i]!;

    for (const consequenceId of prev.outgoingConsequences) {
      const event = registry.events.find((e) => e.id === consequenceId);
      if (!event) {
        findings.push(finding(
          "MISSING_CAUSAL_EVENT",
          "error",
          curr.episode,
          `Referenced consequence event ${consequenceId} does not exist.`,
          { eventId: consequenceId },
        ));
        continue;
      }

      const acknowledged = curr.incomingConsequences.includes(consequenceId);
      const superseded = registry.causalLinks.some(
        (link) => link.targetEventId === consequenceId && link.relationship === "supersedes",
      );

      if (!acknowledged && !superseded) {
        const hasRelatedEvent = registry.events.some(
          (e) => e.episode === curr.episode && sharesKeyword(e.description, event.description),
        );
        if (!hasRelatedEvent) {
          findings.push(finding(
            "UNACKNOWLEDGED_PREVIOUS_CONSEQUENCE",
            "warning",
            curr.episode,
            `Episode ${curr.episode} does not account for a consequence from episode ${prev.episode}: "${event.description.slice(0, 60)}".`,
            { eventId: consequenceId, sourceEpisode: prev.episode, evidence: event.description.slice(0, 100) },
          ));
        }
      }
    }
  }

  for (const link of registry.causalLinks) {
    const source = registry.events.find((e) => e.id === link.sourceEventId);
    const target = registry.events.find((e) => e.id === link.targetEventId);
    if (!source || !target) {
      findings.push(finding(
        "BROKEN_CAUSAL_LINK",
        "error",
        target?.episode ?? source?.episode ?? 0,
        `Causal link references missing event: ${!source ? link.sourceEventId : link.targetEventId}.`,
        { eventId: !source ? link.sourceEventId : link.targetEventId },
      ));
      continue;
    }
    if (target.episode < source.episode && link.relationship !== "supersedes") {
      findings.push(finding(
        "CAUSAL_LINK_BACKWARDS",
        "error",
        target.episode,
        `Causal link from episode ${source.episode} to episode ${target.episode} goes backwards.`,
        { eventId: link.targetEventId, sourceEpisode: source.episode, expectedEpisode: target.episode },
      ));
    }
  }

  return findings;
}

function sharesKeyword(a: string, b: string): boolean {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 5));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 5));
  let shared = 0;
  for (const w of wordsA) if (wordsB.has(w)) shared += 1;
  return shared >= 2;
}

export function validateNarrativeThreads(registry: NarrativeRegistry): NarrativeValidationFinding[] {
  const findings: NarrativeValidationFinding[] = [];
  const eventMap = new Map(registry.events.map((e) => [e.id, e]));

  for (const thread of registry.threads) {
    const setupEvents = thread.setupEventIds.filter((id) => eventMap.has(id));
    const payoffEvents = thread.payoffEventIds.filter((id) => eventMap.has(id));
    const hasSetup = setupEvents.length > 0;
    const hasPayoff = payoffEvents.length > 0;

    for (const setupId of thread.setupEventIds) {
      if (!eventMap.has(setupId)) {
        findings.push(finding(
          "BROKEN_THREAD_REFERENCE",
          "error",
          thread.introducedEpisode,
          `Thread "${thread.title.slice(0, 50)}" references non-existent setup event ${setupId}.`,
          { threadId: thread.id, eventId: setupId },
        ));
      }
    }
    for (const payoffId of thread.payoffEventIds) {
      if (!eventMap.has(payoffId)) {
        findings.push(finding(
          "BROKEN_THREAD_REFERENCE",
          "error",
          thread.intendedResolutionEpisode ?? thread.introducedEpisode,
          `Thread "${thread.title.slice(0, 50)}" references non-existent payoff event ${payoffId}.`,
          { threadId: thread.id, eventId: payoffId },
        ));
      }
    }

    if (hasSetup && hasPayoff) {
      for (const payoffId of payoffEvents) {
        const payoffEvent = eventMap.get(payoffId)!;
        for (const setupId of setupEvents) {
          const setupEvent = eventMap.get(setupId)!;
          if (payoffEvent.episode < setupEvent.episode) {
            findings.push(finding(
              "PAYOFF_BEFORE_SETUP",
              "error",
              payoffEvent.episode,
              `Thread "${thread.title.slice(0, 50)}" has a payoff in episode ${payoffEvent.episode} before its setup in episode ${setupEvent.episode}.`,
              { threadId: thread.id, eventId: payoffId, sourceEpisode: setupEvent.episode, expectedEpisode: payoffEvent.episode },
            ));
          }
        }
      }
    }

    if (thread.importance === "major" && !hasSetup && hasPayoff) {
      findings.push(finding(
        "PAYOFF_WITHOUT_SETUP",
        "warning",
        thread.intendedResolutionEpisode ?? thread.introducedEpisode,
        `Major thread "${thread.title.slice(0, 50)}" has a payoff without a registered setup.`,
        { threadId: thread.id },
      ));
    }

    if (thread.importance === "major" && thread.status === "abandoned" && !thread.carryForwardReason) {
      findings.push(finding(
        "ABANDONED_MAJOR_THREAD",
        "error",
        thread.introducedEpisode,
        `Major thread "${thread.title.slice(0, 50)}" is abandoned without an explanation.`,
        { threadId: thread.id },
      ));
    }

    if (thread.status === "intentionally_carried_forward" && !thread.carryForwardReason) {
      findings.push(finding(
        "UNJUSTIFIED_CARRY_FORWARD",
        "warning",
        thread.introducedEpisode,
        `Thread "${thread.title.slice(0, 50)}" is carried forward without a recorded reason.`,
        { threadId: thread.id },
      ));
    }

    if (thread.status === "resolved") {
      for (const q of thread.questions) {
        if (q.status !== "answered") {
          findings.push(finding(
            "RESOLVED_THREAD_UNANSWERED_QUESTION",
            "warning",
            thread.intendedResolutionEpisode ?? thread.introducedEpisode,
            `Thread "${thread.title.slice(0, 50)}" is marked resolved but has an unanswered question: "${q.question.slice(0, 50)}".`,
            { threadId: thread.id },
          ));
        }
      }
    }
  }

  return findings;
}

export function validateEpisodeTransitions(
  registry: NarrativeRegistry,
): NarrativeValidationFinding[] {
  const findings: NarrativeValidationFinding[] = [];

  for (let i = 1; i < registry.episodeStates.length; i++) {
    const prev = registry.episodeStates[i - 1]!;
    const curr = registry.episodeStates[i]!;

    for (const threadId of prev.activeThreads) {
      if (curr.resolvedThreads.includes(threadId)) continue;
      if (curr.activeThreads.includes(threadId)) continue;

      const thread = registry.threads.find((t) => t.id === threadId);
      if (thread && thread.status === "abandoned" && !thread.carryForwardReason) {
        findings.push(finding(
          "THREAD_DISAPPEARED",
          "warning",
          curr.episode,
          `Thread "${thread.title.slice(0, 50)}" was active in episode ${prev.episode} but is not tracked in episode ${curr.episode}.`,
          { threadId, sourceEpisode: prev.episode },
        ));
      }
    }

    for (const entityId of prev.activeEntities) {
      if (curr.absentEntities.includes(entityId)) continue;
      if (curr.activeEntities.includes(entityId)) continue;

      const entity = registry.entities.find((e) => e.id === entityId);
      if (entity && entity.lifecycle !== "deceased" && entity.lifecycle !== "departed") {
        findings.push(finding(
          "ENTITY_STATUS_UNCLEAR",
          "info",
          curr.episode,
          `Entity "${entity.canonicalName}" was active in episode ${prev.episode} but is not tracked in episode ${curr.episode}.`,
          { entityId, sourceEpisode: prev.episode },
        ));
      }
    }
  }

  return findings;
}

export function validateSeasonFinale(
  registry: NarrativeRegistry,
  _plan: { centralConflictOrMystery: string; intendedSeasonConclusion: string; unresolvedQuestions: string[] },
): NarrativeValidationFinding[] {
  const findings: NarrativeValidationFinding[] = [];
  const episodes = registry.episodeStates;
  if (episodes.length === 0) return findings;

  const finale = episodes[episodes.length - 1]!;
  const majorThreads = registry.threads.filter((t) => t.importance === "major");
  const resolvedMajorThreads = majorThreads.filter((t) => t.status === "resolved");
  const carriedForwardThreads = majorThreads.filter((t) => t.status === "intentionally_carried_forward");
  const abandonedMajorThreads = majorThreads.filter(
    (t) => t.status === "abandoned" && !t.carryForwardReason,
  );

  if (abandonedMajorThreads.length > 0) {
    for (const thread of abandonedMajorThreads) {
      findings.push(finding(
        "FINALE_ABANDONED_MAJOR_THREAD",
        "error",
        finale.episode,
        `Major thread "${thread.title.slice(0, 50)}" is abandoned without resolution or carry-forward plan.`,
        { threadId: thread.id },
      ));
    }
  }

  const hasCentralConflictResolution = resolvedMajorThreads.length > 0 ||
    registry.events.some(
      (e) => e.episode === finale.episode && e.type === "revelation",
    );

  if (!hasCentralConflictResolution && majorThreads.length > 0 && carriedForwardThreads.length === 0) {
    findings.push(finding(
      "FINALE_NO_RESOLUTION",
      "error",
      finale.episode,
      `The season finale does not resolve any major threads and has no carry-forward plan.`,
      { suggestedAction: "Add a resolution or explicit carry-forward for major threads." },
    ));
  }

  for (const thread of carriedForwardThreads) {
    if (!thread.carryForwardReason) {
      findings.push(finding(
        "FINALE_UNJUSTIFIED_HOOK",
        "warning",
        finale.episode,
        `Future-season hook "${thread.title.slice(0, 50)}" lacks a carry-forward reason.`,
        { threadId: thread.id },
      ));
    }
  }

  const minorOpenThreads = registry.threads.filter(
    (t) => t.importance === "minor" && t.status === "unresolved",
  );
  for (const thread of minorOpenThreads) {
    findings.push(finding(
      "FINALE_MINOR_OPEN_THREAD",
      "info",
      finale.episode,
      `Minor thread "${thread.title.slice(0, 50)}" remains open at the season finale.`,
      { threadId: thread.id },
    ));
  }

  return findings;
}

export function validateSeasonNarrative(
  registry: NarrativeRegistry,
  plan: { centralConflictOrMystery: string; intendedSeasonConclusion: string; unresolvedQuestions: string[] },
): NarrativeValidationFinding[] {
  const findings: NarrativeValidationFinding[] = [];

  findings.push(...validateCanonicalIdentities(registry));
  findings.push(...validateEntityLifecycles(registry));
  findings.push(...validateEventChronology(registry));
  findings.push(...validateCharacterKnowledge(registry));
  findings.push(...validateRelationships(registry));
  findings.push(...validateCausalContinuity(registry));
  findings.push(...validateNarrativeThreads(registry));
  findings.push(...validateEpisodeTransitions(registry));
  findings.push(...validateSeasonFinale(registry, plan));

  return findings;
}

export function summarizeFindings(findings: NarrativeValidationFinding[]): {
  errors: number;
  warnings: number;
  info: number;
} {
  return {
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
  };
}