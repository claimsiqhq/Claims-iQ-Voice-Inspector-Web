# Claims IQ Voice Inspector

## Overview
Claims IQ Voice Inspector is a voice-driven field inspection assistant designed for insurance adjusters. Its primary purpose is to streamline the insurance claims process by providing AI-powered tools for document analysis, inspection guidance, and report generation. The project aims to reduce manual effort, improve accuracy, and accelerate claim processing for insurance companies and adjusters.

Key capabilities include:
- Document upload and AI parsing (FNOL/Claim Reports, Policy Forms, Endorsements with batch support)
- AI confidence scoring on extracted data
- Extraction review and confirmation
- Inspection briefing generation
- Voice-guided active inspections using OpenAI Realtime API with WebRTC
- Multi-structure inspections (Main Dwelling, Detached Garage, etc.) with exterior elevation and roof slope documentation
- Photo capture with GPT-4o Vision analysis and damage annotation
- Moisture reading logging with IICRC classification
- Comprehensive review-and-finalize workflow
- Export options (ESX/Xactimate, PDF, Submit for Review)

## User Preferences
- Professional insurance app styling
- Clean, minimal aesthetic
- Database must be Supabase only — never use local Replit PostgreSQL
- Never use execute_sql_tool for Supabase operations
- All schema changes via psql with SUPABASE_DATABASE_URL
- Use user's own `OPENAI_API_KEY` — not Replit AI Integrations key
- pdf-parse must stay at v1.1.1 (v2 has incompatible API)

## System Architecture

### Tech Stack
- **Frontend:** React 19, Vite 7, TypeScript, Tailwind CSS v4, shadcn/ui, wouter, TanStack React Query, Framer Motion
- **Backend:** Express 5, pdf-parse v1.1.1, @supabase/supabase-js, OpenAI SDK v6
- **Database:** Drizzle ORM with Supabase PostgreSQL (postgres.js driver, `SUPABASE_DATABASE_URL`)
- **File Storage:** Supabase Storage (buckets: `claim-documents` for PDFs, `inspection-photos` for images)
- **AI:** OpenAI GPT-4o for document parsing, briefing generation, and photo analysis; OpenAI Realtime API (`gpt-4o-realtime-preview`) for voice inspection via WebRTC
- **Voice:** Browser WebRTC PeerConnection + DataChannel for OpenAI Realtime API integration
- **PWA:** Vite PWA plugin with Workbox for offline caching of fonts and API responses

