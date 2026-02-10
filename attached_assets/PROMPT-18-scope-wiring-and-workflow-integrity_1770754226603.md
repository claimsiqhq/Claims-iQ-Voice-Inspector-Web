# PROMPT 18 — Scope-to-Voice Wiring, Photo→Damage Pipeline & Workflow Integrity

**Depends on:** PROMPT-16 (Scope Engine), PROMPT-17 (Catalog Seeding & Peril Templates)
**Branch:** `feat/scope-wiring-and-workflow`

---

## Context

PROMPT-16 built the scope assembly infrastructure — `scopeAssemblyService`, `scopeQuantityEngine`, `scopeValidation`, the `generate_scope` voice tool, and the enhanced `scopeLineItems` schema. PROMPT-17 filled that engine with data — 127+ catalog items with `companionRules`, `scopeConditions`, `quantityFormula`, 6 peril templates, and the cascade dependency graph.

**The problem:** None of this is connected to the actual inspection workflow. The voice agent's `add_damage` tool still creates a bare `damageObservations` row with no downstream scope assembly. The `add_line_item` tool still takes manual pricing parameters without consulting the catalog. The photo analysis pipeline (GPT-4o Vision) captures rich `damageVisible` data in the `analysis` JSONB but nothing acts on it. Phase transitions have no completeness gates. And the supplemental ESX export returns a hardcoded placeholder string instead of a real file.

PROMPT-18 connects the fuel lines — wiring the scope engine into every touch point where damage, photos, and estimate data flow.

---

## Part A — Auto-Scope on Damage Creation

### Goal
When `add_damage` is called (via voice tool or REST API), automatically:
1. Query `scopeLineItems` for items whose `scopeConditions` match the damage context
2. Derive quantities from room dimensions using `quantityFormula`
3. Resolve companion chains from `companionRules`
4. Look up regional pricing
5. Create `lineItems` rows linked to the damage observation
6. Return the auto-generated scope to the voice agent for confirmation

### File: `server/scopeAssemblyHook.ts` — New File

