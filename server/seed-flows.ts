/**
 * Seed script for industry-standard inspection flows.
 * Based on InterNACHI, CPR Group, Docusketch, and IICRC guidelines.
 *
 * Run via: npx tsx server/seed-flows.ts
 */
import { db } from "./db";
import { logger } from "./logger";
import { inspectionFlows } from "@shared/schema";
import type { InspectionStep } from "@shared/schema";
import { and, eq } from "drizzle-orm";

function makeId(prefix: string, index: number): string {
  return `${prefix}_${String(index).padStart(2, "0")}`;
}

const hailSteps: InspectionStep[] = [
  {
    id: makeId("hail", 1),
    phaseName: "Pre-Inspection Review",
    agentPrompt: "Review the briefing highlights with the adjuster. Confirm date of loss, policy coverage limits, deductible, and any known prior claims. Note the reported hail size and storm date from the FNOL.",
    requiredTools: ["get_inspection_state"],
    completionCriteria: "Adjuster confirms briefing details reviewed.",
  },
  {
    id: makeId("hail", 2),
    phaseName: "Session Setup & Structure Identification",
    agentPrompt: "Ask the adjuster what structures are on the property: Main dwelling, detached garage, shed, fence, carport? Create a structure for each one. Confirm the price list region and roofing material type.",
    requiredTools: ["create_structure", "set_inspection_context"],
    completionCriteria: "All structures on property are created.",
  },
  {
    id: makeId("hail", 3),
    phaseName: "Collateral Damage Check",
    agentPrompt: "Before getting on the roof, inspect ground-level soft metals for hail evidence. Check mailboxes, A/C condenser fins, downspouts, window screens, and painted surfaces for spatter marks. Take photos of any dents or impacts found. This establishes that hail actually struck the property.",
    requiredTools: ["trigger_photo_capture", "add_damage", "add_sketch_annotation"],
    completionCriteria: "At least 3 collateral items inspected and photographed.",
  },
  {
    id: makeId("hail", 4),
    phaseName: "Roof Overview & Access",
    agentPrompt: "Take 360-degree overview photos of the roof from the ground (all 4 corners). Create roof facets for each slope (North, South, East, West). Note the roof type, material, and approximate age. Document the access method (ladder, drone, etc.).",
    requiredTools: ["create_room", "trigger_photo_capture", "set_inspection_context"],
    completionCriteria: "All roof facets created with overview photos from all 4 corners.",
  },
  {
    id: makeId("hail", 5),
    phaseName: "Test Squares — All Slopes",
    agentPrompt: "Mark a 10x10 foot test square on each roof slope. Count hail hits within each square. Record the pitch for each facet (critical for steep charges above 7/12). Use log_test_square for each facet and add_sketch_annotation with type 'hail_count'. If 8+ hits per 10x10, recommend full slope replacement. Take a photo of each test square. After confirming hail damage on a slope, suggest applying the hail roof template: 'I have a standard hail roof scope template. Shall I apply it as a starting point?'",
    requiredTools: ["log_test_square", "add_sketch_annotation", "trigger_photo_capture", "apply_peril_template"],
    completionCriteria: "Test square completed on all roof slopes with hit counts recorded.",
  },
  {
    id: makeId("hail", 6),
    phaseName: "Roof Accessories & Penetrations",
    agentPrompt: "Check all roof accessories: turtle vents, ridge vent, pipe boots, skylights, chimney cap/flashing, satellite dish mounts. Look for cracked/fractured plastic vents (hail signature), dented metal vents, and compromised pipe boot seals. Add damage and line items for each affected accessory.",
    requiredTools: ["add_damage", "add_line_item", "trigger_photo_capture"],
    completionCriteria: "All roof accessories inspected and documented.",
  },
  {
    id: makeId("hail", 7),
    phaseName: "Gutters, Fascia & Soffits",
    agentPrompt: "Inspect gutters and downspouts for dents/dimples (size indicates hail diameter). Check fascia and soffit for impact damage. Create areas with viewType 'exterior_other' for these items. Document and photograph all findings.",
    requiredTools: ["create_room", "add_damage", "add_line_item", "trigger_photo_capture"],
    completionCriteria: "Gutters and trim fully inspected per elevation.",
  },
  {
    id: makeId("hail", 8),
    phaseName: "Elevations & Siding",
    agentPrompt: "Create elevation rooms for each side of the structure. Inspect siding for hail impact — vinyl siding may show cracks, fiber cement may show chip marks, wood may show dents. Add openings (doors, windows) and check window screens and frames. Document damage per elevation. After documenting damage, suggest applying the hail exterior template: 'For hail damage on this elevation, I have a standard scope template. Shall I apply it as a starting point?'",
    requiredTools: ["create_room", "add_opening", "add_damage", "add_line_item", "trigger_photo_capture", "apply_peril_template"],
    completionCriteria: "All 4 elevations inspected with openings documented.",
  },
  {
    id: makeId("hail", 9),
    phaseName: "Interior Inspection",
    agentPrompt: "If hail caused roof breaches, inspect interior rooms for water intrusion damage. Check ceilings and walls for staining. For each affected room, get dimensions, create the room, add sub-areas (closets), openings, and document damage with line items.",
    requiredTools: ["create_room", "create_sub_area", "add_opening", "add_damage", "add_line_item", "trigger_photo_capture"],
    completionCriteria: "All affected interior rooms documented.",
  },
  {
    id: makeId("hail", 10),
    phaseName: "Estimate Assembly",
    agentPrompt: "Review the running estimate. Use apply_smart_macro for 'roof_replacement_laminated' if applicable. Call check_related_items after major categories to catch missing companion items (drip edge, ice barrier, felt, ridge cap). Verify coverage buckets are correct. Apply O&P if 3+ trades involved.",
    requiredTools: ["get_estimate_summary", "apply_smart_macro", "check_related_items", "add_line_item"],
    completionCriteria: "Estimate reviewed with all companion items added.",
  },
  {
    id: makeId("hail", 11),
    phaseName: "Evidence Review & Finalize",
    agentPrompt: "Call get_progress to verify completeness. Ensure sufficient photos (overview, test squares, damage details). Ask if the adjuster has any final notes. Navigate to the review page when complete.",
    requiredTools: ["get_progress", "complete_inspection"],
    completionCriteria: "All areas inspected, adequate photos taken, adjuster confirms done.",
  },
];