### Project Structure
```
├── client/
│   ├── src/
│   │   ├── App.tsx                    # Router with wouter (7 routes + 404)
│   │   ├── main.tsx                   # Entry point
│   │   ├── index.css                  # Tailwind v4 + custom design tokens
│   │   ├── pages/
│   │   │   ├── ClaimsList.tsx         # Screen 1: Claims list + create
│   │   │   ├── DocumentUpload.tsx     # Screen 2: Upload FNOL/Policy/Endorsements
│   │   │   ├── ExtractionReview.tsx   # Screen 3: Review parsed data with confidence scores
│   │   │   ├── InspectionBriefing.tsx # Screen 4: AI-generated briefing
│   │   │   ├── ActiveInspection.tsx   # Screen 5: Three-panel voice inspection
│   │   │   ├── ReviewFinalize.tsx     # Screen 6: Estimate/Photos/Completeness/Notes tabs
│   │   │   ├── ExportPage.tsx         # Screen 7: ESX/PDF/Submit export
│   │   │   └── not-found.tsx          # 404 page
│   │   ├── components/
│   │   │   ├── Layout.tsx             # App shell with header
│   │   │   ├── BottomNav.tsx          # Mobile bottom navigation (context-aware routing)
│   │   │   ├── ClaimCard.tsx          # Claim summary card with status routing
│   │   │   ├── StatusBadge.tsx        # Status + peril type badges
│   │   │   ├── FloorPlanSketch.tsx    # SVG floor plan grouped by structure
│   │   │   ├── PhotoGallery.tsx       # Photo grid/list with filters + full-screen viewer
│   │   │   ├── VoiceIndicator.tsx     # Voice state visual indicator
│   │   │   ├── ProgressMap.tsx        # Slide-over inspection progress overview
│   │   │   ├── MoistureMap.tsx        # SVG moisture reading visualization + IICRC
│   │   │   └── ui/                    # shadcn/ui components
│   │   ├── hooks/
│   │   │   ├── use-mobile.tsx         # useIsMobile hook for responsive layouts
│   │   │   └── use-toast.ts           # Toast notification hook
│   │   └── lib/
│   │       ├── queryClient.ts         # TanStack Query client config
│   │       └── utils.ts              # cn() utility
│   ├── index.html                     # HTML entry with OG/Twitter meta tags
│   └── public/                        # PWA icons and manifest assets
├── server/
│   ├── index.ts                       # Express app bootstrap
│   ├── routes.ts                      # All API route handlers (~40 endpoints)
│   ├── storage.ts                     # IStorage interface + Drizzle implementation
│   ├── db.ts                          # Drizzle ORM + postgres.js connection
│   ├── supabase.ts                    # Supabase client + storage bucket setup
│   ├── openai.ts                      # GPT-4o extraction/briefing/analysis functions
│   ├── realtime.ts                    # Realtime API system prompt + voice tools
│   ├── vite.ts                        # Vite dev middleware for Express
│   ├── static.ts                      # Production static file serving
│   └── replit_integrations/           # Auto-generated Replit AI integration (unused)
├── shared/
│   └── schema.ts                      # Drizzle schema + Zod insert schemas + types
├── drizzle.config.ts                  # Drizzle Kit config
├── vite.config.ts                     # Vite config with React, Tailwind, PWA plugins
├── package.json                       # Dependencies and scripts
└── replit.md                          # This file
```

### Frontend Routes
| Path | Page | Description |
|------|------|-------------|
| `/` | ClaimsList | List all claims, create new claim |
| `/upload/:id` | DocumentUpload | Upload FNOL, Policy, Endorsement PDFs |
| `/review/:id` | ExtractionReview | Review AI-extracted data with confidence scores |
| `/briefing/:id` | InspectionBriefing | View AI-generated inspection briefing |
| `/inspection/:id` | ActiveInspection | Live voice-guided inspection (3-panel layout) |
| `/inspection/:id/review` | ReviewFinalize | Estimate, Photos, Completeness, Notes tabs |
| `/inspection/:id/export` | ExportPage | ESX, PDF, Submit for Review |

### Core Features

#### 1. Claims Management
- Create claims with claim number, insured name, property address, date of loss, peril type
- Status progression: draft → documents_uploaded → extractions_confirmed → briefing_ready → inspecting → review → exported
- ClaimCard routes to next logical screen based on status

#### 2. Document Processing
- Upload FNOL, Policy, and Endorsement PDFs to Supabase Storage
- Endorsements support batch multi-file upload (pipe-separated storage paths, combined text with "--- NEXT DOCUMENT ---" separators)
- AI parsing via GPT-4o extracts structured data from PDF text
- Parse route only splits storagePath on "|" for endorsements specifically

#### 3. AI Confidence Scoring
- Each extracted data point has a confidence level (high/medium/low)
- `ConfidenceScore` component (inline in ExtractionReview.tsx): color-coded shield icon (green/amber/red), animated progress bar, percentage
- `OverallConfidenceSummary` component (inline in ExtractionReview.tsx): aggregates field-level scores per document tab header
- Keyboard-accessible tooltips explain each confidence level on hover

#### 4. Inspection Briefing
- AI-generated briefings based on all parsed documents
- Sections: Property Profile, Coverage Snapshot, Peril Analysis, Endorsement Impacts, Inspection Checklist, Duties After Loss, Red Flags

