# Production Pipeline UI Interaction Matrix

> Every major screen, every visible interactive control, expected behavior, state dependency, persistence requirement, validation requirement, and test coverage.

## Legend

| Column | Values |
|--------|--------|
| **State** | `local` (client-only), `server` (MongoDB), `both` (optimistic local + server) |
| **Persist** | `none`, `debounce` (autosave), `explicit` (save button), `api` (server call) |
| **Validate** | `none`, `client` (Zod), `server` (service layer), `both` |
| **Test** | `unit`, `integration`, `component`, `e2e`, `none` (needs test) |

---

## 1. Dashboard (`/`)

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Project card click | Navigate to `/projects/[id]` | local | none | none | e2e |
| Project card menu → Archive | Archive project (confirm dialog) | both | api | both | integration |
| Project card menu → Duplicate | Duplicate project (name prompt) | both | api | both | integration |
| Project card menu → Delete | Delete project (two-step confirm) | both | api | both | integration |
| "New Project" button | Open create dialog | local | none | none | component |
| Create dialog → Submit | Create project, navigate to it | both | api | both | integration |
| "Open Recent" list item | Navigate to project | local | none | none | e2e |
| "Connect MCP" button | Navigate to `/mcp` | local | none | none | e2e |
| Recent activity item | Navigate to relevant stage | local | none | none | e2e |
| Pipeline overview stat | Filter projects by stage | local | none | none | component |

---

## 2. Projects List (`/projects`)

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Search input | Filter projects by title/genre | local | none | none | component |
| Genre filter dropdown | Filter by genre | local | none | none | component |
| Status filter dropdown | Filter by status (active, archived, draft) | local | none | none | component |
| Sort dropdown | Sort by created/updated/title | local | none | none | component |
| "New Project" button | Open create dialog | local | none | none | component |
| Project row click | Navigate to project workspace | local | none | none | e2e |
| Project row → Archive | Archive project | both | api | both | integration |
| Project row → Restore | Restore archived project | both | api | both | integration |
| Pagination controls | Change page | local | none | none | component |

---

## 3. Project Setup (`/projects/[id]`) — Stage 1

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Title input | Update project title | both | debounce | client | integration |
| Genre dropdown | Select genre | both | debounce | client | integration |
| Language dropdown | Select language | both | debounce | client | integration |
| Visual style dropdown | Select visual style | both | debounce | client | integration |
| Tone input | Update tone | both | debounce | client | integration |
| Production type dropdown | Select type (series, single, anthology) | both | debounce | client | integration |
| Production mode dropdown | Select mode (guided, automatic) | both | debounce | client | integration |
| Target duration input | Set duration in seconds | both | debounce | both | integration |
| Aspect ratio dropdown | Select ratio (9:16, 16:9, 1:1, custom) | both | debounce | client | integration |
| "Save" button | Explicit save | server | explicit | both | integration |
| "Archive" button | Archive project (confirm) | server | api | both | integration |
| "Duplicate" button | Duplicate project | server | api | both | integration |
| "Advance to Planning" button | Navigate to Stage 2 | local | none | server (gate check) | e2e |
| Stage progress card | Visual 13-stage progress | local | none | none | component |

---

## 4. Creative Planning (`/projects/[id]/planning`) — Stage 2

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Logline input | Update logline | both | debounce | client (max 200 chars) | integration |
| Synopsis editor | Update synopsis | both | debounce | client | integration |
| Elevator pitch input | Update pitch | both | debounce | client | integration |
| Theme tag input | Add theme tag | local | debounce | client (non-empty) | component |
| Theme tag × | Remove theme tag | local | debounce | none | component |
| Central question input | Update question | both | debounce | client | integration |
| Main conflict input | Update conflict | both | debounce | client | integration |
| Audience demographic input | Update demographic | both | debounce | client | integration |
| Audience tone dropdown | Select tone | both | debounce | client | integration |
| Content rating dropdown | Select rating | both | debounce | client | integration |
| Narrative structure dropdown | Select structure | both | debounce | client | integration |
| POV dropdown | Select point of view | both | debounce | client | integration |
| Pacing dropdown | Select pacing | both | debounce | client | integration |
| "Add Alternative Direction" button | Add alternative row | local | debounce | none | component |
| Alternative direction → Select | Mark as selected direction | local | debounce | none | component |
| Alternative direction → Delete | Remove alternative | local | debounce | none | component |
| "Add Reference" button | Add reference row | local | debounce | none | component |
| "Generate with AI" button | Call LLM, populate fields | server | api | both | integration |
| "Submit for Review" button | Submit planning for approval | server | api | both | integration |
| "Approve" button | Approve planning document | server | api | both (version check) | integration |
| "Reject" button | Reject with reason dialog | server | api | both | integration |
| Version history dropdown | View/restore previous version | server | none | none | integration |
| "Save" button | Explicit save | server | explicit | both | integration |

