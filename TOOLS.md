# OpenAI Realtime Voice Tools Reference

All 51 tools registered with the OpenAI Realtime API session for voice-guided inspections. Defined in `server/realtime.ts` starting at line 670.

---

## Tool Gating by Workflow Phase

Tools are restricted per phase. Only tools listed for the current phase (plus globals) are available to the AI agent.

**Global Tools** (available in ALL phases):
`get_workflow_state`, `set_phase`, `set_context`, `trigger_photo_capture`, `analyze_photo`, `get_inspection_state`

| Phase | Additional Tools |
|-------|-----------------|
| `briefing` | *(globals only)* |
| `inspection_setup` | `create_structure` |
| `interior_rooms` | `create_room`, `create_sub_area`, `update_room` |
| `openings` | `add_opening`, `update_opening`, `delete_opening` |
| `elevations` | `create_room`, `add_opening`, `add_sketch_annotation` |
| `roof` | `create_room`, `add_damage`, `add_sketch_annotation`, `log_test_square` |
| `photos_damage` | `add_damage`, `confirm_damage` |
| `scope_build` | `add_line_item`, `update_line_item`, `validate_scope` |
| `review` | `validate_scope`, `run_workflow_gates` |
| `export` | `run_workflow_gates`, `export_esx` |

Source: `shared/contracts/workflow.ts` lines 29-41

---

## Tool Categories