```ts
/**
 * scopeAssemblyHook.ts
 *
 * Triggered after damage creation. Matches catalog items to damage context,
 * resolves companion chains, derives quantities, and creates line items.
 */

import { db } from "./db";
import { scopeLineItems, regionalPriceSets, lineItems, inspectionRooms } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DamageContext {
  sessionId: number;
  roomId: number;
  damageId: number;
  damageType: string;      // e.g., "water_intrusion", "hail_impact"
  severity: string;        // "minor" | "moderate" | "severe"
  location?: string;       // "wall", "ceiling", "floor", etc.
  extent?: string;
  hitCount?: number;
}

interface RoomContext {
  name: string;
  roomType: string | null;
  structure: string | null;
  dimensions: {
    length?: number;
    width?: number;
    height?: number;
  } | null;
}

interface AutoScopeResult {
  itemsCreated: number;
  items: Array<{
    code: string;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalPrice: number;
    source: "auto_scope" | "companion";
  }>;
  warnings: string[];
}

// ─── Surface Inference ─────────────────────────────────────────────────────

/**
 * Infer the affected surface from damage location text and room type.
 * The voice agent says things like "NE corner ceiling" or "south wall base"
 * — we need to map that to the scope conditions surface enum.
 */
function inferSurface(location: string | undefined, roomType: string | null): string[] {
  const loc = (location || "").toLowerCase();
  const surfaces: string[] = [];

  if (loc.includes("ceiling") || loc.includes("overhead")) surfaces.push("ceiling");
  if (loc.includes("wall") || loc.includes("corner") || loc.includes("elevation")) surfaces.push("wall");
  if (loc.includes("floor") || loc.includes("base") || loc.includes("subfloor")) surfaces.push("floor");
  if (loc.includes("roof") || loc.includes("slope") || loc.includes("shingle")) surfaces.push("roof");
  if (loc.includes("trim") || loc.includes("fascia") || loc.includes("soffit")) surfaces.push("trim");
  if (loc.includes("cabinet") || loc.includes("vanity")) surfaces.push("cabinet");

  // If no surface inferred from location, infer from room type
  if (surfaces.length === 0) {
    if (roomType?.startsWith("exterior_roof")) surfaces.push("roof");
    else if (roomType?.startsWith("exterior_elevation")) surfaces.push("wall");
    else if (roomType?.startsWith("exterior_gutter")) surfaces.push("gutter");
    else if (roomType?.startsWith("interior_")) surfaces.push("wall", "ceiling", "floor");
  }

  return surfaces.length > 0 ? surfaces : ["wall"]; // fallback
}

/**
 * Infer room zone from room type for scope condition matching.
 */
function inferZoneType(roomType: string | null): string | null {
  if (!roomType) return null;
  if (roomType.includes("kitchen")) return "kitchen";
  if (roomType.includes("bathroom")) return "bathroom";
  if (roomType.includes("laundry")) return "laundry";
  if (roomType.includes("basement")) return "basement";
  if (roomType.includes("attic")) return "attic";
  if (roomType.startsWith("exterior_roof")) return "roof";
  if (roomType.startsWith("exterior_elevation")) return "exterior_wall";
  return null;
}

// ─── Scope Condition Matching ──────────────────────────────────────────────

/**
 * Check if a catalog item's scopeConditions match the current damage context.
 * All present condition arrays use OR logic within, AND logic across arrays.
 */
function matchesScopeConditions(
  conditions: any,
  damageType: string,
  severity: string,
  surfaces: string[],
  roomType: string | null,
  zoneType: string | null
): boolean {
  if (!conditions) return false;

  // damage_types — at least one must match
  if (conditions.damage_types && conditions.damage_types.length > 0) {
    if (!conditions.damage_types.includes(damageType)) return false;
  }

  // severity — at least one must match
  if (conditions.severity && conditions.severity.length > 0) {
    if (!conditions.severity.includes(severity)) return false;
  }

  // surfaces — at least one inferred surface must match
  if (conditions.surfaces && conditions.surfaces.length > 0) {
    const hasOverlap = surfaces.some((s: string) => conditions.surfaces.includes(s));
    if (!hasOverlap) return false;
  }

  // room_types — if present, room type must match
  if (conditions.room_types && conditions.room_types.length > 0) {
    if (!roomType || !conditions.room_types.some((rt: string) => roomType.includes(rt))) return false;
  }

  // zone_types — if present, zone must match
  if (conditions.zone_types && conditions.zone_types.length > 0) {
    if (!zoneType || !conditions.zone_types.includes(zoneType)) return false;
  }

  return true;
}

// ─── Quantity Derivation ────────────────────────────────────────────────────

/**
 * Derive quantity from room dimensions using the catalog item's quantityFormula.
 * Matches the 13 formula types from PROMPT-16.
 */
function deriveQuantity(
  formula: string | null,
  dims: { length?: number; width?: number; height?: number } | null,
  manualQuantity?: number
): number {
  if (!formula || formula === "MANUAL") return manualQuantity || 1;
  if (!dims) return manualQuantity || 1;

  const L = dims.length || 0;
  const W = dims.width || 0;
  const H = dims.height || 8; // default 8ft ceiling

  switch (formula) {
    case "FLOOR_SF":
      return L * W;
    case "CEILING_SF":
      return L * W;
    case "WALL_SF":
      return (L + W) * 2 * H;
    case "WALL_SF_NET":
      // Wall SF minus ~15% for openings (doors/windows)
      return (L + W) * 2 * H * 0.85;
    case "WALLS_CEILING_SF":
      return (L + W) * 2 * H + L * W;
    case "PERIMETER_LF":
      return (L + W) * 2;
    case "CEILING_PERIM_LF":
      return (L + W) * 2;
    case "FLOOR_SY":
      return (L * W) / 9;
    case "ROOF_SF":
      // Roof SF uses a pitch multiplier; default 4/12 pitch ≈ 1.054×
      return L * W * 1.054;
    case "ROOF_SQ":
      return (L * W * 1.054) / 100;
    case "VOLUME_CF":
      return L * W * H;
    case "EACH":
      return 1;
    default:
      return manualQuantity || 1;
  }
}

// ─── Companion Resolution ───────────────────────────────────────────────────

/**
 * Resolve companion chains: for each matched item, check companionRules.auto_adds
 * and recursively add those items (up to 3 levels deep to prevent infinite loops).
 */
async function resolveCompanions(
  matchedCodes: Set<string>,
  allCatalogItems: any[],
  maxDepth: number = 3
): Promise<string[]> {
  const companionCodes: string[] = [];
  const visited = new Set(matchedCodes);
  let frontier = Array.from(matchedCodes);

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];

    for (const code of frontier) {
      const item = allCatalogItems.find((i: any) => i.code === code);
      if (!item?.companionRules?.auto_adds) continue;

      for (const companionCode of item.companionRules.auto_adds) {
        if (!visited.has(companionCode)) {
          visited.add(companionCode);
          companionCodes.push(companionCode);
          nextFrontier.push(companionCode);
        }
      }
    }

    frontier = nextFrontier;
  }

  return companionCodes;
}

// ─── Main Auto-Scope Function ───────────────────────────────────────────────

/**
 * Main entry point: given a damage observation, auto-generate scope items.
 * Called from the damage creation route handler.
 */
export async function autoScopeFromDamage(
  damage: DamageContext,
  regionId: string = "US_NATIONAL"
): Promise<AutoScopeResult> {
  const warnings: string[] = [];

  // 1. Fetch room context
  const roomRows = await db
    .select()
    .from(inspectionRooms)
    .where(eq(inspectionRooms.id, damage.roomId))
    .limit(1);
  const room: RoomContext | null = roomRows[0] || null;

  if (!room) {
    return { itemsCreated: 0, items: [], warnings: ["Room not found — cannot auto-scope"] };
  }

  const dims = (room.dimensions as any) || null;
  const surfaces = inferSurface(damage.location, room.roomType);
  const zoneType = inferZoneType(room.roomType);

  // 2. Fetch all active catalog items
  const catalog = await db
    .select()
    .from(scopeLineItems)
    .where(eq(scopeLineItems.isActive, true));

  // 3. Match items by scope conditions
  const matchedItems = catalog.filter((item) =>
    matchesScopeConditions(
      item.scopeConditions,
      damage.damageType,
      damage.severity || "moderate",
      surfaces,
      room.roomType,
      zoneType
    )
  );

  if (matchedItems.length === 0) {
    warnings.push(`No catalog items matched damage_type="${damage.damageType}" on surfaces=[${surfaces.join(",")}]`);
    return { itemsCreated: 0, items: [], warnings };
  }

  // 4. Resolve companion chains
  const matchedCodes = new Set(matchedItems.map((i) => i.code));
  const companionCodes = await resolveCompanions(matchedCodes, catalog);

  const companionItems = catalog.filter((i) => companionCodes.includes(i.code));

  // 5. Combine matched + companions, check for excludes
  const allItems = [...matchedItems, ...companionItems];
  const allCodes = new Set(allItems.map((i) => i.code));

  // Apply exclude rules
  const excludedCodes = new Set<string>();
  for (const item of allItems) {
    const rules = item.companionRules as any;
    if (rules?.excludes) {
      for (const excCode of rules.excludes) {
        if (allCodes.has(excCode)) {
          excludedCodes.add(excCode);
          warnings.push(`Excluded ${excCode} — conflicts with ${item.code}`);
        }
      }
    }
  }

  const finalItems = allItems.filter((i) => !excludedCodes.has(i.code));

  // 6. Price and create line items
  const createdItems: AutoScopeResult["items"] = [];

  for (const catalogItem of finalItems) {
    // Derive quantity
    const quantity = deriveQuantity(catalogItem.quantityFormula, dims);
    if (quantity <= 0) continue;

    // Lookup regional price
    const priceRows = await db
      .select()
      .from(regionalPriceSets)
      .where(
        and(
          eq(regionalPriceSets.lineItemCode, catalogItem.code),
          eq(regionalPriceSets.regionId, regionId)
        )
      )
      .limit(1);

    const price = priceRows[0];
    const wasteFactor = catalogItem.defaultWasteFactor || 0;
    const baseCost = (price?.materialCost || 0) + (price?.laborCost || 0) + (price?.equipmentCost || 0);
    const unitPrice = baseCost * (1 + wasteFactor / 100);
    const totalPrice = unitPrice * quantity;

    // Create line item
    const isCompanion = companionCodes.includes(catalogItem.code);

    await db.insert(lineItems).values({
      sessionId: damage.sessionId,
      roomId: damage.roomId,
      damageId: damage.damageId,
      category: catalogItem.tradeCode,
      action: mapActivityToAction(catalogItem.activityType),
      description: catalogItem.description,
      xactCode: catalogItem.code,
      quantity,
      unit: catalogItem.unit,
      unitPrice,
      totalPrice,
      depreciationType: "Recoverable",
      wasteFactor: Math.round(wasteFactor),
      provenance: "auto_scope",
    });

    createdItems.push({
      code: catalogItem.code,
      description: catalogItem.description,
      quantity,
      unit: catalogItem.unit,
      unitPrice,
      totalPrice,
      source: isCompanion ? "companion" : "auto_scope",
    });
  }

  return {
    itemsCreated: createdItems.length,
    items: createdItems,
    warnings,
  };
}

/**
 * Map catalog activityType to Xactimate action codes.
 * Matches the PROMPT-16 action mapping.
 */
function mapActivityToAction(activityType: string | null): string {
  const map: Record<string, string> = {
    "replace": "R&R",
    "remove": "Tear Off",
    "install": "Install",
    "repair": "Repair",
    "clean": "Clean",
    "paint": "Paint",
    "labor_only": "Labor Only",
    "reset": "Detach & Reset",
  };
  return map[activityType || "replace"] || "R&R";
}
```

