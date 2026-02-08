# Claims IQ Voice Inspector

## Overview
Claims IQ Voice Inspector is an AI-powered voice-driven field inspection assistant for insurance adjusters. It aims to streamline the insurance claims process by automating document analysis, guiding inspections, and facilitating report generation. The project's core purpose is to enhance accuracy, reduce manual effort, and accelerate claim processing, providing significant value to insurance companies and adjusters.

Key capabilities include: AI-powered document parsing of claim reports and policy forms, guided voice inspections using real-time AI, multi-structure inspection support, AI-enhanced photo capture and damage annotation, moisture reading logging, and comprehensive review-and-export functionalities (ESX/Xactimate, PDF).

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
- **Backend:** Express 5
- **Database:** Drizzle ORM with Supabase PostgreSQL (postgres.js driver)
- **File Storage:** Supabase Storage
- **AI:** OpenAI GPT-4o (document parsing, briefing, photo analysis), OpenAI Realtime API (voice inspection via WebRTC)
- **Voice:** Browser WebRTC for OpenAI Realtime API integration
- **PWA:** Vite PWA plugin with Workbox

### Project Structure
The project is organized into `client/` for the React frontend, `server/` for the Express backend, and `shared/` for common Drizzle schemas and types.

### Key Files
- `server/auth.ts` — Supabase JWT authentication middleware (`authenticateSupabaseToken`, `authenticateRequest`, `requireRole`)
- `server/routes.ts` — All ~40 RESTful API endpoints
- `server/index.ts` — Express app setup, rate limiting, Vite middleware
- `server/storage.ts` — `IStorage` interface + Drizzle-based implementation for all CRUD operations
- `client/src/App.tsx` — Frontend routing with wouter, error boundaries, protected routes
- `client/src/pages/ActiveInspection.tsx` — Voice-guided inspection with OpenAI Realtime API via WebRTC
- `client/src/pages/ExtractionReview.tsx` — AI extraction review with editable fields and confidence scoring
- `client/src/pages/ReviewFinalize.tsx` — Multi-tab review (estimate, photos, completeness, notes)
- `client/src/lib/queryClient.ts` — TanStack React Query configuration (retries, staleTime, error handling)
- `shared/schema.ts` — Drizzle ORM schema definitions for all 12 tables

### Frontend Routes
The application features a multi-screen workflow:
- `/`: Claims List (dashboard with real calculated estimates)
- `/upload/:id`: Document Upload
- `/review/:id`: Extraction Review (editable AI-parsed fields with save)
- `/briefing/:id`: Inspection Briefing
- `/inspection/:id`: Active Voice Inspection
- `/inspection/:id/review`: Review & Finalize
- `/inspection/:id/export`: Export
- `/supplemental/:id`: Supplemental Claims

### Core Features
- **Claims Management:** Creation and status tracking of claims (draft to exported).
- **Document Processing:** Upload and AI-powered parsing of FNOLs, policies, and endorsements with batch support.
- **AI Confidence Scoring:** Visual indicators for AI extraction confidence (high/medium/low).
- **Inspection Briefing:** AI-generated briefings covering property, coverage, peril, and inspection checklists.
- **Active Voice Inspection:** A three-panel interface for voice-guided inspections using OpenAI Realtime API, featuring floor plans, real-time transcription, and a photo gallery. Voice AI tools facilitate actions like setting context, creating rooms, adding damages, capturing photos, and logging moisture readings.
- **Multi-Structure Inspections:** Support for detailed exterior inspections of multiple structures, including roof slopes and elevations, aligned with Xactimate patterns.
- **Review & Finalize:** A comprehensive review stage with tabs for estimate details, photos, completeness checks with AI scope gap detection, and notes. Adjuster notes persist to localStorage.
- **Export:** Options for ESX/Xactimate XML, PDF report generation, and a "Submit for Review" workflow.

### Data Model
The system uses 12 PostgreSQL tables in Supabase, structured around core claim data, document processing, and detailed inspection sessions, rooms, damages, line items, photos, and moisture readings.

**Database Indexes (7 total):**
- `idx_inspection_sessions_claim_id` on `inspection_sessions(claim_id)`
- `idx_inspection_rooms_session_id` on `inspection_rooms(session_id)`
- `idx_line_items_session_id` on `line_items(session_id)`
- `idx_inspection_photos_session_id` on `inspection_photos(session_id)`
- `idx_damage_observations_session_id` on `damage_observations(session_id)`
- `idx_claims_assigned_to` on `claims(assigned_to)`
- `idx_claims_status` on `claims(status)`

