# Creative Planning MCP Audit (Phase 0)

## Summary

The `planning.update` MCP tool currently exposes only **6 of 12** creative planning
fields. The database model, validation schema, repository, service, REST API, and
frontend form all already support the full 12-field document. The gap is solely in
the MCP tool's input schema and handler mapping.

## The 12 Creative Planning Fields

| # | Field | MCP input | Nested path | Status |
|---|-------|-----------|-------------|--------|
| 1 | logline | `logline` | `concept.logline` | exposed |
| 2 | synopsis | `synopsis` | `concept.synopsis` | exposed |
| 3 | elevatorPitch | — | `concept.elevatorPitch` | **missing** |
| 4 | themes | `themes` | `themes` | exposed |
| 5 | centralQuestion | `centralQuestion` | `centralQuestion` | exposed |
| 6 | mainConflict | `mainConflict` | `mainConflict` | exposed |
| 7 | demographic | — | `audience.demographic` | **missing** |
| 8 | audienceTone | — | `audience.tone` | **missing** |
| 9 | contentRating | — | `audience.contentRating` | **missing** |
| 10 | structure | — | `narrativeDirection.structure` | **missing** |
| 11 | pov | — | `narrativeDirection.pov` | **missing** |
| 12 | pacing | — | `narrativeDirection.pacing` | **missing** |

## Files Inspected

### 1. MCP Tool Registration — `lib/mcp/server.ts:1683-1760`

`registerPlanningTools` registers 4 tools:

- **`planning.get`** (line 1685) — takes `projectId`, returns the latest planning
  document. Already returns all 12 fields. **No change needed.**

- **`planning.update`** (line 1696) — input schema accepts only:
  `projectId`, `logline`, `synopsis`, `themes`, `centralQuestion`, `mainConflict`.
  The handler reads the existing document and falls back to its values for
  unexposed fields (`elevatorPitch`, `audience`, `narrativeDirection`), so
  existing data is preserved — but an MCP client **cannot set** those 6 fields.
  **This is the gap.**

- **`planning.submit`** (line 1726) — transitions draft/rejected → submitted.
  **No change needed.**

- **`planning.approve`** (line 1742) — approves or rejects (with
  `rejectionReason`). **No change needed.**

### 2. Validation Schema — `lib/validation/planning.ts`

`planningDocumentSchema` (line 18) already defines all 12 fields with proper
Zod constraints (max lengths, defaults, trimming). Used by the REST API.
**No change needed.**

### 3. Database Model — `lib/models/planningDocument.ts`

`PlanningDocumentSchema` (line 24) already has all 12 fields with Mongoose
schema definitions, maxlengths, and defaults. **No change needed.**

### 4. Repository — `lib/repositories/planningRepository.ts`

`create` and `update` accept `PlanningDocumentInput` / `Partial<PlanningDocumentInput>`,
which already include all 12 fields. **No change needed.**

### 5. Service — `lib/services/planningService.ts`

`createOrUpdate` (line 27) accepts `PlanningDocumentInput` (all 12 fields).
Delegates to repository. Enforces project ownership. **No change needed.**

### 6. REST API Routes

- `POST /api/projects/[projectId]/planning` — uses `planningDocumentSchema`
  (all 12 fields). **Already complete.**
- `POST .../planning/submit` — submit for review. **Already complete.**
- `POST .../planning/approve` — approve/reject. **Already complete.**
- `GET .../planning/versions` — list versions. **Already complete.**

### 7. Frontend — `app/(studio)/projects/[projectId]/planning/page.tsx`

The planning form already renders all 12 fields (logline, synopsis,
elevatorPitch, themes, centralQuestion, mainConflict, audience.demographic,
audience.tone, audience.contentRating, narrativeDirection.structure,
narrativeDirection.pov, narrativeDirection.pacing). **Already complete.**

### 8. Existing Tests

- `tests/scene-planning.test.ts` — tests **production scene** shot plans,
  unrelated to creative planning.
- `tests/revision-planning.test.ts` — tests **revision plan** domain logic,
  unrelated to creative planning.
- `tests/mcp-server.test.ts` — tests MCP server tool registration and a few
  tools (project, document, canon, media, render). Does **not** test
  `planning.update`.

**No existing tests cover the creative planning MCP tool.**

## Implementation Proposal

### Phase 1 — Extend MCP Input Schema

Add 7 new optional top-level input fields to `planning.update`:
`elevatorPitch`, `demographic`, `audienceTone`, `contentRating`, `structure`,
`pov`, `pacing`. Flat naming (matching existing `logline`, `synopsis` style)
keeps the MCP interface simple for clients and is backward compatible (all new
fields are optional).

### Phase 2 — Map Fields in Handler

Update the handler to map the new flat inputs into the nested document
structure (`concept.elevatorPitch`, `audience.demographic`, etc.), with
fallback to existing values when an input is omitted.

### Phase 3 — Partial Update Safety

The existing fallback pattern (`args.field ?? existing?.field ?? default`)
already preserves unmentioned fields. Extend it to cover all 7 new fields so
that a partial update (e.g. only setting `pacing`) does not erase previously
saved `demographic` or `structure` values.

### Phase 4 — Approval Workflow

No change. `planning.update` calls `createOrUpdate` which only operates on
draft/rejected documents (or creates a new draft). `planning.submit` and
`planning.approve` remain separate tools. Saving never auto-submits or
auto-approves.

### Phase 5 — Tests

Write `tests/planning-mcp.test.ts` covering:
- All 12 fields save and retrieve correctly.
- Partial update (set one field) preserves other previously saved fields.
- Invalid input (over-length strings) is rejected.
- Unauthorized access (wrong user) is rejected.
- Saving does not auto-submit or auto-approve.
- Backward compatibility: calling with only the original 6 fields still works.

### Phase 6 — Verification

Run `npm run typecheck`, `npm run lint`, and `npm test`. Verify the MCP tool
schema via the tool registry.