# Sketch Editor — Interactive Floor Plan

## Overview

The Sketch Editor provides a touch-first, on-canvas editing experience for interior floor plans. It replaces the legacy "click room → edit in panel" flow with direct manipulation: resize handles, click-to-place openings, and on-canvas damage markers.

## Tool Modes

| Mode | Description | Interaction |
|------|-------------|-------------|
| **Select** | Default mode. Tap room to select; drag handles to resize. | Room selection, wall/corner handle resize |
| **Add Room** | Tap an existing room's wall to attach a new room. | Toolbar button opens add-room flow; wall-tap placement (MVP) |
| **Add Door** | Tap wall segment to place door. | Position stored as `positionOnWall` (0..1); drag along wall to reposition |
| **Add Window** | Tap wall segment to place window. | Same as door; type differs for ESX export |
| **Add Damage** | Tap inside room to place damage marker. | Marker stores `position` (room-relative x,y); click to edit note |
| **Pan/Zoom** | Navigate large sketches. | Optional; scroll/zoom on canvas |

## Data Model

### Opening (`room_openings`)

- `roomId` — which room
- `wallDirection` — north | south | east | west (or front/rear/left/right)
- `positionOnWall` — 0.0 to 1.0, offset along wall (0 = start, 1 = end). Enables drag-along-wall.
- `widthFt`, `heightFt` — size in feet (used for area deductions; estimate engine unchanged)
- `openingType` — door, window, standard_door, overhead_door, etc.

### Annotation (`sketch_annotations`)

- `roomId` — which room
- `annotationType` — `damage` for damage markers; also hail_count, pitch, storm_direction, etc.
- `position` — `{ x: number, y: number }` in room-relative coordinates (0..1 normalized, or pixel coords + room transform)
- `label`, `value` — note/severity (e.g. label: "Water stain", value: "moderate")

### Room Dimensions

- `dimensions` jsonb: `{ length, width, height, dimVars?, dimVarsBeforeMW? }`
- Resize updates length/width; DIM_VARS recomputed on PATCH `/api/rooms/:roomId/dimensions`

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| PATCH | `/api/rooms/:roomId/dimensions` | Update room dimensions (recalculates DIM_VARS) |
| POST | `/api/inspection/:sessionId/rooms/:roomId/openings` | Create opening (wallDirection, positionOnWall, widthFt, heightFt) |
| PATCH | `/api/inspection/:sessionId/rooms/:roomId/openings/:openingId` | Update opening (positionOnWall, widthFt, heightFt, openingType, etc.) |
| POST | `/api/inspection/:sessionId/rooms/:roomId/annotations` | Create annotation (position, label, value, annotationType) |
| PATCH | `/api/inspection/:sessionId/annotations/:annotationId` | Update annotation |
| POST | `/api/sessions/:sessionId/adjacencies` | Create room adjacency (for Add Room) |

## Architecture

- **SketchRenderer** — Pure component. Receives `layouts`, `openings`, `annotations`, `selection`. Renders SVG. No side effects. Supports `forwardRef` for SVG element access.
- **SketchEditor** — Owns tool mode, selection, pointer handlers, undo/redo, server persistence. Composes SketchRenderer. Uses BFS layout from `sketchLayout.ts`.
- **PropertySketch** — Read-only view for non-edit mode. Interior, roof, elevations each have their own section. SketchEditor is shown when in edit mode.

## Layout Model

- **BFS adjacency layout** — Rooms placed by adjacency. First room at origin; neighbors placed by wall direction.
- **No free-drag** — Room positions computed from dimensions + adjacency. Resize changes dimensions; layout recomputes.
- **Add Room** — User taps wall → we create room + adjacency → layout places new room automatically.

## Extending to Roof / Elevations

- Roof and elevation sections currently render read-only (no handles, no Add Room).
- To make editable: add tool-mode awareness to those sections; wall handles for elevation dimensions; similar persistence pattern.
- Roof facets use different geometry (gable/hip); would need facet-specific handle logic.

## Undo / Redo

- Client maintains history of sketch document state (rooms, openings, annotations).
- Each action: push state to history, optimistic UI update, persist to server.
- Undo/redo: pop/apply state, persist reverted state to server (PATCH/DELETE as needed).

## Touch / Pointer

- All interactions use `pointerdown`, `pointermove`, `pointerup`, `pointercancel`.
- Hit areas on walls use transparent thick paths (e.g. 12px) for easy taps on tablet.
- Handles sized for touch (min 24px).