### API Endpoints
Approximately 40 RESTful endpoints manage the workflow, grouped into Document Flow, Inspection, and Review/Export phases. All mutation endpoints validate request bodies with Zod schemas (including `.strict()` on PATCH bodies for line items and supplementals).

### Security Architecture
- **Authentication:** Supabase JWT tokens verified cryptographically via `supabase.auth.getUser()` (not base64 decode)
- **Authorization:** Role-based access control with `requireRole("admin")` for sensitive endpoints (pricing/seed, purge-all)
- **Rate Limiting:** Three tiers via `express-rate-limit`:
  - General API: 300 requests / 15 min
  - Auth endpoints: 30 requests / 15 min
  - AI endpoints (parse, briefing, photo analyze): 60 requests / 15 min
- **Error Handling:** All 500 responses return generic "Internal server error" messages; details logged server-side only
- **Body Limits:** JSON body size capped at 30MB
- **Protected Endpoints:** All sensitive endpoints require `authenticateRequest` or `authenticateSupabaseToken`

### UI/UX and Design System
The UI/UX emphasizes a professional insurance app aesthetic using Primary Purple, Deep Purple, and Gold color schemes, Work Sans and Source Sans 3 fonts. Responsive design is implemented using a `useIsMobile` hook, adapting layouts for mobile devices with sheet drawers, icon-only navigation, and scaled elements. Visual indicators are used for voice states (listening, speaking, processing, error, disconnected).

**Error Boundaries:** Two-level error boundaries — one wrapping `ProtectedRouter` and one wrapping inner route content — catch and display errors gracefully with retry options.

**React Query Config:** Retries set to 2 with exponential backoff, staleTime of 5 minutes, refetchOnWindowFocus disabled.

### Error Recovery
The system includes mechanisms for voice disconnection auto-reconnect (with proper timeout cleanup on unmount), error state auto-clearing, export validation, photo upload failure guards, filename sanitization, and ref-based WebRTC connection state to prevent race conditions.

### Data Integrity
- **Depreciation:** Category-specific rates (roofing: 20yr, siding: 25yr, interior: 10yr, default: 12yr) instead of flat percentage
- **Dashboard Estimates:** Calculated from actual line item totals, not hardcoded
- **Inspection Duration:** Computed from actual session start/end timestamps

## External Dependencies
- **Supabase:** Used for PostgreSQL database and file storage (`claim-documents`, `inspection-photos` buckets).
- **OpenAI API:** Utilized for GPT-4o capabilities (document parsing, briefing, photo analysis) and the Realtime API for voice interactions (`gpt-4o-realtime-preview`).
- **pdf-parse:** Version 1.1.1 is used on the backend for PDF text extraction.
- **Drizzle ORM:** Employed for database schema management and querying.
- **Framer Motion:** Used for UI animations and transitions.
- **Vite PWA:** Provides Progressive Web App features, including offline caching.
- **express-rate-limit:** API rate limiting middleware.

## Recent Changes (February 2026)

### Audit Remediation (CODEBASE_AUDIT_003) — 17+ fixes
**Security:**
- SEC-01: JWT verification upgraded to cryptographic validation via `supabase.auth.getUser()`
- SEC-02: `/api/auth/sync` protected with token verification + supabaseId match
- SEC-03/04/07: Auth added to photo annotations, admin role required for pricing/seed and purge-all
- SEC-06: All 500 error responses now return generic messages (69 instances fixed)
- SEC-08: Three-tier rate limiting (general 300, auth 30, AI 60 per 15 min)
- SEC-09: JSON body limit reduced from 50MB to 30MB

**Stability:**
- SD-01/02: Memory leaks fixed — reconnect and error recovery timeouts cleared on unmount
- SD-03: WebRTC race condition fixed with ref-based `isConnecting` flag
- SD-06: React Query retries enabled (2 attempts, exponential backoff, 5min staleTime)

**Data Layer:**
- DL-01: Per-category depreciation rates replace hardcoded 15%
- DL-02: Dashboard uses actual calculated estimates
- DL-03: Average inspection time from real session timestamps
- DL-05: 7 database indexes on FK/filter columns
- API-03/04: Zod `.strict()` validation on line item and supplemental PATCH bodies

**UI/UX:**
- UC-01: SupplementalPage route registered
- UC-02: EditableField handlers functional with save button + API persistence
- UC-03: Adjuster notes persist to localStorage keyed by sessionId
- UC-04: ReviewFinalize uses GET instead of POST-as-queryFn
- CC-01: Two-level error boundaries added
- CC-08: BottomNav moved inside ProtectedRouter
