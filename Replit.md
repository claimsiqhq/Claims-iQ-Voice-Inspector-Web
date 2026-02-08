# Claims IQ Voice Inspector

## Overview
Claims IQ Voice Inspector is an AI-powered voice-driven field inspection assistant for insurance adjusters. It aims to streamline the insurance claims process by automating document analysis, guiding inspections, and facilitating report generation. The project's core purpose is to enhance accuracy, reduce manual effort, and accelerate claim processing, providing significant value to insurance companies and adjusters.

Key capabilities include: AI-powered document parsing of claim reports and policy forms, guided voice inspections using real-time AI, multi-structure inspection support, AI-enhanced photo capture and damage annotation, moisture reading logging, comprehensive review-and-export functionalities (ESX/Xactimate ZIP, PDF), AI-powered estimate review (scope gaps, pricing anomalies, compliance), and supplemental claims workflow for additional damage discovery.

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
- **Auth:** Supabase Auth with JWT token validation, role-based access control (adjuster/supervisor/admin)
- **Database:** Drizzle ORM with Supabase PostgreSQL (postgres.js driver)
- **File Storage:** Supabase Storage
- **AI:** OpenAI GPT-4o (document parsing, briefing, photo analysis), OpenAI Realtime API (voice inspection via WebRTC)
- **Voice:** Browser WebRTC for OpenAI Realtime API integration
- **PWA:** Vite PWA plugin with Workbox

### Project Structure
The project is organized into `client/` for the React frontend, `server/` for the Express backend, and `shared/` for common Drizzle schemas and types.

### Frontend Routes
The application features a multi-screen workflow with authentication:
- Login/Register (shown when unauthenticated)
- `/`: Claims List (filtered by role — supervisors see all, adjusters see assigned)
- `/dashboard`: Supervisor Dashboard (supervisor role only)
- `/documents`: Documents Hub
- `/settings`: Settings
- `/upload/:id`: Document Upload
- `/review/:id`: Extraction Review
- `/briefing/:id`: Inspection Briefing
- `/inspection/:id`: Active Voice Inspection
- `/inspection/:id/review`: Review & Finalize
- `/inspection/:id/export`: Export

### Authentication & Authorization
- **Supabase Auth:** Email/password authentication via Supabase Auth SDK
- **Role-Based Access Control (RBAC):** Three roles — `adjuster` (default), `supervisor`, `admin`
- **Auth Middleware (`server/auth.ts`):** JWT token validation by decoding Supabase JWT `sub` claim, role-checking middleware
- **Auth Context (`client/src/contexts/AuthContext.tsx`):** Global React context providing `useAuth()` hook with `signIn`, `signUp`, `signOut`, `refreshSession`, `isAuthenticated`, `user`, `role`, and `loading` state
- **User Sync:** On Supabase login, users are synced to the local `users` table via `POST /api/auth/sync`
- **Protected Routes:** All routes require authentication; supervisor dashboard requires `supervisor` or `admin` role
- **Claim Assignment:** Claims can be assigned to specific adjusters via `assigned_to` field; supervisors can assign claims via `POST /api/admin/claims/assign`
- **Inspector Tracking:** Inspection sessions track which inspector started them via `inspector_id` field

### Core Features
- **Claims Management:** Creation and status tracking of claims (draft to exported).
- **Document Processing:** Upload and AI-powered parsing of FNOLs, policies, and endorsements with batch support.
- **AI Confidence Scoring:** Visual indicators for AI extraction confidence (high/medium/low).
- **Inspection Briefing:** AI-generated briefings covering property, coverage, peril, and inspection checklists.
- **Active Voice Inspection:** A three-panel interface for voice-guided inspections using OpenAI Realtime API, featuring floor plans, real-time transcription, and a photo gallery. Voice AI tools facilitate actions like setting context, creating rooms, adding damages, capturing photos, and logging moisture readings. The `add_line_item` tool supports `catalogCode` for automatic Xactimate pricing lookup.
- **Multi-Structure Inspections:** Support for detailed exterior inspections of multiple structures, including roof slopes and elevations, aligned with Xactimate patterns.
- **Review & Finalize:** A comprehensive review stage with tabs for estimate details (including Material/Labor/Equipment breakdown and O&P eligibility display), photos, completeness checks with AI scope gap detection, and notes.
- **AI Estimate Review:** GPT-4o-powered analysis that scores estimates (1-100) and detects scope gaps, pricing anomalies, documentation issues, and compliance violations with actionable suggestions.
- **Export:** Xactimate-compatible ESX ZIP files (XACTDOC.XML + GENERIC_ROUGHDRAFT.XML), PDF report generation, AI review panel, and a "Submit for Review" workflow.
- **Supplemental Claims:** Workflow for managing additional damage discovered after initial inspection, with draft/submit/approve lifecycle and delta tracking.

