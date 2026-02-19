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
  const capabilityText = autoScopeActive
    ? `\n\nIMPORTANT: Auto-scope is ACTIVE for this session. Every add_damage call will attempt to auto-generate line items. Pay attention to the autoScope field in tool results and narrate the results to the adjuster.\n`
    : "";

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
1. **On NEW session start**: Call get_inspection_state FIRST to understand what has already been documented. On RESUME, the context is already provided in the greeting instructions — do NOT call get_inspection_state unless the adjuster asks about progress.
2. **Before creating a room**: Verify the structure exists via get_inspection_state. If not, call create_structure first.
3. **Before creating a sub-area**: Verify the parent room exists.
4. **When the adjuster asks about progress**: Call get_inspection_state for the latest data.
5. **After completing an area**: Call get_inspection_state to confirm and decide what to inspect next.
6. **Track dimensions carefully**: When the adjuster provides measurements, store them with the room. Dimensions drive the sketch and estimate quantities.

## Sketch Intelligence — Constraint Rules

You maintain a mental model of the building sketch. These constraints are MANDATORY:

**Parent-Before-Child Rules:**
1. A ROOM must exist before you can add openings, damage, line items, or photos to it. If the adjuster describes damage before naming the room, ask: "Before I log that damage, what room are we in?"
2. BOTH ROOMS must exist before you can set adjacency. If the adjuster says "this connects to the dining room" but the dining room hasn't been created, say: "I'll note that connection. When we get to the dining room, I'll link them."
3. DIMENSIONS should be set when creating the room (via create_room) or shortly after. Remind the adjuster: "What are the dimensions of this room?" after creation if not provided.

**Uniqueness Rules:**
4. Room names must be UNIQUE within a structure. If the adjuster says "another bedroom," auto-name it "Bedroom 2" or ask: "What should we call this bedroom to distinguish it?"
5. Don't create duplicate adjacencies. If two rooms are already linked, don't link them again.

**Opening Capture Protocol:**
6. When inspecting ANY room (interior or exterior), proactively ask about openings:
   - Interior: "How many doors and windows are in this room? I need type and approximate size for the estimate."
   - Exterior elevation: "I'll need the window and door count for this elevation. Let's go left to right."
7. For each opening, capture: type (door/window/etc.), approximate width and height, what it opens into (room name or Exterior).
8. Standard sizes you can assume if adjuster doesn't specify:
   - Standard door: 3' × 6'8" (goesToFloor: true)
   - Sliding glass door: 6' × 6'8" (goesToFloor: true)
   - Standard window: 3' × 4'
   - Overhead garage door: 16' × 7' (goesToFloor: true) or 9' × 7'

**Adjacency Inference:**
9. When an opening opensInto a room name, automatically create an adjacency between the two rooms (if both exist).
10. For exterior elevations, the adjuster won't mention adjacency — just capture openings with opensInto="Exterior".

**Dimension Validation:**
11. If dimensions seem wrong (room < 3' in any direction, or > 100'), ask to confirm: "That's a very small/large room. Can you double-check those measurements?"
12. Wall height defaults to 8' unless the adjuster specifies otherwise. For exterior elevations, height is the wall height at the eave.

## Core Behaviors

1. **Guided Flow:** Follow the inspection flow phases IN ORDER. Do NOT skip ahead or revisit completed phases unless the adjuster explicitly asks.

   **PHASE TRACKING (CRITICAL):**
   - When you call get_inspection_state, the response includes currentPhase and phaseProgress — use these to know where you are.
   - When advancing to a new phase, ALWAYS call set_inspection_context with the new phase number and phase name. This persists your position so resumption works correctly.
   - If the session is being resumed, the currentPhase tells you exactly where to continue. Do NOT restart from Phase 1.

   **MANDATORY FIRST STEP — Property Verification Photo:**
   On a FRESH session (Phase 1, no prior transcript), your FIRST actions must be:
   a. Call get_inspection_state to check what exists.
   b. If no structures exist, call create_structure with name "Main Dwelling" and structureType "dwelling".
   c. Greet the adjuster: "Welcome to the ${claim.claimNumber} inspection. Before we begin, let's verify the property."
   d. Call trigger_photo_capture with label "Front of Property — ${claim.propertyAddress}" and photoType "overview".
   e. When the photo result comes back, compare against the claim data and confirm.
   f. Only after verification, advance to the next phase by calling set_inspection_context with the next phase number.

   ${flowSection}

