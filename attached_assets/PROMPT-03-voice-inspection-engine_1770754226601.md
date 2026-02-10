# Claims IQ Voice Inspector — PROMPT 03: Voice Inspection Engine (OpenAI Realtime API)

## Context

Act 1 is working: document upload, AI parsing, extraction review, and briefing generation are all functional against Supabase. The ActiveInspection screen (Screen 5) exists in the frontend but has no voice integration — it's a shell.

This prompt wires up the OpenAI Realtime API to power the live voice inspection on the ActiveInspection screen. After this prompt, an adjuster can tap "START INSPECTION" from the briefing screen and have a real-time voice conversation with an AI agent that guides them through the property, captures damage observations, generates Xactimate line items, triggers photo capture, and records moisture readings — all by voice.

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  iPad Browser (ActiveInspection.tsx)                             │
│  ┌──────────────────────────────────────┐                        │
│  │  WebRTC PeerConnection               │ ← audio in/out        │
│  │  + DataChannel (events/tool calls)   │                        │
│  └──────────────┬───────────────────────┘                        │
│                 │                                                 │
│  1. Request ephemeral key from our server                        │
│  2. Connect directly to OpenAI Realtime via WebRTC               │
│  3. Tool call results sent back via DataChannel                  │
└──────────────────┬───────────────────────────────────────────────┘
                   │
┌──────────────────┴───────────────────────────────────────────────┐
│  Express Server                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  POST /api/realtime/session                                  │ │
│  │  → Calls OpenAI POST /v1/realtime/sessions                   │ │
│  │  → Returns ephemeral client_secret to browser                │ │
│  │  → Includes session config: tools, instructions, voice       │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Tool Execution Handlers                                     │ │
│  │  → Write to Supabase PostgreSQL via Drizzle                  │ │
│  │  → Write photos to Supabase Storage                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                   │
┌──────────────────┴───────────────────────────────────────────────┐
│  Supabase                                                         │
│  PostgreSQL: inspection_sessions, rooms, damages, line_items...   │
│  Storage: inspection-photos bucket                                │
│  Realtime: subscribe to live state changes in frontend            │
└──────────────────────────────────────────────────────────────────┘
```

**Key Design Decision:** Tool calls execute **client-side** in the browser. The Realtime API sends function calls over the WebRTC data channel. The browser executes them by calling our Express API (which writes to Supabase), then sends the result back to the Realtime API via the data channel. This keeps the architecture simple — no sideband server connection needed for the POC.

---

## Step 1: Expand the Database Schema

**File: `shared/schema.ts`**

ADD these tables alongside the existing Act 1 tables (claims, documents, extractions, briefings):

```typescript
// ── Inspection Sessions ──────────────────────────────
export const inspectionSessions = pgTable("inspection_sessions", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => claims.id),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  // active, paused, completed, abandoned
  currentPhase: integer("current_phase").default(1),
  // 1=Pre-Inspection, 2=Setup, 3=Exterior, 4=Interior, 5=Water/Moisture, 6=Evidence, 7=Estimate, 8=Finalize
  currentRoomId: integer("current_room_id"),
  currentStructure: varchar("current_structure", { length: 100 }).default("Main Dwelling"),
  voiceSessionId: text("voice_session_id"),   // OpenAI Realtime session reference
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

// ── Inspection Rooms / Areas ─────────────────────────
export const inspectionRooms = pgTable("inspection_rooms", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id),
  name: varchar("name", { length: 100 }).notNull(),
  roomType: varchar("room_type", { length: 50 }),
  // exterior_roof, exterior_siding, exterior_gutter, interior_bedroom, interior_kitchen, etc.
  structure: varchar("structure", { length: 100 }).default("Main Dwelling"),
  dimensions: jsonb("dimensions"),  // { length: number, width: number, height?: number }
  status: varchar("status", { length: 20 }).notNull().default("not_started"),
  // not_started, in_progress, complete, skipped
  damageCount: integer("damage_count").default(0),
  photoCount: integer("photo_count").default(0),
  phase: integer("phase"),  // which inspection phase this room belongs to
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

