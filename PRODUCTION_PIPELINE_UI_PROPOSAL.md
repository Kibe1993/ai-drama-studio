# Production Pipeline UI Proposal

> Complete UI redesign proposal for AI Drama Studio: main navigation, project workspace navigation (15 sections), dashboard, pipeline interface, all 13 stage interfaces, interaction behavior, responsive behavior, and state management.

## 1. Design Principles

1. **Every visible element has a meaningful action** — no dead buttons, no decorative inputs, no placeholder links.
2. **Contextual navigation** — no manual ID entry. Navigate by clicking, selecting, and drilling down.
3. **Stage-aware UI** — the interface knows which stage the project is in and shows/hides actions accordingly.
4. **Approval-first** — every AI-generated or assistant-proposed change surfaces for creator approval before taking effect.
5. **CSS Modules** — all new UI uses CSS Modules. No Tailwind for new components.
6. **Strict TypeScript** — no `any` types. All props and state are typed.
7. **Warm dark theme** — preserve the existing "film studio" aesthetic (warm dark background, amber accents).
8. **Responsive** — works on tablet (768px+) and desktop. Mobile is not a target.

---

## 2. Main Navigation (Studio Shell)

### Top-Level Navigation
```
┌─────────────────────────────────────────────────────────┐
│  [Logo] AI Drama Studio          [MCP] [Settings] [User] │
├──────────┬──────────────────────────────────────────────┤
│          │                                              │
│  Dashboard│                                             │
│  Projects │              [Page Content]                 │
│  MCP      │                                              │
│  Settings │                                              │
│          │                                              │
└──────────┴──────────────────────────────────────────────┘
```

| Nav Item | Route | Description |
|----------|-------|-------------|
| Dashboard | `/` | Overview of all projects, recent activity, quick actions |
| Projects | `/projects` | Project list with create, filter, sort |
| MCP | `/mcp` | MCP connection config, activity log, assistant management |
| Settings | `/settings` | LLM providers, API keys, preferences |

### Dashboard Content
- **Project cards**: Title, genre, stage progress (13-stage bar), last activity, thumbnail
- **Quick actions**: New project, open recent, connect MCP assistant
- **Recent activity**: Cross-project activity feed (last 20 operations)
- **Pipeline overview**: Aggregate stats (projects by stage, pending approvals)

---

## 3. Project Workspace Navigation

When a project is open, the sidebar expands to show **15 sections** grouped into **4 phases**:

```
┌──────────────────────────────────────┐
│  [← Back to Projects]                │
│  Project Title                       │
│  Stage: 3/13 (Story Bible)           │
│  ━━━━━━━░░░░░░░░░░░░░ 23%            │
├──────────────────────────────────────┤
│                                      │
│  CREATIVE DEVELOPMENT                │
│  ├ 1. Project Setup                  │
│  ├ 2. Creative Planning              │
│  └ 3. Story Bible                    │
│                                      │
│  STRUCTURAL DEVELOPMENT              │
│  ├ 4. Season & Episodes              │
│  ├ 5. Characters & Locations         │
│  ├ 6. Scene Breakdown                │
│  ├ 7. Screenplay                     │
│  └ 8. Canon & Continuity             │
│                                      │
│  PRODUCTION                          │
│  ├ 9. Production Design              │
│  ├ 10. Audio                         │
│  ├ 11. Video                         │
│  └ 12. Timeline                      │
│                                      │
│  OUTPUT                              │
│  └ 13. Rendering                     │
│                                      │
├──────────────────────────────────────┤
│  [Pipeline View]  [Activity Log]     │
└──────────────────────────────────────┘
```

### Navigation Sections

