# Voice Inspection & Sketch System — Developer Guide

> Handoff documentation for the Claims IQ voice-driven inspection, sketch rendering, and estimate assembly system.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Voice Agent (OpenAI Realtime API via WebRTC)                       │
│  Model: gpt-4o-realtime-preview                                     │
│  53 tools defined in server/realtime.ts                             │
└──────────────┬──────────────────────────────────────────────────────┘
               │ Tool calls (JSON)
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Client: ActiveInspection.tsx                                       │
│  executeToolCall() — switch on 53 tool names                        │
│  Normalizes dimensions, resolves rooms, calls API                   │
└──────────────┬──────────────────────────────────────────────────────┘
               │ fetch() / resilientMutation()
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Server: routes/inspection.ts                                       │
│  REST endpoints for rooms, openings, damages, line items, photos    │
│  Workflow middleware (warn-only, never blocks)                       │
└──────────────┬──────────────────────────────────────────────────────┘
               │ Drizzle ORM
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PostgreSQL (Supabase)                                              │
│  Schema: shared/schema.ts (Drizzle pgTable definitions)             │
│  Storage: server/storage.ts (IStorage interface)                    │
└─────────────────────────────────────────────────────────────────────┘
```

After any voice tool mutates data, the client calls `refreshRooms()` which invalidates React Query caches. Sketch components re-render automatically.

---

## Key Files

### Voice Agent

| File | Lines | Purpose |
|------|-------|---------|
| `server/realtime.ts` | ~1480 | System instructions builder (`buildSystemInstructions`), all 53 tool schemas (`realtimeTools` array) |
| `server/routes/realtime.ts` | ~210 | `POST /session` — creates OpenAI Realtime session, injects workflow state + transcript summary |
| `client/src/pages/ActiveInspection.tsx` | ~3500 | WebRTC connection (line ~2516), `executeToolCall()` switch (line ~658), all 53 tool handlers |
| `client/src/lib/openingToolNormalization.ts` | ~98 | `normalizeOpeningDimensions()` (inches→feet auto-convert), `normalizeWallDirection()` (N/S/E/W) |
| `client/src/lib/realtimeTooling.ts` | ~50 | `buildToolError()`, `sendFunctionCallOutput()` helpers |

### Sketch Rendering

| File | Lines | Purpose |
|------|-------|---------|
| `client/src/components/PropertySketch.tsx` | ~1468 | **Read-only sketch** — interior BFS layout, roof plan, elevations, exterior sections |
| `client/src/components/SketchEditor.tsx` | ~2031 | **Interactive editor** — tool modes (select/add room/add door/pan), drag-resize, undo/redo |
| `client/src/components/SketchRenderer.tsx` | ~492 | Pure SVG rendering component used by SketchEditor |
| `client/src/components/FloorPlanSketch.tsx` | ~623 | Alternative floor plan renderer with polygon support |
| `client/src/lib/sketchLayout.ts` | ~209 | BFS layout algorithm, `hitTestWall()` for opening placement |
| `client/src/lib/polygonBuilder.ts` | ~190 | `rectanglePolygon()`, `lShapePolygon()`, `tShapePolygon()`, `customPolygon()` |

### Data & API

| File | Lines | Purpose |
|------|-------|---------|
| `shared/schema.ts` | ~600 | Drizzle ORM schema — all tables (`inspectionRooms`, `roomOpenings`, `damageObservations`, etc.) |
| `server/storage.ts` | ~1600 | `IStorage` interface + implementation — all CRUD operations |
| `server/routes/inspection.ts` | ~3500 | All REST endpoints for inspection data |
| `server/estimateEngine.ts` | ~1200 | DIM_VARS calculation, ESX estimate generation |
| `server/openingDeductionService.ts` | ~130 | Calculates opening deduction SF for wall area |

---

## 5-Level Hierarchy

The data model mirrors Xactimate's structure:

```
L1: Structure (Main Dwelling, Detached Garage, Shed)
 └─ L2: Room / Area (Kitchen, Front Elevation, North Slope)
     ├─ L3: Sub-Area (Walk-in Closet, Pantry, Dormer)
     ├─ L4: Opening (Door on north wall, Window on east wall)
     └─ L5: Annotation (Hail count: 12, Pitch: 7/12)
