# Workflow Quality Backlog — Implemented vs Remaining

Last updated: 2026-02-19

## Implemented (closed)

### P0-A: Voice stability — tool output never strands conversation ✅
**Status**: Already implemented by John. No changes needed.
- Queue/drain mechanism for tool calls during agent speech
- `sendResponseCreateSafely()` central guard
- Deferred `response.create` in tool handler
- FIFO `drainToolQueue()` on `response.audio.done`
- IMMEDIATE_TOOLS bypass for photo capture
- **Tests**: `tests/client/realtimeVoiceState.test.ts`

### P0-B: Photo analysis contract normalization ✅
**Status**: Bridge was correct; **gate fixed** in this PR.
- Analyzer → bridge → confidence tiers: already wired
- **Fixed**: `photoDamageGate` was reading `analysis.confidence` (wrong) → now reads `analysis.matchConfidence`
- **Fixed**: Regex heuristic `JSON.stringify().match(...)` → replaced with `damageVisible.length > 0`
- **Tests**: `tests/server/workflowGates.test.ts` (P0-B suite, 4 tests)

### P0-C: Damage ↔ scope linkage uses damageId ✅
**Status**: Insert path was correct; **scopeGate fixed** in this PR.
- `assembleScope()` always sets `damageId` + `provenance: "damage_triggered"`
- `companionEngine` preserves `damageId`
- `scopeValidation.ts` already used `damageId === damage.id` (correct)
- **Fixed**: `scopeGate` coverage check — replaced `description.includes()` with `damageId` equality
- **Fixed**: Dedup key — changed from `category:roomId` to `category:roomId:damageId`
- **Tests**: `tests/server/workflowGates.test.ts` (P0-C suite, 5 tests)

### P1-D: Tool allowlist + workflow context enforced at execution ✅
**Status**: Mappings & assert functions existed; **server-side enforcement added** in this PR.
- `PHASE_ALLOWED_TOOLS` (10 phases): already defined
- `assertToolAllowed()`, `assertToolContext()`, `onToolResult()`: already defined
- **Added**: `validateToolForWorkflow()` — server-side wrapper that checks phase + context
- **Added**: `ROUTE_TOOL_MAP` + Express middleware on `/api/inspection/:sessionId` routes
- Returns `ToolResult { success:false, error: { type:"CONTEXT_ERROR" } }` with hint
- **Tests**: `tests/server/workflowGates.test.ts` (P1-D suite, 7 tests including resolveToolName)

### P1-E: Export gating uses all relevant blockers ✅
**Status**: Sketch+scope composed; **photoDamage + ordering fixed** in this PR.
- `exportGate` already checked session, claim metadata, sketch blockers, scope coverage
- **Fixed**: `exportGate` now also runs `runPhotoDamageGate()` and propagates its issues
- **Fixed**: `generateRoughDraft()` now sorts rooms alphabetically + items by description
- **Tests**: `tests/server/workflowGates.test.ts` (P1-E suite, 2 tests)

---

## Remaining (not in scope for this PR)

### Architecture improvements (low priority)
- Define `PhotoAnalysisCanonical` type for formal adapter pattern between analyzer shapes
- Align standalone photo analysis shape (`analyzePhotoDamage`) with inspection photo shape
- Consider middleware-level tool result tracking via `onToolResult()` for state machine

### Pre-existing test issues
- `tests/server/realtimeTools.test.ts` — "includes core behavioral sections" fails on "Photo Triggers" string check (system instructions content drift)
- Infrastructure: no Postgres in CI for e2e tests (mocks added as workaround)

---

## How to run tests

```bash
# All unit + integration tests (279 pass)
npm test

# Workflow quality gate tests only
npx vitest run tests/server/workflowGates.test.ts

# E2E claim-to-export harness
npx vitest run tests/e2e/claim_to_export.test.ts
```