| # | Section | Route | Phase | Stage Gate |
|---|---------|-------|-------|------------|
| 1 | Project Setup | `/projects/[id]` | Creative | Always available |
| 2 | Creative Planning | `/projects/[id]/planning` | Creative | Stage 1 complete |
| 3 | Story Bible | `/projects/[id]/bible` | Creative | Stage 2 approved |
| 4 | Season & Episodes | `/projects/[id]/episodes` | Structural | Stage 3 approved |
| 5 | Characters & Locations | `/projects/[id]/characters` | Structural | Stage 4 approved |
| 6 | Scene Breakdown | `/projects/[id]/scenes` | Structural | Stage 5 approved |
| 7 | Screenplay | `/projects/[id]/story` | Structural | Stage 6 approved |
| 8 | Canon & Continuity | `/projects/[id]/canon` | Structural | Always (cross-cutting) |
| 9 | Production Design | `/projects/[id]/production-design` | Production | Stage 7 approved |
| 10 | Audio | `/projects/[id]/audio` | Production | Stage 9 approved |
| 11 | Video | `/projects/[id]/video` | Production | Stage 9 approved |
| 12 | Timeline | `/projects/[id]/timeline` | Production | Stage 11 has assets |
| 13 | Rendering | `/projects/[id]/rendering` | Output | Stage 12 approved |

### Stage Gate Behavior
- **Locked sections**: Greyed out with a lock icon. Tooltip: "Complete [prerequisite stage] first."
- **Current section**: Highlighted with amber accent.
- **Completed sections**: Checkmark icon.
- **Sections with pending approval**: Pulsing dot indicator.

### Pipeline View
`/projects/[id]/pipeline` — Full 13-stage pipeline visualization:
```
Phase A — Creative Development
  [1] Project Setup ✓
  [2] Creative Planning ✓
  [3] Story Bible ✓ (approved v2)

Phase B — Structural Development
  [4] Season & Episodes ✓ (12 episodes)
  [5] Characters & Locations ✓ (8 chars, 5 locs)
  [6] Scene Breakdown ● (in progress)
  [7] Screenplay ○ (locked)
  [8] Canon & Continuity ● (2 contradictions)

Phase C — Production
  [9] Production Design ○ (locked)
  [10] Audio ○ (locked)
  [11] Video ○ (locked)
  [12] Timeline ○ (locked)

Phase D — Output
  [13] Rendering ○ (locked)
```

---

## 4. Stage Interfaces

### Stage 1 — Project Setup (`/projects/[id]`)
**Layout**: Two-column. Left: project metadata form. Right: stage progress + quick actions.

**Elements**:
- Title, genre, language, visual style, tone, production type/mode
- Target duration, aspect ratio
- Status badge (draft, active, archived)
- Save button (validates, persists)
- Archive/restore/duplicate actions
- Stage progress card with "Advance to Planning" button (if stage 1 complete)

**States**: Empty (new project), loaded, saving, saved, error.

---

### Stage 2 — Creative Planning (`/projects/[id]/planning`)
**Layout**: Document editor with AI assistance panel.

**Elements**:
- Logline input (single sentence)
- Synopsis editor (multi-paragraph)
- Elevator pitch input
- Themes list (add/remove tags)
- Central question input
- Main conflict input
- Audience fields (demographic, tone, content rating)
- Narrative direction (structure, POV, pacing)
- Alternative directions (list with pros/cons, select one)
- References list (title, type, relevance)
- "Generate with AI" button (calls LLM with project context)
- "Submit for Review" button (sends to creator approval)
- Version history dropdown

**States**: Empty (prompt to start), generating (progress), draft, submitted, approved, rejected (with reason), version history.

---

### Stage 3 — Story Bible (`/projects/[id]/bible`)
**Layout**: Tabbed section editor (6 tabs: Identity, World, Characters, Narrative, Guidelines, Canon).

**Elements**:
- Per-section rich text editor
- "Generate Section" button per tab
- "Regenerate Section" button (with confirmation)
- Section status indicators (draft, generated, approved)
- "Approve Bible" button (all sections must be present)
- Version indicator + version history
- Import/export buttons (JSON, Markdown)
- Canon facts extracted from bible (read-only list)

