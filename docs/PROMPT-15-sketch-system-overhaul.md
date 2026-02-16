# PROMPT 15 — Sketch System Overhaul: DIM_VARS Engine, Room Adjacency, Architectural SVG, Xactimate-Compatible SUBROOM Export

## Goal

Transform the Voice Inspector's sketch system from a status-tracking dashboard (colored rectangles in a grid) into an architecturally-aware floor plan that captures room adjacency, renders shared walls with opening symbols, computes Xactimate-standard DIM_VARS (14 calculated fields), and exports proper `SUBROOM`/`MISSWALLS`/`DIM_VARS` XML that Xactimate can import without manual recalculation.

This prompt addresses three compounding gaps discovered through analysis of production Xactimate XML estimates and the UX Design Spec (Screen 6 — Progress Map):

1. **Data Gap:** No room adjacency model — the system doesn't know which rooms share walls, so it can't render shared walls or compute opening deductions between rooms.
2. **Rendering Gap:** `FloorPlanSketch.tsx` uses a left-to-right wrapping grid with no shared walls, no opening symbols, no dimension annotations, no SF area labels.
3. **Export Gap:** `esxGenerator.ts` outputs a simplified `ROOM_DIM_VARS` block with 4 fields. Real Xactimate uses `SUBROOM` elements with `XPERT_VARS`, `DIM_VARS_BEFORE_MW`, `MISSWALLS`, and `DIM_VARS` — 14 calculated fields each. PROMPT-12 added `roomOpenings` and `calculateNetWallArea`, but those produce the simplified format. This prompt upgrades to the full Xactimate-standard structure.

**Prerequisites:** PROMPT-12 (roomOpenings table + calculateNetWallArea), PROMPT-13 (settlement engine), PROMPT-14 (financial refinements) must be applied first.

**Sketch Intelligence:** This prompt also adds a constraint validation layer to the voice agent — the AI must understand that certain sketch entities require parents to exist before they can be created (e.g., you can't add an opening to a room that doesn't exist yet, you can't set adjacency between rooms that haven't been created).

---

## Part A — Room Adjacency Data Model

### Problem