### Integration Point: `server/routes.ts` — Modify Damage Creation Handler

**Current** (lines 796-817): Creates damage row and increments counter. Returns damage.

**Modified:** After creating the damage, call `autoScopeFromDamage()` and include the auto-scope results in the response.

```ts
// At top of routes.ts, add import:
import { autoScopeFromDamage } from "./scopeAssemblyHook";

// Replace the POST /api/inspection/:sessionId/damages handler:
app.post("/api/inspection/:sessionId/damages", authenticateRequest, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const { roomId, description, damageType, severity, location, measurements, extent, hitCount } = req.body;

    if (!roomId || !description) {
      return res.status(400).json({ message: "roomId and description are required" });
    }

    // 1. Create the damage observation (existing logic)
    const damage = await storage.createDamage({
      sessionId,
      roomId,
      description,
      damageType: damageType || null,
      severity: severity || null,
      location: location || null,
      measurements: measurements || null,
    });
    await storage.incrementRoomDamageCount(roomId);

    // 2. Auto-scope from damage (NEW — PROMPT-18)
    let autoScope = null;
    if (damageType && severity) {
      try {
        autoScope = await autoScopeFromDamage({
          sessionId,
          roomId,
          damageId: damage.id,
          damageType,
          severity,
          location,
          extent,
          hitCount,
        });
      } catch (err) {
        console.error("Auto-scope error (non-blocking):", err);
        // Auto-scope failure should never block damage creation
      }
    }

    res.status(201).json({
      damage,
      autoScope: autoScope || { itemsCreated: 0, items: [], warnings: ["Auto-scope skipped — damageType or severity missing"] },
    });
  } catch (error: any) {
    console.error("Server error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
```

### Voice Agent Integration

The frontend `ActiveInspection.tsx` handles `add_damage` tool calls on lines ~710-730 by POSTing to `/api/inspection/:sessionId/damages`. The response now includes `autoScope`. The frontend should:

1. Read `autoScope.itemsCreated` and `autoScope.items`
2. Update the estimate panel with the new items
3. Feed the auto-scope summary back to the voice agent as the tool result

**Modify the tool result sent back to OpenAI Realtime:**

Instead of returning just the damage record, return:
```ts
// In ActiveInspection.tsx, inside the add_damage tool handler:
const toolResult = {
  damage: response.damage,
  autoScope: {
    itemsCreated: response.autoScope.itemsCreated,
    summary: response.autoScope.items.map((i: any) =>
      `${i.code}: ${i.description} — ${i.quantity} ${i.unit} @ $${i.unitPrice.toFixed(2)} = $${i.totalPrice.toFixed(2)} [${i.source}]`
    ).join("\n"),
    warnings: response.autoScope.warnings,
  },
};
```

This lets the voice agent say: *"Got it — water intrusion on the south wall. I've auto-generated 4 scope items: drywall removal, new drywall, tape and float, and two coats of paint. The running total for this room is $1,847. Does that look right, or do you need to adjust anything?"*

---

## Part B — Photo Analysis → Damage Suggestion Pipeline

### Goal
The GPT-4o Vision photo analysis already returns `damageVisible` array in its response (see `routes.ts` lines 994-1115). Currently, this data is stored in `inspectionPhotos.analysis` JSONB and **never used again**.

Connect it: when photo analysis detects damage, automatically suggest damage observations and optionally auto-create them.

### File: `server/photoScopeBridge.ts` — New File

