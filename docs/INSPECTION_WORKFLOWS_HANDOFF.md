# Inspection Workflows — Developer Handoff Guide

## Overview

Inspection Workflows define the step-by-step phases the AI voice agent follows during a field inspection. Each workflow is peril-specific (Hail, Wind, Water, Fire, General) and contains ordered steps with agent prompts, required tools, and completion criteria. Users can manage workflows from **Settings > Inspection Workflows**.

The system ships with 5 read-only system default flows. Users can clone any system flow to create a customizable copy, or create flows from scratch.

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                   │
│                                                                      │
│  SettingsPage.tsx                                                     │
│  └─ "Manage Inspection Flows" button → navigates to /settings/workflows │
│                                                                      │
│  WorkflowBuilder.tsx  (/settings/workflows)                          │
│  ├─ FlowCard          — displays flow summary, edit/clone/delete     │
│  ├─ FlowEditor        — edit flow name, peril, description, steps    │
│  └─ StepEditor        — edit individual step fields                  │
│       ├─ phaseName                                                   │
│       ├─ agentPrompt                                                 │
│       ├─ requiredTools (toggle chips from AVAILABLE_TOOLS list)      │
│       └─ completionCriteria                                          │
│                                                                      │
│  ActiveInspection.tsx                                                │
│  └─ On voice session start, receives activeFlow from the server      │
│     and injects it into the Realtime API session instructions         │
│     as "INSPECTION FLOW (name — perilType): Phase 1: ..., Phase 2: ..."│
└──────────────────┬───────────────────────────────────────────────────┘
                   │  HTTP (REST)
                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                           BACKEND                                    │
│                                                                      │
│  server/routes/flows.ts                                              │
│  └─ CRUD routes: GET/POST/PUT/DELETE /api/flows + /api/flows/:id/clone│
│                                                                      │
│  server/routes/realtime.ts                                           │
│  └─ POST /api/realtime/session                                       │
│     1. Accepts optional flowId in request body                       │
│     2. Falls back to getDefaultFlowForPeril(perilType, userId)       │
│     3. Attaches activeFlow object to the ephemeral session token     │
│     4. Saves activeFlowId on the inspection_sessions row             │
│                                                                      │
│  server/seed-flows.ts                                                │
│  └─ seedInspectionFlows() — upserts 5 system default flows           │
│     Triggered via POST /api/flows/seed (admin only)                  │
│                                                                      │
│  server/storage.ts                                                   │
│  └─ IStorage interface & DatabaseStorage implementation              │
│     createInspectionFlow, getInspectionFlows, getInspectionFlow,     │
│     getDefaultFlowForPeril, updateInspectionFlow, deleteInspectionFlow│
└──────────────────┬───────────────────────────────────────────────────┘
                   │  Drizzle ORM
                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         DATABASE                                     │
