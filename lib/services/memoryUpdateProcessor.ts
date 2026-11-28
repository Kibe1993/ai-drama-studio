import "server-only";
import { memoryIntegrityService } from "@/lib/services/memoryIntegrityService";
import type { ProjectMemoryCategory, ProjectMemorySource } from "@/lib/repositories/projectMemoryRepository";

export type MemoryCandidate = {
  category: ProjectMemoryCategory;
  key: string;
  value: string;
  source: ProjectMemorySource;
  confidence: number;
};

export type MemoryUpdateResult = {
  applied: number;
  conflicts: number;
  skipped: number;
};

const APPROVAL_PATTERNS = [
  /\b(yes|yes,?\s*(that|this|it)?'?s?\s*(good|right|correct|fine|perfect))\b/i,
  /\b(approve|approved|looks good|great idea|love it|perfect)\b/i,
  /\b(go ahead|do it|proceed|let'?s do it)\b/i,
];

const REJECTION_PATTERNS = [
  /\b(no|nope|no,?\s*(that|this)?'?s?\s*(not|wrong|bad))\b/i,
  /\b(reject|rejected|don'?t(?:\s+like|want)|stop|discard|scrap)\b/i,
  /\b(not\s+a\s+good\s+idea|bad\s+idea|doesn'?t\s+work)\b/i,
];

const CORRECTION_PATTERNS = [
  /\b(actually,?\s+)/i,
  /\b(no,?\s+(?:the|it|that)?\s*(?:is|should be|means)?\s+)/i,
  /\b(correction:?\s+)/i,
  /\b(wait,?\s+)/i,
];

const PROPOSAL_PATTERNS = [
  /\b(i\s+suggest|suggestion:?)\b/i,
  /\b(how\s+about|what\s+if|perhaps|maybe\s+we)\b/i,
  /\b(i\s+propose|proposal:?)\b/i,
  /\b(we\s+could|we\s+might|consider)\b/i,
];

const USER_FACT_PATTERNS = [
  /\b(the\s+(?:genre|format|setting|tone|style)\s+(?:is|should be)\s+(.+))/i,
  /\b(i\s+want\s+(?:the|this)?\s*(.+)\s+to\s+be\s+(.+))/i,
  /\b(let'?s\s+(?:use|make|set|have)\s+(.+))/i,
  /\b(the\s+(?:protagonist|main\s+character)\s+(?:is\s+called|is|name(?:is)?)\s+(.+))/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function extractMatch(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

function classifyCategory(text: string): ProjectMemoryCategory {
  const lower = text.toLowerCase();
  if (/\b(character|protagonist|antagonist|personality|backstory|motivation|relationship)\b/.test(lower)) {
    return "identity";
  }
  if (/\b(scene|shot|screenplay|dialogue|episode|story|plot)\b/.test(lower)) {
    return "story";
  }
  if (/\b(stage|progress|task|todo|next\s+step|pipeline)\b/.test(lower)) {
    return "development";
  }
  if (/\b(code|bug|architecture|technical|implementation)\b/.test(lower)) {
    return "technical";
  }
  return "story";
}

function extractCandidatesFromUserMessage(message: string): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];

  if (matchesAny(message, CORRECTION_PATTERNS)) {
    const fact = extractMatch(message, USER_FACT_PATTERNS);
    if (fact) {
      candidates.push({
        category: classifyCategory(message),
        key: "user_correction",
        value: message.slice(0, 500),
        source: "correction",
        confidence: 0.8,
      });
    }
  }

  if (matchesAny(message, APPROVAL_PATTERNS)) {
    candidates.push({
      category: "development",
      key: "user_approval",
      value: message.slice(0, 500),
      source: "user_decision",
      confidence: 0.85,
    });
  }

  if (matchesAny(message, REJECTION_PATTERNS)) {
    candidates.push({
      category: "development",
      key: "user_rejection",
      value: message.slice(0, 500),
      source: "user_decision",
      confidence: 0.85,
    });
  }

  for (const p of USER_FACT_PATTERNS) {
    const m = message.match(p);
    if (m) {
      candidates.push({
        category: classifyCategory(m[0]),
        key: m[1]?.slice(0, 100) ?? "user_fact",
        value: m[0].slice(0, 500),
        source: "user_decision",
        confidence: 0.75,
      });
    }
  }

  return candidates;
}

function extractCandidatesFromAssistantMessage(message: string): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];

  if (matchesAny(message, PROPOSAL_PATTERNS)) {
    for (const p of PROPOSAL_PATTERNS) {
      const m = message.match(p);
      if (m) {
        candidates.push({
          category: classifyCategory(message),
          key: "assistant_proposal",
          value: message.slice(0, 500),
          source: "assistant_proposal",
          confidence: 0.7,
        });
        break;
      }
    }
  }

  return candidates;
}

const CONFIDENCE_THRESHOLD = 0.7;

export function extractMemoryCandidates(
  userMessage: string,
  assistantResponse: string,
): MemoryCandidate[] {
  const userCandidates = extractCandidatesFromUserMessage(userMessage);
  const assistantCandidates = extractCandidatesFromAssistantMessage(assistantResponse);

  return [...userCandidates, ...assistantCandidates]
    .filter((c) => c.confidence >= CONFIDENCE_THRESHOLD);
}

export async function processMemoryUpdates(
  clerkUserId: string,
  projectId: string,
  conversationId: string,
  userMessage: string,
  assistantResponse: string,
): Promise<MemoryUpdateResult> {
  const candidates = extractMemoryCandidates(userMessage, assistantResponse);

  let applied = 0;
  let conflicts = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    try {
      const result = await memoryIntegrityService.safeUpsert(clerkUserId, {
        projectId,
        category: candidate.category,
        key: candidate.key,
        value: candidate.value,
        source: candidate.source,
        status: candidate.source === "user_decision" ? "confirmed" : "proposed",
        conversationId,
      });

      if (result.conflict) {
        conflicts++;
      } else {
        applied++;
      }
    } catch {
      skipped++;
    }
  }

  return { applied, conflicts, skipped };
}