```ts
/**
 * photoScopeBridge.ts
 *
 * Bridges photo analysis results to damage observations and scope assembly.
 * When GPT-4o Vision detects damage in a photo, this service:
 *   1. Maps Vision damage types to our damageType enum
 *   2. Creates suggested damage observations
 *   3. Optionally triggers auto-scope for each
 */

import { db } from "./db";
import { damageObservations, inspectionRooms } from "@shared/schema";
import { eq } from "drizzle-orm";
import { autoScopeFromDamage } from "./scopeAssemblyHook";

// ─── Vision Damage Type → Our Damage Type Mapping ──────────────────────────

const VISION_TO_DAMAGE_TYPE: Record<string, string> = {
  // Water damage
  "water damage": "water_intrusion",
  "water stain": "water_stain",
  "water staining": "water_stain",
  "moisture damage": "water_intrusion",
  "mold": "mold",
  "mildew": "mold",
  "swelling": "water_intrusion",
  "warping": "water_intrusion",
  "buckling": "water_intrusion",

  // Hail/Wind
  "hail damage": "hail_impact",
  "hail impact": "hail_impact",
  "dent": "dent",
  "denting": "dent",
  "wind damage": "wind_damage",
  "missing shingle": "missing",
  "missing shingles": "missing",
  "lifted shingle": "wind_damage",
  "creased shingle": "wind_damage",

  // Structural
  "crack": "crack",
  "cracking": "crack",
  "fracture": "crack",
  "rot": "rot",
  "wood rot": "rot",
  "decay": "rot",

  // General
  "wear": "wear_tear",
  "aging": "wear_tear",
  "deterioration": "wear_tear",
  "mechanical damage": "mechanical",
  "impact damage": "mechanical",
};

const VISION_SEVERITY_MAP: Record<string, string> = {
  "minor": "minor",
  "slight": "minor",
  "light": "minor",
  "moderate": "moderate",
  "medium": "moderate",
  "significant": "moderate",
  "severe": "severe",
  "heavy": "severe",
  "extensive": "severe",
  "major": "severe",
};

interface PhotoAnalysis {
  description: string;
  damageVisible: Array<{
    type: string;
    severity: string;
    notes: string;
  }>;
  matchesExpected: boolean;
  matchConfidence: number;
}

interface PhotoDamageSuggestion {
  description: string;
  damageType: string;
  severity: string;
  notes: string;
  confidence: number;
  autoCreated: boolean;
  damageId?: number;
  autoScope?: any;
}

/**
 * Process photo analysis results and generate damage suggestions.
 *
 * @param analysis - The GPT-4o Vision analysis result
 * @param sessionId - Current inspection session
 * @param roomId - Room where the photo was taken
 * @param autoCreate - If true, automatically create damage observations (default: false)
 */
export async function processPhotoAnalysis(
  analysis: PhotoAnalysis,
  sessionId: number,
  roomId: number,
  autoCreate: boolean = false
): Promise<PhotoDamageSuggestion[]> {
  const suggestions: PhotoDamageSuggestion[] = [];

  if (!analysis.damageVisible || analysis.damageVisible.length === 0) {
    return suggestions;
  }

  for (const detected of analysis.damageVisible) {
    // Map Vision damage type to our enum
    const normalizedType = detected.type.toLowerCase().trim();
    const damageType = VISION_TO_DAMAGE_TYPE[normalizedType] || "other";

    // Map severity
    const normalizedSeverity = (detected.severity || "moderate").toLowerCase().trim();
    const severity = VISION_SEVERITY_MAP[normalizedSeverity] || "moderate";

    const suggestion: PhotoDamageSuggestion = {
      description: `[Photo-detected] ${detected.type}: ${detected.notes || analysis.description}`,
      damageType,
      severity,
      notes: detected.notes || "",
      confidence: analysis.matchConfidence || 0.5,
      autoCreated: false,
    };

    // Auto-create damage observation if requested and confidence is high enough
    if (autoCreate && analysis.matchConfidence >= 0.7) {
      try {
        const [damage] = await db
          .insert(damageObservations)
          .values({
            sessionId,
            roomId,
            description: suggestion.description,
            damageType,
            severity,
            location: "Photo-detected (verify location on-site)",
            measurements: null,
          })
          .returning();

        suggestion.autoCreated = true;
        suggestion.damageId = damage.id;

        // Increment room damage count
        await db
          .update(inspectionRooms)
          .set({ damageCount: db.raw(`damage_count + 1`) as any })
          .where(eq(inspectionRooms.id, roomId));

        // Trigger auto-scope
        const autoScope = await autoScopeFromDamage({
          sessionId,
          roomId,
          damageId: damage.id,
          damageType,
          severity,
        });
        suggestion.autoScope = autoScope;
      } catch (err) {
        console.error("Photo damage auto-create error:", err);
        // Non-blocking — return as suggestion only
      }
    }

    suggestions.push(suggestion);
  }

  return suggestions;
}
```

### Integration Point: `server/routes.ts` — Enhance Photo Analysis Response

**Current** (lines 994-1115): Analyzes photo, saves analysis to `inspectionPhotos.analysis`.

**Add** after the analysis is saved (before `res.json(analysis)`):

```ts
// At top of routes.ts, add import:
import { processPhotoAnalysis } from "./photoScopeBridge";

// Inside the POST /api/inspection/:sessionId/photos/:photoId/analyze handler,
// after `await storage.updatePhoto(photoId, { analysis, matchesRequest: ... })`:

// Process photo analysis for damage suggestions (NEW — PROMPT-18)
let damageSuggestions: any[] = [];
const roomId = req.body.roomId; // Must be passed with analysis request
if (roomId && analysis.damageVisible && analysis.damageVisible.length > 0) {
  try {
    damageSuggestions = await processPhotoAnalysis(
      analysis,
      sessionId,
      roomId,
      false // Don't auto-create — let voice agent confirm first
    );
  } catch (err) {
    console.error("Photo→damage bridge error (non-blocking):", err);
  }
}

res.json({
  ...analysis,
  damageSuggestions, // NEW: damage observations the voice agent can confirm
});
```

### Voice Agent Behavior

When the photo analysis comes back with `damageSuggestions`, the voice agent should:

1. Acknowledge the photo: *"Got the photo. I can see water staining on the ceiling."*
2. Present suggestions: *"The AI detected water intrusion damage, moderate severity. Should I add that as a damage observation?"*
3. If confirmed, call `add_damage` with the suggested values — which triggers auto-scope from Part A
4. If denied, move on

This creates a **photo → damage → scope** pipeline that works through the voice conversation naturally.

---

## Part C — Supplemental ESX Export (Replace Placeholder)

### Goal
Replace the hardcoded `"supplemental esx placeholder"` at `routes.ts` line 2061 with actual delta ESX generation that shows only the supplemental changes.

### File: `server/routes.ts` — Modify Supplemental ESX Export Handler

Replace the existing handler (lines 2048-2065) with:

```ts
app.post("/api/supplemental/:id/export/esx", authenticateRequest, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const supplemental = await storage.getSupplemental(id);
    if (!supplemental) return res.status(404).json({ message: "Supplemental not found" });

    const claim = await storage.getClaim(supplemental.claimId);
    if (!claim) return res.status(404).json({ message: "Claim not found" });

    // Build a delta line item set from the supplemental record
    const deltaItems = buildSupplementalDelta(supplemental);

    if (deltaItems.length === 0) {
      return res.status(400).json({ message: "No items in supplemental to export" });
    }

    // Generate ESX using the same generator, but with supplemental flag
    const esxBuffer = await generateSupplementalESX(supplemental, claim, deltaItems);

    const fileName = `${claim.claimNumber || "supplemental"}_supplemental_${id}.esx`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(esxBuffer);
  } catch (error: any) {
    console.error("Supplemental ESX export error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
```

### File: `server/esxGenerator.ts` — Add Supplemental ESX Function

Add to the existing `esxGenerator.ts` file:

