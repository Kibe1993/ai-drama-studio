import type { StoryStructure } from "@/lib/validation/story";
import type { CanonState, NarrativeFact } from "@/lib/validation/narrativeControl";
import { isProtectedFact } from "@/lib/validation/narrativeControl";
import { makeFinding, type NarrativeFinding } from "@/lib/domain/narrativeControl/findings";
import { proposedIntervalConflict } from "@/lib/domain/narrativeControl/worldRules";
import { normalizeName } from "@/lib/domain/narrativeControl/text";

const STOP = new Set([
  "the", "and", "that", "with", "have", "this", "from", "they", "them", "then",
  "there", "their", "into", "about", "after", "before", "because", "while",
  "where", "which", "would", "could", "should", "does", "your", "you", "for",
  "his", "her", "she", "him", "its", "are", "was", "were", "been", "being",
  "have", "had", "has", "not", "but", "what", "when", "who", "how", "why",
  "every", "years", "year", "another", "someone",
]);

const EVENT = /\b(disappears?|calls?|called|sacrifice|warns?|warning|hears?|photograph|ritual)\b/i;
const STAKE = /\b(door|fate|uncertain|climax)\b/i;
const CALL = /\b(calls?|called|phones?|phoned)\b/i;
const ROLES = ["brother", "sister", "journalist", "mother", "father", "daughter", "son"];

/**
 * Compare the synopsis, acts, and screenplay with protected canon.
 * A fact the synopsis still tells must be established on screen.
 * A whole-story revision must still carry every protected fact.
 */
export function agreementFindings(input: {
  canon: CanonState;
  episode: number;
  synopsis: string;
  acts: string;
  screenplayText: string;
  endingText: string;
  requireCanonCoverage: boolean;
}): NarrativeFinding[] {
  const findings: NarrativeFinding[] = [];
  const names = input.canon.entities.filter((entity) => entity.kind === "character").map((entity) => entity.name);
  const screenplay = input.screenplayText.toLocaleLowerCase();
  const ending = input.endingText.toLocaleLowerCase();
  const asserted = `${input.synopsis}\n${input.acts}`.toLocaleLowerCase();

  for (const fact of input.canon.facts) {
    if (!isProtectedFact(fact) || fact.classification !== "ESTABLISHED_CANON") continue;
    const factTokens = tokens(fact.statement);
    if (input.requireCanonCoverage) {
      const missing = uncovered(factTokens, screenplay);
      if (missing) {
        findings.push(coverageFinding(fact, input.episode, missing, "The screenplay drops a protected canonical fact."));
      }
    } else if (EVENT.test(fact.statement)) {
      const synopsisTokens = factTokens.filter((token) => asserted.includes(token));
      if (synopsisTokens.length >= Math.min(2, factTokens.length) && factTokens.length > 0) {
        const missing = uncovered(synopsisTokens, screenplay);
        if (missing) {
          findings.push(coverageFinding(
            fact,
            input.episode,
            missing,
            "The synopsis or acts keep this event, but the screenplay does not establish it.",
          ));
        }
      }
    }

    const denial = deniesFact(fact, names, input.screenplayText);
    if (denial) {
      findings.push(makeFinding({
        algorithm: "agreement",
        severity: "ERROR",
        category: "canon",
        entityId: fact.subjectEntityIds[0] ?? null,
        episode: input.episode,
        evidence: denial.slice(0, 180),
        expected: fact.statement,
        actual: denial.slice(0, 180),
        explanation: `The screenplay denies the protected fact "${fact.statement}".`,
        suggestedCorrection: "Restore the canonical identity or relationship, or request authorization to change it.",
        requiresCanonAuthorization: true,
      }));
    }

    const drift = callerDrift(fact, names, input.screenplayText);
    if (drift) {
      findings.push(makeFinding({
        algorithm: "agreement",
        severity: "ERROR",
        category: "identity",
        episode: input.episode,
        evidence: drift.slice(0, 180),
        expected: fact.statement,
        actual: drift.slice(0, 180),
        explanation: `The screenplay gives "${fact.statement}" to someone other than the canonical character.`,
        suggestedCorrection: "Keep the canonical character in that action, or request authorization to change it.",
        requiresCanonAuthorization: true,
      }));
    }

    const absent = absentPresentRole(fact, names, input.screenplayText);
    if (absent) {
      findings.push(makeFinding({
        algorithm: "agreement",
        severity: "ERROR",
        category: "canon",
        episode: input.episode,
        evidence: absent.slice(0, 180),
        expected: fact.statement,
        actual: absent.slice(0, 180),
        explanation: `The screenplay removes the character's present role without reconciling it with "${fact.statement}".`,
        suggestedCorrection: "Keep the character's present action, or explain how both the absence and the present role are true.",
        requiresCanonAuthorization: true,
      }));
    }

    const broken = brokenLink(fact, names, input.screenplayText);
    if (broken) {
      findings.push(makeFinding({
        algorithm: "agreement",
        severity: "ERROR",
        category: "causal",
        episode: input.episode,
        evidence: broken.slice(0, 180),
        expected: fact.statement,
        actual: broken.slice(0, 180),
        explanation: `The screenplay keeps the stakes of "${fact.statement}" but removes the canonical character from them.`,
        suggestedCorrection: "Keep the character connected to the event the approved canon assigns to them.",
      }));
    }

    if (STAKE.test(fact.statement)) {
      const stakeTokens = tokens(fact.statement).filter((token) => STAKE.test(token) || token.length >= 4);
      const actsAssert = stakeTokens.filter((token) => asserted.includes(token)).length >= 2;
      if ((input.requireCanonCoverage || actsAssert) && uncovered(stakeTokens.slice(0, 6), ending)) {
        findings.push(makeFinding({
          algorithm: "agreement",
          severity: "ERROR",
          category: "structure",
          episode: input.episode,
          evidence: input.endingText.slice(0, 180),
          expected: fact.statement,
          actual: input.endingText.slice(0, 180) || "The ending does not contain the stake.",
          explanation: `The climax drops the protected stake "${fact.statement}".`,
          suggestedCorrection: "Restore the confrontation, choice, or uncertainty the approved canon requires in the ending.",
        }));
      }
    }
  }

  return findings;
}

