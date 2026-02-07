# Claims IQ Voice Inspector

## Overview
Voice-driven field inspection assistant for insurance adjusters. Supports document upload, AI-powered document parsing (FNOL, Policy, Endorsements), extraction review, inspection briefing generation, voice-guided active inspections with OpenAI Realtime API, review & finalize workflow, and export capabilities (ESX/PDF/Submit for Review).

## Important Notes
- **Database is Supabase PostgreSQL only** — never use local Replit database or execute_sql_tool. All schema changes must target Supabase via psql with SUPABASE_DATABASE_URL.
- `drizzle.config.ts` uses DATABASE_URL (local) — do NOT use `npm run db:push` as it targets the wrong database. Create tables directly in Supabase via psql.

## Recent Changes
- **Feb 7, 2026**: Implemented Review, Export, Progress Map & Polish (Prompt-04):
  - Added **ReviewFinalize** page (Screen 7) with 4 tabs: Estimate (collapsible hierarchy with inline editing), Photos (gallery grouped by room with filters), Completeness (circular score + AI scope gap detection), Notes (adjuster notes + voice transcript viewer).
  - Added **ExportPage** (Screen 8) with ESX/Xactimate export, PDF report generation with print support, and Submit for Review workflow with status tracking.
  - Added **ProgressMap** slide-over component (Screen 6) — room cards grouped by structure with color-coded status, completeness bar, navigation to rooms.
  - Added **MoistureMap** component (Screen 5b) — SVG-based moisture reading visualization with color-coded circles (dry/caution/wet), IICRC water damage classification, drying equipment calculator with add-to-estimate.
  - Enhanced **VoiceIndicator** with error/disconnected states, exact brand colors for each state.
  - Surgical changes to **ActiveInspection**: complete_inspection now routes to Review screen, Progress Map toggle + button in sidebar, Review button in action bar, auto-reconnect on voice disconnect (3s), auto-recover from error state (5s), enhanced disconnected banner with Reconnect Now button.
  - Added 6 new API endpoints: completeness check, grouped estimate, grouped photos, export validation, ESX export, PDF export data, session status update.
  - Added 2 new frontend routes: `/inspection/:id/review` and `/inspection/:id/export`.
- **Feb 7, 2026**: Switched from Replit AI Integrations OpenAI key to user's own `OPENAI_API_KEY` secret. Updated `server/openai.ts` and `server/routes.ts`.
- **Feb 7, 2026**: Supabase secrets updated to new instance. Created all 7 inspection tables via psql. All 12 tables verified in Supabase (users, claims, documents, extractions, briefings, inspection_sessions, inspection_rooms, damage_observations, line_items, inspection_photos, moisture_readings, voice_transcripts).
- **Feb 7, 2026**: Implemented Voice Inspection Engine (Act 2) — 7 new inspection tables, full storage layer, REST API for all inspection operations, OpenAI Realtime API integration via WebRTC, ActiveInspection.tsx rewritten with live voice connection, tool call execution, transcript display, camera capture, and three-panel inspection layout.
- **Feb 7, 2026**: Migrated data layer to Supabase — database now hosted on Supabase PostgreSQL (via SUPABASE_DATABASE_URL), file storage uses Supabase Storage bucket `claim-documents`. Removed multer, switched to base64 JSON uploads. DB driver changed from @neondatabase/serverless to postgres.js.
- **Feb 7, 2026**: Implemented Act 1 backend — database schema, storage layer, OpenAI document parsing (FNOL/Policy/Endorsements), briefing generation, full REST API, and wired all frontend pages to real API endpoints.

## Architecture

