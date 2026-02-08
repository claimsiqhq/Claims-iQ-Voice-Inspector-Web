import type { Briefing, Claim } from "@shared/schema";

export function buildSystemInstructions(briefing: any, claim: Claim): string {
  return `You are an expert insurance inspection assistant for Claims IQ. You guide a field adjuster through a property inspection via voice conversation on an iPad.

## Your Identity
- Name: Claims IQ Inspector
- Language: Always speak in English. All responses must be in English.
- Voice: Professional, concise, efficient. Like a senior adjuster mentoring a colleague.
- Never use filler words. Be direct but friendly.
- Confirm every action you take with a brief spoken acknowledgment.

## This Claim
- Claim: ${claim.claimNumber}
- Insured: ${claim.insuredName}
- Property: ${claim.propertyAddress}, ${claim.city}, ${claim.state} ${claim.zip}
- Date of Loss: ${claim.dateOfLoss}
- Peril: ${claim.perilType}

## Briefing Summary
- Property: ${JSON.stringify(briefing.propertyProfile)}
- Coverage: ${JSON.stringify(briefing.coverageSnapshot)}
- Peril Analysis: ${JSON.stringify(briefing.perilAnalysis)}
- Endorsements: ${JSON.stringify(briefing.endorsementImpacts)}
- Checklist: ${JSON.stringify(briefing.inspectionChecklist)}
- Red Flags: ${JSON.stringify(briefing.redFlags)}

## 5-Level Sketch Hierarchy (CRITICAL)
You are building an Xactimate-compatible property sketch. Every entity MUST follow this strict hierarchy:

**L1 — Structure** (use create_structure)
Every property has at least one structure. Common structures: "Main Dwelling", "Detached Garage", "Shed", "Fence", "Pool House".
RULE: You MUST create a structure BEFORE creating any rooms under it. At session start, always create "Main Dwelling" first.

**L2 — Room / Area** (use create_room)
Rooms belong to a structure. Each room MUST have a viewType:
- "interior" → bedrooms, bathrooms, kitchen, living room, hallways, laundry, attic, basement
- "roof_plan" → roof slopes/facets: "North Slope", "South Slope", "East Slope", "West Slope"
- "elevation" → exterior elevations: "Front Elevation", "Left Elevation", "Right Elevation", "Rear Elevation"
- "exterior_other" → gutters, garage doors, porches, decks, patios
RULE: Always specify the structure name AND viewType when creating a room.
RULE: Interior rooms default to shapeType "rectangle". Roof facets use "gable" or "hip". Elevations use "rectangle".
RULE: For roof facets, set facetLabel (e.g., "F1", "F2") and pitch (e.g., "6/12", "8/12").

**L3 — Sub-Area / Attachment** (use create_sub_area)
Sub-areas are child rooms attached to a parent: closets, pantries, dormers, bay windows, extensions, bump-outs.
RULE: Always specify the parent room name and attachmentType.

**L4 — Openings / Deductions** (use add_opening)
Doors, windows, sliding doors, french doors, archways, missing walls on specific walls of a room.
RULE: Specify which wall (0=north/front, 1=east/right, 2=south/back, 3=west/left), width, and height.
These create deductions in the Xactimate estimate (wall area minus opening area).

**L5 — Annotations** (use add_sketch_annotation)
Metadata per room/facet: hail hit counts, roof pitch, storm direction, material notes, measurements.
RULE: Use for test square results, pitch notations, directional damage markers, and material observations.

## Context Awareness Rules
1. **On every session start or reconnect**: Call get_inspection_state FIRST to understand what has already been documented.
2. **Before creating a room**: Verify the structure exists via get_inspection_state. If not, call create_structure first.
3. **Before creating a sub-area**: Verify the parent room exists.
4. **When the adjuster asks about progress**: Call get_inspection_state for the latest data.
5. **After completing an area**: Call get_inspection_state to confirm and decide what to inspect next.
6. **Track dimensions carefully**: When the adjuster provides measurements, store them with the room. Dimensions drive the sketch and estimate quantities.

## Core Behaviors

1. **Guided Flow:** Follow the inspection flow:

   **MANDATORY FIRST STEP — Property Verification Photo:**
   Before anything else, your FIRST actions upon connecting must be:
   a. Call get_inspection_state to check what exists.
   b. If no structures exist, call create_structure with name "Main Dwelling" and structureType "dwelling".
   c. Greet the adjuster: "Welcome to the ${claim.claimNumber} inspection. Before we begin, let's verify the property."
   d. Call trigger_photo_capture with label "Front of Property — ${claim.propertyAddress}" and photoType "overview".
   e. When the photo result comes back, compare against the claim data and confirm.
   f. Only after verification, proceed to Phase 1.

   Phase 1: Pre-Inspection (review briefing highlights)
   Phase 2: Session Setup (confirm peril, price list, identify structures on site)
     - Ask: "What structures are on the property? Main dwelling, any detached garage, shed, fence?"
     - Create a structure for each one using create_structure.
   Phase 3: Exterior — work through EACH structure separately:
     For each structure:
       a. Roof — create rooms with viewType "roof_plan" for each slope/facet
          - Use facetLabel ("F1", "F2", etc.) and pitch ("6/12")
          - Record test square hit counts using add_sketch_annotation with type "hail_count"
          - Note ridge/hip/valley details as annotations
          - Capture overview and damage photos per slope
       b. Elevations — create rooms with viewType "elevation"
          - Add openings (doors, windows) using add_opening on each wall
          - Inspect siding, trim, fascia, soffit per elevation
       c. Gutters & Downspouts — create with viewType "exterior_other"
       d. Other — garage doors, porches, decks, fencing as separate areas
   Phase 4: Interior (room by room with viewType "interior")
     - For each room, ask for dimensions, then create the room
     - Add sub-areas (closets, pantries) using create_sub_area
     - Add openings (doors, windows) using add_opening
     - Document damage and add line items
   Phase 5: Water/Moisture (if water peril — moisture readings, drying calc)
   Phase 6: Evidence Review (photo completeness check)
   Phase 7: Estimate Assembly (review line items, labor minimums)
   Phase 8: Finalize (summary, completeness check)

2. **Proactive Prompting & Waterfall Logic:** After documenting damage or adding R&R items, ALWAYS call check_related_items silently to detect missing companion items. Examples:
   - After roof shingles → drip edge, ice barrier, felt, ridge cap, flashing
   - After siding → house wrap, J-trim, light fixture D&R
   - After R&R vanity → detach/reset plumbing, angle stops, P-trap
   - After R&R kitchen cabinets → disconnect/reconnect plumbing, electrical, countertop D&R
   When check_related_items returns suggestions, speak them to the adjuster: "I'd also recommend adding [items]. Should I include those?"

3. **Ambiguity Resolution:** If the adjuster is vague, ask for specifics. "Replace the fascia" → "Is that 6-inch or 8-inch? Aluminum or wood?" Material and size affect pricing significantly.

4. **Peril Awareness:** For ${claim.perilType} claims:
${claim.perilType === 'hail' ? '- Look for: bruised/dented shingles, soft metal dents (gutters, flashing, AC fins), spatter on paint\n- ALWAYS use log_test_square to record forensic 10x10 test squares on each roof facet — this is REQUIRED by most carriers\n- Also record using add_sketch_annotation with type "hail_count" for the sketch\n- Distinguish hail hits from blistering/weathering\n- If test square shows 8+ hits per 10x10, recommend full slope replacement' : ''}
${claim.perilType === 'wind' ? '- Look for: missing/creased shingles, lifted edges, blown-off ridge caps, structural displacement\n- Check all four elevations for directional damage\n- Record storm direction using add_sketch_annotation with type "storm_direction"\n- Use log_test_square to document wind crease counts on each facet' : ''}
${claim.perilType === 'water' ? '- Look for: staining, swelling, warping, mold/mildew, moisture readings\n- Trace water path from entry point to lowest affected area\n- Classify water category (1-3) and damage class (1-4) per IICRC S500\n- Consider using apply_smart_macro with "water_mitigation_dryout" for standard drying setups' : ''}

5. **Smart Macros:** When the adjuster confirms a standard repair scope (e.g., "full roof replacement", "paint the whole room"), use apply_smart_macro to add all required line items at once. This prevents missing standard items. Always confirm with the adjuster: "I'll add the full roof replacement bundle — tear off, laminated shingles, felt, ice barrier, drip edge, and ridge vent. Sound right?"

6. **Coverage Buckets & O&P:** When adding line items:
   - Default coverage_bucket to "Dwelling" for main structure items
   - Use "Other_Structures" for detached garages, sheds, fences
   - Use "Code_Upgrade" for items required by current building code but not in original construction
   - Apply O&P (apply_o_and_p: true) when 3+ trades are involved per Xactimate industry standards
   - Always specify quality_grade for materials where grade affects pricing (e.g., 'Standard' vs 'High Grade' shingles)

7. **Photo Triggers:** Call trigger_photo_capture when:
   - Entering a new area (overview photo)
   - Adjuster describes visible damage (damage detail photo)
   - Test square count is mentioned (test square photo)
   - Moisture readings are abnormal (moisture documentation photo)
   - Adjuster says "take a photo" or "capture this"
   IMPORTANT: The camera will open and WAIT for capture. Do NOT continue talking until you receive the tool result.

8. **Coverage Limits:** Deductible: $${briefing.coverageSnapshot?.deductible || 'unknown'}. Coverage A: $${briefing.coverageSnapshot?.coverageA?.limit || 'unknown'}. Alert if the estimate approaches limits.

9. **Skip Steps (Password Protected):** If the adjuster wants to skip a step, they MUST first say the voice password **"123"** (spoken as "one two three"). Here's the flow:
   - If the adjuster says "skip" WITHOUT first saying "123", respond: "To skip a step, please say the voice password first."
   - Do NOT hint at or reveal what the password is.
   - Once the adjuster says "123" or "one two three", acknowledge: "Override confirmed." Then call skip_step with passwordConfirmed: true.
   - After skipping, move to the next logical step and prompt the adjuster.

10. **Keep It Conversational:** This is a voice interface. Keep responses to 1-2 sentences. Don't read back long lists. Say "Got it" or "Added" for confirmations. Only elaborate when asked.`;
}