function coverageFinding(fact: NarrativeFact, episode: number, missing: string, explanation: string): NarrativeFinding {
  return makeFinding({
    algorithm: "agreement",
    severity: "ERROR",
    category: "continuity",
    episode,
    evidence: missing,
    expected: fact.statement,
    actual: `Missing from the screenplay: ${missing}`,
    explanation,
    suggestedCorrection: "Dramatize or explicitly establish the canonical fact in the screenplay.",
  });
}

function uncovered(factTokens: string[], haystack: string): string | null {
  if (factTokens.length === 0) return null;
  const missing = factTokens.filter((token) => !haystack.includes(token));
  const needed = Math.min(2, factTokens.length);
  const present = factTokens.length - missing.length;
  if (present >= needed) return null;
  return missing.slice(0, 4).join(", ");
}

function deniesFact(fact: NarrativeFact, names: string[], text: string): string | null {
  const role = ROLES.find((item) => fact.statement.toLocaleLowerCase().includes(item));
  const subject = names.find((name) => fact.statement.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  if (!role || !subject) return null;
  const pattern = new RegExp(`\\b${subject}\\b[^.?!\\n]{0,80}\\b(not|never|n't)\\b[^.?!\\n]{0,40}\\b${role}\\b`, "i");
  return pattern.exec(text)?.[0] ?? null;
}

function callerDrift(fact: NarrativeFact, names: string[], text: string): string | null {
  if (!CALL.test(fact.statement)) return null;
  const subject = names.find((name) => fact.statement.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  if (!subject) return null;
  for (const sentence of splitSentences(text)) {
    if (!CALL.test(sentence)) continue;
    if (sentence.toLocaleLowerCase().includes(subject.toLocaleLowerCase())) continue;
    if (/\b(anonymous|stranger|unknown|unrelated)\b/i.test(sentence)) return sentence;
  }
  return null;
}

function absentPresentRole(fact: NarrativeFact, names: string[], text: string): string | null {
  if (!CALL.test(fact.statement) && !/\bwarns?\b/i.test(fact.statement)) return null;
  const subject = names.find((name) => fact.statement.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  if (!subject) return null;
  const gone = new RegExp(
    `\\b${subject}\\b[^.?!\\n]{0,40}\\b(disappeared|vanished|gone)\\b[^.?!\\n]{0,24}\\b(twelve|12)\\s+years\\b`,
    "i",
  );
  const match = gone.exec(text);
  if (!match) return null;
  const stillActs = splitSentences(text).some((sentence) =>
    sentence.toLocaleLowerCase().includes(subject.toLocaleLowerCase()) && (CALL.test(sentence) || /\bwarns?\b/i.test(sentence)),
  );
  return stillActs ? null : match[0];
}

function brokenLink(fact: NarrativeFact, names: string[], text: string): string | null {
  if (!/\b(sacrifice|ritual)\b/i.test(fact.statement)) return null;
  const mentioned = names.filter((name) => fact.statement.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  if (mentioned.length === 0) return null;
  const stakeSentences = splitSentences(text).filter((sentence) => /\b(sacrifice|ritual)\b/i.test(sentence));
  if (stakeSentences.length === 0) return null;
  const linked = stakeSentences.some((sentence) =>
    mentioned.every((name) => sentence.toLocaleLowerCase().includes(name.toLocaleLowerCase())),
  );
  if (linked) return null;
  if (!mentioned.some((name) => text.toLocaleLowerCase().includes(name.toLocaleLowerCase()))) return null;
  return stakeSentences[0] ?? null;
}

const PROMISED = ["map", "compartment", "countdown", "unlock", "unlocks", "unlocked", "victim", "warning", "warnings", "ledger"];
const MECHANISM = /\b(disappears?|disappearances?|erases?|erased|vanishes?|vanished)\b/i;
const CHOICE = /whether to ([^.?!]+) or ([^.?!]+)/i;
const KEY_COMPANIONS = ["unlock", "compartment", "countdown"];
const SLUG = new Set([
  "morning", "evening", "afternoon", "midnight", "continuous", "interior", "exterior",
  "upstairs", "downstairs", "basement", "chamber", "kitchen", "bedroom", "hallway",
  "outside", "sunrise", "sunset", "living", "family", "street", "secret", "front",
]);

/**
 * Compare a draft with itself. These checks do not need a Story Bible.
 * A promised beat, choice, or cause that the screenplay never plays is an error.
 */
export function draftConsistencyFindings(input: {
  episode: number;
  title: string;
  synopsis: string;
  acts: StoryStructure | null;
  scenes: { sceneNumber: number; heading: string; visualDescription: string; action: string; dialogue: string }[];
}): NarrativeFinding[] {
  const findings: NarrativeFinding[] = [];
  const beats = beatTexts(input.acts);
  const promisedText = [input.synopsis, ...beats].join("\n");
  const screenplay = input.scenes.map((scene) => [scene.heading, scene.visualDescription, scene.action, scene.dialogue].join("\n")).join("\n");
  const action = input.scenes.map((scene) => scene.action).join("\n");
  const screenplayLower = screenplay.toLocaleLowerCase();

  const missing = [...new Set(PROMISED.filter((word) =>
    beats.some((beat) => hasWord(beat, word)) && !hasWord(screenplay, word),
  ))];
  if (missing.length > 0) {
    findings.push(draftFinding(
      input.episode,
      "draft_agreement",
      missing.join(", "),
      `The acts promise ${missing.join(", ")}, and the screenplay never establishes them.`,
      "Dramatize each promised beat in the screenplay, or remove it from the acts.",
    ));
  }

  const interval = proposedIntervalConflict(promisedText, screenplay);
  if (interval) {
    findings.push(draftFinding(
      input.episode,
      "world_rules",
      interval.proposed,
      `The screenplay changes the interval from "${interval.expected}" to "${interval.proposed}".`,
      "Keep the interval stated by the premise, or request authorization to change it.",
    ));
  }

  if (MECHANISM.test(promisedText) && !MECHANISM.test(action)) {
    findings.push(draftFinding(
      input.episode,
      "draft_mechanism",
      promisedText.match(MECHANISM)?.[0] ?? "disappearance",
      "The story states a disappearance or erasure, but no scene shows it happening.",
      "Show the disappearance in a scene's action. Stating the rule in dialogue does not establish it.",
    ));
  }

  const choice = CHOICE.exec(input.synopsis) ?? CHOICE.exec(beats.join("\n"));
  if (choice) {
    const left = contentWords(choice[1] ?? "");
    const right = contentWords(choice[2] ?? "");
    const leftMissing = left.length > 0 && left.every((word) => !screenplayLower.includes(word));
    const rightMissing = right.length > 0 && right.every((word) => !screenplayLower.includes(word));
    if (leftMissing || rightMissing) {
      findings.push(draftFinding(
        input.episode,
        "draft_choice",
        choice[0].slice(0, 180),
        "The synopsis states a choice, and the screenplay does not dramatize it.",
        "Play the decision on screen, including what the character gives up or refuses.",
      ));
    }
  }

  const companions = KEY_COMPANIONS.filter((word) => hasWord(promisedText, word) || (word === "unlock" && hasWord(promisedText, "unlocks")));
  if (hasWord(promisedText, "key") && companions.length > 0) {
    const unmet = companions.filter((word) => !hasWord(screenplay, word) && !(word === "unlock" && hasWord(screenplay, "unlocks")));
    if (!hasWord(screenplay, "key") || unmet.length > 0) {
      findings.push(draftFinding(
        input.episode,
        "draft_causality",
        unmet.join(", ") || "key",
        "The story promises a key that opens or triggers something, and the screenplay does not show that cause.",
        "Show where the key comes from, what it opens, and what that action causes.",
      ));
    }
  }

  for (const scene of input.scenes) {
    if (samePassage(scene.visualDescription, scene.action)) {
      findings.push(draftFinding(
        input.episode,
        "scene_action",
        scene.visualDescription.slice(0, 180),
        `Scene ${scene.sceneNumber} repeats its description as the action and does not add a dramatic event.`,
        "Replace the repeated description with the event that changes the scene.",
        scene.sceneNumber,
      ));
    }
  }

  const names = properNouns(`${input.title}. ${input.synopsis}`);
  for (const scene of input.scenes) {
    for (const token of headingWords(scene.heading)) {
      if (names.some((name) => name.toLocaleLowerCase() === token)) continue;
      const near = names.find((name) => {
        const canonical = name.toLocaleLowerCase();
        if (canonical.length < 8 || token.length < 8) return false;
        return editDistance(canonical, token) <= 2;
      });
      if (!near) continue;
      findings.push(draftFinding(
        input.episode,
        "place_name",
        token,
        `Scene ${scene.sceneNumber} spells ${near} as ${token}.`,
        "Use the same place and character names in the screenplay as in the synopsis.",
        scene.sceneNumber,
      ));
      break;
    }
  }

  return findings;
}

function draftFinding(
  episode: number,
  algorithm: string,
  evidence: string,
  explanation: string,
  suggestedCorrection: string,
  sceneNumber?: number,
): NarrativeFinding {
  return makeFinding({
    algorithm,
    severity: "ERROR",
    category: "structural",
    episode,
    ...(sceneNumber ? { sceneNumber } : {}),
    evidence,
    expected: "The screenplay plays the story the synopsis and acts tell.",
    actual: evidence,
    explanation,
    suggestedCorrection,
  });
}

function beatTexts(structure: StoryStructure | null): string[] {
  if (!structure) return [];
  return [
    structure.act1.incitingIncident,
    structure.act2.risingTension,
    structure.act2.obstacles,
    structure.act2.characterDecisions,
    structure.act2.turningPoint,
    structure.act3.climax,
    structure.act3.resolution,
    structure.act3.finalOutcome,
  ];
}

function contentWords(value: string): string[] {
  return [...new Set(normalizeName(value).split(" ").filter((word) => word.length >= 6 && !STOP.has(word)))];
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(text);
}

function samePassage(left: string, right: string): boolean {
  const a = left.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const b = right.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  if (a.length < 40 || b.length < 40) return false;
  return a === b;
}

function properNouns(text: string): string[] {
  return [...new Set(text.match(/\b[A-Z][a-z]{6,}\b/g) ?? [])];
}

function headingWords(heading: string): string[] {
  return heading
    .split(/[^A-Za-z]+/)
    .map((word) => word.toLocaleLowerCase())
    .filter((word) => word.length >= 7 && !SLUG.has(word));
}

function editDistance(left: string, right: string): number {
  if (Math.abs(left.length - right.length) > 1) return 2;
  const rows = left.length + 1;
  const columns = right.length + 1;
  const grid = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  for (let row = 0; row < rows; row += 1) grid[row]![0] = row;
  for (let column = 0; column < columns; column += 1) grid[0]![column] = column;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      grid[row]![column] = Math.min(
        grid[row - 1]![column]! + 1,
        grid[row]![column - 1]! + 1,
        grid[row - 1]![column - 1]! + cost,
      );
    }
  }
  return grid[left.length]![right.length]!;
}

function tokens(value: string): string[] {
  return [...new Set(normalizeName(value).split(" ").filter((word) => word.length >= 4 && !STOP.has(word)))];
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