The system has no concept of which rooms share walls. When the adjuster says "the kitchen connects to the dining room through a cased opening," we store the opening (via PROMPT-12's `roomOpenings`) but don't store the adjacency relationship itself. Without adjacency:
- The sketch renderer can't draw shared walls (rooms float independently)
- The ESX generator can't correctly set `opensInto` values for MISSWALLS
- The voice agent can't validate "this room connects to X" statements
- Water damage flow paths can't be traced room-to-room

### A1. New Schema Table — `roomAdjacencies`

**File:** `shared/schema.ts`
**Insert after:** the `roomOpenings` table and its type exports (which PROMPT-12 added after line 301). Find the `insertRoomOpeningSchema` and `InsertRoomOpening` type — insert immediately after:

```typescript
// ── Room Adjacency (which rooms share walls) ────────────────
export const roomAdjacencies = pgTable("room_adjacencies", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id, { onDelete: "cascade" }),
  roomIdA: integer("room_id_a").notNull().references(() => inspectionRooms.id, { onDelete: "cascade" }),
  roomIdB: integer("room_id_b").notNull().references(() => inspectionRooms.id, { onDelete: "cascade" }),
  // Which wall of Room A faces Room B
  wallDirectionA: varchar("wall_direction_a", { length: 20 }),
  // "north" | "south" | "east" | "west"
  // Which wall of Room B faces Room A (should be opposite of wallDirectionA)
  wallDirectionB: varchar("wall_direction_b", { length: 20 }),
  // Shared wall length in feet (may be partial — rooms don't have to be the same width)
  sharedWallLengthFt: real("shared_wall_length_ft"),
  // If there's an opening in this shared wall, reference the opening
  openingId: integer("opening_id").references(() => roomOpenings.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRoomAdjacencySchema = createInsertSchema(roomAdjacencies).omit({
  id: true,
  createdAt: true,
});

export type RoomAdjacency = typeof roomAdjacencies.$inferSelect;
export type InsertRoomAdjacency = z.infer<typeof insertRoomAdjacencySchema>;
```

### A2. Expand `inspectionRooms.dimensions` JSONB Structure

**File:** `shared/schema.ts`

The `inspectionRooms` table (lines 141–154) stores `dimensions: jsonb("dimensions")` which currently holds `{ length?, width?, height? }`. We don't change the column — we document the expanded shape that code should expect:

```typescript
// The `dimensions` jsonb column stores an object matching this shape:
// {
//   length: number,          // feet (room length)
//   width: number,           // feet (room width)
//   height: number,          // feet (ceiling/wall height, default 8)
//   wallThickness?: number,  // inches (default 4.5 for interior, 6 for exterior)
//   orientation?: number,    // degrees from north (0 = north wall is top of sketch)
//   isExterior?: boolean,    // true if any wall faces outside
//   elevationType?: "box" | "elevation",  // "box" for floor plans, "elevation" for exterior views
//   ceilingType?: "flat" | "cathedral" | "tray" | "vaulted",
//   // Pre-computed DIM_VARS (populated by calculateDimVars):
//   dimVars?: DimVarsResult,
// }
```

This is a documentation-only change — no migration needed. The jsonb column already accepts any shape.

### A3. IStorage Interface — Adjacency Methods

**File:** `server/storage.ts`

**Step 1 — Add imports.** In the import block (lines 1–24), add to the existing imports:

```typescript
// Add to the imports from "@shared/schema":
  roomAdjacencies,
  type RoomAdjacency, type InsertRoomAdjacency,
```

**Step 2 — Add interface methods.** Insert inside `IStorage` (before the closing `}`), after the existing `roomOpenings` methods that PROMPT-12 added:

```typescript
  // ── Room Adjacency ──────────────────────────
  createAdjacency(data: InsertRoomAdjacency): Promise<RoomAdjacency>;
  getAdjacenciesForRoom(roomId: number): Promise<RoomAdjacency[]>;
  getAdjacenciesForSession(sessionId: number): Promise<RoomAdjacency[]>;
  deleteAdjacency(id: number): Promise<void>;
  getAdjacentRooms(roomId: number): Promise<Array<{ adjacency: RoomAdjacency; room: InspectionRoom }>>;
  // Update room dimensions (specifically the jsonb `dimensions` column)
  updateRoomDimensions(roomId: number, dimensions: Record<string, any>): Promise<InspectionRoom | undefined>;
```

**Step 3 — Implement in `DatabaseStorage`.** Add these methods to the class body:

```typescript
  async createAdjacency(data: InsertRoomAdjacency): Promise<RoomAdjacency> {
    const [adjacency] = await db.insert(roomAdjacencies).values(data).returning();
    return adjacency;
  }

  async getAdjacenciesForRoom(roomId: number): Promise<RoomAdjacency[]> {
    return db.select().from(roomAdjacencies)
      .where(
        sql`${roomAdjacencies.roomIdA} = ${roomId} OR ${roomAdjacencies.roomIdB} = ${roomId}`
      );
  }

  async getAdjacenciesForSession(sessionId: number): Promise<RoomAdjacency[]> {
    return db.select().from(roomAdjacencies)
      .where(eq(roomAdjacencies.sessionId, sessionId));
  }

  async deleteAdjacency(id: number): Promise<void> {
    await db.delete(roomAdjacencies).where(eq(roomAdjacencies.id, id));
  }

  async getAdjacentRooms(roomId: number): Promise<Array<{ adjacency: RoomAdjacency; room: InspectionRoom }>> {
    const adjacencies = await this.getAdjacenciesForRoom(roomId);
    const results: Array<{ adjacency: RoomAdjacency; room: InspectionRoom }> = [];
    for (const adj of adjacencies) {
      const otherRoomId = adj.roomIdA === roomId ? adj.roomIdB : adj.roomIdA;
      const room = await this.getRoom(otherRoomId);
      if (room) results.push({ adjacency: adj, room });
    }
    return results;
  }

  async updateRoomDimensions(roomId: number, dimensions: Record<string, any>): Promise<InspectionRoom | undefined> {
    const [updated] = await db.update(inspectionRooms)
      .set({ dimensions })
      .where(eq(inspectionRooms.id, roomId))
      .returning();
    return updated;
  }
```

### A4. API Endpoints for Adjacency

**File:** `server/routes.ts`

**Step 1 — Add validation schema.** Insert after the existing `lineItemCreateSchema` (after line 67):

```typescript
const adjacencyCreateSchema = z.object({
  roomIdA: z.number().int().positive(),
  roomIdB: z.number().int().positive(),
  wallDirectionA: z.string().max(20).nullable().optional(),
  wallDirectionB: z.string().max(20).nullable().optional(),
  sharedWallLengthFt: z.number().positive().nullable().optional(),
  openingId: z.number().int().positive().nullable().optional(),
});
```

**Step 2 — Add endpoints.** Inside `registerRoutes`, add alongside the existing room endpoints:

```typescript
  // ── Room Adjacency Endpoints ──────────────────────
  app.get("/api/sessions/:sessionId/adjacencies", authenticateRequest, async (req, res) => {
    const sessionId = parseInt(req.params.sessionId);
    const adjacencies = await storage.getAdjacenciesForSession(sessionId);
    res.json(adjacencies);
  });

  app.get("/api/rooms/:roomId/adjacencies", authenticateRequest, async (req, res) => {
    const roomId = parseInt(req.params.roomId);
    const adjacencies = await storage.getAdjacentRooms(roomId);
    res.json(adjacencies);
  });

  app.post("/api/sessions/:sessionId/adjacencies", authenticateRequest, async (req, res) => {
    const sessionId = parseInt(req.params.sessionId);
    const parsed = adjacencyCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    // Validate both rooms exist and belong to this session
    const roomA = await storage.getRoom(parsed.data.roomIdA);
    const roomB = await storage.getRoom(parsed.data.roomIdB);
    if (!roomA || roomA.sessionId !== sessionId) return res.status(404).json({ error: "Room A not found in session" });
    if (!roomB || roomB.sessionId !== sessionId) return res.status(404).json({ error: "Room B not found in session" });
    if (parsed.data.roomIdA === parsed.data.roomIdB) return res.status(400).json({ error: "A room cannot be adjacent to itself" });

    const adjacency = await storage.createAdjacency({ ...parsed.data, sessionId });
    res.status(201).json(adjacency);
  });

  app.delete("/api/adjacencies/:id", authenticateRequest, async (req, res) => {
    await storage.deleteAdjacency(parseInt(req.params.id));
    res.status(204).send();
  });

  // ── Update Room Dimensions (for DIM_VARS recalculation) ──
  app.patch("/api/rooms/:roomId/dimensions", authenticateRequest, async (req, res) => {
    const roomId = parseInt(req.params.roomId);
    const room = await storage.getRoom(roomId);
    if (!room) return res.status(404).json({ error: "Room not found" });

    // Merge new dimensions with existing
    const existingDims = (room.dimensions as Record<string, any>) || {};
    const merged = { ...existingDims, ...req.body };
    const updated = await storage.updateRoomDimensions(roomId, merged);
    res.json(updated);
  });
```

### A5. Database Migration

Create file `migrations/add_room_adjacencies.sql`:

```sql
CREATE TABLE IF NOT EXISTS room_adjacencies (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES inspection_sessions(id) ON DELETE CASCADE,
  room_id_a INTEGER NOT NULL REFERENCES inspection_rooms(id) ON DELETE CASCADE,
  room_id_b INTEGER NOT NULL REFERENCES inspection_rooms(id) ON DELETE CASCADE,
  wall_direction_a VARCHAR(20),
  wall_direction_b VARCHAR(20),
  shared_wall_length_ft REAL,
  opening_id INTEGER REFERENCES room_openings(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast lookup by room
CREATE INDEX idx_room_adjacencies_room_a ON room_adjacencies(room_id_a);
CREATE INDEX idx_room_adjacencies_room_b ON room_adjacencies(room_id_b);
CREATE INDEX idx_room_adjacencies_session ON room_adjacencies(session_id);
```

---

## Part B — Xactimate-Standard DIM_VARS Calculation Engine

### Problem

PROMPT-12 introduced `calculateNetWallArea` which computes simplified wall SF after opening deductions. Xactimate uses a much richer calculation: 14 DIM_VARS attributes, split into "before missing walls" (`DIM_VARS_BEFORE_MW`) and "after missing walls" (`DIM_VARS`). Our current ESX export uses 4 fields (`WALL_SF`, `FLOOR_SF`, `CEIL_SF`, `PERIM_LF`). Real Xactimate estimates contain `HH`, `SH`, `W`, `LW`, `SW`, `PF`, `PC`, `C`, `F`, `LL`, `R`, `SQ`, `V` — all 14.

### B1. DIM_VARS Type Definitions

**File:** `server/estimateEngine.ts`
**Insert at top of file** (after existing imports):

```typescript
// ── Xactimate DIM_VARS: 14 calculated dimension variables ──
// These match the attributes in <DIM_VARS> and <DIM_VARS_BEFORE_MW> XML elements
export interface DimVarsResult {
  HH: number;   // Header Height (inches) — ceiling height
  SH: number;   // Short wall Height (inches) — equals HH for standard rooms
  W: number;    // Total Wall area (SF) — all 4 walls combined
  LW: number;   // Long Wall area (SF) — the two longer walls
  SW: number;   // Short Wall area (SF) — the two shorter walls
  PF: number;   // Perimeter Floor (LF) — perimeter at floor level
  PC: number;   // Perimeter Ceiling (LF) — perimeter at ceiling level (equals PF for standard rooms)
  C: number;    // Ceiling area (SF)
  F: number;    // Floor area (SF)
  LL: number;   // Line Length (LF) — longest single wall run
  R: number;    // Riser area (SF) — for stairs/steps (0 for standard rooms)
  SQ: number;   // Roof Squares (count, 1 SQ = 100 SF) — 0 for interior rooms
  V: number;    // Volume (CF) — room volume
}

// Room dimensions as stored in inspectionRooms.dimensions jsonb
export interface RoomDimensions {
  length: number;     // feet
  width: number;      // feet
  height: number;     // feet (default 8)
  wallThickness?: number;   // inches
  orientation?: number;     // degrees from north
  isExterior?: boolean;
  elevationType?: "box" | "elevation";
  ceilingType?: "flat" | "cathedral" | "tray" | "vaulted";
}

// Opening data from roomOpenings table
export interface OpeningData {
  openingType: string;
  widthFt: number;
  heightFt: number;
  quantity: number;
  opensInto: string | null;
  goesToFloor: boolean;
  goesToCeiling: boolean;
}
```

### B2. `calculateDimVars` Function

**File:** `server/estimateEngine.ts`
**Insert after** the type definitions from B1:

```typescript
/**
 * Calculates Xactimate-standard DIM_VARS for a room.
 * Returns both pre-opening and post-opening values.
 *
 * Xactimate internal unit system:
 *   - Coordinates: 1/1000 of an inch (1 foot = 12,000 units)
 *   - HH/SH: inches
 *   - All area values (W, LW, SW, C, F, R): square feet
 *   - All linear values (PF, PC, LL): linear feet
 *   - SQ: roof squares (1 SQ = 100 SF)
 *   - V: cubic feet
 *
 * For DIM_VARS export to XML, these SF/LF/CF values are used directly.
 * For COORDINATE3 export, multiply feet × 12,000 to get 1/1000" units.
 */
export function calculateDimVars(
  dims: RoomDimensions,
  openings: OpeningData[] = []
): { beforeMW: DimVarsResult; afterMW: DimVarsResult } {

  const L = dims.length;  // feet
  const W = dims.width;   // feet
  const H = dims.height || 8;  // feet, default 8'

  // Determine long vs short dimensions
  const longDim = Math.max(L, W);
  const shortDim = Math.min(L, W);

  // ── PRE-OPENING CALCULATIONS (DIM_VARS_BEFORE_MW) ──
  const heightInches = H * 12;

  const beforeMW: DimVarsResult = {
    HH: heightInches,                     // Header height in inches
    SH: heightInches,                     // Short wall height (same for standard rooms)
    W: 2 * (L * H + W * H),              // Total wall SF = 2(L×H) + 2(W×H)
    LW: 2 * (longDim * H),               // Long wall SF (both long walls)
    SW: 2 * (shortDim * H),              // Short wall SF (both short walls)
    PF: 2 * (L + W),                     // Perimeter floor LF
    PC: 2 * (L + W),                     // Perimeter ceiling LF (same for flat ceiling)
    C: L * W,                            // Ceiling SF
    F: L * W,                            // Floor SF
    LL: longDim,                          // Line length = longest wall
    R: 0,                                // Riser area (0 for standard rooms)
    SQ: 0,                               // Roof squares (0 for interior rooms)
    V: L * W * H,                        // Volume CF
  };

  // Handle cathedral/vaulted ceilings
  if (dims.ceilingType === "cathedral") {
    // Cathedral: peak is typically 1.5× wall height at center
    beforeMW.V = L * W * H * 1.25;  // Approximate 25% more volume
    beforeMW.SQ = 0; // Still 0 — roof SQ comes from SKETCHROOF, not room
  }

  // ── OPENING DEDUCTIONS (DIM_VARS after Missing Walls) ──
  const afterMW: DimVarsResult = { ...beforeMW };

  let totalOpeningAreaSF = 0;
  let totalOpeningWidthLF = 0;

  for (const opening of openings) {
    const count = opening.quantity || 1;
    const openingWidthFt = opening.widthFt;
    const openingHeightFt = opening.heightFt;
    const openingAreaSF = openingWidthFt * openingHeightFt * count;
    const openingWidthTotalLF = openingWidthFt * count;

    totalOpeningAreaSF += openingAreaSF;
    totalOpeningWidthLF += openingWidthTotalLF;

    // If opening goes to floor, it also affects perimeter
    if (opening.goesToFloor) {
      afterMW.PF -= openingWidthTotalLF;
    }
  }

  // Deduct opening area from total wall SF
  afterMW.W = Math.max(0, beforeMW.W - totalOpeningAreaSF);

  // Deduct from perimeter floor (all openings affect PF in Xactimate)
  // Note: non-floor openings (windows) still reduce PF for baseboard calculation
  afterMW.PF = Math.max(0, beforeMW.PF - totalOpeningWidthLF);

  // PC (perimeter ceiling) is NOT reduced by openings (crown molding runs continuously)
  // C and F are NOT reduced by openings (floor and ceiling areas stay the same)
  // V is NOT reduced by openings

  // LW/SW deductions: proportionally distribute based on which wall openings are on
  // Simplified: spread evenly across long and short walls
  const longWallRatio = beforeMW.LW / (beforeMW.LW + beforeMW.SW || 1);
  afterMW.LW = Math.max(0, beforeMW.LW - totalOpeningAreaSF * longWallRatio);
  afterMW.SW = Math.max(0, beforeMW.SW - totalOpeningAreaSF * (1 - longWallRatio));

  // Round all values to reasonable precision (Xactimate uses whole numbers for most)
  const round2 = (n: number) => Math.round(n * 100) / 100;
  for (const key of Object.keys(afterMW) as Array<keyof DimVarsResult>) {
    afterMW[key] = round2(afterMW[key]);
    beforeMW[key] = round2(beforeMW[key]);
  }

  return { beforeMW, afterMW };
}
```

### B3. `calculateElevationDimVars` for Exterior Elevation Rooms

Exterior elevations use a different room type in Xactimate: `type="Elevation"` instead of `type="Box"`. The variables are named differently and the calculation is simpler (one flat surface, not a box).

**File:** `server/estimateEngine.ts`
**Insert after** `calculateDimVars`:

```typescript
/**
 * Calculates DIM_VARS for an Elevation-type room (exterior wall face).
 * Elevation rooms represent a single flat wall surface, not a box.
 *
 * printableDims format: "40' x 16' x 0""
 * XPERT_VAR names: ELLENGTH, ELHEIGHT, GBLHEIGHT
 *
 * The "length" is the elevation width (total wall run),
 * the "height" is the wall height,
 * and "width" is always 0 (it's a flat surface, not a box).
 */
export function calculateElevationDimVars(
  elevationLengthFt: number,
  elevationHeightFt: number,
  openings: OpeningData[] = []
): { beforeMW: DimVarsResult; afterMW: DimVarsResult } {

  const L = elevationLengthFt;
  const H = elevationHeightFt;
  const heightInches = H * 12;

  const beforeMW: DimVarsResult = {
    HH: heightInches,
    SH: heightInches,
    W: L * H,            // Single wall face area
    LW: L * H,           // Same as W (only one wall)
    SW: 0,               // No short walls on an elevation
    PF: L,               // Floor perimeter = wall length
    PC: L,               // Ceiling perimeter = wall length
    C: 0,                // No ceiling (elevation, not room)
    F: 0,                // No floor
    LL: L,               // Line length = elevation length
    R: 0,
    SQ: 0,
    V: 0,                // No volume (2D surface)
  };

  const afterMW: DimVarsResult = { ...beforeMW };

  let totalOpeningAreaSF = 0;
  let totalOpeningWidthLF = 0;

  for (const opening of openings) {
    const count = opening.quantity || 1;
    totalOpeningAreaSF += opening.widthFt * opening.heightFt * count;
    totalOpeningWidthLF += opening.widthFt * count;
    if (opening.goesToFloor) {
      afterMW.PF -= opening.widthFt * count;
    }
  }

  afterMW.W = Math.max(0, beforeMW.W - totalOpeningAreaSF);
  afterMW.LW = afterMW.W;
  afterMW.PF = Math.max(0, beforeMW.PF - totalOpeningWidthLF);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  for (const key of Object.keys(afterMW) as Array<keyof DimVarsResult>) {
    afterMW[key] = round2(afterMW[key]);
    beforeMW[key] = round2(beforeMW[key]);
  }

  return { beforeMW, afterMW };
}
```

### B4. `generateSubroomXml` for ESX Export

**File:** `server/estimateEngine.ts`
**Insert after** `calculateElevationDimVars`:

```typescript
/**
 * Generates a Xactimate-compatible SUBROOM XML block for one room.
 * This replaces the simplified ROOM_INFO/ROOM_DIM_VARS blocks in esxGenerator.ts.
 *
 * Production Xactimate output example:
 * <SUBROOM printableDims="20' x 15' x 8'" type="Box" name="Living Room">
 *   <XPERT_VARS>
 *     <XPERT_VAR name="ROOMHEIGHT" type="Numeric" value="96"/>
 *     <XPERT_VAR name="ROOMLENGTH" type="Numeric" value="240"/>
 *     <XPERT_VAR name="ROOMWIDTH" type="Numeric" value="180"/>
 *   </XPERT_VARS>
 *   <DIM_VARS_BEFORE_MW HH="96" SH="96" LW="160" SW="120" W="560" PF="70" PC="70" F="300" C="300"/>
 *   <MISSWALLS>
 *     <MISSWALL opensInto="Exterior" quantity="2" length="36000" height="24000"/>
 *   </MISSWALLS>
 *   <DIM_VARS HH="96" SH="96" LW="160" SW="120" W="528" PF="61" PC="70" F="300" C="300"/>
 * </SUBROOM>
 */
export function generateSubroomXml(
  roomName: string,
  dims: RoomDimensions,
  openings: OpeningData[]
): string {
  const isElevation = dims.elevationType === "elevation" ||
    roomName.toLowerCase().includes("elevation") ||
    roomName.toLowerCase().includes("siding");

  let dimVarsResult: { beforeMW: DimVarsResult; afterMW: DimVarsResult };
  let subroomType: string;
  let printableDims: string;
  let xpertVarsXml: string;

  if (isElevation) {
    subroomType = "Elevation";
    dimVarsResult = calculateElevationDimVars(dims.length, dims.height || 8, openings);
    printableDims = `${dims.length}' x ${dims.height || 8}' x 0"`;
    xpertVarsXml = `
    <XPERT_VARS>
      <XPERT_VAR name="ELLENGTH" type="Numeric" value="${dims.length * 12}"/>
      <XPERT_VAR name="ELHEIGHT" type="Numeric" value="${(dims.height || 8) * 12}"/>
      <XPERT_VAR name="GBLHEIGHT" type="Numeric" value="${(dims.height || 8) * 12}"/>
    </XPERT_VARS>`;
  } else {
    subroomType = "Box";
    dimVarsResult = calculateDimVars(dims, openings);
    printableDims = `${dims.length}' x ${dims.width}' x ${dims.height || 8}'`;
    xpertVarsXml = `
    <XPERT_VARS>
      <XPERT_VAR name="ROOMHEIGHT" type="Numeric" value="${(dims.height || 8) * 12}"/>
      <XPERT_VAR name="ROOMLENGTH" type="Numeric" value="${dims.length * 12}"/>
      <XPERT_VAR name="ROOMWIDTH" type="Numeric" value="${dims.width * 12}"/>
    </XPERT_VARS>`;
  }

  const { beforeMW, afterMW } = dimVarsResult;

  // Build DIM_VARS attribute string (all 14 fields minus LL, R, SQ, V which Xactimate often omits)
  const dimVarsAttrs = (dv: DimVarsResult) =>
    `HH="${dv.HH}" SH="${dv.SH}" W="${dv.W}" LW="${dv.LW}" SW="${dv.SW}" PF="${dv.PF}" PC="${dv.PC}" C="${dv.C}" F="${dv.F}"`;

  // Generate MISSWALLS block
  let misswallsXml = "";
  if (openings.length > 0) {
    const misswallEntries = openings.map(o => {
      // Convert feet to 1/1000 of an inch for Xactimate
      const lengthUnits = Math.round(o.widthFt * 12000);
      const heightUnits = Math.round(o.heightFt * 12000);
      const opensIntoAttr = o.opensInto ? ` opensInto="${escapeXml(o.opensInto === "E" ? "Exterior" : o.opensInto)}"` : ' opensInto="Exterior"';
      const floorAttr = o.goesToFloor ? ' opensToFloor="1"' : "";
      return `      <MISSWALL${opensIntoAttr} quantity="${o.quantity}" length="${lengthUnits}" height="${heightUnits}"${floorAttr}/>`;
    }).join("\n");

    misswallsXml = `
    <MISSWALLS>
${misswallEntries}
    </MISSWALLS>`;
  }

  return `  <SUBROOM printableDims="${printableDims}" type="${subroomType}" name="${escapeXml(roomName)}">
    ${xpertVarsXml}
    <DIM_VARS_BEFORE_MW ${dimVarsAttrs(beforeMW)}/>
    ${misswallsXml}
    <DIM_VARS ${dimVarsAttrs(afterMW)}/>
  </SUBROOM>`;
}

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
```

---

## Part C — Voice Agent Sketch Intelligence

### Problem

The current voice agent has no concept of sketch constraints. It will happily try to:
- Add an opening to a room that doesn't exist yet
- Set adjacency between rooms that haven't been created
- Record dimensions without a room context
- Create duplicate rooms with the same name
- Skip room creation entirely and jump to line items

The voice agent needs a **constraint validation layer** — a set of rules that the AI checks before executing sketch-related actions, with helpful recovery prompts when constraints are violated.

### C1. New Voice Tool: `add_opening`

**File:** `server/realtime.ts`

**Insert** into the `realtimeTools` array (after the existing `add_line_item` tool at line 168):

```typescript
  {
    type: "function",
    name: "add_opening",
    description: "Records a door, window, or other wall opening in the current room. CONSTRAINT: A room must exist (via create_room) before openings can be added. If no room exists, create one first. This data is used for wall area deductions in the estimate and MISS_WALL entries in ESX export.",
    parameters: {
      type: "object",
      properties: {
        openingType: {
          type: "string",
          enum: ["window", "standard_door", "overhead_door", "missing_wall", "pass_through", "archway", "cased_opening"],
          description: "Type of opening"
        },
        wallDirection: {
          type: "string",
          enum: ["north", "south", "east", "west", "front", "rear", "left", "right"],
          description: "Which wall the opening is on"
        },
        widthFt: { type: "number", description: "Opening width in feet (e.g., 3 for a standard door, 5 for a window)" },
        heightFt: { type: "number", description: "Opening height in feet (e.g., 6.67 for standard door, 4 for window)" },
        quantity: { type: "integer", description: "Number of identical openings (default 1)", minimum: 1 },
        opensInto: {
          type: "string",
          description: "Room name this opening leads to (e.g., 'Hallway', 'Kitchen') or 'Exterior' for outside-facing openings"
        },
        goesToFloor: {
          type: "boolean",
          description: "True for doors and garage doors that extend to floor level. False for windows."
        }
      },
      required: ["openingType", "widthFt", "heightFt"]
    }
  },
