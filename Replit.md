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

### Frontend Routes
The application features a 7-screen workflow:
- `/`: Claims List
- `/upload/:id`: Document Upload
- `/review/:id`: Extraction Review
- `/briefing/:id`: Inspection Briefing
- `/inspection/:id`: Active Voice Inspection
- `/inspection/:id/review`: Review & Finalize
- `/inspection/:id/export`: Export

### Core Features
- **Claims Management:** Creation and status tracking of claims (draft to exported).
- **Document Processing:** Upload and AI-powered parsing of FNOLs, policies, and endorsements with batch support.
- **AI Confidence Scoring:** Visual indicators for AI extraction confidence (high/medium/low).
- **Inspection Briefing:** AI-generated briefings covering property, coverage, peril, and inspection checklists.
- **Active Voice Inspection:** A three-panel interface for voice-guided inspections using OpenAI Realtime API, featuring floor plans, real-time transcription, and a photo gallery. Voice AI tools facilitate actions like setting context, creating rooms, adding damages, capturing photos, and logging moisture readings.
- **Multi-Structure Inspections:** Support for detailed exterior inspections of multiple structures, including roof slopes and elevations, aligned with Xactimate patterns.
- **Review & Finalize:** A comprehensive review stage with tabs for estimate details, photos, completeness checks with AI scope gap detection, and notes.
- **Export:** Options for ESX/Xactimate XML, PDF report generation, and a "Submit for Review" workflow.

### Data Model
The system uses 12 PostgreSQL tables in Supabase, structured around core claim data, document processing, and detailed inspection sessions, rooms, damages, line items, photos, and moisture readings.

### API Endpoints
Approximately 40 RESTful endpoints manage the workflow, grouped into Document Flow, Inspection, and Review/Export phases.

### UI/UX and Design System
The UI/UX emphasizes a professional insurance app aesthetic using Primary Purple, Deep Purple, and Gold color schemes, Work Sans and Source Sans 3 fonts. Responsive design is implemented using a `useIsMobile` hook, adapting layouts for mobile devices with sheet drawers, icon-only navigation, and scaled elements. Visual indicators are used for voice states (listening, speaking, processing, error, disconnected).

### Error Recovery
The system includes mechanisms for voice disconnection auto-reconnect, error state auto-clearing, export validation, photo upload failure guards, and filename sanitization.

## External Dependencies
- **Supabase:** Used for PostgreSQL database and file storage (`claim-documents`, `inspection-photos` buckets).
- **OpenAI API:** Utilized for GPT-4o capabilities (document parsing, briefing, photo analysis) and the Realtime API for voice interactions (`gpt-4o-realtime-preview`).
- **pdf-parse:** Version 1.1.1 is used on the backend for PDF text extraction.
- **Drizzle ORM:** Employed for database schema management and querying.
- **Framer Motion:** Used for UI animations and transitions.
- **Vite PWA:** Provides Progressive Web App features, including offline caching.