### Data Model
The system uses 15 PostgreSQL tables in Supabase, structured around core claim data, document processing, detailed inspection sessions, rooms, damages, line items, photos, moisture readings, a pricing catalog, and supplemental claims. Key schema extensions:
- **users table:** Extended with `email`, `full_name`, `role` (adjuster/supervisor/admin), `supabase_auth_id`, `last_login_at`, `is_active`
- **claims table:** Added `assigned_to` (FK to users) for claim assignment
- **inspection_sessions table:** Added `inspector_id` (FK to users) to track who runs inspections

The two catalog tables are:
- **scope_line_items:** ~100 Xactimate-compatible catalog items across 14 trades (MIT, DEM, DRY, PNT, FLR, INS, CAR, CAB, CTR, RFG, WIN, EXT, ELE, PLM) with codes, units, waste factors, and companion rules.
- **regional_price_sets:** Regional pricing with separate material/labor/equipment cost breakdown per catalog item (currently US_NATIONAL region).

### Xactimate Pricing Engine (`server/estimateEngine.ts`)
A dedicated pricing engine provides:
- Catalog lookup by code and regional price retrieval
- Line item price calculation: `unitPrice = (Material + Labor + Equipment) x (1 + wasteFactor%)`
- Estimate totals with material/labor/equipment subtotals, tax (default 8%), and waste tracking
- Overhead & Profit (O&P) eligibility: 10% overhead + 10% profit when 3+ trades are involved
- Estimate validation for scope gaps (missing companion items, duplicate detection)
- Companion item suggestions (e.g., underlayment with roofing, house wrap with siding)

### Seed Catalog (`server/seed-catalog.ts`)
Seed data for ~100 line items with realistic Verisk-style pricing. Seeded via `POST /api/pricing/seed`.

### API Endpoints
Approximately 62 RESTful endpoints manage the workflow, grouped into Auth, Admin, Document Flow, Inspection, Pricing Catalog, and Review/Export phases.

**Auth & Admin endpoints:**
- `POST /api/auth/sync` — Sync Supabase user to local DB (creates or updates)
- `GET /api/auth/me` — Get current user profile (requires auth)
- `GET /api/admin/users` — List team members (supervisor/admin only)
- `POST /api/admin/claims/assign` — Assign claim to adjuster (supervisor/admin only)
- `GET /api/admin/dashboard` — Team metrics (supervisor/admin only)
- `GET /api/admin/active-sessions` — Active inspections overview (supervisor/admin only)

**Pricing endpoints include:**
- `GET /api/pricing/catalog` — Full catalog listing
- `GET /api/pricing/catalog/search?q=` — Search catalog by code or description
- `GET /api/pricing/catalog/:tradeCode` — Items by trade
- `POST /api/pricing/scope` — Price a list of items with regional pricing, returns M/L/E breakdown and totals
- `POST /api/pricing/validate` — Validate an estimate for scope gaps
- `GET /api/pricing/regions` — Available pricing regions
- `POST /api/pricing/seed` — Seed the catalog (idempotent)

### UI/UX and Design System
The UI/UX emphasizes a professional insurance app aesthetic using Primary Purple, Deep Purple, and Gold color schemes, Work Sans and Source Sans 3 fonts. Responsive design is implemented using a `useIsMobile` hook, adapting layouts for mobile devices with sheet drawers, icon-only navigation, and scaled elements. Visual indicators are used for voice states (listening, speaking, processing, error, disconnected).