**States**: Empty, generating (per-section progress), draft, validation findings, approved, version comparison.

---

### Stage 4 — Season & Episodes (`/projects/[id]/episodes`)
**Layout**: Three-panel. Left: season plan summary. Center: episode list. Right: episode detail.

**Elements**:
- Season plan editor (arcs, developments, revelations, relationships)
- "Generate Season Plan" button
- "Validate" button (7 validators)
- "Repair" button (auto-fix findings)
- "Approve Plan" button
- Episode list (number, title, status, duration)
- Episode create form (manual or AI suggestion)
- Episode detail (premise, outline, status)
- Serialized locking indicator
- Canon extraction status per episode

**States**: Empty, generating, validation findings (blocking/warning/info), repair progress, approved, episode locked (prior episode not approved).

---

### Stage 5 — Characters & Locations (`/projects/[id]/characters`)
**Layout**: Tabbed view — Characters tab, Locations tab, Objects tab.

**Characters tab**:
- Character cards grid (name, role, thumbnail, status)
- Filter by role, status, canon status
- Character detail panel:
  - Profile (name, role, description, age, personality, background)
  - Relationships graph (visual node-edge diagram)
  - Voice profile (assigned voice, sample audio, approval)
  - Visual references (image gallery, approve/reject)
  - Canon facts (list of facts about this character)
  - "Create Character" button
  - "Generate with AI" button (uses bible + season plan context)
  - "Approve Character" button (makes canonical)

**Locations tab**:
- Location cards grid (name, type, thumbnail)
- Location detail:
  - Profile (name, type, description, geographic context)
  - Atmosphere (lighting, mood, time of day)
  - Architecture (interior/exterior, style, features)
  - Visual references
  - Canon facts
  - "Create Location" button
  - "Approve Location" button

**Objects tab**:
- Object cards (name, type, significance)
- Object detail with visual references

**States**: Empty, loaded, creating, generating, approving, approved, error.

---

### Stage 6 — Scene Breakdown (`/projects/[id]/scenes`)
**Layout**: Two-panel. Left: scene list (ordered, drag to reorder). Right: scene detail.

**Elements**:
- Episode selector dropdown (no manual ID entry)
- Scene list with drag-and-drop reordering
- Scene detail:
  - Scene number, heading (INT/EXT, location, time of day)
  - Objective, emotional progression
  - Characters in scene (multi-select from canonical characters)
  - Location (select from canonical locations)
  - Shot plan (list of shots with type, camera, duration)
  - "Generate Shot Plan" button (AI from scene + screenplay)
  - "Approve Shot Plan" button (unlocks production)
  - "Edit Screenplay" link (navigates to Stage 7, this scene)
- "Add Scene" button
- "Generate Breakdown" button (AI from screenplay)

**States**: Empty, loaded, generating, shot plan review, approved, error.

---

### Stage 7 — Screenplay (`/projects/[id]/story`)
**Layout**: Three-panel. Left: scene/chapter navigator. Center: screenplay editor. Right: validation panel.

**Elements**:
- Episode selector
- Scene/chapter navigator (ordered list, click to jump)
- Screenplay editor (per-scene):
  - Scene heading (INT/EXT, location, time of day)
  - Action/description
  - Character cue
  - Dialogue
  - Parenthetical
  - Transition
  - Voice-over/narration
- "Generate" button (6 sequential parts with progress)
- "Regenerate Part" button
- "Validate" button (canon validation)
- "Repair" button
- Validation panel (findings: blocking/warning/info with per-finding resolution)
- "Approve Story" button (blocked if blocking findings)
- Import/export (Fountain, FDX, JSON)

**States**: Empty, generating (per-part progress), draft, validation findings, repair progress, approved, import/export dialog.

---

### Stage 8 — Canon & Continuity (`/projects/[id]/canon`)
**Layout**: Three-panel. Left: canon fact categories. Center: fact list. Right: contradiction resolution.

