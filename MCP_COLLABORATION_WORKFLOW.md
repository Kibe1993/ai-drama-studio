# MCP Collaboration Workflow

> How external AI assistants (Claude, Kimi, ChatGPT, Gemini, Cline, Qwen) collaborate with AI Drama Studio via MCP to develop dramas across all 13 production stages.

## 1. Collaboration Model

### Core Principle
AI Drama Studio is the **single source of truth**. External assistants are **stateless collaborators** — they retrieve context, propose changes, and never persist data locally. All state lives in MongoDB, accessed exclusively through the MCP server's 42 tools and 9 resources.

### Participants
| Role | Identity | Capabilities |
|------|----------|-------------|
| Creator | Human (Clerk-authenticated) | Approves all changes, configures project, drives UI |
| Lead Assistant | External AI (MCP-connected) | Proposes documents, requests approvals, orchestrates stages |
| Specialist Assistant | External AI (MCP-connected) | Focused tasks (e.g., dialogue polish, canon check, shot planning) |
| AI Drama Studio | Local system | Enforces gates, persists data, runs pipeline, tracks canon |

### Connection Methods
- **HTTP transport** (`/api/mcp`): Production use. Per-user server pool. Clerk session or Bearer token auth.
- **stdio transport** (`npm run mcp:server`): Local development. `MCP_ACTOR_USER_ID` env var identifies the acting user.

---

## 2. Stage-by-Stage Assistant Access

### Stage 1 — Project Initiation
| Action | MCP Tool | Approval | Notes |
|--------|----------|----------|-------|
| Read project | `project.get` | None | |
| Update project config | `project.update` | Creator | |
| Get full context | `project.context` | None | Returns stage-relevant subset |

**Workflow**: Creator creates project in UI. Assistant retrieves context with `project.context` to understand the project's genre, language, and settings.

### Stage 2 — Creative Planning
| Action | MCP Tool | Approval | Notes |
|--------|----------|----------|-------|
| Read planning docs | `document.read` (type: `planning`) | None | **New — requires implementation** |
| Propose concept | `document.update` (type: `planning`) | Creator | **New — requires implementation** |
| Get planning context | `project.context` (stages: `planning`) | None | **New — requires implementation** |

**Workflow**: Assistant proposes concept, themes, premise, audience, and narrative direction. Creator reviews and approves. Approved planning feeds into Story Bible generation.

### Stage 3 — Story Bible
| Action | MCP Tool | Approval | Notes |
|--------|----------|----------|-------|
| Read bible | `document.read` (type: `bible`) / `bible` resource | None | |
| Propose bible section | `document.update` (type: `bible`, section) | Creator | |
| Regenerate section | `pipeline.advance` (stage: `bible`, action: `regenerate`) | Creator | |
| Approve bible | `approval.bible` | Creator | Establishes canon v1 |

**Workflow**: Assistant drafts bible sections (identity, world, characters, narrative, guidelines, canon). Creator reviews each section. On approval, canon v1 is established and the project advances to Season Planning.

### Stage 4 — Season & Episode Planning
| Action | MCP Tool | Approval | Notes |
|--------|----------|----------|-------|
| Read season plan | `document.read` (type: `seasonPlan`) / `season-plan` resource | None | |
| Propose plan | `document.update` (type: `seasonPlan`) | Creator | |
| Validate plan | `pipeline.advance` (stage: `seasonPlan`, action: `validate`) | None | Returns findings |
| Repair plan | `pipeline.advance` (stage: `seasonPlan`, action: `repair`) | Creator | |
| Approve plan | `seasonPlan.approve` | Creator | Locks plan version |
| Create episode | `episode.create` | Creator | |
| Suggest episode | `episode.suggest` | None | AI suggestion, no persistence |

**Workflow**: Assistant proposes season arcs, episode outlines, cliffhangers. Creator reviews. Validation runs 7 validators (structural, climax, progression, setup-payoff, canon, character-state, temporal). Repair engine addresses findings. On approval, episodes are created.

### Stage 5 — Characters & Locations
| Action | MCP Tool | Approval | Notes |
|--------|----------|----------|-------|
| List entities | `entity.list` (type: `character`/`location`/`object`) | None | |
| Read entity | `entity.get` | None | |
| Create entity | `entity.create` | Creator | |
| Update entity | `entity.update` | Creator | |
| Approve entity | `entity.approve` | Creator | Entity becomes canonical |
| Set visual reference | `entity.setDefaultReference` | Creator | |
| Read characters resource | `characters` resource | None | Bulk read |