```

### C2. New Voice Tool: `set_room_adjacency`

**Insert** into `realtimeTools` array (after `add_opening`):

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
```

### C3. New Voice Tool: `update_room_dimensions`

**Insert** into `realtimeTools` array (after `set_room_adjacency`):

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
  },
```

### C4. Updated System Instructions — Sketch Intelligence Block

**File:** `server/realtime.ts`
**Modify:** `buildSystemInstructions` function. Insert the following block **before** the existing "## Core Behaviors" section (before `\n## Core Behaviors`):

```typescript
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
11. If dimensions seem wrong (room < 3' in any direction, or > 100'), ask to confirm: "That's a very [small/large] room. Can you double-check those measurements?"
12. Wall height defaults to 8' unless the adjuster specifies otherwise. For exterior elevations, height is the wall height at the eave.
```

### C5. Tool Handler Implementation for New Voice Tools

**File:** `server/routes.ts`

In the WebSocket handler where tool calls are processed (the section that handles `response.function_call_arguments.done` events from the OpenAI Realtime API), add handlers for the three new tools. Find the existing `create_room` handler and add these alongside it:

```typescript
    // ── add_opening handler ──
    case "add_opening": {
      // CONSTRAINT: Must have a current room
      const currentSession = await storage.getInspectionSession(sessionId);
      if (!currentSession?.currentRoomId) {
        return { error: "No current room. Create a room first with create_room before adding openings." };
      }
      const opening = await storage.createOpening({
        sessionId,
        roomId: currentSession.currentRoomId,
        openingType: args.openingType,
        wallDirection: args.wallDirection || null,
        widthFt: args.widthFt,
        heightFt: args.heightFt,
        quantity: args.quantity || 1,
        opensInto: args.opensInto || "E",
        goesToFloor: args.goesToFloor || false,
        goesToCeiling: false,
        notes: null,
      });

      // Auto-create adjacency if opensInto is a room name (not "Exterior"/"E")
      if (args.opensInto && args.opensInto !== "Exterior" && args.opensInto !== "E") {
        const targetRoom = await storage.getRoomByName(sessionId, args.opensInto);
        if (targetRoom) {
          await storage.createAdjacency({
            sessionId,
            roomIdA: currentSession.currentRoomId,
            roomIdB: targetRoom.id,
            wallDirectionA: args.wallDirection || null,
            wallDirectionB: null, // Will be set when we visit the other room
            sharedWallLengthFt: null,
            openingId: opening.id,
          });
        }
        // If target room doesn't exist yet, the adjacency will be created when that room is created
        // and the voice agent mentions this connection
      }

      // Recalculate DIM_VARS for the room
      const room = await storage.getRoom(currentSession.currentRoomId);
      if (room) {
        const allOpenings = await storage.getOpeningsForRoom(room.id);
        const dims = (room.dimensions as RoomDimensions) || { length: 10, width: 10, height: 8 };
        if (dims.length && dims.width) {
          const { beforeMW, afterMW } = calculateDimVars(dims, allOpenings.map(o => ({
            openingType: o.openingType,
            widthFt: o.widthFt,
            heightFt: o.heightFt,
            quantity: o.quantity,
            opensInto: o.opensInto,
            goesToFloor: o.goesToFloor || false,
            goesToCeiling: o.goesToCeiling || false,
          })));
          await storage.updateRoomDimensions(room.id, {
            ...dims,
            dimVars: afterMW,
            dimVarsBeforeMW: beforeMW,
          });
        }
      }

      return {
        success: true,
        opening: { id: opening.id, type: opening.openingType, size: `${args.widthFt}'×${args.heightFt}'` },
        message: `Added ${args.quantity || 1} ${args.openingType}(s), ${args.widthFt}'×${args.heightFt}', opens into ${args.opensInto || "Exterior"}`
      };
    }

    // ── set_room_adjacency handler ──
    case "set_room_adjacency": {
      const roomA = await storage.getRoomByName(sessionId, args.roomNameA);
      const roomB = await storage.getRoomByName(sessionId, args.roomNameB);

      if (!roomA) return { error: `Room "${args.roomNameA}" not found. Create it first with create_room.` };
      if (!roomB) return { error: `Room "${args.roomNameB}" not found. Create it first with create_room. I'll remember to link these rooms once "${args.roomNameB}" is created.` };

      // Check for duplicate adjacency
      const existingAdj = await storage.getAdjacenciesForRoom(roomA.id);
      const alreadyLinked = existingAdj.some(a =>
        (a.roomIdA === roomA.id && a.roomIdB === roomB.id) ||
        (a.roomIdA === roomB.id && a.roomIdB === roomA.id)
      );
      if (alreadyLinked) return { success: true, message: `${args.roomNameA} and ${args.roomNameB} are already linked.` };

      const adjacency = await storage.createAdjacency({
        sessionId,
        roomIdA: roomA.id,
        roomIdB: roomB.id,
        wallDirectionA: args.wallDirectionA || null,
        wallDirectionB: args.wallDirectionB || null,
        sharedWallLengthFt: args.sharedWallLengthFt || null,
        openingId: null,
      });

      return {
        success: true,
        adjacency: { id: adjacency.id },
        message: `Linked ${args.roomNameA} ↔ ${args.roomNameB}${args.wallDirectionA ? ` (${args.wallDirectionA} wall)` : ""}`
      };
    }

    // ── update_room_dimensions handler ──
    case "update_room_dimensions": {
      const room = await storage.getRoomByName(sessionId, args.roomName);
      if (!room) return { error: `Room "${args.roomName}" not found. Create it first with create_room.` };

      const existingDims = (room.dimensions as Record<string, any>) || {};
      const newDims: Record<string, any> = { ...existingDims };
      if (args.length !== undefined) newDims.length = args.length;
      if (args.width !== undefined) newDims.width = args.width;
      if (args.height !== undefined) newDims.height = args.height;
      if (args.ceilingType !== undefined) newDims.ceilingType = args.ceilingType;

      // Recalculate DIM_VARS with current openings
      if (newDims.length && newDims.width) {
        const allOpenings = await storage.getOpeningsForRoom(room.id);
        const { beforeMW, afterMW } = calculateDimVars(
          newDims as RoomDimensions,
          allOpenings.map(o => ({
            openingType: o.openingType,
            widthFt: o.widthFt,
            heightFt: o.heightFt,
            quantity: o.quantity,
            opensInto: o.opensInto,
            goesToFloor: o.goesToFloor || false,
            goesToCeiling: o.goesToCeiling || false,
          }))
        );
        newDims.dimVars = afterMW;
        newDims.dimVarsBeforeMW = beforeMW;
      }

      await storage.updateRoomDimensions(room.id, newDims);

      return {
        success: true,
        dimensions: newDims,
        message: `Updated ${args.roomName}: ${newDims.length}'×${newDims.width}'×${newDims.height || 8}'${newDims.dimVars ? ` (${newDims.dimVars.W} SF walls, ${newDims.dimVars.F} SF floor)` : ""}`
      };
    }