const windSteps: InspectionStep[] = [
  {
    id: makeId("wind", 1),
    phaseName: "Pre-Inspection Review",
    agentPrompt: "Review briefing: date of loss, reported wind speed, storm direction. Check policy for wind/hail deductible vs. standard deductible. Note any cosmetic damage exclusions in endorsements.",
    requiredTools: ["get_inspection_state"],
    completionCriteria: "Adjuster confirms briefing details reviewed.",
  },
  {
    id: makeId("wind", 2),
    phaseName: "Session Setup & Structure Identification",
    agentPrompt: "Identify and create all structures on the property. Establish the prevailing storm wind direction — this is critical for correlating damage patterns. Record storm direction as a global annotation.",
    requiredTools: ["create_structure", "add_sketch_annotation", "set_inspection_context"],
    completionCriteria: "All structures created, storm direction recorded.",
  },
  {
    id: makeId("wind", 3),
    phaseName: "Roof Inspection — Directional Damage",
    agentPrompt: "Create roof facets for all slopes. Wind damage should follow a directional pattern (windward side most affected). Check for missing shingles, lifted/creased shingles, blown-off ridge caps, and displaced flashing. Use log_test_square to document wind crease counts per facet. Note any tree impact damage separately. After confirming wind damage, suggest applying the wind roof template: 'I have a standard wind roof scope template for the affected slopes. Shall I apply it?'",
    requiredTools: ["create_room", "log_test_square", "add_sketch_annotation", "add_damage", "trigger_photo_capture", "apply_peril_template"],
    completionCriteria: "All roof slopes inspected with directional damage documented.",
  },
  {
    id: makeId("wind", 4),
    phaseName: "Structural & Framing Check",
    agentPrompt: "Inspect for structural wind damage: shifted ridge lines, displaced trusses, racked walls. Check for uplift damage at eave connections. Document any structural displacement with measurements.",
    requiredTools: ["add_damage", "trigger_photo_capture", "add_line_item"],
    completionCriteria: "Structural integrity assessed.",
  },
  {
    id: makeId("wind", 5),
    phaseName: "Elevations — Windward vs. Leeward",
    agentPrompt: "Create all 4 elevations. Pay special attention to the windward elevation for siding damage, displaced trim, and broken windows. Compare with the leeward (protected) side. Add all openings. Check for debris impact marks.",
    requiredTools: ["create_room", "add_opening", "add_damage", "add_line_item", "trigger_photo_capture"],
    completionCriteria: "All 4 elevations inspected with wind direction correlation noted.",
  },
  {
    id: makeId("wind", 6),
    phaseName: "Fencing, Trees & Other Structures",
    agentPrompt: "Inspect fencing for blown-down sections, leaning posts. Document fallen trees or branches and where they impacted structures. Create structures for fences, sheds, or other damaged outbuildings.",
    requiredTools: ["create_structure", "create_room", "add_damage", "add_line_item", "trigger_photo_capture"],
    completionCriteria: "All ancillary structures and debris damage documented.",
  },
  {
    id: makeId("wind", 7),
    phaseName: "Interior (if applicable)",
    agentPrompt: "If wind caused breaches (missing shingles → water entry, broken windows → rain entry), inspect interior rooms for secondary water damage. Get dimensions, create rooms, document damage.",
    requiredTools: ["create_room", "add_damage", "add_line_item", "trigger_photo_capture", "log_moisture_reading"],
    completionCriteria: "All wind-related interior damage documented.",
  },
  {
    id: makeId("wind", 8),
    phaseName: "Estimate Assembly & Finalize",
    agentPrompt: "Review the estimate. Apply smart macros for roof replacement if warranted. Run check_related_items for completeness. Verify O&P qualification. Call get_progress for completeness check. Finalize.",
    requiredTools: ["get_estimate_summary", "apply_smart_macro", "check_related_items", "get_progress", "complete_inspection"],
    completionCriteria: "Estimate complete, all areas covered, adjuster confirms done.",
  },
];

