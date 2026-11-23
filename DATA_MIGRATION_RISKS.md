# Data Migration Risks

**Date:** 2026-11-23
**Status:** Stage 0 forensic audit (read-only)

---

## 1. Risk Assessment Overview

The restructuring involves **schema changes** (consolidating canon registries, simplifying job types) and **feature retirement** (removing ASPO, canon locks, outbox). The primary risk is **data loss or corruption** of existing project data in MongoDB.

### Current Data Footprint
- **Database:** MongoDB Atlas (`cluster0.1sllugk.mongodb.net`)
- **Collections:** ~25+ collections (one per model + system collections)
- **Tenant scoping:** All collections scoped by `clerkUserId`
- **Versioning:** StoryBible, Story, SeasonPlan have versioned documents

---

## 2. Migration Risk by Area

### 2.1 Canon Registry Consolidation — **HIGH RISK**

**Current state:** 6 separate registries
- `NarrativeCanon` (append-only canon store)
- `CanonFact` (append-only fact log)
- `ContinuityLedger` (staleness tracking)
- `NarrativeRegistry` (entity registry)
- `CanonicalRegistry` (canonical entity registry)
- `NarrativeGraph` (relationship graph)

**Target state:** 1-2 consolidated stores
- `Canon` (consolidated canon store with facts)
- `CanonicalEntity` (entity registry)

**Risks:**
| Risk | Severity | Mitigation |
|------|----------|------------|
| Loss of continuity/staleness tracking data | Medium | Export ContinuityLedger data before retirement; store as metadata on artifacts |
| Loss of relationship graph data | Low | NarrativeGraph likely has minimal data; export and archive |
| Duplicate entity references after merge | Medium | Deduplication script: match by `clerkUserId + projectId + entityName` |
| References to retired collections in code | High | Full code search before removal; update all references |
| Existing projects with canon data become orphaned | High | Migration script: copy data from old collections to new `Canon` collection |

**Migration plan:**
1. Create new `Canon` collection with merged schema
2. Write migration script: read from `NarrativeCanon` + `CanonFact`, write to `Canon`
3. Write migration script: read from `NarrativeRegistry` + `CanonicalRegistry`, write to `CanonicalEntity`
4. Export `ContinuityLedger` and `NarrativeGraph` to JSON archive files
5. Update all code references
6. Drop old collections only after verification

### 2.2 Canon Infrastructure Retirement — **MEDIUM RISK**

**Current state:**
- `CanonLock` (fencing-token locks)
- `CanonExtractionOutbox` (transactional outbox)

**Target state:** Removed (synchronous canon extraction)

**Risks:**
| Risk | Severity | Mitigation |
|------|----------|------------|
| In-flight outbox entries lost | Medium | Process all outbox entries before retirement |
| In-flight locks cause deadlock | Low | Clear all locks before retirement |
| Code references to lock/outbox | Medium | Full code search, update all references |

**Migration plan:**
1. Process all pending `CanonExtractionOutbox` entries
2. Clear all `CanonLock` documents
3. Update code to use synchronous canon extraction
4. Drop `CanonLock` and `CanonExtractionOutbox` collections

### 2.3 BullMQ Job Simplification — **LOW RISK**

**Current state:** 5 queues, 21 job types
**Target state:** 3 queues, ~8-10 job types

**Risks:**
| Risk | Severity | Mitigation |
|------|----------|------------|
| In-flight jobs lost | Low | Drain all queues before restructuring |
| Job history lost | Low | BullMQ jobs are ephemeral; no migration needed |
| Worker code references removed job types | Medium | Update worker code, remove handlers for retired job types |

**Migration plan:**
1. Pause all queues
2. Wait for in-flight jobs to complete (or fail gracefully)
3. Update worker code with simplified job types
4. Resume queues

### 2.4 LLM Provider Simplification — **LOW RISK**

**Current state:** 10 provider adapters, ASPO selection
**Target state:** Simplified provider list, no ASPO

**Risks:**
| Risk | Severity | Mitigation |
|------|----------|------------|
| Existing generation configs reference retired providers | Low | Providers are config-driven; update `.env` |
| ASPO health data lost | Low | Ephemeral; no migration needed |
| Provider-specific data in GenerationJob | Low | GenerationJob stores provider name as string; no schema change |

**Migration plan:**
1. Update `.env` with simplified provider list
2. Remove ASPO code
3. Update StoryProviderManager to use simple priority list
4. No data migration needed

### 2.5 Stage Workflow Modification — **MEDIUM RISK**

**Current state:** Strict 5-stage sequential workflow with gating
**Target state:** Optional stages, manual override, import capability

**Risks:**
| Risk | Severity | Mitigation |
|------|----------|------------|
| Existing projects in mid-workflow | Medium | Migration script: set stage to current stage, allow manual progression |
| Stage gate logic bypassed | Low | Gates become advisory, not blocking |
| Versioned documents reference stage state | Medium | Ensure version metadata is preserved |