---

## 5. Story Bible (`/projects/[id]/bible`) — Stage 3

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Section tab (6 tabs) | Switch active section | local | none | none | component |
| Section editor (rich text) | Edit section content | both | debounce | client | integration |
| "Generate Section" button | AI-generate current section | server | api | both | integration |
| "Regenerate Section" button | Regenerate with confirm | server | api | both | integration |
| Section status indicator | Shows draft/generated/approved | local | none | none | component |
| "Approve Bible" button | Approve all sections → canon v1 | server | api | both (version check, all sections present) | integration |
| Version indicator | Show current version | local | none | none | component |
| Version history dropdown | View/compare/restore version | server | none | none | integration |
| "Import" button | Open import dialog | local | none | none | component |
| Import dialog → File input | Select JSON/Markdown file | local | none | client (file type) | integration |
| Import dialog → Import | Parse and load bible | server | api | both | integration |
| "Export" button | Open export dialog | local | none | none | component |
| Export dialog → JSON | Download JSON | local | none | none | integration |
| Export dialog → Markdown | Download Markdown | local | none | none | integration |
| Canon facts list (read-only) | View extracted facts | local | none | none | component |

---

## 6. Season & Episodes (`/projects/[id]/episodes`) — Stage 4

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Season plan editor (8 scalar fields) | Edit plan fields | both | debounce | client | integration |
| Season plan list fields (6 lists) | Add/remove list items | both | debounce | client | integration |
| "Generate Season Plan" button | AI-generate plan | server | api | both | integration |
| "Validate" button | Run 7 validators | server | api | server | integration |
| "Repair" button | Auto-fix validation findings | server | api | both | integration |
| "Approve Plan" button | Approve + lock version | server | api | both (version check, validation pass) | integration |
| Episode list | Click to select episode | local | none | none | component |
| Episode row → Status badge | Show episode status | local | none | none | component |
| "Create Episode" button | Open create form | local | none | none | component |
| Create form → Submit | Create episode | server | api | both | integration |
| "Suggest Episode" button | AI suggest episode outline | server | api | both | integration |
| Episode detail → Premise | Edit premise | both | debounce | client | integration |
| Episode detail → Outline | Edit outline | both | debounce | client | integration |
| Episode detail → "Approve" | Approve episode (serialized check) | server | api | both (prior episode approved) | integration |
| Serialized lock indicator | Show lock reason | local | none | none | component |
| Canon extraction status | Show extraction progress | local | none | none | component |
| Version history | View/restore plan version | server | none | none | integration |

---

## 7. Characters & Locations (`/projects/[id]/characters`) — Stage 5