const waterSteps: InspectionStep[] = [
  {
    id: makeId("water", 1),
    phaseName: "Pre-Inspection Review",
    agentPrompt: "Review the briefing: date of loss, reported water source, policy coverage for water damage. Check for any water damage exclusions or sub-limits in endorsements. Note if mitigation has already started.",
    requiredTools: ["get_inspection_state"],
    completionCriteria: "Adjuster confirms briefing details reviewed.",
  },
  {
    id: makeId("water", 2),
    phaseName: "Source Identification",
    agentPrompt: "The FIRST priority in any water claim is identifying the source. Ask the adjuster: Is it a pipe burst, roof leak, appliance failure, sewage backup, or external flooding? The source determines the water category and coverage. Take photos of the source point.",
    requiredTools: ["trigger_photo_capture", "add_damage", "set_inspection_context"],
    completionCriteria: "Water source identified and photographed.",
  },
  {
    id: makeId("water", 3),
    phaseName: "Water Category & Class Classification",
    agentPrompt: "Classify the water per IICRC S500 standards. Category 1: Clean water (supply line). Category 2: Gray water (dishwasher, washing machine, toilet overflow with urine). Category 3: Black water (sewage, flooding, standing water >72 hrs). Also determine Class 1-4 based on extent of wetting. This classification drives the entire mitigation scope.",
    requiredTools: ["add_sketch_annotation", "set_inspection_context"],
    completionCriteria: "Water category (1-3) and class (1-4) determined and recorded.",
  },
  {
    id: makeId("water", 4),
    phaseName: "Affected Area Sketching & Moisture Mapping",
    agentPrompt: "Create rooms for ALL affected areas. Get dimensions immediately — water damage pricing is area-based. For each room, take moisture readings at multiple points (walls, floor, ceiling). Compare against dry standards (drywall: 12%, wood: 15%). Also take readings in one unaffected 'control' room for baseline comparison. Trace the water path from entry to lowest point.",
    requiredTools: ["create_room", "log_moisture_reading", "trigger_photo_capture", "set_inspection_context"],
    completionCriteria: "All affected rooms created with dimensions and moisture readings recorded.",
  },
  {
    id: makeId("water", 5),
    phaseName: "Damage Documentation",
    agentPrompt: "Document all water damage in each room: staining, swelling, warping, delamination, mold/mildew. Check baseboards, cabinetry, flooring type (hardwood buckles, carpet/pad saturation, tile grout discoloration). Note ceiling damage from upper-floor leaks. Add line items for R&R of damaged materials. After documenting damage in each room, suggest applying the water template: 'For water damage in this room, I have a standard scope template based on room type. Shall I apply it as a starting point?'",
    requiredTools: ["add_damage", "add_line_item", "trigger_photo_capture", "add_opening", "create_sub_area", "apply_peril_template"],
    completionCriteria: "All damage observations recorded with corresponding line items.",
  },
  {
    id: makeId("water", 6),
    phaseName: "Mitigation & Equipment Placement",
    agentPrompt: "Document mitigation efforts: air movers (fans), dehumidifiers, air scrubbers. Note quantity and placement. Use apply_smart_macro with 'water_mitigation_dryout' for standard drying setups. Record equipment run time if available. Check if containment barriers are needed (Category 2/3).",
    requiredTools: ["apply_smart_macro", "add_line_item", "trigger_photo_capture"],
    completionCriteria: "Mitigation equipment documented, drying plan established.",
  },
  {
    id: makeId("water", 7),
    phaseName: "Content & Personal Property",
    agentPrompt: "Document damaged contents: furniture, electronics, clothing, stored items. For Category 2-3, contents in affected areas likely need cleaning or disposal. Note whether items can be restored or must be replaced.",
    requiredTools: ["add_damage", "add_line_item", "trigger_photo_capture"],
    completionCriteria: "Affected contents documented.",
  },
  {
    id: makeId("water", 8),
    phaseName: "Estimate Assembly & Finalize",
    agentPrompt: "Review the estimate. Ensure demolition/tearout items are included (removing wet drywall, pad, baseboard). Run check_related_items for completeness. Verify category-appropriate line items are included. Check estimate against coverage limits. Finalize.",
    requiredTools: ["get_estimate_summary", "check_related_items", "get_progress", "complete_inspection"],
    completionCriteria: "Estimate complete with all mitigation and restoration items.",
  },
];