```

---

## Part D — Sketch Renderer Overhaul

### Problem

`FloorPlanSketch.tsx` (228 lines) renders rooms as colored rectangles in a wrapping grid. No shared walls, no opening symbols, no dimension annotations, no SF area labels. The UX Design Spec (Screen 6) envisions a building outline for exterior and a room grid/floorplan for interior with status colors.

### D1. Complete Replacement of `FloorPlanSketch.tsx`

**File:** `client/src/components/FloorPlanSketch.tsx`
**Action:** Replace the entire file content with the following:

```tsx
import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────
interface RoomData {
  id: number;
  name: string;
  status: string;
  damageCount: number;
  photoCount: number;
  roomType?: string;
  dimensions?: {
    length?: number;
    width?: number;
    height?: number;
    dimVars?: {
      W: number; F: number; PF: number; C: number; V: number;
      LW: number; SW: number; HH: number; SH: number; PC: number;
      LL: number; R: number; SQ: number;
    };
  };
  structure?: string;
}

interface AdjacencyData {
  id: number;
  roomIdA: number;
  roomIdB: number;
  wallDirectionA?: string;
  wallDirectionB?: string;
  sharedWallLengthFt?: number;
  openingId?: number;
}

interface OpeningData {
  id: number;
  roomId: number;
  openingType: string;
  wallDirection?: string;
  widthFt: number;
  heightFt: number;
  quantity: number;
  opensInto?: string;
  goesToFloor?: boolean;
}