**Workflow**: Assistant proposes character profiles, relationships, voice descriptions, and location details based on the season plan and story bible. Creator reviews and approves each entity. Approved entities are available for canon reference and scene breakdown.

### Stage 6 — Scene Breakdown
| Action | MCP Tool | Approval | Notes |
|--------|----------|----------|-------|
| List scenes | `scene.list` | None | |
| Read scene | `scene.get` | None | |
| Update scene | `scene.update` | Creator | |
| Propose shot plan | `scene.proposeShotPlan` | Creator | **New — requires implementation** |
| Approve shot plan | `scene.approveShotPlan` | Creator | Unlocks shot production |
| Read scenes resource | `scenes` resource | None | Bulk read |

**Workflow**: Assistant breaks the screenplay into ordered scenes with objectives, locations, characters, and emotional progression. Shot plans are proposed per scene. Creator approves shot plans to unlock production.

### Stage 7 — Screenplay
| Action | MCP Tool | Approval | Notes |
|--------|----------|----------|-------|
| Read story draft | `document.read` (type: `story`) | None | |
| Propose story section | `document.update` (type: `story`, part) | Creator | 6 sequential parts |
| Validate story | `pipeline.advance` (stage: `story`, action: `validate`) | None | Canon validation |
| Repair story | `pipeline.advance` (stage: `story`, action: `repair`) | Creator | |
| Approve story | `approval.story` | Creator | Advances to season plan |

**Workflow**: Story draft is generated in 6 sequential parts (opening, inciting incident, investigation, escalation, climax, resolution). Each part is persisted independently. Canon validation runs after generation. Blocking findings must be resolved before approval.

### Stage 8 — Canon & Continuity
| Action | MCP Tool | Approval | Notes |
|--------|----------|----------|-------|
| Query canon | `canon.query` | None | Filter by type, source, status |
| Add canon fact | `canon.add` | Creator | Assistant-proposed facts require approval |
| Get canon summary | `canon.summary` | None | Overview of current canon state |
| Read canon resource | `canon` resource | None | Structured canon access |

**Workflow**: Canon is cross-cutting. Every document approval can extract canon facts. Assistants can propose additional facts via `canon.add`. Contradictions are detected automatically. Creator resolves contradictions by accepting, rejecting, or requesting revision.

### Stage 9 — Production Design
| Action | MCP Tool | Approval | Notes |
|--------|----------|----------|-------|
| List visual assets | `media.list` (type: `visual`) | None | |
| Upload reference | `media.upload` | Creator | |
| Generate shot list | `scene.proposeShotList` | Creator | **New — requires implementation** |
| Read production design | `document.read` (type: `productionDesign`) | None | **New — requires implementation** |
| Propose production design | `document.update` (type: `productionDesign`) | Creator | **New — requires implementation** |

**Workflow**: Assistant proposes shot lists, camera directions, lighting plans, and storyboard descriptions based on the approved screenplay and scene breakdown. Creator reviews. Visual references are uploaded or generated.

### Stage 10 — Audio Production
| Action | MCP Tool | Approval | Notes |
|--------|----------|----------|-------|
| List audio segments | `media.list` (type: `audio`) | None | |
| Generate TTS | `media.generate` (type: `tts`) | Creator | Kokoro TTS |
| Read voice profiles | `entity.list` (type: `voiceProfile`) | None | |
| Assign voice | `entity.assignVoice` | Creator | **New — requires implementation** |

**Workflow**: Voice profiles are created and assigned to characters. Dialogue and narration are sent to Kokoro TTS. Segments are generated, reviewed, and retried as needed. Music and SFX are uploaded or referenced.

### Stage 11 — Video & Animation
| Action | MCP Tool | Approval | Notes |
|--------|----------|----------|-------|
| List video assets | `media.list` (type: `video`) | None | |
| Generate scene video | `media.generate` (type: `video`) | Creator | Currently mock |
| Upload footage | `media.upload` | Creator | |

**Workflow**: Scene video is generated (currently mock) or uploaded. Shot-level footage is tracked. Animation can be imported. All video assets are linked to their scenes and shots.