const fireSteps: InspectionStep[] = [
  {
    id: makeId("fire", 1),
    phaseName: "Pre-Inspection & Safety Review",
    agentPrompt: "Review the briefing: fire origin/cause (if known), fire department report, date of loss. Confirm the structure is safe to enter (cleared by fire marshal). Note any utilities that need to be addressed (gas, electric, water).",
    requiredTools: ["get_inspection_state"],
    completionCriteria: "Safety confirmed, briefing reviewed.",
  },
  {
    id: makeId("fire", 2),
    phaseName: "Exterior Damage Assessment",
    agentPrompt: "Create all structures. Document exterior fire, smoke, and heat damage. Check siding, trim, windows, roofing for melting, charring, discoloration. Note the fire's path of travel on the exterior. Create all 4 elevations.",
    requiredTools: ["create_structure", "create_room", "add_damage", "trigger_photo_capture", "set_inspection_context"],
    completionCriteria: "Exterior fire damage fully documented.",
  },
  {
    id: makeId("fire", 3),
    phaseName: "Interior — Fire Origin Area",
    agentPrompt: "Start with the room of fire origin. Document char depth, structural damage, complete loss areas. This room often requires full gutting. Get dimensions, create the room, and photograph thoroughly. After documenting fire damage, suggest applying the fire interior template: 'For fire damage in this room, I have a standard scope template including demolition, fire-rated drywall, and painting. Shall I apply it as a starting point?'",
    requiredTools: ["create_room", "add_damage", "add_line_item", "trigger_photo_capture", "apply_peril_template"],
    completionCriteria: "Fire origin room fully documented.",
  },
  {
    id: makeId("fire", 4),
    phaseName: "Interior — Smoke & Heat Damage",
    agentPrompt: "Move room by room away from the origin. Classify smoke type: wet (protein/grease), dry (paper/wood), fuel oil (petroleum). Check for soot deposits, smoke staining on walls/ceilings, heat damage to plastics and electronics. Even rooms far from the fire may need cleaning or repainting. After documenting smoke/heat damage in a room, suggest applying the fire interior template for affected rooms.",
    requiredTools: ["create_room", "add_damage", "add_line_item", "trigger_photo_capture", "create_sub_area", "add_opening", "apply_peril_template"],
    completionCriteria: "All interior rooms assessed for smoke/heat damage.",
  },
  {
    id: makeId("fire", 5),
    phaseName: "Water Damage from Suppression",
    agentPrompt: "Fire suppression (hoses, sprinklers) causes significant water damage. Take moisture readings in all areas where water was used. Document waterlogged materials. This is often a secondary but major claim component.",
    requiredTools: ["log_moisture_reading", "add_damage", "add_line_item", "trigger_photo_capture"],
    completionCriteria: "Suppression water damage documented with moisture readings.",
  },
  {
    id: makeId("fire", 6),
    phaseName: "Estimate Assembly & Finalize",
    agentPrompt: "Review the estimate. Fire claims typically involve many trades (demo, framing, drywall, paint, electrical, plumbing, HVAC, flooring) — O&P is almost always applicable. Run check_related_items. Verify against Coverage A limit. Finalize.",
    requiredTools: ["get_estimate_summary", "check_related_items", "apply_smart_macro", "get_progress", "complete_inspection"],
    completionCriteria: "Comprehensive estimate assembled, adjuster confirms done.",
  },
];