// ── Damage Observations ──────────────────────────────
export const damageObservations = pgTable("damage_observations", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id),
  roomId: integer("room_id").notNull().references(() => inspectionRooms.id),
  description: text("description").notNull(),
  damageType: varchar("damage_type", { length: 50 }),
  // hail_impact, wind_damage, water_stain, crack, dent, missing, rot, mold, etc.
  severity: varchar("severity", { length: 20 }),
  // minor, moderate, severe
  location: text("location"),      // "NE corner", "south slope", "ceiling center"
  measurements: jsonb("measurements"),  // { extent: "4ft", depth: "2in", count: 12 }
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Line Items (Xactimate-compatible) ────────────────
export const lineItems = pgTable("line_items", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id),
  roomId: integer("room_id").references(() => inspectionRooms.id),
  damageId: integer("damage_id").references(() => damageObservations.id),
  category: varchar("category", { length: 50 }).notNull(),
  // Roofing, Siding, Drywall, Painting, Flooring, Plumbing, Electrical, HVAC, Windows, Doors, Debris, General
  action: varchar("action", { length: 30 }),
  // R&R, Detach & Reset, Repair, Paint, Clean, Tear Off, Labor Only
  description: text("description").notNull(),
  xactCode: varchar("xact_code", { length: 30 }),
  quantity: real("quantity"),
  unit: varchar("unit", { length: 20 }),  // SF, LF, EA, SQ, HR
  unitPrice: real("unit_price"),
  totalPrice: real("total_price"),
  depreciationType: varchar("depreciation_type", { length: 30 }).default("Recoverable"),
  // Recoverable, Non-Recoverable, Paid When Incurred
  wasteFactor: integer("waste_factor"),
  provenance: varchar("provenance", { length: 20 }).default("voice"),
  // voice, manual, template, suggestion
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Inspection Photos ────────────────────────────────
export const inspectionPhotos = pgTable("inspection_photos", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id),
  roomId: integer("room_id").references(() => inspectionRooms.id),
  damageId: integer("damage_id").references(() => damageObservations.id),
  storagePath: text("storage_path"),   // Supabase Storage path
  autoTag: varchar("auto_tag", { length: 50 }),  // RF-TSQ-01, INTW-CEIL-03
  caption: text("caption"),
  photoType: varchar("photo_type", { length: 30 }),
  // overview, damage_detail, test_square, moisture, pre_existing
  annotations: jsonb("annotations"),  // drawing overlays, circles, arrows
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Moisture Readings ────────────────────────────────
export const moistureReadings = pgTable("moisture_readings", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id),
  roomId: integer("room_id").notNull().references(() => inspectionRooms.id),
  location: text("location"),          // "north wall base", "ceiling center"
  reading: real("reading").notNull(),  // percentage
  materialType: varchar("material_type", { length: 50 }),  // drywall, wood_framing, subfloor, concrete
  dryStandard: real("dry_standard"),   // reference dry value for this material
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Voice Transcript ─────────────────────────────────
export const voiceTranscripts = pgTable("voice_transcripts", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => inspectionSessions.id),
  speaker: varchar("speaker", { length: 10 }).notNull(),  // user, agent
  content: text("content").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
});
```

Push to Supabase:
```bash
npm run db:push
```

Also create a new Supabase Storage bucket:
- Name: `inspection-photos`
- Private
- Max file size: 25MB
- Allowed MIME types: `image/jpeg`, `image/png`, `image/heic`

---

## Step 2: Storage Layer — Add Inspection Operations

**File: `server/storage.ts`**

ADD these operations alongside the existing Act 1 operations:

```typescript
// ── Inspection Sessions ──────────────────────────────
createInspectionSession(claimId) → session
getInspectionSession(sessionId) → session
getActiveSessionForClaim(claimId) → session | null
updateSessionPhase(sessionId, phase) → session
updateSessionRoom(sessionId, roomId) → session
updateSessionStatus(sessionId, status) → session
completeSession(sessionId) → session

