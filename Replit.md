# Claims IQ Voice Inspector

## Overview
Claims IQ Voice Inspector is a full-stack insurance property inspection application that combines voice AI (OpenAI Realtime API) with iPad-based photo capture and AI analysis. Field adjusters use voice commands to document damage, take photos, and build Xactimate-compatible estimates in real time.

## Architecture

### Frontend (React + Vite)
- **Framework:** React 19 with TypeScript
- **Routing:** wouter (lightweight, no SSR)
- **State:** React Query (TanStack Query) + local state
- **UI:** Tailwind CSS v4 + shadcn/ui components + Framer Motion animations
- **Icons:** Lucide React
- **Voice:** WebRTC peer connection to OpenAI Realtime API via data channel
- **Camera:** getUserMedia with canvas capture → base64 JPEG
- **PWA:** vite-plugin-pwa with Workbox service worker (installable, offline-capable)

### Backend (Express + Node.js)
- **Framework:** Express.js with TypeScript
- **Database:** PostgreSQL via Drizzle ORM
- **Storage:** Supabase Storage (documents bucket + photos bucket)
- **AI Services:**
  - OpenAI GPT-4o for document extraction and briefing generation
  - OpenAI Realtime API (gpt-4o-realtime-preview) for voice inspection
  - OpenAI GPT-4o Vision for photo analysis

### Database Schema (Drizzle ORM → PostgreSQL)
- `users` — authentication
- `claims` — insurance claim records
- `documents` — uploaded PDF documents (FNOL, policy, endorsements)
- `extractions` — AI-extracted data from documents
- `briefings` — generated pre-inspection briefings
- `inspectionSessions` — active inspection sessions
- `inspectionRooms` — rooms/areas within an inspection
- `damageObservations` — damage records per room
- `lineItems` — Xactimate-compatible estimate line items
- `inspectionPhotos` — captured photos with AI analysis (has `analysis` jsonb and `matchesRequest` boolean columns)
- `moistureReadings` — moisture meter readings
- `voiceTranscripts` — voice session transcripts

## PWA (Progressive Web App)

The application is a fully installable PWA with offline capabilities.

### Configuration
- **Plugin:** `vite-plugin-pwa` in `vite.config.ts` — auto-generates manifest, service worker, and registration script
- **Register type:** `autoUpdate` — service worker updates silently in the background
- **Manifest:** Auto-generated at build time as `manifest.webmanifest` with app name, theme colors, and icons

### Icons
| File | Purpose |
|---|---|
| `client/public/pwa-icon.svg` | Main app icon (any purpose) — deep purple background with gold mic |
| `client/public/pwa-icon-maskable.svg` | Maskable icon for adaptive rendering on Android |
| `client/public/favicon.png` | 48×48 PNG fallback |

### Service Worker (Workbox)
- **Precaching:** All built assets (JS, CSS, HTML, SVG, PNG, JPG, WOFF2)
- **Runtime caching:**
  - Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) → **CacheFirst** (1 year TTL)
  - API routes (`/api/*`) → **NetworkFirst** (5 min TTL, 50 max entries)

### HTML Meta Tags (`client/index.html`)
- `theme-color: #342A4F` (deep purple)
- `apple-mobile-web-app-capable: yes`
- `apple-mobile-web-app-status-bar-style: black-translucent`
- `viewport-fit=cover` for iOS safe area support

## Persistent Bottom Navigation

A fixed bottom tab bar (`BottomNav.tsx`) renders at the App level in `App.tsx`, persisting across all pages.

### Navigation Items
| Tab | Icon | Highlights When |
|---|---|---|
| Home | `Home` | Path is exactly `/` |
| Documents | `FileText` | Path starts with `/upload` or `/review` |
| **Inspect** | `Mic` (prominent raised button) | Path starts with `/briefing` or `/inspection` |
| Reports | `ClipboardCheck` | Path contains `/inspection/` or `/export` |
| Settings | `Settings` | Path starts with `/settings` |

### Layout Integration
- **Height:** `h-16` (4rem) + iOS safe area inset
- **Z-index:** `z-50` (same level as header)
- **Pages using `Layout.tsx`** (ClaimsList, DocumentUpload, ExtractionReview, InspectionBriefing): Main content has `pb-24` to clear the nav
- **Self-layout pages** (ActiveInspection): Uses `h-[calc(100vh-4rem)]` instead of `h-screen`
- **Self-layout pages** (ReviewFinalize, ExportPage): Root container has `pb-20`

### Active State
- Active tabs show purple icon + purple text + purple underline indicator
- The center "Inspect" tab has a raised circular button (deep purple when inactive, primary purple when active)