const generalSteps: InspectionStep[] = [
  {
    id: makeId("gen", 1),
    phaseName: "Pre-Inspection Review",
    agentPrompt: "Review the briefing highlights: claim details, coverage, endorsements, and any red flags. Confirm the peril type and inspection scope with the adjuster.",
    requiredTools: ["get_inspection_state"],
    completionCriteria: "Briefing reviewed and confirmed.",
  },
  {
    id: makeId("gen", 2),
    phaseName: "Session Setup",
    agentPrompt: "Identify all structures on the property and create them. Confirm the price list region. Establish the inspection scope based on the claim.",
    requiredTools: ["create_structure", "set_inspection_context"],
    completionCriteria: "All structures created.",
  },
  {
    id: makeId("gen", 3),
    phaseName: "Exterior Inspection",
    agentPrompt: "Work through each structure. Create roof facets, elevations, and exterior areas. Document damage, add openings, take photos. Add line items for repairs.",
    requiredTools: ["create_room", "add_opening", "add_damage", "add_line_item", "trigger_photo_capture", "add_sketch_annotation"],
    completionCriteria: "All exterior areas of all structures inspected.",
  },
  {
    id: makeId("gen", 4),
    phaseName: "Interior Inspection",
    agentPrompt: "Go room by room through the interior. Get dimensions, create rooms and sub-areas, add openings, document damage, and add line items.",
    requiredTools: ["create_room", "create_sub_area", "add_opening", "add_damage", "add_line_item", "trigger_photo_capture"],
    completionCriteria: "All affected interior rooms documented.",
  },
  {
    id: makeId("gen", 5),
    phaseName: "Evidence Review",
    agentPrompt: "Review photo completeness. Ensure all damaged areas have been photographed. Check that all rooms have at least one overview photo.",
    requiredTools: ["get_progress", "trigger_photo_capture"],
    completionCriteria: "Photo documentation is sufficient.",
  },
  {
    id: makeId("gen", 6),
    phaseName: "Estimate Assembly",
    agentPrompt: "Review the running estimate. Call check_related_items for each major category. Verify coverage buckets. Apply O&P if 3+ trades. Check against deductible and coverage limits.",
    requiredTools: ["get_estimate_summary", "check_related_items", "add_line_item"],
    completionCriteria: "Estimate reviewed and complete.",
  },
  {
    id: makeId("gen", 7),
    phaseName: "Finalize",
    agentPrompt: "Provide a summary of findings. Confirm the adjuster has no additional notes. Navigate to the review page.",
    requiredTools: ["get_progress", "complete_inspection"],
    completionCriteria: "Adjuster confirms inspection complete.",
  },
];