### Error Recovery
The system includes mechanisms for voice disconnection auto-reconnect, error state auto-clearing, export validation, photo upload failure guards, and filename sanitization.

### Environment Variables
- `VITE_SUPABASE_URL` — Supabase project URL (frontend, used for Auth SDK)
- `VITE_SUPABASE_ANON_KEY` — Supabase anonymous key (frontend, used for Auth SDK)
- `OPENAI_API_KEY` — OpenAI API key (backend)
- `SUPABASE_DATABASE_URL` — Supabase PostgreSQL connection URL (backend)

## External Dependencies
- **Supabase:** Used for PostgreSQL database, file storage (`claim-documents`, `inspection-photos` buckets), and user authentication (Supabase Auth).
- **OpenAI API:** Utilized for GPT-4o capabilities (document parsing, briefing, photo analysis) and the Realtime API for voice interactions (`gpt-4o-realtime-preview`).
- **pdf-parse:** Version 1.1.1 is used on the backend for PDF text extraction.
- **pdfkit:** Server-side PDF generation for professional branded inspection reports.
- **archiver:** ZIP archive generation for Xactimate-compatible ESX file exports.
- **Drizzle ORM:** Employed for database schema management and querying.
- **Framer Motion:** Used for UI animations and transitions.
- **Vite PWA:** Provides Progressive Web App features, including offline caching.

## PROMPT-09 — ESX Export, AI Estimate Review & Supplemental Claims Workflow

### Changes Applied

**New Files:**
- `server/esxGenerator.ts` — Generates real Xactimate-compatible ESX files as ZIP archives containing XACTDOC.XML (claim/contact/summary metadata) and GENERIC_ROUGHDRAFT.XML (room-grouped line items with labor/material/tax breakdowns and room dimension calculations). Replaces the previous simple XML placeholder export.
- `server/aiReview.ts` — AI-powered estimate review using GPT-4o that analyzes inspection data for scope gaps (rooms with damage but missing line items), pricing anomalies, documentation gaps (rooms without photos), compliance issues (moisture protocol for water claims), and actionable suggestions. Returns a structured review with an overall score (1-100) and categorized findings. Falls back gracefully when the API is unavailable.
- `client/src/components/AIReviewPanel.tsx` — Collapsible panel displaying AI review results with color-coded score circle (green/yellow/red), expandable sections for scope gaps, pricing anomalies, documentation, compliance, and suggestions. Includes severity indicators and a re-run button.
- `client/src/pages/SupplementalPage.tsx` — Full supplemental claims management page showing original estimate summary, list of existing supplementals with status badges (draft/submitted/approved), and a form to create new supplemental claims with reason text.

**Modified Files:**
- `shared/schema.ts` — Added `supplementalClaims` table (tracks original session, claim, reason, status, new/removed/modified line items, review notes, timestamps). Added `insertSupplementalClaimSchema`, `SupplementalClaim`, and `InsertSupplementalClaim` exports.
- `server/storage.ts` — Added `supplementalClaims` table import and `SupplementalClaim`/`InsertSupplementalClaim` type imports. Extended `IStorage` interface with 6 supplemental methods. Implemented `createSupplementalClaim`, `getSupplementalsForSession`, `getSupplemental`, `updateSupplemental`, `submitSupplemental`, and `approveSupplemental` in `DatabaseStorage` class.
- `server/routes.ts` — Added imports for `generateESXFile` and `reviewEstimate`. Replaced the ESX export endpoint to use the new ZIP-based generator (Content-Type changed from `application/xml` to `application/zip`). Added `POST /api/inspection/:sessionId/review/ai` endpoint for AI estimate review. Added 5 supplemental claim endpoints: create, list, update, submit, and supplemental ESX export.
- `client/src/pages/ExportPage.tsx` — Added `AIReviewPanel` import. Inserted AI review panel before the ESX export card on the Export page, displayed when validation is complete and session is available.
- `package.json` — Added `archiver` to dependencies and `@types/archiver` to devDependencies.