### Tech Stack
- **Frontend:** React 19, Vite 7, TypeScript, Tailwind CSS v4, shadcn/ui, wouter routing, TanStack React Query, Framer Motion
- **Backend:** Express 5, pdf-parse (PDF text extraction), @supabase/supabase-js (Storage)
- **Database:** Drizzle ORM + Supabase PostgreSQL (via postgres.js driver)
- **File Storage:** Supabase Storage buckets `claim-documents` (PDFs) and `inspection-photos` (images)
- **AI:** OpenAI GPT-4o (via user's own `OPENAI_API_KEY`) for document parsing and briefing generation; OpenAI Realtime API (gpt-4o-realtime-preview) for voice inspection via WebRTC
- **Voice:** Browser WebRTC PeerConnection + DataChannel → OpenAI Realtime API. Ephemeral key pattern (server creates session, browser connects directly).

### Environment Variables
- `OPENAI_API_KEY` - User's own OpenAI API key (used for document parsing, briefing generation, and Realtime voice sessions)
- `SUPABASE_DATABASE_URL` - Supabase PostgreSQL connection string (preferred over DATABASE_URL)
- `SUPABASE_URL` - Supabase project URL (https://xxx.supabase.co)
- `SUPABASE_SERVICE_ROLE_KEY` - Server-side Supabase key (bypasses RLS)
- `SUPABASE_ANON_KEY` - Public Supabase key

### Database Tables (12 total in Supabase)
**Act 1 — Core tables:**
| Table | Purpose |
|-------|---------|
| `users` | User accounts (varchar UUID PK) |
| `claims` | Insurance claims (serial PK) |
| `documents` | Uploaded PDFs per claim (serial PK, FK → claims) |
| `extractions` | AI-parsed data from documents (serial PK, FK → claims) |
| `briefings` | Generated inspection briefings (serial PK, FK → claims) |

**Act 2 — Inspection tables:**
| Table | Purpose |
|-------|---------|
| `inspection_sessions` | Active inspection sessions (serial PK, FK → claims) |
| `inspection_rooms` | Rooms/areas within an inspection (serial PK, FK → inspection_sessions) |
| `damage_observations` | Damage findings per room (serial PK, FK → inspection_sessions, inspection_rooms) |
| `line_items` | Estimate line items (serial PK, FK → inspection_sessions, inspection_rooms) |
| `inspection_photos` | Photos captured during inspection (serial PK, FK → inspection_sessions, inspection_rooms, damage_observations) |
| `moisture_readings` | Moisture meter readings per room (serial PK, FK → inspection_sessions, inspection_rooms) |
| `voice_transcripts` | Voice conversation log (serial PK, FK → inspection_sessions) |

### Key Files

#### Server
- `shared/schema.ts` - Drizzle ORM schema for all 12 tables, insert schemas, and TypeScript types
- `server/db.ts` - Database connection (postgres.js driver + Drizzle ORM instance, uses SUPABASE_DATABASE_URL)
- `server/supabase.ts` - Supabase client for Storage operations + bucket initialization (claim-documents, inspection-photos)
- `server/storage.ts` - `IStorage` interface + `DatabaseStorage` class with Drizzle CRUD for all 12 tables
- `server/openai.ts` - OpenAI GPT-4o functions: extractFNOL, extractPolicy, extractEndorsements, generateBriefing (uses OPENAI_API_KEY)
- `server/realtime.ts` - OpenAI Realtime API: buildSystemInstructions() + 10 tool definitions (set_inspection_context, create_room, complete_room, add_damage, add_line_item, trigger_photo_capture, log_moisture_reading, get_progress, get_estimate_summary, complete_inspection)
- `server/routes.ts` - All REST API endpoints (Act 1 document flow + Act 2 inspection + Act 3 review/export + realtime session)
- `server/index.ts` - Express server setup, calls ensurePhotoBucket() on startup

#### Client — Pages
- `client/src/pages/ClaimsList.tsx` - Claims list / dashboard
- `client/src/pages/DocumentUpload.tsx` - PDF upload interface
- `client/src/pages/ExtractionReview.tsx` - Review AI-extracted data
- `client/src/pages/InspectionBriefing.tsx` - Pre-inspection briefing display
- `client/src/pages/ActiveInspection.tsx` - Voice inspection UI: WebRTC connection, tool call execution, camera capture, three-panel layout
- `client/src/pages/ReviewFinalize.tsx` - Review & Finalize (Screen 7): 4-tab interface with estimate tree, photo gallery, completeness checklist, notes/transcript
- `client/src/pages/ExportPage.tsx` - Export (Screen 8): ESX download, PDF generation, submit for review

#### Client — Components
- `client/src/components/ProgressMap.tsx` - Slide-over progress map (Screen 6): rooms grouped by structure, color-coded status, completeness bar
- `client/src/components/MoistureMap.tsx` - Moisture visualization (Screen 5b): SVG room grid, reading circles, IICRC classification, drying equipment calculator
- `client/src/components/VoiceIndicator.tsx` - Animated voice state indicator with 6 states (idle, listening, processing, speaking, error, disconnected)
- `client/src/components/Layout.tsx` - App shell layout
- `client/src/App.tsx` - Router with all page routes (7 routes)
- `client/src/lib/queryClient.ts` - TanStack Query client + apiRequest helper

### Frontend Routes
| Path | Component | Purpose |
|------|-----------|---------|
| `/` | ClaimsList | Dashboard showing all claims |
| `/upload/:id` | DocumentUpload | Upload FNOL, Policy, Endorsement PDFs |
| `/review/:id` | ExtractionReview | Review and confirm AI-extracted data |
| `/briefing/:id` | InspectionBriefing | View generated inspection briefing |
| `/inspection/:id` | ActiveInspection | Live voice-guided inspection with WebRTC |
| `/inspection/:id/review` | ReviewFinalize | Review & Finalize with 4 tabs |
| `/inspection/:id/export` | ExportPage | Export ESX, PDF, Submit for Review |

### API Endpoints — Act 1
- `GET/POST /api/claims` - List/create claims
- `GET/PATCH /api/claims/:id` - Get/update claim
- `POST /api/claims/:id/documents/upload` - Upload PDF (base64 JSON body: fileName, fileBase64, documentType)
- `POST /api/claims/:id/documents/:type/parse` - Parse document with OpenAI
- `GET /api/claims/:id/extractions` - Get all extractions for a claim
- `PUT /api/claims/:id/extractions/:type` - Update extraction data
- `POST /api/claims/:id/extractions/confirm-all` - Confirm all extractions
- `POST /api/claims/:id/briefing/generate` - Generate inspection briefing via AI
- `GET /api/claims/:id/briefing` - Get briefing

### API Endpoints — Act 2 (Inspection)
- `POST /api/claims/:id/inspection/start` - Start inspection session (creates session, updates claim status)
- `GET /api/inspection/:sessionId` - Get session with rooms, line item count, photo count, estimate summary
- `PATCH /api/inspection/:sessionId` - Update session state (phase, structure, room, voiceSessionId)
- `POST /api/inspection/:sessionId/complete` - Complete inspection session
- `POST /api/inspection/:sessionId/rooms` - Create room (name, roomType, structure, dimensions, phase)
- `GET /api/inspection/:sessionId/rooms` - List rooms for session
- `PATCH /api/inspection/:sessionId/rooms/:roomId` - Update room status
- `POST /api/inspection/:sessionId/rooms/:roomId/complete` - Complete room
- `POST /api/inspection/:sessionId/damages` - Create damage observation
- `GET /api/inspection/:sessionId/damages` - List damages for session
- `POST /api/inspection/:sessionId/line-items` - Create line item (category, action, description, quantity, unit, unitPrice, etc.)
- `GET /api/inspection/:sessionId/line-items` - List line items
- `GET /api/inspection/:sessionId/estimate-summary` - Running estimate totals (totalRCV, totalDepreciation, totalACV, itemCount)
- `PATCH /api/inspection/:sessionId/line-items/:id` - Update line item
- `DELETE /api/inspection/:sessionId/line-items/:id` - Delete line item
- `POST /api/inspection/:sessionId/photos` - Upload inspection photo (base64)
- `GET /api/inspection/:sessionId/photos` - List photos
- `POST /api/inspection/:sessionId/moisture` - Create moisture reading
- `GET /api/inspection/:sessionId/moisture` - List moisture readings
- `POST /api/inspection/:sessionId/transcript` - Append transcript entry
- `GET /api/inspection/:sessionId/transcript` - Get full transcript
- `POST /api/realtime/session` - Create OpenAI Realtime ephemeral session (returns client_secret for WebRTC)

### API Endpoints — Act 3 (Review & Export)
- `GET /api/inspection/:sessionId/completeness` - Completeness check with peril-specific checklist, scope gaps, missing photos
- `GET /api/inspection/:sessionId/estimate-grouped` - Estimate hierarchy: category → room → line items with subtotals
- `GET /api/inspection/:sessionId/photos-grouped` - Photos grouped by room with counts
- `POST /api/inspection/:sessionId/export/validate` - Export validation (blockers/warnings/summary)
- `POST /api/inspection/:sessionId/export/esx` - Generate ESX/XML file for Xactimate
- `POST /api/inspection/:sessionId/export/pdf` - Generate structured JSON for client-side PDF rendering
- `PATCH /api/inspection/:sessionId/status` - Update session status (active, review, exported, submitted, approved)

### Design System
- **Colors:** Primary Purple `#7763B7`, Deep Purple `#342A4F`, Gold `#C6A54E`, Secondary Purple `#9D8BBF`
- **Fonts:** Work Sans (display/headings), Source Sans 3 (body), Space Mono (mono/data)
- **Radius:** 0.5rem default
- **Voice States:** Listening = Purple bars, Speaking = Gold bars, Processing = Secondary Purple, Error = Gold warning, Disconnected = Red wifi-off

### Application Flow
1. **Claims List** → Upload documents → Parse with AI → Review extracted data → Confirm
2. **Briefing** → Generated from FNOL + Policy + Endorsements → Review before inspection
3. **Active Inspection** → Voice-guided with WebRTC → Tools create rooms, damages, line items, photos, moisture readings
4. **Review & Finalize** → 4-tab interface (Estimate tree, Photos gallery, Completeness check, Notes/Transcript)
5. **Export** → Validate → ESX for Xactimate, PDF report, Submit for carrier review

### Error Recovery
- Voice disconnection triggers auto-reconnect after 3 seconds
- Disconnected banner with manual "Reconnect Now" button
- Error state auto-clears after 5 seconds
- Export validation blocks export if no line items exist
- Export warnings shown but don't block (missing photos, incomplete rooms)

## User Preferences
- Professional insurance app styling
- Clean, minimal aesthetic
- Database must be Supabase only — never use local Replit PostgreSQL
- Never use execute_sql_tool for Supabase operations
- All schema changes via psql with SUPABASE_DATABASE_URL
- Use user's own `OPENAI_API_KEY` — not Replit AI Integrations key
