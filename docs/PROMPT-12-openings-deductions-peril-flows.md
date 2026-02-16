# PROMPT 12 — Wall Openings, Deductions & Peril-Specific Investigation Flows

## Goal

Implement two missing architectural layers that currently exist only in the PRDs:

1. **Wall Openings & Deductions** — Doors, windows, pass-throughs, missing walls, and overhead doors that "punch holes" in walls, deducting area from SF calculations and generating MISS_WALL elements in ESX export.
2. **Peril-Specific Investigation Protocols** — Replace the basic 3-bullet-point peril awareness in `buildSystemInstructions` with structured forensic workflows: hail impact investigation (ground collateral → test square → roof accessories) and wind uplift investigation (perimeter scan → adhesion check → directional pattern).

Both gaps were designed extensively in the architecture docs but never built. This prompt adds the full data layer, voice tools, business logic, API endpoints, ESX integration, and enhanced system instructions.

---

## Part A — Wall Openings & Deductions

### A1. New Schema Table

**File:** `shared/schema.ts`
**Insert after:** line 301 (after the `userSettings` table closing brace)

```typescript
// ── Wall Openings (MISS_WALL entries) ──────────────────────────
export const roomOpenings = pgTable("room_openings", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
  roomId: integer("room_id").notNull().references(() => inspectionRooms.id, { onDelete: "cascade" }),
  openingType: varchar("opening_type", { length: 30 }).notNull(),
  // openingType enum: "window" | "standard_door" | "overhead_door" | "missing_wall" | "pass_through" | "archway" | "cased_opening"
  wallDirection: varchar("wall_direction", { length: 20 }),
  // wallDirection enum: "north" | "south" | "east" | "west" | "front" | "rear" | "left" | "right"
  widthFt: real("width_ft").notNull(),
  heightFt: real("height_ft").notNull(),
  quantity: integer("quantity").notNull().default(1),
  opensInto: varchar("opens_into", { length: 100 }),
  // opensInto: Room name (e.g., "Hallway", "Kitchen") or "E" for exterior
  goesToFloor: boolean("goes_to_floor").default(false),
  // true for garage doors / overhead doors that extend to floor level
  goesToCeiling: boolean("goes_to_ceiling").default(false),
  // true for pass-throughs that go to ceiling
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRoomOpeningSchema = createInsertSchema(roomOpenings).omit({
  id: true,
  createdAt: true,
});

export type RoomOpening = typeof roomOpenings.$inferSelect;
export type InsertRoomOpening = z.infer<typeof insertRoomOpeningSchema>;
```

**Also add** to the existing type exports block (after the `InsertRegionalPriceSet` type at line 311):

```typescript
// (These are already exported inline above — just confirming the pattern)
```

### A2. IStorage Interface Methods

**File:** `server/storage.ts`

**Step 1 — Add import.** In the import block at the top (lines 1–24), add `roomOpenings` to the table imports and `RoomOpening, InsertRoomOpening` to the type imports:

```typescript
// Add to line 6 (after supplementalClaims):
import {
  // ... existing imports ...
  roomOpenings,
  type RoomOpening, type InsertRoomOpening,
  // ... rest of existing imports ...
} from "@shared/schema";
```

**Step 2 — Add interface methods.** Insert before the closing `}` of `IStorage` (before line 121):

```typescript
  // ── Wall Openings ──────────────────────────
  createOpening(data: InsertRoomOpening): Promise<RoomOpening>;
  getOpeningsForRoom(roomId: number): Promise<RoomOpening[]>;
  getOpeningsForSession(sessionId: number): Promise<RoomOpening[]>;
  deleteOpening(id: number): Promise<void>;
```

**Step 3 — Implement in DatabaseStorage class.** Add the implementations at the end of the class (before its closing brace):

```typescript
  async createOpening(data: InsertRoomOpening): Promise<RoomOpening> {
    const [opening] = await db.insert(roomOpenings).values(data).returning();
    return opening;
  }

  async getOpeningsForRoom(roomId: number): Promise<RoomOpening[]> {
    return db.select().from(roomOpenings).where(eq(roomOpenings.roomId, roomId));
  }

  async getOpeningsForSession(sessionId: number): Promise<RoomOpening[]> {
    return db.select().from(roomOpenings).where(eq(roomOpenings.sessionId, sessionId));
  }

  async deleteOpening(id: number): Promise<void> {
    await db.delete(roomOpenings).where(eq(roomOpenings.id, id));
  }
```