```

Each room has a `viewType`:
- `"interior"` — bedrooms, bathrooms, kitchen, living room
- `"elevation"` — front/left/right/rear exterior walls
- `"roof_plan"` — roof slopes/facets
- `"exterior_other"` — gutters, porches, decks

---

## Voice Tool Execution Flow

When the voice agent calls a tool:

```
1. OpenAI sends tool call via WebRTC data channel
2. ActiveInspection.tsx receives event, parses args
3. executeToolCall() runs the matching case
4. Handler normalizes inputs (dimensions, wall direction, room name)
5. Handler calls REST API (fetch or resilientMutation)
6. Handler refreshes UI state (refreshRooms, refreshLineItems)
7. Handler returns result object to agent
8. sendFunctionCallOutput() sends result back via data channel
9. Agent speaks confirmation to user
```

### Room Name Resolution

Every tool that takes `roomName` uses this cascade:
1. Exact name match
2. Case-insensitive match
3. Substring/partial match
4. Fall back to `currentRoomId` (the room the agent is "in")

### Dimension Normalization (`openingToolNormalization.ts`)

The LLM often passes inches as raw numbers (e.g., `widthFt: 36` meaning 36 inches). The normalization layer:

1. **String parsing**: `"36 inches"` → 3.0, `"6'8\""` → 6.67, `"3 feet"` → 3.0
2. **Auto-conversion**: If a numeric value >= 18 (width) or >= 48 (height) and the opening is NOT an overhead/garage door, divide by 12
3. **Defaults**: Only applied when no dimension provided at all

### Wall Direction Normalization

Accepts: `"north"`, `"south"`, `"east"`, `"west"`, `"front"`, `"rear"`, `"back"`, `"left"`, `"right"`, `"n"`, `"s"`, `"e"`, `"w"`

All normalize to one of: `"north"` | `"south"` | `"east"` | `"west"` | `"front"` | `"rear"` | `"left"` | `"right"`

The sketch renderers then map: front→south, rear→north, left→west, right→east.

---

## Phase Systems

There are **two coexisting phase systems** (important to understand both):

### Legacy Numeric Phases (1-8)

Used by `set_inspection_context`. Stored as `session.currentPhase` (integer).

| Phase | Name | Purpose |
|-------|------|---------|
| 1 | Pre-Inspection | Review briefing, verify property |
| 2 | Setup | Confirm peril, structures |
| 3 | Exterior | Roof, elevations, gutters |
| 4 | Interior | Rooms with dimensions, openings, damage |
| 5 | Moisture | Moisture readings (water peril) |
| 6 | Evidence | Photo completeness |
| 7 | Estimate | Line item review |
| 8 | Finalize | Summary, completeness |

### Workflow String Phases

Used by `set_phase`. Stored as `session.workflowStateJson.phase` (string).

Defined in `shared/contracts/workflow.ts`:
`briefing` → `inspection_setup` → `interior_rooms` → `openings` → `elevations` → `roof` → `photos_damage` → `scope_build` → `review` → `export`

### Critical: No Hard Blocking

The workflow middleware in `server/routes/inspection.ts` (line 215) is **warn-only**. It logs when a tool is used outside its recommended phase but never returns 403. All tools work in any phase.

The agent instructions say: *"Follow the inspection flow phases as a GUIDE, not a hard rule. If the adjuster asks to work on a specific area, create it immediately."*

---

## Sketch Rendering Pipeline

### Read-Only Sketch (PropertySketch.tsx)

Fetches data via React Query (auto-refreshes every 10s):
- `/api/inspection/${sessionId}/hierarchy` — structures with rooms
- `/api/sessions/${sessionId}/adjacencies` — room connections
- `/api/inspection/${sessionId}/openings` — all openings

Renders four sections:
1. **Interior**: BFS-positioned rooms with openings, dimension lines, damage badges
2. **Roof Plan**: Geometric facet polygons with ridge/hip lines, pitch labels
3. **Elevations**: Wall rectangles with door/window symbols
4. **Other Exterior**: Card layout for gutters, porches, etc.

### Interactive Editor (SketchEditor.tsx)

Tool modes: `select` | `add_room` | `add_door` | `add_window` | `add_damage` | `pan`

View modes: `interior` (floor plan) | `elevations` (exterior walls)

Features:
- Click wall → ghost preview → create room with adjacency
- Click wall in door/window mode → create opening at position
- Drag corner handles → resize room → persist dimensions
- Double-click room → inspector popover (edit name/dimensions)
- Undo/redo stack for all mutations
- Elevation tabs (Front/Left/Right/Rear) with create button

### BFS Layout (sketchLayout.ts)

```
1. Build adjacency map from room_adjacencies table
2. Place first room at (0,0)
3. BFS: for each placed room, place neighbors based on wallDirection
   - east wall → neighbor goes to the right
   - south wall → neighbor goes below
   - etc.
