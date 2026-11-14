import { log } from "@/lib/log";

function clampString(value: unknown, max: number): string | null {
  if (typeof value === "string") return value.trim().slice(0, max);
  if (Array.isArray(value)) return value.map((v) => String(v)).join("; ").slice(0, max);
  if (typeof value === "number" || typeof value === "boolean") return String(value).slice(0, max);
  return null;
}

function clampStringArray(value: unknown, maxItems: number, maxLen: number): string[] | null {
  if (typeof value === "string") return [value.trim().slice(0, maxLen)];
  if (!Array.isArray(value)) return null;
  return value
    .map((item) => clampString(item, maxLen))
    .filter((s): s is string => s != null && s.length > 0)
    .slice(0, maxItems);
}

function clampInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(max, Math.max(min, Math.round(value)));
  }
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed)) return Math.min(max, Math.max(min, parsed));
  }
  return null;
}

function normalizeArcChange(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const obj = item as Record<string, unknown>;
  const name = clampString(obj.name, 80);
  const change = clampString(obj.change, 400);
  if (name == null || change == null) return null;
  return { name, change };
}

function normalizeRelationshipChange(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const obj = item as Record<string, unknown>;
  const from = clampString(obj.from, 80);
  const to = clampString(obj.to, 80);
  const change = clampString(obj.change, 300);
  if (from == null || to == null || change == null) return null;
  return { from, to, change };
}

function normalizeObjectChange(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const obj = item as Record<string, unknown>;
  const name = clampString(obj.name, 120);
  const ownership = clampString(obj.ownership, 200);
  const condition = clampString(obj.condition, 300);
  if (name == null || ownership == null || condition == null) return null;
  return { name, ownership, condition };
}

function normalizeLocationChange(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const obj = item as Record<string, unknown>;
  const name = clampString(obj.name, 120);
  const change = clampString(obj.change, 300);
  if (name == null || change == null) return null;
  return { name, change };
}

function clampObjectArray(
  value: unknown,
  maxItems: number,
  normalizeItem: (item: unknown) => Record<string, unknown> | null
): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeItem)
    .filter((item): item is Record<string, unknown> => item != null)
    .slice(0, maxItems);
}

function normalizeEpisodeOutline(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const obj = item as Record<string, unknown>;
  const episodeNumber = clampInteger(obj.episodeNumber, 1, 100);
  const workingTitle = clampString(obj.workingTitle, 120);
  const narrativePurpose = clampString(obj.narrativePurpose, 600);
  const centralConflict = clampString(obj.centralConflict, 600);
  const endingOrCliffhanger = clampString(obj.endingOrCliffhanger, 600);
  if (episodeNumber == null || workingTitle == null || narrativePurpose == null || centralConflict == null || endingOrCliffhanger == null) return null;
  return { episodeNumber, workingTitle, narrativePurpose, centralConflict, endingOrCliffhanger };
}

const ARCH_STRING_FIELDS: Record<string, number> = {
  seasonObjective: 1200,
  centralConflictOrMystery: 1000,
  mainCharacterObjectives: 1000,
  overallCharacterDevelopment: 1000,
  beginningDirection: 800,
  middleDirection: 800,
  endingDirection: 800,
  intendedSeasonConclusion: 1000,
};

const ARCH_ARRAY_FIELDS: Record<string, [number, number]> = {
  majorStoryDevelopments: [10, 500],
  importantRevelations: [8, 500],
  relationshipChanges: [8, 500],
  consequencesCarriedBetween: [8, 500],
  setupAndPayoff: [6, 500],
  unresolvedQuestions: [6, 500],
};

export function normalizeSeasonArchitecture(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const obj = { ...(parsed as Record<string, unknown>) };
  let repaired = false;

  for (const [field, max] of Object.entries(ARCH_STRING_FIELDS)) {
    if (field in obj) {
      const normalized = clampString(obj[field], max);
      if (normalized != null && normalized !== obj[field]) {
        obj[field] = normalized;
        repaired = true;
      }
    }
  }

  for (const [field, [maxItems, maxLen]] of Object.entries(ARCH_ARRAY_FIELDS)) {
    if (field in obj) {
      const normalized = clampStringArray(obj[field], maxItems, maxLen);
      if (normalized != null) {
        const original = obj[field];
        if (!Array.isArray(original) || normalized.length !== original.length || normalized.some((v, i) => v !== (original as unknown[])[i])) {
          obj[field] = normalized;
          repaired = true;
        }
      }
    }
  }

  if ("episodeOutlines" in obj && Array.isArray(obj.episodeOutlines)) {
    const normalized = (obj.episodeOutlines as unknown[])
      .map(normalizeEpisodeOutline)
      .filter((e): e is Record<string, unknown> => e != null)
      .slice(0, 24);
    if (normalized.length !== (obj.episodeOutlines as unknown[]).length) {
      obj.episodeOutlines = normalized;
      repaired = true;
    } else {
      for (let i = 0; i < normalized.length; i++) {
        if (JSON.stringify(normalized[i]) !== JSON.stringify((obj.episodeOutlines as unknown[])[i])) {
          obj.episodeOutlines = normalized;
          repaired = true;
          break;
        }
      }
    }
  }

  if (repaired) {
    log.info("llm", "season architecture normalized", { fields: Object.keys(obj).length });
  }
  return obj;
}