### Characters Tab

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Character card click | Open character detail | local | none | none | component |
| Filter by role dropdown | Filter characters | local | none | none | component |
| Filter by status dropdown | Filter characters | local | none | none | component |
| Search input | Search by name | local | none | none | component |
| "Create Character" button | Open create form | local | none | none | component |
| Create form → Submit | Create character entity | server | api | both | integration |
| "Generate with AI" button | AI-generate from bible + plan | server | api | both | integration |
| Character detail → Name | Edit name | both | debounce | client | integration |
| Character detail → Role | Edit role | both | debounce | client | integration |
| Character detail → Description | Edit description | both | debounce | client | integration |
| Character detail → Personality | Edit personality | both | debounce | client | integration |
| Character detail → Background | Edit background | both | debounce | client | integration |
| Relationships graph | Visual node-edge display | local | none | none | component |
| Relationship → Add | Add relationship (target + type) | server | api | both | integration |
| Relationship → Delete | Remove relationship | server | api | both | integration |
| Voice profile → Dropdown | Assign voice profile | server | api | both | integration |
| Voice profile → Play sample | Play sample audio | local | none | none | component |
| Visual reference → Upload | Upload reference image | server | api | client (file type) | integration |
| Visual reference → Approve | Approve reference | server | api | both | integration |
| Visual reference → Reject | Reject reference (reason) | server | api | both | integration |
| Visual reference → Set Default | Set as default reference | server | api | both | integration |
| Canon facts list | View character's canon facts | local | none | none | component |
| "Approve Character" button | Make character canonical | server | api | both | integration |
| "Delete Character" button | Delete (two-step confirm) | server | api | both | integration |

### Locations Tab

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Location card click | Open location detail | local | none | none | component |
| "Create Location" button | Open create form | local | none | none | component |
| Create form → Submit | Create location entity | server | api | both | integration |
| Location detail → Name | Edit name | both | debounce | client | integration |
| Location detail → Type | Edit type (interior/exterior) | both | debounce | client | integration |
| Location detail → Description | Edit description | both | debounce | client | integration |
| Location detail → Geographic context | Edit geographic context | both | debounce | client | integration |
| Location detail → Atmosphere | Edit atmosphere fields | both | debounce | client | integration |
| Location detail → Lighting | Edit lighting notes | both | debounce | client | integration |
| Visual reference → Upload | Upload reference image | server | api | client | integration |
| "Approve Location" button | Make location canonical | server | api | both | integration |

### Objects Tab

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Object card click | Open object detail | local | none | none | component |
| "Create Object" button | Open create form | local | none | none | component |
| Object detail fields | Edit object properties | both | debounce | client | integration |
| "Approve Object" button | Make object canonical | server | api | both | integration |

---

## 8. Scene Breakdown (`/projects/[id]/scenes`) — Stage 6

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Episode selector dropdown | Select active episode | local | none | none | component |
| Scene list → Drag reorder | Reorder scenes | both | api | both | integration |
| Scene list → Click | Select scene | local | none | none | component |
| "Add Scene" button | Add new scene | server | api | both | integration |
| "Generate Breakdown" button | AI-generate from screenplay | server | api | both | integration |
| Scene detail → Number | Edit scene number | both | debounce | client | integration |
| Scene detail → Heading (INT/EXT) | Edit heading | both | debounce | client | integration |
| Scene detail → Location select | Select from canonical locations | both | debounce | client | integration |
| Scene detail → Time of day | Edit time of day | both | debounce | client | integration |
| Scene detail → Objective | Edit objective | both | debounce | client | integration |
| Scene detail → Emotional progression | Edit progression | both | debounce | client | integration |
| Scene detail → Characters multi-select | Select characters in scene | both | debounce | client | integration |
| Shot plan → Add shot | Add shot to plan | local | debounce | none | component |
| Shot plan → Edit shot fields | Edit shot properties | both | debounce | client | integration |
| Shot plan → Delete shot | Remove shot | local | debounce | none | component |
| "Generate Shot Plan" button | AI-generate shot plan | server | api | both | integration |
| "Approve Shot Plan" button | Approve → unlock production | server | api | both | integration |
| "Edit Screenplay" link | Navigate to Stage 7, this scene | local | none | none | e2e |

---