```ts
import { SupplementalClaim, Claim } from "@shared/schema";

interface SupplementalLineItemXML {
  id: number;
  description: string;
  category: string;
  action: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  laborTotal: number;
  laborHours: number;
  material: number;
  tax: number;
  acvTotal: number;
  rcvTotal: number;
  room: string;
  changeType: "added" | "modified" | "removed";
}

/**
 * Build delta line items from a supplemental claim record.
 * Supplemental claims store new/modified/removed items in JSONB.
 */
export function buildSupplementalDelta(supplemental: SupplementalClaim): SupplementalLineItemXML[] {
  const items: SupplementalLineItemXML[] = [];

  // New items
  const newItems = (supplemental.newLineItems as any[]) || [];
  for (const item of newItems) {
    const totalPrice = (item.quantity || 0) * (item.unitPrice || 0);
    items.push({
      id: item.id || 0,
      description: item.description || "",
      category: item.category || "General",
      action: item.action || "&",
      quantity: item.quantity || 0,
      unit: item.unit || "EA",
      unitPrice: item.unitPrice || 0,
      laborTotal: totalPrice * 0.35,
      laborHours: (totalPrice * 0.35) / 75,
      material: totalPrice * 0.65,
      tax: totalPrice * 0.05,
      acvTotal: totalPrice * 0.7,
      rcvTotal: totalPrice,
      room: item.room || "Unassigned",
      changeType: "added",
    });
  }

  // Modified items
  const modifiedItems = (supplemental.modifiedLineItems as any[]) || [];
  for (const item of modifiedItems) {
    const totalPrice = (item.newQuantity || item.quantity || 0) * (item.newUnitPrice || item.unitPrice || 0);
    items.push({
      id: item.id || 0,
      description: item.description || "",
      category: item.category || "General",
      action: item.action || "&",
      quantity: item.newQuantity || item.quantity || 0,
      unit: item.unit || "EA",
      unitPrice: item.newUnitPrice || item.unitPrice || 0,
      laborTotal: totalPrice * 0.35,
      laborHours: (totalPrice * 0.35) / 75,
      material: totalPrice * 0.65,
      tax: totalPrice * 0.05,
      acvTotal: totalPrice * 0.7,
      rcvTotal: totalPrice,
      room: item.room || "Unassigned",
      changeType: "modified",
    });
  }

  return items;
}

/**
 * Generate a supplemental ESX file showing only the delta items.
 * Uses the same XACTDOC.XML + GENERIC_ROUGHDRAFT.XML structure as the main ESX,
 * but tagged as a supplemental.
 */
export async function generateSupplementalESX(
  supplemental: SupplementalClaim,
  claim: Claim,
  deltaItems: SupplementalLineItemXML[]
): Promise<Buffer> {
  const transactionId = `CLAIMSIQ-SUPP-${supplemental.id}-${Date.now()}`;

  // Calculate supplemental totals
  const totalRCV = deltaItems
    .filter((i) => i.changeType !== "removed")
    .reduce((sum, i) => sum + i.rcvTotal, 0);
  const totalACV = deltaItems
    .filter((i) => i.changeType !== "removed")
    .reduce((sum, i) => sum + i.acvTotal, 0);

  const xactdocXml = `<?xml version="1.0" encoding="UTF-8"?>
<XACTDOC>
  <XACTNET_INFO>
    <transactionId>${transactionId}</transactionId>
    <carrierId>CLAIMSIQ</carrierId>
    <carrierName>Claims IQ</carrierName>
    <transactionType>SUPPLEMENT</transactionType>
    <CONTROL_POINTS>
      <CONTROL_POINT name="SUPPLEMENT" status="COMPLETE"/>
    </CONTROL_POINTS>
    <SUMMARY>
      <totalRCV>${totalRCV.toFixed(2)}</totalRCV>
      <totalACV>${totalACV.toFixed(2)}</totalACV>
      <totalDepreciation>${(totalRCV - totalACV).toFixed(2)}</totalDepreciation>
      <deductible>0.00</deductible>
      <lineItemCount>${deltaItems.length}</lineItemCount>
      <supplementReason>${escapeXml(supplemental.reason || "")}</supplementReason>
    </SUMMARY>
  </XACTNET_INFO>
  <CONTACTS>
    <CONTACT type="INSURED">
      <name>${escapeXml(claim?.insuredName || "")}</name>
      <address>${escapeXml(claim?.propertyAddress || "")}</address>
      <city>${escapeXml(claim?.city || "")}</city>
      <state>${claim?.state || ""}</state>
      <zip>${claim?.zip || ""}</zip>
    </CONTACT>
    <CONTACT type="ADJUSTER">
      <name>Claims IQ Inspector</name>
    </CONTACT>
  </CONTACTS>
  <ADM>
    <dateOfLoss>${claim?.dateOfLoss || ""}</dateOfLoss>
    <dateInspected>${new Date().toISOString().split("T")[0]}</dateInspected>
    <COVERAGE_LOSS>
      <claimNumber>${escapeXml(claim?.claimNumber || "")}</claimNumber>
    </COVERAGE_LOSS>
  </ADM>
</XACTDOC>`;

  // Group delta items by room
  const roomGroups: { [key: string]: SupplementalLineItemXML[] } = {};
  deltaItems.forEach((item) => {
    const key = item.room || "Unassigned";
    if (!roomGroups[key]) roomGroups[key] = [];
    roomGroups[key].push(item);
  });

  let itemsXml = "";
  Object.entries(roomGroups).forEach(([roomName, roomItems]) => {
    itemsXml += `        <GROUP type="room" name="${escapeXml(roomName)}">\n`;
    itemsXml += `          <ITEMS>\n`;

    roomItems.forEach((item, idx) => {
      const cat = item.category.substring(0, 3).toUpperCase();
      const changeAttr = ` changeType="${item.changeType}"`;
      itemsXml += `            <ITEM lineNum="${idx + 1}" cat="${cat}" sel="1/2++" act="${item.action}" desc="${escapeXml(item.description)}" qty="${item.quantity.toFixed(2)}" unit="${item.unit}" total="${item.rcvTotal.toFixed(2)}" laborTotal="${item.laborTotal.toFixed(2)}" material="${item.material.toFixed(2)}" tax="${item.tax.toFixed(2)}" acvTotal="${item.acvTotal.toFixed(2)}" rcvTotal="${item.rcvTotal.toFixed(2)}"${changeAttr}/>\n`;
    });

    itemsXml += `          </ITEMS>\n`;
    itemsXml += `        </GROUP>\n`;
  });

  const roughdraftXml = `<?xml version="1.0" encoding="UTF-8"?>
<GENERIC_ROUGHDRAFT>
  <LINE_ITEM_DETAIL>
    <GROUP type="estimate" name="Supplemental Estimate">
      <GROUP type="level" name="Supplemental — ${escapeXml(supplemental.reason || "")}">
${itemsXml}
      </GROUP>
    </GROUP>
  </LINE_ITEM_DETAIL>
</GENERIC_ROUGHDRAFT>`;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("data", (data) => chunks.push(data));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    archive.append(Buffer.from(xactdocXml), { name: "XACTDOC.XML" });
    archive.append(Buffer.from(roughdraftXml), { name: "GENERIC_ROUGHDRAFT.XML" });
    archive.finalize();
  });
}
```

---

## Part D — Phase Transition Validation & Completeness Gates

### Goal
Add completeness checks at phase transitions so the voice agent (and the UI) can enforce that key evidence is captured before moving forward. This is not a hard block — the adjuster can override — but it generates warnings.

### File: `server/phaseValidation.ts` — New File

