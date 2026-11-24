# Production Pipeline Architecture

> Recommended production pipeline, stage relationships, data ownership, document/asset relationships, canon integration, approval workflow, and MCP collaboration architecture.

## 1. Recommended Production Pipeline

The existing 6 run-scoped stages (story → characters → scenes → media → render → done) are too coarse for a complete production environment. The recommended pipeline has **13 stages** grouped into **4 phases**:

### Phase A — Creative Development (Stages 1-3)
1. **Project Initiation** — Title, idea, genre, language, production settings
2. **Creative Planning** — Concept, themes, premise, audience, conflict, narrative direction
3. **Story Bible** — Premise, synopsis, world, characters, relationships, rules, continuity requirements

### Phase B — Structural Development (Stages 4-8)
4. **Season & Episode Planning** — Series overview, season arcs, episode outlines, cliffhangers
5. **Characters & Locations** — Profiles, descriptions, relationships, visual/voice references, world rules
6. **Scene Breakdown** — Scene numbering, objectives, locations, characters, emotional progression
7. **Screenplay** — Scene headings, action, dialogue, transitions, voice-over, narration
8. **Canon & Continuity** — Facts, events, timeline, contradictions, approvals (cross-cutting)

### Phase C — Production (Stages 9-12)
9. **Production Design** — Visual references, shot lists, camera directions, lighting, storyboards
10. **Audio Production** — Voice assignments, dialogue, narration, music, SFX, ambient
11. **Video & Animation** — Scene video, shot footage, animation, imported footage
12. **Timeline & Editing** — Tracks, clips, trimming, transitions, sync, assembly

### Phase D — Output (Stage 13)
13. **Rendering & Export** — Configuration, progress, history, final output, export

### Stage Ordering Rationale

- **Canon is cross-cutting** (Stage 8): It runs throughout, not just after screenplay. Every stage can propose canon facts.
- **Characters/Locations after Season Plan** (Stage 5 after 4): Episode structure determines which characters and locations are needed.
- **Scene Breakdown before Screenplay** (Stage 6 before 7): Scenes provide the structural skeleton that screenplays fill.
- **Production Design after Screenplay** (Stage 9 after 7): Visual design needs the screenplay's scene descriptions.
- **Stages can overlap**: Production design can start while screenplay is being revised. Audio can start while video is being generated. The pipeline is not strictly linear.

## 2. Stage Relationships

```
Stage 1 (Project Init)
  └── Stage 2 (Creative Planning)
       └── Stage 3 (Story Bible) ──→ [Canon starts tracking]
            └── Stage 4 (Season/Episode Plan)
                 ├── Stage 5 (Characters/Locations) ←── Canon
                 │    └── Stage 6 (Scene Breakdown)
                 │         └── Stage 7 (Screenplay) ←── Canon
                 │              ├── Stage 8 (Canon Review) ──→ [Canon updates]
                 │              └── Stage 9 (Production Design)
                 │                   ├── Stage 10 (Audio)
                 │                   └── Stage 11 (Video)
                 │                        └── Stage 12 (Timeline)
                 │                             └── Stage 13 (Render)
                 └── [Canon continues tracking across all stages]
```

**Key relationships:**
- Stage 3 → Stage 4: Bible approval required before planning
- Stage 4 → Stage 5: Episode structure determines character/location needs
- Stage 5 → Stage 6: Characters/locations must exist before scene breakdown
- Stage 6 → Stage 7: Scenes provide screenplay structure
- Stage 7 ↔ Stage 8: Screenplay and canon review iterate
- Stage 7 → Stage 9: Screenplay drives production design
- Stages 9-11 can overlap (parallel production)
- Stage 11 → Stage 12: Video assets needed for timeline
- Stage 12 → Stage 13: Approved timeline needed for render

## 3. Data Ownership

| Data Domain | Owner | Storage | Versioning |
|-------------|-------|---------|------------|
| Project config | AI Drama Studio | MongoDB `projects` | Status transitions |
| Creative planning | AI Drama Studio | MongoDB (new collection) | Document versions |
| Story Bible | AI Drama Studio | MongoDB `storybibles` | Version + draft revision |
| Season Plan | AI Drama Studio | MongoDB `seasonplans` | Version history |
| Episodes | AI Drama Studio | MongoDB `episodes` | Status tracking |
| Characters/Locations | AI Drama Studio | MongoDB `canonicalentities` | Approval status |
| Scenes | AI Drama Studio | MongoDB `productionscenes` | Run-scoped |
| Screenplay | AI Drama Studio | MongoDB `stories` | Status + findings |
| Canon | AI Drama Studio | MongoDB `narrativecanons` + append-only log | Versioned snapshots |
| Media assets | AI Drama Studio | MongoDB `mediaassets` + storage | Review status |
| Audio segments | AI Drama Studio | MongoDB `audiosegments` | Processing status |
| Timeline | AI Drama Studio | MongoDB `timelines` | Approval status |
| Render jobs | AI Drama Studio | MongoDB `renderjobs` | Job status |
| Activity log | AI Drama Studio | MongoDB (new collection) | Append-only |

**External assistants never own data.** They propose changes through MCP; the creator approves; AI Drama Studio persists.

## 4. Document and Asset Relationships