## 9. Screenplay (`/projects/[id]/story`) — Stage 7

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Episode selector | Select episode | local | none | none | component |
| Scene/chapter navigator | Click to jump to scene | local | none | none | component |
| Scene heading editor | Edit INT/EXT, location, time | both | debounce | client | integration |
| Action/description editor | Edit action text | both | debounce | client | integration |
| Character cue input | Set speaking character | both | debounce | client | integration |
| Dialogue editor | Edit dialogue | both | debounce | client | integration |
| Parenthetical input | Edit parenthetical | both | debounce | client | integration |
| Transition dropdown | Select transition | both | debounce | client | integration |
| "Generate" button | Start 6-part generation | server | api | both | integration |
| Generation progress indicator | Show per-part progress | local | none | none | component |
| "Cancel Generation" button | Cancel ongoing generation | server | api | none | integration |
| "Regenerate Part" button | Regenerate specific part | server | api | both | integration |
| "Validate" button | Run canon validation | server | api | server | integration |
| "Repair" button | Auto-fix findings | server | api | both | integration |
| Validation findings panel | Show blocking/warning/info | local | none | none | component |
| Finding → "Fix" | Request targeted fix | server | api | both | integration |
| Finding → "Mark as Intentional" | Accept with explanation | server | api | both | integration |
| Finding → "Ignore" | Dismiss finding | local | none | none | component |
| "Approve Story" button | Approve (blocked by blocking findings) | server | api | both | integration |
| "Import" button | Open import dialog | local | none | none | component |
| Import → Fountain file | Parse and load | server | api | both | integration |
| Import → FDX file | Parse and load | server | api | both | integration |
| Import → JSON file | Parse and load | server | api | both | integration |
| "Export" button | Open export dialog | local | none | none | component |
| Export → Fountain | Download .fountain | local | none | none | integration |
| Export → FDX | Download .fdx | local | none | none | integration |
| Export → JSON | Download .json | local | none | none | integration |

---

## 10. Canon & Continuity (`/projects/[id]/canon`) — Stage 8

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Canon version indicator | Show current version | local | none | none | component |
| Version history dropdown | View/compare versions | server | none | none | integration |
| Category filter (6 categories) | Filter facts by type | local | none | none | component |
| Search input | Search facts | local | none | none | component |
| Status filter | Filter by status (approved, proposed, rejected) | local | none | none | component |
| Fact card click | View fact detail + source | local | none | none | component |
| Fact → Source link | Navigate to source document | local | none | none | e2e |
| "Add Fact" button | Open add fact form | local | none | none | component |
| Add fact form → Submit | Propose canon fact | server | api | both | integration |
| Contradiction panel | Show contradictory fact pairs | local | none | none | component |
| Contradiction → "Accept A" | Resolve by accepting fact A | server | api | both | integration |
| Contradiction → "Accept B" | Resolve by accepting fact B | server | api | both | integration |
| Contradiction → "Mark Intentional" | Mark with explanation | server | api | both | integration |
| Canon timeline | View events chronologically | local | none | none | component |
| Continuity ledger | View state changes over time | local | none | none | component |
| "Export Canon" button | Export JSON/Markdown | local | none | none | integration |

---

## 11. Production Design (`/projects/[id]/production-design`) — Stage 9

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Scene selector | Select scene | local | none | none | component |
| Shot list table | View/edit shots | local | none | none | component |
| Shot → Add row | Add new shot | local | debounce | none | component |
| Shot → Type dropdown | Select shot type | both | debounce | client | integration |
| Shot → Camera direction input | Edit direction | both | debounce | client | integration |
| Shot → Camera movement dropdown | Select movement | both | debounce | client | integration |
| Shot → Lens input | Edit lens | both | debounce | client | integration |
| Shot → Framing input | Edit framing | both | debounce | client | integration |
| Shot → Duration input | Edit duration | both | debounce | both | integration |
| Shot → Lighting setup input | Edit lighting | both | debounce | client | integration |
| Shot → Lighting notes | Edit notes | both | debounce | client | integration |
| Shot → Storyboard description | Edit description | both | debounce | client | integration |
| Shot → Visual continuity notes | Edit notes | both | debounce | client | integration |
| Shot → Delete | Remove shot | local | debounce | none | component |
| "Generate Shot List" button | AI-generate from scene + screenplay | server | api | both | integration |
| Location design → Dressing | Edit dressing | both | debounce | client | integration |
| Location design → Props | Edit props | both | debounce | client | integration |
| Location design → Atmosphere | Edit atmosphere | both | debounce | client | integration |
| Character staging → Add | Add staging entry | local | debounce | none | component |
| Character staging → Position | Edit position | both | debounce | client | integration |
| Character staging → Action | Edit action | both | debounce | client | integration |
| Storyboard → Upload image | Upload storyboard image | server | api | client | integration |
| "Approve Production Design" button | Approve per scene | server | api | both | integration |
| "Approve All" button | Approve all scenes | server | api | both | integration |
| "Save" button | Explicit save | server | explicit | both | integration |