### Context & Navigation (7 tools)
1. [set_inspection_context](#1-set_inspection_context)
2. [get_inspection_state](#2-get_inspection_state)
3. [get_workflow_state](#3-get_workflow_state)
4. [set_phase](#4-set_phase)
5. [set_context](#5-set_context)
6. [get_progress](#6-get_progress)
7. [skip_step](#7-skip_step)

### Structure Management (3 tools)
8. [create_structure](#8-create_structure)
9. [update_structure](#9-update_structure)
10. [delete_structure](#10-delete_structure)

### Room Management (8 tools)
11. [create_room](#11-create_room)
12. [create_sub_area](#12-create_sub_area)
13. [list_rooms](#13-list_rooms)
14. [find_room](#14-find_room)
15. [rename_room](#15-rename_room)
16. [get_room_details](#16-get_room_details)
17. [update_room_dimensions](#17-update_room_dimensions)
18. [delete_room](#18-delete_room)
19. [complete_room](#19-complete_room)
20. [set_room_adjacency](#20-set_room_adjacency)

### Openings (3 tools)
21. [add_opening](#21-add_opening)
22. [update_opening](#22-update_opening)
23. [delete_opening](#23-delete_opening)

### Sketch Annotations (1 tool)
24. [add_sketch_annotation](#24-add_sketch_annotation)

### Damage Observations (4 tools)
25. [add_damage](#25-add_damage)
26. [update_damage](#26-update_damage)
27. [delete_damage](#27-delete_damage)
28. [confirm_damage_suggestion](#28-confirm_damage_suggestion)

### Scope & Line Items (10 tools)
29. [add_line_item](#29-add_line_item)
30. [update_line_item](#30-update_line_item)
31. [remove_line_item](#31-remove_line_item)
32. [generate_scope](#32-generate_scope)
33. [validate_scope](#33-validate_scope)
34. [apply_peril_template](#34-apply_peril_template)
35. [apply_smart_macro](#35-apply_smart_macro)
36. [check_related_items](#36-check_related_items)
37. [delete_scope_item](#37-delete_scope_item)
38. [get_room_scope](#38-get_room_scope)
39. [get_scope_gaps](#39-get_scope_gaps)
40. [get_estimate_summary](#40-get_estimate_summary)

### Photos (3 tools)
41. [trigger_photo_capture](#41-trigger_photo_capture)
42. [list_photos](#42-list_photos)
43. [delete_photo](#43-delete_photo)

### Forensics — Hail Test Squares (3 tools)
44. [log_test_square](#44-log_test_square)
45. [update_test_square](#45-update_test_square)
46. [delete_test_square](#46-delete_test_square)

### Forensics — Moisture & Water (4 tools)
47. [log_moisture_reading](#47-log_moisture_reading)
48. [update_moisture_reading](#48-update_moisture_reading)
49. [delete_moisture_reading](#49-delete_moisture_reading)
50. [add_water_classification](#50-add_water_classification)

### Completeness & Validation (3 tools)
51. [get_completeness](#51-get_completeness)
52. [request_phase_validation](#52-request_phase_validation)
53. [complete_inspection](#53-complete_inspection)

---

## Full Tool Definitions

### 1. set_inspection_context

Sets the current location context: which structure, area, and phase the adjuster is working in. Call this whenever the adjuster moves to a new area or advances to a new phase in the inspection flow.

```typescript
{
  type: "function",
  name: "set_inspection_context",
  description: "Sets the current location context: which structure, area, and phase the adjuster is working in. Call this whenever the adjuster moves to a new area or advances to a new phase in the inspection flow.",
  parameters: {
    type: "object",
    properties: {
      structure: { type: "string", description: "e.g., 'Main Dwelling', 'Detached Garage', 'Fence'" },
      area: { type: "string", description: "e.g., 'Roof', 'Front Elevation', 'Master Bedroom'" },
      phase: { type: "integer", description: "Current phase number in the inspection flow" },
      phaseName: { type: "string", description: "Name of the current phase from the flow, e.g., 'Collateral Check', 'Roof Overview', 'Source ID'" }
    },
    required: ["area"]
  }
}
```

---

### 2. get_inspection_state

Returns the complete inspection hierarchy: all structures, their rooms, sub-areas, openings, annotations, and damage counts. Also returns currentPhase, currentStructure, currentArea, and phaseProgress indicating exactly where you are in the inspection flow. Call this at session start, on reconnect, and whenever you need to understand what has been documented or where you are in the workflow.

```typescript
{
  type: "function",
  name: "get_inspection_state",
  description: "Returns the complete inspection hierarchy: all structures, their rooms, sub-areas, openings, annotations, and damage counts. Also returns currentPhase, currentStructure, currentArea, and phaseProgress indicating exactly where you are in the inspection flow. Call this at session start, on reconnect, and whenever you need to understand what has been documented or where you are in the workflow.",
  parameters: {
    type: "object",
    properties: {}
  }
}
```

---

### 3. get_workflow_state

Get canonical workflow phase, step, context, and current allowed tool list.

```typescript
{
  type: "function",
  name: "get_workflow_state",
  description: "Get canonical workflow phase, step, context, and current allowed tool list.",
  parameters: {
    type: "object",
    properties: {
      sessionId: { type: "integer" }
    },
    required: []
  }
}
```

---

### 4. set_phase

Set workflow phase when user explicitly confirms moving steps.

```typescript
{
  type: "function",
  name: "set_phase",
  description: "Set workflow phase when user explicitly confirms moving steps.",
  parameters: {
    type: "object",
    properties: {
      sessionId: { type: "integer" },
      phase: { type: "string" }
    },
    required: ["phase"]
  }
}
```

---

### 5. set_context

Set workflow room/elevation/view context for subsequent tools.

```typescript
{
  type: "function",
  name: "set_context",
  description: "Set workflow room/elevation/view context for subsequent tools.",
  parameters: {
    type: "object",
    properties: {
      sessionId: { type: "integer" },
      roomId: { type: "integer" },
      roomName: { type: "string" },
      elevationId: { type: "integer" },
      viewType: { type: "string" }
    },
    required: []
  }
}
```

---

### 6. get_progress

Returns the current inspection progress: rooms completed, rooms remaining, current phase, photo count, line item count.

```typescript
{
  type: "function",
  name: "get_progress",
  description: "Returns the current inspection progress: rooms completed, rooms remaining, current phase, photo count, line item count.",
  parameters: {
    type: "object",
    properties: {}
  }
}
```

---

### 7. skip_step

Skips the current step or phase in the inspection flow. Requires voice password "123" (spoken as "one-two-three").

```typescript
{
  type: "function",
  name: "skip_step",
  description: "Skips the current step or phase in the inspection flow. IMPORTANT: Only call this tool after the adjuster has spoken the voice password '123'. If they ask to skip without saying the password, ask them to say the voice password first. Once they say '123' (one-two-three), proceed with the skip.",
  parameters: {
    type: "object",
    properties: {
      stepDescription: { type: "string", description: "Brief description of what step is being skipped, e.g., 'Property verification photo', 'Roof inspection - North Slope'" },
      reason: { type: "string", description: "Why it's being skipped, e.g., 'Practice session', 'Not applicable', 'Adjuster request'" },
      passwordConfirmed: { type: "boolean", description: "Must be true — confirms the adjuster spoke the voice password '123' before this call" }
    },
    required: ["stepDescription", "passwordConfirmed"]
  }
}
```

---

### 8. create_structure

Creates a new structure (L1 hierarchy). Must be called BEFORE creating rooms under it.

```typescript
{
  type: "function",
  name: "create_structure",
  description: "Creates a new structure (L1 hierarchy). Must be called BEFORE creating rooms under it. Common structures: Main Dwelling, Detached Garage, Shed, Fence.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Structure name, e.g., 'Main Dwelling', 'Detached Garage', 'Storage Shed', 'Fence'" },
      structureType: { type: "string", enum: ["dwelling", "garage", "shed", "fence", "pool", "other"], description: "Type of structure" }
    },
    required: ["name", "structureType"]
  }
}
```

---

### 9. update_structure

Update a structure's name or type.

```typescript
{
  type: "function",
  name: "update_structure",
  description: "Update a structure's name or type.",
  parameters: {
    type: "object",
    properties: {
      structureName: { type: "string", description: "Current name of the structure" },
      structureId: { type: "number", description: "ID of the structure (alternative to name)" },
      newName: { type: "string", description: "New name for the structure" },
      structureType: { type: "string", description: "New structure type (dwelling, detached_garage, shed, etc.)" }
    },
    required: []
  }
}
```

---

### 10. delete_structure

Delete a structure from the inspection. If cascade is true, all rooms under this structure are also deleted.

```typescript
{
  type: "function",
  name: "delete_structure",
  description: "Delete a structure from the inspection. If cascade is true, all rooms under this structure are also deleted. If cascade is false and rooms exist, the deletion will fail. Always confirm with the adjuster first.",
  parameters: {
    type: "object",
    properties: {
      structureName: { type: "string", description: "Name of the structure to delete" },
      structureId: { type: "number", description: "ID of the structure (alternative to name)" },
      cascade: { type: "boolean", description: "If true, delete all rooms under this structure too" },
      confirm: { type: "boolean", description: "Must be true to proceed" }
    },
    required: ["confirm"]
  }
}
```

---

### 11. create_room

Creates a new room or area (L2 hierarchy) within a structure. The structure MUST exist first.

```typescript
{
  type: "function",
  name: "create_room",
  description: "Creates a new room or area (L2 hierarchy) within a structure. The structure MUST exist first — call create_structure if needed. Always specify structure name and viewType.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Room name, e.g., 'Master Bedroom', 'North Slope', 'Front Elevation'" },
      roomType: {
        type: "string",
        enum: [
          "interior_bedroom", "interior_bathroom", "interior_kitchen", "interior_living",
          "interior_hallway", "interior_closet", "interior_laundry", "interior_basement",
          "interior_attic", "interior_other", "exterior_roof_slope",
          "exterior_elevation_front", "exterior_elevation_left", "exterior_elevation_right",
          "exterior_elevation_rear", "exterior_gutter", "exterior_garage_door",
          "exterior_porch", "exterior_deck", "exterior_fence", "exterior_other"
        ],
        description: "Room/area type"
      },
      structure: { type: "string", description: "REQUIRED. Structure name this room belongs to, e.g., 'Main Dwelling'" },
      viewType: {
        type: "string",
        enum: ["interior", "roof_plan", "elevation", "exterior_other"],
        description: "REQUIRED. How this area is viewed in the sketch."
      },
      shapeType: {
        type: "string",
        enum: ["rectangle", "gable", "hip", "l_shape", "custom"],
        description: "Shape for sketch rendering. Default: rectangle. Use gable/hip for roof facets."
      },
      length: { type: "number", description: "Room length in feet" },
      width: { type: "number", description: "Room width in feet" },
      height: { type: "number", description: "Wall/ceiling height in feet" },
      floor: { type: "integer", description: "Floor level (1=ground, 2=second, 0=basement). Default: 1" },
      facetLabel: { type: "string", description: "For roof facets: F1, F2, F3, etc." },
      pitch: { type: "string", description: "Roof pitch, e.g., '6/12', '8/12'" },
      roofPitch: { type: "string", description: "Roof pitch as rise/run (e.g., '7/12', '10/12'). Alias for pitch." },
      phase: { type: "integer", description: "Inspection phase (3=exterior, 4=interior, 5=moisture)" }
    },
    required: ["name", "structure", "viewType"]
  }
}
```

---

### 12. create_sub_area

Creates a sub-area or attachment (L3 hierarchy) within a parent room. Examples: closet in a bedroom, pantry in a kitchen, dormer on a roof, bay window on an elevation.

```typescript
{
  type: "function",
  name: "create_sub_area",
  description: "Creates a sub-area or attachment (L3 hierarchy) within a parent room. Examples: closet in a bedroom, pantry in a kitchen, dormer on a roof, bay window on an elevation.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Sub-area name, e.g., 'Walk-in Closet', 'Pantry', 'Bay Window', 'Dormer'" },
      parentRoomName: { type: "string", description: "Name of the parent room this attaches to" },
      attachmentType: {
        type: "string",
        enum: ["extension", "closet", "dormer", "bay_window", "alcove", "island", "bump_out", "other"],
        description: "How this sub-area attaches to the parent"
      },
      length: { type: "number", description: "Length in feet" },
      width: { type: "number", description: "Width in feet" },
      height: { type: "number", description: "Height in feet" }
    },
    required: ["name", "parentRoomName", "attachmentType"]
  }
}
```

---

### 13. list_rooms

List all rooms in the current inspection. Use before assigning damage to ensure the room exists.

```typescript
{
  type: "function",
  name: "list_rooms",
  description: "List all rooms in the current inspection. Use before assigning damage to ensure the room exists. Returns rooms with dimensions and damage counts.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
}
```

---

### 14. find_room

Search for a room by name with fuzzy matching. Returns top 3 matches with confidence scores (0-1).

```typescript
{
  type: "function",
  name: "find_room",
  description: "Search for a room by name with fuzzy matching. Returns top 3 matches with confidence scores (0–1). If best match confidence < 0.8, ask the user to clarify which room they mean.",
  parameters: {
    type: "object",
    properties: {
      roomNameQuery: { type: "string", description: "Room name or partial name to search for" }
    },
    required: ["roomNameQuery"]
  }
}
```

---

### 15. rename_room

Rename an existing room. All damage and scope items are automatically reassociated.

```typescript
{
  type: "function",
  name: "rename_room",
  description: "Rename an existing room. All damage and scope items are automatically reassociated.",
  parameters: {
    type: "object",
    properties: {
      roomId: { type: "integer", description: "ID of the room to rename" },
      newName: { type: "string", description: "New name for the room" }
    },
    required: ["roomId", "newName"]
  }
}
```

---

### 16. get_room_details

Gets detailed information about a specific room including dimensions, openings (doors/windows), annotations (hail counts, pitch), and damage summary.

```typescript
{
  type: "function",
  name: "get_room_details",
  description: "Gets detailed information about a specific room including dimensions, openings (doors/windows), annotations (hail counts, pitch), and damage summary.",
  parameters: {
    type: "object",
    properties: {
      roomId: { type: "integer", description: "The room ID to get details for" },
      roomName: { type: "string", description: "The room name (alternative to roomId)" }
    }
  }
}
```

---

### 17. update_room_dimensions

Updates dimensions for an existing room. Automatically recalculates DIM_VARS (wall area, floor area, perimeter, volume) after update.

```typescript
{
  type: "function",
  name: "update_room_dimensions",
  description: "Updates dimensions for an existing room. CONSTRAINT: The room must already exist. Use this when the adjuster provides or corrects room measurements. Automatically recalculates DIM_VARS (wall area, floor area, perimeter, volume) after update.",
  parameters: {
    type: "object",
    properties: {
      roomName: { type: "string", description: "Name of the room to update" },
      length: { type: "number", description: "Room length in feet" },
      width: { type: "number", description: "Room width in feet" },
      height: { type: "number", description: "Wall/ceiling height in feet (default 8)" },
      ceilingType: {
        type: "string",
        enum: ["flat", "cathedral", "tray", "vaulted"],
        description: "Ceiling type (default flat)"
      }
    },
    required: ["roomName"]
  }
}
```

---

### 18. delete_room

Delete a room from the inspection. Also removes all openings, annotations, damages, and moisture readings in the room.

```typescript
{
  type: "function",
  name: "delete_room",
  description: "Delete a room from the inspection. This also removes all openings, annotations, damages, and moisture readings in the room. Line items and scope items keep their data but lose the room link. Always confirm with the adjuster before deleting.",
  parameters: {
    type: "object",
    properties: {
      roomName: { type: "string", description: "Name of the room to delete" },
      roomId: { type: "number", description: "ID of the room to delete (alternative to roomName)" },
      confirm: { type: "boolean", description: "Must be true to proceed with deletion" }
    },
    required: ["confirm"]
  }
}
```

---

### 19. complete_room

Marks the current room as complete and asks to move to the next area.

```typescript
{
  type: "function",
  name: "complete_room",
  description: "Marks the current room as complete and asks to move to the next area.",
  parameters: {
    type: "object",
    properties: {
      roomName: { type: "string", description: "Name of the room to mark complete" }
    },
    required: ["roomName"]
  }
}
```

---

### 20. set_room_adjacency

Records that two rooms share a wall. Enables shared-wall rendering in the sketch and correct opensInto values in ESX export.

```typescript
{
  type: "function",
  name: "set_room_adjacency",
  description: "Records that two rooms share a wall. CONSTRAINT: Both rooms must already exist (created via create_room). This enables shared-wall rendering in the sketch and correct opensInto values in ESX export. Call when the adjuster mentions room connections like 'this room is next to the kitchen' or 'there's a door from here to the hallway'.",
  parameters: {
    type: "object",
    properties: {
      roomNameA: { type: "string", description: "Name of the first room (current room if not specified)" },
      roomNameB: { type: "string", description: "Name of the room it connects to" },
      wallDirectionA: {
        type: "string",
        enum: ["north", "south", "east", "west"],
        description: "Which wall of room A faces room B."
      },
      wallDirectionB: {
        type: "string",
        enum: ["north", "south", "east", "west"],
        description: "Which wall of room B faces room A (should be opposite of wallDirectionA)."
      },
      sharedWallLengthFt: { type: "number", description: "Length of the shared wall in feet (if known)" }
    },
    required: ["roomNameA", "roomNameB"]
  }
}
```

---

### 21. add_opening

Creates a wall opening that deducts area from the room's wall SF calculation and creates a MISS_WALL entry for ESX export. Tool-first: call IMMEDIATELY when the adjuster mentions any opening.

```typescript
{
  type: "function",
  name: "add_opening",
  description: "CALL THIS TOOL IMMEDIATELY when the adjuster mentions any opening (door, window, pass-through, missing wall, overhead door). Do NOT ask for confirmation first. Only roomName and openingType are truly essential — widthFt and heightFt have smart defaults (door 3×6.67, window 3×4). Convert inches to feet yourself (36\"=3.0, 30\"=2.5). This tool creates a wall opening that deducts area from the room's wall SF calculation and creates a MISS_WALL entry for ESX export. If the adjuster says 'draw it anyway', call immediately without debate.",
  parameters: {
    type: "object",
    properties: {
      roomName: { type: "string", description: "Name of the room to add the opening to" },
      openingType: {
        type: "string",
        enum: [
          "window", "standard_door", "overhead_door", "missing_wall",
          "pass_through", "archway", "cased_opening", "door",
          "sliding_door", "french_door"
        ],
        description: "Type of opening. Use 'overhead_door' for garage doors (goesToFloor auto-set true). Use 'missing_wall' for large open sections."
      },
      wallDirection: {
        type: "string",
        enum: ["north", "south", "east", "west", "front", "rear", "left", "right"],
        description: "(OPTIONAL) Which wall the opening is on."
      },
      wallIndex: { type: "integer", description: "Which wall by index (0=north/front, 1=east/right, 2=south/back, 3=west/left). Alternative to wallDirection." },
      widthFt: { type: "number", description: "Opening width in feet. Convert inches: 36\"=3, 30\"=2.5. Defaults when not specified." },
      heightFt: { type: "number", description: "Opening height in feet. e.g., 6.67 for 6'8\". Defaults when not specified." },
      width: { type: "number", description: "Legacy alias for widthFt." },
      height: { type: "number", description: "Legacy alias for heightFt." },
      quantity: { type: "integer", description: "Number of identical openings (e.g., 3 matching windows). Default 1." },
      label: { type: "string", description: "(OPTIONAL — auto-generated if omitted) Label, e.g., 'Entry Door', 'Bay Window', 'French Doors'" },
      opensInto: { type: "string", description: "(OPTIONAL) Where the opening leads. Use room name or 'E' for exterior." },
      notes: { type: "string", description: "Additional notes (e.g., 'dented sill wrap', 'cracked glass')" }
    },
    required: ["roomName", "openingType", "widthFt", "heightFt"]
  }
}
```

---

### 22. update_opening

Updates an existing opening. Prefer openingId when available.

```typescript
{
  type: "function",
  name: "update_opening",
  description: "Updates an existing opening. Prefer openingId when available. If openingId is omitted, selector fields (roomName + openingType + wallDirection + index) are used.",
  parameters: {
    type: "object",
    properties: {
      openingId: { type: "integer", description: "Opening id to update (preferred)." },
      roomName: { type: "string", description: "Room containing opening when openingId is not provided." },
      openingType: { type: "string", description: "Opening type selector or updated type." },
      wallDirection: {
        type: "string",
        enum: ["north", "south", "east", "west", "front", "rear", "left", "right"],
        description: "Wall direction selector or updated wall direction."
      },
      index: { type: "integer", description: "0-based index when selector matches multiple openings." },
      widthFt: { type: "number", description: "Updated opening width in feet." },
      heightFt: { type: "number", description: "Updated opening height in feet." },
      width: { type: "number", description: "Legacy alias for widthFt." },
      height: { type: "number", description: "Legacy alias for heightFt." },
      wallIndex: { type: "integer" },
      positionOnWall: { type: "number" },
      quantity: { type: "integer" },
      label: { type: "string" },
      opensInto: { type: "string" },
      notes: { type: "string" }
    }
  }
}
```

---

### 23. delete_opening

Deletes an opening by openingId or selector.

```typescript
{
  type: "function",
  name: "delete_opening",
  description: "Deletes an opening by openingId or selector (roomName + openingType + wallDirection + index).",
  parameters: {
    type: "object",
    properties: {
      openingId: { type: "integer", description: "Opening id to delete (preferred)." },
      roomName: { type: "string", description: "Room containing opening when openingId is not provided." },
      openingType: { type: "string", description: "Opening type selector." },
      wallDirection: {
        type: "string",
        enum: ["north", "south", "east", "west", "front", "rear", "left", "right"],
        description: "Wall direction selector."
      },
      index: { type: "integer", description: "0-based index when selector matches multiple openings." }
    }
  }
}
```

---

### 24. add_sketch_annotation

Adds a metadata annotation (L5) to a room or facet. Use for hail hit counts, roof pitch, storm direction, material notes, and measurement observations.

```typescript
{
  type: "function",
  name: "add_sketch_annotation",
  description: "Adds a metadata annotation (L5) to a room or facet. Use for hail hit counts, roof pitch, storm direction, material notes, and measurement observations.",
  parameters: {
    type: "object",
    properties: {
      roomName: { type: "string", description: "Room/facet to annotate" },
      annotationType: {
        type: "string",
        enum: ["hail_count", "pitch", "storm_direction", "material_note", "measurement", "general_note"],
        description: "Type of annotation"
      },
      label: { type: "string", description: "Short label, e.g., 'Hail Hits', 'Roof Pitch', 'Storm Direction'" },
      value: { type: "string", description: "The value, e.g., '8', '6/12', 'NW', 'Architectural shingles'" },
      location: { type: "string", description: "Where on the room/facet. Use N/S/E/W: 'North Wall', 'South slope', 'NE corner'" }
    },
    required: ["roomName", "annotationType", "label", "value"]
  }
}
```

---

### 25. add_damage

Records a damage observation. Requires a room context. Auto-generates scope line items with quantities derived from room geometry when dimensions are available.

```typescript
{
  type: "function",
  name: "add_damage",
  description: "Records a damage observation. REQUIRES a room context — provide roomName to specify which room, or omit to use the currently selected room. If no room is selected, ask the adjuster first. The system auto-generates scope line items with quantities derived from room geometry when dimensions are available. If dimensions are missing, quantities default to 1 — the response will include a dimensionWarning.",
  parameters: {
    type: "object",
    properties: {
      roomName: { type: "string", description: "Name of the room where damage is located. If omitted, uses the currently selected room." },
      description: { type: "string", description: "What the damage is, e.g., 'Water staining on ceiling, approximately 4 feet in diameter'" },
      damageType: {
        type: "string",
        enum: [
          "hail_impact", "wind_damage", "water_stain", "water_intrusion",
          "crack", "dent", "missing", "rot", "mold", "mechanical",
          "wear_tear", "other"
        ]
      },
      severity: { type: "string", enum: ["minor", "moderate", "severe"] },
      location: { type: "string", description: "Where in the room. Use N/S/E/W: 'North wall', 'South wall base', 'NE corner', 'ceiling center'" },
      extent: { type: "string", description: "Size/measurement of damage area" },
      hitCount: { type: "integer", description: "For hail: number of impacts in test square" }
    },
    required: ["description", "damageType"]
  }
}
```

---

### 26. update_damage

Update an existing damage observation.

```typescript
{
  type: "function",
  name: "update_damage",
  description: "Update an existing damage observation. Change description, type, severity, or location.",
  parameters: {
    type: "object",
    properties: {
      damageId: { type: "number", description: "ID of the damage to update" },
      roomName: { type: "string", description: "Room name to search for the damage (alternative to damageId)" },
      description: { type: "string", description: "Updated damage description" },
      damageType: { type: "string", description: "Updated damage type" },
      severity: { type: "string", description: "Updated severity ('minor', 'moderate', 'severe')" },
      location: { type: "string", description: "Updated location within the room" }
    },
    required: []
  }
}
```

---

### 27. delete_damage

Delete a damage observation. Also disconnects any linked line items and photos.

```typescript
{
  type: "function",
  name: "delete_damage",
  description: "Delete a damage observation. WARNING: This also disconnects any linked line items and photos (they keep their data but lose the damage link).",
  parameters: {
    type: "object",
    properties: {
      damageId: { type: "number", description: "ID of the damage to delete" },
      roomName: { type: "string", description: "Room name to search for damage (alternative to damageId)" },
      damageType: { type: "string", description: "Filter: damage type to narrow the search" }
    },
    required: []
  }
}
```

---

### 28. confirm_damage_suggestion

Confirms or rejects a damage suggestion detected by photo AI analysis. Call after discussing photo analysis results with the adjuster.

```typescript
{
  type: "function",
  name: "confirm_damage_suggestion",
  description: "Confirms or rejects a damage suggestion that was detected by photo AI analysis. When a photo reveals potential damage, the adjuster must confirm before it is logged as an observation. Call this after discussing photo analysis results with the adjuster.",
  parameters: {
    type: "object",
    properties: {
      roomName: { type: "string", description: "Room name to log the damage in. Optional if a room is already selected in context." },
      photoId: { type: "integer", description: "The ID of the photo that produced the suggestion" },
      damageType: {
        type: "string",
        enum: [
          "hail_impact", "wind_damage", "water_stain", "water_intrusion",
          "crack", "dent", "missing", "rot", "mold", "mechanical",
          "wear_tear", "other"
        ],
        description: "The damage type to confirm (from damageSuggestions)"
      },
      severity: {
        type: "string",
        enum: ["minor", "moderate", "severe"],
        description: "Confirmed severity level"
      },
      confirmed: { type: "boolean", description: "true if adjuster confirms the damage, false to reject" },
      location: { type: "string", description: "Where in the room the damage was detected" }
    },
    required: ["photoId", "damageType", "confirmed"]
  }
}
```

---

### 29. add_line_item

Adds an Xactimate-compatible estimate line item. When possible, provide a catalogCode for accurate pricing lookup.

```typescript
{
  type: "function",
  name: "add_line_item",
  description: "Adds an Xactimate-compatible estimate line item. When possible, provide a catalogCode for accurate pricing lookup — the system will match it against the trade catalog for regional pricing, correct unit types, and default waste factors. If auto-scope already generated items for a damage, you typically don't need to add them manually — check the auto-scope summary first. Companion items (e.g., painting after drywall) may also be auto-generated.",
  parameters: {
    type: "object",
    properties: {
      roomName: { type: "string", description: "Room name to attach the line item to. Optional if a room is already selected in context." },
      category: {
        type: "string",
        enum: [
          "Roofing", "Siding", "Soffit/Fascia", "Gutters", "Windows", "Doors",
          "Drywall", "Painting", "Flooring", "Plumbing", "Electrical", "HVAC",
          "Debris", "General", "Fencing", "Cabinetry"
        ]
      },
      action: {
        type: "string",
        enum: ["R&R", "Detach & Reset", "Repair", "Paint", "Clean", "Tear Off", "Labor Only", "Install"]
      },
      description: { type: "string", description: "Detailed item, e.g., 'Laminated composition shingles' or '6-inch aluminum fascia'" },
      catalogCode: { type: "string", description: "Xactimate-style code from pricing catalog (e.g., 'RFG-SHIN-AR'). Enables auto-quantity derivation and companion cascading." },
      quantity: { type: "number", description: "Amount (SF, LF, EA, SQ). OMIT if catalogCode is provided — quantity will auto-derive from room geometry." },
      unit: { type: "string", enum: ["SF", "LF", "EA", "SQ", "SY", "HR", "DAY"] },
      unitPrice: { type: "number", description: "Price per unit. If catalogCode and region are set, this comes from the pricing database." },
      wasteFactor: { type: "integer", description: "Waste percentage for materials only (10, 12, 15). Applies to materials, NOT labor." },
      depreciationType: { type: "string", enum: ["Recoverable", "Non-Recoverable", "Paid When Incurred"] },
      coverageType: { type: "string", enum: ["A", "B", "C"], description: "A=Dwelling, B=Other Structures, C=Contents. Default A." },
      damageId: { type: "integer", description: "Link this line item to a specific damage observation" },
      age: { type: "number", description: "Age of the item in years (e.g., 15 for a 15-year-old roof)." },
      lifeExpectancy: { type: "number", description: "Expected useful life in years (e.g., 30 for architectural shingles)." },
      coverageBucket: { type: "string", enum: ["Coverage A", "Coverage B", "Coverage C"] },
      coverage_bucket: { type: "string", enum: ["Dwelling", "Other_Structures", "Code_Upgrade", "Contents"] },
      quality_grade: { type: "string", description: "Material grade (e.g., 'MDF', 'Pine', 'Standard')." },
      apply_o_and_p: { type: "boolean", description: "Whether to apply 10% Overhead + 10% Profit markup." }
    },
    required: ["category", "action", "description"]
  }
}
```

---

### 30. update_line_item

Updates an existing scope line item. Use to adjust quantity, unit price, description, or other properties after creation.

```typescript
{
  type: "function",
  name: "update_line_item",
  description: "Updates an existing scope line item. Use to adjust quantity, unit price, description, or other properties after creation. The adjuster may say 'change that to 120 square feet' or 'update the price to $3.50'. Always confirm the change with the adjuster.",
  parameters: {
    type: "object",
    properties: {
      lineItemId: { type: "integer", description: "The ID of the line item to update" },
      quantity: { type: "number", description: "New quantity value" },
      unitPrice: { type: "number", description: "New unit price" },
      description: { type: "string", description: "Updated description" },
      unit: { type: "string", enum: ["SF", "LF", "EA", "SQ", "SY", "HR", "DAY"], description: "Updated unit of measure" },
      age: { type: "number", description: "Updated age in years for depreciation" },
      depreciationType: { type: "string", enum: ["Recoverable", "Non-Recoverable", "Paid When Incurred"], description: "Depreciation classification" }
    },
    required: ["lineItemId"]
  }
}
```

---

### 31. remove_line_item

Removes a line item from the scope. Confirm with the adjuster before removing.

```typescript
{
  type: "function",
  name: "remove_line_item",
  description: "Removes a line item from the scope. Use when the adjuster says to delete, remove, or cancel a specific item. Confirm with the adjuster before removing.",
  parameters: {
    type: "object",
    properties: {
      lineItemId: { type: "integer", description: "The ID of the line item to remove" },
      reason: { type: "string", description: "Why the item is being removed, e.g., 'Not applicable', 'Duplicate', 'Adjuster override'" }
    },
    required: ["lineItemId"]
  }
}
```

---

### 32. generate_scope

Triggers the scope assembly engine to automatically generate estimate line items from a damage observation. Uses room geometry to derive quantities and cascades companion items.

```typescript
{
  type: "function",
  name: "generate_scope",
  description: "Triggers the scope assembly engine to automatically generate estimate line items from a damage observation. Uses room geometry to derive quantities and cascades companion items. Call this AFTER recording damage with add_damage. Returns the items created plus any that need manual quantities.",
  parameters: {
    type: "object",
    properties: {
      damageId: { type: "integer", description: "The ID of the damage observation to generate scope from (returned by add_damage)" },
      roomId: { type: "integer", description: "The room ID where the damage was observed" }
    },
    required: ["damageId", "roomId"]
  }
}
```

---

### 33. validate_scope

Validates the current scope for completeness and consistency. Checks for missing companion items, trade sequence gaps, quantity mismatches, and coverage issues.

```typescript
{
  type: "function",
  name: "validate_scope",
  description: "Validates the current scope for completeness and consistency. Checks for missing companion items, trade sequence gaps, quantity mismatches, and coverage issues. Call during Phase 7 (Estimate Assembly) or when the adjuster asks to review the estimate.",
  parameters: {
    type: "object",
    properties: {
      sessionId: { type: "integer", description: "The inspection session ID" }
    },
    required: ["sessionId"]
  }
}
```

---

### 34. apply_peril_template

Applies a peril-specific scope template to a room, pre-populating line items based on the claim's peril type and room type.

```typescript
{
  type: "function",
  name: "apply_peril_template",
  description: "Applies a peril-specific scope template to a room, pre-populating line items based on the claim's peril type and room type. Use when entering a new room to establish a baseline scope.",
  parameters: {
    type: "object",
    properties: {
      roomId: { type: "integer", description: "The room ID to apply the template to" },
      templateName: { type: "string", description: "The template name to apply (e.g., 'Water Damage — Interior Room', 'Hail Damage — Roof')" },
      includeAutoOnly: { type: "boolean", description: "If true, only include auto-include items. If false, include all template items as suggestions." }
    },
    required: ["roomId"]
  }
}
```

---

### 35. apply_smart_macro

Applies a bundle of standard line items for common repair scopes. Saves time by bundling items that always go together per Xactimate standards.

```typescript
{
  type: "function",
  name: "apply_smart_macro",
  description: "Applies a bundle of standard line items for common repair scopes. For example, 'Full Roof Replacement' adds tear-off, shingles, felt, ice & water barrier, drip edge, and ridge vent in one command. Saves time by bundling items that always go together per Xactimate standards.",
  parameters: {
    type: "object",
    properties: {
      macro_type: {
        type: "string",
        enum: [
          "roof_replacement_laminated", "roof_replacement_3tab",
          "interior_paint_walls_ceiling", "water_mitigation_dryout"
        ],
        description: "The bundle to apply."
      },
      severity: {
        type: "string",
        enum: ["average", "heavy", "premium"],
        description: "Affects quantities and material grade. Default: average."
      },
      waste_factor: { type: "number", description: "Waste percentage override (e.g. 10, 15). Defaults vary by macro." }
    },
    required: ["macro_type"]
  }
}
```

---

### 36. check_related_items

Analyzes the current room's items to detect missing complementary line items ('leakage'). For example, after 'R&R Vanity' suggests 'Detach/Reset Plumbing, Angle Stops, P-Trap'.

```typescript
{
  type: "function",
  name: "check_related_items",
  description: "Analyzes the current room's items to detect missing complementary line items ('leakage'). For example, after 'R&R Vanity' this tool suggests 'Detach/Reset Plumbing, Angle Stops, P-Trap'. Call this automatically after major R&R or removal actions to ensure the estimate is complete.",
  parameters: {
    type: "object",
    properties: {
      primary_category: {
        type: "string",
        enum: ["Cabinetry", "Roofing", "Drywall", "Siding", "Flooring", "Plumbing", "Electrical", "Windows", "Doors"],
        description: "The category of the action just performed."
      },
      action_taken: { type: "string", description: "The main action just performed (e.g., 'Remove Vanity', 'R&R Kitchen Cabinets', 'Tear Off Shingles')." }
    },
    required: ["primary_category"]
  }
}
```

---

### 37. delete_scope_item

Remove a scope item from the estimate. The item is soft-deleted and can be recovered.

```typescript
{
  type: "function",
  name: "delete_scope_item",
  description: "Remove a scope item from the estimate. The item is soft-deleted and can be recovered.",
  parameters: {
    type: "object",
    properties: {
      scopeItemId: { type: "number", description: "ID of the scope item to remove" },
      description: { type: "string", description: "Description of the item (for confirmation)" }
    },
    required: ["scopeItemId"]
  }
}
```

---

### 38. get_room_scope

Returns all scope line items for a specific room with quantities, unit prices, and total prices.

```typescript
{
  type: "function",
  name: "get_room_scope",
  description: "Returns all scope line items for a specific room with quantities, unit prices, and total prices. Use to review what has been scoped for the current room before moving on, or when the adjuster asks 'what do we have for this room?' or 'read back the items'.",
  parameters: {
    type: "object",
    properties: {
      roomName: { type: "string", description: "The room name to get scope for" },
      roomId: { type: "integer", description: "The room ID (alternative to roomName)" }
    }
  }
}
```

---

### 39. get_scope_gaps

Returns a list of scope gaps — rooms or areas where damage has been documented but no corresponding line items exist.

```typescript
{
  type: "function",
  name: "get_scope_gaps",
  description: "Returns a list of scope gaps — rooms or areas where damage has been documented but no corresponding line items exist. Use this to identify missing scope items and help the adjuster complete their estimate. Also flags common companion item omissions (e.g., drywall without painting).",
  parameters: {
    type: "object",
    properties: {
      roomId: { type: "integer", description: "Optional: check gaps for a specific room only. Omit for all rooms." }
    },
    required: []
  }
}
```

---

### 40. get_estimate_summary

Returns the running estimate totals: total RCV, depreciation, ACV, deductible, net claim, item count.

```typescript
{
  type: "function",
  name: "get_estimate_summary",
  description: "Returns the running estimate totals: total RCV, depreciation, ACV, deductible, net claim, item count.",
  parameters: {
    type: "object",
    properties: {}
  }
}
```

---

### 41. trigger_photo_capture

Opens the camera on the adjuster's device. Deferred result pattern — agent waits for user to capture before receiving result with AI analysis.

```typescript
{
  type: "function",
  name: "trigger_photo_capture",
  description: "Opens the camera on the adjuster's device. CRITICAL: You MUST verbally ask the adjuster if they are ready to take a photo BEFORE calling this tool. For example say 'Ready to take a photo of the north slope? Let me know when you are set.' Only call this tool AFTER the adjuster verbally confirms they are ready. The camera opens and waits for the adjuster to tap the capture button. Do NOT continue talking until you receive the tool result. The result will include AI analysis of the captured photo. If damageSuggestions are present, discuss them with the adjuster and use confirm_damage_suggestion to log confirmed damage. If qualityScore is below 50, suggest retaking the photo.",
  parameters: {
    type: "object",
    properties: {
      label: { type: "string", description: "Caption for the photo, e.g., 'Hail Test Square - North Slope'" },
      photoType: {
        type: "string",
        enum: ["overview", "address_verification", "damage_detail", "test_square", "moisture", "pre_existing"]
      },
      overlay: {
        type: "string",
        enum: ["none", "test_square_grid", "measurement_ruler"],
        description: "Optional camera overlay"
      }
    },
    required: ["label", "photoType"]
  }
}
```

---

### 42. list_photos

List all photos taken during the inspection, optionally filtered by room.

```typescript
{
  type: "function",
  name: "list_photos",
  description: "List all photos taken during the inspection, optionally filtered by room.",
  parameters: {
    type: "object",
    properties: {
      roomName: { type: "string", description: "Filter photos by room name" }
    },
    required: []
  }
}
```

---

### 43. delete_photo

Delete a photo from the inspection.

```typescript
{
  type: "function",
  name: "delete_photo",
  description: "Delete a photo from the inspection.",
  parameters: {
    type: "object",
    properties: {
      photoId: { type: "number", description: "ID of the photo to delete" },
      confirm: { type: "boolean", description: "Must be true to proceed" }
    },
    required: ["photoId", "confirm"]
  }
}
```

---

### 44. log_test_square

Logs a forensic 10x10 test square for hail/wind damage assessment. Required by most carriers for hail claims.

```typescript
{
  type: "function",
  name: "log_test_square",
  description: "Logs a forensic 10x10 test square for hail/wind damage assessment. Required by most carriers for hail claims. Records hit counts, wind creases, roof pitch (critical for steep charges), and pass/fail determination. The pitch value directly impacts labor pricing — pitches above 7/12 trigger steep charges.",
  parameters: {
    type: "object",
    properties: {
      room_id: { type: "string", description: "The specific roof slope/facet ID or name (e.g., 'North Slope', 'F1')." },
      hail_hits: { type: "integer", description: "Number of hail impacts counted in the 10x10 ft test square." },
      wind_creases: { type: "integer", description: "Number of wind creases/lifted shingles in the test square." },
      pitch: { type: "string", description: "Roof pitch, e.g., '7/12'. Critical: pitches above 7/12 trigger steep charges in Xactimate." },
      result: {
        type: "string",
        enum: ["pass", "fail", "brittle_test_failure"],
        description: "Test outcome. 'fail' = enough damage for replacement. 'brittle_test_failure' = shingles failed brittle test (age/weathering)."
      },
      notes: { type: "string", description: "Additional observations, e.g., 'Granule loss concentrated on south exposure'" }
    },
    required: ["hail_hits", "pitch"]
  }
}
```

---

### 45. update_test_square

Update an existing test square result.

```typescript
{
  type: "function",
  name: "update_test_square",
  description: "Update an existing test square result (correct hail hit count, wind creases, pitch, or result).",
  parameters: {
    type: "object",
    properties: {
      testSquareId: { type: "number", description: "ID of the test square to update" },
      hailHits: { type: "number", description: "Corrected hail hit count" },
      windCreases: { type: "number", description: "Corrected wind crease count" },
      pitch: { type: "string", description: "Corrected roof pitch" },
      result: { type: "string", description: "Updated result ('pass' or 'fail')" },
      notes: { type: "string", description: "Updated notes" }
    },
    required: ["testSquareId"]
  }
}
```

---

### 46. delete_test_square

Delete a test square result.

```typescript
{
  type: "function",
  name: "delete_test_square",
  description: "Delete a test square result.",
  parameters: {
    type: "object",
    properties: {
      testSquareId: { type: "number", description: "ID of the test square to delete" }
    },
    required: ["testSquareId"]
  }
}
```

---

### 47. log_moisture_reading

Records a moisture meter reading at a specific location.

```typescript
{
  type: "function",
  name: "log_moisture_reading",
  description: "Records a moisture meter reading at a specific location. If a room is currently selected the reading attaches to it; otherwise provide roomName.",
  parameters: {
    type: "object",
    properties: {
      roomName: { type: "string", description: "Room name to attach the reading to. Optional if a room is already selected in context." },
      location: { type: "string", description: "Where the reading was taken. Use N/S/E/W: 'north wall base', 'south wall, 6 inches from floor'" },
      reading: { type: "number", description: "Moisture percentage reading" },
      materialType: {
        type: "string",
        enum: ["drywall", "wood_framing", "subfloor", "concrete", "carpet_pad", "insulation"]
      },
      dryStandard: { type: "number", description: "Reference dry value for this material type (e.g., drywall=12, wood=15)" }
    },
    required: ["location", "reading"]
  }
}
```

---

### 48. update_moisture_reading

Correct a moisture reading value, location, or material type.

```typescript
{
  type: "function",
  name: "update_moisture_reading",
  description: "Correct a moisture reading value, location, or material type.",
  parameters: {
    type: "object",
    properties: {
      readingId: { type: "number", description: "ID of the moisture reading to update" },
      location: { type: "string", description: "Updated location description" },
      reading: { type: "number", description: "Corrected moisture reading value" },
      materialType: { type: "string", description: "Corrected material type" },
      dryStandard: { type: "number", description: "Corrected dry standard" }
    },
    required: ["readingId"]
  }
}
```

---

### 49. delete_moisture_reading

Delete a moisture reading.

```typescript
{
  type: "function",
  name: "delete_moisture_reading",
  description: "Delete a moisture reading.",
  parameters: {
    type: "object",
    properties: {
      readingId: { type: "number", description: "ID of the moisture reading to delete" }
    },
    required: ["readingId"]
  }
}
```

---

### 50. add_water_classification

Records IICRC water damage classification for the session. Drives companion auto-addition (DEM, MIT) and water-aware depreciation (0% for Category 3).

```typescript
{
  type: "function",
  name: "add_water_classification",
  description: "Records IICRC water damage classification for the session. Use for water peril claims to capture source, contamination level, and drying feasibility. This drives companion auto-addition (DEM, MIT) and water-aware depreciation (0% for Category 3, MIT, DRY).",
  parameters: {
    type: "object",
    properties: {
      waterSource: { type: "string", description: "Source of water, e.g., 'supply line break', 'washing machine overflow', 'sewer backup', 'rain/flood'" },
      affectedArea: { type: "number", description: "Approximate affected area in square feet" },
      visibleContamination: { type: "boolean", description: "Whether visible contamination (discoloration, odor, growth) is present" },
      standingWaterStart: { type: "string", description: "When water first appeared (ISO date or description)" },
      standingWaterEnd: { type: "string", description: "When water was removed (ISO date or description)" },
      notes: { type: "string", description: "Additional notes about the water damage" }
    },
    required: ["waterSource", "visibleContamination"]
  }
}
```

---

### 51. get_completeness

Returns a comprehensive completeness analysis for the current inspection.

```typescript
{
  type: "function",
  name: "get_completeness",
  description: "Returns a comprehensive completeness analysis for the current inspection. Includes overall score, scope gaps (rooms with damage but no line items), missing photo documentation, peril-specific checks, and AI recommendations. Call this before phase transitions, before finalizing, or when the adjuster asks how things are looking.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
}
```

---

### 52. request_phase_validation

Explicitly requests a phase validation check for the current phase before transitioning.

```typescript
{
  type: "function",
  name: "request_phase_validation",
  description: "Explicitly requests a phase validation check for the current phase before transitioning. Returns warnings, missing items, and a completion score. The adjuster can choose to address warnings or proceed anyway. Call this before suggesting a phase change, or when the adjuster asks 'are we ready to move on?'",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
}
```

---

### 53. complete_inspection

Finalizes the inspection. Triggers completeness validation and prepares for review.

```typescript
{
  type: "function",
  name: "complete_inspection",
  description: "Finalizes the inspection. Triggers completeness validation and prepares for review. Call when the adjuster says they are done or wants to wrap up.",
  parameters: {
    type: "object",
    properties: {
      notes: { type: "string", description: "Any final notes from the adjuster" }
    }
  }
}
```

---

## Summary Statistics

- **Total tools**: 53
- **Context & Navigation**: 7
- **Structure Management**: 3
- **Room Management**: 10
- **Openings**: 3
- **Sketch Annotations**: 1
- **Damage Observations**: 4
- **Scope & Line Items**: 12
- **Photos**: 3
- **Forensics — Hail**: 3
- **Forensics — Moisture/Water**: 4
- **Completeness & Validation**: 3

Source file: `server/realtime.ts` (lines 670–1479)