```ts
/**
 * phaseValidation.ts
 *
 * Validates inspection completeness at phase transitions.
 * Returns warnings (not hard blocks) so adjusters can override.
 */

import { db } from "./db";
import {
  inspectionRooms,
  damageObservations,
  lineItems,
  inspectionPhotos,
  moistureReadings,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

interface PhaseValidationResult {
  canProceed: boolean;    // Always true (warnings only, not hard blocks)
  warnings: string[];
  missingItems: string[];
  completionScore: number; // 0-100
}

/**
 * Validate readiness to transition FROM the given phase TO the next.
 */
export async function validatePhaseTransition(
  sessionId: number,
  currentPhase: number,
  perilType?: string
): Promise<PhaseValidationResult> {
  const warnings: string[] = [];
  const missingItems: string[] = [];

  switch (currentPhase) {
    case 1: // Pre-Inspection → Session Setup
      return validatePhase1(sessionId);

    case 2: // Session Setup → Exterior
      return validatePhase2(sessionId);

    case 3: // Exterior → Interior
      return validatePhase3(sessionId);

    case 4: // Interior → Water/Moisture
      return validatePhase4(sessionId, perilType);

    case 5: // Water/Moisture → Evidence Review
      return validatePhase5(sessionId, perilType);

    case 6: // Evidence Review → Estimate Assembly
      return validatePhase6(sessionId);

    case 7: // Estimate Assembly → Finalize
      return validatePhase7(sessionId);

    default:
      return { canProceed: true, warnings: [], missingItems: [], completionScore: 100 };
  }
}

async function validatePhase1(sessionId: number): Promise<PhaseValidationResult> {
  const warnings: string[] = [];
  const missingItems: string[] = [];

  // Check for property verification photo
  const verificationPhotos = await db
    .select()
    .from(inspectionPhotos)
    .where(
      and(
        eq(inspectionPhotos.sessionId, sessionId),
        eq(inspectionPhotos.photoType, "address_verification")
      )
    );

  if (verificationPhotos.length === 0) {
    warnings.push("No property verification photo captured");
    missingItems.push("Property verification photo (front of building with address visible)");
  }

  const score = verificationPhotos.length > 0 ? 100 : 20;
  return { canProceed: true, warnings, missingItems, completionScore: score };
}

async function validatePhase2(sessionId: number): Promise<PhaseValidationResult> {
  // Phase 2 (Session Setup) is mostly configuration — lightweight check
  return { canProceed: true, warnings: [], missingItems: [], completionScore: 100 };
}

async function validatePhase3(sessionId: number): Promise<PhaseValidationResult> {
  const warnings: string[] = [];
  const missingItems: string[] = [];

  // Get exterior rooms
  const rooms = await db
    .select()
    .from(inspectionRooms)
    .where(eq(inspectionRooms.sessionId, sessionId));

  const exteriorRooms = rooms.filter((r) =>
    r.roomType?.startsWith("exterior_") || r.phase === 3
  );

  if (exteriorRooms.length === 0) {
    warnings.push("No exterior rooms/areas documented");
    missingItems.push("At least one exterior area (roof, elevation, etc.)");
  }

  // Check for roof documentation (roof slopes)
  const roofRooms = exteriorRooms.filter((r) => r.roomType?.includes("roof"));
  if (roofRooms.length === 0) {
    warnings.push("No roof slopes documented — verify roof was inspected");
    missingItems.push("Roof slope documentation");
  }

  // Check each exterior room has at least one photo
  for (const room of exteriorRooms) {
    const photos = await db
      .select({ count: sql<number>`count(*)` })
      .from(inspectionPhotos)
      .where(
        and(
          eq(inspectionPhotos.sessionId, sessionId),
          eq(inspectionPhotos.roomId, room.id)
        )
      );
    const photoCount = photos[0]?.count || 0;
    if (photoCount === 0) {
      warnings.push(`${room.name} has no photos`);
      missingItems.push(`Photo for ${room.name}`);
    }
  }

  // Check for damages with no line items (scope gap)
  for (const room of exteriorRooms) {
    const damages = await db
      .select({ count: sql<number>`count(*)` })
      .from(damageObservations)
      .where(
        and(
          eq(damageObservations.sessionId, sessionId),
          eq(damageObservations.roomId, room.id)
        )
      );
    const items = await db
      .select({ count: sql<number>`count(*)` })
      .from(lineItems)
      .where(
        and(
          eq(lineItems.sessionId, sessionId),
          eq(lineItems.roomId, room.id)
        )
      );
    if ((damages[0]?.count || 0) > 0 && (items[0]?.count || 0) === 0) {
      warnings.push(`${room.name}: ${damages[0]?.count} damage(s) documented but no line items — scope gap`);
    }
  }

  const completedRooms = exteriorRooms.filter((r) => r.status === "complete").length;
  const score = exteriorRooms.length > 0
    ? Math.round((completedRooms / exteriorRooms.length) * 100)
    : 0;

  return { canProceed: true, warnings, missingItems, completionScore: score };
}

async function validatePhase4(sessionId: number, perilType?: string): Promise<PhaseValidationResult> {
  const warnings: string[] = [];
  const missingItems: string[] = [];

  const rooms = await db
    .select()
    .from(inspectionRooms)
    .where(eq(inspectionRooms.sessionId, sessionId));

  const interiorRooms = rooms.filter((r) =>
    r.roomType?.startsWith("interior_") || r.phase === 4
  );

  if (interiorRooms.length === 0) {
    warnings.push("No interior rooms documented");
    missingItems.push("At least one interior room");
  }

  // Check for scope gaps in interior rooms
  for (const room of interiorRooms) {
    const damages = await db
      .select({ count: sql<number>`count(*)` })
      .from(damageObservations)
      .where(
        and(
          eq(damageObservations.sessionId, sessionId),
          eq(damageObservations.roomId, room.id)
        )
      );
    const items = await db
      .select({ count: sql<number>`count(*)` })
      .from(lineItems)
      .where(
        and(
          eq(lineItems.sessionId, sessionId),
          eq(lineItems.roomId, room.id)
        )
      );

    if ((damages[0]?.count || 0) > 0 && (items[0]?.count || 0) === 0) {
      warnings.push(`${room.name}: damages documented but no scope items`);
    }

    // Check DRY without PNT (common oversight)
    if ((items[0]?.count || 0) > 0) {
      const roomItems = await db
        .select()
        .from(lineItems)
        .where(
          and(
            eq(lineItems.sessionId, sessionId),
            eq(lineItems.roomId, room.id)
          )
        );
      const hasDrywall = roomItems.some((i) => i.category === "DRY" || i.category === "Drywall");
      const hasPainting = roomItems.some((i) => i.category === "PNT" || i.category === "Painting");
      if (hasDrywall && !hasPainting) {
        warnings.push(`${room.name}: Drywall scope without painting — add paint finish?`);
      }
    }
  }

  const completedRooms = interiorRooms.filter((r) => r.status === "complete").length;
  const score = interiorRooms.length > 0
    ? Math.round((completedRooms / interiorRooms.length) * 100)
    : 0;

  return { canProceed: true, warnings, missingItems, completionScore: score };
}

async function validatePhase5(sessionId: number, perilType?: string): Promise<PhaseValidationResult> {
  const warnings: string[] = [];
  const missingItems: string[] = [];

  // Only validate moisture for water claims
  if (perilType !== "water") {
    return { canProceed: true, warnings: [], missingItems: [], completionScore: 100 };
  }

  // Check for moisture readings
  const readings = await db
    .select()
    .from(moistureReadings)
    .where(eq(moistureReadings.sessionId, sessionId));

  if (readings.length === 0) {
    warnings.push("Water claim but no moisture readings documented");
    missingItems.push("Moisture readings at affected areas");
  }

  // Check for elevated readings without mitigation line items
  const elevatedReadings = readings.filter((r) => {
    const dry = r.dryStandard || 15; // default dry standard
    return r.reading > dry;
  });

  if (elevatedReadings.length > 0) {
    const allItems = await db
      .select()
      .from(lineItems)
      .where(eq(lineItems.sessionId, sessionId));

    const hasMitigation = allItems.some(
      (i) => i.category === "MIT" || i.category === "Mitigation"
    );

    if (!hasMitigation) {
      warnings.push(
        `${elevatedReadings.length} elevated moisture reading(s) but no mitigation items in scope`
      );
      missingItems.push("Mitigation/extraction line items for wet areas");
    }
  }

  const score = readings.length >= 3 ? 100 : Math.round((readings.length / 3) * 100);
  return { canProceed: true, warnings, missingItems, completionScore: score };
}

async function validatePhase6(sessionId: number): Promise<PhaseValidationResult> {
  const warnings: string[] = [];
  const missingItems: string[] = [];

  // Check photo completeness
  const photos = await db
    .select()
    .from(inspectionPhotos)
    .where(eq(inspectionPhotos.sessionId, sessionId));

  if (photos.length < 5) {
    warnings.push(`Only ${photos.length} photos — most inspections need 10+`);
    missingItems.push("Additional evidence photos");
  }

  // Check for overview photos
  const overviews = photos.filter((p) => p.photoType === "overview");
  if (overviews.length === 0) {
    warnings.push("No overview photos captured");
    missingItems.push("Overview photo of property/rooms");
  }

  // Check for damage detail photos matching damage observations
  const damages = await db
    .select()
    .from(damageObservations)
    .where(eq(damageObservations.sessionId, sessionId));

  const damagePhotos = photos.filter((p) => p.damageId !== null);
  if (damages.length > 0 && damagePhotos.length === 0) {
    warnings.push(`${damages.length} damage(s) documented but no damage detail photos`);
    missingItems.push("Damage detail photos linked to observations");
  }

  const score = Math.min(100, Math.round((photos.length / 10) * 100));
  return { canProceed: true, warnings, missingItems, completionScore: score };
}

async function validatePhase7(sessionId: number): Promise<PhaseValidationResult> {
  const warnings: string[] = [];
  const missingItems: string[] = [];

  // Check for line items
  const items = await db
    .select()
    .from(lineItems)
    .where(eq(lineItems.sessionId, sessionId));

  if (items.length === 0) {
    warnings.push("No line items in estimate — cannot finalize empty estimate");
    missingItems.push("At least one estimate line item");
  }

  // Check for items without pricing
  const unpricedItems = items.filter((i) => !i.unitPrice || i.unitPrice === 0);
  if (unpricedItems.length > 0) {
    warnings.push(`${unpricedItems.length} item(s) have $0 unit price — verify pricing`);
  }

  // Check for scope gaps (rooms with damage but no items)
  const rooms = await db
    .select()
    .from(inspectionRooms)
    .where(eq(inspectionRooms.sessionId, sessionId));

  for (const room of rooms) {
    if ((room.damageCount || 0) > 0) {
      const roomItems = items.filter((i) => i.roomId === room.id);
      if (roomItems.length === 0) {
        warnings.push(`${room.name}: ${room.damageCount} damage(s) but 0 line items`);
      }
    }
  }

  const score = items.length > 0 ? Math.min(100, Math.round((items.filter((i) => (i.unitPrice || 0) > 0).length / Math.max(items.length, 1)) * 100)) : 0;
  return { canProceed: true, warnings, missingItems, completionScore: score };
}
```