---

## 12. Audio (`/projects/[id]/audio`) — Stage 10

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Episode selector | Select episode | local | none | none | component |
| Voice profile → Create | Open create form | local | none | none | component |
| Voice profile → Name | Edit name | both | debounce | client | integration |
| Voice profile → Language | Select language | both | debounce | client | integration |
| Voice profile → Gender | Select gender | both | debounce | client | integration |
| Voice profile → Style | Edit style | both | debounce | client | integration |
| Voice profile → Test | Generate sample audio | server | api | both | integration |
| Voice profile → Play sample | Play audio | local | none | none | component |
| Voice assignment dropdown | Assign voice to character | server | api | both | integration |
| "Generate All Segments" button | Start TTS generation | server | api | both | integration |
| Segment progress indicator | Show per-segment progress | local | none | none | component |
| "Cancel" button | Cancel generation | server | api | none | integration |
| Segment → Play | Play segment audio | local | none | none | component |
| Segment → Pause | Pause playback | local | none | none | component |
| Segment → Seek | Seek playback position | local | none | none | component |
| Segment → Retry | Retry failed segment | server | api | both | integration |
| Segment → Approve | Approve segment | server | api | both | integration |
| Segment → Reject | Reject segment (reason) | server | api | both | integration |
| "Approve All" button | Approve all segments | server | api | both | integration |
| Music upload | Upload music file | server | api | client | integration |
| SFX upload | Upload SFX file | server | api | client | integration |

---

## 13. Video (`/projects/[id]/video`) — Stage 11

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Episode selector | Select episode | local | none | none | component |
| Scene card → "Generate Video" | Start video generation (mock) | server | api | both | integration |
| Scene card → "Upload Footage" | Upload video file | server | api | client | integration |
| Scene card → Video player | Play/pause/seek video | local | none | none | component |
| Shot footage list | View shot-level footage | local | none | none | component |
| Shot → Upload | Upload shot footage | server | api | client | integration |
| "Import Animation" button | Import animation file | server | api | client | integration |
| Mock indicator badge | Shows "MOCK" on mock assets | local | none | none | component |
| Generation status indicator | Show generating/ready/failed | local | none | none | component |

---

## 14. Timeline (`/projects/[id]/timeline`) — Stage 12

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Episode selector | Select episode | local | none | none | component |
| Time-axis ruler | Visual time markers | local | none | none | component |
| Track lane | Container for clips | local | none | none | component |
| Clip block | Visual clip on time-axis | local | none | none | component |
| Clip → Click | Select clip | local | none | none | component |
| Clip → Drag | Move clip (snaps to 0.1s grid) | both | debounce | both | integration |
| Clip → Drag left edge | Trim start | both | debounce | both | integration |
| Clip → Drag right edge | Trim end | both | debounce | both | integration |
| Clip → Right-click | Context menu | local | none | none | component |
| Clip context → Split | Split at playhead | local | debounce | none | component |
| Clip context → Delete | Delete clip | local | debounce | none | component |
| Clip context → Properties | Open properties panel | local | none | none | component |
| Playhead | Vertical line, draggable | local | none | none | component |
| Playhead → Drag | Seek preview | local | none | none | component |
| "Play" button | Start preview playback | local | none | none | component |
| "Pause" button | Pause playback | local | none | none | component |
| Preview monitor | Video preview at playhead | local | none | none | component |
| Track → Mute toggle | Mute/unmute track | local | debounce | none | component |
| Track → Solo toggle | Solo track | local | debounce | none | component |
| Track → Volume slider | Adjust track volume | both | debounce | client | integration |
| Track → "Add Clip" | Open asset picker | local | none | none | component |
| Asset picker → Select | Add clip to track | local | debounce | both | integration |
| Clip properties → Start input | Edit start time (synced with visual) | both | debounce | both | integration |
| Clip properties → Duration input | Edit duration | both | debounce | both | integration |
| Clip properties → Volume slider | Adjust clip volume | both | debounce | client | integration |
| Clip properties → Transition dropdown | Select transition | both | debounce | client | integration |
| Clip properties → Transition duration | Edit transition duration | both | debounce | both | integration |
| Clip properties → Source link | Navigate to source asset | local | none | none | e2e |
| Drag-and-drop reorder | Reorder clips within track | both | debounce | both | integration |
| Validation panel | Show errors (missing assets, overlaps) | local | none | none | component |
| "Save" button | Save timeline | server | explicit | both | integration |
| "Approve Timeline" button | Approve (blocked by errors) | server | api | both | integration |