const EPISODE_STRING_FIELDS: Record<string, number> = {
  workingTitle: 120,
  narrativePurpose: 600,
  startingSituation: 800,
  mainObjective: 600,
  centralConflict: 600,
  characterDevelopment: 800,
  storyContribution: 600,
  endingOrCliffhanger: 600,
  continuityRequirements: 600,
};

const EPISODE_ARRAY_FIELDS: Record<string, [number, number]> = {
  majorStoryBeats: [10, 400],
  informationRevealed: [8, 400],
  importantEvents: [8, 400],
  consequences: [8, 400],
  unresolvedThreads: [6, 400],
};

export function normalizeEpisodeDetail(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const obj = { ...(parsed as Record<string, unknown>) };
  let repaired = false;

  if ("episodeNumber" in obj) {
    const num = clampInteger(obj.episodeNumber, 1, 100);
    if (num != null && num !== obj.episodeNumber) {
      obj.episodeNumber = num;
      repaired = true;
    }
  }

  for (const [field, max] of Object.entries(EPISODE_STRING_FIELDS)) {
    if (field in obj) {
      const normalized = clampString(obj[field], max);
      if (normalized != null && normalized !== obj[field]) {
        obj[field] = normalized;
        repaired = true;
      }
    }
  }

  for (const [field, [maxItems, maxLen]] of Object.entries(EPISODE_ARRAY_FIELDS)) {
    if (field in obj) {
      const normalized = clampStringArray(obj[field], maxItems, maxLen);
      if (normalized != null) {
        const original = obj[field];
        if (!Array.isArray(original) || normalized.length !== original.length || normalized.some((v, i) => v !== (original as unknown[])[i])) {
          obj[field] = normalized;
          repaired = true;
        }
      }
    }
  }

  const objectArrays: Record<string, [number, (item: unknown) => Record<string, unknown> | null]> = {
    characterArcChanges: [8, normalizeArcChange],
    relationshipChanges: [6, normalizeRelationshipChange],
    objectChanges: [6, normalizeObjectChange],
    locationChanges: [6, normalizeLocationChange],
  };

  for (const [field, [maxItems, normalizeItem]] of Object.entries(objectArrays)) {
    const normalized = clampObjectArray(obj[field], maxItems, normalizeItem);
    const original = obj[field];
    if (!Array.isArray(original) || normalized.length !== (original as unknown[]).length) {
      obj[field] = normalized;
      repaired = true;
    }
  }

  if (repaired) {
    log.info("llm", "episode detail normalized", { episodeNumber: obj.episodeNumber });
  }
  return obj;
}

export function normalizeEpisodeDetailBatch(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const obj = { ...(parsed as Record<string, unknown>) };
  if (!Array.isArray(obj.episodes)) return obj;
  obj.episodes = (obj.episodes as unknown[])
    .map(normalizeEpisodeDetail)
    .filter((e) => e != null && typeof e === "object")
    .slice(0, 6);
  return obj;
}
export function normalizeSeasonPlan(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const obj = { ...(parsed as Record<string, unknown>) };
  let repaired = false;

  for (const [field, max] of Object.entries(ARCH_STRING_FIELDS)) {
    if (field in obj) {
      const normalized = clampString(obj[field], max);
      if (normalized != null && normalized !== obj[field]) {
        obj[field] = normalized;
        repaired = true;
      }
    }
  }

  for (const [field, [maxItems, maxLen]] of Object.entries(ARCH_ARRAY_FIELDS)) {
    if (field in obj) {
      const normalized = clampStringArray(obj[field], maxItems, maxLen);
      if (normalized != null) {
        const original = obj[field];
        if (!Array.isArray(original) || normalized.length !== original.length || normalized.some((v, i) => v !== (original as unknown[])[i])) {
          obj[field] = normalized;
          repaired = true;
        }
      }
    }
  }

  if (Array.isArray(obj.episodeProgression)) {
    obj.episodeProgression = (obj.episodeProgression as unknown[])
      .map(normalizeEpisodeDetail)
      .filter((e) => e != null && typeof e === "object")
      .slice(0, 24);
    repaired = true;
  }

  if (repaired) {
    log.info("llm", "season plan normalized", { fields: Object.keys(obj).length });
  }
  return obj;
}