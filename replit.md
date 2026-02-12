# Claims IQ Voice Inspector

## Overview
Claims IQ Voice Inspector is an AI-powered voice-driven field inspection assistant for insurance adjusters. It automates document analysis, guides inspections via real-time voice AI, and facilitates report generation to streamline the insurance claims process. Key capabilities include AI-powered document parsing, guided voice inspections, multi-structure support, AI-enhanced photo capture and damage annotation, moisture reading logging, architectural property sketches, and comprehensive review-and-export functionalities (ESX/Xactimate, PDF, Photo Reports). The project aims to enhance accuracy, reduce manual effort, and accelerate claim processing.

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
- **File Storage:** Supabase Storage
- **AI:** OpenAI GPT-4.1 (document parsing, briefing, photo analysis), OpenAI Realtime API (voice inspection via WebRTC)
- **Voice:** Browser WebRTC → OpenAI Realtime API (`gpt-4o-realtime-preview`)
- **PWA:** Vite PWA plugin with Workbox
- **Document Generation:** PDFKit, docx, archiver

### Core Features
- **Claims Management:** Creation, assignment, and status tracking.
- **Document Processing:** AI-powered parsing of claim documents with batch support.
- **Inspection Briefing:** AI-generated briefings for property details, coverage, and checklists.
- **Active Voice Inspection:** Real-time voice-guided inspections using OpenAI Realtime API with WebRTC, supporting 18 AI tools (e.g., `add_damage`, `trigger_photo_capture`, `add_line_item`, `create_structure`, `create_room`, `add_opening`).
- **5-Level Hierarchy System:** Structures → Rooms/Areas → Sub-Areas/Attachments → Openings/Deductions → Annotations, driving sketch rendering and Xactimate-compatible estimates.
- **Wall Openings & Deductions:** CRUD for various opening types, deducting area from wall SF calculations and generating `MISS_WALL` entries in ESX export.
- **Peril-Specific Investigation Protocols:** Structured forensic workflows for Hail, Wind, and Water claims, including mandatory steps, prompts, and photo requirements.
- **Property Sketch (PropertySketch):** SVG architectural sketches with Interior (floor plan), Roof Plan, Elevations, and Other Exterior rendering modes.
- **Review & Finalize:** Multi-tab review for estimate details, photos, completeness, notes, and expanded sketches.
- **Export:** ESX/Xactimate XML, configurable PDF reports, Xactimate-style Photo Reports (PDF and Word).
- **Supplemental Claims:** Management of supplemental line items with provenance tracking and delta ESX export.
- **Photo Capture & Analysis:** Camera overlay with photos saved to Supabase Storage and analyzed by GPT-4o Vision for damage detection, quality scoring, and label matching.
- **Photo Lab:** Standalone photo upload/capture with GPT-4o Vision damage analysis, including bounding box annotations.
- **ACV/RCV Settlement Engine:** Full Xactimate-accurate financial calculation pipeline, including O&P, Tax, per-item Depreciation, ACV, Deductible, and policy limit enforcement. Supports per-item depreciation tracking, coverage bucket separation, and roof payment schedules.
- **User Profile Management:** Profile page with avatar, name/title editing.
- **Security:** Supabase JWT authentication, role-based authorization, three-tiered rate limiting, generic 500 error handling.
- **UI/UX:** Professional insurance app aesthetic with a purple and gold color scheme, responsive design, error boundaries, React Query, and an onboarding wizard.

### Data Model
The system uses 19 PostgreSQL tables in Supabase for user accounts, claims, briefings, inspection sessions, a 5-level structural hierarchy (structures, rooms, room openings, sketch annotations), damage observations, line items, inspection photos, moisture readings, voice transcripts, supplemental claims, regional price sets, room adjacencies, user settings, policy rules, and inspection flows.

### Key Relationships
Hierarchical relationships (`structures` to `inspection_rooms` to `room_openings` and `sketch_annotations`). `room_openings` are linked to `inspection_sessions` and `inspection_rooms`. `policy_rules` are linked to `claims`, and `line_items` are associated with `coverageBucket` for settlement calculations.

### Settlement Engine
The settlement engine follows Xactimate order of operations: grouping by trade, O&P calculation, tax application, per-item RCV, depreciation calculation (age/life expectancy), ACV, coverage grouping, deductible subtraction, and policy limit enforcement. Key functions handle full settlement, item depreciation, coverage bucket derivation, and net wall area calculation. Policy rule API endpoints exist for CRUD operations.

### Voice Agent Configuration
Uses `gpt-4o-realtime-preview` via WebRTC with configurable voice, server-side VAD, optional push-to-talk, and adjustable verbosity. Transcription is handled by Whisper-1.

## External Dependencies
- **Supabase:** PostgreSQL database and file storage
- **OpenAI API:** GPT-4o for AI analysis, `gpt-4o-realtime-preview` for voice interactions
- **pdf-parse:** v1.1.1 for backend PDF text extraction
- **PDFKit:** PDF report generation
- **docx:** Word document generation
- **archiver:** ZIP file creation
- **Drizzle ORM:** Database schema management
- **Framer Motion:** UI animations
- **Vite PWA:** Progressive Web App features
- **express-rate-limit:** API rate limiting
- **recharts:** Dashboard charts
- **pdfjs-dist:** Client-side PDF viewing