**Elements**:
- Canon version indicator + version history
- Fact categories: Characters, Locations, Events, Relationships, Rules, Objects
- Fact list:
  - Fact text, type, source (document + version), status
  - Filter by type, source, status
  - Search
- Contradiction panel:
  - Pairs of contradictory facts
  - Source of each fact
  - Resolution options: accept A, accept B, mark as intentional (with explanation)
  - "Resolve" button
- "Add Fact" button (manual)
- Canon timeline (events in chronological order)
- Continuity ledger (character states, location states, object states over time)
- Export canon (JSON, Markdown)

**States**: Empty, loaded, contradiction found, resolution in progress, resolved, version comparison.

---

### Stage 9 — Production Design (`/projects/[id]/production-design`)
**Layout**: Two-panel. Left: scene list. Right: production design for selected scene.

**Elements**:
- Scene selector (dropdown or list, no manual ID)
- Per-scene production design:
  - Shot list (table):
    - Shot number, type (wide/medium/close/establishment)
    - Camera direction, movement, lens, framing
    - Duration
    - Lighting setup, notes
    - Storyboard description
    - Visual continuity notes
  - "Generate Shot List" button (AI from scene + screenplay)
  - Location design (dressing, props, atmosphere)
  - Character staging (position, action per character)
  - Storyboard image upload/generation per shot
- "Approve Production Design" button (per scene)
- "Approve All" button (all scenes)

**States**: Empty, generating shot list, draft, reviewing, approved, error.

---

### Stage 10 — Audio (`/projects/[id]/audio`)
**Layout**: Three-step wizard + segment list.

**Elements**:
- Episode selector
- Step 1 — Prerequisites:
  - Voice profile assignment per character (dropdown of available voices)
  - Dialogue extraction status
  - Narration text review
- Step 2 — Generate:
  - "Generate All Segments" button
  - Per-segment progress (character, text, status, duration)
  - Cancel button
- Step 3 — Review:
  - Segment list with audio playback (play/pause/seek)
  - Per-segment retry button
  - Per-segment approve/reject
  - "Approve All" button
- Voice profile management:
  - Create voice profile (name, language, gender, style)
  - Test voice (sample text → audio preview)
  - Assign to character
- Music/SFX upload and reference

**States**: Empty, prerequisites not met, generating (progress), review, approved, error, retry.

---

### Stage 11 — Video (`/projects/[id]/video`)
**Layout**: Scene grid with video assets.

**Elements**:
- Episode selector
- Scene cards with:
  - Scene thumbnail
  - Video asset (if generated): player, duration, resolution
  - "Generate Video" button (currently mock — clearly labeled)
  - "Upload Footage" button
  - Shot-level footage list
  - Status: not started, generating, ready, failed
- Animation import (if applicable)
- Mock indicator badge on all mock-generated assets

**States**: Empty, generating (mock), ready, failed, uploaded, mock-labeled.

---

### Stage 12 — Timeline (`/projects/[id]/timeline`)
**Layout**: Full-screen visual timeline editor.

**Elements**:
- Episode selector
- **Visual time-axis** (horizontal ruler with time markers)
- **Multi-track layout** (6 tracks: video, dialogue, narration, music, SFX, subtitle):
  - Each track is a horizontal lane
  - Clips are positioned blocks on the time-axis (not form rows)
  - Clip width = duration
  - Clip color = track type
  - Clip label = asset name
- **Playhead** (vertical line, draggable, shows current time)
- **Preview monitor** (video preview at playhead position)
- Clip interactions:
  - Click to select
  - Drag to move (snaps to grid)
  - Drag edges to trim
  - Right-click for context menu (split, delete, properties)
- Clip properties panel (selected clip):
  - Start, duration, end (numeric inputs synced with visual position)
  - Volume (for audio tracks)
  - Transition (crossfade, wipe, slide) + duration
  - Source asset link