## Key Features (PROMPT-05)

### Camera Workflow (Fixed)
The photo capture workflow uses a **deferred tool response** pattern:
1. Voice agent calls `trigger_photo_capture` → camera overlay opens
2. Agent **stops talking and waits** (no tool result sent yet)
3. User taps shutter → photo saved to Supabase → sent to GPT-4o Vision for analysis
4. Analysis result sent back as the deferred tool response
5. Agent resumes, acknowledges what it sees, flags mismatches

Key ref: `pendingPhotoCallRef` in `ActiveInspection.tsx` stores the pending `call_id` until capture completes.

### Photo AI Analysis
- **Endpoint:** `POST /api/inspection/:sessionId/photos/:photoId/analyze`
- Sends base64 image to GPT-4o Vision
- Returns: description, damage detected, match confidence, quality score
- Graceful fallback if Vision API fails (never blocks workflow)

### Live Floor Plan Sketch
- **Component:** `client/src/components/FloorPlanSketch.tsx`
- SVG-based floor plan that builds in real-time as rooms are created
- Room rectangles proportional to real-world dimensions
- Color-coded: gray=not started, purple=in progress, green=complete, gold border=current
- Red damage count badges
- Clickable rooms to navigate

### VAD Threshold Tuning
- `turn_detection` config in Realtime session creation
- `threshold: 0.75` (up from default 0.5) — ignores wind/traffic/construction noise
- `silence_duration_ms: 800` — doesn't cut off adjusters mid-sentence
- `prefix_padding_ms: 400` — avoids clipping first syllable

### Mandatory Front-of-House Photo
- Every inspection starts with property verification photo before Phase 1
- Agent's first action: request front-of-property photo
- GPT-4o Vision validates photo against claim address/property type
- Prevents "wrong property" errors

## Application Flow (3 Acts)

### Act 1: Claim Setup
1. Create claim with claim number
2. Upload 3 PDFs: FNOL, Policy Declaration, Endorsements
3. Parse each document → AI extracts structured data
4. Review/edit extractions → confirm
5. Generate pre-inspection briefing

### Act 2: Voice Inspection
1. Start inspection session from briefing page
2. Connect voice (WebRTC → OpenAI Realtime)
3. **Property verification photo** (mandatory first step)
4. Voice-guided 8-phase inspection:
   - Phase 1: Pre-Inspection review
   - Phase 2: Session Setup
   - Phase 3: Exterior (roof, siding, elevations)
   - Phase 4: Interior (room by room)
   - Phase 5: Moisture (water claims)
   - Phase 6: Evidence Review
   - Phase 7: Estimate Assembly
   - Phase 8: Finalize
5. AI tools: create rooms, add damage, add line items, capture/analyze photos, log moisture readings
6. Live floor plan sketch builds in real-time
7. Right panel shows running estimate, line items, photo gallery with AI analysis

### Act 3: Review & Export
1. Review inspection completeness
2. Grouped estimate view
3. Export to ESX (Xactimate XML format)
4. PDF export data endpoint

## Development

### Running Locally
```bash
npm install
npm run dev
```

### Database Migration
After schema changes:
```bash
npx drizzle-kit push
```

### Environment Variables
- `DATABASE_URL` — PostgreSQL connection string
- `OPENAI_API_KEY` — OpenAI API key (for extraction, realtime, vision)
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anonymous key

### Key Files
| File | Purpose |
|---|---|
| `shared/schema.ts` | Database schema (Drizzle ORM) |
| `server/routes.ts` | All API endpoints |
| `server/storage.ts` | Database access layer |
| `server/realtime.ts` | Voice AI system instructions + tool definitions |
| `server/openai.ts` | Document extraction AI |
| `client/src/App.tsx` | Root component with router + BottomNav |
| `client/src/components/Layout.tsx` | Shared page layout (header + content area) |
| `client/src/components/BottomNav.tsx` | Persistent bottom tab bar (5 tabs, route-aware) |
| `client/src/pages/ActiveInspection.tsx` | Voice inspection UI (main page, self-layout) |
| `client/src/components/FloorPlanSketch.tsx` | Live SVG floor plan |
| `client/src/components/VoiceIndicator.tsx` | Voice state indicator |
| `client/src/components/ProgressMap.tsx` | Inspection progress overlay |
| `client/public/pwa-icon.svg` | PWA app icon (any purpose) |
| `client/public/pwa-icon-maskable.svg` | PWA maskable icon (adaptive) |
| `vite.config.ts` | Vite build config + PWA plugin setup |
| `client/index.html` | Entry HTML with PWA meta tags |
