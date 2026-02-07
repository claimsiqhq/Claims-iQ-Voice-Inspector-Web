# Claims IQ Voice Inspector

## Overview
Voice-driven field inspection assistant for insurance adjusters. Supports document upload, AI-powered document parsing (FNOL, Policy, Endorsements), extraction review, inspection briefing generation, and voice-guided active inspections.

## Recent Changes
- **Feb 7, 2026**: Migrated data layer to Supabase — database now hosted on Supabase PostgreSQL (via SUPABASE_DATABASE_URL), file storage uses Supabase Storage bucket `claim-documents`. Removed multer, switched to base64 JSON uploads. DB driver changed from @neondatabase/serverless to postgres.js.
- **Feb 7, 2026**: Implemented Act 1 backend - database schema, storage layer, OpenAI document parsing (FNOL/Policy/Endorsements), briefing generation, full REST API, and wired all frontend pages to real API endpoints.

## Architecture

### Tech Stack
- **Frontend:** React 19, Vite 7, TypeScript, Tailwind CSS v4, shadcn/ui, wouter routing, TanStack React Query, Framer Motion
- **Backend:** Express 5, pdf-parse (PDF text extraction), @supabase/supabase-js (Storage)
- **Database:** Drizzle ORM + Supabase PostgreSQL (via postgres.js driver)
- **File Storage:** Supabase Storage bucket `claim-documents` (private, PDF only)
- **AI:** OpenAI GPT-4o via Replit AI Integrations (env vars: AI_INTEGRATIONS_OPENAI_API_KEY, AI_INTEGRATIONS_OPENAI_BASE_URL)

### Environment Variables
- `SUPABASE_DATABASE_URL` - Supabase PostgreSQL connection string (preferred over DATABASE_URL)
- `SUPABASE_URL` - Supabase project URL (https://xxx.supabase.co)
- `SUPABASE_SERVICE_ROLE_KEY` - Server-side Supabase key (bypasses RLS)
- `SUPABASE_ANON_KEY` - Public Supabase key

### Key Files
- `shared/schema.ts` - Database schema (claims, documents, extractions, briefings)
- `server/db.ts` - Database connection (postgres.js + Drizzle)
- `server/supabase.ts` - Supabase client for Storage operations
- `server/storage.ts` - DatabaseStorage class (Drizzle CRUD)
- `server/openai.ts` - OpenAI extraction & briefing generation functions
- `server/routes.ts` - REST API endpoints
- `client/src/pages/` - 5 main screens (ClaimsList, DocumentUpload, ExtractionReview, InspectionBriefing, ActiveInspection)

### API Endpoints
- `GET/POST /api/claims` - List/create claims
- `GET/PATCH /api/claims/:id` - Get/update claim
- `POST /api/claims/:id/documents/upload` - Upload PDF (base64 JSON body)
- `POST /api/claims/:id/documents/:type/parse` - Parse document with AI
- `GET /api/claims/:id/extractions` - Get all extractions
- `PUT /api/claims/:id/extractions/:type` - Update extraction
- `POST /api/claims/:id/extractions/confirm-all` - Confirm all extractions
- `POST /api/claims/:id/briefing/generate` - Generate inspection briefing
- `GET /api/claims/:id/briefing` - Get briefing

### Design System
- Primary: #342A4F (purple), Secondary: #C6A54E (gold)
- Fonts: Work Sans (display), Source Sans 3 (body), Space Mono (mono)

## User Preferences
- Professional insurance app styling
- Clean, minimal aesthetic