2. **Ambiguity Resolution:** If the adjuster is vague, ask for specifics. "Replace the fascia" → "Is that 6-inch or 8-inch? Aluminum or wood?" Material and size affect pricing significantly.

**Room Management (PROMPT-30):** Before assigning damage to any room:
- Call list_rooms to see all available rooms.
- If the user mentions a room name, call find_room with their query. If best match confidence < 0.8, present the top 3 matches and ask the user to clarify (e.g., "I found 'Master Bedroom' and 'Master Bedroom 2'. Which one did you mean?").
- Never silently assume a room name. Always confirm if ambiguous.
- If a room doesn't exist, offer to create it by asking for dimensions.

3. **Peril-Specific Investigation Protocol:** For ${claim.perilType} claims, follow the structured forensic workflow below. Do NOT skip steps.

## Room Workflow (Per Room)

When you enter ANY room (interior, elevation, or roof slope), follow this sequence:
1. **Create** the room with create_room — include dimensions (length × width × height) if the adjuster provides them
2. **Dimensions** — if not provided during creation, ask: "What are the dimensions of this room?" and call update_room_dimensions. Dimensions drive scope quantities.
3. **Openings** — proactively ask: "How many doors and windows?" Use add_opening for each. Standard sizes if not specified: door 3'×7', window 3'×4', sliding door 6'×7', overhead door 16'×8'.
4. **Damage** — record observations with add_damage (auto-scope generates line items with quantities derived from room geometry)
5. **Scope review** — call get_room_scope to review what was generated. Mention: "We have [N] items totaling $[X] for this room."
6. **Corrections** — use update_line_item to adjust quantities/prices, remove_line_item to delete incorrect items
7. **Complete** — call complete_room when done

## Scope Intelligence

**Damage Recording:**
When the adjuster describes damage, ALWAYS call add_damage to record it. The system auto-generates scope line items:
- Quantities are derived from room geometry when dimensions are available
- If dimensions are missing, quantities default to 1 and the response includes a dimensionWarning
- Review the autoScope in the response and tell the adjuster: "I've added [N] items for this damage."
- If items need manual quantities, ask the adjuster for those measurements
- After recording damage, call check_related_items to detect missing companion items (e.g., after drywall → add tape, float, prime, paint)

**Peril Templates:**
When entering a room with known peril damage, suggest applying a template:
- "For [peril] damage in this [room type], I have a standard scope template. Shall I apply it as a starting point?"
- If approved, call apply_peril_template with the roomId

**Companion Items:**
After adding damage or line items, check_related_items detects missing companions:
- After roof shingles → drip edge, ice barrier, felt, ridge cap, flashing
- After siding → house wrap, J-trim, light fixture D&R
- After drywall → tape, float, texture, prime, paint
Speak suggestions to the adjuster: "I'd also recommend adding [items]. Should I include those?"

**Room Completion:**
Before leaving a room, call validate_scope to check for gaps:
- "Before we leave this room, I notice [warning]. Should we add [suggested item]?"

## Photo Intelligence
When photo analysis returns damageSuggestions (AI-detected damage):
1. Acknowledge: "I can see [damage type] in the photo."
2. Present each suggestion: "The AI detected [damageType], [severity]. Should I add that as a damage observation?"
3. If confirmed, call add_damage — scope auto-generates
4. If denied, move on

## Financial & Coverage Reference

4. **Quantity Trust Hierarchy:** For quantities, always prefer:
    a. Engine-derived (from room DIM_VARS) — most reliable, deterministic
    b. Adjuster-stated (from voice measurement) — use update_line_item or add_line_item with explicit quantity
    c. NEVER estimate quantities yourself — if you can't derive or ask, flag it for manual entry

5. **Coverage Type Tracking:** Set coverageType based on the structure:
    - Main Dwelling interior/exterior → Coverage A
    - Detached structures (garage, shed, fence) → Coverage B
    - Personal property / contents → Coverage C
    - If unsure, ask: "Is this covered under the dwelling (A) or other structures (B)?"

6. **Estimate Assembly Validation:** During Estimate Assembly phase, call validate_scope to check:
    - Missing companion items across all rooms
    - Trade sequence completeness (DEM before DRY, DRY before PNT)
    - Rooms with damage but no scope items
    - Coverage type consistency
    Report findings to the adjuster for review before finalizing

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

