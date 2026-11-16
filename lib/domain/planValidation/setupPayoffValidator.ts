import type { SeasonPlan } from "@/lib/validation/seasonPlan";
import type { RichValidationFinding } from "@/lib/validation/seasonPlanValidation";
import type { CanonicalEntityRegistry } from "@/lib/validation/canonicalRegistry";
import { makeFindingId } from "@/lib/validation/seasonPlanValidation";
import { getThreadLifecycle } from "@/lib/domain/canonicalRegistry";

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

export interface StoryThread {
  id: string;
  type: "setup" | "foreshadowing" | "mystery" | "promise" | "clue" | "conflict" | "revelation" | "payoff";
  description: string;
  introducedInEpisode: number;
  resolvedInEpisode: number | null;
  isDeliberatelyUnresolved: boolean;
  abandonmentReason: string | null;
}

const SETUP_INDICATORS = /\b(set\s*up|establish|plant|introduce|lay|foundation|prepare)/i;
const FORESHADOWING_INDICATORS = /\b(foreshadow|hint|suggest|allude|portend|ominous|premonit)/i;
const MYSTERY_INDICATORS = /\b(myster|secret|unknown|puzzle|enigma|question|riddle)/i;
const PROMISE_INDICATORS = /\b(promise|vow|oath|pledge|commit)/i;
const CLUE_INDICATORS = /\b(clue|evidence|trace|sign|signal|indication)/i;
const PAYOFF_INDICATORS = /\b(payoff|resolve|conclude|fulfill|deliver|reveal|answer|culminat)/i;
const UNRESOLVED_INDICATORS = /\b(unresolved|open.?ended|carry.*forward|next\s+season|remain|unanswered)\b/i;
const ABANDONED_INDICATORS = /\b(abandon|drop|discard|misdirection|red herring|abandoned)\b/i;

function classifyThread(text: string): StoryThread["type"] | null {
  if (PAYOFF_INDICATORS.test(text)) return "payoff";
  if (FORESHADOWING_INDICATORS.test(text)) return "foreshadowing";
  if (MYSTERY_INDICATORS.test(text)) return "mystery";
  if (PROMISE_INDICATORS.test(text)) return "promise";
  if (CLUE_INDICATORS.test(text)) return "clue";
  if (SETUP_INDICATORS.test(text)) return "setup";
  return null;
}

function isDeliberatelyUnresolved(text: string): boolean {
  return UNRESOLVED_INDICATORS.test(text);
}

function isAbandoned(text: string): boolean {
  return ABANDONED_INDICATORS.test(text);
}

export function extractStoryThreads(plan: SeasonPlan): StoryThread[] {
  const threads: StoryThread[] = [];
  let threadCounter = 0;

  for (const ep of plan.episodeProgression) {
    for (const beat of ep.majorStoryBeats) {
      const type = classifyThread(beat);
      if (type && type !== "payoff") {
        threadCounter += 1;
        threads.push({
          id: `thread-${threadCounter}`,
          type,
          description: beat,
          introducedInEpisode: ep.episodeNumber,
          resolvedInEpisode: null,
          isDeliberatelyUnresolved: isDeliberatelyUnresolved(beat),
          abandonmentReason: isAbandoned(beat) ? beat : null,
        });
      }
    }

    for (const info of ep.informationRevealed) {
      threadCounter += 1;
      threads.push({
        id: `thread-${threadCounter}`,
        type: "revelation",
        description: info,
        introducedInEpisode: ep.episodeNumber,
        resolvedInEpisode: null,
        isDeliberatelyUnresolved: false,
        abandonmentReason: null,
      });
    }

    for (const thread of ep.unresolvedThreads) {
      threadCounter += 1;
      threads.push({
        id: `thread-${threadCounter}`,
        type: "mystery",
        description: thread,
        introducedInEpisode: ep.episodeNumber,
        resolvedInEpisode: null,
        isDeliberatelyUnresolved: isDeliberatelyUnresolved(thread),
        abandonmentReason: isAbandoned(thread) ? thread : null,
      });
    }
  }

  for (const sp of plan.setupAndPayoff) {
    const isPayoff = PAYOFF_INDICATORS.test(sp);
    const isSetup = SETUP_INDICATORS.test(sp) || FORESHADOWING_INDICATORS.test(sp);
    threadCounter += 1;
    threads.push({
      id: `thread-${threadCounter}`,
      type: isPayoff ? "payoff" : isSetup ? "setup" : "setup",
      description: sp,
      introducedInEpisode: 0,
      resolvedInEpisode: isPayoff ? plan.episodeProgression.length : null,
      isDeliberatelyUnresolved: isDeliberatelyUnresolved(sp),
      abandonmentReason: isAbandoned(sp) ? sp : null,
    });
  }

  for (const q of plan.unresolvedQuestions) {
    threadCounter += 1;
    threads.push({
      id: `thread-${threadCounter}`,
      type: "mystery",
      description: q,
      introducedInEpisode: 0,
      resolvedInEpisode: null,
      isDeliberatelyUnresolved: true,
      abandonmentReason: null,
    });
  }

  return threads;
}

