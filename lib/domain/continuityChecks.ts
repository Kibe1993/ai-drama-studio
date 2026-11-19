import type { EpisodeValidationFinding } from "@/lib/validation/casna";
import type {
  CharacterState,
  ContinuityLedger,
  ContinuityLocationState,
  ContinuityObjectState,
  UnresolvedThread,
} from "@/lib/validation/continuityLedger";
import type { ScreenplayScene } from "@/lib/validation/story";
import { createHash } from "node:crypto";

/**
 * Pure continuity checks for CASNA Stage H. Each function examines one facet
 * of the Continuity Ledger against the screenplay and returns advisory
 * findings (severity "warning"). The checks are deterministic, side-effect
 * free, and independently unit-testable.
 *
 * These augment — they do not replace — the existing consequence-overlap
 * jaccard check in {@link validateEpisodeScreenplay}.
 */

function normalize(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length > 2);
}

function wordSet(value: string): Set<string> {
  return new Set(tokens(value));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Fraction of `needle` tokens that appear in `haystack`. Unlike jaccard this
 * is not diluted by boilerplate in the haystack, making it suitable for
 * checking whether a short thread or secret phrase is referenced in a long
 * scene text.
 */
function coverage(needle: Set<string>, haystack: Set<string>): number {
  if (needle.size === 0) return 0;
  let covered = 0;
  for (const token of needle) if (haystack.has(token)) covered += 1;
  return covered / needle.size;
}

function sceneText(scene: ScreenplayScene): string {
  return [
    scene.heading,
    scene.action,
    scene.visualDescription,
    ...scene.dialogue.map((line) => line.line),
  ].join(" ");
}

function findingId(category: string, key: string, sceneNumber?: number): string {
  return createHash("sha256")
    .update([category, key.slice(0, 200), String(sceneNumber ?? "")].join("|"))
    .digest("hex")
    .slice(0, 16);
}

function namesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  if (na && nb && (na.includes(nb) || nb.includes(na))) return true;
  const partsA = na.split(" ").filter((p) => p.length >= 3);
  const partsB = nb.split(" ").filter((p) => p.length >= 3);
  return partsA.some((pa) => partsB.includes(pa));
}

// ---------------------------------------------------------------------------
// 1. Character-location consistency
// ---------------------------------------------------------------------------

/**
 * Warns when a character appears in a scene whose location does not match the
 * `currentLocation` recorded in the ledger, and the screenplay gives no
 * indication of a transition. This catches teleportation between episodes
 * without an establishing beat.
 */
