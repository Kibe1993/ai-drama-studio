export type TaskType =
  | "character_development"
  | "scene_development"
  | "continuity_review"
  | "general_conversation"
  | "technical_development";

export type TaskClassification = {
  type: TaskType;
  confidence: number;
  referencedEntities: string[];
};

const CHARACTER_KEYWORDS = [
  "character", "protagonist", "antagonist", "personality", "backstory",
  "motivation", "arc", "relationship", "voice", "trait", "age", "background",
];

const SCENE_KEYWORDS = [
  "scene", "shot", "dialogue", "action", "location", "setting",
  "camera", "transition", "breakdown", "screenplay", "script",
];

const CONTINUITY_KEYWORDS = [
  "continuity", "consistent", "timeline", "contradiction", "conflict",
  "canon", "world rule", "timeline", "event order", "plot hole",
];

const TECHNICAL_KEYWORDS = [
  "code", "bug", "architecture", "technical", "implementation",
  "debug", "error", "fix", "build", "deploy", "config",
];

function countKeywordMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) count++;
  }
  return count;
}

function extractEntityNames(text: string, knownNames: string[]): string[] {
  const lower = text.toLowerCase();
  return knownNames.filter((name) => lower.includes(name.toLowerCase()));
}

export function classifyTask(
  userMessage: string,
  recentHistory: string[],
  knownEntityNames: string[],
): TaskClassification {
  const combinedText = [userMessage, ...recentHistory].join(" ");
  const referencedEntities = extractEntityNames(userMessage, knownEntityNames);

  const charScore = countKeywordMatches(combinedText, CHARACTER_KEYWORDS);
  const sceneScore = countKeywordMatches(combinedText, SCENE_KEYWORDS);
  const continuityScore = countKeywordMatches(combinedText, CONTINUITY_KEYWORDS);
  const techScore = countKeywordMatches(combinedText, TECHNICAL_KEYWORDS);

  const scores: Array<{ type: TaskType; score: number }> = [
    { type: "character_development", score: charScore },
    { type: "scene_development", score: sceneScore },
    { type: "continuity_review", score: continuityScore },
    { type: "technical_development", score: techScore },
  ];

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];

  if (!best || best.score === 0) {
    return { type: "general_conversation", confidence: 0.3, referencedEntities };
  }

  const hasEntityMatch = referencedEntities.length > 0;
  const confidence = hasEntityMatch ? Math.min(1.0, 0.7 + best.score * 0.1) : Math.min(0.9, 0.5 + best.score * 0.1);

  return { type: best.type, confidence, referencedEntities };
}