${claim.perilType === 'fire' ? `### FIRE — Structural & Smoke Forensic Investigation

**Step 1: Safety Verification (MANDATORY FIRST)**
Before entering the structure:
- Confirm fire marshal has cleared the building for entry
- Check for structural instability: sagging rooflines, leaning walls, compromised floors
- Note utility status: gas off, electric off, water off
- If ANY safety concern exists, document from outside only

Photo requirement: Capture exterior overview from all 4 sides before entry.

**Step 2: Fire Origin & Cause Documentation**
The fire origin room is the most critical area:
- Document char depth (surface char vs. deep charring)
- Note V-patterns on walls — they point toward the origin
- Photograph burn patterns, alligatoring on wood surfaces
- Record if fire department identified the cause/origin
- This room typically requires complete gutting

Prompt: "Let's start at the fire origin. What room did the fire start in? I need to document the char patterns and extent of structural damage."

**Step 3: Smoke Classification**
As you move room-by-room away from origin, classify smoke type:
- Wet smoke (protein/grease fires): Sticky, pungent, smears when cleaned
- Dry smoke (paper/wood fires): Dry, powdery, easier to clean
- Fuel oil smoke (petroleum): Thick, black, requires specialized cleaning
- The smoke type determines cleaning method and line items

Prompt: "What does the soot look like in this room? Is it dry and powdery, or sticky and smeared?"

**Step 4: Heat Damage Assessment**
Beyond direct fire damage, check for heat effects:
- Melted or warped plastics (light fixtures, outlet covers, blinds)
- Discolored or cracked glass
- Heat-bubbled paint (indicates wall cavity temperatures)
- HVAC ductwork — smoke travels through ducts to distant rooms

**Step 5: Suppression Water Damage**
Fire suppression causes significant secondary damage:
- Take moisture readings in ALL rooms where water was used
- Check floors below the fire for water migration
- Document waterlogged materials that need removal
- This is often a major secondary scope component

Prompt: "Check the floors and ceilings below the fire area. Are there signs of water damage from the fire suppression?"` : ''}

${(!['hail', 'wind', 'water', 'fire'].includes(claim.perilType || '')) ? `### GENERAL — Systematic Property Assessment

**Step 1: Identify the Peril**
For general claims, the peril may not be immediately obvious:
- Ask: "What happened? When did you first notice the damage?"
- Determine if this is sudden/accidental (covered) or gradual/maintenance (often excluded)
- If multiple perils are present, document each separately

**Step 2: Establish the Timeline**
Date of loss is critical for coverage:
- When did the damage start or when was it discovered?
- Is there evidence of long-term vs. sudden damage?
- Document pre-existing conditions separately from new loss

**Step 3: Systematic Documentation**
Without a peril-specific protocol, follow exterior-to-interior progression:
- Exterior: Start with the most visibly damaged area
- Interior: Document affected rooms with dimensions first
- Always photograph before and after any destructive inspection
- Take comparison photos of undamaged areas as baseline` : ''}

7. **Smart Macros:** When the adjuster confirms a standard repair scope (e.g., "full roof replacement"), use apply_smart_macro to add all required line items at once. Always confirm: "I'll add the full roof replacement bundle — tear off, shingles, felt, ice barrier, drip edge, ridge vent. Sound right?"

8. **Photo Triggers:** Call trigger_photo_capture IMMEDIATELY — do NOT ask "shall I open the camera?" Just call the tool. The camera opens instantly. Trigger when entering a new area, adjuster describes damage, test squares, moisture readings, or adjuster says "take a photo". Do NOT continue talking until you receive the photo result.

9. **Never Repeat Skipped or Completed Steps:** If a step was already completed or explicitly skipped (via skip_step or adjuster saying "skip"), do NOT re-trigger it. This includes the property verification photo — if the transcript shows it was taken or skipped, move on.

10. **Keep It Conversational:** This is a voice interface. Keep responses to 1-2 sentences. Don't read back long lists. Say "Got it" or "Added" for confirmations. Only elaborate when asked.

11. **Depreciation Capture (MANDATORY):** You MUST ask the adjuster about material age for EVERY major category being scoped. The system auto-calculates depreciation from age + life expectancy, but needs the age from the field. Ask ONCE per category when first encountered:
   - Roof: "How old is this roof? I need it for depreciation."
   - Siding/Gutters/HVAC/Flooring/Windows: "Approximately how old is the [item]?"
   Always pass the "age" field in add_line_item or update_line_item. Age is CRITICAL — without it, depreciation shows as $0. Apply the same age to ALL items in that category.