---

## 15. Rendering (`/projects/[id]/rendering`) — Stage 13

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Episode selector | Select episode | local | none | none | component |
| Preset dropdown | Select render preset | local | debounce | client | component |
| Resolution input (W × H) | Edit resolution | local | debounce | both | component |
| Frame rate dropdown | Select fps | local | debounce | client | component |
| Codec dropdown | Select codec | local | debounce | client | component |
| Bitrate input | Edit bitrate | local | debounce | both | component |
| Audio mix dropdown | Select audio configuration | local | debounce | client | component |
| Subtitle burn-in toggle | Toggle subtitle burn-in | local | debounce | none | component |
| Watermark toggle | Toggle watermark | local | debounce | none | component |
| Watermark position | Select position | local | debounce | client | component |
| "Start Render" button | Start render job | server | api | both | integration |
| Job list | View render jobs | local | none | none | component |
| Job → Progress bar | Show progress | local | none | none | component |
| Job → Cancel | Cancel running job | server | api | none | integration |
| Job → Retry | Retry failed job | server | api | both | integration |
| Job → Download | Download completed render | local | none | none | integration |
| Render history | View past jobs | local | none | none | component |
| "Export" button | Export to external storage | server | api | both | integration |

---

## 16. Pipeline View (`/projects/[id]/pipeline`)

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Phase group headers | Expand/collapse phase | local | none | none | component |
| Stage item → Click | Navigate to stage page | local | none | none | e2e |
| Stage item → Status icon | Show stage status | local | none | none | component |
| Stage item → Lock icon | Show prerequisite tooltip | local | none | none | component |
| Stage item → Pending dot | Show pending approval | local | none | none | component |
| "Cancel Pipeline" button | Cancel pipeline (confirm) | server | api | both | integration |
| "Retry Stage" button | Retry failed stage | server | api | both | integration |
| Pipeline mode toggle | Switch guided/automatic | server | api | both | integration |

---

## 17. MCP Page (`/mcp`)

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Connection config tabs | Switch assistant config | local | none | none | component |
| Config snippet → Copy | Copy to clipboard | local | none | none | component |
| Connection status indicator | Show connected/disconnected | local | none | none | component |
| Activity log panel | View recent MCP operations | local | none | none | component |
| Activity → Project filter | Filter by project | local | none | none | component |
| Activity → Assistant filter | Filter by assistant | local | none | none | component |
| Activity → Time range | Filter by time | local | none | none | component |
| Activity item → Click | View operation detail | local | none | none | component |
| "Clear Activity" button | Clear log (confirm) | server | api | none | integration |

---

## 18. Settings (`/settings`)

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| LLM provider list | View/add/remove providers | both | api | both | integration |
| Provider → Add | Open add form | local | none | none | component |
| Provider → Edit | Edit provider config | both | debounce | both | integration |
| Provider → Delete | Remove provider (confirm) | server | api | none | integration |
| Provider → Test | Test connection | server | api | none | integration |
| API key input | Edit API key (masked) | both | api | client | integration |
| Provider priority drag | Reorder failover priority | both | api | none | integration |
| Preferences → Theme | Select theme | both | api | none | component |
| Preferences → Language | Select language | both | api | none | component |

