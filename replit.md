# Claims IQ Voice Inspector

## Overview
Claims IQ Voice Inspector is an AI-powered voice-driven field inspection assistant for insurance adjusters. It automates document analysis, guides inspections via real-time voice AI, and generates Xactimate-compatible reports (ESX, PDF, Photo Reports) to streamline the insurance claims process. The platform covers document upload and AI parsing, pre-inspection briefing, voice-guided field inspection with real-time sketching and scoping, photo capture with GPT-4o Vision damage analysis, weather correlation for fraud detection, ACV/RCV settlement calculations, and multi-format export.

## User Preferences
- Professional insurance app styling with purple and gold color scheme
- Clean, minimal aesthetic
- Database must be Supabase only — never use local Replit PostgreSQL
- Never use execute_sql_tool for Supabase operations
- All schema changes via psql with SUPABASE_DATABASE_URL
- Use user's own `OPENAI_API_KEY` — not Replit AI Integrations key
- pdf-parse must stay at v1.1.1 (v2 has incompatible API)
- Claims must remain "in progress" until user explicitly marks them complete — no auto-completion on finishing inspection or voice agent complete_inspection tool
- Property sketches must look like real architectural drawings (floor plans, elevations, roof plans) — not abstract boxes
- Voice password for skip_step is "123" (spoken as "one-two-three")
- Microphone gating disabled (ENABLE_MIC_GATING = false) to prevent AI treating pauses as new sessions

## System Architecture

### Core Design Principles
- **Voice-first**: The inspection is designed to be driven entirely by voice, with the UI providing visual feedback and manual fallbacks.
- **Tool-gated phases**: Each workflow phase restricts available AI tools to prevent premature actions.
- **Xactimate compatibility**: Settlement calculations, ESX export format, and line item structure all match Xactimate's order of operations and data format.
- **Dual Authentication**: Supports local JWT for speed and Supabase Auth for social/managed flows, unified by a single middleware.
- **BFS Layout Engine**: Room positioning uses a graph-based layout rather than manual coordinate placement, enabling AI to create sketches via voice without absolute coordinates.
- **Photo Analysis Bridge**: Normalizes GPT-4o Vision output to standardized damage types for consistent scoping.
- **PWA**: Utilizes Vite PWA plugin with Workbox for offline capabilities.

### Frontend
- **Frameworks**: React 19, Vite 7, TypeScript
- **Styling**: Tailwind CSS v4, shadcn/ui
- **State Management**: TanStack React Query, wouter for routing, Framer Motion for animations.
- **Sketching**: SVG-based architectural sketch renderer (`PropertySketch.tsx`, `SketchRenderer.tsx`, `SketchEditor.tsx`).
- **Media**: Client-side PDF viewing (pdfjs-dist), photo annotation.
- **Components**: Modular components for UI elements, galleries, editors, and indicators.

### Backend
- **Framework**: Express 5 on Node.js
- **Database ORM**: Drizzle ORM with postgres.js driver for Supabase PostgreSQL.
- **Authentication**: Local JWT and Supabase authentication middleware, role-based and resource-based authorization.
- **Workflow Orchestration**: State machine to manage inspection phases and tool gating.
- **AI Integration**: Dedicated services for OpenAI API calls (extraction, briefing, analysis), and Realtime API session management.
- **Core Engines**:
    - `estimateEngine.ts`: Manages settlement calculations (RCV, ACV, Depreciation).
    - `depreciationEngine.ts`: Handles depreciation based on life expectancy tables and water damage overrides.
    - `esxGenerator.ts`, `pdfGenerator.ts`, `photoReportGenerator.ts`: Modules for generating various report formats.
    - `weatherService.ts`: Integrates weather data for correlation and fraud detection.

### Data Model (High-Level)
- **User Management**: `users`, `user_settings`.
- **Claims & Documents**: `claims`, `documents`, `extractions`, `briefings`.
- **Inspection Engine**: `inspection_sessions`, `inspection_flows`.
- **Structural Hierarchy**: `structures` (e.g., Main Dwelling), `inspection_rooms` (rooms, roof facets, elevations), `room_openings`, `sketch_annotations`.
- **Observations & Estimating**: `damage_observations`, `line_items`, `scope_line_items`, `scope_items`, `policy_rules`.
- **Media & Support**: `inspection_photos`, `standalone_photos`, `voice_transcripts`, `inspection_session_events`, `moisture_readings`, `room_adjacencies`.

### Voice Inspection System
- **Architecture**: Browser (WebRTC) connects to OpenAI Realtime API, which communicates with the Express server via HTTP API calls.
- **Agent Philosophy**: Tool-first approach, unit conversion, standard defaults for missing dimensions, and phase-restricted tool availability.
- **Tools**: Categorized for Sketching, Damage & Scoping, Forensics, Photos, and Navigation, with global tools available across phases.
- **Workflow Gates**: Validators (`exportGate`, `photoDamageGate`, `scopeGate`, `sketchGate`) ensure completeness before phase transitions.

## External Dependencies

- **Database**: Supabase PostgreSQL
- **File Storage**: Supabase Storage (`documents`, `inspection-photos`, `avatars` buckets)
- **AI Services**:
    - OpenAI GPT-4.1 (Text: document parsing, briefing generation, photo analysis)
    - OpenAI Realtime API (`gpt-4o-realtime-preview`) via WebRTC (Voice)
    - OpenAI GPT-4o Vision (Vision: photo damage detection, address verification, bounding boxes)
- **Weather Data**: Visual Crossing Timeline API
- **PDF Processing**:
    - `pdf-parse` (v1.1.1) for PDF text extraction.
    - PDFKit for PDF generation.
- **Document Generation**: `docx` library for Word document generation.
- **Archive Utilities**: `archiver` for ZIP/ESX file creation.
- **Charting**: Recharts