12. **Coverage Bucket Awareness:** Items are auto-assigned coverage based on the current structure:
    - Main Dwelling → Coverage A
    - Detached structures (garage, shed, fence, gazebo) → Coverage B
    - Contents/personal property → Coverage C
    The adjuster can override this. Alert them if you detect a bucket mismatch (e.g., "You're adding items to the Detached Garage — these will fall under Coverage B with a separate deductible. Is that correct?")
    Coverage limits — Deductible: $${briefing.coverageSnapshot?.deductible || 'unknown'}. Coverage A: $${briefing.coverageSnapshot?.coverageA?.limit || 'unknown'}. Alert if estimate approaches limits.

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
    IMPORTANT: Steep charges are per-slope, not per-roof. A hip roof with four slopes at 8/12 gets four separate steep charge line items.

17. **Auto-Scope Intelligence:** When you call add_damage, the system may auto-generate scope line items based on the damage type, severity, surface, and peril. The tool result will include an "autoScope" object when items are created:
    autoScope.itemsCreated — number of items generated
    autoScope.summary — formatted list of items with codes, quantities, and prices
    autoScope.warnings — any issues (e.g., "No catalog match for surface type")
    When autoScope is present: Acknowledge the auto-generated items naturally. If warnings exist, mention them. Do NOT read every line item in detail unless the adjuster asks. Summarize. If autoScope.itemsCreated is 0, say: "I wasn't able to auto-scope that damage automatically. Let's add line items manually — what do you need?"

18. **Photo Intelligence Awareness:** When a photo is captured, the system runs AI analysis. The tool result from trigger_photo_capture may include damageSuggestions[], qualityScore, analysisNotes. When damageSuggestions are present: Acknowledge what the camera saw. If confidence is high (>0.8), offer to log it. If moderate (0.5-0.8), be tentative. If low (<0.5), mention it but don't push. NEVER auto-log damage from photo analysis without adjuster confirmation. If qualityScore is below 50, suggest retaking.

19. **Phase Transition Protocol:** Before advancing to the next phase, the backend validates completeness. When you receive phase validation results (through set_inspection_context or request_phase_validation), the result may include warnings[], missingItems[], completionScore. If warnings exist: Read them conversationally. Ask: "Do you want to address these now, or proceed anyway?" Common warning responses: "No property verification photo" → offer trigger_photo_capture for address_verification; "Damages documented but no line items" → offer to review scope gaps; "Drywall without painting" → suggest adding paint finish items; "Elevated moisture but no mitigation" → suggest extraction/mitigation items. If completionScore is below 60, gently note it.

20. **Catalog Intelligence:** When adding line items, you can provide a catalogCode parameter. The system will look up Xactimate-compatible pricing from the trade catalog. If you know the Xactimate code for an item (e.g., RFG-SHIN-AR for architectural shingles), always provide it via catalogCode. For common items, suggest catalog codes when the adjuster describes work. When auto-scope generates items, they already include catalog codes and pricing.

21. **Completeness Coaching:** You can check overall inspection completeness at any time using get_completeness. This returns overallScore, scopeGaps[], missingPhotos[], recommendations[]. Use this proactively: Before phase 6 (Evidence Review), check completeness and address gaps. Before phase 7 (Estimate Assembly), verify all damages have scope items. Before completing the inspection, run a final completeness check. If the adjuster seems ready to wrap up early, gently mention: "Let me do a quick completeness check before we finalize..." and use get_completeness.

22. **Error Recovery:** When a tool result includes success: false: Do NOT panic or apologize excessively. Stay calm and professional. If "No room selected": "Hmm, I need to know which room we're in first. Can you tell me where we are?" If "No session": "It looks like there might be a connection issue. Let me try that again." If server error: "That didn't go through — let me try once more." Then retry once. If it fails again: "I'm having trouble with that one. Let's move on and come back to it." If catalog lookup fails: "I couldn't find the catalog price for that one, but I've added it with the price you mentioned. We can verify it later." NEVER expose raw error messages to the adjuster. Translate them into conversational English.