#### 5. Active Voice Inspection
- Three-panel layout: left (floor plan + room list), center (voice + transcript), right (photo gallery)
- Sidebars convert to slide-out Sheet drawers on mobile (useIsMobile hook)
- Voice connection via WebRTC PeerConnection + DataChannel to OpenAI Realtime API
- VoiceIndicator shows listening/speaking/processing/error/disconnected states
- FloorPlanSketch groups rooms by structure (Main Dwelling, Detached Garage, etc.) with Interior/Exterior sections
- PhotoGallery: grid/list toggle, photo type filters, full-screen viewer with prev/next navigation, AI analysis annotations (description, damage tags, quality stars, match/mismatch indicators)
- Photo upload: filename sanitization (strips em dashes, non-ASCII), upload failure guard prevents analysis with undefined photoId

#### 6. Voice AI Tools (defined in server/realtime.ts)
| Tool | Purpose |
|------|---------|
| `set_inspection_context` | Sets current structure, area, phase |
| `create_room` | Creates room/area with dimensions and roomType enum |
| `complete_room` | Marks room complete, moves to next |
| `add_damage` | Records damage observation |
| `add_line_item` | Adds Xactimate-compatible estimate line item |
| `trigger_photo_capture` | Activates camera for photo capture + GPT-4o Vision analysis |
| `log_moisture_reading` | Records moisture meter reading |
| `get_progress` | Returns inspection progress summary |
| `get_estimate_summary` | Returns running RCV/ACV/depreciation totals |
| `complete_inspection` | Finalizes inspection for review |

#### 7. Multi-Structure Exterior Inspections
- Voice AI prompt walks through each structure's roof slopes, four elevations (front/left/right/rear), gutters, and other areas
- `create_room` tool roomType enums include: `exterior_roof_slope`, `exterior_elevation_front`, `exterior_elevation_left`, `exterior_elevation_right`, `exterior_elevation_rear`, `exterior_gutter`, `exterior_garage_door`, `exterior_porch`, `exterior_deck`, `exterior_fence`
- FloorPlanSketch shows exterior room type icons (triangles for roof slopes, square variants for elevations)
- Completeness check verifies elevation and roof slope documentation for hail+wind claims
- Aligned with real Xactimate estimate patterns (facet labels F1/F2, structure splits Dwelling/Other Structures, coverage allocation)

#### 8. Review & Finalize (Screen 6)
Four tabs:
- **Estimate:** Collapsible room → damage → line item hierarchy with inline editing
- **Photos:** Gallery grouped by room with filters
- **Completeness:** Circular progress score with AI scope gap detection
- **Notes:** Adjuster notes editor + voice transcript viewer

Additional components:
- `ProgressMap`: Slide-over panel for navigation and room status overview
- `MoistureMap`: SVG-based moisture reading visualization, IICRC classification, drying equipment calculation

#### 9. Export (Screen 7)
- ESX/Xactimate XML export
- PDF report generation
- "Submit for Review" workflow with status tracking (submitted → under_review → approved/revision_needed)

### Data Model
12 PostgreSQL tables in Supabase:

**Act 1 — Core:**
| Table | Key Fields |
|-------|-----------|
| `users` | id (UUID), username, password |
| `claims` | id (serial), claimNumber, insuredName, propertyAddress, city, state, zip, dateOfLoss, perilType, status |
| `documents` | id (serial), claimId, documentType (fnol/policy/endorsements), fileName, storagePath, rawText, status |
| `extractions` | id (serial), claimId, documentType, extractedData (JSONB), confidence (JSONB), confirmedByUser |
| `briefings` | id (serial), claimId, propertyProfile, coverageSnapshot, perilAnalysis, endorsementImpacts, inspectionChecklist, dutiesAfterLoss, redFlags (all JSONB) |