export function characterLocationFindings(
  characterStates: CharacterState[],
  screenplay: ScreenplayScene[],
): EpisodeValidationFinding[] {
  const findings: EpisodeValidationFinding[] = [];
  for (const state of characterStates) {
    const firstScene = screenplay.find((scene) =>
      scene.charactersPresent.some((present) => namesMatch(present, state.name)),
    );
    if (!firstScene) continue;
    if (namesMatch(firstScene.location, state.currentLocation)) continue;
    const priorText = screenplay
      .filter((scene) => scene.sceneNumber <= firstScene.sceneNumber)
      .map(sceneText)
      .join(" ");
    const ledgerLocTokens = wordSet(state.currentLocation);
    const priorTokens = wordSet(priorText);
    if (jaccard(ledgerLocTokens, priorTokens) > 0) continue;
    const key = `character-location:${normalize(state.name)}`;
    findings.push({
      id: findingId("continuity", key, firstScene.sceneNumber),
      category: "continuity",
      severity: "warning",
      code: "character_location_mismatch",
      sceneNumber: firstScene.sceneNumber,
      message: `"${state.name}" is at "${firstScene.location}" in scene ${firstScene.sceneNumber} but the Continuity Ledger last recorded them at "${state.currentLocation}". No transition is shown.`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 2. Resolved-thread reopened
// ---------------------------------------------------------------------------

const QUESTION_MARKERS = new Set([
  "what", "why", "who", "how", "where", "when", "could", "would", "is",
  "are", "did", "does", "will", "can", "should", "really", "truly",
]);

/**
 * Warns when a thread marked `resolved` in the ledger is mentioned in the
 * screenplay with question-like language, suggesting the thread is being
 * reopened instead of treated as settled.
 */
export function resolvedThreadFindings(
  threads: UnresolvedThread[],
  screenplay: ScreenplayScene[],
): EpisodeValidationFinding[] {
  const findings: EpisodeValidationFinding[] = [];
  const resolved = threads.filter((thread) => thread.status === "resolved");
  if (resolved.length === 0) return findings;
  for (const scene of screenplay) {
    const text = normalize(sceneText(scene));
    const textTokens = new Set(tokens(sceneText(scene)));
    for (const thread of resolved) {
      const threadTokenSet = new Set(tokens(thread.thread));
      if (threadTokenSet.size === 0) continue;
      const cov = coverage(threadTokenSet, textTokens);
      if (cov < 0.5) continue;
      const hasQuestion = text.includes("?") ||
        [...threadTokenSet].some((token) => QUESTION_MARKERS.has(token));
      if (!hasQuestion) continue;
      const key = `resolved-thread-reopened:${normalize(thread.thread)}`;
      findings.push({
        id: findingId("continuity", key, scene.sceneNumber),
        category: "continuity",
        severity: "warning",
        code: "resolved_thread_reopened",
        sceneNumber: scene.sceneNumber,
        message: `Scene ${scene.sceneNumber} references a thread marked resolved in the ledger ("${thread.thread.slice(0, 80)}"). Reopening a resolved thread may confuse the audience.`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 3. Location-state consistency
// ---------------------------------------------------------------------------

const TERMINAL_LOCATION_WORDS = new Set([
  "destroyed", "burned", "burnt", "abandoned", "empty", "closed", "ruined",
  "demolished", "wrecked", "collapsed", "gone", "vacant", "deserted",
]);

const ACTIVE_LOCATION_WORDS = new Set([
  "bustling", "full", "open", "intact", "new", "crowded", "busy", "alive",
  "bright", "warm", "filled", "stocked", "operational", "restored",
]);

/**
 * Warns when a location's ledger `currentState` records a terminal condition
 * (destroyed, abandoned, etc.) but a scene at that location describes it as
 * active or intact.
 */
export function locationStateFindings(
  locationStates: ContinuityLocationState[],
  screenplay: ScreenplayScene[],
): EpisodeValidationFinding[] {
  const findings: EpisodeValidationFinding[] = [];
  for (const locState of locationStates) {
    const stateTokens = tokens(locState.currentState);
    const isTerminal = stateTokens.some((token) => TERMINAL_LOCATION_WORDS.has(token));
    if (!isTerminal) continue;
    for (const scene of screenplay) {
      if (!namesMatch(scene.location, locState.name)) continue;
      const visualTokens = tokens(scene.visualDescription);
      const hasActive = visualTokens.some((token) => ACTIVE_LOCATION_WORDS.has(token));
      if (!hasActive) continue;
      const key = `location-state:${normalize(locState.name)}`;
      findings.push({
        id: findingId("continuity", key, scene.sceneNumber),
        category: "continuity",
        severity: "warning",
        code: "location_state_contradiction",
        sceneNumber: scene.sceneNumber,
        message: `Scene ${scene.sceneNumber} describes "${scene.location}" as active, but the Continuity Ledger records its state as "${locState.currentState}".`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 4. Object-ownership consistency
// ---------------------------------------------------------------------------

/**
 * Warns when an object whose `ownership` in the ledger is a specific character
 * is referenced in a scene's dialogue by a different character while the owner
 * is not present. This catches objects being used by non-owners without
 * explanation.
 */
export function objectOwnershipFindings(
  objectStates: ContinuityObjectState[],
  screenplay: ScreenplayScene[],
): EpisodeValidationFinding[] {
  const findings: EpisodeValidationFinding[] = [];
  for (const objState of objectStates) {
    const ownerTokens = tokens(objState.ownership);
    if (ownerTokens.length === 0) continue;
    const objectName = normalize(objState.name);
    if (!objectName) continue;
    for (const scene of screenplay) {
      const ownerPresent = scene.charactersPresent.some((present) =>
        namesMatch(present, objState.ownership),
      );
      if (ownerPresent) continue;
      for (const line of scene.dialogue) {
        if (namesMatch(line.characterName, objState.ownership)) continue;
        const lineText = normalize(line.line);
        if (!lineText.includes(objectName)) continue;
        const key = `object-ownership:${objectName}:${normalize(line.characterName)}`;
        findings.push({
          id: findingId("continuity", key, scene.sceneNumber),
          category: "continuity",
          severity: "warning",
          code: "object_ownership_mismatch",
          sceneNumber: scene.sceneNumber,
          message: `"${line.characterName}" references "${objState.name}" in scene ${scene.sceneNumber}, but the Continuity Ledger records it as owned by "${objState.ownership}" who is not present.`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 5. Character-knowledge consistency (re-revelation)
// ---------------------------------------------------------------------------

const REVELATION_MARKERS = [
  "reveals that", "the truth is", "discovers that", "finds out that",
  "turns out", "the secret is", "confesses that", "admits that",
];

/**
 * Warns when a secret already recorded in the ledger's `revealedSecrets` is
 * treated as a new revelation in the screenplay. This catches re-revealing
 * information the audience already knows.
 */
export function revealedSecretFindings(
  revealedSecrets: string[],
  screenplay: ScreenplayScene[],
): EpisodeValidationFinding[] {
  const findings: EpisodeValidationFinding[] = [];
  if (revealedSecrets.length === 0) return findings;
  const fullText = normalize(screenplay.map(sceneText).join(" "));
  for (const secret of revealedSecrets) {
    const secretTokens = tokens(secret);
    if (secretTokens.length === 0) continue;
    for (const marker of REVELATION_MARKERS) {
      const markerIndex = fullText.indexOf(marker);
      if (markerIndex === -1) continue;
      const window = fullText.slice(markerIndex, markerIndex + 300);
      const windowTokens = new Set(tokens(window));
      const cov = coverage(new Set(secretTokens), windowTokens);
      if (cov < 0.5) continue;
      const key = `re-revelation:${normalize(secret)}`;
      findings.push({
        id: findingId("continuity", key),
        category: "continuity",
        severity: "warning",
        code: "secret_re_revealed",
        message: `The screenplay presents "${secret.slice(0, 80)}" as a new revelation, but the Continuity Ledger already records it as revealed.`,
      });
      break;
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/**
 * Run all continuity checks against the ledger and screenplay. Returns the
 * combined list of advisory findings. Each sub-check is independent; a failure
 * in one does not suppress the others.
 */
export function continuityCheckFindings(
  ledger: ContinuityLedger,
  screenplay: ScreenplayScene[],
): EpisodeValidationFinding[] {
  return [
    ...characterLocationFindings(ledger.characterStates, screenplay),
    ...resolvedThreadFindings(ledger.unresolvedThreads, screenplay),
    ...locationStateFindings(ledger.locationStates, screenplay),
    ...objectOwnershipFindings(ledger.objectStates, screenplay),
    ...revealedSecretFindings(ledger.revealedSecrets, screenplay),
  ];
}