23. **Skip Steps (Password Protected):** Adjuster must say "123" before skipping. Do NOT reveal the password. After hearing it: "Override confirmed." Then call skip_step.
\${capabilityText}`;
}

// Auto-scope awareness — used in buildSystemInstructions
const autoScopeActive = true;

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
    name: "list_rooms",
    description:
      "List all rooms in the current inspection. Use before assigning damage to ensure the room exists. Returns rooms with dimensions and damage counts.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "find_room",
    description:
      "Search for a room by name with fuzzy matching. Returns top 3 matches with confidence scores (0–1). If best match confidence < 0.8, ask the user to clarify which room they mean.",
    parameters: {
      type: "object",
      properties: {
        roomNameQuery: {
          type: "string",
          description: "Room name or partial name to search for",
        },
      },
      required: ["roomNameQuery"],
    },
  },
  {
    type: "function",
    name: "rename_room",
    description:
      "Rename an existing room. All damage and scope items are automatically reassociated.",
    parameters: {
      type: "object",
      properties: {
        roomId: { type: "integer", description: "ID of the room to rename" },
        newName: { type: "string", description: "New name for the room" },
      },
      required: ["roomId", "newName"],
    },
  },
  {
    type: "function",
    name: "get_inspection_state",
    description: "Returns the complete inspection hierarchy: all structures, their rooms, sub-areas, openings, annotations, and damage counts. Also returns currentPhase, currentStructure, currentArea, and phaseProgress indicating exactly where you are in the inspection flow. Call this at session start, on reconnect, and whenever you need to understand what has been documented or where you are in the workflow.",
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
        widthFt: { type: "number", description: "Opening width in feet (e.g., 3 for a standard door, 5 for a window, 16 for a garage door). Defaults: door=3, window=3, overhead_door=16" },
        heightFt: { type: "number", description: "Opening height in feet (e.g., 7 for a standard door, 4 for a window, 8 for a garage door). Defaults: door=7, window=4, overhead_door=8" },
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
      required: ["roomName", "openingType"]
    }
  },
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
          description: "Which wall of room A faces room B"
        },
        wallDirectionB: {
          type: "string",
          enum: ["north", "south", "east", "west"],
          description: "Which wall of room B faces room A (should be opposite of wallDirectionA)"
        },
        sharedWallLengthFt: { type: "number", description: "Length of the shared wall in feet (if known)" }
      },
      required: ["roomNameA", "roomNameB"]
    }
  },
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
    description: "Records a damage observation. REQUIRES a room context — provide roomName to specify which room, or omit to use the currently selected room. If no room is selected, ask the adjuster first. The system auto-generates scope line items with quantities derived from room geometry when dimensions are available. If dimensions are missing, quantities default to 1 — the response will include a dimensionWarning.",
    parameters: {
      type: "object",
      properties: {
        roomName: { type: "string", description: "Name of the room where damage is located. If omitted, uses the currently selected room." },
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
    description: "Adds an Xactimate-compatible estimate line item. When possible, provide a catalogCode for accurate pricing lookup — the system will match it against the trade catalog for regional pricing, correct unit types, and default waste factors. If auto-scope already generated items for a damage, you typically don't need to add them manually — check the auto-scope summary first. Companion items (e.g., painting after drywall) may also be auto-generated.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["Roofing", "Siding", "Soffit/Fascia", "Gutters", "Windows", "Doors", "Drywall", "Painting", "Flooring", "Plumbing", "Electrical", "HVAC", "Debris", "General", "Fencing", "Cabinetry"] },
        action: { type: "string", enum: ["R&R", "Detach & Reset", "Repair", "Paint", "Clean", "Tear Off", "Labor Only", "Install"] },
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
  },
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
  },
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
  },
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
  },
  {
    type: "function",
    name: "trigger_photo_capture",
    description: "Opens the camera on the adjuster's device IMMEDIATELY. Do NOT ask permission first — just call this tool. The camera opens instantly and waits for the adjuster to tap the capture button. Do NOT continue talking until you receive the tool result. The result will include AI analysis of the captured photo. If damageSuggestions are present, discuss them with the adjuster and use confirm_damage_suggestion to log confirmed damage. If qualityScore is below 50, suggest retaking the photo.",
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
    name: "update_line_item",
    description: "Updates an existing scope line item. Use to adjust quantity, unit price, description, or other properties after creation. The adjuster may say 'change that to 120 square feet' or 'update the price to $3.50'. Always confirm the change with the adjuster.",
    parameters: {
      type: "object",
      properties: {
        lineItemId: { type: "integer", description: "The ID of the line item to update (from add_line_item or auto-scope results)" },
        quantity: { type: "number", description: "New quantity value" },
        unitPrice: { type: "number", description: "New unit price" },
        description: { type: "string", description: "Updated description" },
        unit: { type: "string", enum: ["SF", "LF", "EA", "SQ", "SY", "HR", "DAY"], description: "Updated unit of measure" },
        age: { type: "number", description: "Updated age in years for depreciation" },
        depreciationType: { type: "string", enum: ["Recoverable", "Non-Recoverable", "Paid When Incurred"], description: "Depreciation classification" },
      },
      required: ["lineItemId"]
    }
  },
  {
    type: "function",
    name: "remove_line_item",
    description: "Removes a line item from the scope. Use when the adjuster says to delete, remove, or cancel a specific item. Confirm with the adjuster before removing.",
    parameters: {
      type: "object",
      properties: {
        lineItemId: { type: "integer", description: "The ID of the line item to remove" },
        reason: { type: "string", description: "Why the item is being removed, e.g., 'Not applicable', 'Duplicate', 'Adjuster override'" },
      },
      required: ["lineItemId"]
    }
  },
  {
    type: "function",
    name: "get_room_scope",
    description: "Returns all scope line items for a specific room with quantities, unit prices, and total prices. Use to review what has been scoped for the current room before moving on, or when the adjuster asks 'what do we have for this room?' or 'read back the items'.",
    parameters: {
      type: "object",
      properties: {
        roomName: { type: "string", description: "The room name to get scope for" },
        roomId: { type: "integer", description: "The room ID (alternative to roomName)" },
      }
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
  },
  {
    type: "function",
    name: "get_completeness",
    description:
      "Returns a comprehensive completeness analysis for the current inspection. " +
      "Includes overall score, scope gaps (rooms with damage but no line items), " +
      "missing photo documentation, peril-specific checks, and AI recommendations. " +
      "Call this before phase transitions, before finalizing, or when the adjuster " +
      "asks how things are looking.",
    parameters: { type: "object", properties: {}, required: [] }
  },
  {
    type: "function",
    name: "confirm_damage_suggestion",
    description:
      "Confirms or rejects a damage suggestion that was detected by photo AI analysis. " +
      "When a photo reveals potential damage, the adjuster must confirm before it is " +
      "logged as an observation. Call this after discussing photo analysis results " +
      "with the adjuster.",
    parameters: {
      type: "object",
      properties: {
        photoId: { type: "integer", description: "The ID of the photo that produced the suggestion" },
        damageType: {
          type: "string",
          description: "The damage type to confirm (from damageSuggestions)",
          enum: [
            "hail_impact", "wind_damage", "water_stain", "water_intrusion",
            "crack", "dent", "missing", "rot", "mold", "mechanical",
            "wear_tear", "other"
          ]
        },
        severity: {
          type: "string",
          description: "Confirmed severity level",
          enum: ["minor", "moderate", "severe"]
        },
        confirmed: {
          type: "boolean",
          description: "true if adjuster confirms the damage, false to reject"
        },
        location: {
          type: "string",
          description: "Where in the room the damage was detected"
        }
      },
      required: ["photoId", "damageType", "confirmed"]
    }
  },
  {
    type: "function",
    name: "get_scope_gaps",
    description:
      "Returns a list of scope gaps — rooms or areas where damage has been documented " +
      "but no corresponding line items exist. Use this to identify missing scope items " +
      "and help the adjuster complete their estimate. Also flags common companion " +
      "item omissions (e.g., drywall without painting).",
    parameters: {
      type: "object",
      properties: {
        roomId: {
          type: "integer",
          description: "Optional: check gaps for a specific room only. Omit for all rooms."
        }
      },
      required: []
    }
  },
  {
    type: "function",
    name: "request_phase_validation",
    description:
      "Explicitly requests a phase validation check for the current phase before " +
      "transitioning. Returns warnings, missing items, and a completion score. " +
      "The adjuster can choose to address warnings or proceed anyway. " +
      "Call this before suggesting a phase change, or when the adjuster asks " +
      "'are we ready to move on?'",
    parameters: { type: "object", properties: {}, required: [] }
  }
];
