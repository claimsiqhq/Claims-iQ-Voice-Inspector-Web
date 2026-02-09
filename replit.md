# Claims IQ Voice Inspector

## Overview
Claims IQ Voice Inspector is an AI-powered voice-driven field inspection assistant for insurance adjusters. Its primary purpose is to streamline the insurance claims process by automating document analysis, guiding inspections via real-time voice AI, and facilitating report generation. This project aims to enhance accuracy, reduce manual effort, and accelerate claim processing for insurance companies and adjusters. Key capabilities include AI-powered document parsing, guided voice inspections, multi-structure inspection support, AI-enhanced photo capture and damage annotation, moisture reading logging, architectural property sketches, and comprehensive review-and-export functionalities (ESX/Xactimate, PDF, Photo Reports).

## User Preferences
- Professional insurance app styling
- Clean, minimal aesthetic
- Database must be Supabase only — never use local Replit PostgreSQL
- Never use execute_sql_tool for Supabase operations
- All schema changes via psql with SUPABASE_DATABASE_URL
- Use user's own `OPENAI_API_KEY` — not Replit AI Integrations key
- pdf-parse must stay at v1.1.1 (v2 has incompatible API)
- Claims must remain "in progress" until user explicitly marks them complete — no auto-completion on finishing inspection or voice agent complete_inspection tool
- Property sketches must look like real architectural drawings (floor plans, elevations, roof plans) — not abstract boxes
- Voice password for skip_step is "123" (spoken as "one-two-three")

## System Architecture

### Tech Stack
- **Frontend:** React 19, Vite 7, TypeScript, Tailwind CSS v4, shadcn/ui, wouter, TanStack React Query, Framer Motion
- **Backend:** Express 5
- **Database:** Drizzle ORM with Supabase PostgreSQL (postgres.js driver)
- **File Storage:** Supabase Storage (buckets: `claim-documents`, `inspection-photos`)
- **AI:** OpenAI GPT-4.1 (document parsing, briefing, photo analysis, max 32k tokens), OpenAI Realtime API (voice inspection via WebRTC)
- **Voice:** Browser WebRTC → OpenAI Realtime API (`gpt-4o-realtime-preview`), with server-side ephemeral token creation
- **PWA:** Vite PWA plugin with Workbox
- **Document Generation:** PDFKit, docx, archiver

### Core Features
- **Claims Management:** Creation, assignment, and status tracking of claims with user-explicit completion.
- **Document Processing:** AI-powered parsing of claim documents with batch support and confidence scoring.
- **Inspection Briefing:** AI-generated briefings for property details, coverage, and checklists.
- **Active Voice Inspection:** Real-time voice-guided inspections using OpenAI Realtime API with WebRTC, supporting 18 AI tools including `add_damage`, `trigger_photo_capture`, `add_line_item`, `create_structure`, `create_room`, `create_sub_area`, `add_opening`, `add_sketch_annotation`, and more.
- **5-Level Hierarchy System:** L1 Structures → L2 Rooms/Areas → L3 Sub-Areas/Attachments → L4 Openings/Deductions → L5 Annotations. This hierarchy drives both the sketch rendering and Xactimate-compatible estimates.
- **Wall Openings & Deductions:** Full CRUD for doors, windows, pass-throughs, missing walls, overhead doors, archways, and cased openings. Each opening deducts area from wall SF calculations and generates MISS_WALL entries in ESX export. The `add_opening` voice tool supports `openingType`, `wallDirection`, `widthFt`, `heightFt`, `quantity`, `opensInto`, `goesToFloor`, `goesToCeiling`, and `notes`. Session-level and room-level REST endpoints available. `calculateNetWallArea()` provides gross/net wall SF, ceiling SF, floor SF, perimeter LF, and long/short wall SF.
- **Peril-Specific Investigation Protocols:** Structured forensic workflows replace basic peril awareness. Hail claims follow a 5-step protocol (ground collateral scan → test square → distinguish pre-existing → roof accessories sweep → elevation walk). Wind claims follow a 5-step protocol (perimeter scan → uplift assessment → adhesion check → directional pattern → elevation walk). Water claims follow a 5-step protocol (entry point ID → trace water path → room-by-room with openings → moisture mapping → tearout height). Each protocol includes mandatory steps, prompts, photo requirements, and tool integration.
- **Property Sketch (PropertySketch):** SVG architectural sketches with four rendering modes:
  - **Interior:** Floor plan with connected rooms, outer walls, dimension labels, opening markers, sub-area attachments
  - **Roof Plan:** Plan view with ridge line, hip/valley dashes, facet labels, pitch annotations, hail count markers
  - **Elevations:** Side views with wall profile, gable/hip roof shape, ground line, window/door openings
  - **Other Exterior:** Grid of exterior items (gutters, porches, decks, fencing)