// ── Rooms ────────────────────────────────────────────
createRoom(sessionId, { name, roomType, structure, dimensions, phase }) → room
getRooms(sessionId) → room[]
getRoom(roomId) → room
updateRoomStatus(roomId, status) → room
completeRoom(roomId) → room
incrementRoomDamageCount(roomId) → room
incrementRoomPhotoCount(roomId) → room

// ── Damage Observations ──────────────────────────────
createDamage(sessionId, roomId, { description, damageType, severity, location, measurements }) → damage
getDamages(roomId) → damage[]
getDamagesForSession(sessionId) → damage[]

// ── Line Items ───────────────────────────────────────
createLineItem(sessionId, { roomId, damageId, category, action, description, xactCode, quantity, unit, unitPrice, totalPrice, depreciationType, wasteFactor }) → lineItem
getLineItems(sessionId) → lineItem[]
getLineItemsForRoom(roomId) → lineItem[]
getEstimateSummary(sessionId) → { totalRCV, totalDepreciation, totalACV, itemCount }
updateLineItem(lineItemId, updates) → lineItem
deleteLineItem(lineItemId) → void

// ── Photos ───────────────────────────────────────────
createPhoto(sessionId, { roomId, damageId, storagePath, autoTag, caption, photoType }) → photo
getPhotos(sessionId) → photo[]
getPhotosForRoom(roomId) → photo[]

// ── Moisture ─────────────────────────────────────────
createMoistureReading(sessionId, roomId, { location, reading, materialType, dryStandard }) → reading
getMoistureReadings(roomId) → reading[]

// ── Transcript ───────────────────────────────────────
addTranscript(sessionId, speaker, content) → entry
getTranscript(sessionId) → entry[]
```

---

## Step 3: API Routes — Inspection Endpoints

**File: `server/routes.ts`**

ADD these endpoints:

### Session Management
```
POST   /api/claims/:id/inspection/start
  → Create inspection session for this claim
  → Return { sessionId, session }

GET    /api/inspection/:sessionId
  → Return full session state: session + rooms + recent damages + running estimate

PATCH  /api/inspection/:sessionId
  → Update session (phase, currentRoomId, status)

POST   /api/inspection/:sessionId/complete
  → Mark session complete, set completedAt
```

### Rooms
```
POST   /api/inspection/:sessionId/rooms
  → Body: { name, roomType, structure, dimensions, phase }
  → Create room, return room

GET    /api/inspection/:sessionId/rooms
  → Return all rooms with status, damage count, photo count

PATCH  /api/inspection/:sessionId/rooms/:roomId
  → Update room status

POST   /api/inspection/:sessionId/rooms/:roomId/complete
  → Mark room complete
```

### Damage Observations
```
POST   /api/inspection/:sessionId/damages
  → Body: { roomId, description, damageType, severity, location, measurements }
  → Create damage, increment room damage count, return damage

GET    /api/inspection/:sessionId/damages
  → Return all damages (optionally filtered by roomId)
```

### Line Items
```
POST   /api/inspection/:sessionId/line-items
  → Body: { roomId, damageId, category, action, description, xactCode, quantity, unit, unitPrice, depreciationType, wasteFactor }
  → Calculate totalPrice = quantity * unitPrice * (1 + wasteFactor/100)
  → Create line item, return it

GET    /api/inspection/:sessionId/line-items
  → Return all line items

GET    /api/inspection/:sessionId/estimate-summary
  → Return { totalRCV, totalDepreciation, totalACV, deductible, netClaim, itemCount }

PATCH  /api/inspection/:sessionId/line-items/:id
  → Update line item

DELETE /api/inspection/:sessionId/line-items/:id
  → Remove line item