interface FloorPlanSketchProps {
  rooms: RoomData[];
  adjacencies?: AdjacencyData[];
  openings?: OpeningData[];
  currentRoomId: number | null;
  onRoomClick?: (roomId: number) => void;
  className?: string;
}

// ── Constants ──────────────────────────────────────
const PIXELS_PER_FOOT = 4;       // Scale: 1 foot = 4px
const MIN_ROOM_PX = 40;          // Minimum room dimension in pixels
const WALL_THICKNESS = 3;        // Wall line thickness
const OPENING_GAP = 2;           // Gap in wall for openings
const PADDING = 16;              // SVG padding
const SVG_WIDTH = 280;           // Total SVG width

// ── Color Palette (from UX Design Spec) ────────────
const STATUS_COLORS = {
  not_started: { fill: "rgba(31,41,55,0.6)", stroke: "#374151", text: "#9CA3AF" },
  in_progress: { fill: "rgba(119,99,183,0.15)", stroke: "#7763B7", text: "#C4B5FD" },
  complete: { fill: "rgba(34,197,94,0.1)", stroke: "#22C55E", text: "#86EFAC" },
  flagged: { fill: "rgba(198,165,78,0.1)", stroke: "#C6A54E", text: "#C6A54E" },
};

const OPENING_SYMBOLS: Record<string, (x: number, y: number, w: number, isVertical: boolean) => React.ReactNode> = {
  standard_door: (x, y, w, isVert) => {
    // Door: gap in wall + quarter-circle swing arc
    const radius = w * 0.8;
    if (isVert) {
      return (
        <g key={`door-${x}-${y}`}>
          <line x1={x} y1={y} x2={x} y2={y + w} stroke="transparent" strokeWidth={WALL_THICKNESS + 2} />
          <path d={`M ${x} ${y} A ${radius} ${radius} 0 0 1 ${x + radius} ${y + w * 0.5}`}
            fill="none" stroke="#9CA3AF" strokeWidth={0.8} strokeDasharray="2,1" />
        </g>
      );
    }
    return (
      <g key={`door-${x}-${y}`}>
        <line x1={x} y1={y} x2={x + w} y2={y} stroke="transparent" strokeWidth={WALL_THICKNESS + 2} />
        <path d={`M ${x} ${y} A ${radius} ${radius} 0 0 0 ${x + w * 0.5} ${y - radius}`}
          fill="none" stroke="#9CA3AF" strokeWidth={0.8} strokeDasharray="2,1" />
      </g>
    );
  },
  window: (x, y, w, isVert) => {
    // Window: three parallel lines across gap
    if (isVert) {
      return (
        <g key={`win-${x}-${y}`}>
          <line x1={x - 1} y1={y + 1} x2={x - 1} y2={y + w - 1} stroke="#60A5FA" strokeWidth={0.5} />
          <line x1={x} y1={y + 1} x2={x} y2={y + w - 1} stroke="#60A5FA" strokeWidth={0.8} />
          <line x1={x + 1} y1={y + 1} x2={x + 1} y2={y + w - 1} stroke="#60A5FA" strokeWidth={0.5} />
        </g>
      );
    }
    return (
      <g key={`win-${x}-${y}`}>
        <line x1={x + 1} y1={y - 1} x2={x + w - 1} y2={y - 1} stroke="#60A5FA" strokeWidth={0.5} />
        <line x1={x + 1} y1={y} x2={x + w - 1} y2={y} stroke="#60A5FA" strokeWidth={0.8} />
        <line x1={x + 1} y1={y + 1} x2={x + w - 1} y2={y + 1} stroke="#60A5FA" strokeWidth={0.5} />
      </g>
    );
  },
  overhead_door: (x, y, w, isVert) => {
    // Garage door: dashed wide gap
    if (isVert) {
      return <line key={`ohd-${x}-${y}`} x1={x} y1={y} x2={x} y2={y + w} stroke="#9CA3AF" strokeWidth={1} strokeDasharray="4,2" />;
    }
    return <line key={`ohd-${x}-${y}`} x1={x} y1={y} x2={x + w} y2={y} stroke="#9CA3AF" strokeWidth={1} strokeDasharray="4,2" />;
  },
};