---

## 19. Cross-Cutting Controls

### Approval Banner (appears on any page with pending approval)

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| "Review Changes" button | Open review dialog | local | none | none | component |
| "Approve" button | Approve change | server | api | both (version check) | integration |
| "Reject with Reason" button | Open reject dialog | local | none | none | component |
| Reject dialog → Submit | Reject with reason | server | api | both | integration |

### Toast Notifications

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Toast → Auto-dismiss | Dismiss after timeout | local | none | none | component |
| Toast → Manual dismiss | Dismiss on click | local | none | none | component |
| Error toast → "Retry" | Retry failed operation | server | api | both | integration |

### Navigation

| Control | Action | State | Persist | Validate | Test |
|---------|--------|-------|---------|----------|------|
| Sidebar nav item → Click | Navigate to section | local | none | server (gate check) | e2e |
| Sidebar → Phase group | Expand/collapse | local | none | none | component |
| "Back to Projects" button | Navigate to projects list | local | none | none | e2e |
| Breadcrumb → Click | Navigate to parent | local | none | none | e2e |

### Keyboard Shortcuts

| Shortcut | Action | State | Persist | Validate | Test |
|----------|--------|-------|---------|----------|------|
| `Ctrl+S` | Save current document | server | explicit | both | integration |
| `Ctrl+Enter` | Submit for approval | server | api | both | integration |
| `Esc` | Close dialog/panel | local | none | none | component |
| `?` | Show shortcuts help | local | none | none | component |
| `G` then letter | Go to section | local | none | none | e2e |

---

## 20. Test Coverage Summary

### By Screen

| Screen | Unit | Integration | Component | E2E | Total Controls |
|--------|------|-------------|-----------|-----|----------------|
| Dashboard | 0 | 4 | 4 | 3 | 11 |
| Projects List | 0 | 2 | 5 | 1 | 8 |
| Project Setup | 0 | 8 | 1 | 1 | 10 |
| Creative Planning | 0 | 8 | 4 | 0 | 12 |
| Story Bible | 0 | 8 | 3 | 0 | 11 |
| Season & Episodes | 0 | 8 | 3 | 0 | 11 |
| Characters & Locations | 0 | 14 | 5 | 0 | 19 |
| Scene Breakdown | 0 | 7 | 3 | 1 | 11 |
| Screenplay | 0 | 10 | 3 | 0 | 13 |
| Canon & Continuity | 0 | 5 | 6 | 1 | 12 |
| Production Design | 0 | 8 | 3 | 0 | 11 |
| Audio | 0 | 8 | 4 | 0 | 12 |
| Video | 0 | 4 | 4 | 0 | 8 |
| Timeline | 0 | 8 | 8 | 0 | 16 |
| Rendering | 0 | 5 | 6 | 0 | 11 |
| Pipeline View | 0 | 3 | 4 | 1 | 8 |
| MCP Page | 0 | 2 | 5 | 0 | 7 |
| Settings | 0 | 5 | 3 | 0 | 8 |
| Cross-Cutting | 0 | 3 | 5 | 2 | 10 |
| **Total** | **0** | **112** | **79** | **10** | **201** |

### Coverage Requirements
- Every control with `Persist: api` must have an integration test
- Every control with `Validate: both` must have a client validation test (unit) and a server validation test (integration)
- Every control with `Test: none` must be tested before implementation is considered complete
- Every page must have at least one E2E test covering the primary user flow
- Every form must have validation tests for required fields, type constraints, and edge cases

### Estimated New Tests
- **Unit**: ~150 (validation schemas, utilities, formatters)
- **Integration**: ~112 (API routes, service methods)
- **Component**: ~79 (component rendering, user interactions)
- **E2E**: ~10 (primary flows per screen)
- **Total**: ~351 new tests