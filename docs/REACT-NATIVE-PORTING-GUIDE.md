# Claims IQ — React Native (Expo) Porting Guide

> Complete specification for rebuilding the Claims IQ web app as a React Native (Expo) mobile app.
> The backend Express server is reused as-is — the mobile app is an API client.
> Database and data are already ported.

---

## Table of Contents

1. [Architecture & Server Compatibility](#1-architecture--server-compatibility)
2. [Expo Project Setup](#2-expo-project-setup)
3. [Dependency Mapping](#3-dependency-mapping)
4. [Shared Code Strategy](#4-shared-code-strategy)
5. [Navigation Structure](#5-navigation-structure)
6. [Auth Flow](#6-auth-flow)
7. [Screen-by-Screen Specification](#7-screen-by-screen-specification)
8. [Voice Inspection (WebRTC)](#8-voice-inspection-webrtc)
9. [Property Sketch (SVG)](#9-property-sketch-svg)
10. [Camera & Photo System](#10-camera--photo-system)
11. [Offline Support](#11-offline-support)
12. [API Endpoint Reference](#12-api-endpoint-reference)
13. [Data Models](#13-data-models)
14. [Phased Build Plan](#14-phased-build-plan)

---

## 1. Architecture & Server Compatibility

The existing Express server is **fully mobile-compatible**:

| Concern | Status | Details |
|---------|--------|---------|
| Auth | Compatible | Bearer token in `Authorization` header, no cookies |
| Uploads | Compatible | All base64-in-JSON, no multipart/form-data |
| Downloads | Compatible | Supabase signed URLs |
| Voice | Compatible | OpenAI Realtime API via WebRTC `clientSecret` |
| Config | Compatible | `GET /api/config` returns `{ supabaseUrl, supabaseAnonKey }` |
| Real-time | Compatible | No custom WebSockets — uses OpenAI's WebRTC |

**Server changes needed:**
- CORS: add mobile origins (or `*` during dev)
- CSP: not needed for mobile (browser-only)

```
Mobile App (Expo)
    │
    │  fetch() + Bearer token
    ▼
Express Server (unchanged)
    │
    │  Drizzle ORM
    ▼
PostgreSQL (Supabase)
```

---

## 2. Expo Project Setup

```bash
npx create-expo-app claims-iq-mobile --template blank-typescript
cd claims-iq-mobile

npx expo install \
  expo-router expo-camera expo-av expo-file-system expo-sharing \
  expo-location expo-image expo-document-picker expo-secure-store \
  expo-image-picker expo-haptics expo-notifications \
  react-native-svg react-native-reanimated react-native-gesture-handler \
  react-native-webrtc react-native-pdf \
  @react-native-async-storage/async-storage \
  @react-native-community/netinfo \
  @tanstack/react-query \
  @gorhom/bottom-sheet \
  @react-navigation/native @react-navigation/bottom-tabs \
  @react-navigation/native-stack @react-navigation/material-top-tabs \
  react-native-paper react-native-safe-area-context \
  react-native-screens victory-native
```

---

## 3. Dependency Mapping

| Web Library | React Native Replacement |
|-------------|-------------------------|
| `wouter` (routing) | `expo-router` or `@react-navigation/native` |
| `@radix-ui/*` + `shadcn/ui` | `react-native-paper` or custom components |
| `framer-motion` | `react-native-reanimated` + `react-native-gesture-handler` |
| `lucide-react` | `@expo/vector-icons` (Feather, MaterialCommunityIcons) |
| `recharts` | `victory-native` |
| `localStorage` / `sessionStorage` | `expo-secure-store` (tokens) + `@react-native-async-storage/async-storage` (settings) |
| `<svg>`, `<rect>`, `<polygon>` | `react-native-svg` (`Svg`, `Rect`, `Polygon`) |
| `navigator.mediaDevices.getUserMedia()` | `expo-camera` + `expo-av` |
| `RTCPeerConnection` | `react-native-webrtc` |
| `HTMLCanvasElement` | `react-native-skia` or `expo-gl` |
| `fetch` with `credentials: "include"` | `fetch` with `Authorization: Bearer ...` header |
| `@tanstack/react-query` | Same — works in React Native |
| `IndexedDB` (offline queue) | `AsyncStorage` or `react-native-sqlite-storage` |
| `window.confirm()` | `Alert.alert()` |
| `document.createElement("a")` (downloads) | `expo-file-system` + `expo-sharing` |
| `<input type="file">` | `expo-document-picker` |
| `navigator.onLine` | `@react-native-community/netinfo` |
| `pdfjs-dist` | `react-native-pdf` |

---

## 4. Shared Code Strategy

### Copy directly (pure TypeScript, no DOM)

| File | Purpose |
|------|---------|
| `client/src/lib/openingToolNormalization.ts` | Inches-to-feet auto-conversion, wall direction normalization |
| `client/src/lib/sketchLayout.ts` | BFS room layout algorithm |
| `client/src/lib/polygonBuilder.ts` | Rectangle, L-shape, T-shape polygon generators |
| `client/src/lib/realtimeTooling.ts` | Tool error builders |
| `shared/schema.ts` | Type definitions (strip Drizzle `pgTable`, keep TypeScript types) |

### Adapt (swap web APIs)

| File | Changes Needed |
|------|---------------|
| `client/src/lib/queryClient.ts` | `localStorage` → `AsyncStorage`, remove `credentials: "include"`, use `SecureStore` for tokens |
| `client/src/lib/supabaseClient.ts` | Use `@supabase/supabase-js` with `AsyncStorage` storage adapter |
| `client/src/lib/offlineQueue.ts` | IndexedDB → AsyncStorage or SQLite |
| `client/src/contexts/AuthContext.tsx` | localStorage/sessionStorage → `expo-secure-store` |

### Extract from ActiveInspection.tsx

The `executeToolCall()` switch statement (lines 658-2459, ~1800 lines) should be extracted into `services/voiceToolExecutor.ts`. It only uses `fetch()` and state callbacks — no DOM APIs. This module can be shared between web and RN.

---

## 5. Navigation Structure

### Bottom Tab Navigator

```
┌─────────────────────────────────────────┐
│              Screen Content              │
├─────────────────────────────────────────┤
│  🏠 Home  📋 Scope  🎤 Inspect  ✅ Review  ⚙ Settings │
└─────────────────────────────────────────┘
```

| Tab | Icon | Stack Screens |
|-----|------|--------------|
| Home | `Home` | ClaimsList → DocumentUpload → ExtractionReview → InspectionBriefing |
| Scope | `List` | ScopePage |
| Inspect | `Mic` (prominent FAB) | ActiveInspection |
| Review | `ClipboardCheck` | ReviewFinalize → ExportPage → SupplementalPage |
| Settings | `Settings` | SettingsPage → ProfilePage, WorkflowBuilder |

### Additional screens (modals or stack)
- PhotoGallery, SketchGallery, PhotoLab — accessible from Settings or Home
- DocumentsHub — accessible from Home
- SupervisorDashboard — supervisor role only, from Home

---

## 6. Auth Flow

### Login
1. User enters email + password on LoginPage
2. App calls `POST /api/auth/login` → receives JWT token
3. Token stored in `expo-secure-store`
4. All subsequent API calls include `Authorization: Bearer <token>`

### Registration
1. User fills registration form
2. App calls `POST /api/auth/register` → receives JWT token
3. Same token storage as login

### Supabase Integration
1. On app launch, call `GET /api/config` → get `supabaseUrl` + `supabaseAnonKey`
2. Initialize Supabase client with `AsyncStorage` adapter
3. If using Supabase Auth, call `POST /api/auth/sync` to sync user to local DB

### Token Refresh
- Check token validity on app foreground
- If expired, redirect to login

---

## 7. Screen-by-Screen Specification

### 7.1 LoginPage

**Layout:** Gradient background (#342A4F → #7763B7), centered card

**Tabs:** "Sign In" / "Register"

**Sign In fields:**
- Email/username input
- Password input
- "Remember me" checkbox (stores token persistently)
- "Sign In" button

**Register fields:**
- Full Name, Username, Email, Password
- "Create Account" button

**API:** `POST /api/auth/login`, `POST /api/auth/register`

---

### 7.2 ClaimsList (Home)

**Layout:** `FlatList` with pull-to-refresh

**Header:** "My Claims" title + "New Claim" button

**Filter tabs:** All / Pending / In Progress / Complete

**Each claim card:**
- Claim number, insured name, status badge (color-coded), date
- Tap → navigate based on status

**API:** `GET /api/claims` or `GET /api/claims/my-claims`

---

### 7.3 DocumentUpload

**Layout:** `ScrollView` with 3 document cards

**3 cards:** FNOL Report, Policy Form, Endorsements

**Each card states:** empty → uploading (progress) → processing (AI pulse) → complete (green check) → error

**Upload flow:**
1. Tap card → `expo-document-picker` for PDF
2. Read file as base64: `FileSystem.readAsStringAsync(uri, { encoding: 'base64' })`
3. `POST /api/claims/:id/documents/upload` with base64 body
4. `POST /api/claims/:id/documents/:type/parse` to trigger AI

**Bottom button:** "Review Extraction" → navigates to ExtractionReview

---

### 7.4 ExtractionReview

**Layout:** Tab view (3 tabs: FNOL / Policy / Endorsements)

**Each tab:** Scrollable form with editable fields, confidence score badges, confirm button

**Actions:**
- Edit fields → `PUT /api/claims/:id/extractions/:type`
- Confirm → `POST /api/claims/:id/extractions/:type/confirm`
- "Confirm & Generate Briefing" → `POST /api/claims/:id/briefing/generate` → navigate to Briefing

---

### 7.5 InspectionBriefing

**Layout:** `ScrollView` with collapsible sections

**Header card:** Claim number, peril, address, "Start Inspection" button

**9 collapsible sections:**
1. Loss Description
2. Weather Correlation
3. Property Profile
4. Coverage Snapshot
5. Peril Analysis
6. Critical Endorsements
7. Inspection Plan
8. Red Flags
9. Duties After Loss

**API:** `GET /api/claims/:id/briefing`

---

### 7.6 ActiveInspection (MOST COMPLEX)

**Layout:** Single-screen with bottom sheets

```
┌──────────────────────────┐
│  Header (claim, timer)   │
├──────────────────────────┤
│  Quick Stats Strip       │  ← Estimate, Scope, Photos, Phase pills
├──────────────────────────┤
│  Compact Transcript      │  ← Last message, tap to expand
├──────────────────────────┤
│  Property Sketch         │  ← SVG floor plan (react-native-svg)
├──────────────────────────┤
│  Progress Strip          │  ← Phase, rooms, damages, "View All"
├──────────────────────────┤
│  🎤  📷  ⏭              │  ← Mic, Camera, Skip buttons
├──────────────────────────┤
│  Bottom Tabs             │
└──────────────────────────┘
```

**Bottom sheets** (via `@gorhom/bottom-sheet`):
- **Left drawer:** Phase list + room list (swipe from left or hamburger)
- **Right drawer:** Estimate + scope items + photos (swipe from right or chart icon)
- **Sketch expanded:** Full-screen SVG with edit tools
- **Progress tracker:** Completeness score, checklist, room status
- **Camera:** Full-screen camera with capture
- **Room editor:** Edit room dimensions
- **Add room:** Create new room form

**Voice connection:**
1. `POST /api/realtime/session` → get `clientSecret`
2. `react-native-webrtc` `RTCPeerConnection` + data channel
3. Same tool call protocol as web

**State variables (key ones):**
`sessionId`, `voiceState`, `isConnected`, `currentPhase`, `currentStructure`, `currentArea`, `currentRoomId`, `rooms`, `transcript`, `recentLineItems`, `estimateSummary`, `recentPhotos`, `cameraMode`, `sketchExpanded`, `elapsed`

**API calls:** ~30 endpoints during inspection (rooms, openings, damages, line items, photos, moisture, etc.)

---

### 7.7 ScopePage

**Layout:** `SectionList` grouped by room

**Each room section:**
- Room name header with item count + subtotal
- Measurements row (SF walls/floor, LF perimeter)
- Line item rows: description, qty, unit, price, RCV, depreciation, ACV
- Edit mode: inline quantity/price inputs

**Footer:** "Resume Inspection" + "Go to Review" buttons

**API:** `GET /api/inspection/:sessionId/estimate-by-room`

---

### 7.8 ReviewFinalize

**Layout:** Tab view (7 tabs)

| Tab | Content |
|-----|---------|
| Scope | Xactimate-style estimate table |
| Photos | Photo grid by room, filter bar, lightbox viewer |
| Completeness | Score ring, checklist, scope gaps, missing photos |
| Notes | Textarea + transcript viewer |
| Sketch | PropertySketch + estimate |
| Weather | Weather correlation component |
| Reports | 4 export buttons (PDF, ESX, Photo PDF, Photo DOCX) |

**API:** Multiple endpoints for each tab

---

### 7.9 ExportPage

**Layout:** `ScrollView` with validation + export cards

**Validation section:** Blockers (red), warnings (amber)

**4 export cards:**
1. ESX for Xactimate → download via `FileSystem.downloadAsync` + `Sharing.shareAsync`
2. PDF Report → same download flow
3. Photo Report (PDF + DOCX)
4. Submit for Review → `PATCH /api/inspection/:sessionId/status`

---

### 7.10 SettingsPage

**Layout:** `ScrollView` with 11 setting sections

**Key settings:**
- Voice: model select, speed slider, verbosity, push-to-talk toggle
- Inspection: price list region, O&P/tax/waste rates, measurement units
- Photo: quality, auto-analyze, timestamp, GPS
- Export: company name, license #, format preference
- Notifications: push, sound, alerts, reminders
- Display: theme (via `Appearance`), font size, compact mode

**Storage:** All settings in `AsyncStorage` via `useSettings()` hook

---

### 7.11 ProfilePage

**Layout:** Avatar card + form

**Fields:** Full Name, Job Title (editable), Email, Role (read-only)

**Avatar:** `expo-image-picker` → base64 → `POST /api/profile/avatar`

---

### 7.12-7.17 Other Screens

| Screen | Key RN Considerations |
|--------|----------------------|
| **DocumentsHub** | `FlatList` + `react-native-pdf` for viewing |
| **PhotoGallery** | `FlatList` with `expo-image`, lightbox modal |
| **SketchGallery** | `react-native-svg` rendering per claim |
| **PhotoLab** | `expo-image-picker` (multi), `expo-camera`, AI analysis cards |
| **WorkflowBuilder** | Step list with drag-reorder (`react-native-draggable-flatlist`) |
| **SupervisorDashboard** | `victory-native` charts, `FlatList` for sessions |
| **SupplementalPage** | Simple form + list |

---

## 8. Voice Inspection (WebRTC)

### Connection Flow

```
1. POST /api/realtime/session
   Body: { claimId, sessionId? }
   Response: { client_secret: { value: "..." }, ... }

2. Create RTCPeerConnection (react-native-webrtc)

3. Get microphone audio:
   mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })

4. Add audio track to peer connection

5. Create data channel "oai-events"

6. Create offer, set local description

7. POST to OpenAI Realtime API with offer SDP
   URL: https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview
   Headers: Authorization: Bearer {client_secret}
   Body: offer SDP

8. Set remote description from response

9. Data channel opens → send greeting/resume message
```

### Tool Call Protocol

```
Agent sends (via data channel):
{
  type: "response.function_call_arguments.done",
  name: "create_room",
  arguments: "{\"name\":\"Kitchen\",\"structure\":\"Main Dwelling\",...}",
  call_id: "call_abc123"
}

Client handles tool call:
1. Parse arguments JSON
2. Execute via fetch() to API
3. Send result back:
{
  type: "conversation.item.create",
  item: {
    type: "function_call_output",
    call_id: "call_abc123",
    output: "{\"success\":true,\"roomId\":42,...}"
  }
}
4. Send: { type: "response.create" }
```

### 53 Voice Tools

The complete tool list (all handled in `executeToolCall()`):

**Context:** `set_inspection_context`, `get_inspection_state`, `get_room_details`, `get_progress`, `get_estimate_summary`, `get_completeness`, `get_scope_gaps`, `request_phase_validation`, `get_workflow_state`, `set_phase`, `set_context`

**Structure/Room:** `create_structure`, `create_room`, `create_sub_area`, `list_rooms`, `find_room`, `rename_room`, `complete_room`, `update_room_dimensions`, `set_room_adjacency`

**Openings:** `add_opening`, `update_opening`, `delete_opening`

**Annotations:** `add_sketch_annotation`

**Damage:** `add_damage`, `update_damage`, `delete_damage`, `confirm_damage_suggestion`

**Scope:** `add_line_item`, `update_line_item`, `remove_line_item`, `get_room_scope`, `generate_scope`, `validate_scope`, `apply_peril_template`, `apply_smart_macro`, `check_related_items`

**Photos:** `trigger_photo_capture`, `list_photos`, `delete_photo`

**Water:** `add_water_classification`, `log_moisture_reading`, `update_moisture_reading`, `delete_moisture_reading`

**Test squares:** `log_test_square`, `update_test_square`, `delete_test_square`

**Flow:** `skip_step`, `complete_inspection`

---

## 9. Property Sketch (SVG)

The sketch renders using SVG. In React Native, use `react-native-svg`.

### Element Mapping

| Web SVG | react-native-svg |
|---------|-----------------|
| `<svg>` | `<Svg>` |
| `<rect>` | `<Rect>` |
| `<polygon>` | `<Polygon>` |
| `<text>` | `<SvgText>` (import as `Text` from `react-native-svg`) |
| `<line>` | `<Line>` |
| `<circle>` | `<Circle>` |
| `<path>` | `<Path>` |
| `<g>` | `<G>` |
| `<defs>` | `<Defs>` |
| `<pattern>` | `<Pattern>` |

### Four Sketch Sections

1. **Interior:** BFS-positioned rooms with dimension lines, opening symbols, damage badges
2. **Roof Plan:** Geometric facet polygons (hip/gable), ridge/hip lines, pitch labels
3. **Elevations:** Wall rectangles with door/window symbols, roof profile
4. **Other Exterior:** Card-style for gutters, porches, decks

### Layout Algorithm

Copy `sketchLayout.ts` as-is. The BFS algorithm is pure math:
1. Build adjacency map
2. Place first room at (0,0)
3. BFS: position neighbors based on wall direction (north→above, east→right, etc.)
4. Collision detection via bounding boxes
5. Fallback grid for unplaced rooms

### Interactive Editor

Replace pointer events with gesture handlers:

| Web | React Native |
|-----|-------------|
| `onPointerDown` | `PanGestureHandler` `onGestureEvent` |
| `getBoundingClientRect()` | `onLayout` + `measureInWindow` |
| `setPointerCapture` | Gesture handler handles this natively |
| `SVGSVGElement.getScreenCTM()` | Calculate manually from viewBox + layout |

---

## 10. Camera & Photo System

### Photo Capture

```typescript
import { CameraView, useCameraPermissions } from 'expo-camera';

// In component:
const cameraRef = useRef<CameraView>(null);

// Capture:
const photo = await cameraRef.current?.takePictureAsync({
  base64: true,
  quality: 0.8,
  exif: true, // GPS data
});

// Upload:
await fetch(`${API_URL}/api/inspection/${sessionId}/photos`, {
  method: 'POST',
  headers: { ...authHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    base64: photo.base64,
    photoType: 'damage_detail',
    label: 'Water damage ceiling - Living Room',
  }),
});
```

### Photo Quality Settings

| Setting | Camera Config |
|---------|--------------|
| High | `width: 3840, height: 2160` |
| Standard | `width: 1920, height: 1080` |
| Low | `width: 1280, height: 720` |

### Test Square Grid Overlay

When `photoType === "test_square"`, render an SVG grid overlay on top of the camera view:
- Centered rectangle (50% width/height)
- 3x3 grid lines inside
- Gold/accent color

---

## 11. Offline Support

### Queue System

Replace IndexedDB-based `offlineQueue.ts` with AsyncStorage:

```typescript
// Key: "claimsiq_offline_queue"
// Value: JSON array of pending mutations
interface QueuedMutation {
  id: string;
  method: string;
  url: string;
  body: any;
  headers: Record<string, string>;
  createdAt: string;
  retryCount: number;
}
```

### Network Detection

```typescript
import NetInfo from '@react-native-community/netinfo';

NetInfo.addEventListener(state => {
  if (state.isConnected) {
    drainOfflineQueue(); // Process pending mutations
  }
});
```

### Resilient Mutations

Same pattern as web: if offline, queue the mutation and return `{ queued: true }`. Drain queue when back online.

---

## 12. API Endpoint Reference

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login with email/password |
| POST | `/api/auth/register` | Register new account |
| POST | `/api/auth/sync` | Sync Supabase user |
| GET | `/api/auth/me` | Get current user |
| GET | `/api/config` | Get Supabase URL + anon key |

### Claims
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/claims` | List all claims |
| GET | `/api/claims/my-claims` | List user's claims |
| POST | `/api/claims` | Create claim |
| GET | `/api/claims/:id` | Get claim detail |
| PATCH | `/api/claims/:id` | Update claim |
| DELETE | `/api/claims/:id` | Delete claim |
| POST | `/api/claims/:id/documents/upload` | Upload document (base64) |
| POST | `/api/claims/:id/documents/:type/parse` | Parse document with AI |
| GET | `/api/claims/:id/extractions` | Get extractions |
| POST | `/api/claims/:id/briefing/generate` | Generate briefing |
| GET | `/api/claims/:id/briefing` | Get briefing |
| POST | `/api/claims/:id/inspection/start` | Start/resume inspection |

### Inspection (150+ endpoints)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/inspection/:sid` | Get session with rooms/items/photos |
| PATCH | `/api/inspection/:sid` | Update session |
| GET | `/api/inspection/:sid/hierarchy` | Full room/structure tree |
| POST | `/api/inspection/:sid/structures` | Create structure |
| POST | `/api/inspection/:sid/rooms` | Create room |
| GET | `/api/inspection/:sid/rooms` | List rooms (with computed damage counts) |
| POST | `/api/inspection/:sid/rooms/:rid/openings` | Add opening |
| POST | `/api/inspection/:sid/damages` | Record damage (triggers auto-scope) |
| POST | `/api/inspection/:sid/line-items` | Add line item |
| GET | `/api/inspection/:sid/estimate-summary` | Estimate totals |
| GET | `/api/inspection/:sid/estimate-by-room` | Room-grouped estimate |
| POST | `/api/inspection/:sid/photos` | Upload photo (base64) |
| POST | `/api/inspection/:sid/photos/:pid/analyze` | AI photo analysis |
| POST | `/api/inspection/:sid/moisture` | Log moisture reading |
| GET | `/api/inspection/:sid/completeness` | Completeness score + checklist |
| POST | `/api/inspection/:sid/export/esx` | Export ESX file |
| POST | `/api/inspection/:sid/export/pdf` | Export PDF report |

### Voice
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/realtime/session` | Create OpenAI Realtime session |

### Settings & Profile
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Get user settings |
| PUT | `/api/settings` | Update settings |
| PATCH | `/api/profile` | Update profile |
| POST | `/api/profile/avatar` | Upload avatar |

### Gallery & PhotoLab
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/gallery/photos` | All photos by claim |
| GET | `/api/gallery/sketches` | All sketches by claim |
| POST | `/api/photolab/upload` | Upload standalone photo |

---

## 13. Data Models

### Key TypeScript Types (from `shared/schema.ts`)

```typescript
interface Claim {
  id: number;
  claimNumber: string;
  insuredName: string | null;
  propertyAddress: string | null;
  perilType: string | null;
  status: string;
  // ... more fields
}

interface InspectionSession {
  id: number;
  claimId: number;
  currentPhase: number;
  currentStructure: string | null;
  currentArea: string | null;
  status: string;
}

interface InspectionRoom {
  id: number;
  sessionId: number;
  name: string;
  roomType: string | null;
  structure: string | null;
  viewType: string; // "interior" | "roof_plan" | "elevation" | "exterior_other"
  shapeType: string;
  dimensions: { length?: number; width?: number; height?: number } | null;
  polygon: any | null;
  status: string;
  damageCount: number;
  photoCount: number;
}

interface RoomOpening {
  id: number;
  roomId: number;
  openingType: string; // "door" | "window" | "sliding_door" | ...
  wallDirection: string | null; // "north" | "south" | "east" | "west" | ...
  widthFt: number | null;
  heightFt: number | null;
  quantity: number;
  opensInto: string | null;
}

interface DamageObservation {
  id: number;
  sessionId: number;
  roomId: number;
  description: string;
  damageType: string | null;
  severity: string | null;
  location: string | null;
}

interface LineItem {
  id: number;
  sessionId: number;
  roomId: number | null;
  category: string;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
  provenance: string; // "voice" | "auto_scope" | "companion" | "manual"
}
```

---

## 14. Phased Build Plan

### Phase 1: Foundation (2-3 weeks)
- Expo project setup + navigation structure
- API client with auth headers + SecureStore token storage
- React Query provider
- Auth context + LoginPage
- ClaimsList + claim cards
- SettingsPage + ProfilePage
- Bottom tab navigator

### Phase 2: Documents (3-4 weeks)
- DocumentUpload (expo-document-picker + base64)
- ExtractionReview (tab view + editable forms)
- InspectionBriefing (collapsible sections)
- DocumentsHub (PDF viewing)

### Phase 3: Active Inspection + Voice (6-8 weeks) — CRITICAL PATH
- Voice WebRTC connection (react-native-webrtc)
- Tool call executor (extract from ActiveInspection.tsx)
- Property sketch rendering (react-native-svg)
- Interactive sketch editor (gesture handler)
- Camera overlay (expo-camera)
- Transcript UI (FlatList)
- Bottom sheets (estimate, room list, progress)
- Room/opening/damage creation flow

### Phase 4: Export + Polish (3-4 weeks)
- ScopePage (SectionList with edit)
- ReviewFinalize (7-tab view)
- ExportPage (file download + sharing)
- PhotoGallery + SketchGallery
- SupervisorDashboard (charts)
- SupplementalPage
- PhotoLab
- Offline queue
- Push notifications
- Performance optimization

### Total: 14-19 weeks

Phase 3 is the critical path. Voice WebRTC and interactive SVG sketch are the two hardest pieces.

---

## Key Gotchas for the RN Developer

1. **`react-native-webrtc` requires bare workflow or config plugin** — Expo managed workflow needs a custom dev client build
2. **SVG text** — import `Text` from `react-native-svg` as `SvgText` to avoid conflict with RN's `Text`
3. **Gesture handler** — all touch interactions in the sketch editor must use `react-native-gesture-handler`, not RN's built-in touch system
4. **Audio playback** — the agent's voice comes through the WebRTC audio track; RN handles this via the peer connection's `ontrack` event
5. **Base64 photos** — `expo-camera` returns base64 directly; no canvas conversion needed
6. **Token storage** — use `expo-secure-store` for auth tokens (encrypted), `AsyncStorage` for settings (not encrypted)
7. **Deep linking** — configure expo-router for `/inspection/:id` deep links so push notifications can navigate directly
8. **Background voice** — when the app backgrounds during inspection, the WebRTC connection may drop; implement reconnection logic
9. **Sketch performance** — for inspections with 20+ rooms, the SVG render can be slow; consider `react-native-skia` for the sketch editor
10. **Wall direction mapping** — north=top, south=bottom, east=right, west=left; front→south, rear→north in the layout algorithm