// ── Layout Engine ──────────────────────────────────
interface PositionedRoom {
  room: RoomData;
  x: number;
  y: number;
  w: number;
  h: number;
}

function getRoomPixelSize(room: RoomData): { w: number; h: number } {
  const dims = room.dimensions;
  if (dims?.length && dims?.width) {
    return {
      w: Math.max(dims.length * PIXELS_PER_FOOT, MIN_ROOM_PX),
      h: Math.max(dims.width * PIXELS_PER_FOOT, MIN_ROOM_PX),
    };
  }
  return { w: MIN_ROOM_PX + 16, h: MIN_ROOM_PX + 6 };
}

/**
 * Adjacency-aware layout engine.
 * Phase 1: Place first room at origin.
 * Phase 2: For each adjacency, place the connected room sharing the specified wall.
 * Phase 3: Any unplaced rooms go into a wrapping grid below.
 */
function layoutRoomsWithAdjacency(
  roomList: RoomData[],
  adjacencies: AdjacencyData[],
  maxWidth: number
): PositionedRoom[] {
  if (roomList.length === 0) return [];

  const positioned: Map<number, PositionedRoom> = new Map();
  const roomById = new Map(roomList.map(r => [r.id, r]));

  // Place first room at origin
  const first = roomList[0];
  const firstSize = getRoomPixelSize(first);
  positioned.set(first.id, { room: first, x: PADDING, y: PADDING, w: firstSize.w, h: firstSize.h });

  // BFS through adjacencies to place connected rooms
  const queue: number[] = [first.id];
  const visited = new Set<number>([first.id]);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = positioned.get(currentId)!;

    const relatedAdjs = adjacencies.filter(a =>
      (a.roomIdA === currentId || a.roomIdB === currentId) &&
      roomById.has(a.roomIdA) && roomById.has(a.roomIdB)
    );

    for (const adj of relatedAdjs) {
      const otherId = adj.roomIdA === currentId ? adj.roomIdB : adj.roomIdA;
      if (visited.has(otherId)) continue;

      const otherRoom = roomById.get(otherId);
      if (!otherRoom) continue;

      const otherSize = getRoomPixelSize(otherRoom);
      const wallDir = adj.roomIdA === currentId ? adj.wallDirectionA : adj.wallDirectionB;

      let newX = current.x;
      let newY = current.y;

      switch (wallDir) {
        case "east":
        case "right":
          newX = current.x + current.w; // Shared wall (no gap)
          break;
        case "west":
        case "left":
          newX = current.x - otherSize.w;
          break;
        case "south":
        case "rear":
          newY = current.y + current.h;
          break;
        case "north":
        case "front":
          newY = current.y - otherSize.h;
          break;
        default:
          // Default: place to the right
          newX = current.x + current.w;
      }

      // Check for overlap with existing rooms (simple collision check)
      let hasCollision = false;
      for (const [, placed] of positioned) {
        if (newX < placed.x + placed.w && newX + otherSize.w > placed.x &&
            newY < placed.y + placed.h && newY + otherSize.h > placed.y) {
          hasCollision = true;
          break;
        }
      }

      if (!hasCollision) {
        positioned.set(otherId, { room: otherRoom, x: newX, y: newY, w: otherSize.w, h: otherSize.h });
        visited.add(otherId);
        queue.push(otherId);
      }
    }
  }

  // Place unpositioned rooms in a wrapping grid below
  const unplaced = roomList.filter(r => !positioned.has(r.id));
  if (unplaced.length > 0) {
    let maxY = 0;
    for (const [, p] of positioned) {
      maxY = Math.max(maxY, p.y + p.h);
    }

    let curX = PADDING;
    let curY = maxY + 12;
    let rowH = 0;

    for (const room of unplaced) {
      const size = getRoomPixelSize(room);
      if (curX + size.w + PADDING > maxWidth && curX > PADDING) {
        curX = PADDING;
        curY += rowH + 4;
        rowH = 0;
      }
      positioned.set(room.id, { room, x: curX, y: curY, w: size.w, h: size.h });
      curX += size.w + 4;
      rowH = Math.max(rowH, size.h);
    }
  }

  // Normalize coordinates (shift everything so minimum x,y = PADDING)
  let minX = Infinity, minY = Infinity;
  for (const [, p] of positioned) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  const offsetX = PADDING - minX;
  const offsetY = PADDING - minY;
  const result: PositionedRoom[] = [];
  for (const [, p] of positioned) {
    result.push({ ...p, x: p.x + offsetX, y: p.y + offsetY });
  }

  return result;
}

