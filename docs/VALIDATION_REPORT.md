# Workflow Quality Validation Report

**Date**: 2026-02-19
**Scope**: P0-A through P1-E holistic workflow quality capabilities

---

## Validation Checklist

| ID | Capability | Status | Summary |
|----|-----------|--------|---------|
| P0-A | Voice stability: tool output never strands conversation | ✅ Implemented | Queue + drain + deferred response.create fully wired |
| P0-B | Photo analysis contract normalization (analyzer↔bridge↔gate) | 🟡 Partial | Bridge correct; gate reads wrong field + uses regex heuristic |
| P0-C | Damage↔scope linkage uses damageId | 🟡 Partial | Insert path correct; scopeGate uses `description.includes()` |
| P1-D | Tool allowlist + workflow context enforced at execution | 🟡 Partial | PHASE_ALLOWED_TOOLS + assert functions exist but never called |
| P1-E | Export gating uses all relevant blockers | 🟡 Partial | Sketch+scope compose; photoDamage missing; ordering non-deterministic |

---

## P0-A — Voice Stability ✅ Implemented

### Evidence

| Mechanism | File | Lines |
|-----------|------|-------|
| `agentSpeakingRef` tracking | `client/src/pages/ActiveInspection.tsx` | 211, 2475, 2481 |
| `shouldQueueToolCall()` | `client/src/lib/realtimeVoiceState.ts` | 8-10 |
| `pendingToolCallsRef` queue | `client/src/pages/ActiveInspection.tsx` | 214, 2443 |
| `sendResponseCreateSafely()` guard | `client/src/pages/ActiveInspection.tsx` | 384-392 |
| Deferred `response.create` in tool handler | `client/src/pages/ActiveInspection.tsx` | 632-637 |
| `flushPendingToolCalls()` drain | `client/src/pages/ActiveInspection.tsx` | 2402-2429 |
| Drain trigger on `response.audio.done` | `client/src/pages/ActiveInspection.tsx` | 2485 |
| FIFO `drainToolQueue()` | `client/src/lib/realtimeVoiceState.ts` | 12-24 |
| IMMEDIATE_TOOLS bypass for photo capture | `client/src/pages/ActiveInspection.tsx` | 95, 2436 |

### Test coverage
- `tests/client/realtimeVoiceState.test.ts`: shouldQueueToolCall + drainToolQueue FIFO

### Conclusion
No early-return drops `response.create`. Tool calls during speech are queued and drained after `response.audio.done`. **No changes needed.**

---

## P0-B — Photo Analysis Contract Normalization 🟡 Partial

### What's correct

| Component | Status | Evidence |
|-----------|--------|---------|
| Vision API → `PhotoAnalysis` shape | ✅ | `server/routes/inspection.ts:2115-2137` stores `{ damageVisible, matchConfidence }` |
| `processPhotoAnalysis()` accepts `PhotoAnalysis` | ✅ | `server/photoScopeBridge.ts:99-139` reads `matchConfidence` + `damageVisible` |
| Confidence tier system | ✅ | `server/types/photoConfidence.ts` — 4 tiers with presentation templates |
| Test coverage for bridge + tiers | ✅ | `test/photoConfidence.test.ts` |

### What's broken

1. **`photoDamageGate.ts:25`** — reads `(p.analysis as any)?.confidence` but the stored field is `matchConfidence`.
   - Effect: confidence gate check always reads 0 → never fires a warning for high-confidence mismatches.

2. **`photoDamageGate.ts:31`** — uses `JSON.stringify(p.analysis ?? {}).match(/damage|hail|crack|water/i)` regex on serialized JSON.
   - Effect: false positives when JSON field names match (e.g. `"damageVisible"` contains `"damage"`). Unreliable.
   - Fix: check `(p.analysis as any)?.damageVisible?.length > 0` instead.

---

## P0-C — Damage ↔ Scope Linkage Uses damageId 🟡 Partial

### What's correct

| Component | Status | Evidence |
|-----------|--------|---------|
| Schema: `scopeItems.damageId` FK | ✅ | `shared/schema.ts:530` |
| Schema: `lineItems.damageId` FK | ✅ | `shared/schema.ts:336` |
| `assembleScope()` always sets `damageId` | ✅ | `server/scopeAssemblyService.ts:601` |
| `companionEngine` preserves `damageId` | ✅ | `server/companionEngine.ts:230` |
| Scope→LineItem copy preserves `damageId` | ✅ | `server/routes/inspection.ts:1019` |
| `scopeValidation.ts` checks `damageId === damage.id` | ✅ | `server/scopeValidation.ts:61` |