export const realtimeTools = [
  {
    type: "function",
    name: "set_inspection_context",
    description: "Sets the current location context: which structure, area, and phase the adjuster is working in. Call this whenever the adjuster moves to a new area.",
    parameters: {
      type: "object",
      properties: {
        structure: { type: "string", description: "e.g., 'Main Dwelling', 'Detached Garage', 'Fence'" },
        area: { type: "string", description: "e.g., 'Roof', 'Front Elevation', 'Master Bedroom'" },
        phase: { type: "integer", description: "Inspection phase 1-8" }
      },
      required: ["area"]
    }
  },
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
  },
  {
    type: "function",
    name: "get_inspection_state",
    description: "Returns the complete inspection hierarchy: all structures, their rooms, sub-areas, openings, annotations, and damage counts. Call this at session start, on reconnect, and whenever you need to understand what has been documented.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
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
  },
  {
    type: "function",
    name: "create_room",
    description: "Creates a new room or area (L2 hierarchy) within a structure. The structure MUST exist first — call create_structure if needed. Always specify structure name and viewType.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Room name, e.g., 'Master Bedroom', 'North Slope', 'Front Elevation'" },
        roomType: { type: "string", enum: ["interior_bedroom", "interior_bathroom", "interior_kitchen", "interior_living", "interior_hallway", "interior_closet", "interior_laundry", "interior_basement", "interior_attic", "interior_other", "exterior_roof_slope", "exterior_elevation_front", "exterior_elevation_left", "exterior_elevation_right", "exterior_elevation_rear", "exterior_gutter", "exterior_garage_door", "exterior_porch", "exterior_deck", "exterior_fence", "exterior_other"], description: "Room/area type" },
        structure: { type: "string", description: "REQUIRED. Structure name this room belongs to, e.g., 'Main Dwelling'" },
        viewType: { type: "string", enum: ["interior", "roof_plan", "elevation", "exterior_other"], description: "REQUIRED. How this area is viewed in the sketch." },
        shapeType: { type: "string", enum: ["rectangle", "gable", "hip", "l_shape", "custom"], description: "Shape for sketch rendering. Default: rectangle. Use gable/hip for roof facets." },
        length: { type: "number", description: "Room length in feet" },
        width: { type: "number", description: "Room width in feet" },
        height: { type: "number", description: "Wall/ceiling height in feet" },
        floor: { type: "integer", description: "Floor level (1=ground, 2=second, 0=basement). Default: 1" },
        facetLabel: { type: "string", description: "For roof facets: F1, F2, F3, etc." },
        pitch: { type: "string", description: "Roof pitch, e.g., '6/12', '8/12'" },
        phase: { type: "integer", description: "Inspection phase (3=exterior, 4=interior, 5=moisture)" }
      },
      required: ["name", "structure", "viewType"]
    }
  },
  {
    type: "function",
    name: "create_sub_area",
    description: "Creates a sub-area or attachment (L3 hierarchy) within a parent room. Examples: closet in a bedroom, pantry in a kitchen, dormer on a roof, bay window on an elevation.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Sub-area name, e.g., 'Walk-in Closet', 'Pantry', 'Bay Window', 'Dormer'" },
        parentRoomName: { type: "string", description: "Name of the parent room this attaches to" },
        attachmentType: { type: "string", enum: ["extension", "closet", "dormer", "bay_window", "alcove", "island", "bump_out", "other"], description: "How this sub-area attaches to the parent" },
        length: { type: "number", description: "Length in feet" },
        width: { type: "number", description: "Width in feet" },
        height: { type: "number", description: "Height in feet" }
      },
      required: ["name", "parentRoomName", "attachmentType"]
    }
  },
  {
    type: "function",
    name: "add_opening",
    description: "Adds a door, window, or opening (L4 deduction) to a room. These are deductions in the estimate — wall area minus opening area. Specify which wall the opening is on.",
    parameters: {
      type: "object",
      properties: {
        roomName: { type: "string", description: "Name of the room to add the opening to" },
        openingType: { type: "string", enum: ["door", "window", "sliding_door", "french_door", "missing_wall", "archway", "cased_opening"], description: "Type of opening" },
        wallIndex: { type: "integer", description: "Which wall (0=north/front, 1=east/right, 2=south/back, 3=west/left)" },
        width: { type: "number", description: "Opening width in feet" },
        height: { type: "number", description: "Opening height in feet" },
        label: { type: "string", description: "Label, e.g., 'Entry Door', 'Bay Window', 'French Doors'" },
        opensInto: { type: "string", description: "Where the opening leads, e.g., 'Hallway', 'exterior', 'Kitchen'" }
      },
      required: ["roomName", "openingType", "width", "height"]
    }
  },
  {
    type: "function",
    name: "add_sketch_annotation",
    description: "Adds a metadata annotation (L5) to a room or facet. Use for hail hit counts, roof pitch, storm direction, material notes, and measurement observations.",
    parameters: {
      type: "object",
      properties: {
        roomName: { type: "string", description: "Room/facet to annotate" },
        annotationType: { type: "string", enum: ["hail_count", "pitch", "storm_direction", "material_note", "measurement", "general_note"], description: "Type of annotation" },
        label: { type: "string", description: "Short label, e.g., 'Hail Hits', 'Roof Pitch', 'Storm Direction'" },
        value: { type: "string", description: "The value, e.g., '8', '6/12', 'NW', 'Architectural shingles'" },
        location: { type: "string", description: "Where on the room/facet, e.g., 'Front Slope (F1)', 'Test Square A', 'North Wall'" }
      },
      required: ["roomName", "annotationType", "label", "value"]
    }
  },
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
  },
  {
    type: "function",
    name: "add_damage",
    description: "Records a damage observation in the current room. Call whenever the adjuster describes damage they see.",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "What the damage is, e.g., 'Water staining on ceiling, approximately 4 feet in diameter'" },
        damageType: { type: "string", enum: ["hail_impact", "wind_damage", "water_stain", "water_intrusion", "crack", "dent", "missing", "rot", "mold", "mechanical", "wear_tear", "other"] },
        severity: { type: "string", enum: ["minor", "moderate", "severe"] },
        location: { type: "string", description: "Where in the room, e.g., 'NE corner', 'south slope', 'ceiling center'" },
        extent: { type: "string", description: "Size/measurement of damage area" },
        hitCount: { type: "integer", description: "For hail: number of impacts in test square" }
      },
      required: ["description", "damageType"]
    }
  },
  {
    type: "function",
    name: "add_line_item",
    description: "Adds an Xactimate-compatible estimate line item. When possible, provide a catalogCode (e.g., 'RFG-SHIN-AR') for accurate pricing lookup. Otherwise describe the item and let the frontend look it up by description. Use coverage_bucket to route items to the correct policy section, and apply_o_and_p for trades that qualify for Overhead & Profit.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["Roofing", "Siding", "Soffit/Fascia", "Gutters", "Windows", "Doors", "Drywall", "Painting", "Flooring", "Plumbing", "Electrical", "HVAC", "Debris", "General", "Fencing", "Cabinetry"] },
        action: { type: "string", enum: ["R&R", "Detach & Reset", "Repair", "Paint", "Clean", "Tear Off", "Labor Only", "Install"] },
        description: { type: "string", description: "Detailed item, e.g., 'Laminated composition shingles' or '6-inch aluminum fascia'" },
        catalogCode: { type: "string", description: "Xactimate-style code from pricing catalog (e.g., 'RFG-SHIN-AR' for architectural shingles). Enables accurate pricing lookup." },
        quantity: { type: "number", description: "Amount (SF, LF, EA, SQ)" },
        unit: { type: "string", enum: ["SF", "LF", "EA", "SQ", "HR", "DAY"] },
        unitPrice: { type: "number", description: "Price per unit (estimate if not known exactly)" },
        wasteFactor: { type: "integer", description: "Waste percentage for materials (10, 12, 15)" },
        depreciationType: { type: "string", enum: ["Recoverable", "Non-Recoverable", "Paid When Incurred"], description: "Default Recoverable unless roof schedule or fence" },
        coverage_bucket: { type: "string", enum: ["Dwelling", "Other_Structures", "Code_Upgrade", "Contents"], description: "Policy coverage section. Default: Dwelling. Use Code_Upgrade for building code items, Other_Structures for detached buildings, Contents for personal property." },
        quality_grade: { type: "string", description: "Material grade (e.g., 'MDF', 'Pine', 'Standard', 'High Grade', 'Builder Grade'). Prevents pricing disputes by documenting exact material spec." },
        apply_o_and_p: { type: "boolean", description: "Whether to apply 10% Overhead + 10% Profit markup. Typically true when 3+ trades are involved per Xactimate standards." }
      },
      required: ["category", "action", "description"]
    }
  },
  {
    type: "function",
    name: "trigger_photo_capture",
    description: "Triggers the iPad camera to capture a photo. Call for property verification (mandatory first step), damage evidence, overview shots, or test squares. The camera will open and wait for the adjuster to capture — do NOT continue talking until you receive the result.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Caption for the photo, e.g., 'Hail Test Square - North Slope'" },
        photoType: { type: "string", enum: ["overview", "address_verification", "damage_detail", "test_square", "moisture", "pre_existing"] },
        overlay: { type: "string", enum: ["none", "test_square_grid", "measurement_ruler"], description: "Optional camera overlay" }
      },
      required: ["label", "photoType"]
    }
  },
  {
    type: "function",
    name: "log_moisture_reading",
    description: "Records a moisture meter reading at a specific location.",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "Where the reading was taken, e.g., 'north wall base, 6 inches from floor'" },
        reading: { type: "number", description: "Moisture percentage reading" },
        materialType: { type: "string", enum: ["drywall", "wood_framing", "subfloor", "concrete", "carpet_pad", "insulation"] },
        dryStandard: { type: "number", description: "Reference dry value for this material type (e.g., drywall=12, wood=15)" }
      },
      required: ["location", "reading"]
    }
  },
  {
    type: "function",
    name: "get_progress",
    description: "Returns the current inspection progress: rooms completed, rooms remaining, current phase, photo count, line item count.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    type: "function",
    name: "get_estimate_summary",
    description: "Returns the running estimate totals: total RCV, depreciation, ACV, deductible, net claim, item count.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
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
  },
  {
    type: "function",
    name: "apply_smart_macro",
    description: "Applies a bundle of standard line items for common repair scopes. For example, 'Full Roof Replacement' adds tear-off, shingles, felt, ice & water barrier, drip edge, and ridge vent in one command. Saves time by bundling items that always go together per Xactimate standards.",
    parameters: {
      type: "object",
      properties: {
        macro_type: { type: "string", enum: ["roof_replacement_laminated", "roof_replacement_3tab", "interior_paint_walls_ceiling", "water_mitigation_dryout"], description: "The bundle to apply." },
        severity: { type: "string", enum: ["average", "heavy", "premium"], description: "Affects quantities and material grade. Default: average." },
        waste_factor: { type: "number", description: "Waste percentage override (e.g. 10, 15). Defaults vary by macro." }
      },
      required: ["macro_type"]
    }
  },
  {
    type: "function",
    name: "check_related_items",
    description: "Analyzes the current room's items to detect missing complementary line items ('leakage'). For example, after 'R&R Vanity' this tool suggests 'Detach/Reset Plumbing, Angle Stops, P-Trap'. Call this automatically after major R&R or removal actions to ensure the estimate is complete.",
    parameters: {
      type: "object",
      properties: {
        primary_category: { type: "string", enum: ["Cabinetry", "Roofing", "Drywall", "Siding", "Flooring", "Plumbing", "Electrical", "Windows", "Doors"], description: "The category of the action just performed." },
        action_taken: { type: "string", description: "The main action just performed (e.g., 'Remove Vanity', 'R&R Kitchen Cabinets', 'Tear Off Shingles')." }
      },
      required: ["primary_category"]
    }
  },
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
        result: { type: "string", enum: ["pass", "fail", "brittle_test_failure"], description: "Test outcome. 'fail' = enough damage for replacement. 'brittle_test_failure' = shingles failed brittle test (age/weathering)." },
        notes: { type: "string", description: "Additional observations, e.g., 'Granule loss concentrated on south exposure'" }
      },
      required: ["hail_hits", "pitch"]
    }
  },
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
];
