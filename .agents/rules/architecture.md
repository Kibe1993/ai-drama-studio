---
trigger: always_on
---

# AI Drama Studio Architectural Rules

1. **Layer Separation**:
   - Route Handlers (`app/api/`): Thin controllers only. Enforce Clerk authentication, Zod request body validation, and user ownership before invoking domain services.
   - Domain Services (`lib/services/`): Enforce business rules, status checks, and pipeline transitions.
   - Repositories (`lib/repositories/`): Encapsulate MongoDB model queries.
   - Adapters (`lib/providers/`): Wrap vendor APIs with standardized interfaces.

2. **Pipeline Gates**:
   - Story generation always requires explicit human approval before downstream processing.
   - Background jobs are queued via BullMQ (`workers/studio.ts`).
   - Mock engines for video and render must report `MOCK`/`UNAVAILABLE` and cannot be treated as real media assets.

3. **Code Quality & Verification**:
   - Verify changes with `npm run typecheck` and `npm test` before concluding tasks.
   - Keep dependencies up-to-date with Next.js 15 Turbopack and React 19 standards.