const seedFlows = [
  {
    name: "Standard Hail Inspection",
    perilType: "Hail",
    description: "Industry-standard hail damage inspection flow based on InterNACHI and CPR Group guidelines. Includes collateral checks, forensic test squares, and systematic roof/exterior assessment.",
    isDefault: true,
    isSystemDefault: true,
    userId: null,
    steps: hailSteps,
  },
  {
    name: "Standard Wind Inspection",
    perilType: "Wind",
    description: "Wind damage inspection flow emphasizing directional damage patterns, structural assessment, and windward/leeward comparison.",
    isDefault: true,
    isSystemDefault: true,
    userId: null,
    steps: windSteps,
  },
  {
    name: "Water Mitigation & Damage Inspection",
    perilType: "Water",
    description: "Water damage inspection per IICRC S500 standards. Covers source identification, category/class classification, moisture mapping, and mitigation documentation.",
    isDefault: true,
    isSystemDefault: true,
    userId: null,
    steps: waterSteps,
  },
  {
    name: "Fire & Smoke Damage Inspection",
    perilType: "Fire",
    description: "Fire damage inspection covering structural assessment, smoke/soot classification, and suppression water damage documentation.",
    isDefault: true,
    isSystemDefault: true,
    userId: null,
    steps: fireSteps,
  },
  {
    name: "General Property Inspection",
    perilType: "General",
    description: "Universal inspection flow for claims that don't fit a specific peril category. Follows the standard exterior-to-interior progression.",
    isDefault: true,
    isSystemDefault: true,
    userId: null,
    steps: generalSteps,
  },
];

export async function seedInspectionFlows(): Promise<number> {
  let count = 0;
  for (const flowData of seedFlows) {
    // Check if this system default already exists
    const existing = await db
      .select()
      .from(inspectionFlows)
      .where(
        and(
          eq(inspectionFlows.isSystemDefault, true),
          eq(inspectionFlows.perilType, flowData.perilType),
          eq(inspectionFlows.name, flowData.name),
        )
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(inspectionFlows).values(flowData);
      count++;
      logger.info("SeedFlows", `Seeded: ${flowData.name} (${flowData.perilType})`);
    } else {
      // Update existing system default with latest steps
      await db
        .update(inspectionFlows)
        .set({ steps: flowData.steps, description: flowData.description, updatedAt: new Date() })
        .where(eq(inspectionFlows.id, existing[0].id));
      logger.info("SeedFlows", `Updated: ${flowData.name} (${flowData.perilType})`);
    }
  }
  return count;
}

