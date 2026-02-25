# Inspection Workflows — Developer Implementation Guide

Complete specification for implementing the Inspection Workflows system: the database-driven, peril-specific workflow engine that guides adjusters through structured property inspections.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Database Schema](#2-database-schema)
3. [Data Model — InspectionStep](#3-data-model--inspectionstep)
4. [Workflow State Machine](#4-workflow-state-machine)
5. [Tool Gating (Phase-Restricted Tools)](#5-tool-gating-phase-restricted-tools)
6. [Gate Validators](#6-gate-validators)
7. [Phase Validation (Soft Checks)](#7-phase-validation-soft-checks)
8. [Default Flows (Seed Data)](#8-default-flows-seed-data)
9. [API Endpoints](#9-api-endpoints)
10. [Settings UI — Workflow Builder](#10-settings-ui--workflow-builder)
11. [How Flows Connect to Inspections](#11-how-flows-connect-to-inspections)
12. [Implementation Checklist](#12-implementation-checklist)

---

## 1. System Overview

The Inspection Workflows system replaces a hardcoded 8-phase inspection process with a flexible, database-driven architecture. Each "flow" is a sequence of steps tailored to a specific peril type (Hail, Wind, Water, Fire, General). The system has three layers:

```
┌──────────────────────────────────────────────────┐
│  LAYER 1: Flow Definitions (Database)            │
│  - Stored in inspection_flows table              │
│  - Each flow has ordered steps with AI prompts   │
│  - System defaults + user custom flows           │
├──────────────────────────────────────────────────┤
│  LAYER 2: Workflow Orchestrator (Runtime)         │
│  - State machine tracking current phase/step     │
│  - Tool gating: restricts which API actions are  │
│    allowed per phase                             │
│  - State stored in inspection_sessions.          │
│    workflowStateJson                             │
├──────────────────────────────────────────────────┤
│  LAYER 3: Gate Validators (Quality Control)      │
│  - 4 gates: Sketch, PhotoDamage, Scope, Export   │
│  - BLOCKER issues prevent phase advancement      │
│  - WARNING issues allow override                 │
└──────────────────────────────────────────────────┘
```

---

## 2. Database Schema

### `inspection_flows` Table

```sql
CREATE TABLE inspection_flows (
  id            SERIAL PRIMARY KEY,
  user_id       VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  name          VARCHAR NOT NULL,
  peril_type    VARCHAR NOT NULL,
  description   TEXT,
  is_default    BOOLEAN DEFAULT false,
  is_system_default BOOLEAN DEFAULT false,
  steps         JSONB NOT NULL,      -- Array of InspectionStep objects
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);
```

**Key fields:**
- `user_id`: NULL for system defaults, set to user ID for custom flows
- `peril_type`: One of "Hail", "Wind", "Water", "Fire", "General"
- `is_system_default`: true for built-in flows (read-only, cannot be deleted)
- `is_default`: true if this is the default flow for its peril type
- `steps`: JSONB array of `InspectionStep` objects (see below)

### Drizzle ORM Definition

```typescript
import { pgTable, serial, varchar, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export type InspectionStep = {
  id: string;
  phaseName: string;
  agentPrompt: string;
  requiredTools: string[];
  completionCriteria: string;
};

export const inspectionFlows = pgTable("inspection_flows", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  name: varchar("name").notNull(),
  perilType: varchar("peril_type").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").default(false),
  isSystemDefault: boolean("is_system_default").default(false),
  steps: jsonb("steps").$type<InspectionStep[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

### Workflow State (stored on `inspection_sessions`)

The runtime state is stored as JSONB on the `inspection_sessions` table:

```sql
ALTER TABLE inspection_sessions
  ADD COLUMN workflow_state_json JSONB;
```

---

## 3. Data Model — InspectionStep

Each step in a flow defines one phase of the inspection:

```typescript
interface InspectionStep {
  id: string;              // Unique ID, e.g. "hail_03" or "water_04"
  phaseName: string;       // Human-readable name: "Collateral Damage Check"
  agentPrompt: string;     // Instructions for the AI voice agent (what to do, what to look for)
  requiredTools: string[]; // List of tool names allowed/expected during this step
  completionCriteria: string; // What defines "done" for this step
}
```

**Example step:**
```json
{
  "id": "hail_05",
  "phaseName": "Test Squares — All Slopes",
  "agentPrompt": "Mark a 10x10 foot test square on each roof slope. Count hail hits within each square. Record the pitch for each facet. If 8+ hits per 10x10, recommend full slope replacement.",
  "requiredTools": ["log_test_square", "add_sketch_annotation", "trigger_photo_capture", "apply_peril_template"],
  "completionCriteria": "Test square completed on all roof slopes with hit counts recorded."
}
```

---

## 4. Workflow State Machine

### WorkflowState Type

```typescript
type WorkflowPhase =
  | "briefing"
  | "inspection_setup"
  | "interior_rooms"
  | "openings"
  | "elevations"
  | "roof"
  | "photos_damage"
  | "scope_build"
  | "review"
  | "export";

interface WorkflowState {
  claimId: string;
  sessionId: string;
  peril: string;          // "Hail", "Wind", "Water", "Fire", "General"
  phase: WorkflowPhase;   // Current phase
  stepId: string;         // Current step within the phase
  context: {
    structureId?: string;
    roomId?: string;
    elevationId?: string;
    currentView?: "interior" | "elevation" | "roof";
  };
  lastToolError?: {
    tool: string;
    code: string;
    message: string;
    details?: unknown;
    at: string;           // ISO timestamp
  };
  lastValidatorSummary?: {
    sketch?: GateResultSummary;
    photoDamage?: GateResultSummary;
    scope?: GateResultSummary;
    export?: GateResultSummary;
    at: string;
  };
}
```

### Phase Order (fixed progression)

```
briefing → inspection_setup → interior_rooms → openings → elevations → roof → photos_damage → scope_build → review → export
```

Phases always advance in this order. The `advance()` function moves to the next phase:

```typescript
const PHASE_ORDER = [
  "briefing", "inspection_setup", "interior_rooms", "openings",
  "elevations", "roof", "photos_damage", "scope_build", "review", "export"
];

function advance(state: WorkflowState): WorkflowState {
  if (!canAdvance(state)) return state;
  const idx = PHASE_ORDER.indexOf(state.phase);
  const nextPhase = PHASE_ORDER[Math.min(idx + 1, PHASE_ORDER.length - 1)];
  return {
    ...state,
    phase: nextPhase,
    stepId: WORKFLOW_STEPS[nextPhase]?.[0] ?? `${nextPhase}.default`
  };
}

function canAdvance(state: WorkflowState): boolean {
  if (state.phase === "export") return false;
  // Block advancement into review/export if sketch gate has blockers
  if (state.lastValidatorSummary?.sketch &&
      !state.lastValidatorSummary.sketch.ok &&
      ["review", "export"].includes(state.phase)) {
    return false;
  }
  return true;
}
```

### Steps Within Each Phase

```typescript
const WORKFLOW_STEPS: Record<WorkflowPhase, string[]> = {
  briefing:         ["briefing.review"],
  inspection_setup: ["session.bootstrap", "structure.select"],
  interior_rooms:   ["interior.capture_rooms"],
  openings:         ["openings.capture"],
  elevations:       ["elevations.capture"],
  roof:             ["roof.capture"],
  photos_damage:    ["photos.map_damage"],
  scope_build:      ["scope.assemble"],
  review:           ["review.resolve_warnings"],
  export:           ["export.validate", "export.generate"],
};
```

### Orchestrator Functions

| Function | Purpose |
|----------|---------|
| `defaultWorkflowState(params)` | Creates initial state (starts at `inspection_setup`) |
| `getWorkflowState(sessionId)` | Reads state from `inspection_sessions.workflowStateJson` |
| `setWorkflowState(sessionId, patch)` | Merges patch into existing state and saves |
| `initSessionWorkflow({claimId, sessionId, peril})` | Initializes workflow when inspection starts |
| `getAllowedTools(state)` | Returns tool names allowed in current phase |
| `validateToolForWorkflow(sessionId, toolName, args)` | Returns null if OK, or a ToolResult failure if blocked |
| `advance(state)` | Returns new state with next phase |
| `canAdvance(state)` | Checks if advancement is allowed |
| `runGates(state)` | Runs all 4 gate validators and saves summary to state |

---

## 5. Tool Gating (Phase-Restricted Tools)

Each phase defines which API tools/actions are allowed. Requests outside the allowed set are rejected.

### Global Tools (available in ALL phases)

```
get_workflow_state, set_phase, set_context, trigger_photo_capture, analyze_photo, get_inspection_state
```

### Phase-Specific Tools

| Phase | Additional Allowed Tools |
|-------|------------------------|
| `briefing` | *(global only)* |
| `inspection_setup` | `create_structure` |
| `interior_rooms` | `create_room`, `create_sub_area`, `update_room` |
| `openings` | `add_opening`, `update_opening`, `delete_opening` |
| `elevations` | `create_room`, `add_opening`, `add_sketch_annotation` |
| `roof` | `create_room`, `add_damage`, `add_sketch_annotation`, `log_test_square` |
| `photos_damage` | `add_damage`, `confirm_damage` |
| `scope_build` | `add_line_item`, `update_line_item`, `validate_scope` |
| `review` | `validate_scope`, `run_workflow_gates` |
| `export` | `run_workflow_gates`, `export_esx` |

### Server-Side Enforcement

A middleware maps incoming API routes to tool names and validates them:

```typescript
// Example route-to-tool mapping
const ROUTE_TOOL_MAP = {
  "POST /api/inspection/:sessionId/rooms": "create_room",
  "POST /api/inspection/:sessionId/damages": "add_damage",
  "POST /api/inspection/:sessionId/line-items": "add_line_item",
  // ... etc
};

// Middleware checks: is this tool allowed in the current phase?
const rejection = await validateToolForWorkflow(sessionId, toolName, args);
if (rejection) return res.status(403).json(rejection);
```

When a tool is blocked, the response includes:
```json
{
  "success": false,
  "error": {
    "type": "CONTEXT_ERROR",
    "code": "TOOL_NOT_ALLOWED",
    "message": "Tool \"add_line_item\" is not allowed in phase \"interior_rooms\".",
    "hint": "Allowed tools: create_room, create_sub_area, update_room. Call set_phase to advance."
  }
}
```

---

## 6. Gate Validators

Four gates run automated quality checks before allowing phase transitions. Each gate returns a `GateResult`:

```typescript
type GateSeverity = "BLOCKER" | "WARNING" | "INFO";

interface GateIssue {
  severity: GateSeverity;
  code: string;               // e.g. "SKETCH_TOO_FEW_VERTICES"
  message: string;
  entity?: {
    type: "room" | "opening" | "lineItem" | "photo" | "elevation";
    id?: string;
    name?: string;
  };
  details?: unknown;
  suggestion?: string;
}

interface GateResult {
  gate: "sketch" | "photoDamage" | "scope" | "export";
  ok: boolean;                // false if any BLOCKER issues
  issues: GateIssue[];
  summary: { blockers: number; warnings: number; infos: number };
  computedAt: string;         // ISO timestamp
  suggestedMissingScopeItems?: string[]; // scope gate only
}
```

### Gate 1: Sketch Gate

Validates room/polygon geometry and opening dimensions.

| Code | Severity | Condition |
|------|----------|-----------|
| `SKETCH_TOO_FEW_VERTICES` | BLOCKER | Room polygon has < 3 vertices |
| `SKETCH_NAN_COORD` | BLOCKER | Room has NaN coordinates |
| `OPENING_WALL_INDEX_RANGE` | BLOCKER | Opening wallIndex out of range for room polygon |
| `OPENING_INVALID_DIMS` | BLOCKER | Opening width or height ≤ 0 |
| `OPENING_WIDER_THAN_WALL` | WARNING | Opening wider than its wall segment |
| `ELEVATION_MISSING_HEIGHT` | WARNING | Elevation room missing wall height |

### Gate 2: Photo-Damage Gate

Checks photo documentation quality.

| Code | Severity | Condition |
|------|----------|-----------|
| `PHOTO_ANALYSIS_MISSING` | WARNING | All photos lack AI analysis results |
| `PHOTO_ROOM_UNASSOCIATED` | WARNING | Photo not linked to any room |
| `PHOTO_CONFIDENCE_GATE` | WARNING | High-confidence photo not confirmed |
| `PHOTO_DAMAGE_MAPPING_LOW` | WARNING | AI detected damage in photos but no damage observations recorded |

### Gate 3: Scope Gate

Ensures damage observations have matching line items.

| Code | Severity | Condition |
|------|----------|-----------|
| `SCOPE_DAMAGE_UNCOVERED` | WARNING | Confirmed damage has no matching line item or scope item |
| `SCOPE_DUPLICATE_LINE` | WARNING | Duplicate line item (same category/room/damage) |
| `SCOPE_PROVENANCE_MISSING` | INFO | Line item missing provenance field |
| `SCOPE_HAIL_ROOF_EXPECTED` | WARNING | Hail peril but no roof facets captured |

### Gate 4: Export Gate

Aggregates other gates to determine export readiness.

| Code | Severity | Condition |
|------|----------|-----------|
| `EXPORT_SESSION_MISSING` | BLOCKER | Inspection session not found |
| `EXPORT_REQUIRED_CLAIM_DATA` | BLOCKER | Claim number or property address missing |
| `EXPORT_SKETCH_BLOCKER` | BLOCKER | Sketch gate has blockers |
| `EXPORT_SCOPE_COVERAGE_WARN` | WARNING | Some damages lack scope lines |
| `EXPORT_PHOTO_*` | WARNING | Inherited from photo-damage gate |

### Running Gates

All 4 gates run in parallel:

```typescript
async function runAllWorkflowGates(sessionId: number, peril: string) {
  const [sketch, photoDamage, scope, exportGate] = await Promise.all([
    runSketchGate(sessionId),
    runPhotoDamageGate(sessionId),
    runScopeGate(sessionId, peril),
    runExportGate(sessionId),
  ]);
  return { sketch, photoDamage, scope, export: exportGate };
}
```

---

## 7. Phase Validation (Soft Checks)

Separate from the gate validators, phase validation runs at phase transitions and returns **warnings (not hard blocks)** so adjusters can override:

```typescript
interface PhaseValidationResult {
  canProceed: boolean;      // Always true — warnings only
  warnings: string[];
  missingItems: string[];
  completionScore: number;  // 0-100
}
```

### Phase-Specific Checks

| Phase | What It Checks |
|-------|---------------|
| Phase 1 (Briefing) | Property verification photo exists |
| Phase 2 (Setup) | *(always passes)* |
| Phase 3 (Exterior) | Exterior rooms exist, roof slopes documented, photos per room, scope gaps |
| Phase 4 (Interior) | Interior rooms exist, damages have scope items, drywall without paint warning |
| Phase 5 (Moisture) | Water peril: moisture readings exist, elevated readings have mitigation items |
| Phase 6 (Photos) | Minimum 5 photos, overview photos exist, damage photos linked to observations |
| Phase 7 (Estimate) | Line items exist, all items have non-zero pricing, damage rooms have line items |

---

## 8. Default Flows (Seed Data)

Five system-default flows ship with the platform. They are seeded via `POST /api/flows/seed` (admin only) or a seed script.

### Hail Flow — "Standard Hail Inspection" (11 steps)

Based on InterNACHI and CPR Group guidelines:

| # | Phase Name | Key Activities | Tools |
|---|-----------|---------------|-------|
| 1 | Pre-Inspection Review | Review briefing, confirm DOL, coverage, hail size | `get_inspection_state` |
| 2 | Session Setup & Structure ID | Create structures (dwelling, garage, shed, fence) | `create_structure`, `set_inspection_context` |
| 3 | Collateral Damage Check | Ground-level soft metals: mailbox, A/C fins, downspouts, screens, paint spatter | `trigger_photo_capture`, `add_damage`, `add_sketch_annotation` |
| 4 | Roof Overview & Access | 360° overview photos, create roof facets per slope | `create_room`, `trigger_photo_capture` |
| 5 | Test Squares — All Slopes | 10×10 ft test squares, count hits, record pitch, 8+ hits = full replacement | `log_test_square`, `add_sketch_annotation`, `trigger_photo_capture`, `apply_peril_template` |
| 6 | Roof Accessories & Penetrations | Vents, pipe boots, skylights, chimney, satellite | `add_damage`, `add_line_item`, `trigger_photo_capture` |
| 7 | Gutters, Fascia & Soffits | Gutter dents (size = hail diameter), fascia, soffit | `create_room`, `add_damage`, `add_line_item`, `trigger_photo_capture` |
| 8 | Elevations & Siding | All 4 elevations, siding impact, openings, screens | `create_room`, `add_opening`, `add_damage`, `add_line_item`, `trigger_photo_capture`, `apply_peril_template` |
| 9 | Interior Inspection | Only if roof breaches → water intrusion | `create_room`, `create_sub_area`, `add_opening`, `add_damage`, `add_line_item`, `trigger_photo_capture` |
| 10 | Estimate Assembly | Smart macros, companion items, O&P check | `get_estimate_summary`, `apply_smart_macro`, `check_related_items`, `add_line_item` |
| 11 | Evidence Review & Finalize | Completeness check, final notes | `get_progress`, `complete_inspection` |

### Wind Flow — "Standard Wind Inspection" (8 steps)

| # | Phase Name | Key Activities |
|---|-----------|---------------|
| 1 | Pre-Inspection Review | Wind speed, storm direction, cosmetic exclusions |
| 2 | Session Setup & Structure ID | Create structures, record storm wind direction |
| 3 | Roof — Directional Damage | Missing/lifted/creased shingles, blown ridge caps, wind crease counts per facet |
| 4 | Structural & Framing Check | Shifted ridge, displaced trusses, racked walls, uplift at eaves |
| 5 | Elevations — Windward vs. Leeward | Compare windward (most damage) vs. leeward elevation |
| 6 | Fencing, Trees & Other Structures | Blown-down fences, fallen trees, outbuilding damage |
| 7 | Interior (if applicable) | Secondary water damage from wind breaches |
| 8 | Estimate Assembly & Finalize | Smart macros, related items, O&P, completeness check |

### Water Flow — "Water Mitigation & Damage Inspection" (8 steps)

Based on IICRC S500 standards:

| # | Phase Name | Key Activities |
|---|-----------|---------------|
| 1 | Pre-Inspection Review | Water source, exclusions, mitigation status |
| 2 | Source Identification | Pipe burst, roof leak, appliance, sewage, flooding — photo the source |
| 3 | Water Category & Class | Cat 1 (clean), Cat 2 (gray), Cat 3 (black/sewage/standing 72h+). Class 1-4 by wetting extent |
| 4 | Affected Area & Moisture Mapping | Create rooms with dimensions, moisture readings (drywall dry=12%, wood dry=15%), control room baseline |
| 5 | Damage Documentation | Staining, swelling, warping, delamination, mold. Baseboards, cabinets, flooring type |
| 6 | Mitigation & Equipment | Air movers, dehumidifiers, air scrubbers — quantity, placement, run time |
| 7 | Content & Personal Property | Damaged contents: furniture, electronics, clothing |
| 8 | Estimate Assembly & Finalize | Demolition/tearout items, category-appropriate items, coverage limits |

### Fire Flow — "Fire & Smoke Damage Inspection" (6 steps)

| # | Phase Name | Key Activities |
|---|-----------|---------------|
| 1 | Pre-Inspection & Safety | Fire department report, structure safety clearance, utilities |
| 2 | Exterior Damage | Charring, melting, discoloration, fire path of travel |
| 3 | Interior — Fire Origin Area | Char depth, structural damage, complete loss zones |
| 4 | Interior — Smoke & Heat | Room-by-room: smoke type (wet/dry/fuel oil), soot, heat damage |
| 5 | Water Damage from Suppression | Moisture readings where hoses/sprinklers used |
| 6 | Estimate Assembly & Finalize | Multi-trade O&P (almost always applicable for fire) |

### General Flow — "General Property Inspection" (7 steps)

Universal fallback for non-specific perils:

| # | Phase Name | Key Activities |
|---|-----------|---------------|
| 1 | Pre-Inspection Review | Briefing, coverage, endorsements, red flags |
| 2 | Session Setup | Create structures, confirm price list region |
| 3 | Exterior Inspection | Roof facets, elevations, exterior areas |
| 4 | Interior Inspection | Room by room: dimensions, sub-areas, openings, damage, line items |
| 5 | Evidence Review | Photo completeness, overview shots |
| 6 | Estimate Assembly | Related items, coverage buckets, O&P, deductible check |
| 7 | Finalize | Summary, final adjuster notes |

### Step ID Convention

Step IDs follow the pattern `{peril}_{two-digit-number}`:
```
hail_01, hail_02, ..., hail_11
wind_01, wind_02, ..., wind_08
water_01, ..., water_08
fire_01, ..., fire_06
gen_01, ..., gen_07
```

Generated with: `function makeId(prefix, index) { return \`${prefix}_${String(index).padStart(2, "0")}\` }`

---

## 9. API Endpoints

All endpoints require Bearer JWT authentication unless noted.

### Flow Management (`/api/flows`)

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| `GET` | `/api/flows` | List flows (system defaults + user's custom). Optional `?perilType=Hail` filter | User |
| `GET` | `/api/flows/:id` | Get a single flow | User (own or system) |
| `POST` | `/api/flows` | Create a new custom flow | User |
| `PUT` | `/api/flows/:id` | Update a flow (cannot edit system defaults unless cloned first) | User (own only) |
| `DELETE` | `/api/flows/:id` | Delete a custom flow (cannot delete system defaults) | User (own only) |
| `POST` | `/api/flows/:id/clone` | Clone a flow into a user-owned editable copy | User |
| `POST` | `/api/flows/seed` | Seed/update system default flows | Admin only |

#### Create/Update Flow Request Body

```json
{
  "name": "My Custom Hail Flow",
  "perilType": "Hail",
  "description": "Modified hail flow with extra interior focus",
  "isDefault": true,
  "steps": [
    {
      "id": "custom_01",
      "phaseName": "Pre-Inspection Review",
      "agentPrompt": "Review the briefing...",
      "requiredTools": ["get_inspection_state"],
      "completionCriteria": "Adjuster confirms briefing reviewed."
    }
  ]
}
```

Validated with Zod:
```typescript
const flowBodySchema = z.object({
  name: z.string().min(1),
  perilType: z.string().min(1),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  steps: z.array(z.object({
    id: z.string(),
    phaseName: z.string(),
    agentPrompt: z.string(),
    requiredTools: z.array(z.string()),
    completionCriteria: z.string(),
  })),
});
```

#### Access Control Rules

- **System default flows**: Visible to all users, read-only. Must clone before editing.
- **User custom flows**: Only visible/editable by the owning user.
- **Clone**: Creates a copy owned by the requesting user with `isSystemDefault = false`.

### Workflow State Endpoints (on Inspection Session)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/inspection/:sessionId/workflow` | Get current workflow state and allowed tools |
| `POST` | `/api/inspection/:sessionId/workflow/set-phase` | Manually set phase (body: `{ phase, stepId? }`) |
| `POST` | `/api/inspection/:sessionId/workflow/set-context` | Update context (body: `{ roomId?, structureId?, currentView? }`) |
| `GET` | `/api/inspection/:sessionId/gates` | Get stored gate results |
| `POST` | `/api/inspection/:sessionId/gates/run` | Run all 4 gates and return results |
| `GET` | `/api/inspection/:sessionId/validate-phase?phase=3` | Validate a specific phase transition |

---

## 10. Settings UI — Workflow Builder

The Workflow Builder is the UI for managing inspection flows, accessible from Settings → "Manage Inspection Flows".

### Page Structure

```
/settings/workflows → WorkflowBuilder.tsx
```

### UI Components

#### List View (Flow Cards)

- Displays all flows grouped by peril type
- Each card shows: flow name, peril type badge (color-coded), step count, system/user icon
- Filter dropdown by peril type: Hail, Wind, Water, Fire, General
- Actions per card:
  - **Edit** (pencil icon) — opens step editor
  - **Clone** (copy icon) — duplicates flow as user-owned
  - **Delete** (trash icon) — only for user-created flows
- System defaults show a lock icon and cannot be edited directly

#### Peril Type Color Scheme

```typescript
const PERIL_COLORS = {
  Hail: "bg-blue-100 text-blue-800 border-blue-200",
  Wind: "bg-amber-100 text-amber-800 border-amber-200",
  Water: "bg-cyan-100 text-cyan-800 border-cyan-200",
  Fire: "bg-red-100 text-red-800 border-red-200",
  General: "bg-gray-100 text-gray-800 border-gray-200",
};
```

#### New Flow Dialog

- Fields: Name (text), Peril Type (select from 5 options)
- Creates flow with empty steps array, then opens editor

#### Flow Editor

- **Metadata Section**: Name, peril type, description, "Set as default" toggle
- **Steps List**: Ordered list with drag handles and up/down arrows for reordering
- Each step is expandable/collapsible

#### Step Editor (per step)

| Field | Type | Description |
|-------|------|-------------|
| Phase Name | Text input | Human-readable step name |
| Agent Prompt | Textarea | Instructions for the AI voice agent |
| Required Tools | Tag selector | Multi-select from available tools list |
| Completion Criteria | Text input | What defines step completion |

#### Available Tools List (for tag selector)

```typescript
const AVAILABLE_TOOLS = [
  "set_inspection_context",
  "create_structure",
  "get_inspection_state",
  "get_room_details",
  "create_room",
  "create_sub_area",
  "add_opening",
  "add_sketch_annotation",
  "complete_room",
  "add_damage",
  "add_line_item",
  "trigger_photo_capture",
  "log_moisture_reading",
  "get_progress",
  "get_estimate_summary",
  "skip_step",
  "apply_smart_macro",
  "check_related_items",
  "log_test_square",
  "complete_inspection",
  "apply_peril_template",
];
```

#### API Mutations (React Query)

```typescript
// Fetch flows
const { data: flows } = useQuery({ queryKey: ["/api/flows"], queryFn: ... });

// Create flow
const createMutation = useMutation({
  mutationFn: (body) => apiRequest("POST", "/api/flows", body),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/flows"] }),
});

// Update flow
const updateMutation = useMutation({
  mutationFn: ({ id, body }) => apiRequest("PUT", `/api/flows/${id}`, body),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/flows"] }),
});

// Clone flow
const cloneMutation = useMutation({
  mutationFn: ({ id, name }) => apiRequest("POST", `/api/flows/${id}/clone`, { name }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/flows"] }),
});

// Delete flow
const deleteMutation = useMutation({
  mutationFn: (id) => apiRequest("DELETE", `/api/flows/${id}`),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/flows"] }),
});
```

### Settings Page Entry Point

The main Settings page has an "Inspection Workflows" card:
```
Card title: "Inspection Workflows"
Description: "Customize inspection steps for different peril types"
Supported perils shown as badges: Hail, Wind, Water, Fire, General
Button: "Manage Inspection Flows" → navigates to /settings/workflows
```

---

## 11. How Flows Connect to Inspections

### Starting an Inspection

When `POST /api/claims/:id/inspection/start` is called:

1. System finds the default flow for the claim's `perilType`
2. Creates an `inspection_session` record
3. Initializes `workflowStateJson` with `defaultWorkflowState()`:
   ```json
   {
     "claimId": "42",
     "sessionId": "7",
     "peril": "Hail",
     "phase": "inspection_setup",
     "stepId": "session.bootstrap",
     "context": { "currentView": "interior" }
   }
   ```

### During Inspection

1. **AI voice agent** reads the current flow's steps and uses the `agentPrompt` for guidance
2. **Tool gating middleware** checks each API request against `PHASE_ALLOWED_TOOLS`
3. **Context tracking** maintains which room/elevation/structure is active
4. **Phase advancement** happens when the AI or user calls `set_phase`

### Completing Inspection

1. Gates are run via `POST /api/inspection/:sessionId/gates/run`
2. BLOCKERs must be resolved before export
3. WARNINGs are shown but can be overridden
4. Export generates ESX/PDF files

---

## 12. Implementation Checklist

### Database
- [ ] Create `inspection_flows` table
- [ ] Add `workflow_state_json` JSONB column to `inspection_sessions`
- [ ] Create storage interface methods: `getInspectionFlows`, `getInspectionFlow`, `createInspectionFlow`, `updateInspectionFlow`, `deleteInspectionFlow`

### Backend
- [ ] Implement `shared/contracts/workflow.ts` — phase definitions, step mappings, tool allowlists
- [ ] Implement `server/workflow/types.ts` — TypeScript types for WorkflowState, GateResult, GateIssue
- [ ] Implement `server/workflow/orchestrator.ts` — state machine functions
- [ ] Implement gate validators: sketch, photoDamage, scope, export
- [ ] Implement `server/phaseValidation.ts` — soft phase transition checks
- [ ] Implement `server/seed-flows.ts` — default flow definitions
- [ ] Implement `server/routes/flows.ts` — CRUD + clone + seed API
- [ ] Add workflow state endpoints to inspection routes
- [ ] Add tool gating middleware to inspection routes

### Frontend
- [ ] Build `WorkflowBuilder.tsx` — list view, editor, step management
- [ ] Add "Inspection Workflows" card to Settings page
- [ ] Add route `/settings/workflows` → WorkflowBuilder
- [ ] Wire up API mutations for CRUD + clone

### Seed Data
- [ ] Seed 5 default flows (Hail, Wind, Water, Fire, General)
- [ ] Each flow marked `isSystemDefault: true`, `isDefault: true`