### A3. Voice Tool — `add_opening`

**File:** `server/realtime.ts`
**Insert before:** line 228 (before the closing `];` of the `realtimeTools` array)

Add this new tool definition as the last element in the array:

```typescript
  {
    type: "function",
    name: "add_opening",
    description: "Records a wall opening (door, window, pass-through, missing wall, overhead door) that deducts area from the room's wall SF calculation. Creates a MISS_WALL entry for ESX export. Call this when the adjuster mentions doors, windows, or openings in a room or elevation.",
    parameters: {
      type: "object",
      properties: {
        openingType: {
          type: "string",
          enum: ["window", "standard_door", "overhead_door", "missing_wall", "pass_through", "archway", "cased_opening"],
          description: "Type of opening. Use 'overhead_door' for garage doors (goesToFloor auto-set true). Use 'missing_wall' for large open sections."
        },
        wallDirection: {
          type: "string",
          enum: ["north", "south", "east", "west", "front", "rear", "left", "right"],
          description: "Which wall the opening is on. For exterior elevations, use front/rear/left/right."
        },
        widthFt: { type: "number", description: "Opening width in feet (e.g., 3 for a standard door, 16 for a garage door)" },
        heightFt: { type: "number", description: "Opening height in feet (e.g., 7 for a standard door, 8 for a garage door)" },
        quantity: { type: "integer", description: "Number of identical openings (e.g., 3 matching windows). Default 1." },
        opensInto: {
          type: "string",
          description: "Where the opening leads. Use room name (e.g., 'Hallway', 'Kitchen') for interior doors, or 'E' for exterior. Affects insulation and wrap calculations."
        },
        notes: { type: "string", description: "Additional notes (e.g., 'dented sill wrap', 'cracked glass')" }
      },
      required: ["openingType", "widthFt", "heightFt"]
    }
  }
```

### A4. API Endpoints

**File:** `server/routes.ts`

**Step 1 — Add validation schema.** Insert after the `roomCreateSchema` block (after line 53):

```typescript
const openingCreateSchema = z.object({
  roomId: z.number().int().positive(),
  openingType: z.enum(["window", "standard_door", "overhead_door", "missing_wall", "pass_through", "archway", "cased_opening"]),
  wallDirection: z.enum(["north", "south", "east", "west", "front", "rear", "left", "right"]).nullable().optional(),
  widthFt: z.number().positive(),
  heightFt: z.number().positive(),
  quantity: z.number().int().positive().default(1),
  opensInto: z.string().max(100).nullable().optional(),
  goesToFloor: z.boolean().optional(),
  goesToCeiling: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});
```

**Step 2 — Add REST endpoints.** Insert after the room complete endpoint (after line 792, before the `// ── Damage Observations ──` comment):

```typescript
  // ── Wall Openings ──────────────────────────────

  app.post("/api/inspection/:sessionId/openings", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const parsed = openingCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid opening data", errors: parsed.error.flatten().fieldErrors });
      }
      const data = parsed.data;
      // Auto-set goesToFloor for overhead doors
      const goesToFloor = data.openingType === "overhead_door" ? true : (data.goesToFloor || false);
      const opening = await storage.createOpening({
        sessionId,
        roomId: data.roomId,
        openingType: data.openingType,
        wallDirection: data.wallDirection || null,
        widthFt: data.widthFt,
        heightFt: data.heightFt,
        quantity: data.quantity,
        opensInto: data.opensInto || null,
        goesToFloor,
        goesToCeiling: data.goesToCeiling || false,
        notes: data.notes || null,
      });
      res.status(201).json(opening);
    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/openings", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const openings = await storage.getOpeningsForSession(sessionId);
      res.json(openings);
    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/rooms/:roomId/openings", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const openings = await storage.getOpeningsForRoom(roomId);
      res.json(openings);
    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/inspection/:sessionId/openings/:openingId", authenticateRequest, async (req, res) => {
    try {
      const openingId = parseInt(req.params.openingId);
      await storage.deleteOpening(openingId);
      res.status(204).send();
    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
```