### What's broken

1. **`scopeGate.ts:24`** — coverage check uses `items.some(li => li.roomId === d.roomId && (li.description || "").toLowerCase().includes((d.damageType || "").toLowerCase()))`.
   - This is string matching on description text, not `damageId` linkage.
   - Fix: replace with `li.damageId === d.id` (or also check scopeItems via `damageId`).

2. **`scopeGate.ts:33`** — duplicate detection uses `category:roomId` as key.
   - Multiple damages in same room can legitimately generate same-category items.
   - Fix: use `category:roomId:damageId` as dedup key.

---

## P1-D — Tool Allowlist + Workflow Context Enforced at Execution 🟡 Partial

### What's correct

| Component | Status | Evidence |
|-----------|--------|---------|
| `PHASE_ALLOWED_TOOLS` mapping (10 phases) | ✅ | `shared/contracts/workflow.ts:29-40` |
| `getAllowedTools(state)` | ✅ | `server/workflow/orchestrator.ts:37-39` |
| `assertToolAllowed(state, toolName)` | ✅ Defined | `server/workflow/orchestrator.ts:41-45` |
| `assertToolContext(state, toolName, args)` | ✅ Defined | `server/workflow/orchestrator.ts:47-56` |
| `ToolResult` envelope + `CONTEXT_ERROR` type | ✅ | `shared/contracts/tools.ts`, `shared/contracts/errors.ts` |
| Client-side hints (system prompt + allowedTools list) | ✅ | `server/routes/realtime.ts:58,160` |

### What's missing

- **`assertToolAllowed()` is never called** in any server route or tool handler.
- **`assertToolContext()` is never called** in any server route.
- **`onToolResult()` is never called** in any server route.
- All 232 tool endpoints execute without phase validation.
- Fix: add `validateToolForWorkflow()` middleware wrapper that tool routes call before execution.

---

## P1-E — Export Gating Uses All Relevant Blockers 🟡 Partial

### What's correct

| Component | Status | Evidence |
|-----------|--------|---------|
| `exportGate` checks session + claim metadata | ✅ | `server/workflow/validators/exportGate.ts:18-25` |
| `exportGate` composes sketch blockers | ✅ | `exportGate.ts:28-29` |
| `exportGate` composes scope coverage warnings | ✅ | `exportGate.ts:31-32` |
| `esxValidator` validates metadata at generation | ✅ | `server/esxValidator.ts:23-227` |
| `runAllWorkflowGates()` runs all 4 gates | ✅ | `server/workflow/validators/index.ts:7-15` |
| Gate results stored in workflow state | ✅ | `server/workflow/orchestrator.ts:69-80` |

### What's missing

1. **`exportGate` does not reference `photoDamageGate`** — photo issues never block/warn export.
   - Fix: run `runPhotoDamageGate()` and propagate its warnings.

2. **Export XML ordering is non-deterministic** — `Object.entries(roomGroups)` in `esxGenerator.ts:422` doesn't sort.
   - Fix: sort room groups alphabetically, sort items within room by description/code.

---

## Implementation Plan

Only the gaps above need fixing. Already-correct code is left untouched.

| Fix | File(s) | Scope |
|-----|---------|-------|
| B1: photoDamageGate confidence field | `server/workflow/validators/photoDamageGate.ts` | 1 line |
| B2: photoDamageGate regex → structured check | `server/workflow/validators/photoDamageGate.ts` | 1 line |
| C1: scopeGate damageId linkage | `server/workflow/validators/scopeGate.ts` | 2 lines |
| C2: scopeGate dedup includes damageId | `server/workflow/validators/scopeGate.ts` | 1 line |
| D1: validateToolForWorkflow() wrapper | `server/workflow/orchestrator.ts` | New function |
| D2: Wire wrapper into tool execution | `server/routes/inspection.ts` | Wrap tool endpoints |
| E1: exportGate includes photoDamageGate | `server/workflow/validators/exportGate.ts` | Add import + call |
| E2: Deterministic export ordering | `server/esxGenerator.ts` | Sort room groups + items |
| Tests for all of the above | `tests/server/workflowGates.test.ts` | New test file |