### Stage 12 — Timeline & Editing
| Action | MCP Tool | Approval | Notes |
|--------|----------|----------|-------|
| Read timeline | `timeline.get` / `timeline` resource | None | |
| Update timeline | `timeline.update` | Creator | Tracks, clips, transitions |
| Validate timeline | `timeline.validate` | None | Returns findings |
| Approve timeline | `timeline.approve` | Creator | Unlocks render gate |

**Workflow**: Assistant or creator assembles clips on tracks (video, dialogue, narration, music, SFX, subtitle). Clips are trimmed, reordered, and given transitions. Validation checks for missing assets, overlaps, and duration mismatches. Approval unlocks rendering.

### Stage 13 — Rendering & Export
| Action | MCP Tool | Approval | Notes |
|--------|----------|----------|-------|
| Start render | `render.start` | Creator | |
| Check render status | `render.status` | None | |
| List renders | `media.list` (type: `render`) | None | |
| Download render | `media.download` | None | |

**Workflow**: Creator configures render settings (resolution, frame rate, audio mix). Render job is started. FFmpeg composites the timeline into final output. Creator downloads or exports.

---

## 3. Context Retrieval Strategy

### `project.context` Tool
The primary context retrieval mechanism. Returns a **stage-relevant subset** of project data, not everything.

**Parameters:**
- `projectId` (required)
- `stages` (optional): Array of stage names to include context for
- `depth` (optional): `summary` | `full` — controls detail level

**Returns:**
```
{
  project: { id, title, genre, language, status, ... },
  stages: {
    planning?: { concept, themes, premise, ... },
    bible?: { version, sections: { identity, world, characters, ... } },
    seasonPlan?: { version, episodes: [...], arcs: [...] },
    characters?: [ { id, name, profile, relationships, voiceProfile } ],
    locations?: [ { id, name, profile, visualReferences } ],
    scenes?: [ { id, number, objective, characters, shots: [...] } ],
    screenplay?: { status, parts: [...], validationFindings: [...] },
    canon?: { version, facts: [...], contradictions: [...] },
    media?: { characters: [...], locations: [...], scenes: [...], audio: [...] },
    timeline?: { tracks: [...], clips: [...], duration },
    render?: { jobs: [...], latestStatus }
  }
}
```

**Usage patterns:**
- **Onboarding**: Assistant calls `project.context` with no stage filter to get a summary of everything.
- **Stage work**: Assistant calls `project.context` with `stages: ["bible", "characters"]` to get bible + character context for scene work.
- **Canon check**: Assistant calls `project.context` with `stages: ["canon"]` to verify consistency before proposing a change.

### Resource Access
Resources provide structured read access without parameters:
- `bible:///{projectId}` — Full story bible
- `story:///{projectId}/{episodeId}` — Story draft for an episode
- `episodes:///{projectId}` — Episode list with status
- `canon:///{projectId}` — Current canon state
- `assets:///{projectId}` — All media assets
- `timeline:///{projectId}/{episodeId}` — Timeline for an episode
- `characters:///{projectId}` — All canonical characters
- `scenes:///{projectId}/{episodeId}` — Scenes for an episode
- `season-plan:///{projectId}` — Season plan

---

## 4. Document Submission Flow

### Standard Submission
```
1. Assistant retrieves context:     project.context / document.read
2. Assistant drafts change:          (in assistant's reasoning)
3. Assistant submits via MCP:        document.update / entity.create / scene.update
4. Service layer validates:          Zod schema + business rules
5. Service layer checks gates:       Stage prerequisites met?
6. Document saved as draft:          MongoDB persist
7. Creator notified:                 UI shows pending review
8. Creator reviews:                  UI review interface
9. Creator approves or rejects:      approval.* tool
10. On approval:                     Canon extraction, stage advance
```

### Section-by-Section Submission
For large documents (Story Bible, Season Plan), assistants submit sections independently:
```
document.update(type: "bible", section: "identity", content: {...})
document.update(type: "bible", section: "world", content: {...})
document.update(type: "bible", section: "characters", content: {...})
...
approval.bible(version: expectedVersion)
```

### Sequential Part Submission
Story drafts are submitted in 6 sequential parts with per-part persistence:
```
document.update(type: "story", part: "opening", content: {...})
document.update(type: "story", part: "inciting_incident", content: {...})
document.update(type: "story", part: "investigation", content: {...})
document.update(type: "story", part: "escalation", content: {...})
document.update(type: "story", part: "climax", content: {...})
document.update(type: "story", part: "resolution", content: {...})
```
Each part can be regenerated independently. Resume from the last completed part if interrupted.

