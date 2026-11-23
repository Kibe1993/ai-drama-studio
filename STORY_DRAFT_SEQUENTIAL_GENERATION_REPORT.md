# Story Draft Sequential Generation — Implementation Report

## Overview

Redesigned Story Draft generation from a single large LLM request into **six sequential, manageable pieces** with live progress tracking, real cancellation, per-part persistence, and resume capability.

## Motivation

The previous Story Draft engine issued a single `llm.generateStory()` call for the entire screenplay. On local Ollama with `qwen3:4b-instruct-2507-q4_K_M`, this frequently timed out or produced truncated output before all scenes were written. Sequential generation breaks the work into smaller, independently validated pieces that each complete within the provider timeout, while preserving the same downstream revision, critique, and validation pipeline.

## Architecture

### Six Parts

Each part has a defined narrative objective and owns specific three-act structure fields:

| # | Part | Objective | Structure fields owned |
|---|------|-----------|----------------------|
| 1 | `opening` | Setting, protagonist, central situation, initial hook | `act1.introduction`, `act1.mainCharacters`, `act1.setting`, `act1.initialSituation` |
| 2 | `inciting_incident` | Event that disrupts and establishes central conflict | `act1.incitingIncident` |
| 3 | `investigation` | Develop conflict, discoveries, increase tension | `act2.risingTension`, `act2.obstacles`, `act2.characterDecisions` |
| 4 | `escalation` | Deepen mystery, expose contradictions, increase consequences | `act2.turningPoint` |
| 5 | `climax` | Major confrontation, revelation, or decisive event | `act3.climax` |
| 6 | `resolution` | Resolve central movement, respect intended ending | `act3.resolution`, `act3.finalOutcome` |

### Sequential Flow

```
Part 1 (opening) → Part 2 (inciting_incident) → ... → Part 6 (resolution)
     ↓                    ↓                              ↓
  persist state       persist state                 persist state
```

- Parts are generated **strictly sequentially**. The next part does not begin until the previous part is successfully generated, validated, and persisted.
- Each part prompt includes a compact summary of previously completed scenes for continuity.
- Completed parts are **never automatically regenerated**. On resume, the engine skips to the next incomplete part.

### Merge Strategy

After all six parts complete, `mergeParts()` combines them into a single `GeneratedStory`:

- **Title**: from the opening part.
- **Synopsis**: concatenated from all parts, clipped to 2000 characters.
- **Structure**: each field taken from its owning part.
- **Screenplay**: concatenated and renumbered sequentially, capped at 40 scenes.

### State and Fingerprinting

`StoryDraftPartsState` tracks per-part completion, run metadata, and failures. A fingerprint derived from the prompt base (title, idea, genre, bible context, narrative authority, continuity context) validates cached state — if the fingerprint changes, the cache is invalidated and generation starts fresh.

### Cancellation

Cancellation is **real**, not a frontend status flip:

1. **Before each part**: `checkCancellation(jobId)` is called synchronously. If the job is cancelled, generation stops immediately with a `JobError`.
2. **During each part**: a 5-second polling interval calls `checkCancellation`. If cancelled mid-part, an `AbortController` signals the underlying `llm.generateStory()` call to abort.
3. **Cancel endpoint**: `POST /api/generations/[jobId]/cancel` sets `job.status = "cancelled"` in the database. The next polling check or pre-part check picks this up and stops work.

### Progress Reporting

- `onProgress` callback persists `StoryDraftPartsState` to `job.output.storyDraftParts` after each part.
- `onStatus` callback updates the job status message.
- `progressMessage()` produces human-readable text: `"Story Draft: 3 of 6 parts ready"`.
- No fake percentages — only completed parts and current activity are shown.

## Files Changed

### New Files

| File | Purpose |
|------|---------|
| `lib/providers/llm/storyDraftParts.ts` | Core sequential generation: 6-part definitions, `generateStoryDraftParts()`, state parsing, fingerprinting, merging, progress messages, cancellation |
| `app/api/generations/[jobId]/cancel/route.ts` | POST endpoint for job cancellation |
| `tests/story-draft-sequential.test.ts` | 29 tests covering fingerprinting, state parsing, progress messages, sequential generation, resume, cancellation, merge, schema validation |

### Modified Files

| File | Change |
|------|--------|
| `lib/pipeline/storyDraftEngine.ts` | Replaced single `llm.generateStory()` with `generateStoryDraftParts()`; added `checkCancellation` parameter; updated `ProgressWriter` type to accept optional `output` parameter for state persistence |
| `lib/pipeline/live.ts` | Wired `output` parameter to `updateProgress` callback; added `checkCancellation` function that queries job status from database |
| `lib/services/storyDraftService.ts` | Added `cancel` method — validates job ownership, type, and status before setting `status = "cancelled"` |
| `hooks/useStoryDraft.ts` | Added `useCancelStoryDraft` hook |
| `components/workflow/StoryDraftWorkspace.tsx` | Added six-part progress panel (`StoryDraftPartsProgress` component) with per-part ✓/✗/…/○ markers and cancel button |
| `tests/bible-integration.test.ts` | Updated 3 revision-prompt tests to use `prompts[prompts.length - 1]` instead of `prompts[1]` (revision is now the 7th call after 6 parts, not the 2nd) |

## Constraints Honored

- **No new providers or orchestration layer** — uses existing `LLMProvider.generateStory()` interface.
- **No parallel generation** — parts are strictly sequential.
- **No automatic regeneration of completed parts** — resume skips to next incomplete part.
- **No fake progress percentages** — shows completed parts and current activity only.
- **No streaming** — sequential generation does not enable streaming.
- **No Tailwind** — frontend uses existing CSS Modules.
- **No `any` types** — all code is fully typed.
- **No disabled validation** — Zod schemas, canon authority, and continuity enforcement are unchanged.
- **No changes to Story Bible generation** — the Bible sequential pattern was the reference, not a modification target.
- **No prompt/key logging** — `promptDigest()` returns only section names and lengths, never content.

## Verification

| Check | Result |
|-------|--------|
| TypeScript (`tsc --noEmit`) | ✅ Pass |
| ESLint | ✅ No new issues (1 pre-existing error in `tests/narrative-control.test.ts:443`, unmodified) |
| Unit tests (`npm test`) | ✅ 1501 passed, 6 skipped, 1 pre-existing failure (`kokoro-e2e-pipeline.test.ts` requires real MongoDB + Kokoro) |
| Sequential tests | ✅ 29/29 passed |
| Bible integration tests | ✅ 12/12 passed |

## Downstream Pipeline (Unchanged)

The merged `GeneratedStory` flows through the same downstream pipeline as before:

1. **Controlled revision** — `runControlledRevision()` checks canon compliance and calls `llm.generateStory()` with defect-specific revision prompts if needed.
2. **Critique** — `llm.critiqueStory()` performs continuity critique if available.
3. **Validation** — `validateEpisodeScreenplay()` validates the final story against canon, Bible, and scene range.
4. **Persistence** — `upsertProjectDraft()` saves the story with validation findings, contract, and provenance metadata.

None of these stages were modified. The sequential generation change is isolated to the initial story creation step.