**Migration plan:**
1. Add `stageOverride` field to `Project` model (default: null)
2. Update stage transition logic to allow override
3. No data migration needed — existing projects continue at current stage

### 2.6 Mock Media Replacement — **LOW RISK**

**Current state:** Mock video and image providers
**Target state:** Real providers OR reframe as pre-production tool

**Risks:**
| Risk | Severity | Mitigation |
|------|----------|------------|
| Existing mock media assets referenced | Low | Mock assets have placeholder URLs; can be left as-is or cleaned up |
| MediaAsset records reference mock data | Low | Add `isMock` flag to MediaAsset; filter in UI |

**Migration plan:**
1. Add `isMock` flag to `MediaAsset` schema
2. Migration script: set `isMock=true` for existing mock assets
3. Implement real providers (or reframe scope)

---

## 3. Collections to Retire

| Collection | Risk | Pre-Retirement Action |
|------------|------|----------------------|
| `ContinuityLedger` | Medium | Export to JSON archive |
| `NarrativeRegistry` | Medium | Merge into `CanonicalEntity` |
| `NarrativeGraph` | Low | Export to JSON archive |
| `CanonLock` | Low | Clear all documents |
| `CanonExtractionOutbox` | Medium | Process all pending entries |
| (S3 storage config) | Low | Remove env vars only |

## 4. Collections to Modify

| Collection | Change | Risk |
|------------|--------|------|
| `Project` | Add `stageOverride` field | Low — additive |
| `MediaAsset` | Add `isMock` flag | Low — additive |
| `NarrativeCanon` | Rename/merge to `Canon` | Medium — requires migration script |
| `CanonFact` | Merge into `Canon` | Medium — requires migration script |
| `CanonicalRegistry` | Rename to `CanonicalEntity` (may already exist) | Low — check for existing |

## 5. Collections to Keep Unchanged

| Collection | Notes |
|------------|-------|
| `Project` | Core, unchanged (additive change only) |
| `StoryBible` | Versioned, unchanged |
| `Story` | Versioned, unchanged |
| `Episode` | Unchanged |
| `SeasonPlan` | Versioned, unchanged |
| `ProductionRun` | Unchanged |
| `ProductionScene` | Unchanged |
| `Timeline` | Unchanged (may add editing fields later) |
| `RenderJob` | Unchanged |
| `AudioSegment` | Unchanged |
| `MediaAsset` | Unchanged (additive change only) |
| `ShotProductionRecord` | Unchanged |
| `CanonicalEntity` | Unchanged (may receive merged data) |
| `VoiceProfile` | Unchanged |
| `GenerationJob` | Unchanged |
| `CostEvent` | Unchanged |
| `StoryEvent` | Unchanged |

---

## 6. Pre-Migration Checklist

Before any schema changes:
- [ ] **Backup MongoDB database** — `mongodump` or Atlas snapshot
- [ ] **Export all canon data** — JSON archives of all 6 registries
- [ ] **Drain all BullMQ queues** — process or fail all in-flight jobs
- [ ] **Clear all canon locks** — remove all `CanonLock` documents
- [ ] **Process all outbox entries** — complete all `CanonExtractionOutbox` items
- [ ] **Record current `.env` configuration** — for rollback
- [ ] **Create git tag** — `pre-restructure-backup` for rollback point
- [ ] **Verify backup integrity** — test restore on local instance

## 7. Rollback Plan

If migration fails:
1. Restore MongoDB from backup
2. Restore `.env` from recorded configuration
3. `git reset --hard pre-restructure-backup`
4. Restart workers
5. Verify application functionality

## 8. Testing Strategy

- **Pre-migration:** Run full test suite (82 files, 1,504 cases) — all must pass
- **During migration:** Run migration scripts in dry-run mode first
- **Post-migration:** Run full test suite + manual verification of:
  - Project listing and creation
  - Story Bible viewing and editing
  - Canon data integrity
  - Production pipeline (audio + render)
  - MCP server (new)

---

## 9. Risk Summary

| Area | Risk Level | Requires Data Migration |
|------|-----------|------------------------|
| Canon registry consolidation | **HIGH** | Yes — merge 6 collections to 2 |
| Canon infrastructure retirement | **MEDIUM** | Yes — process outbox, clear locks |
| BullMQ job simplification | **LOW** | No — drain queues only |
| LLM provider simplification | **LOW** | No — config change only |
| Stage workflow modification | **MEDIUM** | No — additive schema change |
| Mock media replacement | **LOW** | No — additive flag only |

**Overall risk: MEDIUM.** The highest risk is canon data migration. All changes are reversible with a database backup. No data loss is expected if the pre-migration checklist is followed.