- **Review & Finalize:** Multi-tab review for estimate details, photos, completeness (AI scope gap detection), notes, and expanded sketches.
- **Export:** ESX/Xactimate XML, configurable PDF reports, Xactimate-style Photo Reports (PDF and Word), and "Submit for Review" workflow.
- **Supplemental Claims:** Management of supplemental line items with provenance tracking and delta ESX export.
- **Photo Reports:** Xactimate-style Photo Sheets with embedded photos, metadata, and AI analysis captions.
- **User Profile Management:** Profile page (/profile) with avatar photo upload (Supabase Storage, signed URLs), name/title editing. Header shows actual user data (name, title, avatar) and links to profile page.
- **Photo Capture & Analysis:** Camera overlay triggered by voice agent, photo saved to Supabase Storage, then sent to GPT-4o Vision for AI analysis (damage detection, quality scoring, label matching).
- **ACV/RCV Settlement Engine:** Full Xactimate-accurate financial calculation pipeline: RCV → O&P (per-trade, 3+ trade threshold) → Tax → Per-item Depreciation (age/life formula) → ACV → Deductible → Net Claim. Features include:
  - Per-item depreciation tracking with age, life expectancy, and computed depreciation percentage
  - Coverage bucket separation (Coverage A/B/C) with auto-derivation from structure names
  - Per-coverage deductible application and policy limit enforcement
  - Roof Payment Schedule support (forces Non-Recoverable depreciation on roofing items)
  - Recoverable vs Non-Recoverable vs Paid When Incurred depreciation types
  - `calculateSettlement()` engine with backward-compatible `calculateEstimateTotalsV2()` wrapper
  - Policy rules auto-seeded from briefing coverage data on inspection start
  - Voice agent captures item age and life expectancy for major items (roofing, siding, HVAC, flooring)
  - PDF reports show full settlement breakdown: O&P, recoverable/non-recoverable depreciation split, deductible, net claim

### Data Model
The system uses 18 PostgreSQL tables in Supabase:

| Table | Purpose |
|-------|---------|
| `users` | User accounts synced from Supabase Auth |
| `claims` | Insurance claim records |
| `briefings` | AI-generated inspection briefings per claim |
| `inspection_sessions` | Active inspection sessions linking to claims |
| `structures` | L1 hierarchy — physical structures (Main Dwelling, Garage, etc.) |
| `inspection_rooms` | L2 hierarchy — rooms/areas within structures, with viewType/shapeType |
| `room_openings` | L4 hierarchy — doors, windows, overhead doors, pass-throughs, missing walls, archways, cased openings. Includes sessionId, wallDirection, quantity, goesToFloor/Ceiling, notes. Generates MISS_WALL in ESX export and deducts from wall SF. |
| `sketch_annotations` | L5 hierarchy — metadata overlays (hail counts, pitch, notes) |
| `sketch_templates` | Reusable sketch templates |
| `damage_observations` | Damage records per room |
| `line_items` | Xactimate-compatible estimate line items with per-item depreciation (age, lifeExpectancy, depreciationPct, depreciationAmount, taxAmount, coverageBucket) |
| `inspection_photos` | Photos with AI analysis and Supabase storage paths |
| `moisture_readings` | Moisture meter readings |
| `voice_transcripts` | Voice session transcripts |
| `supplemental_claims` | Supplemental claim tracking |
| `scope_line_items` | Scope-level line items for supplements |
| `regional_price_sets` | Xactimate pricing catalog data |
| `user_settings` | Per-user preferences (voice model, VAD sensitivity, verbosity) |
| `policy_rules` | Per-claim coverage rules (Coverage A/B/C/D) with policy limits, deductibles, O&P rates, tax rates, and roof schedule settings |
| `inspection_flows` | Dynamic peril-specific inspection workflows |

### Key Relationships
- `structures` has unique constraint on `(sessionId, name)` — prevents duplicate structures
- `inspection_rooms.structureId` → `structures.id` (L1→L2 relationship)
- `inspection_rooms.parentRoomId` → `inspection_rooms.id` (L2→L3 sub-area relationship)
- `room_openings.roomId` → `inspection_rooms.id` (L2→L4 openings)
- `room_openings.sessionId` → `inspection_sessions.id` (enables session-level opening queries)
- `sketch_annotations.roomId` → `inspection_rooms.id` (L2→L5 annotations)
- Elevation rooms are deduplicated: server returns existing room if duplicate viewType+structure detected
- `policy_rules.claimId` → `claims.id` (per-claim coverage configuration)
- `line_items.coverageBucket` routes items to coverage buckets (Coverage A/B/C) for settlement calculation