### A5. Deduction Math — `calculateNetWallArea()`

**File:** `server/estimateEngine.ts`
**Insert at the end of the file** (after the existing `validateEstimate` function):

```typescript
/**
 * Calculates adjusted wall SF after subtracting all opening deductions.
 *
 * Formula: Adjusted sfWalls = Gross sfWalls - Σ(opening_width × opening_height × quantity)
 *
 * Used by ESX generator to produce accurate ROOM_DIM_VARS and by the voice agent
 * to give the adjuster a running net wall area during inspection.
 */
export function calculateNetWallArea(
  dimensions: { length?: number; width?: number; height?: number },
  openings: Array<{ widthFt: number; heightFt: number; quantity: number }>
): {
  grossSfWalls: number;
  totalDeductions: number;
  netSfWalls: number;
  sfCeiling: number;
  sfFloor: number;
  lfFloorPerim: number;
  sfLongWall: number;
  sfShortWall: number;
} {
  const L = dimensions.length || 0;
  const W = dimensions.width || 0;
  const H = dimensions.height || 8;

  const grossSfWalls = (L + W) * 2 * H;
  const sfCeiling = L * W;
  const sfFloor = L * W;
  const lfFloorPerim = (L + W) * 2;
  const sfLongWall = Math.max(L, W) * H;
  const sfShortWall = Math.min(L, W) * H;

  const totalDeductions = openings.reduce(
    (sum, o) => sum + o.widthFt * o.heightFt * (o.quantity || 1),
    0
  );

  const netSfWalls = Math.max(0, grossSfWalls - totalDeductions);

  return {
    grossSfWalls,
    totalDeductions,
    netSfWalls,
    sfCeiling,
    sfFloor,
    lfFloorPerim,
    sfLongWall,
    sfShortWall,
  };
}
```

### A6. ESX Generator — MISS_WALL Integration

**File:** `server/esxGenerator.ts`

**Step 1 — Update `generateESXFile` to fetch openings.** After line 34 (`const summary = ...`), add:

```typescript
  const openings = await storage.getOpeningsForSession(sessionId);
```

**Step 2 — Pass openings to `generateRoughDraft`.** Change line 58 from:

```typescript
  const roughdraftXml = generateRoughDraft(rooms, lineItemsXML, items);
```

to:

```typescript
  const roughdraftXml = generateRoughDraft(rooms, lineItemsXML, items, openings);
```

**Step 3 — Update `generateRoughDraft` signature.** Change line 126 from:

```typescript
function generateRoughDraft(rooms: any[], lineItems: LineItemXML[], originalItems: any[]): string {
```

to:

```typescript
function generateRoughDraft(rooms: any[], lineItems: LineItemXML[], originalItems: any[], openings: any[] = []): string {
```

**Step 4 — Emit MISS_WALL elements inside each GROUP.** After line 154 (the closing `</ROOM_DIM_VARS>` tag), insert the following block **before** the `<ITEMS>` tag at line 155:

```typescript
    // Emit MISS_WALL entries for this room's openings
    const roomObj = rooms.find((r) => r.name === roomName);
    const roomOpeningsList = roomObj ? openings.filter((o) => o.roomId === roomObj.id) : [];
    roomOpeningsList.forEach((opening) => {
      const opensIntoAttr = opening.opensInto || "E";
      const typeAttr = opening.goesToFloor ? "Goes to Floor"
        : opening.goesToCeiling ? "Goes to Ceiling"
        : opening.openingType;
      const dimStr = `${opening.widthFt}'0" x ${opening.heightFt}'0"`;
      const qty = opening.quantity || 1;
      for (let i = 0; i < qty; i++) {
        itemsXml += `          <MISS_WALL opensInto="${escapeXml(opensIntoAttr)}" type="${escapeXml(typeAttr)}" dimensions="${escapeXml(dimStr)}"/>\n`;
      }
    });
```

**Step 5 — Update WALL_SF to use net value.** Replace line 142:

```typescript
    const wallSF = ((dims.length || 0) + (dims.width || 0)) * 2 * (dims.height || 8);