### Integration Point: `server/routes.ts` — Phase Transition Route

Add a new endpoint and modify the session update handler:

```ts
// At top of routes.ts, add import:
import { validatePhaseTransition } from "./phaseValidation";

// NEW ROUTE: Validate phase transition
app.get("/api/inspection/:sessionId/validate-phase", authenticateRequest, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const session = await storage.getInspectionSession(sessionId);
    if (!session) return res.status(404).json({ message: "Session not found" });

    const claim = await storage.getClaim(session.claimId);
    const currentPhase = session.currentPhase || 1;

    const validation = await validatePhaseTransition(
      sessionId,
      currentPhase,
      claim?.perilType || undefined
    );

    res.json({
      currentPhase,
      nextPhase: currentPhase + 1,
      ...validation,
    });
  } catch (error: any) {
    console.error("Phase validation error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// MODIFY: Add validation check to session update (PATCH /api/inspection/:sessionId)
// When currentPhase is being changed, run validation and include warnings in response.
// This is advisory — the update still proceeds.
```

### Voice Agent Integration

Add to the `buildSystemInstructions()` function in `server/realtime.ts`:

```
## Phase Transition Protocol (PROMPT-18)

Before advancing to the next phase, the backend will validate completeness.
When you call set_inspection_context with a new phase number, the result will
include validation warnings. If warnings exist:

1. Read them to the adjuster: "Before we move on, I want to flag a few things..."
2. List each warning conversationally (don't read raw text)
3. Ask: "Do you want to address these now, or proceed anyway?"
4. If they want to proceed, continue. If they want to fix, guide them.

Common warnings:
- "No property verification photo" → trigger_photo_capture for address_verification
- "Damages documented but no line items" → the scope gap; offer to run auto-scope
- "Drywall without painting" → suggest adding paint finish items
- "Elevated moisture but no mitigation" → suggest MIT extraction items
```