---

## 5. Approval Workflow

### Approval Gates
All meaningful changes require explicit creator approval. Assistants **cannot** bypass approval.

| Gate | MCP Tool | Pre-conditions | Effect |
|------|----------|----------------|--------|
| Bible approval | `approval.bible` | All sections present, no blocking findings | Canon v1, advance to season plan |
| Story approval | `approval.story` | No blocking validation findings | Advance to season plan |
| Season plan approval | `seasonPlan.approve` | Validation passes | Lock plan, enable episodes |
| Episode approval | `episode.approve` | Prior episode approved, canon extracted | Update canon, unlock next episode |
| Entity approval | `entity.approve` | Entity complete | Entity becomes canonical |
| Shot plan approval | `scene.approveShotPlan` | Scene complete | Unlock shot production |
| Timeline approval | `timeline.approve` | No validation errors | Unlock render gate |
| Canon fact approval | `canon.add` (approved) | No contradictions | Fact added to canon |

### Optimistic Locking
All approval operations require `expectedVersion` or `expectedDraftRevision`:
```
approval.bible(projectId, expectedVersion: 3)
  → If current version ≠ 3: FAIL with conflict error
  → Assistant must re-fetch, re-submit
```

This prevents silent overwrites when multiple assistants or the UI modify the same document concurrently.

### Rejection Flow
```
Creator reviews document
  → Rejects with reason
  → Document status: "revision_requested"
  → Assistant retrieves rejection reason
  → Assistant revises and re-submits
```

---

## 6. Shared Project State

### State Ownership
```
┌─────────────────────────────────────────────────┐
│           MongoDB (Single Source of Truth)       │
│                                                  │
│  projects │ storybibles │ stories │ seasonplans  │
│  episodes │ productionscenes │ shots │ timelines │
│  canonicalentities │ mediaassets │ audiosegments │
│  narrativecanons │ canonstore │ renderjobs      │
│  activitylog (new) │ planningdocs (new)          │
└─────────────────────────────────────────────────┘
          ↑                    ↑                    ↑
     ┌────┴────┐          ┌────┴────┐          ┌────┴────┐
     │Assistant │          │Assistant │          │  UI     │
     │  (Claude)│          │  (Kimi)  │          │ (Creator)│
     └─────────┘          └─────────┘          └─────────┘
```

### Concurrency Rules
1. **No private caches**: Assistants must not store project data between calls. Always re-fetch via MCP.
2. **Optimistic locking**: All writes check `expectedVersion`. Conflicts require re-fetch + re-submit.
3. **Last-writer-checks**: The service layer rejects stale writes, not stale reads.
4. **Append-only canon**: Canon history is never deleted. New facts supersede old ones with explicit approval.

### Multi-Assistant Coordination
Multiple assistants can work on the same project simultaneously:
- **No locking**: Assistants don't hold locks. Optimistic concurrency handles conflicts.
- **Activity log**: Every MCP operation is logged. Assistants can check `activity.list` to see recent changes by other assistants.
- **Conflict resolution**: When two assistants submit conflicting changes, the first one wins, the second gets a conflict error and must re-fetch.

---

## 7. Conflict Resolution

### Document Conflicts
When `expectedVersion` doesn't match:
```
Error: VERSION_CONFLICT
  expected: 3
  actual: 4
  message: "Document was modified by another session. Re-fetch and re-submit."
```

**Resolution**: Assistant calls `document.read` to get the latest version, merges its changes, and re-submits with the new `expectedVersion`.

### Canon Conflicts
When a proposed canon fact contradicts an existing fact:
```
Error: CANON_CONTRADICTION
  proposed: { fact: "Character X is dead", source: "episode 5" }
  contradicts: { fact: "Character X is alive", source: "episode 3" }
  message: "Proposed fact contradicts established canon. Resolve before committing."
```

**Resolution**: Creator reviews both facts, accepts one, rejects the other, or marks the contradiction as intentional (with explanation).

### Validation Conflicts
When a document update introduces validation errors:
```
Error: VALIDATION_FAILED
  findings: [
    { severity: "blocking", code: "CHARACTER_NOT_DEFINED", message: "..." },
    { severity: "warning", code: "TIMELINE_GAP", message: "..." }
  ]
```