### Settlement Engine
The settlement calculation pipeline follows Xactimate order of operations:
1. **Group by trade** — Items grouped by trade code (RFG, DRY, PNT, etc.)
2. **O&P calculation** — 10% overhead + 10% profit per trade when 3+ trades involved
3. **Tax** — Applied per coverage bucket's tax rate (default 8%)
4. **Per-item RCV** — totalPrice + O&P share + tax
5. **Depreciation** — age/lifeExpectancy formula or manual override, capped at 100%
6. **ACV** — RCV minus depreciation (Paid When Incurred items held at $0 ACV)
7. **Coverage grouping** — Items split by Coverage A/B/C
8. **Deductible** — Per-coverage deductible subtracted from ACV
9. **Policy limits** — Net claim capped at policy limit per coverage
10. **Grand totals** — Sum across all coverages = check amount

Key functions in `server/estimateEngine.ts`:
- `calculateSettlement()` — Full settlement from line items + policy rules → SettlementSummary
- `calculateItemDepreciation()` — Per-item depreciation with roof schedule override
- `deriveCoverageBucket()` — Auto-derives Coverage A/B/C from structure name
- `calculateEstimateTotalsV2()` — Backward-compatible wrapper producing old EstimateTotals + settlement

Policy rule API endpoints:
- `POST /api/claims/:claimId/policy-rules` — Create coverage rule
- `GET /api/claims/:claimId/policy-rules` — List rules for claim
- `PATCH /api/claims/:claimId/policy-rules/:ruleId` — Update rule

### Voice Agent Configuration
- **Model:** `gpt-4o-realtime-preview` via WebRTC
- **Voice:** Configurable per user (default: alloy)
- **VAD:** Server-side voice activity detection with three sensitivity levels (low/medium/high)
- **Push-to-Talk:** Optional mode that disables VAD
- **Verbosity:** Concise, balanced, or detailed modes
- **Transcription:** Whisper-1 with English language setting

### Security Architecture
- **Authentication:** Supabase JWT tokens with cryptographic validation
- **Authorization:** Role-based access control
- **Rate Limiting:** Three-tiered rate limiting for general, auth, and AI API endpoints
- **Error Handling:** Generic 500 error messages with server-side logging

### UI/UX and Design System
Professional insurance app aesthetic with a primary purple and gold color scheme, Work Sans and Source Sans 3 fonts. Responsive design with mobile-specific UI elements. Features error boundaries, React Query configuration for data fetching, and an onboarding wizard.

### Key Files
- `server/realtime.ts` — System instructions (with peril-specific investigation protocols), 18 voice tool definitions
- `client/src/pages/ActiveInspection.tsx` — Voice connection, tool execution (including add_opening handler with deduction feedback), camera capture
- `client/src/components/PropertySketch.tsx` — SVG architectural sketch rendering
- `client/src/components/XactimateEstimateView.tsx` — Xactimate-format estimate display
- `client/src/components/ProgressMap.tsx` — Inspection progress visualization
- `client/src/pages/ReviewFinalize.tsx` — Post-inspection review and export
- `server/routes.ts` — All API endpoints including realtime session creation, session-level opening endpoints
- `server/storage.ts` — Database operations, IStorage interface, hierarchy queries, opening CRUD
- `server/estimateEngine.ts` — Pricing engine, settlement calculator (calculateSettlement, calculateItemDepreciation, deriveCoverageBucket), calculateNetWallArea(), companion item suggestions
- `server/esxGenerator.ts` — ESX/Xactimate export with MISS_WALL elements and deduction-adjusted WALL_SF
- `shared/schema.ts` — Drizzle ORM table definitions and types

## External Dependencies
- **Supabase:** PostgreSQL database and file storage (`claim-documents`, `inspection-photos` buckets)
- **OpenAI API:** GPT-4o for AI analysis and Realtime API (`gpt-4o-realtime-preview`) for voice interactions via WebRTC
- **pdf-parse:** Version 1.1.1 for backend PDF text extraction
- **PDFKit:** PDF report generation
- **docx:** Word document (.docx) generation for photo reports
- **archiver:** ZIP file creation for exports
- **Drizzle ORM:** Database schema management and querying
- **Framer Motion:** UI animations
- **Vite PWA:** Progressive Web App features
- **express-rate-limit:** API rate limiting
- **recharts:** Dashboard charts
- **pdfjs-dist:** Client-side PDF viewing