```

### Photos
```
POST   /api/inspection/:sessionId/photos
  → Body: { roomId, damageId, imageBase64, autoTag, caption, photoType }
  → Upload image to Supabase Storage: inspections/{sessionId}/{autoTag}.jpg
  → Create photo record, increment room photo count, return { photoId, storagePath }

GET    /api/inspection/:sessionId/photos
  → Return all photos with signed URLs
```

### Moisture
```
POST   /api/inspection/:sessionId/moisture
  → Body: { roomId, location, reading, materialType, dryStandard }
  → Create reading, return it

GET    /api/inspection/:sessionId/moisture
  → Return all readings (optionally filtered by roomId)
```

### Transcript
```
POST   /api/inspection/:sessionId/transcript
  → Body: { speaker, content }
  → Append to transcript

GET    /api/inspection/:sessionId/transcript
  → Return full transcript
```

### OpenAI Realtime Session
```
POST   /api/realtime/session
  → Body: { claimId, sessionId }
  → Load the claim's briefing data from Supabase
  → Build the system instructions (see Step 4)
  → Build the tool definitions (see Step 5)
  → Call OpenAI: POST https://api.openai.com/v1/realtime/sessions
    with body: { model: "gpt-4o-realtime-preview", voice: "alloy", instructions, tools, modalities: ["audio", "text"] }
    headers: { Authorization: "Bearer ${OPENAI_API_KEY}", Content-Type: "application/json" }
  → Return the client_secret from the response to the browser
  → The browser uses this to establish its WebRTC connection
```

---

## Step 4: System Instructions for the Voice Agent

Build these dynamically when creating the Realtime session. Inject the briefing data so the agent has full context about the claim.

```typescript
function buildSystemInstructions(briefing: any, claim: any): string {
  return `You are an expert insurance inspection assistant for Claims IQ. You are guiding a field adjuster through a property inspection via voice conversation on an iPad.

## Your Identity
- Name: Claims IQ Inspector
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

2. **Guided Flow:** Follow the 8-phase inspection flow:
   Phase 1: Pre-Inspection (review briefing highlights)
   Phase 2: Session Setup (confirm peril, price list, structures)
   Phase 3: Exterior (roof, siding, gutters, windows, each elevation)
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

7. **Coverage Limits:** The deductible is $${briefing.coverageSnapshot?.deductible || 'unknown'}. Coverage A limit is $${briefing.coverageSnapshot?.coverageA?.limit || 'unknown'}. Alert the adjuster if the running estimate approaches or exceeds any coverage limit.

8. **Keep It Conversational:** This is a voice interface. Keep responses to 1-2 sentences. Don't read back long lists. Say "Got it" or "Added" for confirmations. Only elaborate when asked.`;
}
```

---

## Step 5: Tool Definitions for the Realtime Session

Register these 10 tools with the Realtime API session. These are the POC tool set — enough to run a complete inspection.

```typescript
const realtimeTools = [
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
        name: { type: "string", description: "Room name, e.g., 'Master Bedroom', 'North Slope', 'Front Elevation'" },
        roomType: { type: "string", description: "e.g., 'interior_bedroom', 'exterior_roof', 'exterior_siding'" },
        structure: { type: "string", description: "Which structure this room belongs to" },
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
    description: "Adds an Xactimate-compatible estimate line item. Call when damage warrants a repair action.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["Roofing", "Siding", "Soffit/Fascia", "Gutters", "Windows", "Doors", "Drywall", "Painting", "Flooring", "Plumbing", "Electrical", "HVAC", "Debris", "General", "Fencing"] },
        action: { type: "string", enum: ["R&R", "Detach & Reset", "Repair", "Paint", "Clean", "Tear Off", "Labor Only", "Install"] },
        description: { type: "string", description: "Detailed item, e.g., 'Laminated composition shingles' or '6-inch aluminum fascia'" },
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
    description: "Triggers the iPad camera to capture a photo. Call when evidence is needed for damage, overview, or test squares.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Caption for the photo, e.g., 'Hail Test Square - North Slope'" },
        photoType: { type: "string", enum: ["overview", "damage_detail", "test_square", "moisture", "pre_existing"] },
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
```

---

## Step 6: Ephemeral Key Server Endpoint

**File: `server/routes.ts`** (add to existing routes)

```typescript
// POST /api/realtime/session
// Creates an OpenAI Realtime session and returns the client_secret for WebRTC
router.post("/api/realtime/session", async (req, res) => {
  const { claimId, sessionId } = req.body;

  // Load the claim and its briefing
  const claim = await getClaim(claimId);
  const briefing = await getBriefing(claimId);

  if (!claim || !briefing) {
    return res.status(400).json({ error: "Claim or briefing not found" });
  }

  // Build the session configuration
  const instructions = buildSystemInstructions(briefing, claim);

  // Request an ephemeral session from OpenAI
  const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-realtime-preview",
      voice: "alloy",
      instructions: instructions,
      tools: realtimeTools,
      input_audio_transcription: { model: "whisper-1" },
      modalities: ["audio", "text"],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    return res.status(500).json({ error: "Failed to create Realtime session", details: data });
  }

  // Return the client_secret to the browser
  res.json({
    clientSecret: data.client_secret.value,
    sessionId: sessionId,
  });
});
```

---

## Step 7: Frontend — WebRTC Connection in ActiveInspection.tsx

This is the core frontend work. The ActiveInspection page must:
1. Request an ephemeral key from our server
2. Establish a WebRTC peer connection to OpenAI
3. Handle audio I/O via the peer connection
4. Handle tool calls via the data channel
5. Update the UI in real-time as the agent processes

### WebRTC Connection Flow

```typescript
// 1. Get ephemeral key from our server
const tokenResponse = await fetch("/api/realtime/session", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ claimId, sessionId }),
});
const { clientSecret } = await tokenResponse.json();