**Resolution**: Blocking findings must be fixed before approval. Warnings can be acknowledged. The assistant can call `pipeline.advance` with action `repair` to auto-fix.

---

## 8. Activity Tracking

### Current State
- In-memory activity log (ephemeral, lost on restart)
- `activity.list` MCP tool
- `/api/mcp/activity` API endpoint
- UI panel on MCP page

### Required Improvements
- **Persist to MongoDB**: New `activitylog` collection (append-only)
- **Track assistant identity**: Currently `assistantName` is always null. Must capture from MCP session metadata.
- **Per-project filtering**: UI should filter activity by project.
- **Operation types**: `read`, `write`, `approve`, `reject`, `generate`, `validate`, `repair`

### Activity Entry Structure
```
{
  projectId: string,
  actorType: "human" | "assistant",
  actorId: string,         // Clerk user ID or assistant identifier
  assistantName: string | null,  // "Claude", "Kimi", etc.
  tool: string,            // MCP tool name
  operation: string,       // "read", "write", "approve", ...
  target: string,          // "bible", "story", "scene", ...
  result: "success" | "failure" | "pending",
  details: object,         // Operation-specific details
  timestamp: Date
}
```

---

## 9. Assistant Onboarding Workflow

When a new assistant connects to a project via MCP:

```
1. Assistant connects:           MCP HTTP/stdio transport
2. Assistant lists projects:     project.list
3. Assistant selects project:    project.get(projectId)
4. Assistant gets context:       project.context(projectId)
   → Returns summary of all stages and current status
5. Assistant identifies work:    (based on creator's instructions)
6. Assistant retrieves detail:   document.read / entity.list / scene.list
7. Assistant proposes change:    document.update / entity.create / ...
8. Creator reviews in UI:        Pending review notification
9. Creator approves/rejects:     approval.* tool
10. Activity logged:             activity.list shows the operation
```

### Context-Aware Retrieval
Assistants should use `project.context` with stage filters rather than fetching everything:
- Working on characters? `stages: ["bible", "characters", "canon"]`
- Working on scenes? `stages: ["bible", "characters", "scenes", "screenplay"]`
- Working on timeline? `stages: ["scenes", "media", "timeline"]`
- Working on canon? `stages: ["bible", "screenplay", "canon"]`

---

## 10. Error Handling

### MCP Error Codes
| Code | Meaning | Assistant Action |
|------|---------|-----------------|
| `AUTH_REQUIRED` | No valid auth | Re-authenticate |
| `PROJECT_NOT_FOUND` | Project doesn't exist | Check project ID |
| `STAGE_GATE_BLOCKED` | Prerequisites not met | Complete prerequisite stage first |
| `VERSION_CONFLICT` | Optimistic lock failure | Re-fetch, re-submit |
| `VALIDATION_FAILED` | Schema/business rule violation | Fix and resubmit |
| `CANON_CONTRADICTION` | Canon conflict | Resolve contradiction |
| `APPROVAL_REQUIRED` | Operation needs approval | Wait for creator approval |
| `RATE_LIMITED` | Too many requests | Back off and retry |
| `PROVIDER_UNAVAILABLE` | LLM provider down | Failover to next provider |

### Retry Strategy
- **Transient errors** (rate limit, provider unavailable): Exponential backoff, max 3 retries
- **Validation errors**: No retry — fix the input
- **Conflict errors**: No retry — re-fetch first
- **Auth errors**: No retry — re-authenticate

---

## 11. Security Boundaries

### What Assistants Can Do
- Read all project data (respecting stage visibility)
- Propose document changes (drafts)
- Request approvals
- Query canon
- List media assets
- Check pipeline status

### What Assistants Cannot Do
- **Approve their own changes** — only the creator can approve
- **Delete project data** — no delete MCP tools for documents
- **Modify project settings** — only the creator can change project config
- **Bypass stage gates** — the service layer enforces prerequisites
- **Access other projects** — scoped to the connected project
- **Modify canon directly** — canon facts require creator approval
- **Execute arbitrary code** — no shell/exec tools exposed via MCP

### Auth Models
1. **Clerk session** (UI-embedded MCP): Inherits the creator's session. All operations are attributed to the creator.
2. **Bearer token** (external assistant): Server-to-server auth. Token maps to a user ID. Operations attributed to that user + assistant name.
3. **MCP_ACTOR_USER_ID** (stdio): Local dev. All operations attributed to the env var user ID.