```

with:

```typescript
    const grossWallSF = ((dims.length || 0) + (dims.width || 0)) * 2 * (dims.height || 8);
    const roomObj2 = rooms.find((r) => r.name === roomName);
    const roomOpenings2 = roomObj2 ? openings.filter((o) => o.roomId === roomObj2.id) : [];
    const deductionSF = roomOpenings2.reduce(
      (sum, o) => sum + (o.widthFt || 0) * (o.heightFt || 0) * (o.quantity || 1), 0
    );
    const wallSF = Math.max(0, grossWallSF - deductionSF);
```

### A7. Client UI — Opening Count in Room Cards

**File:** `client/src/pages/ActiveInspection.tsx`

**Step 1 — Add `openingCount` to RoomData interface.** At line 46, add a new field to the interface:

```typescript
interface RoomData {
  id: number;
  name: string;
  status: string;
  damageCount: number;
  photoCount: number;
  openingCount: number;  // ← ADD THIS
  roomType?: string;
  phase?: number;
  dimensions?: { length?: number; width?: number; height?: number };
  structure?: string;
}
```

**Step 2 — Display opening count in room cards.** After line 873 (the photo count span), add:

```tsx
              {room.openingCount > 0 && (
                <span className="text-[10px] text-muted-foreground">{room.openingCount} opening{room.openingCount !== 1 ? "s" : ""}</span>
              )}
```

**Step 3 — Populate openingCount.** Wherever the component fetches or maps room data (look for where `rooms` state is populated from the API response), ensure each room object includes an `openingCount` field. If the API does not yet return this, default to 0:

```typescript
openingCount: r.openingCount ?? 0,
```

### A8. Database Migration

Run `drizzle-kit push` to create the new `room_openings` table:

```bash
npm run db:push
```

---

## Part B — Enhanced Peril-Specific Investigation Protocols

### B1. Replace Peril Awareness Section in System Instructions

**File:** `server/realtime.ts`

**Replace** lines 70–73 (the current `5. **Peril Awareness:**` section) with the following expanded peril-specific investigation protocols:

```typescript
5. **Peril-Specific Investigation Protocol:** For ${claim.perilType} claims, follow the structured forensic workflow below. Do NOT skip steps.

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

For each room, the agent should calculate tearout SF: lfFloorPerim × tearoutHeight, then subtract opening deductions using the add_opening data.` : ''}
```

### B2. Enhanced Phase 3 Exterior Instructions with Opening Prompts

Still in `server/realtime.ts`, within the `buildSystemInstructions` function, update the Phase 3 section (currently at lines 48–59). **Replace** the existing Phase 3 block with:

```typescript
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
```

### B3. Enhanced Phase 4 Interior Instructions with Opening Prompts

Update the Phase 4 line (currently at line 60) from:

```
   Phase 4: Interior (room by room)
```

to:

```typescript
   Phase 4: Interior — capture each affected room:
     For each room:
       a. Dimensions — width, depth, ceiling height via create_room
       b. Openings — MANDATORY: Ask "How many doorways? Any windows? Pass-throughs?"
          - Call add_opening for EVERY opening: type, wall direction, dimensions, opensInto
          - opensInto determines if adjacent rooms need inspection (for water claims)
       c. Damage — describe damage, location, extent
       d. Line items — scope repairs based on damage observations
       e. Photos — overview + each damage area
```

---

## Part C — Voice Tool Handler Wiring

### C1. Handle `add_opening` Tool Calls in the Session Manager

Wherever the realtime session manager processes tool calls from the voice model (the switch/case or if-chain that dispatches `create_room`, `add_damage`, `add_line_item`, etc.), add a new handler for `add_opening`:

```typescript
case "add_opening": {
  // Resolve current room from session context
  const session = await storage.getInspectionSession(sessionId);
  const currentRoomId = session?.currentRoomId;
  if (!currentRoomId) {
    return { error: "No active room. Create a room first before adding openings." };
  }

  const { openingType, wallDirection, widthFt, heightFt, quantity, opensInto, notes } = args;

  const opening = await storage.createOpening({
    sessionId,
    roomId: currentRoomId,
    openingType,
    wallDirection: wallDirection || null,
    widthFt,
    heightFt,
    quantity: quantity || 1,
    opensInto: opensInto || null,
    goesToFloor: openingType === "overhead_door",
    goesToCeiling: false,
    notes: notes || null,
  });

  // Calculate running deductions for confirmation
  const roomOpenings = await storage.getOpeningsForRoom(currentRoomId);
  const totalDeductionSF = roomOpenings.reduce(
    (sum, o) => sum + o.widthFt * o.heightFt * (o.quantity || 1), 0
  );

  const typeLabel = openingType.replace(/_/g, " ");
  const opensLabel = opensInto === "E" ? "exterior" : opensInto ? `into ${opensInto}` : "";
  const qtyLabel = (quantity || 1) > 1 ? ` ×${quantity}` : "";

  return {
    result: `Added ${typeLabel}${qtyLabel} (${widthFt}' × ${heightFt}')${opensLabel ? ` opening ${opensLabel}` : ""}. Total wall deductions for this room: ${totalDeductionSF.toFixed(0)} SF.`,
    openingId: opening.id,
  };
}
```

---

## Part D — Conversation Flow Examples

These illustrate how the enhanced system instructions drive the agent's behavior with the new `add_opening` tool.

### D1. Hail Inspection — Elevation Walk with Openings

```
AGENT: "We're moving to the front elevation. What's the length and eave height?"

INSPECTOR: "Front wall is 42 feet, 9 foot eave."

→ TOOL: create_room(name="Front Elevation", roomType="exterior_elevation_front", length=42, height=9)

AGENT: "42 by 9, front elevation logged. Any pop-outs, garage sections, or bump-outs on this face?"

INSPECTOR: "Yeah, there's a two-car garage section on the left, about 18 feet wide."

→ TOOL: create_room(name="Front Elevation - Garage Extension", roomType="exterior_elevation_front", length=18, height=9, structure="Main Dwelling")

AGENT: "Garage extension noted. Does it have an overhead door?"

INSPECTOR: "Yes, 16 by 7 overhead door."

→ TOOL: add_opening(openingType="overhead_door", widthFt=16, heightFt=7, opensInto="E")

AGENT: "Overhead door logged — 112 SF deducted from wall area. How about windows on the front face?"

INSPECTOR: "Three windows, each about 3 by 4."

→ TOOL: add_opening(openingType="window", widthFt=3, heightFt=4, quantity=3, opensInto="E")

AGENT: "Three windows logged, 36 more SF deducted. Front door?"

INSPECTOR: "Standard entry door, 3 by 7."

→ TOOL: add_opening(openingType="standard_door", widthFt=3, heightFt=7, opensInto="Foyer")

AGENT: "Front door to the foyer, got it. That's 169 SF total deductions from the front elevation. Now, how about hail damage to the siding?"
```

### D2. Water Claim — Interior Room with Openings

```
AGENT: "What are the kitchen dimensions?"

INSPECTOR: "15 wide, 20 deep, 8 and a half ceilings."

→ TOOL: create_room(name="Kitchen", roomType="interior_kitchen", length=15, width=20, height=8.5)

AGENT: "15 by 20 by 8 and a half, kitchen logged. Now I need the openings. How many doorways?"

INSPECTOR: "Doorway to the hallway on the west wall, and a sliding door to the deck on the south."

→ TOOL: add_opening(openingType="standard_door", wallDirection="west", widthFt=3, heightFt=7, opensInto="Hallway")
→ TOOL: add_opening(openingType="standard_door", wallDirection="south", widthFt=6, heightFt=7, opensInto="E")

AGENT: "Two doorways logged. Any windows?"

INSPECTOR: "Three on the north wall, 3 by 4 each."

→ TOOL: add_opening(openingType="window", wallDirection="north", widthFt=3, heightFt=4, quantity=3, opensInto="E")

AGENT: "Windows logged. Any pass-throughs or arched openings to other rooms?"

INSPECTOR: "There's a cased opening to the dining room, about 8 feet wide, 7 feet tall."

→ TOOL: add_opening(openingType="cased_opening", wallDirection="east", widthFt=8, heightFt=7, opensInto="Dining Room")

AGENT: "Cased opening to dining room — that's a big deduction, 56 SF. Total deductions: 155 SF. Gross walls were 595 SF, net walls are 440 SF for material ordering. Now, let's take moisture readings. Start at the base of each wall."
```

