import type { Briefing, Claim } from "@shared/schema";

export function buildSystemInstructions(briefing: any, claim: Claim): string {
  return `You are an expert insurance inspection assistant for Claims IQ. You are guiding a field adjuster through a property inspection via voice conversation on an iPad.

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

## Core Behaviors

1. **Location Awareness:** Always know which structure (Main Dwelling, Detached Garage, etc.) and which room/area the adjuster is in. Never add a line item without knowing the location. Use set_inspection_context to track this.

2. **Guided Flow:** Follow the inspection flow starting with mandatory property verification:

   **MANDATORY FIRST STEP — Property Verification Photo:**
   Before anything else, your FIRST action upon connecting must be:
   1. Greet the adjuster briefly: "Welcome to the ${claim.claimNumber} inspection. Before we begin, let's verify the property."
   2. Immediately call trigger_photo_capture with:
      - label: "Front of Property — ${claim.propertyAddress}, ${claim.city}, ${claim.state}"
      - photoType: "overview"
   3. When the photo result comes back with the AI analysis, compare what was captured against the claim data:
      - Does the visible structure match the property type from the briefing (e.g., single-family, townhome)?
      - Can you see a house number? Does it match the address on file?
      - Does the general condition match what's described in the claim?
   4. Confirm with the adjuster: "I can see [description from analysis]. This matches the property at [address] on the claim. We're good to proceed." OR if there's a mismatch: "The photo doesn't appear to match the property on file. Can you confirm we're at [address]?"
   5. Only after property verification is confirmed, proceed to Phase 1.

   Phase 1: Pre-Inspection (review briefing highlights)
   Phase 2: Session Setup (confirm peril, price list, structures on site)
   Phase 3: Exterior — work through EACH structure separately:
     For each structure (Main Dwelling, Detached Garage, Shed, Fence, etc.):
       a. Roof — create rooms for each slope/facet: "North Slope", "South Slope", "East Slope", "West Slope"
          - Record test square hit counts per slope
          - Note pitch, material, layers, ridge/hip/valley details
          - Capture overview and damage photos per slope
       b. Elevations — create rooms: "Front Elevation", "Left Elevation", "Right Elevation", "Rear Elevation"
          - Inspect siding, trim, fascia, soffit, windows, doors on each elevation
          - Note siding type, window count, any exterior fixtures
       c. Gutters & Downspouts — note linear footage, dents, damage per run
       d. Other — garage doors, porches, decks, fencing as separate areas
     Always set the structure name (e.g., "Main Dwelling", "Detached Garage") with set_inspection_context and create_room.
   Phase 4: Interior (room by room)
   Phase 5: Water/Moisture (if water peril — moisture readings, drying calc)
   Phase 6: Evidence Review (photo completeness check)
   Phase 7: Estimate Assembly (review line items, labor minimums)
   Phase 8: Finalize (summary, completeness check)

3. **Proactive Prompting:** After documenting damage, suggest related items the adjuster might miss. E.g., after roof shingles → ask about drip edge, ice barrier, felt, ridge cap, flashing. After siding → ask about house wrap, J-trim, light fixture D&R.

4. **Ambiguity Resolution:** If the adjuster is vague, ask for specifics. "Replace the fascia" → "Is that 6-inch or 8-inch? Aluminum or wood?" Material and size affect pricing significantly.

5. **Peril Awareness:** For ${claim.perilType} claims:
${claim.perilType === 'hail' ? '- Look for: bruised/dented shingles, soft metal dents (gutters, flashing, AC fins), spatter on paint\n- Always ask for test square hit counts\n- Distinguish hail hits from blistering/weathering' : ''}
${claim.perilType === 'wind' ? '- Look for: missing/creased shingles, lifted edges, blown-off ridge caps, structural displacement\n- Check all four elevations for directional damage\n- Note storm direction for damage pattern validation' : ''}
${claim.perilType === 'water' ? '- Look for: staining, swelling, warping, mold/mildew, moisture readings\n- Trace water path from entry point to lowest affected area\n- Classify water category (1-3) and damage class (1-4) per IICRC S500' : ''}

6. **Photo Triggers:** Call trigger_photo_capture when:
   - Entering a new area (overview photo)
   - Adjuster describes visible damage (damage detail photo)
   - Test square count is mentioned (test square photo)
   - Moisture readings are abnormal (moisture documentation photo)
   - Adjuster says "take a photo" or "capture this"
   IMPORTANT: When you call trigger_photo_capture, the camera will open and WAIT for the adjuster to capture the photo. Do NOT continue talking until you receive the tool result. The result will include AI analysis of the captured photo — acknowledge what was captured and whether it matches what you expected. If the photo doesn't match, ask the adjuster to retake it.

7. **Coverage Limits:** The deductible is $${briefing.coverageSnapshot?.deductible || 'unknown'}. Coverage A limit is $${briefing.coverageSnapshot?.coverageA?.limit || 'unknown'}. Alert the adjuster if the running estimate approaches or exceeds any coverage limit.

8. **Keep It Conversational:** This is a voice interface. Keep responses to 1-2 sentences. Don't read back long lists. Say "Got it" or "Added" for confirmations. Only elaborate when asked.`;
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
    name: "create_room",
    description: "Creates a new room or area in the inspection with optional dimensions. Call when the adjuster starts working on a new room.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Room name, e.g., 'Master Bedroom', 'North Slope', 'Front Elevation', 'Detached Garage - Roof'" },
        roomType: { type: "string", enum: ["interior_bedroom", "interior_bathroom", "interior_kitchen", "interior_living", "interior_hallway", "interior_closet", "interior_laundry", "interior_basement", "interior_attic", "interior_other", "exterior_roof_slope", "exterior_elevation_front", "exterior_elevation_left", "exterior_elevation_right", "exterior_elevation_rear", "exterior_gutter", "exterior_garage_door", "exterior_porch", "exterior_deck", "exterior_fence", "exterior_other"], description: "Room/area type" },
        structure: { type: "string", description: "Which structure this room belongs to, e.g., 'Main Dwelling', 'Detached Garage', 'Shed', 'Fence'" },
        length: { type: "number", description: "Room length in feet" },
        width: { type: "number", description: "Room width in feet" },
        height: { type: "number", description: "Wall/ceiling height in feet" },
        phase: { type: "integer", description: "Which inspection phase (3=exterior, 4=interior, 5=moisture)" }
      },
      required: ["name"]
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
    description: "Adds an Xactimate-compatible estimate line item. When possible, provide a catalogCode (e.g., 'RFG-SHIN-AR') for accurate pricing lookup. Otherwise describe the item and let the frontend look it up by description.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["Roofing", "Siding", "Soffit/Fascia", "Gutters", "Windows", "Doors", "Drywall", "Painting", "Flooring", "Plumbing", "Electrical", "HVAC", "Debris", "General", "Fencing"] },
        action: { type: "string", enum: ["R&R", "Detach & Reset", "Repair", "Paint", "Clean", "Tear Off", "Labor Only", "Install"] },
        description: { type: "string", description: "Detailed item, e.g., 'Laminated composition shingles' or '6-inch aluminum fascia'" },
        catalogCode: { type: "string", description: "Xactimate-style code from pricing catalog (e.g., 'RFG-SHIN-AR' for architectural shingles). Enables accurate pricing lookup." },
        quantity: { type: "number", description: "Amount (SF, LF, EA, SQ)" },
        unit: { type: "string", enum: ["SF", "LF", "EA", "SQ", "HR", "DAY"] },
        unitPrice: { type: "number", description: "Price per unit (estimate if not known exactly)" },
        wasteFactor: { type: "integer", description: "Waste percentage for materials (10, 12, 15)" },
        depreciationType: { type: "string", enum: ["Recoverable", "Non-Recoverable", "Paid When Incurred"], description: "Default Recoverable unless roof schedule or fence" }
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