```
Project
  ├── Creative Planning Documents
  ├── Story Bible (versioned)
  │    └── Canon Facts (established by bible)
  ├── Season Plan (versioned)
  │    └── Episode Outlines
  ├── Episodes
  │    ├── Screenplay (story draft)
  │    ├── Scenes
  │    │    ├── Shot Plans
  │    │    └── Production Assets (video, audio, image)
  │    ├── Timeline
  │    │    ├── Tracks (video, dialogue, narration, music, sfx, subtitle)
  │    │    └── Clips (reference media assets)
  │    └── Render Jobs
  ├── Canonical Entities
  │    ├── Characters (profile, visual, voice)
  │    ├── Locations (profile, visual)
  │    └── Objects (profile, visual)
  ├── Canon State (versioned)
  │    ├── Facts
  │    ├── Events
  │    ├── Relationships
  │    └── Rules
  ├── Media Assets
  │    ├── Character references
  │    ├── Location references
  │    ├── Scene images
  │    ├── Scene videos
  │    ├── Dialogue audio
  │    ├── Narration audio
  │    ├── Music
  │    ├── Sound effects
  │    └── Final renders
  └── Activity Log
```

**Linking rules:**
- Every scene references its episode, characters, and locations
- Every clip references a media asset
- Every canon fact references its source document
- Every media asset can reference a canonical entity (character/location/object)
- Every activity entry references the tool, user, project, and result

## 5. Canon Integration

Canon is **cross-cutting** — it runs throughout the pipeline, not as an isolated stage.

### Canon Sources
1. **Story Bible approval** → establishes world rules, character facts, relationships
2. **Season Plan approval** → establishes arc developments, thread introductions
3. **Episode approval** → establishes events, character state changes, revelations
4. **Screenplay approval** → establishes dialogue facts, scene events
5. **MCP `canon.add`** → assistant-proposed facts (require approval)

### Canon Flow
```
Document Draft → Submit for Review → Creator Approval → Canon Extraction → Canon Commit
     ↑                                                                    ↓
     ← ← ← ← ← ← Conflict Detection ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ←
```

### Canon Authority Rules
1. Only approved documents can establish canon
2. Canon changes require explicit approval (never silent)
3. Canon history is preserved (append-only log + versioned snapshots)
4. Contradictions are detected and surfaced for resolution
5. The latest approved canon is available to all assistants via MCP
6. Canon facts link to their source documents (provenance)

## 6. Approval Workflow

### Document Lifecycle
```
Draft → Proposed → Submitted for Review → Approved → Production-Ready
                                    ↓
                               Rejected → Revision Requested → Draft
                                    ↓
                              Superseded (by newer version)
```

### Approval Gates
| Gate | Trigger | Required Before | Effect |
|------|---------|-----------------|--------|
| Story Bible Approval | Creator approves bible | Season planning | Canon v1 established |
| Story Draft Approval | Creator approves story | Season plan | Story marked approved |
| Season Plan Approval | Creator approves plan | Episode development | Plan version locked |
| Episode Approval | Creator approves episode | Next episode | Canon updated |
| Entity Approval | Creator approves entity | Canon reference | Entity becomes canonical |
| Timeline Approval | Creator approves timeline | Rendering | Render gate unlocked |
| Shot Plan Approval | Creator approves shots | Shot production | Shot gate unlocked |
| Canon Fact Approval | Creator approves fact | Canon update | Fact added to canon |

### Concurrent Change Detection
- **Optimistic locking**: `expectedVersion` / `expectedDraftRevision` on all approval operations
- **Version conflicts**: If version mismatch, operation fails with conflict error
- **No silent overwrites**: Assistants must re-fetch and re-submit on conflict

## 7. MCP Collaboration Architecture

### Shared Project State
```
┌─────────────────────────────────────────────────┐
│              AI Drama Studio                     │
│  ┌─────────────────────────────────────────┐    │
│  │         Project Data (MongoDB)           │    │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │    │
│  │  │Bible │ │Story │ │Plan  │ │Canon │   │    │
│  │  └──────┘ └──────┘ └──────┘ └──────┘   │    │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │    │
│  │  │Chars │ │Scenes│ │Media │ │Render│   │    │
│  │  └──────┘ └──────┘ └──────┘ └──────┘   │    │
│  └─────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────┐    │
│  │       Service Layer (26 services)        │    │
│  └─────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────┐    │
│  │     MCP Server (42 tools, 9 resources)   │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
         ↑              ↑              ↑
    ┌────┴────┐    ┌────┴────┐    ┌────┴────┐
    │ ChatGPT │    │ Claude  │    │  Kimi   │
    └─────────┘    └─────────┘    └─────────┘
```

### Collaboration Rules
1. **AI Drama Studio is the single source of truth** — assistants never store project data
2. **Assistants retrieve context via MCP** — `project.context` tool provides focused retrieval
3. **Assistants submit changes via MCP** — all writes go through services with approval gates
4. **Different assistants share the same project state** — no private caches
5. **The creator approves all meaningful changes** — assistants cannot bypass approval
6. **Activity is logged** — every MCP operation is tracked for auditability

### MCP Tool Categories
| Category | Tools | Purpose |
|----------|-------|---------|
| Project | 6 | CRUD + contextual retrieval |
| Document | 4 | Read/update/import/export |
| Pipeline | 7 | Orchestrate the production pipeline |
| Entity | 5 | Characters/locations/objects management |
| Episode | 3 | Episode CRUD |
| Scene | 4 | Scene management + shot plans |
| Season Plan | 5 | Plan lifecycle |
| Timeline | 3 | Timeline operations |
| Canon | 3 | Query/add/summary |
| Approval | 2 | Bible + story approval |
| Media | 3 | List/upload/generate |
| Render | 2 | Start/status |
| Activity | 1 | Operation history |
| **Total** | **42** | |