### New Database Table
- **supplemental_claims:** `id`, `original_session_id` (FK inspection_sessions), `claim_id` (FK claims), `reason`, `status` (draft/submitted/approved), `new_line_items` (JSONB), `removed_line_item_ids` (JSONB), `modified_line_items` (JSONB), `review_notes`, `created_at`, `submitted_at`, `approved_at`

### New API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/inspection/:sessionId/export/esx` | POST | Generate Xactimate-compatible ESX ZIP file (enhanced) |
| `/api/inspection/:sessionId/review/ai` | POST | Run GPT-4o estimate review analysis |
| `/api/inspection/:sessionId/supplemental` | POST | Create new supplemental claim |
| `/api/inspection/:sessionId/supplementals` | GET | List supplementals for session |
| `/api/supplemental/:id` | PATCH | Update supplemental claim fields |
| `/api/supplemental/:id/submit` | POST | Submit supplemental for approval |
| `/api/supplemental/:id/export/esx` | POST | Export supplemental as ESX (placeholder) |

### Key Design Decisions
- ESX files are real ZIP archives with proper XACTDOC.XML and GENERIC_ROUGHDRAFT.XML structure matching Xactimate import format
- AI review uses GPT-4o with JSON response format and 0.3 temperature for consistent analysis
- AI review gracefully degrades to a default review when the OpenAI API is unavailable
- Supplemental claims are independent entities linked to the original session, enabling delta tracking
- Labor/material/tax splits in ESX use industry-standard ratios (35% labor, 65% material, 5% tax)

### Build Status
- TypeScript compilation: No new errors introduced (pre-existing Express type issues unchanged)
- All new modules properly typed with interfaces and exports

## PROMPT-08 — PDF Report Generation & Photo Annotation Canvas

### Changes Applied

**New Files:**
- `server/pdfGenerator.ts` — Professional Claims IQ branded PDF report builder using pdfkit with 6+ report sections: cover page, claim info, room-by-room details (damages, line items, photos), estimate summary with category breakdowns, photo appendix with AI analysis, and moisture report for water peril claims.
- `client/src/components/PhotoAnnotator.tsx` — Canvas-based photo annotation tool with 5 drawing tools (arrow, circle, rectangle, freehand, text), 5 color options, 3 line widths, undo/redo stack, and clear-all functionality. Full-screen overlay with framer-motion transitions.

**Modified Files:**
- `server/routes.ts` — Replaced the PDF export endpoint (`POST /api/inspection/:sessionId/export/pdf`) from returning JSON data to generating and streaming a real PDF file via pdfkit. Added `PUT /api/inspection/:sessionId/photos/:photoId/annotations` endpoint for saving annotation shapes to the database's existing `annotations` jsonb column.
- `client/src/components/PhotoGallery.tsx` — Added "Annotate" button to the full-screen photo viewer header. Integrated PhotoAnnotator modal with save-to-backend callback. Added `sessionId` prop for API calls.
- `client/src/pages/ActiveInspection.tsx` — Passes `sessionId` prop to PhotoGallery component.
- `client/src/pages/ExportPage.tsx` — PDF mutation now downloads a real PDF blob file (triggers browser download) instead of displaying an in-page HTML preview. Removed the old printable HTML preview section. Updated button text to "Generate & Download PDF" with success indicator.
- `package.json` — Added `pdfkit` (v0.17.2) to dependencies and `@types/pdfkit` to devDependencies.

### Key Design Decisions
- PDF generation uses built-in Helvetica/Courier fonts (no external font files needed)
- Line items are grouped by category for the estimate summary section
- Photo annotations stored as JSON shapes in the existing `annotations` jsonb column (no schema migration needed)
- The annotated canvas image (base64) is sent to the backend but only shapes are persisted for now
- `storage.updatePhoto()` method (from PROMPT-05) handles annotation persistence

### Build Status
- TypeScript compilation: Clean (no new errors introduced)
- Production build: Successful