# Claims IQ Voice Inspector

## Overview
Claims IQ Voice Inspector is a voice-driven field inspection assistant designed for insurance adjusters. Its primary purpose is to streamline the insurance claims process by providing AI-powered tools for document analysis, inspection guidance, and report generation. The project aims to reduce manual effort, improve accuracy, and accelerate claim processing for insurance companies and adjusters. Key capabilities include document upload and AI parsing (FNOL, Policy, Endorsements), extraction review, inspection briefing generation, voice-guided active inspections using OpenAI's Realtime API, and a comprehensive review-and-finalize workflow with export options (ESX, PDF, Submit for Review).

## User Preferences
- Professional insurance app styling
- Clean, minimal aesthetic
- Database must be Supabase only — never use local Replit PostgreSQL
- Never use execute_sql_tool for Supabase operations
- All schema changes via psql with SUPABASE_DATABASE_URL
- Use user's own `OPENAI_API_KEY` — not Replit AI Integrations key

## System Architecture

### Tech Stack
- **Frontend:** React 19, Vite 7, TypeScript, Tailwind CSS v4, shadcn/ui, wouter, TanStack React Query, Framer Motion
- **Backend:** Express 5, pdf-parse, @supabase/supabase-js
- **Database:** Drizzle ORM with Supabase PostgreSQL (postgres.js driver)
- **File Storage:** Supabase Storage (claim-documents, inspection-photos buckets)
- **AI:** OpenAI GPT-4o for document parsing and briefing; OpenAI Realtime API for voice inspection via WebRTC
- **Voice:** Browser WebRTC PeerConnection + DataChannel for OpenAI Realtime API integration.

### Core Features
The application supports a comprehensive workflow:
1.  **Claims Management:** List and create claims.
2.  **Document Processing:** Upload and AI-parse FNOL, Policy, and Endorsement PDFs (with batch endorsement support). Review and confirm extracted data.
3.  **AI Confidence Scoring:** Each extracted data point displays a visual confidence indicator with color-coded shield icon (green/amber/red), animated progress bar, and percentage. Overall confidence summary aggregates field-level scores per document tab. Tooltips explain each level on hover. Components: `ConfidenceScore` (per-field), `OverallConfidenceSummary` (per-tab header).
4.  **Inspection Briefing:** AI-generated briefings based on parsed documents.
5.  **Active Voice Inspection:** Live voice-guided inspections using OpenAI Realtime API, enabling creation of rooms, damages, line items, photo capture, and moisture readings. Features a three-panel layout (sidebars convert to slide-out Sheet drawers on mobile) and robust voice indicator with various states.
6.  **Review & Finalize:** A dedicated page (Screen 7) with four tabs:
    *   **Estimate:** Collapsible hierarchy with inline editing.
    *   **Photos:** Gallery grouped by room with filters.
    *   **Completeness:** Circular score with AI scope gap detection.
    *   **Notes:** Adjuster notes and voice transcript viewer. Includes a slide-over `ProgressMap` for navigation and status overview, and a `MoistureMap` for SVG-based moisture reading visualization, IICRC classification, and drying equipment calculation.
7.  **Export:** Supports ESX/Xactimate export, PDF report generation, and a "Submit for Review" workflow with status tracking.

### Data Model
The system uses 12 PostgreSQL tables in Supabase, structured into two main acts:
-   **Act 1 (Core):** `users`, `claims`, `documents`, `extractions`, `briefings`
-   **Act 2 (Inspection):** `inspection_sessions`, `inspection_rooms`, `damage_observations`, `line_items`, `inspection_photos`, `moisture_readings`, `voice_transcripts`

### API Design
A RESTful API supports all application functionalities, covering Act 1 (document flow), Act 2 (inspection), and Act 3 (review/export), including endpoints for OpenAI Realtime session management.

### UI/UX and Design System
-   **Colors:** Primary Purple (`#7763B7`), Deep Purple (`#342A4F`), Gold (`#C6A54E`), Secondary Purple (`#9D8BBF`).
-   **Fonts:** Work Sans (headings), Source Sans 3 (body), Space Mono (monospace).
-   **Radius:** 0.5rem default.
-   **Voice States:** Visual indicators for listening (Purple), speaking (Gold), processing (Secondary Purple), error (Gold warning), and disconnected (Red).

### Error Recovery
The system includes mechanisms for voice disconnection auto-reconnect, manual reconnect options, error state auto-clearing, and export validation to prevent incomplete exports.

## Recent Changes
- **2026-02-07:** Photo Gallery component with grid/list views, type filters (overview, damage, test square, etc.), full-screen viewer with prev/next navigation, and detailed AI analysis annotations (description, damage tags, quality stars, match/mismatch indicators). Replaces old simple photo list in ActiveInspection right panel.
- **2026-02-07:** FloorPlanSketch now groups rooms by structure (Main Dwelling, Detached Garage, etc.) with separate Interior/Exterior sections per structure. Exterior rooms show type icons (triangle for roof slopes, square variants for elevations). Photo count badges on room rectangles.
- **2026-02-07:** Voice AI prompt expanded for multi-structure exterior inspections: walks through each structure's roof slopes, four elevations, gutters, and other areas. create_room tool now has specific roomType enums for exterior areas (exterior_roof_slope, exterior_elevation_front/left/right/rear, exterior_gutter, etc.). Completeness check updated for hail+wind claims to verify elevation and roof slope documentation.
- **2026-02-07:** Photo upload filename sanitization — strips special characters (em dashes, non-ASCII) before Supabase Storage upload. Upload failure guard prevents analysis with undefined photoId. Analyze endpoint validates photoId.
- **2026-02-07:** Added AI Confidence Score visualization — per-field `ConfidenceScore` component with shield icon, animated bar, and percentage; `OverallConfidenceSummary` aggregating field scores per document tab header; keyboard-accessible tooltips explaining each level.
- **2026-02-07:** Comprehensive mobile optimization across all screens — ActiveInspection sidebars convert to Sheet drawers on mobile, Layout header scales down, ReviewFinalize uses icon-only tabs and stacked buttons, ClaimsList/DocumentUpload/ExtractionReview/InspectionBriefing/ExportPage all have responsive text, spacing, and layout adjustments using `md:` Tailwind breakpoints.
- **2026-02-07:** Batch endorsement upload with pipe-separated storage paths and combined text extraction. Fixed parse route to only split storagePath for endorsements.
- **2026-02-07:** Expanded FNOL, Policy, and Endorsement extraction prompts to capture comprehensive claim data from real sample documents.

## External Dependencies
-   **Supabase:** PostgreSQL database and Storage buckets (`claim-documents`, `inspection-photos`).
-   **OpenAI API:** GPT-4o for document parsing, briefing generation, and Realtime API for voice interactions (`gpt-4o-realtime-preview`).
-   **pdf-parse:** For extracting text from PDF documents on the backend.