# Claims IQ Voice Inspector

## Overview
Voice-driven field inspection assistant for insurance adjusters. Supports document upload, AI-powered document parsing (FNOL, Policy, Endorsements), extraction review, inspection briefing generation, and voice-guided active inspections with OpenAI Realtime API.

## Important Notes
- **Database is Supabase PostgreSQL only** — never use local Replit database or execute_sql_tool. All schema changes must target Supabase via psql with SUPABASE_DATABASE_URL.
- `drizzle.config.ts` uses DATABASE_URL (local) — do NOT use `npm run db:push` as it targets the wrong database. Create tables directly in Supabase via psql.
- The Supabase instance is shared with another project. Our app uses 12 tables (see Database Tables below). Do not modify or drop any other tables in the database.

## Recent Changes
- **Feb 7, 2026**: Confirmed all 7 inspection tables exist in Supabase PostgreSQL (inspection_sessions, inspection_rooms, damage_observations, line_items, inspection_photos, moisture_readings, voice_transcripts). All 12 app tables verified live.
- **Feb 7, 2026**: Implemented Voice Inspection Engine (Act 2) — 7 new inspection tables, full storage layer, REST API for all inspection operations, OpenAI Realtime API integration via WebRTC, ActiveInspection.tsx rewritten with live voice connection, tool call execution, transcript display, camera capture, and three-panel inspection layout.
- **Feb 7, 2026**: Migrated data layer to Supabase — database now hosted on Supabase PostgreSQL (via SUPABASE_DATABASE_URL), file storage uses Supabase Storage bucket `claim-documents`. Removed multer, switched to base64 JSON uploads. DB driver changed from @neondatabase/serverless to postgres.js.
- **Feb 7, 2026**: Implemented Act 1 backend - database schema, storage layer, OpenAI document parsing (FNOL/Policy/Endorsements), briefing generation, full REST API, and wired all frontend pages to real API endpoints.

## Architecture

### Tech Stack
- **Frontend:** React 19, Vite 7, TypeScript, Tailwind CSS v4, shadcn/ui, wouter routing, TanStack React Query, Framer Motion
- **Backend:** Express 5, pdf-parse (PDF text extraction), @supabase/supabase-js (Storage)
- **Database:** Drizzle ORM + Supabase PostgreSQL (via postgres.js driver)
- **File Storage:** Supabase Storage buckets `claim-documents` (PDFs) and `inspection-photos` (images)
- **AI:** OpenAI GPT-4o via Replit AI Integrations for document parsing; OpenAI Realtime API (gpt-4o-realtime-preview) for voice inspection via WebRTC
- **Voice:** Browser WebRTC PeerConnection + DataChannel → OpenAI Realtime API. Ephemeral key pattern (server creates session, browser connects directly).

### Environment Variables
- `SUPABASE_DATABASE_URL` - Supabase PostgreSQL connection string (preferred over DATABASE_URL)
- `SUPABASE_URL` - Supabase project URL (https://xxx.supabase.co)
- `SUPABASE_SERVICE_ROLE_KEY` - Server-side Supabase key (bypasses RLS)
- `SUPABASE_ANON_KEY` - Public Supabase key
- `AI_INTEGRATIONS_OPENAI_API_KEY` - OpenAI API key (auto-populated by Replit AI Integrations; used for both chat completions and Realtime sessions)

### Database Tables (12 used by this app)
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
- `shared/schema.ts` - Drizzle ORM schema for all 12 tables, insert schemas, and TypeScript types
- `server/db.ts` - Database connection (postgres.js driver + Drizzle ORM instance)
- `server/supabase.ts` - Supabase client for Storage operations + bucket initialization (claim-documents, inspection-photos)
- `server/storage.ts` - `IStorage` interface + `DatabaseStorage` class with Drizzle CRUD for all 12 tables
- `server/openai.ts` - OpenAI GPT-4o functions: extractFNOL, extractPolicy, extractEndorsements, generateBriefing
- `server/realtime.ts` - OpenAI Realtime API: buildSystemInstructions() + 10 tool definitions (set_inspection_context, create_room, complete_room, add_damage, add_line_item, trigger_photo_capture, log_moisture_reading, get_progress, get_estimate_summary, complete_inspection)
- `server/routes.ts` - All REST API endpoints (Act 1 document flow + Act 2 inspection + realtime session)
- `server/index.ts` - Express server setup, calls ensurePhotoBucket() on startup
- `client/src/pages/ActiveInspection.tsx` - Voice inspection UI: WebRTC connection, tool call execution, camera capture, three-panel layout
- `client/src/pages/ClaimsList.tsx` - Claims list / dashboard
- `client/src/pages/DocumentUpload.tsx` - PDF upload interface
- `client/src/pages/ExtractionReview.tsx` - Review AI-extracted data
- `client/src/pages/InspectionBriefing.tsx` - Pre-inspection briefing display
- `client/src/App.tsx` - Router with all page routes
- `client/src/components/Layout.tsx` - App shell layout
- `client/src/components/VoiceIndicator.tsx` - Animated voice state indicator
- `client/src/lib/queryClient.ts` - TanStack Query client + apiRequest helper

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

### Design System
- Primary: #342A4F (purple), Secondary: #C6A54E (gold)
- Fonts: Work Sans (display), Source Sans 3 (body), Space Mono (mono)

## User Preferences
- Professional insurance app styling
- Clean, minimal aesthetic
- Database must be Supabase only — never use local Replit PostgreSQL
- Never use execute_sql_tool for Supabase operations
- All schema changes via psql with SUPABASE_DATABASE_URL