// ── Room Rendering ─────────────────────────────────
function RoomRect({
  room, x, y, w, h, isCurrent, openings, onClick
}: {
  room: RoomData; x: number; y: number; w: number; h: number;
  isCurrent: boolean; openings: OpeningData[]; onClick?: () => void;
}) {
  const dims = room.dimensions;
  const dv = dims?.dimVars;
  const colors = isCurrent
    ? { fill: "rgba(198,165,78,0.15)", stroke: "#C6A54E", text: "#C6A54E" }
    : STATUS_COLORS[room.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.not_started;

  const displayName = room.name.length > 16 ? room.name.substring(0, 15) + "…" : room.name;

  // Format dimension text
  const dimText = dims?.length && dims?.width
    ? `${dims.length}'×${dims.width}'`
    : null;

  // Format SF label from DIM_VARS
  const sfText = dv?.F ? `${dv.F} SF` : (dims?.length && dims?.width ? `${dims.length * dims.width} SF` : null);

  return (
    <g onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
      {/* Room fill */}
      <motion.rect
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        x={x} y={y} width={w} height={h}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={isCurrent ? WALL_THICKNESS : WALL_THICKNESS - 1}
        strokeDasharray={room.status === "not_started" ? "4,3" : "none"}
      />

      {/* Room name */}
      <text
        x={x + w / 2} y={y + h / 2 - (dimText ? 5 : 0)}
        textAnchor="middle" dominantBaseline="middle"
        fontSize="7" fontFamily="Work Sans, sans-serif" fontWeight="600"
        fill={colors.text}
      >
        {displayName}
      </text>

      {/* Dimension text */}
      {dimText && (
        <text
          x={x + w / 2} y={y + h / 2 + 5}
          textAnchor="middle" dominantBaseline="middle"
          fontSize="5.5" fontFamily="Space Mono, monospace" fill="#6B7280"
        >
          {dimText}
        </text>
      )}

      {/* SF area label */}
      {sfText && h > 35 && (
        <text
          x={x + w / 2} y={y + h / 2 + 12}
          textAnchor="middle" dominantBaseline="middle"
          fontSize="5" fontFamily="Space Mono, monospace" fill="#4B5563"
        >
          {sfText}
        </text>
      )}

      {/* Damage count badge */}
      {room.damageCount > 0 && (
        <>
          <circle cx={x + w - 6} cy={y + 6} r={5} fill="#EF4444" opacity={0.9} />
          <text x={x + w - 6} y={y + 6.5} textAnchor="middle" dominantBaseline="middle"
            fontSize="5.5" fill="white" fontWeight="bold">{room.damageCount}</text>
        </>
      )}

      {/* Photo count badge */}
      {room.photoCount > 0 && (
        <>
          <circle cx={x + 6} cy={y + h - 6} r={4} fill="rgba(119,99,183,0.8)" />
          <text x={x + 6} y={y + h - 5.5} textAnchor="middle" dominantBaseline="middle"
            fontSize="5" fill="white" fontWeight="bold">{room.photoCount}</text>
        </>
      )}

      {/* Opening symbols on walls */}
      {openings.map((opening, i) => {
        const openingPx = opening.widthFt * PIXELS_PER_FOOT;
        const symbol = OPENING_SYMBOLS[opening.openingType] || OPENING_SYMBOLS.standard_door;
        const wallDir = opening.wallDirection || "south";

        let ox: number, oy: number;
        const isVert = wallDir === "east" || wallDir === "west" || wallDir === "right" || wallDir === "left";

        if (wallDir === "north" || wallDir === "front") {
          ox = x + w / 2 - openingPx / 2 + i * 4;
          oy = y;
        } else if (wallDir === "south" || wallDir === "rear") {
          ox = x + w / 2 - openingPx / 2 + i * 4;
          oy = y + h;
        } else if (wallDir === "east" || wallDir === "right") {
          ox = x + w;
          oy = y + h / 2 - openingPx / 2 + i * 4;
        } else {
          ox = x;
          oy = y + h / 2 - openingPx / 2 + i * 4;
        }

        return symbol ? symbol(ox, oy, Math.min(openingPx, isVert ? h * 0.6 : w * 0.6), isVert) : null;
      })}
    </g>
  );
}

// ── Main Component ─────────────────────────────────
export default function FloorPlanSketch({
  rooms, adjacencies = [], openings = [], currentRoomId, onRoomClick, className
}: FloorPlanSketchProps) {

  const structureGroups = useMemo(() => {
    const groups: Record<string, { interior: RoomData[]; exterior: RoomData[] }> = {};
    for (const room of rooms) {
      const structure = room.structure || "Main Dwelling";
      if (!groups[structure]) groups[structure] = { interior: [], exterior: [] };
      if (room.roomType?.startsWith("exterior_")) {
        groups[structure].exterior.push(room);
      } else {
        groups[structure].interior.push(room);
      }
    }
    return Object.entries(groups).map(([name, { interior, exterior }]) => ({
      name, interior, exterior,
    }));
  }, [rooms]);

  const openingsByRoom = useMemo(() => {
    const map: Record<number, OpeningData[]> = {};
    for (const o of openings) {
      if (!map[o.roomId]) map[o.roomId] = [];
      map[o.roomId].push(o);
    }
    return map;
  }, [openings]);

  if (rooms.length === 0) {
    return (
      <div className={cn("bg-primary/5 rounded-lg border border-primary/15 p-4", className)}>
        <p className="text-[10px] uppercase tracking-widest text-purple-300/50 mb-2">Live Sketch</p>
        <div className="h-24 flex items-center justify-center">
          <p className="text-xs text-purple-300/30">Rooms will appear as they're created</p>
        </div>
      </div>
    );
  }

  // Layout each structure group
  let runningY = 0;
  const sections: Array<{
    label: string;
    sublabel: string;
    yOffset: number;
    positioned: PositionedRoom[];
    sectionHeight: number;
  }> = [];

  for (const group of structureGroups) {
    for (const [sublabel, roomList] of [["EXTERIOR", group.exterior], ["INTERIOR", group.interior]] as const) {
      if (roomList.length === 0) continue;

      // Filter adjacencies for rooms in this group
      const roomIds = new Set(roomList.map(r => r.id));
      const groupAdjs = adjacencies.filter(a => roomIds.has(a.roomIdA) && roomIds.has(a.roomIdB));

      const positioned = layoutRoomsWithAdjacency(roomList, groupAdjs, SVG_WIDTH);

      let maxY = 0;
      for (const p of positioned) {
        maxY = Math.max(maxY, p.y + p.h);
      }
      const sectionHeight = maxY + PADDING;

      sections.push({
        label: group.name,
        sublabel,
        yOffset: runningY,
        positioned,
        sectionHeight,
      });
      runningY += sectionHeight + 20;
    }
  }

  const totalHeight = runningY + 4;

  return (
    <div className={cn("bg-primary/5 rounded-lg border border-primary/15 overflow-hidden", className)} data-testid="floor-plan-sketch">
      <div className="px-3 py-2 border-b border-primary/15 flex justify-between items-center">
        <p className="text-[10px] uppercase tracking-widest text-purple-300/50">Live Sketch</p>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500/60" />
            <span className="text-[8px] text-purple-300/40">Done</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-purple-500/60" />
            <span className="text-[8px] text-purple-300/40">Active</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-gray-500/40" />
            <span className="text-[8px] text-purple-300/40">Pending</span>
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${SVG_WIDTH} ${totalHeight}`} className="w-full" style={{ maxHeight: 450 }}>
        {sections.map((section, si) => (
          <g key={si} transform={`translate(0, ${section.yOffset})`}>
            {/* Section label */}
            <text x={PADDING} y={10} fontSize="7" fontFamily="Space Mono, monospace"
              fill="rgba(157,139,191,0.4)" fontWeight="600">
              {section.label.toUpperCase()}
            </text>
            <text x={SVG_WIDTH - PADDING} y={10} fontSize="6" fontFamily="Space Mono, monospace"
              fill="rgba(157,139,191,0.3)" textAnchor="end">
              {section.sublabel}
            </text>

            {/* Rooms */}
            {section.positioned.map(({ room, x, y, w, h }) => (
              <RoomRect
                key={room.id}
                room={room} x={x} y={y + 14} w={w} h={h}
                isCurrent={room.id === currentRoomId}
                openings={openingsByRoom[room.id] || []}
                onClick={() => onRoomClick?.(room.id)}
              />
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
```

### D2. Update Parent Components to Pass Adjacency + Opening Data

**File:** Any component that renders `<FloorPlanSketch>` (likely `ActiveInspection.tsx` or similar).

Add API calls to fetch adjacencies and openings alongside rooms:

```typescript
// Alongside existing room fetch:
const { data: adjacencies } = useQuery({
  queryKey: ["/api/sessions", sessionId, "adjacencies"],
  enabled: !!sessionId,
});

const { data: openingsData } = useQuery({
  queryKey: ["/api/sessions", sessionId, "openings"],
  enabled: !!sessionId,
});

// Then pass to FloorPlanSketch:
<FloorPlanSketch
  rooms={rooms || []}
  adjacencies={adjacencies || []}
  openings={openingsData || []}
  currentRoomId={session?.currentRoomId || null}
  onRoomClick={handleRoomClick}
/>
```

**Also add** an API endpoint for fetching all openings for a session (in `server/routes.ts`):

```typescript
  app.get("/api/sessions/:sessionId/openings", authenticateRequest, async (req, res) => {
    const sessionId = parseInt(req.params.sessionId);
    const rooms = await storage.getRooms(sessionId);
    const allOpenings: any[] = [];
    for (const room of rooms) {
      const roomOpenings = await storage.getOpeningsForRoom(room.id);
      allOpenings.push(...roomOpenings);
    }
    res.json(allOpenings);
  });
```

---

## Part E — ESX Export Enhancement

### Problem

`esxGenerator.ts` generates a `GENERIC_ROUGHDRAFT.XML` with simplified `GROUP/ROOM_INFO/ROOM_DIM_VARS` blocks. Real Xactimate estimates use `SUBROOM` elements with the full DIM_VARS structure. Our current export is missing:
- `SUBROOM` with `type="Box"` or `type="Elevation"`
- `XPERT_VARS` (ROOMHEIGHT, ROOMLENGTH, ROOMWIDTH)
- `DIM_VARS_BEFORE_MW` (14 attributes, pre-opening)
- `MISSWALLS/MISSWALL` (opening deductions)
- `DIM_VARS` (14 attributes, post-opening)

### E1. Replace `generateRoughDraft` in esxGenerator.ts

**File:** `server/esxGenerator.ts`

**Step 1 — Add imports.** At the top of the file, add:

```typescript
import {
  calculateDimVars, calculateElevationDimVars, generateSubroomXml,
  type RoomDimensions, type OpeningData
} from "./estimateEngine";
```

**Step 2 — Update `generateESXFile`** to fetch openings. Modify lines 34-35 (after `const rooms = ...`):

```typescript
  const rooms = await storage.getRooms(sessionId);
  const summary = await storage.getEstimateSummary(sessionId);

  // Fetch openings for each room (needed for SUBROOM/MISSWALLS generation)
  const roomOpeningsMap: Map<number, any[]> = new Map();
  for (const room of rooms) {
    const openings = await storage.getOpeningsForRoom(room.id);
    roomOpeningsMap.set(room.id, openings);
  }
```

**Step 3 — Replace `generateRoughDraft` function** (lines 126–183). Replace entirely with:

```typescript
function generateRoughDraft(
  rooms: any[],
  lineItems: LineItemXML[],
  originalItems: any[],
  roomOpeningsMap: Map<number, any[]>
): string {
  // Group line items by room
  const roomGroups: { [key: string]: LineItemXML[] } = {};
  lineItems.forEach((item) => {
    const roomKey = item.room || "Unassigned";
    if (!roomGroups[roomKey]) roomGroups[roomKey] = [];
    roomGroups[roomKey].push(item);
  });

  let subroomsXml = "";
  let itemGroupsXml = "";

  Object.entries(roomGroups).forEach(([roomName, roomItems]) => {
    const room = rooms.find((r) => r.name === roomName);
    const dims: RoomDimensions = {
      length: room?.dimensions?.length || 10,
      width: room?.dimensions?.width || 10,
      height: room?.dimensions?.height || 8,
      elevationType: room?.roomType?.includes("elevation") ? "elevation" : "box",
    };

    // Get openings for this room
    const openings: OpeningData[] = (roomOpeningsMap.get(room?.id) || []).map((o: any) => ({
      openingType: o.openingType,
      widthFt: o.widthFt,
      heightFt: o.heightFt,
      quantity: o.quantity || 1,
      opensInto: o.opensInto,
      goesToFloor: o.goesToFloor || false,
      goesToCeiling: o.goesToCeiling || false,
    }));

    // Generate SUBROOM XML with full DIM_VARS
    subroomsXml += generateSubroomXml(roomName, dims, openings) + "\n";

    // Generate line item GROUP for this room
    const isSketchRoom = room?.roomType?.startsWith("exterior_");
    itemGroupsXml += `        <GROUP type="room" name="${escapeXml(roomName)}"${isSketchRoom ? ' source="Sketch" isRoom="1"' : ""}>\n`;
    itemGroupsXml += `          <ITEMS>\n`;

    roomItems.forEach((item, idx) => {
      const origItem = originalItems.find((oi) => oi.id === item.id);
      const xactCode = origItem?.xactCode || "000000";
      const category = item.category.substring(0, 3).toUpperCase();

      itemGroupsXml += `            <ITEM lineNum="${idx + 1}" cat="${category}" act="${item.action}" desc="${escapeXml(item.description)}" qty="${item.quantity.toFixed(2)}" unit="${item.unit}" total="${item.rcvTotal.toFixed(2)}" laborTotal="${item.laborTotal.toFixed(2)}" laborHours="${item.laborHours.toFixed(2)}" material="${item.material.toFixed(2)}" tax="${item.tax.toFixed(2)}" acvTotal="${item.acvTotal.toFixed(2)}" rcvTotal="${item.rcvTotal.toFixed(2)}"/>\n`;
    });

    itemGroupsXml += `          </ITEMS>\n`;
    itemGroupsXml += `        </GROUP>\n`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<GENERIC_ROUGHDRAFT>
  <DIM>
${subroomsXml}
  </DIM>
  <LINE_ITEM_DETAIL>
    <GROUP type="estimate" name="Estimate">
      <GROUP type="level" name="HOUSE">
        <GROUP type="sublevel" name="EXTERIOR">
${itemGroupsXml}
        </GROUP>
      </GROUP>
    </GROUP>
  </LINE_ITEM_DETAIL>
</GENERIC_ROUGHDRAFT>`;
}
```

**Step 4 — Update the `generateRoughDraft` call** in `generateESXFile` (line 58). Change from:

```typescript
  const roughdraftXml = generateRoughDraft(rooms, lineItemsXML, items);
```

To:

```typescript
  const roughdraftXml = generateRoughDraft(rooms, lineItemsXML, items, roomOpeningsMap);
```

---

## Validation Checklist

After implementing all parts, verify:

| # | Check | How |
|---|-------|-----|
| 1 | `roomAdjacencies` table created | `\d room_adjacencies` in psql |
| 2 | Adjacency CRUD works | POST/GET/DELETE on `/api/sessions/:id/adjacencies` |
| 3 | `calculateDimVars` returns 14 fields | Unit test: 20×15×8 room → W=560, F=300, PF=70, V=2400 |
| 4 | `calculateDimVars` deducts openings | Unit test: same room + 2 windows 3'×4' → W=536, PF=64 |
| 5 | `calculateElevationDimVars` works | Unit test: 40' elevation × 8' high → W=320, PF=40, F=0 |
| 6 | `add_opening` voice tool creates opening + auto-adjacency | Call tool in voice session, check room_openings + room_adjacencies tables |
| 7 | `set_room_adjacency` validates both rooms exist | Call with nonexistent room → error message |
| 8 | `update_room_dimensions` recalculates DIM_VARS | Update room, check dimensions.dimVars in DB |
| 9 | FloorPlanSketch renders shared walls | Create 2 rooms with adjacency → rooms share a wall edge |
| 10 | FloorPlanSketch shows opening symbols | Create room with window → blue triple-line on wall |
| 11 | FloorPlanSketch shows SF labels | Room with dimensions → "300 SF" in room |
| 12 | ESX export includes SUBROOM XML | Download ESX → unzip → check GENERIC_ROUGHDRAFT.XML |
| 13 | SUBROOM has DIM_VARS_BEFORE_MW + DIM_VARS | Parse XML → both elements present with 14 attrs |
| 14 | MISSWALLS present for rooms with openings | Parse XML → MISSWALL elements with length/height in 1/1000" |
| 15 | System instructions include Sketch Intelligence | Read realtime.ts → constraint rules present |
| 16 | Voice agent asks for openings proactively | Test session → AI asks about doors/windows after room creation |

---

## File Change Summary

| # | File | Action | Lines | What |
|---|------|--------|-------|------|
| 1 | `shared/schema.ts` | INSERT | after roomOpenings | `roomAdjacencies` table + types |
| 2 | `server/storage.ts` | INSERT | IStorage interface | Adjacency methods + updateRoomDimensions |
| 3 | `server/storage.ts` | INSERT | DatabaseStorage class | Adjacency + dimension implementations |
| 4 | `server/routes.ts` | INSERT | after line 67 | `adjacencyCreateSchema` |
| 5 | `server/routes.ts` | INSERT | inside registerRoutes | Adjacency + dimension endpoints |
| 6 | `server/routes.ts` | INSERT | tool handlers | add_opening, set_room_adjacency, update_room_dimensions handlers |
| 7 | `server/estimateEngine.ts` | INSERT | top of file | DimVarsResult, RoomDimensions, OpeningData types |
| 8 | `server/estimateEngine.ts` | INSERT | after types | calculateDimVars, calculateElevationDimVars, generateSubroomXml |
| 9 | `server/realtime.ts` | INSERT | realtimeTools array | add_opening, set_room_adjacency, update_room_dimensions tools |
| 10 | `server/realtime.ts` | INSERT | buildSystemInstructions | Sketch Intelligence constraint rules |
| 11 | `client/src/components/FloorPlanSketch.tsx` | REPLACE | entire file | Adjacency-aware SVG renderer with opening symbols |
| 12 | `server/esxGenerator.ts` | MODIFY | imports + generateRoughDraft | SUBROOM/DIM_VARS/MISSWALLS generation |
| 13 | `migrations/add_room_adjacencies.sql` | CREATE | new file | Room adjacencies table DDL |

---

## Architecture Notes

**Why adjacency is a separate table (not embedded in dimensions jsonb):**
- Adjacency is a many-to-many relationship (a room can be adjacent to multiple rooms)
- It references two rooms — can't be owned by just one
- It may link to an opening (foreign key)
- It needs to be queried from either room's perspective

**Why DIM_VARS are cached in dimensions jsonb (not computed on every render):**
- Computing DIM_VARS requires querying all openings for a room
- The sketch renders on every WebSocket update — needs instant access
- Cache is invalidated whenever openings or dimensions change (the tool handlers call recalculate)

**Why the sketch uses a BFS adjacency layout (not force-directed):**
- Force-directed layouts oscillate and are expensive to animate on iPad
- BFS from first room creates a predictable, stable layout
- Fallback grid handles rooms without adjacency data
- The layout is deterministic — same input always produces same output

**On the "Sketch Intelligence" approach:**
The constraint rules are embedded in tool descriptions AND system instructions. This dual approach works because:
1. Tool descriptions are visible to the model when deciding which tool to call (prevents wrong tool selection)
2. System instructions provide the conversational recovery patterns (what to say when a constraint is violated)
3. The server-side handlers provide hard validation (returns errors if constraints are violated even if the model ignores the soft constraints)
