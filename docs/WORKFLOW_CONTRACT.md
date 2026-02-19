# Workflow Contract

This project now uses a canonical workflow contract persisted per inspection session in `inspection_sessions.workflow_state_json`.

## Phases

1. briefing
2. inspection_setup
3. interior_rooms
4. openings
5. elevations
6. roof
7. photos_damage
8. scope_build
9. review
10. export

Each phase has a default `stepId` and phase-level tool allowlist defined in `shared/contracts/workflow.ts`.

## Runtime Enforcement

- Orchestrator entrypoints: `server/workflow/orchestrator.ts`
  - `initSessionWorkflow`
  - `getAllowedTools`
  - `assertToolAllowed`
  - `assertToolContext`
  - `onToolResult`
  - `runGates`
  - `canAdvance`
  - `advance`
- Realtime session bootstrap now injects phase/step/allowlist into system instructions.

## Gate Validators

Implemented in `server/workflow/validators/*` with uniform `GateResult` output:

- `sketchGate`: room/opening geometry and elevation integrity checks.
- `photoDamageGate`: photo analysis presence, confidence gating, and room association checks.
- `scopeGate`: damage-to-scope coverage, duplicates, provenance checks.
- `exportGate`: aggregates export blockers/warnings including sketch/scope dependencies.

Endpoints:

- `GET /api/inspection/:sessionId/workflow`
- `POST /api/inspection/:sessionId/gates/run`
- `GET /api/inspection/:sessionId/gates`

## Timeline Observability

Events are stored in `inspection_session_events`:

- `POST /api/inspection/:sessionId/timeline` (batch ingest)
- `GET /api/inspection/:sessionId/timeline?since=...`

Suggested event types include:

- `realtime.event`
- `tool.queued`
- `tool.executed`
- `tool.result`
- `gate.run` / `gate.result`
- `workflow.phase_changed`
- `workflow.context_changed`

## QA E2E Harness

Run deterministic workflow QA:

```bash
npm run qa:e2e
```

This runs `tests/e2e/claim_to_export.test.ts` with two fixtures:

1. Interior + openings + photo + scope + export path
2. Hail/wind roof + elevation scenario