**Act 2 — Inspection:**
| Table | Key Fields |
|-------|-----------|
| `inspection_sessions` | id (serial), claimId, status, currentPhase, currentRoomId, currentStructure, voiceSessionId |
| `inspection_rooms` | id (serial), sessionId, name, roomType, structure, dimensions (JSONB), status, damageCount, photoCount, phase |
| `damage_observations` | id (serial), sessionId, roomId, description, damageType, severity, location, measurements (JSONB) |
| `line_items` | id (serial), sessionId, roomId, damageId, category, action, description, xactCode, quantity, unit, unitPrice, totalPrice, depreciationType, wasteFactor, provenance |
| `inspection_photos` | id (serial), sessionId, roomId, damageId, storagePath, autoTag, caption, photoType, annotations (JSONB), analysis (JSONB), matchesRequest |
| `moisture_readings` | id (serial), sessionId, roomId, location, reading, materialType, dryStandard |
| `voice_transcripts` | id (serial), sessionId, speaker, content, timestamp |

### API Endpoints
~40 RESTful endpoints organized in three groups:

**Act 1 — Document Flow:**
- `GET/POST /api/claims` — List/create claims
- `GET/PATCH /api/claims/:id` — Get/update claim
- `GET /api/claims/:id/documents` — List documents
- `POST /api/claims/:id/documents/upload` — Upload single document
- `POST /api/claims/:id/documents/upload-batch` — Batch upload (endorsements)
- `POST /api/claims/:id/documents/:type/parse` — AI parse document
- `GET /api/claims/:id/extractions` — List extractions
- `GET/PUT /api/claims/:id/extractions/:type` — Get/update extraction
- `POST /api/claims/:id/extractions/confirm-all` — Confirm all extractions
- `POST /api/claims/:id/briefing/generate` — Generate AI briefing
- `GET /api/claims/:id/briefing` — Get briefing

**Act 2 — Inspection:**
- `POST /api/claims/:id/inspection/start` — Start inspection session
- `GET/PATCH /api/inspection/:sessionId` — Get/update session
- `POST /api/inspection/:sessionId/complete` — Complete session
- `POST/GET /api/inspection/:sessionId/rooms` — Create/list rooms
- `PATCH /api/inspection/:sessionId/rooms/:roomId` — Update room
- `POST /api/inspection/:sessionId/rooms/:roomId/complete` — Complete room
- `POST/GET /api/inspection/:sessionId/damages` — Create/list damages
- `POST/GET /api/inspection/:sessionId/line-items` — Create/list line items
- `GET /api/inspection/:sessionId/estimate-summary` — Estimate totals
- `PATCH/DELETE /api/inspection/:sessionId/line-items/:id` — Update/delete line item
- `POST/GET /api/inspection/:sessionId/photos` — Create/list photos
- `POST /api/inspection/:sessionId/photos/:photoId/analyze` — GPT-4o Vision analysis
- `POST/GET /api/inspection/:sessionId/moisture` — Create/list moisture readings
- `POST/GET /api/inspection/:sessionId/transcript` — Add/list transcripts

**Act 3 — Review/Export:**
- `POST /api/realtime/session` — Create OpenAI Realtime session token
- `GET /api/inspection/:sessionId/completeness` — Completeness score + gaps
- `GET /api/inspection/:sessionId/export/esx` — ESX/Xactimate export
- `POST /api/inspection/:sessionId/export/pdf` — PDF report
- `PATCH /api/inspection/:sessionId/status` — Update review status

### UI/UX and Design System
- **Colors:** Primary Purple (`#7763B7`), Deep Purple (`#342A4F`), Gold (`#C6A54E`), Secondary Purple (`#9D8BBF`)
- **Fonts:** Work Sans (headings), Source Sans 3 (body), Space Mono (monospace)
- **Radius:** 0.5rem default
- **Voice States:** Visual indicators for listening (Purple pulse), speaking (Gold pulse), processing (Secondary Purple), error (Gold warning), disconnected (Red)
- **Mobile:** Responsive design with `useIsMobile` hook; sidebars → Sheet drawers; icon-only tabs; responsive padding (`px-3 md:px-5`); scaled icons/text with `md:` breakpoints
- **Navigation:** BottomNav with context-aware routing based on active claim status; hides during active inspection