// 2. Create peer connection
const pc = new RTCPeerConnection();

// 3. Set up audio output — remote audio from the agent
const audioElement = document.createElement("audio");
audioElement.autoplay = true;
pc.ontrack = (event) => {
  audioElement.srcObject = event.streams[0];
};

// 4. Set up audio input — microphone
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
pc.addTrack(stream.getTracks()[0]);

// 5. Create data channel for events
const dataChannel = pc.createDataChannel("oai-events");

dataChannel.onmessage = (event) => {
  const serverEvent = JSON.parse(event.data);
  handleRealtimeEvent(serverEvent);
};

// 6. Create SDP offer and connect
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);

const sdpResponse = await fetch("https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${clientSecret}`,
    "Content-Type": "application/sdp",
  },
  body: offer.sdp,
});

const sdpAnswer = await sdpResponse.text();
await pc.setRemoteDescription({ type: "answer", sdp: sdpAnswer });
```

### Handling Realtime Events

```typescript
function handleRealtimeEvent(event: any) {
  switch (event.type) {
    // Voice activity
    case "input_audio_buffer.speech_started":
      setVoiceState("listening");
      break;

    case "input_audio_buffer.speech_stopped":
      setVoiceState("processing");
      break;

    case "response.audio.delta":
      setVoiceState("speaking");
      break;

    case "response.audio.done":
      setVoiceState("idle");
      break;

    // Transcription (what the user said)
    case "conversation.item.input_audio_transcription.completed":
      addTranscript("user", event.transcript);
      break;

    // Agent text response
    case "response.audio_transcript.delta":
      appendAgentText(event.delta);
      break;

    case "response.audio_transcript.done":
      finalizeAgentText(event.transcript);
      addTranscript("agent", event.transcript);
      break;

    // *** TOOL CALLS — THE CRITICAL PART ***
    case "response.function_call_arguments.done":
      executeToolCall(event);
      break;

    case "response.done":
      // Response complete — check if tool calls need results
      break;

    case "error":
      handleError(event.error);
      break;
  }
}
```

### Executing Tool Calls

When the Realtime API calls a tool, the browser receives it via the data channel. The browser calls our Express API to persist the data, then sends the result back to the Realtime API.

```typescript
async function executeToolCall(event: any) {
  const { name, arguments: argsString, call_id } = event;
  const args = JSON.parse(argsString);

  let result: any;

  try {
    switch (name) {
      case "set_inspection_context":
        // Update local state + server
        await fetch(`/api/inspection/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPhase: args.phase, currentStructure: args.structure }),
        });
        result = { success: true, context: args };
        // Update UI: phase stepper, context card
        setCurrentContext(args);
        break;

      case "create_room":
        const roomRes = await fetch(`/api/inspection/${sessionId}/rooms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
        });
        const room = await roomRes.json();
        result = { success: true, roomId: room.id, name: room.name };
        // Update UI: add room to sidebar list
        addRoomToList(room);
        break;

      case "complete_room":
        // Find room by name, mark complete
        result = { success: true, roomName: args.roomName };
        // Update UI: room turns green in sidebar
        break;

      case "add_damage":
        const damageRes = await fetch(`/api/inspection/${sessionId}/damages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...args, roomId: currentRoomId }),
        });
        const damage = await damageRes.json();
        result = { success: true, damageId: damage.id };
        // Update UI: damage count badge on current room
        break;

      case "add_line_item":
        const lineRes = await fetch(`/api/inspection/${sessionId}/line-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...args, roomId: currentRoomId }),
        });
        const lineItem = await lineRes.json();
        result = {
          success: true,
          lineItemId: lineItem.id,
          totalPrice: lineItem.totalPrice,
          description: lineItem.description,
        };
        // Update UI: new line item slides into right panel, running total updates
        addLineItemToPanel(lineItem);
        refreshEstimateSummary();
        break;

      case "trigger_photo_capture":
        // Show camera overlay
        setCameraMode({
          active: true,
          label: args.label,
          photoType: args.photoType,
          overlay: args.overlay || "none",
        });
        result = { success: true, message: "Camera activated. Waiting for capture." };
        break;

      case "log_moisture_reading":
        const moistRes = await fetch(`/api/inspection/${sessionId}/moisture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...args, roomId: currentRoomId }),
        });
        result = { success: true, reading: args.reading, status: args.reading > 17 ? "wet" : args.reading > 14 ? "caution" : "dry" };
        break;

      case "get_progress":
        const progressRes = await fetch(`/api/inspection/${sessionId}`);
        const progress = await progressRes.json();
        result = {
          totalRooms: progress.rooms.length,
          completedRooms: progress.rooms.filter(r => r.status === "complete").length,
          currentPhase: progress.session.currentPhase,
          totalPhotos: progress.rooms.reduce((sum, r) => sum + r.photoCount, 0),
          totalLineItems: progress.lineItemCount,
        };
        break;

      case "get_estimate_summary":
        const estRes = await fetch(`/api/inspection/${sessionId}/estimate-summary`);
        result = await estRes.json();
        break;

      case "complete_inspection":
        await fetch(`/api/inspection/${sessionId}/complete`, { method: "POST" });
        result = { success: true, message: "Inspection finalized." };
        // Navigate to Review & Finalize screen
        break;
    }
  } catch (error) {
    result = { success: false, error: error.message };
  }

  // Send the tool result back to the Realtime API via data channel
  dataChannel.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: call_id,
      output: JSON.stringify(result),
    },
  }));

  // Tell the model to continue generating a response
  dataChannel.send(JSON.stringify({
    type: "response.create",
  }));
}
```

---

## Step 8: Voice State Machine & UI

The ActiveInspection.tsx three-panel layout is already built. Wire these state updates into the existing components:

### Voice States (Center Stage)

```typescript
type VoiceState = "idle" | "listening" | "processing" | "speaking" | "error" | "disconnected";

// Map to VoiceIndicator.tsx:
// idle       → gray circle
// listening  → Primary Purple #7763B7 pulsing waveform
// processing → Gold #C6A54E spinning dots
// speaking   → Primary Purple #7763B7 animated bars
// error      → Gold #C6A54E border, error message
// disconnected → Red banner "Voice disconnected — Reconnecting…"
```

### Left Sidebar
- Phase stepper: highlight current phase based on `session.currentPhase`
- Room list: populate from `GET /api/inspection/:sessionId/rooms`, live-update as rooms are created/completed
- Current room: highlighted with Primary Purple left border

### Center Stage
- Voice status indicator: driven by `voiceState`
- Live transcription: append from `conversation.item.input_audio_transcription.completed`
- Agent response: append from `response.audio_transcript.delta`
- Current context card: update from `set_inspection_context` tool calls
- Quick action bar: Camera (triggers photo), Pause (pauses session), Flag, Skip to Next

### Right Panel
- Running total: fetch from `/api/inspection/:sessionId/estimate-summary`, refresh on every `add_line_item`
- Recent line items: last 5, animate new items in
- Recent photos: thumbnail strip, update on photo capture
- Collapse toggle: hide right panel for more center stage space

---

## Step 9: Camera Capture Integration

When `trigger_photo_capture` is called, show a camera overlay on the ActiveInspection screen.

```typescript
// Camera overlay component behavior:
// 1. Request camera access: navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
// 2. Display live viewfinder
// 3. Show auto-tag banner at top (from the tool call's label)
// 4. Capture button takes photo → canvas.toDataURL("image/jpeg", 0.8)
// 5. Send to server: POST /api/inspection/:sessionId/photos with imageBase64
// 6. Close overlay, return to inspection
// 7. Send function result back to Realtime API confirming photo was taken
```

The adjuster can also say "take a photo" at any time, which the agent interprets and calls `trigger_photo_capture`.

---

## Step 10: Install Dependencies

```bash
npm install @supabase/supabase-js
```

No additional packages needed — WebRTC is built into the browser, and the OpenAI Realtime API is accessed via standard `fetch` and `RTCPeerConnection`.

---

## Environment Variables

No new environment variables needed. The existing `OPENAI_API_KEY` is used to create ephemeral sessions. The existing Supabase credentials handle database and storage.

---

## Test Flow After Implementation

1. Open app → navigate to a claim with a completed briefing
2. Tap "START INSPECTION" → inspection session created in Supabase
3. WebRTC connection established → voice indicator shows "idle"
4. Agent speaks: "Good morning. I have the briefing for the Penson claim at 1847 Maple Ridge Drive. This is a hail claim with a $2,500 deductible. Ready to begin?"
5. Adjuster: "Let's start with the roof" → agent calls `set_inspection_context` + `create_room`
6. Left sidebar: Phase 3 highlighted, "Roof - North Slope" appears in room list
7. Adjuster: "Composition shingle, I count 10 hits in the test square" → agent calls `add_damage` + `add_line_item` + `trigger_photo_capture`
8. Camera overlay appears: "RF-TSQ-01 — Roof Test Square, North Slope"
9. Adjuster takes photo → photo uploads to Supabase Storage → overlay closes
10. Right panel: new line items animate in, running total updates
11. Adjuster: "Moving inside to the master bedroom, 14 by 16" → agent calls `create_room` with dimensions
12. Agent: "Master bedroom created, 14 by 16. What do you see?"
13. Continue through all rooms...
14. Adjuster: "That's everything, let's wrap up" → agent calls `complete_inspection`
15. Navigate to Review & Finalize screen with all data populated

---

## What NOT to Change

- Do NOT alter any Act 1 functionality (document upload, parsing, extraction review, briefing)
- Do NOT change existing page layouts — add to ActiveInspection.tsx, don't rebuild it
- Do NOT modify the Claims List, Document Upload, Extraction Review, or Inspection Briefing screens
- Do NOT add authentication
- ONLY add the voice engine, inspection data layer, and wire the ActiveInspection screen