---

## Part E — Enhanced `add_line_item` with Catalog Lookup

### Goal
When the voice agent calls `add_line_item` with a `catalogCode`, the backend should look up the catalog item, resolve its regional price, apply the waste factor, and calculate the correct `totalPrice` — instead of relying on the voice agent to guess the unit price.

### File: `server/routes.ts` — Modify Line Item Creation Handler

**Current** (lines 834-866): Takes `unitPrice` from the request body and calculates `totalPrice = qty * up * (1 + wf / 100)`.

**Enhanced:** If `catalogCode` (mapped from the tool's `xactCode` field) is provided, look up the catalog item and use its regional price.

```ts
// Replace the POST /api/inspection/:sessionId/line-items handler:
app.post("/api/inspection/:sessionId/line-items", authenticateRequest, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const parsed = lineItemCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid line item data", errors: parsed.error.flatten().fieldErrors });
    }

    const {
      roomId, damageId, category, action, description,
      xactCode, quantity, unit, unitPrice, depreciationType, wasteFactor
    } = parsed.data;

    let finalUnitPrice = unitPrice || 0;
    let finalUnit = unit || "EA";
    let finalWaste = wasteFactor || 0;
    let finalDescription = description;
    let catalogMatch = false;

    // NEW (PROMPT-18): If xactCode provided, look up catalog pricing
    if (xactCode) {
      const catalogItem = await storage.getScopeLineItemByCode(xactCode);
      if (catalogItem) {
        catalogMatch = true;
        finalDescription = description || catalogItem.description;
        finalUnit = unit || catalogItem.unit;
        finalWaste = wasteFactor ?? Math.round(catalogItem.defaultWasteFactor || 0);

        // Look up regional price (default to US_NATIONAL)
        const regionalPrice = await storage.getRegionalPrice(xactCode, "US_NATIONAL");
        if (regionalPrice) {
          const baseCost = (regionalPrice.materialCost || 0) +
                           (regionalPrice.laborCost || 0) +
                           (regionalPrice.equipmentCost || 0);
          finalUnitPrice = baseCost * (1 + finalWaste / 100);
        }
      }
    }

    const qty = quantity || 1;
    const totalPrice = qty * finalUnitPrice;

    const item = await storage.createLineItem({
      sessionId,
      roomId: roomId || null,
      damageId: damageId || null,
      category,
      action: action || null,
      description: finalDescription,
      xactCode: xactCode || null,
      quantity: qty,
      unit: finalUnit,
      unitPrice: finalUnitPrice,
      totalPrice,
      depreciationType: depreciationType || "Recoverable",
      wasteFactor: finalWaste,
    });

    res.status(201).json({
      ...item,
      catalogMatch,  // Let the frontend/voice know if catalog pricing was used
    });
  } catch (error: any) {
    console.error("Server error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
```

This means the voice agent can now say: *"Adding architectural shingles, code RFG-SHIN-AR"* — and the backend resolves the description, unit, waste factor, and regional price automatically. No more guessing.

---

## Verification Checklist

1. **Auto-scope on damage:** Create `add_damage` with `damageType: "water_intrusion"`, `severity: "moderate"`, `location: "south wall"` in a room with dimensions 12×10×8 → verify line items auto-created with correct quantities (WALL_SF=352, FLOOR_SF=120, etc.)
2. **Companion cascading:** Add damage matching `DRY-SHEET-SF` → verify `DRY-TAPE-LF`, `DRY-JOINT-SF` also created automatically
3. **Exclude rules:** Add items that match both `DRY-SHEET-SF` and `DRY-PATCH-SF` → verify patch excluded when sheet is present
4. **Photo→damage bridge:** Analyze a photo with `damageVisible: [{ type: "water stain", severity: "moderate" }]` → verify `damageSuggestions` returned in response
5. **Supplemental ESX:** Create a supplemental with `newLineItems` → export ESX → verify ZIP contains valid XACTDOC.XML and GENERIC_ROUGHDRAFT.XML with `transactionType="SUPPLEMENT"`
6. **Phase validation:** At Phase 3→4 transition with exterior rooms having damages but no line items → verify warning about scope gap
7. **Phase 5 moisture:** Water claim at Phase 5 with elevated moisture readings but no MIT items → verify mitigation warning
8. **Catalog line item:** Call `add_line_item` with `xactCode: "RFG-SHIN-AR"` → verify `catalogMatch: true` and correct regional pricing applied
9. **Voice agent flow:** Full flow: photo capture → analysis → damage suggestion → confirmation → auto-scope → phase transition → validation warnings

---

## Files Modified

| File | Action | Description |
|------|--------|-------------|
| `server/scopeAssemblyHook.ts` | **New** | Auto-scope engine triggered on damage creation |
| `server/photoScopeBridge.ts` | **New** | Maps photo analysis to damage suggestions |
| `server/phaseValidation.ts` | **New** | Phase transition completeness checks |
| `server/routes.ts` | **Modify** | Wire auto-scope into damage creation, enhance photo analysis response, replace supplemental ESX placeholder, add phase validation route, enhance line item creation with catalog lookup |
| `server/esxGenerator.ts` | **Modify** | Add `buildSupplementalDelta()` and `generateSupplementalESX()` functions |
| `server/realtime.ts` | **Modify** | Add phase transition protocol to system instructions |

## Files Referenced (Read-Only)

| File | Reason |
|------|--------|
| `shared/schema.ts` | All table schemas for queries |
| `server/seed-catalog.ts` | Catalog item structure and codes |
| `server/estimateEngine.ts` | Pricing calculation reference |
| `client/src/pages/ActiveInspection.tsx` | Frontend tool call handler integration points |
| `client/src/pages/ReviewFinalize.tsx` | Review UI for damage suggestions display |

---

## Summary

PROMPT-18 connects the fuel lines between the scope engine and the inspection workflow:

- **Part A** wires `add_damage` → `autoScopeFromDamage()` so every damage observation automatically generates scope items with companion cascading and regional pricing — the core damage→scope bridge that was missing
- **Part B** bridges photo analysis → damage suggestions so GPT-4o Vision findings flow into the scope pipeline instead of being stored and forgotten
- **Part C** replaces the placeholder supplemental ESX export with real delta ESX generation using the same XACTDOC/ROUGHDRAFT format as the main export
- **Part D** adds phase transition validation so the voice agent can flag scope gaps, missing photos, and completeness issues before the adjuster moves on
- **Part E** enhances `add_line_item` with catalog lookup so providing a catalog code automatically resolves description, unit, waste, and regional pricing — no more manual price guessing
