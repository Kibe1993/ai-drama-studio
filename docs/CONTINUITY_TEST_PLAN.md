# Continuity Integration Test Plan

## Purpose

This document tracks the regression tests that encode the eight continuity
inconsistencies (I-1 through I-8) identified in the Story Continuity and Canon
Integration audit. Tests live in `tests/continuity-integration/`.

## Test files

| File | Inconsistency | Status |
| --- | --- | --- |
| `i2-character-state-stagnation.test.ts` | I-2: Character state never updates after first appearance | Failing (expected) |
| `i3-canon-projection-gap.test.ts` | I-3: Stored canon never learns later ledger changes | Failing (expected) |
| `i4-hidden-truth-reveal.test.ts` | I-4: Hidden truths can never be revealed | Failing (expected) |
| `i5-prompt-context-loss.test.ts` | I-5: Prompt drops most ledger state | Failing (expected) |
| `i8-cap-and-alias-leaks.test.ts` | I-8: Thread caps drop newest, aliases never populated | Failing (expected) |
| `season-replay.test.ts` | Cross-cutting 10-episode replay | Partially failing (expected) |

## Fixture builders

`fixtures.ts` provides minimal, valid builders for:
- `makeScene` / `makeEpisodeScreenplay` — ScreenplayScene
- `makeEpisodePlanItem` / `makeSeasonPlan` — SeasonPlan and EpisodePlanItem
- `makeStoryBible` — StoryBibleContent
- `makeCharacterState` / `makeLedger` — ContinuityLedger and CharacterState
- `makeEpisodeCanonSummary` — EpisodeCanonSummary
- `makeSeasonPlanRecord` — SeasonPlanRecord (with metadata)

## Inconsistency summary

### I-2: Character state stagnation
**File**: `lib/domain/episodeCanon.ts:93-110`
**Bug**: `buildCharacterStates` uses `previous?.X || ...` (first-value-wins)
for `currentObjective`, `beliefs`, `motivations`, `physicalState`. Once a
character state is set in the ledger, later episodes never update these fields.
**Fix milestone**: M1

### I-3: Canon projection gap
**File**: `lib/domain/narrativeControl/projectCanon.ts:213-260`
**Bug**: `canonFromApprovedSources` does not project `ledger.characterStates`
into CanonState entities or facts. `mergeDerivedCanon` skips existing entity
IDs, so ledger updates never reach the stored canon.
**Fix milestone**: M2

### I-4: Hidden truth reveal
**File**: `lib/domain/narrativeControl/projectCanon.ts:108`
**Bug**: `HIDDEN_TRUTH` facts are created with `audienceRevealEpisode: null`
and never updated when the ledger records the secret as revealed. The context
packet (`context.ts:31-37`) treats `null` as "always hidden".
**Fix milestone**: M2

### I-5: Prompt context loss
**File**: `lib/pipeline/casnaContext.ts:75-96`
**Bug**: `compactCasnaPromptContext` drops `knowledge`, `beliefs`,
`motivations`, `relationships` from character states, and omits
`locationStates` and `objectStates` entirely.
**Fix milestone**: M4

### I-7: Shallow continuity validation
**File**: `lib/domain/screenplayValidation.ts:406-416`
**Bug**: Stage H continuity check is only `jaccard(consequences, fullText) === 0`.
No checks for character location, knowledge, object ownership, or thread status.
**Fix milestone**: M6

### I-8: Cap and alias leaks
**File**: `lib/domain/ledger.ts:69`, `lib/domain/episodeCanon.ts:239`
**Bug**: `mergeThreads` uses `.slice(0, 30)` (drops newest). `buildThreads`
uses `.slice(0, 16)` (same). Entity aliases are never populated.
**Fix milestone**: M1

## 10-episode season replay

`season-replay.test.ts` simulates approving 10 episodes with distinct
character arcs, objectives, and threads. It verifies:
- The ledger accumulates events across all episodes.
- Character objective/physicalState/beliefs evolve (currently fails — I-2).
- Knowledge grows (currently passes — `mergeUnique` works).
- Threads from later episodes are retained (currently fails — I-8).

## Convention

Tests that assert **correct** behavior are marked with `it.fails()` while the
underlying bug is unfixed. When a fix lands in the corresponding milestone,
remove `it.fails()` and the test must pass. Tests that document **current
buggy** behavior use regular `it()` and should be updated or removed when the
fix lands.