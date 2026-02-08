# Voice Agent Flow — Deep Technical Guide

This document describes, in full detail, how the Claims IQ Voice Inspector voice agent works — from connection setup to tool execution to teardown.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Connection Flow](#2-connection-flow)
3. [System Instructions & Agent Persona](#3-system-instructions--agent-persona)
4. [Voice Activity Detection & Audio Flow](#4-voice-activity-detection--audio-flow)
5. [Realtime Event Loop](#5-realtime-event-loop)
6. [Tool Definitions (18 Tools)](#6-tool-definitions-18-tools)
7. [Tool Execution Flow](#7-tool-execution-flow)
8. [Photo Capture Flow (Deferred Tool Result)](#8-photo-capture-flow-deferred-tool-result)
9. [5-Level Hierarchy System](#9-5-level-hierarchy-system)
10. [Inspection Phases](#10-inspection-phases)
11. [Skip Step & Password Protection](#11-skip-step--password-protection)
12. [Reconnection & Error Recovery](#12-reconnection--error-recovery)
13. [Disconnection & Cleanup](#13-disconnection--cleanup)
14. [Data Flow Diagram](#14-data-flow-diagram)

---

## 1. Architecture Overview

The voice agent uses a **browser-to-OpenAI direct WebRTC connection**. The server's role is limited to:
- Creating an ephemeral session token (with system instructions and tool definitions baked in)
- Serving API endpoints that the frontend calls when the voice agent triggers tool calls

```
┌─────────────────┐       WebRTC (audio + data channel)       ┌──────────────────┐
│   iPad/Browser  │ ◄──────────────────────────────────────►  │ OpenAI Realtime  │
│  (ActiveInsp.)  │                                            │   API Server     │
└────────┬────────┘                                            └──────────────────┘
         │
         │  HTTP (tool execution)
         ▼
┌─────────────────┐       Drizzle ORM        ┌──────────────────┐
│  Express Server │ ◄─────────────────────►  │  Supabase PgSQL  │
│   (routes.ts)   │                          │   + Storage      │
└─────────────────┘                          └──────────────────┘
```

**Key insight:** Audio never touches the Express server. It flows directly between the browser and OpenAI via WebRTC. The Express server only handles:
1. Creating the OpenAI Realtime session (ephemeral token)
2. Serving REST endpoints that tool calls hit (create room, add damage, save photo, etc.)

---

## 2. Connection Flow

### Step 1: User clicks "Connect" on ActiveInspection page

The `connectVoice()` function in `ActiveInspection.tsx` (line 807) fires.

### Step 2: Obtain ephemeral token from server

```
POST /api/realtime/session
Body: { claimId, sessionId }
Headers: Authorization: Bearer <supabase-jwt>
```

The server (`routes.ts` line 1454):
1. Loads the claim data and AI-generated briefing
2. Loads user preferences (voice model, VAD sensitivity, verbosity)
3. Builds system instructions via `buildSystemInstructions()` from `realtime.ts`
4. Calls OpenAI's `POST https://api.openai.com/v1/realtime/sessions` with:
   - `model`: `gpt-4o-realtime-preview`
   - `voice`: User's chosen voice (default: `alloy`)
   - `instructions`: Full system prompt with claim data, briefing, hierarchy rules, phase flow
   - `tools`: The 18 `realtimeTools` array from `realtime.ts`
   - `input_audio_transcription`: `{ model: "whisper-1", language: "en" }`
   - `modalities`: `["audio", "text"]`
   - `turn_detection`: Server VAD config (or `null` if push-to-talk)
5. Returns `{ clientSecret, sessionId }` to the frontend

### Step 3: Create WebRTC connection

The frontend creates an `RTCPeerConnection` and:
1. Creates an `<audio>` element for playback (`autoplay: true`)
2. Sets `pc.ontrack` to pipe remote audio into the `<audio>` element
3. Requests microphone access via `getUserMedia({ audio: true })`
4. Adds the local audio track to the peer connection
5. Creates a data channel named `"oai-events"` for JSON messaging

### Step 4: Data channel event handlers

- **`dc.onopen`**: Sets connected state, triggers initial greeting
- **`dc.onmessage`**: Parses JSON events, dispatches to `handleRealtimeEvent()`
- **`dc.onclose`**: Triggers auto-reconnect after 3 seconds

### Step 5: SDP exchange

1. Creates local SDP offer
2. Sets it as local description
3. Sends the SDP to `https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview` with the ephemeral token
4. Receives SDP answer, sets as remote description
5. WebRTC connection is now live — audio flows bidirectionally

### Step 6: Initial greeting

On first connection (tracked by `hasGreetedRef`), the frontend sends:

```json
{
  "type": "response.create",
  "response": {
    "instructions": "Begin the inspection now. Follow your system instructions for the mandatory first step."
  }
}
```

This triggers the agent to:
1. Call `get_inspection_state` to check existing data
2. Call `create_structure` for "Main Dwelling" if none exists
3. Greet the adjuster and request property verification photo

---

## 3. System Instructions & Agent Persona

Defined in `server/realtime.ts` → `buildSystemInstructions()`.

### Persona
- **Name:** Claims IQ Inspector
- **Voice style:** Professional, concise, efficient — like a senior adjuster mentoring a colleague
- **Language:** Always English
- **Behavior:** Confirms every action briefly. No filler words. 1-2 sentence responses.

### Dynamic context injected
- Claim number, insured name, property address, date of loss, peril type
- Full briefing data: property profile, coverage snapshot, peril analysis, endorsement impacts, inspection checklist, red flags
- Peril-specific instructions (hail vs wind vs water)
- Coverage limits and deductible amounts

### 5-Level Hierarchy Rules
The system instructions contain strict rules about the hierarchy:
- L1 (Structure) must exist before L2 (Room) can be created
- L2 must specify viewType and structure
- L3 (Sub-Area) requires a parent room
- L4 (Opening) requires a room and wall index
- L5 (Annotation) requires a room

### Context Awareness Rules
- On session start: Call `get_inspection_state` first
- Before creating rooms: Verify structure exists
- After completing an area: Call `get_inspection_state` to decide next steps
- Track dimensions carefully — they drive sketch and estimate quantities

---

## 4. Voice Activity Detection & Audio Flow

### VAD Configuration (set server-side)
Three sensitivity levels, configurable per user:

| Level  | Threshold | Silence Duration | Prefix Padding |
|--------|-----------|-----------------|----------------|
| Low    | 0.85      | 1200ms          | 600ms          |
| Medium | 0.75      | 800ms           | 400ms          |
| High   | 0.60      | 500ms           | 300ms          |

- **Threshold:** How loud speech needs to be to trigger (lower = more sensitive)
- **Silence Duration:** How long silence before the turn ends
- **Prefix Padding:** Audio buffered before speech start (prevents cutting off beginnings)

### Push-to-Talk Mode
When enabled, `turn_detection` is set to `null` — the user must hold a button to speak. The frontend sends manual `input_audio_buffer.commit` messages.

### Audio Path
```
Microphone → getUserMedia → RTCPeerConnection → OpenAI Realtime API
OpenAI Realtime API → RTCPeerConnection.ontrack → <audio> element → Speaker
```

---

## 5. Realtime Event Loop

The `handleRealtimeEvent()` function (line 751) processes all incoming data channel messages:

| Event Type | Action |
|-----------|--------|
| `input_audio_buffer.speech_started` | Set voice state to "listening" |
| `input_audio_buffer.speech_stopped` | Set voice state to "processing" |
| `response.audio.delta` | Set voice state to "speaking" |
| `response.audio.done` | Set voice state to "idle" |
| `conversation.item.input_audio_transcription.completed` | Add user's speech to transcript |
| `response.audio_transcript.delta` | Append to agent's partial text (live typing effect) |
| `response.audio_transcript.done` | Finalize agent's transcript entry |
| `response.function_call_arguments.done` | Execute the tool call via `executeToolCall()` |
| `error` | Log error, set voice state to "error", auto-recover after 5s |

### Voice State Machine
```
disconnected → (connect) → processing → idle ⇄ listening ⇄ processing ⇄ speaking
                                          ↕
                                        error → (5s timeout) → idle
```

---

## 6. Tool Definitions (18 Tools)

All tools are defined in `server/realtime.ts` → `realtimeTools[]`. Each tool is a JSON function definition sent to OpenAI's Realtime API at session creation.

### Hierarchy Tools (L1-L5)

#### `create_structure` — L1 Structure
Creates a top-level structure. Must be called before creating rooms.
- **Required:** `name`, `structureType` (dwelling/garage/shed/fence/pool/other)
- **Server endpoint:** `POST /api/inspection/:sessionId/structures`
- **Dedup:** Unique constraint on (sessionId, name) — returns existing if duplicate

#### `create_room` — L2 Room/Area
Creates a room within a structure.
- **Required:** `name`, `structure` (structure name), `viewType` (interior/roof_plan/elevation/exterior_other)
- **Optional:** `roomType` (enum of 20+ types), `shapeType`, `length`, `width`, `height`, `floor`, `facetLabel`, `pitch`, `phase`
- **Server endpoint:** `POST /api/inspection/:sessionId/rooms`
- **Dedup for elevations:** Server returns existing room if duplicate elevation type for same structure

#### `create_sub_area` — L3 Sub-Area/Attachment
Creates a child room attached to a parent.
- **Required:** `name`, `parentRoomName`, `attachmentType` (extension/closet/dormer/bay_window/alcove/island/bump_out/other)
- **Optional:** `length`, `width`, `height`
- **Lookup:** Finds parent room by name, copies structure reference

#### `add_opening` — L4 Opening/Deduction
Adds a door, window, or opening to a room wall.
- **Required:** `roomName`, `openingType` (door/window/sliding_door/french_door/missing_wall/archway/cased_opening), `width`, `height`
- **Optional:** `wallIndex` (0=north, 1=east, 2=south, 3=west), `label`, `opensInto`
- **Server endpoint:** `POST /api/inspection/:sessionId/rooms/:roomId/openings`

#### `add_sketch_annotation` — L5 Annotation
Adds metadata to a room or facet.
- **Required:** `roomName`, `annotationType` (hail_count/pitch/storm_direction/material_note/measurement/general_note), `label`, `value`
- **Optional:** `location`
- **Server endpoint:** `POST /api/inspection/:sessionId/rooms/:roomId/annotations`

### Context & State Tools

#### `set_inspection_context`
Updates current location tracking (structure, area, phase). Persists to session.
- **Required:** `area`
- **Optional:** `structure`, `phase` (1-8)
- **Server endpoint:** `PATCH /api/inspection/:sessionId`

#### `get_inspection_state`
Returns the complete hierarchy tree: all structures → rooms → sub-areas → openings → annotations → damage counts.
- **No parameters**
- **Server endpoint:** `GET /api/inspection/:sessionId/hierarchy`
- **Returns:** Full nested structure with summary counts

#### `get_room_details`
Gets detailed info about a specific room including openings, annotations, and damage.
- **Optional:** `roomId` or `roomName`
- **Server endpoints:** `GET .../rooms/:roomId/openings` + `GET .../rooms/:roomId/annotations`

#### `get_progress`
Returns inspection progress metrics.
- **No parameters**
- **Returns:** `totalRooms`, `completedRooms`, `currentPhase`, `totalPhotos`, `totalLineItems`

#### `get_estimate_summary`
Returns running estimate totals.
- **No parameters**
- **Server endpoint:** `GET /api/inspection/:sessionId/estimate-summary`
- **Returns:** `totalRCV`, `totalDepreciation`, `totalACV`, `itemCount`

### Damage & Estimate Tools

#### `add_damage`
Records a damage observation in the current room.
- **Required:** `description`, `damageType` (hail_impact/wind_damage/water_stain/water_intrusion/crack/dent/missing/rot/mold/mechanical/wear_tear/other)
- **Optional:** `severity` (minor/moderate/severe), `location`, `extent`, `hitCount`
- **Server endpoint:** `POST /api/inspection/:sessionId/damages`
- **Note:** Uses `currentRoomId` from frontend state

#### `add_line_item`
Adds an Xactimate-compatible estimate line item.
- **Required:** `category` (15 categories), `action` (R&R/Detach & Reset/Repair/Paint/Clean/Tear Off/Labor Only/Install), `description`
- **Optional:** `catalogCode` (triggers pricing catalog lookup), `quantity`, `unit`, `unitPrice`, `wasteFactor`, `depreciationType`
- **Catalog lookup flow:** If `catalogCode` provided → search pricing catalog → get unit price → calculate total with waste factor
- **Server endpoint:** `POST /api/inspection/:sessionId/line-items`

#### `complete_room`
Marks a room as completed.
- **Required:** `roomName`
- **Server endpoint:** `POST /api/inspection/:sessionId/rooms/:roomId/complete`

### Photo & Moisture Tools

#### `trigger_photo_capture`
Opens the iPad camera for photo capture.
- **Required:** `label` (photo caption), `photoType` (overview/address_verification/damage_detail/test_square/moisture/pre_existing)
- **Optional:** `overlay` (none/test_square_grid/measurement_ruler)
- **Special behavior:** This is a DEFERRED tool call — see Section 8

#### `log_moisture_reading`
Records a moisture meter reading.
- **Required:** `location`, `reading` (percentage)
- **Optional:** `materialType` (drywall/wood_framing/subfloor/concrete/carpet_pad/insulation), `dryStandard`
- **Server endpoint:** `POST /api/inspection/:sessionId/moisture`
- **Returns:** Reading with status classification (dry/caution/wet based on 14/17 thresholds)

### Flow Control Tools

#### `skip_step`
Skips the current step. Requires voice password confirmation.
- **Required:** `stepDescription`, `passwordConfirmed` (must be `true`)
- **Optional:** `reason`
- **Validation:** Rejects if `passwordConfirmed` is not `true`
- **See Section 11 for password flow**

#### `complete_inspection`
Finalizes the inspection and navigates to review page.
- **Optional:** `notes`
- **Important:** Does NOT mark the claim as complete — claim stays "in progress" until user explicitly marks it complete on the review page
- **Action:** Navigates to `/inspection/:claimId/review` after 2 seconds

---

## 7. Tool Execution Flow

When OpenAI's Realtime API decides to call a tool, the following sequence occurs:

```
1. OpenAI sends: response.function_call_arguments.done
   Contains: { name, arguments (JSON string), call_id }

2. handleRealtimeEvent() dispatches to executeToolCall()

3. executeToolCall() parses the arguments JSON

4. Switch on tool name → execute the appropriate handler:
   - Most tools: Make authenticated HTTP request to Express server
   - Server processes request → interacts with Supabase PostgreSQL via Drizzle ORM
   - Server returns result

5. Frontend builds result object: { success: true/false, ...data }

6. Frontend sends result back via data channel:
   {
     type: "conversation.item.create",
     item: {
       type: "function_call_output",
       call_id: <original call_id>,
       output: JSON.stringify(result)
     }
   }

7. Frontend sends: { type: "response.create" }
   This tells OpenAI to generate the next response incorporating the tool result

8. OpenAI speaks the result to the adjuster
```

### Authentication for Tool API Calls
Every HTTP request from `executeToolCall()` includes Supabase JWT headers obtained via `getAuthHeaders()`:
```
Authorization: Bearer <supabase-access-token>
Content-Type: application/json
```

### State Updates After Tool Execution
Several tools trigger frontend state refreshes:
- `create_room`, `create_sub_area`, `complete_room`, `add_damage`: Call `refreshRooms()` to update room list
- `add_line_item`: Calls `refreshLineItems()` to update estimate display
- `create_room`: Also updates `currentRoomId` and `currentArea`
- `set_inspection_context`: Updates `currentPhase`, `currentStructure`, `currentArea`

---

## 8. Photo Capture Flow (Deferred Tool Result)

The `trigger_photo_capture` tool is unique — it has a **deferred result pattern** because the agent must wait for the adjuster to actually take the photo.

### Flow:

```
1. OpenAI calls trigger_photo_capture with { label, photoType, overlay }

2. executeToolCall() does NOT send a tool result back immediately
   Instead, it:
   - Stores { call_id, label, photoType } in pendingPhotoCallRef
   - Activates camera mode: setCameraMode({ active: true, ... })
   - Returns early (skips the dcRef.current.send() at the end)

3. Camera UI overlay appears on screen
   - Opens rear camera via getUserMedia({ video: { facingMode: "environment" } })
   - Shows viewfinder with label overlay

4. User frames the shot and taps "Capture"

5. handleCameraCapture() fires:
   a. Draws video frame to canvas, exports as JPEG base64
   b. Stops the camera stream
   c. Uploads photo to backend:
      POST /api/inspection/:sessionId/photos
      Body: { roomId, imageBase64, autoTag, caption, photoType }
      Server uploads to Supabase Storage, returns { photoId, storagePath }
   
   d. Sends photo for AI analysis:
      POST /api/inspection/:sessionId/photos/:photoId/analyze
      Body: { imageBase64, expectedLabel, expectedPhotoType }
      Server sends to GPT-4o Vision, returns:
      { description, damageVisible, matchesExpected, matchExplanation, qualityScore }
   
   e. Adds photo to local gallery state (with thumbnail + analysis)
   
   f. Builds photoResult with analysis data
   
   g. NOW sends the deferred tool result:
      {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: <stored call_id>,
          output: JSON.stringify(photoResult)
        }
      }
      Followed by: { type: "response.create" }
   
   h. Clears pendingPhotoCallRef
   i. Closes camera overlay

6. OpenAI receives the photo result and speaks about what it shows
   - If matchesExpected is false, the agent may ask for a retake
   - If damageVisible is true, the agent may suggest adding damage/line items
```

### Photo Analysis Result Structure
```json
{
  "success": true,
  "photoId": 42,
  "message": "Photo captured and saved.",
  "analysis": {
    "description": "Front elevation of a two-story residential home...",
    "damageVisible": true,
    "matchesExpected": true,
    "matchExplanation": "Photo matches the requested 'Front Elevation' view",
    "qualityScore": 8
  }
}
```

If the photo doesn't match the request, a `warning` field is added to alert the agent.

---

## 9. 5-Level Hierarchy System

The hierarchy is central to both the sketch rendering and Xactimate-compatible estimates.

```
L1: Structure (create_structure)
├── L2: Room / Area (create_room)
│   ├── L3: Sub-Area (create_sub_area)
│   │   └── (inherits parent's structure)
│   ├── L4: Opening (add_opening)
│   │   └── Wall index 0-3, width/height → deductions in estimate
│   └── L5: Annotation (add_sketch_annotation)
│       └── hail_count, pitch, storm_direction, material_note, measurement
```

### View Types (L2 categorization for sketch)
| viewType | Sketch Rendering | Examples |
|----------|-----------------|----------|
| `interior` | Floor plan rectangles with walls | Bedrooms, Kitchen, Bathrooms |
| `roof_plan` | Plan view with ridge line + facets | North Slope, South Slope |
| `elevation` | Side view with wall + roof profile | Front Elevation, Left Elevation |
| `exterior_other` | Simple labeled rectangles | Gutters, Porch, Deck |

### Room Types (20+ enum values)
Interior: `interior_bedroom`, `interior_bathroom`, `interior_kitchen`, `interior_living`, `interior_hallway`, `interior_closet`, `interior_laundry`, `interior_basement`, `interior_attic`, `interior_other`

Exterior: `exterior_roof_slope`, `exterior_elevation_front/left/right/rear`, `exterior_gutter`, `exterior_garage_door`, `exterior_porch`, `exterior_deck`, `exterior_fence`, `exterior_other`

### Hierarchy API Endpoint
```
GET /api/inspection/:sessionId/hierarchy
```
Returns nested structure:
```json
{
  "structures": [
    {
      "id": 1,
      "name": "Main Dwelling",
      "structureType": "dwelling",
      "rooms": [
        {
          "id": 3,
          "name": "Front Elevation",
          "viewType": "elevation",
          "roomType": "exterior_elevation_front",
          "dimensions": { "length": 40, "height": 10 },
          "subAreas": [],
          "openings": [
            { "id": 1, "openingType": "door", "wallIndex": 0, "width": 3, "height": 7 }
          ],
          "annotations": [],
          "damageCount": 2,
          "photoCount": 3
        }
      ]
    }
  ]
}
```

---

## 10. Inspection Phases

The voice agent follows an 8-phase inspection flow:

| Phase | Name | Activities |
|-------|------|-----------|
| 1 | Pre-Inspection | Review briefing highlights with adjuster |
| 2 | Session Setup | Confirm peril, price list, identify structures on site |
| 3 | Exterior | Roof (facets, test squares, annotations), Elevations (openings, siding), Gutters, Other |
| 4 | Interior | Room-by-room: dimensions, sub-areas, openings, damage, line items |
| 5 | Moisture | Water peril: moisture readings, drying calculations, IICRC classification |
| 6 | Evidence | Photo completeness review |
| 7 | Estimate | Line item review, labor minimums |
| 8 | Finalize | Summary, completeness check, navigate to review page |

### Mandatory First Step (before Phase 1)
1. Call `get_inspection_state`
2. If no structures exist, call `create_structure` with "Main Dwelling"
3. Greet adjuster
4. Call `trigger_photo_capture` for property verification photo
5. Compare photo against claim data
6. Only then proceed to Phase 1

### Phase 3 Exterior Detail
For each structure:
1. **Roof** — Create rooms with `viewType: "roof_plan"` for each slope
   - Set `facetLabel` (F1, F2, etc.) and `pitch` (6/12, 8/12)
   - Record test squares using `add_sketch_annotation` (type: "hail_count")
   - Capture overview and damage photos per slope
2. **Elevations** — Create rooms with `viewType: "elevation"`
   - Add openings (doors, windows) using `add_opening`
   - Inspect siding, trim, fascia, soffit
3. **Gutters & Other** — Create with `viewType: "exterior_other"`

---

## 11. Skip Step & Password Protection

To prevent accidental skips during voice inspection:

1. Adjuster says "skip this" or similar
2. Agent responds: "To skip a step, please say the voice password first."
3. Agent does NOT reveal the password
4. Adjuster says "123" or "one two three"
5. Agent acknowledges: "Override confirmed."
6. Agent calls `skip_step` with `passwordConfirmed: true`
7. If `passwordConfirmed` is not `true`, the tool returns an error

The password is "123" (spoken as "one-two-three").

---

## 12. Reconnection & Error Recovery

### Auto-Reconnect
When the data channel closes (`dc.onclose`):
1. Set voice state to "disconnected"
2. Wait 3 seconds
3. If peer connection is still closed, call `connectVoice()` again
4. New ephemeral token is obtained, new WebRTC connection established
5. `hasGreetedRef` prevents duplicate greetings on reconnect

### Error Recovery
When a realtime error occurs:
1. Log the error
2. Set voice state to "error"
3. After 5 seconds, auto-recover to "idle" state
4. User can continue speaking normally

---

## 13. Disconnection & Cleanup

`disconnectVoice()` performs full cleanup:
1. Stop all microphone audio tracks
2. Close the RTCPeerConnection
3. Clear the data channel reference
4. Clear the audio element's source
5. Clear all pending timeouts (reconnect, error recovery)
6. Reset all connection state flags

This also runs on component unmount via `useEffect` cleanup.

---

## 14. Data Flow Diagram

### Complete Tool Call Data Flow

```
┌─────────────┐                      ┌──────────────┐
│   Adjuster  │ ──── speaks ────►   │ Microphone   │
│   (voice)   │                      │ (WebRTC)     │
└─────────────┘                      └──────┬───────┘
                                            │ audio track
                                            ▼
                                     ┌──────────────┐
                                     │   OpenAI     │
                                     │  Realtime    │
                                     │    API       │
                                     └──────┬───────┘
                                            │
                              ┌─────────────┼─────────────┐
                              │             │             │
                              ▼             ▼             ▼
                        Audio response  Transcript   Tool Call
                        (via WebRTC)    (data chan)  (data chan)
                              │             │             │
                              ▼             ▼             ▼
                        ┌──────────┐  ┌──────────┐  ┌──────────────┐
                        │ Speaker  │  │Transcript│  │executeToolCall│
                        │ playback │  │ display  │  │   (switch)   │
                        └──────────┘  └──────────┘  └──────┬───────┘
                                                           │
                                                    HTTP to Express
                                                           │
                                                           ▼
                                                    ┌──────────────┐
                                                    │Express Server│
                                                    │  routes.ts   │
                                                    └──────┬───────┘
                                                           │
                                                    Drizzle ORM
                                                           │
                                                           ▼
                                                    ┌──────────────┐
                                                    │   Supabase   │
                                                    │  PostgreSQL  │
                                                    └──────────────┘
                                                           │
                                                    Result returned
                                                           │
                                                           ▼
                                                    ┌──────────────┐
                                                    │ Data Channel │
                                                    │ (tool result)│
                                                    └──────┬───────┘
                                                           │
                                                           ▼
                                                    ┌──────────────┐
                                                    │   OpenAI     │
                                                    │  speaks the  │
                                                    │   result     │
                                                    └──────────────┘
```

### Photo Capture Data Flow (Deferred)

```
OpenAI calls trigger_photo_capture
        │
        ▼
Store call_id in pendingPhotoCallRef
Activate camera overlay
        │
        ▼ (user frames and taps capture)
        │
handleCameraCapture()
        │
        ├──► POST /api/inspection/:sessionId/photos
        │    (upload to Supabase Storage)
        │
        ├──► POST .../photos/:photoId/analyze
        │    (GPT-4o Vision analysis)
        │
        ├──► Update local gallery state
        │
        └──► Send deferred tool result via data channel
             (using stored call_id)
                    │
                    ▼
             OpenAI speaks about the photo
```