- Track controls:
  - Mute/solo toggle
  - Volume slider
  - Add clip (opens asset picker)
- **Drag-and-drop reordering** within tracks
- Validation panel (missing assets, overlaps, duration mismatch)
- "Save" button
- "Approve Timeline" button (blocked by validation errors)
- "Play" button (preview playback)

**States**: Empty, loading, loaded, saving, saved, validation errors, approved, playing, error.

---

### Stage 13 — Rendering (`/projects/[id]/rendering`)
**Layout**: Configuration panel + job list.

**Elements**:
- Episode selector
- Render configuration:
  - Preset (vertical 9:16, landscape 16:9, square 1:1, custom)
  - Resolution (width × height)
  - Frame rate (24, 25, 30, 60)
  - Codec (H.264, H.265, ProRes)
  - Bitrate
  - Audio mix (stereo, mono, 5.1)
  - Subtitle burn-in toggle
  - Watermark toggle + position
- "Start Render" button
- Job list:
  - Job ID, status (queued, processing, completed, failed)
  - Progress bar
  - Started, elapsed, ETA
  - Output file (download link when complete)
  - Cancel button (when processing)
  - Retry button (when failed)
- Render history (past jobs with download links)
- "Download" button (completed renders)
- "Export" button (to external storage, if configured)

**States**: Empty, configured, queued, processing (progress), completed, failed, cancelled, downloading.

---

## 5. Cross-Cutting UI Elements

### Approval Banner
Appears at the top of any page with a pending approval:
```
┌──────────────────────────────────────────────────────┐
│  ⚠ Pending Approval: Story Bible v2                  │
│  Submitted by Claude (via MCP) • 2 minutes ago       │
│  [Review Changes]  [Approve]  [Reject with Reason]   │
└──────────────────────────────────────────────────────┘
```

### Validation Findings Panel
Appears on stages with validation (bible, story, season plan, timeline):
```
Validation Findings (3)
├── 🔴 Blocking (1)
│   └── Character "Maya" not defined in bible
│       [Fix] [Mark as Intentional] [Ignore]
├── 🟡 Warning (1)
│   └── Timeline gap at 00:42-00:45
│       [Fix] [Acknowledge]
└── ℹ Info (1)
    └── Scene 3 has no dialogue
        [Acknowledge]
```

### Activity Log Panel
Slide-in panel showing recent operations:
```
Recent Activity
├── Claude approved Story Bible v2          2 min ago
├── Kimi proposed character "Marcus"        5 min ago
├── Creator approved Season Plan v1         1 hour ago
├── Claude generated Story part 3/6         2 hours ago
└── Creator created project                 3 hours ago
[View All Activity]
```

### MCP Connection Indicator
Status badge in the header showing connected assistants:
```
MCP: ● Claude ● Kimi ○ ChatGPT
```
Click to open MCP management page.

---

## 6. State Management

### Page States (every page must handle)

| State | Display | Action |
|-------|---------|--------|
| **Empty** | Illustration + "Get started" prompt | Primary action button |
| **Loading** | Skeleton placeholders | None (automatic) |
| **Loaded** | Full content | All interactions available |
| **Creating/Generating** | Progress indicator (per-item if applicable) | Cancel button |
| **Saving** | Save button shows spinner | None (automatic) |
| **Saved** | Toast: "Saved successfully" | Auto-dismiss after 3s |
| **Error** | Error message + retry button | Retry button |
| **Validation** | Findings panel with severity badges | Per-finding resolution |
| **Pending Approval** | Approval banner at top | Review / Approve / Reject |
| **Approved** | Success badge + stage advance prompt | Advance to next stage |
| **Rejected** | Rejection reason + edit prompt | Edit and resubmit |
| **Locked** | Lock icon + prerequisite message | None (navigate to prerequisite) |