4. Collision detection prevents overlaps
5. Unplaced rooms fall back to grid layout below
6. Normalize all coordinates (subtract minX/minY)
```

---

## App Navigation

### Route Structure (App.tsx)

```
/                              → ClaimsList
/briefing/:id                  → InspectionBriefing
/inspection/:id                → ActiveInspection (voice mode)
/inspection/:id/scope          → ScopePage
/inspection/:id/review         → ReviewFinalize
/inspection/:id/export         → ExportPage
/inspection/:id/supplemental   → SupplementalPage
/documents                     → DocumentsHub
/settings                      → SettingsPage
```

### Bottom Navigation (BottomNav.tsx)

Always visible (including during inspection). Five items:
- **Home** → `/`
- **Scope** → `/inspection/:id/scope`
- **Inspect** → `/inspection/:id` (prominent mic button)
- **Review** → `/inspection/:id/review`
- **Settings** → `/settings`

### Mobile Layout (ActiveInspection.tsx)

- Left sidebar (structure/phase list) → Sheet overlay
- Right panel (estimate/scope items) → Sheet overlay
- Main area: compact transcript bar → sketch (expanded by default) → progress strip
- Quick stats strip below header (estimate pill, scope pill)

---

## Progress Tracking

### Completeness API (`GET /api/inspection/:sessionId/completeness`)

Returns weighted score:
- **Core items (weight 1.5)**: rooms, interior rooms, damages, line items
- **Exterior items (weight 0.8)**: overview photos, elevations, roof slopes
- **Water items (weight 1.0)**: moisture readings, water entry point

Contents-first: interior/core items are listed and weighted before exterior items.

### Damage Counts

The `/api/inspection/:sessionId/rooms` endpoint computes damage counts from actual `damage_observations` rows (not the counter column), ensuring accuracy even if counters drift.

---

## Environment Setup

### Required Environment Variables

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
JWT_SECRET=<random 64-char hex>
```

### Deployment (.replit)

```toml
[deployment]
deploymentTarget = "autoscale"
build = ["npm", "run", "build"]
run = ["sh", "-c", "NODE_ENV=production node ./dist/index.cjs"]
publicDir = "dist/public"
```

Port 5000 → external port 80. Health check at `/` returns 200 immediately (before app is fully ready).

### Database

Schema defined in `shared/schema.ts` using Drizzle ORM `pgTable()`. Migrations via `drizzle-kit push`.

Key tables: `inspection_sessions`, `structures`, `inspection_rooms`, `room_openings`, `room_adjacencies`, `sketch_annotations`, `damage_observations`, `line_items`, `inspection_photos`, `moisture_readings`.

---

## Common Gotchas

1. **Two phase systems**: Legacy numeric (1-8) and workflow strings coexist. Neither blocks tools. The agent uses `set_inspection_context` for tracking; `set_phase` updates workflow state.

2. **Inches vs feet**: The LLM frequently passes inches as raw numbers in `widthFt`/`heightFt`. The `autoConvertIfInches()` heuristic catches values 18-120 and divides by 12. Overhead/garage doors are excluded.

3. **Room name matching**: The client does fuzzy matching (exact → case-insensitive → substring). The agent does NOT need to call `list_rooms` or `find_room` before every tool — just pass the name and the client resolves it.

4. **Auth in components**: Use `getAuthHeaders` from `client/src/lib/queryClient.ts` (checks localStorage token + Supabase session). Do NOT create local `getAuthHeaders` functions — they miss the local token path.

5. **Sketch refresh**: After any mutation, call `refreshRooms()` which invalidates React Query caches. The sketch auto-refreshes every 10s as a fallback.

6. **CSP**: Production CSP in `server/index.ts` allows `*.supabase.co`, `api.openai.com`, `wss://api.openai.com`, `blob:`, `mediastream:`. If adding new external services, update `cspConnectSrc`.

7. **Structure deletion**: Uses cascade delete (`?cascade=true`) — removes all rooms, openings, annotations, and damages within the structure.

8. **Wall direction mapping**: The sketch uses north=top, south=bottom. For elevations: front=south, rear=north, left=west, right=east. Both `normalizeWallDirection()` (client) and `normalizeDirection()` (PropertySketch) handle this.