export function validateSetupPayoff(
  plan: SeasonPlan,
  registry?: CanonicalEntityRegistry,
): RichValidationFinding[] {
  const findings: RichValidationFinding[] = [];
  const threads = extractStoryThreads(plan);

  const setups = threads.filter((t) =>
    t.type === "setup" || t.type === "foreshadowing" || t.type === "clue" || t.type === "promise"
  );
  const mysteries = threads.filter((t) => t.type === "mystery");
  const payoffs = threads.filter((t) => t.type === "payoff");

  for (const setup of setups) {
    if (setup.resolvedInEpisode !== null) continue;
    if (setup.isDeliberatelyUnresolved) continue;
    if (setup.abandonmentReason) continue;

    const hasPayoff = payoffs.some((p) =>
      jaccardSimilarity(p.description, setup.description) > 0.2 ||
      shareKeywords(p.description, setup.description)
    );
    const hasLaterMention = plan.episodeProgression
      .filter((ep) => ep.episodeNumber > setup.introducedInEpisode)
      .some((ep) => {
        const epText = normalize(
          ep.startingSituation + " " +
          ep.characterDevelopment + " " +
          ep.majorStoryBeats.join(" ") + " " +
          ep.endingOrCliffhanger
        );
        const setupKeywords = normalize(setup.description)
          .split(/\s+/).filter((w) => w.length > 5).slice(0, 3);
        return setupKeywords.length > 0 && setupKeywords.every((kw) => epText.includes(kw));
      });

    if (!hasPayoff && !hasLaterMention && setup.introducedInEpisode > 0) {
      const isMajor = setup.type === "promise" || setup.type === "foreshadowing";
      const sourceEpisode = registry
        ? (getThreadLifecycle(registry, setup.description)?.setupEpisodes[0] ?? setup.introducedInEpisode)
        : setup.introducedInEpisode;
      const destEpisode = registry
        ? (getThreadLifecycle(registry, setup.description)?.payoffEpisodes[0] ?? null)
        : null;
      findings.push({
        findingId: makeFindingId("sp"),
        category: "setup_payoff",
        severity: isMajor ? "high" : "medium",
        episodeNumber: sourceEpisode,
        message: `A ${setup.type} in episode ${sourceEpisode} has no payoff or resolution: "${setup.description.slice(0, 80)}".`,
        explanation: destEpisode
          ? `Payoff expected in episode ${destEpisode}.`
          : "Major setups should have a payoff, a planned future payoff, or an explicit unresolved status.",
        recommendation: "Add a payoff in a later episode or mark the thread as deliberately unresolved.",
        requiresHumanReview: isMajor,
        source: "deterministic",
      });
    }
  }

  for (const mystery of mysteries) {
    if (mystery.resolvedInEpisode !== null) continue;
    if (mystery.isDeliberatelyUnresolved) continue;
    if (mystery.abandonmentReason) continue;

    const hasResolution = payoffs.some((p) =>
      shareKeywords(p.description, mystery.description)
    );
    const isCarriedForward = plan.unresolvedQuestions.some((q) =>
      shareKeywords(q, mystery.description)
    );

    const threadLc = registry ? getThreadLifecycle(registry, mystery.description) : null;
    const isIntentionalCarryForward = threadLc?.isIntentionalCarryForward ?? false;
    const threadStatus = threadLc?.threadStatus;
    const isResolvedInLedger = threadStatus === "resolved";

    if (!hasResolution && !isCarriedForward && !isIntentionalCarryForward && !isResolvedInLedger && mystery.introducedInEpisode > 0) {
      const sourceEpisode = threadLc?.setupEpisodes[0] ?? mystery.introducedInEpisode;
      findings.push({
        findingId: makeFindingId("sp"),
        category: "setup_payoff",
        severity: "high",
        episodeNumber: sourceEpisode,
        message: `A mystery introduced in episode ${sourceEpisode} is never resolved or deliberately carried forward: "${mystery.description.slice(0, 80)}".`,
        explanation: "Major mysteries should be resolved, explicitly carried forward, or marked as intentionally unresolved.",
        recommendation: "Resolve the mystery in a later episode or add it to unresolvedQuestions with a reason.",
        requiresHumanReview: true,
        source: "deterministic",
      });
    }
  }

  for (const payoff of payoffs) {
    const hasSetup = setups.some((s) =>
      jaccardSimilarity(s.description, payoff.description) > 0.2 ||
      shareKeywords(s.description, payoff.description)
    );
    if (!hasSetup) {
      const destEpisode = registry
        ? (getThreadLifecycle(registry, payoff.description)?.payoffEpisodes[0] ?? payoff.resolvedInEpisode)
        : payoff.resolvedInEpisode;
      findings.push({
        findingId: makeFindingId("sp"),
        category: "setup_payoff",
        severity: "medium",
        episodeNumber: destEpisode ?? undefined,
        message: `A payoff lacks sufficient setup: "${payoff.description.slice(0, 80)}".`,
        explanation: "Payoffs should reference an earlier setup or foreshadowing.",
        recommendation: "Add setup in an earlier episode.",
        requiresHumanReview: false,
        source: "deterministic",
      });
    }
  }

  return findings;
}

function shareKeywords(a: string, b: string): boolean {
  const wordsA = new Set(normalize(a).split(/\s+/).filter((w) => w.length > 5));
  const wordsB = new Set(normalize(b).split(/\s+/).filter((w) => w.length > 5));
  let shared = 0;
  for (const w of wordsA) if (wordsB.has(w)) shared += 1;
  return shared >= 2;
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(normalize(a).split(/\s+/).filter((w) => w.length > 2));
  const setB = new Set(normalize(b).split(/\s+/).filter((w) => w.length > 2));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection += 1;
  return intersection / (setA.size + setB.size - intersection);
}