### Data Fetching
- **SWR or React Query** for all data fetching (caching, revalidation, optimistic updates)
- **Polling** for async operations (generation, render): 3s interval, stop on completion
- **Optimistic updates** for save operations (show saved immediately, rollback on error)

### Form State
- **React Hook Form + Zod** for all forms (validation, error messages)
- **Debounced autosave** for document editors (save 2s after last edit)
- **Dirty state tracking** — warn before navigation if unsaved changes

---

## 7. Responsive Behavior

### Breakpoints
| Breakpoint | Min Width | Layout |
|------------|-----------|--------|
| Desktop | 1280px | Full sidebar + 3-panel layouts |
| Tablet landscape | 1024px | Collapsible sidebar + 2-panel layouts |
| Tablet portrait | 768px | Icon sidebar + single panel + drawer for secondary |

### Adaptations
- **Sidebar**: Collapses to icons only on tablet portrait. Expand on hover or click.
- **3-panel layouts**: Secondary panel becomes a drawer on tablet.
- **Timeline editor**: Full-screen on all breakpoints. Track labels collapse on tablet portrait.
- **Tables**: Horizontal scroll on tablet portrait. No column hiding.
- **Cards**: Grid adjusts columns (4 → 3 → 2) based on breakpoint.

---

## 8. Interaction Behavior

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save current document |
| `Ctrl+Enter` | Submit for approval |
| `Ctrl+Z` | Undo (in editors) |
| `Ctrl+Shift+Z` | Redo |
| `Esc` | Close dialog/panel |
| `?` | Show keyboard shortcuts help |
| `G` then `B` | Go to Story Bible |
| `G` then `S` | Go to Screenplay |
| `G` then `T` | Go to Timeline |

### Drag and Drop
- **Scene reordering**: Drag scene cards in the scene list. Visual indicator shows drop position.
- **Timeline clips**: Drag clips within and between tracks. Snap to grid (0.1s).
- **Media to timeline**: Drag media assets from gallery to timeline track.
- **Character to scene**: Drag character card to scene's character list.

### Context Menus
Right-click on:
- **Scene**: Edit, delete, duplicate, generate shot plan, navigate to screenplay
- **Character**: Edit, approve, delete, assign voice, view canon facts
- **Clip**: Split, delete, properties, change transition
- **Canon fact**: View source, resolve contradiction, mark as intentional

### Toasts
| Type | Trigger | Duration |
|------|---------|----------|
| Success | Save, approve, generate complete | 3s |
| Error | Save failed, validation error, network error | 5s (or manual dismiss) |
| Info | Stage advanced, version created | 3s |
| Warning | Unsaved changes, mock asset generated | 5s |

---

## 9. Theming

### Color Palette (Warm Dark Film Studio)
```
--bg-primary: #1a1410      (warm near-black)
--bg-secondary: #231d17    (slightly lighter)
--bg-tertiary: #2d2620     (panels)
--bg-elevated: #382f26     (modals, dropdowns)

--text-primary: #f5e6d3    (warm white)
--text-secondary: #c4b5a0  (warm grey)
--text-tertiary: #8a7d6b   (muted)

--accent-primary: #d4a574  (amber)
--accent-secondary: #b8865d (darker amber)
--accent-hover: #e4b584    (lighter amber)

--status-success: #7fb069  (sage green)
--status-warning: #e8a87c  (warm orange)
--status-error: #c66b5e    (warm red)
--status-info: #7da3b8     (muted blue)

--border: #3d352c          (warm border)
--border-active: #d4a574   (amber border)
```

### Typography
- **Headings**: Inter or system sans-serif, 600-700 weight
- **Body**: Inter or system sans-serif, 400 weight
- **Mono** (screenplay, code): JetBrains Mono or system monospace
- **Screenplay**: Courier Prime (screenwriting standard)

### Spacing
- 4px base unit (4, 8, 12, 16, 24, 32, 48, 64)
- 16px default padding for panels
- 24px default gap between cards
- 8px default gap between form fields