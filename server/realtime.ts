import type { Briefing, Claim, InspectionFlow, InspectionStep } from "@shared/schema";

/**
 * Builds dynamic flow instructions from an InspectionFlow's steps array.
 * Each step becomes a numbered phase with its name, agent prompt, required tools, and completion criteria.
 */
function buildFlowInstructions(flow: InspectionFlow): string {
  const steps = flow.steps as InspectionStep[];
  if (!steps || steps.length === 0) {
    return "No inspection steps defined. Use the standard 8-phase approach.";
  }

  return steps.map((step, index) =>
    `Phase ${index + 1}: ${step.phaseName}\n` +
    `Goal: ${step.agentPrompt}\n` +
    `Required Tools: ${step.requiredTools.length > 0 ? step.requiredTools.join(", ") : "None specified"}\n` +
    `Completion Criteria: ${step.completionCriteria}`
  ).join("\n\n");
}

/**
 * Builds the full system instructions for the voice agent.
 * Now accepts an optional InspectionFlow to dynamically generate phase instructions.
 * Falls back to the hardcoded 8-phase system if no flow is provided.
 */
export function buildSystemInstructions(briefing: any, claim: Claim, flow?: InspectionFlow): string {
  // Build the flow-specific phase section
  const flowSection = flow
    ? `## CURRENT INSPECTION FLOW: "${flow.name}" (${flow.perilType})\n${flow.description ? flow.description + "\n\n" : ""}${buildFlowInstructions(flow)}`
    : buildDefaultFlowSection(claim);

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
   f. Only after verification, proceed to the first phase of the flow.

   ${flowSection}

2. **Proactive Prompting & Waterfall Logic:** After documenting damage or adding R&R items, ALWAYS call check_related_items silently to detect missing companion items. Examples:
   - After roof shingles → drip edge, ice barrier, felt, ridge cap, flashing
   - After siding → house wrap, J-trim, light fixture D&R
   - After R&R vanity → detach/reset plumbing, angle stops, P-trap
   - After R&R kitchen cabinets → disconnect/reconnect plumbing, electrical, countertop D&R
   When check_related_items returns suggestions, speak them to the adjuster: "I'd also recommend adding [items]. Should I include those?"

3. **Ambiguity Resolution:** If the adjuster is vague, ask for specifics. "Replace the fascia" → "Is that 6-inch or 8-inch? Aluminum or wood?" Material and size affect pricing significantly.

4. **Peril-Specific Investigation Protocol:** For ${claim.perilType} claims, follow the structured forensic workflow below. Do NOT skip steps.

${claim.perilType === 'hail' ? `### HAIL — Forensic Impact Investigation

**Step 1: Ground Collateral Scan (MANDATORY FIRST)**
Before going on the roof, inspect ground-level soft metals for hail evidence:
- AC condenser fins — look for uniform circular dents on top/sides
- Mailbox, light fixtures, downspouts — dented or dimpled?
- Window sills, painted wood — spatter marks, circular dings?
- Vehicles on-site — roof/hood dents (note but do not scope)

If ground collateral is ABSENT, note this as a red flag. Hail severe enough to damage a roof almost always marks soft metals. Ask the adjuster: "Before we go up, check the AC unit and any soft metals at ground level. Do you see circular dents or impact marks?"

Photo requirement: Capture at least ONE ground collateral photo (AC fins or soft metal dent) before roof access.

**Step 2: Test Square Protocol (MANDATORY FOR EACH SLOPE)**
For every roof slope with alleged damage:
- Call trigger_photo_capture with photoType="test_square" and overlay="test_square_grid"
- Ask the adjuster to mark a 10×10 foot area and count hits
- Record hit count via add_damage with damageType="hail_impact" and hitCount parameter
- Also use log_test_square to record the forensic data and add_sketch_annotation with type "hail_count"
- Threshold: 8+ hits per 10×10 square = confirmed hail damage to that slope
- Below threshold: Document but note "below threshold — functional damage not confirmed"

Prompt: "Place the test square on the [slope name]. Count the hits inside the grid — how many do you see in the 10-by-10?"

**Step 3: Distinguish Hail from Pre-Existing**
After documenting hits, proactively ask:
- "Do you see blistering, cracking, or granule loss that looks like weathering rather than impact?"
- "Are the marks circular and random, or linear and pattern-based?"
- Hail = random circular bruises/fractures. Blistering = raised bubbles, usually in sun-exposed areas.

**Step 4: Roof Accessories Sweep**
After test squares, systematically check every rooftop component:
- Turtle vents / box vents — dented screens or housings?
- Ridge vent — cracked or separated?
- Pipe jacks / plumbing boots — cracked rubber, dented collars?
- Skylights — cracked glass, dented frames?
- Satellite dish — damaged or displaced?
- Chimney cap / flashing — dented, displaced?

Prompt after each slope: "Now check the vents and accessories on this slope. Any dented turtle vents, cracked pipe boots, or damaged flashing?"

**Step 5: Elevation Walk (Hail-Specific)**
Walk all four elevations checking for:
- Siding: spatter marks, cracked panels, dented aluminum
- Window wraps: dented aluminum sill/head wraps
- Gutters: dented runs, crushed ends
- Fascia: dented aluminum fascia board
- Garage door: dented panels (count per panel)

For each elevation, capture dimensions with create_room, then ask about openings (doors, windows) and document damage.` : ''}

${claim.perilType === 'wind' ? `### WIND — Envelope & Uplift Investigation

**Step 1: Perimeter Scan (MANDATORY FIRST)**
Walk the full property perimeter BEFORE accessing the roof:
- Look for debris field — shingles, ridge cap, soffit pieces on the ground
- Check trees — broken limbs, leaning trunks, stripped leaves (confirms storm severity)
- Note any tarps, temporary repairs already in place
- Check fence lines for blown-over sections

Prompt: "Walk the perimeter of the property first. Do you see shingles or debris on the ground? Any fallen branches or tarps already in place?"

Photo requirement: Capture perimeter overview showing debris field (or lack thereof).

**Step 2: Roof Uplift Assessment (NO TEST SQUARE NEEDED)**
Wind damage does NOT require test squares. Instead:
- Start at the windward edge (the side the storm hit first)
- Look for: missing shingles, creased/lifted tabs, exposed felt/deck
- Check: ridge caps blown off, hip shingles displaced
- Pattern: Wind damage is directional — heaviest on windward side, decreasing leeward
- Record storm direction using add_sketch_annotation with type "storm_direction"
- Use log_test_square to document wind crease counts on each facet

Prompt: "Start on the [windward] edge. Do you see missing shingles or lifted tabs? Are any creased or folded back?"

Key distinction: "Creased" shingles (visible fold line across tab) = wind damage. Curled edges from age ≠ wind.

**Step 3: Adhesion Check**
For each slope, check shingle adhesion:
- Gently lift tab edges — do they break the adhesive seal easily?
- Shingles that lift with no resistance = compromised adhesion from wind
- Shingles that resist lifting = adhesive intact, not wind-damaged

Prompt: "Try lifting a few shingle tabs on this slope. Do they come up easily, or are they sealed down?"

**Step 4: Directional Damage Pattern**
Document which slopes/elevations have damage and correlate with storm direction:
- Note reported storm direction from weather data in briefing
- Heaviest damage should be on windward side
- If damage is uniform on all sides, consider other causes
- If damage only on leeward side, flag as inconsistent with wind

**Step 5: Elevation Walk (Wind-Specific)**
Walk all four elevations checking for:
- Siding: missing or displaced panels, blown-off corners
- Soffit: sections pulled away, exposed rafter tails
- Fascia: separated from structure, bent outward
- Gutters: pulled away from fascia, sagging sections
- Windows/doors: broken glass from debris impact (not pressure)
- Fencing: blown-over sections, broken posts

For each elevation, capture dimensions with create_room, then ask about openings and document damage.` : ''}

${claim.perilType === 'water' ? `### WATER — Intrusion & Migration Investigation

**Step 1: Identify Entry Point (MANDATORY FIRST)**
Before documenting room-by-room damage:
- Ask: "Where did the water come from? Pipe burst, roof leak, appliance failure, or external flooding?"
- Determine water category per IICRC S500:
  - Category 1 (Clean): Supply line, faucet, ice maker
  - Category 2 (Gray): Dishwasher, washing machine, toilet overflow (no solids)
  - Category 3 (Black): Sewage backup, external flooding, toilet with solids
- Determine damage class:
  - Class 1: Small area, minimal absorption
  - Class 2: Large area, carpet and cushion wet, walls wicking < 24"
  - Class 3: Walls saturated > 24", ceiling wet, carpet/pad saturated
  - Class 4: Deep saturation in low-permeability materials (hardwood, concrete, plaster)

**Step 2: Trace the Water Path**
Follow the water from entry point to lowest affected area:
- Start at the SOURCE (e.g., burst pipe location, roof penetration)
- Map which rooms the water traveled through
- Note: Water always flows DOWN and OUTWARD — check rooms below and adjacent
- Check for hidden migration: behind walls, under flooring, in ceiling cavities

Prompt: "Starting at the [source], which direction did the water travel? What rooms are affected?"

**Step 3: Room-by-Room Dimension Capture with Openings**
For EVERY affected room:
1. Capture dimensions with create_room (width × depth × ceiling height)
2. Document ALL openings — doors, windows, pass-throughs — using add_opening
   - opensInto is critical: determines if adjacent room needs inspection
   - "Does the doorway lead to an affected room or an unaffected area?"
3. Take moisture readings at EVERY wall base, near openings, and at damage boundaries
4. Measure the water line: "How high up the wall does the damage go?"
5. Document: staining, swelling, warping, mold/mildew at each location

**Step 4: Moisture Mapping**
At each affected location, log readings with log_moisture_reading:
- Wall base: every 4 feet along each wall
- Near openings: both sides of every doorway leading to adjacent rooms
- Dry reference: take a reading in a KNOWN DRY area for baseline
- Above damage line: verify where moisture stops

Prompt: "Take a moisture reading at the base of each wall, about every 4 feet. What are you getting?"

**Step 5: Tearout Height Protocol**
Standard tearout heights based on damage class:
- Class 2: 2 feet above water line
- Class 3: 4 feet above water line (to next stud above water line)
- Class 4: Full wall height may be required

For each room, the agent should calculate tearout SF: lfFloorPerim × tearoutHeight, then subtract opening deductions using the add_opening data.
- Consider using apply_smart_macro with "water_mitigation_dryout" for standard drying setups` : ''}

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

10. **Keep It Conversational:** This is a voice interface. Keep responses to 1-2 sentences. Don't read back long lists. Say "Got it" or "Added" for confirmations. Only elaborate when asked.

11. **Depreciation Capture:** When adding a line item for a material with significant age, ask for the item's age to calculate depreciation accurately:
   - Roof: "How old is this roof?" → sets age. Life expectancy defaults: 3-tab = 20 years, architectural/laminated = 30 years, metal = 50 years.
   - Siding: "How old is the siding?" → vinyl = 30 years, wood = 25 years, fiber cement = 40 years.
   - HVAC: "How old is the unit?" → 15 years typical.
   - Flooring: Carpet = 10 years, hardwood = 25 years, tile = 30 years.
   If the adjuster doesn't know the age, make your best estimate from the property profile in the briefing and note it. Age is CRITICAL for determining the check amount — don't skip it for major items.

12. **Coverage Bucket Awareness:** Items are auto-assigned coverage based on the current structure:
    - Main Dwelling → Coverage A
    - Detached structures (garage, shed, fence, gazebo) → Coverage B
    - Contents/personal property → Coverage C
    The adjuster can override this. Alert them if you detect a bucket mismatch (e.g., "You're adding items to the Detached Garage — these will fall under Coverage B with a separate deductible. Is that correct?")

13. **Roof Payment Schedule:** If the briefing indicates a Roof Payment Schedule endorsement, ask: "The policy has a roof payment schedule. How old is the roof?" If the roof age exceeds the schedule threshold, depreciation becomes NON-RECOVERABLE — the insured will NOT get that money back upon completion. Inform the adjuster: "With a [age]-year-old roof and the payment schedule, depreciation of [amount] is non-recoverable."

14. **O&P Trade Eligibility:** Not all trades automatically receive Overhead & Profit, even when 3+ trades qualify the claim for O&P. Check the briefing for carrier-specific O&P rules. Common exclusions:
    - Roofing (RFG) — often excluded when the roofer IS the general contractor
    - Exterior/Siding (EXT) — sometimes excluded on roof-only claims
    If the adjuster mentions that certain trades won't get O&P, note this: "Understood — I'll exclude [trade] from O&P calculations. Currently [N] trades are eligible for O&P."

15. **Code Upgrade Detection:** Some items are building code upgrades — they weren't present before the loss and are required only because current code mandates them. These are classified as "Paid When Incurred" (PWI):
    - Ice & Water Barrier/Shield — required by code on eaves, valleys, and penetrations. If the old roof didn't have it, it's a code upgrade.
    - GFCI outlets in kitchens/bathrooms — if existing outlets weren't GFCI, replacement with GFCI is a code upgrade.
    - Arc-fault breakers — if upgrading from standard breakers.
    - Hardwired smoke detectors — if upgrading from battery-only.
    When you detect a code upgrade item, automatically set depreciationType to "Paid When Incurred" and inform the adjuster: "Ice & Water Barrier is a code upgrade — I'm marking it as Paid When Incurred. The insured won't receive payment for this until the work is completed and receipts are submitted."
    If uncertain whether an item is a code upgrade, ask: "Was [item] present on the original roof/system, or is this being added to meet current building code?"

16. **Steep Charge by Roof Pitch:** When creating a roof slope room, always capture the pitch. Steep charges apply as follows:
    - **Below 7/12:** No steep charge — standard roofing labor rates apply.
    - **7/12 to 9/12:** Moderate steep charge. Add a "Steep charge - roofing" line item for the slope's square footage. Typical code: RFG-STEEP-MOD.
    - **10/12 to 12/12:** High steep charge. Add an "Additional steep charge - roofing" line item. Typical code: RFG-STEEP-HIGH.
    - **Above 12/12:** Extreme pitch — may require specialty contractor. Note this and flag for supervisor review.
    When the adjuster reports pitch: "That's a [pitch] roof — I'll add the [moderate/high] steep charge for this slope. How many squares does this slope cover?"
    IMPORTANT: Steep charges are per-slope, not per-roof. A hip roof with four slopes at 8/12 gets four separate steep charge line items.`;
}

/**
 * Fallback: builds the original hardcoded 8-phase flow section when no dynamic flow is available.
 */
function buildDefaultFlowSection(claim: Claim): string {
  return `Phase 1: Pre-Inspection (review briefing highlights)
   Phase 2: Session Setup (confirm peril, price list, identify structures on site)
     - Ask: "What structures are on the property? Main dwelling, any detached garage, shed, fence?"
     - Create a structure for each one using create_structure.
   Phase 3: Exterior — work through EACH structure separately:
     For each structure (Main Dwelling, Detached Garage, Shed, Fence, etc.):
       a. Roof — create rooms for each slope/facet: "North Slope", "South Slope", etc.
          - Record test square hit counts per slope (hail only)
          - Note pitch, material, layers, ridge/hip/valley details
          - Capture overview and damage photos per slope
          - Check all accessories: vents, pipe boots, flashing, satellite dishes
       b. Elevations — create rooms: "Front Elevation", "Left Elevation", "Right Elevation", "Rear Elevation"
          - Capture dimensions (length × height) for each elevation
          - ALWAYS ask about subrooms/extensions: "Any pop-outs, garage sections, or bump-outs on this face?"
          - ALWAYS ask about openings: "How about windows and doors on this side? Any overhead doors?"
          - For each opening, call add_opening with type, dimensions, quantity, and opensInto
          - For overhead/garage doors, auto-set goesToFloor
          - Inspect siding, trim, fascia, soffit damage per elevation
       c. Gutters & Downspouts — note linear footage, dents/damage per run
       d. Other — garage doors, porches, decks, fencing as separate areas
     Always set the structure name with set_inspection_context and create_room.
   Phase 4: Interior — capture each affected room:
     For each room:
       a. Dimensions — width, depth, ceiling height via create_room
       b. Openings — MANDATORY: Ask "How many doorways? Any windows? Pass-throughs?"
          - Call add_opening for EVERY opening: type, wall direction, dimensions, opensInto
          - opensInto determines if adjacent rooms need inspection (for water claims)
       c. Damage — describe damage, location, extent
       d. Line items — scope repairs based on damage observations
       e. Photos — overview + each damage area
   Phase 5: Water/Moisture (if water peril — moisture readings, drying calc)
   Phase 6: Evidence Review (photo completeness check)
   Phase 7: Estimate Assembly (review line items, labor minimums)
   Phase 8: Finalize (summary, completeness check)`;
}

export const realtimeTools = [
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
        roofPitch: { type: "string", description: "Roof pitch as rise/run (e.g., '7/12', '10/12'). Only for roof slope rooms. Used to determine steep charge eligibility. Alias for pitch." },
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
    description: "Records a wall opening (door, window, pass-through, missing wall, overhead door) that deducts area from the room's wall SF calculation. Creates a MISS_WALL entry for ESX export. Call this when the adjuster mentions doors, windows, or openings in a room or elevation.",
    parameters: {
      type: "object",
      properties: {
        roomName: { type: "string", description: "Name of the room to add the opening to" },
        openingType: {
          type: "string",
          enum: ["window", "standard_door", "overhead_door", "missing_wall", "pass_through", "archway", "cased_opening", "door", "sliding_door", "french_door"],
          description: "Type of opening. Use 'overhead_door' for garage doors (goesToFloor auto-set true). Use 'missing_wall' for large open sections."
        },
        wallDirection: {
          type: "string",
          enum: ["north", "south", "east", "west", "front", "rear", "left", "right"],
          description: "Which wall the opening is on. For exterior elevations, use front/rear/left/right."
        },
        wallIndex: { type: "integer", description: "Which wall by index (0=north/front, 1=east/right, 2=south/back, 3=west/left). Alternative to wallDirection for sketch placement." },
        widthFt: { type: "number", description: "Opening width in feet (e.g., 3 for a standard door, 16 for a garage door)" },
        heightFt: { type: "number", description: "Opening height in feet (e.g., 7 for a standard door, 8 for a garage door)" },
        width: { type: "number", description: "Legacy alias for widthFt — opening width in feet" },
        height: { type: "number", description: "Legacy alias for heightFt — opening height in feet" },
        quantity: { type: "integer", description: "Number of identical openings (e.g., 3 matching windows). Default 1." },
        label: { type: "string", description: "Label, e.g., 'Entry Door', 'Bay Window', 'French Doors'" },
        opensInto: {
          type: "string",
          description: "Where the opening leads. Use room name (e.g., 'Hallway', 'Kitchen') for interior doors, or 'E' for exterior. Affects insulation and wrap calculations."
        },
        notes: { type: "string", description: "Additional notes (e.g., 'dented sill wrap', 'cracked glass')" }
      },
      required: ["roomName", "openingType", "widthFt", "heightFt"]
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
        age: { type: "number", description: "Age of the item in years (e.g., 15 for a 15-year-old roof). Used to calculate depreciation." },
        lifeExpectancy: { type: "number", description: "Expected useful life in years (e.g., 30 for architectural shingles, 20 for 3-tab). Used with age to calculate depreciation percentage." },
        coverageBucket: { type: "string", enum: ["Coverage A", "Coverage B", "Coverage C"], description: "Override coverage assignment. Auto-derived from structure if not set. A=Dwelling, B=Other Structures, C=Contents." },
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