---

## Verification Checklist

Before merging, confirm:

| # | Check | File |
|---|-------|------|
| 1 | `roomOpenings` table definition compiles | `shared/schema.ts` |
| 2 | `InsertRoomOpening` / `RoomOpening` types export | `shared/schema.ts` |
| 3 | `IStorage` has 4 new methods | `server/storage.ts` |
| 4 | `DatabaseStorage` implements all 4 | `server/storage.ts` |
| 5 | `add_opening` tool appears in `realtimeTools` array | `server/realtime.ts` |
| 6 | Peril investigation protocols are > 3 bullet points each | `server/realtime.ts` |
| 7 | `openingCreateSchema` validates all fields | `server/routes.ts` |
| 8 | 4 REST endpoints exist (POST, GET session, GET room, DELETE) | `server/routes.ts` |
| 9 | `calculateNetWallArea()` exported | `server/estimateEngine.ts` |
| 10 | `generateESXFile` fetches openings | `server/esxGenerator.ts` |
| 11 | `generateRoughDraft` emits `<MISS_WALL>` elements | `server/esxGenerator.ts` |
| 12 | `WALL_SF` uses net value (gross - deductions) | `server/esxGenerator.ts` |
| 13 | `RoomData.openingCount` field exists | `client/src/pages/ActiveInspection.tsx` |
| 14 | Opening count displays in room cards | `client/src/pages/ActiveInspection.tsx` |
| 15 | `drizzle-kit push` creates `room_openings` table | Database |
| 16 | `add_opening` handler wired in session manager | Session manager file |

---

## Code References Used in This Prompt

| Ref | File | Line(s) | Content |
|-----|------|---------|---------|
| R1 | `shared/schema.ts` | 296–301 | `userSettings` table (insert point) |
| R2 | `shared/schema.ts` | 305–311 | `insertScopeLineItemSchema` through `InsertRegionalPriceSet` type (insert point) |
| R3 | `server/storage.ts` | 1–24 | Import block for schema tables/types |
| R4 | `server/storage.ts` | 27–121 | `IStorage` interface (insert before closing `}`) |
| R5 | `server/realtime.ts` | 3–86 | `buildSystemInstructions` function |
| R6 | `server/realtime.ts` | 70–73 | Current peril awareness (3 bullet points — REPLACE) |
| R7 | `server/realtime.ts` | 48–59 | Phase 3 exterior instructions (REPLACE) |
| R8 | `server/realtime.ts` | 88–228 | `realtimeTools` array (insert new tool before `];`) |
| R9 | `server/routes.ts` | 47–53 | `roomCreateSchema` (insert after) |
| R10 | `server/routes.ts` | 740–792 | Room endpoints (insert opening endpoints after) |
| R11 | `server/esxGenerator.ts` | 24–34 | `generateESXFile` data fetching (add openings) |
| R12 | `server/esxGenerator.ts` | 58 | `generateRoughDraft` call (add openings param) |
| R13 | `server/esxGenerator.ts` | 126 | `generateRoughDraft` signature (add openings param) |
| R14 | `server/esxGenerator.ts` | 142 | `wallSF` calculation (replace with net value) |
| R15 | `server/esxGenerator.ts` | 147–156 | GROUP/ROOM_INFO/ROOM_DIM_VARS XML (insert MISS_WALL after) |
| R16 | `client/src/pages/ActiveInspection.tsx` | 46–56 | `RoomData` interface (add openingCount) |
| R17 | `client/src/pages/ActiveInspection.tsx` | 871–873 | Damage/photo count spans (add opening count after) |

---

## Summary

This prompt adds:
- **1 new database table** (`room_openings`) with 12 columns
- **4 new IStorage methods** (CRUD for openings)
- **1 new voice tool** (`add_opening`) with 7 parameters
- **4 new REST endpoints** (POST/GET/GET-by-room/DELETE)
- **1 new calculation function** (`calculateNetWallArea`) with full ROOM_DIM_VARS output
- **MISS_WALL XML generation** in ESX export with deduction-adjusted WALL_SF
- **~150 lines of enhanced system instructions** replacing 4 lines of peril awareness
- **Opening count display** in the client room cards

Total estimated diff: ~550 lines added, ~15 lines modified.