### Error Recovery
- Voice disconnection auto-reconnect with manual reconnect option
- Error state auto-clearing after timeout
- Export validation to prevent incomplete exports
- Photo upload failure guard (prevents analysis with undefined photoId)
- Filename sanitization for Supabase Storage (strips em dashes, non-ASCII characters)
- PhotoGallery viewer index safety when filters change

### Environment Variables
| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side) |
| `SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_DATABASE_URL` | PostgreSQL connection string for Drizzle ORM |
| `OPENAI_API_KEY` | User's own OpenAI API key |
| `DATABASE_URL` | Fallback database URL (Drizzle config) |

### Build & Run
- `npm run dev` — Development server (Express + Vite middleware on port 5000)
- `npm run build` — Production build (esbuild for server, Vite for client)
- `npm start` — Production server
- `npm run db:push` — Push Drizzle schema to database

## Recent Changes
- **2026-02-07:** Photo Gallery component with grid/list views, type filters (overview, damage, test square, etc.), full-screen viewer with prev/next navigation, and detailed AI analysis annotations (description, damage tags, quality stars, match/mismatch indicators). Replaces old simple photo list in ActiveInspection right panel. Added viewer index safety fix when filter changes.
- **2026-02-07:** FloorPlanSketch now groups rooms by structure (Main Dwelling, Detached Garage, etc.) with separate Interior/Exterior sections per structure. Exterior rooms show type icons (triangle for roof slopes, square variants for elevations). Photo count badges on room rectangles.
- **2026-02-07:** Voice AI prompt expanded for multi-structure exterior inspections: walks through each structure's roof slopes, four elevations, gutters, and other areas. create_room tool now has specific roomType enums for exterior areas (exterior_roof_slope, exterior_elevation_front/left/right/rear, exterior_gutter, etc.). Completeness check updated for hail+wind claims to verify elevation and roof slope documentation.
- **2026-02-07:** Photo upload filename sanitization — strips special characters (em dashes, non-ASCII) before Supabase Storage upload. Upload failure guard prevents analysis with undefined photoId. Analyze endpoint validates photoId.
- **2026-02-07:** Added AI Confidence Score visualization — per-field `ConfidenceScore` component with shield icon, animated bar, and percentage; `OverallConfidenceSummary` aggregating field scores per document tab header; keyboard-accessible tooltips explaining each level.
- **2026-02-07:** Comprehensive mobile optimization across all screens — ActiveInspection sidebars convert to Sheet drawers on mobile, Layout header scales down, ReviewFinalize uses icon-only tabs and stacked buttons, ClaimsList/DocumentUpload/ExtractionReview/InspectionBriefing/ExportPage all have responsive text, spacing, and layout adjustments using `md:` Tailwind breakpoints.
- **2026-02-07:** Batch endorsement upload with pipe-separated storage paths and combined text extraction. Fixed parse route to only split storagePath for endorsements.
- **2026-02-07:** Expanded FNOL, Policy, and Endorsement extraction prompts to capture comprehensive claim data from real sample documents.

## External Dependencies
- **Supabase:** PostgreSQL database and Storage buckets (`claim-documents`, `inspection-photos`). Connected via `@supabase/supabase-js` and `postgres` (postgres.js driver).
- **OpenAI API:** GPT-4o for document parsing, briefing generation, photo analysis (Vision), and Realtime API for voice interactions (`gpt-4o-realtime-preview`). Connected via `openai` SDK v6.
- **pdf-parse:** v1.1.1 for extracting text from PDF documents on the backend. Must stay at v1 (v2 has incompatible API).
- **Drizzle ORM:** v0.39 with drizzle-kit v0.31 for database schema management and queries.
- **Framer Motion:** v12 for page transitions and micro-animations.
- **Vite PWA:** Progressive Web App support with Workbox caching strategies.