│                                                                      │
│  Table: inspection_flows                                             │
│  ├─ id              SERIAL PRIMARY KEY                               │
│  ├─ user_id         VARCHAR → users.id (nullable, null = system)     │
│  ├─ name            TEXT NOT NULL                                     │
│  ├─ peril_type      TEXT NOT NULL ("Hail"|"Wind"|"Water"|"Fire"|"General")│
│  ├─ description     TEXT                                             │
│  ├─ is_default      BOOLEAN (user's preferred flow for this peril)   │
│  ├─ is_system_default BOOLEAN (read-only, shipped with the app)      │
│  ├─ steps           JSONB NOT NULL (array of InspectionStep)         │
│  ├─ created_at      TIMESTAMP                                        │
│  └─ updated_at      TIMESTAMP                                        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## File Reference

| File | Purpose |
|------|---------|
| `shared/schema.ts` (lines 666-696) | `InspectionStep` type, `inspectionFlows` table, insert schema, select type |
| `client/src/pages/WorkflowBuilder.tsx` | Full UI for listing, creating, editing, cloning, deleting flows |
| `client/src/pages/SettingsPage.tsx` (lines 318-334) | Settings section with "Manage Inspection Flows" button |
| `client/src/pages/ActiveInspection.tsx` (lines 2665-2743) | Consumes `activeFlow` from session token, injects into voice agent instructions |
| `server/routes/flows.ts` | REST API routes for flow CRUD + clone + seed |
| `server/routes/realtime.ts` (lines 47-198) | Resolves which flow to use for a voice session, attaches to token |
| `server/seed-flows.ts` | Default flow definitions (hailSteps, windSteps, waterSteps, fireSteps, generalSteps) |
| `server/storage.ts` (lines 1417-1490) | Database operations for inspection flows |

---

## Data Model

### InspectionStep (JSONB stored in `steps` column)

```typescript
type InspectionStep = {
  id: string;              // Unique step ID, e.g. "hail_01", "wind_03"
  phaseName: string;       // Human-readable phase name, e.g. "Roof Overview & Access"
  agentPrompt: string;     // Instructions the AI voice agent follows during this phase
  requiredTools: string[]; // Which voice tools are available/expected during this phase
  completionCriteria: string; // What must happen before moving to the next step
};
```

### Available Tools (defined in WorkflowBuilder.tsx)

These are the voice agent tools that can be assigned to steps:

| Tool | Purpose |
|------|---------|
| `set_inspection_context` | Set global inspection metadata (region, roof type, etc.) |
| `create_structure` | Create a structure (Main Dwelling, Garage, etc.) |
| `get_inspection_state` | Retrieve current inspection state/briefing |
| `get_room_details` | Get details for a specific room |
| `create_room` | Create a room/area (interior room, roof facet, elevation) |
| `create_sub_area` | Create a sub-area within a room (closet, pantry) |
| `add_opening` | Add door/window to a room |
| `add_sketch_annotation` | Add annotation to property sketch |
| `complete_room` | Mark a room as fully inspected |
| `add_damage` | Record a damage observation |
| `add_line_item` | Add a scope/estimate line item |
| `trigger_photo_capture` | Prompt adjuster to take a photo |
| `log_moisture_reading` | Record a moisture reading |
| `get_progress` | Check inspection completeness |
| `get_estimate_summary` | Review the running estimate |
| `skip_step` | Skip current phase (password: "123") |
| `apply_smart_macro` | Apply a predefined scope template |
| `check_related_items` | Find missing companion items |
| `log_test_square` | Record hail test square data |
| `apply_peril_template` | Apply peril-specific scope template to a room |
| `complete_inspection` | Mark inspection as complete |

---

## API Routes

All routes are prefixed with `/api/flows` and require authentication.

| Method | Route | Description | Access |
|--------|-------|-------------|--------|
| `GET` | `/api/flows` | List all flows (system defaults + user's custom). Optional `?perilType=Hail` filter. | Any authenticated user |
| `GET` | `/api/flows/:id` | Get a specific flow by ID | Owner or system default |
| `POST` | `/api/flows` | Create a new custom flow | Any authenticated user |
| `PUT` | `/api/flows/:id` | Update a flow (name, peril, description, isDefault, steps) | Owner only (system defaults blocked) |
| `DELETE` | `/api/flows/:id` | Delete a custom flow | Owner only (system defaults blocked) |
| `POST` | `/api/flows/:id/clone` | Clone a flow into a new user-owned copy | Any accessible flow |
| `POST` | `/api/flows/seed` | Re-seed/update system default flows from code | Admin only |

### Request Body (Create/Update)

```json
{
  "name": "My Custom Hail Flow",
  "perilType": "Hail",
  "description": "Modified hail flow with extra roof detail",
  "isDefault": true,
  "steps": [
    {
      "id": "custom_01",
      "phaseName": "Pre-Inspection Review",
      "agentPrompt": "Review the briefing highlights...",
      "requiredTools": ["get_inspection_state"],
      "completionCriteria": "Adjuster confirms briefing reviewed."
    }
  ]
}
```

---

## How Flows Connect to Voice Inspections

1. **User starts a voice inspection** from `ActiveInspection.tsx`
2. Frontend calls `POST /api/realtime/session` with optional `flowId`
3. Backend resolves the flow:
   - If `flowId` provided → fetch that specific flow
   - Otherwise → `getDefaultFlowForPeril(perilType, userId)` which checks:
     1. User's custom default for this peril
     2. System default for this peril
     3. System default for "General" as fallback
4. The flow is serialized into the ephemeral session token as `activeFlow`
5. `activeFlowId` is saved on the `inspection_sessions` row
6. Frontend reads `activeFlow` from the token and injects the phase list into the voice agent's system instructions:
   ```
   INSPECTION FLOW (Standard Hail Inspection — Hail):
   Phase 1: Pre-Inspection Review
   Phase 2: Session Setup & Structure Identification
   Phase 3: Collateral Damage Check
   ...
   ```
7. The voice agent uses these instructions to guide the adjuster through each phase

---

## Business Rules

- **System defaults are read-only**: Users cannot edit or delete them. They must clone first.
- **One default per peril per user**: The `isDefault` flag determines which flow auto-selects when starting an inspection for that peril type.
- **System defaults are global**: `userId` is `null`, `isSystemDefault` is `true`. They appear for all users.
- **User flows are private**: Only visible to the owning user (filtered by `userId` in queries).
- **Seed is idempotent**: `seedInspectionFlows()` updates existing system defaults if they already exist (matched by name + perilType + isSystemDefault). It won't create duplicates.
- **Clone naming**: Cloned flows get " (Custom)" appended to the name by default.

---

## Default Flows (Shipped with App)

| Flow Name | Peril | Steps | Key Phases |
|-----------|-------|-------|------------|
| Standard Hail Inspection | Hail | 11 | Collateral check → Test squares → Roof accessories → Gutters → Elevations → Interior → Estimate |
| Standard Wind Inspection | Wind | 8 | Directional damage → Structural check → Elevations (windward vs leeward) → Fencing/trees → Interior → Estimate |
| Water Mitigation & Damage | Water | 8 | Source ID → IICRC category/class → Moisture mapping → Damage documentation → Mitigation equipment → Contents → Estimate |
| Fire & Smoke Damage | Fire | 6 | Safety review → Exterior → Fire origin room → Smoke/heat spread → Suppression water damage → Estimate |
| General Property Inspection | General | 7 | Pre-inspection → Setup → Exterior → Interior → Evidence review → Estimate → Finalize |

---

## Storage Layer (server/storage.ts)

The `IStorage` interface defines these methods:

```typescript
createInspectionFlow(data: InsertInspectionFlow): Promise<InspectionFlow>;
getInspectionFlows(userId?: string): Promise<InspectionFlow[]>;
getInspectionFlow(id: number): Promise<InspectionFlow | undefined>;
getDefaultFlowForPeril(perilType: string, userId?: string): Promise<InspectionFlow | undefined>;
updateInspectionFlow(id: number, updates: Partial<InsertInspectionFlow>): Promise<InspectionFlow | undefined>;
deleteInspectionFlow(id: number): Promise<boolean>;
```

Key behavior of `getInspectionFlows(userId)`:
- Returns all rows where `is_system_default = true` OR `user_id = userId`
- Ordered by `peril_type`, then `name`

Key behavior of `getDefaultFlowForPeril(perilType, userId)`:
1. Check for user's custom flow with `isDefault=true` for this peril
2. Fall back to system default with `isDefault=true` for this peril
3. Fall back to system default "General" flow

---

## Common Modifications

### Adding a new peril type
1. Add the peril string to `PERIL_TYPES` array in `WorkflowBuilder.tsx` (line 68)
2. Add a color entry in `PERIL_COLORS` (line 93)
3. Create new steps array and seed entry in `server/seed-flows.ts`
4. Run `POST /api/flows/seed` or restart the app to seed

### Adding a new voice tool
1. Add the tool name to `AVAILABLE_TOOLS` array in `WorkflowBuilder.tsx` (line 70)
2. Implement the tool handler in `ActiveInspection.tsx` (in the voice tool switch statement)
3. Register it in the OpenAI Realtime session tool definitions
4. Add it to the relevant flow steps' `requiredTools` arrays

### Modifying a system default flow
1. Edit the step arrays in `server/seed-flows.ts` (e.g., `hailSteps`, `windSteps`)
2. The `seedInspectionFlows()` function will update existing rows on next seed
3. Trigger via `POST /api/flows/seed` or redeploy

### Adding fields to InspectionStep
1. Update the `InspectionStep` type in `shared/schema.ts` (line 669)
2. Update the `flowBodySchema` Zod validator in `server/routes/flows.ts` (line 8)
3. Update the `InspectionStep` interface in `WorkflowBuilder.tsx` (line 47)
4. Add UI controls in the `StepEditor` component
5. The `steps` column is JSONB, so no database migration is needed

---

## Frontend Component Structure

```
WorkflowBuilder (main page component)
├── State: editingFlow, filterPeril, deleteTarget, showNewFlow
├── Queries: GET /api/flows
├── Mutations: create, clone, delete
│
├── FlowCard (one per flow in the list)
│   ├── Shows: name, peril badge, step count, description
│   ├── Lock icon for system defaults
│   ├── Star icon for default flows
│   └── Actions: Edit (pencil), Clone (copy), Delete (trash, non-system only)
│
├── FlowEditor (shown when editingFlow is set)
│   ├── Fields: name, perilType (select), description, isDefault (checkbox)
│   ├── System flows are fully read-only (all inputs disabled)
│   ├── Save button triggers PUT /api/flows/:id
│   └── Contains list of StepEditors
│
└── StepEditor (one per step, collapsible)
    ├── Collapsed: step number, phase name, reorder buttons, delete button
    └── Expanded: phaseName input, agentPrompt textarea, requiredTools toggles, completionCriteria input
```

---

## Testing Checklist

- [ ] List flows shows system defaults for a new user
- [ ] Create a new blank flow → appears in list
- [ ] Edit a custom flow (change name, add/remove/reorder steps) → saves correctly
- [ ] System default flows are read-only (edit button opens view mode, inputs disabled)
- [ ] Clone a system flow → creates editable copy with "(Custom)" suffix
- [ ] Delete a custom flow → removed from list
- [ ] Cannot delete system defaults (no delete button shown)
- [ ] Filter by peril type works
- [ ] Starting a voice inspection with a custom default flow → voice agent receives correct flow phases
- [ ] `POST /api/flows/seed` re-seeds without creating duplicates
- [ ] `getDefaultFlowForPeril` fallback chain works (user default → system default → General)
