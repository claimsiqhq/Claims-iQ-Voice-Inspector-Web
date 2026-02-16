# Claims IQ Voice Inspector — PROMPT 02: Wire Up Act 1 Backend (Supabase)

## Current State of the Codebase

The frontend UI is fully built from the UX Design Spec. All pages and components exist. What's missing is the backend logic — the database schema, API routes, OpenAI integration, and wiring the existing UI to real data.

**This prompt uses Supabase as the backend platform.** Drizzle ORM handles typed database queries against Supabase's PostgreSQL. Supabase Storage handles PDF file uploads. The Express 5 server remains the API layer.

### Existing Tech Stack (DO NOT CHANGE)
- **Frontend:** React 19, Vite 7, TypeScript, Tailwind CSS v4, shadcn/ui (full Radix), wouter routing, TanStack React Query, Framer Motion, Recharts
- **Backend:** Express 5, WebSocket (ws)
- **Database ORM:** Drizzle ORM (keep — it provides type safety)
- **Package manager:** npm

### Adding to the Stack
- **Database host:** Supabase PostgreSQL (replaces Replit's built-in PostgreSQL)
- **File storage:** Supabase Storage (replaces local disk)
- **Supabase client:** `@supabase/supabase-js` (for Storage operations only)

### Existing File Structure
```
client/
  src/
    pages/
      ClaimsList.tsx          ← Screen 1 (built)
      DocumentUpload.tsx      ← Screen 2 (built)
      ExtractionReview.tsx    ← Screen 3 (built)
      InspectionBriefing.tsx  ← Screen 4 (built)
      ActiveInspection.tsx    ← Screen 5 (built)
      not-found.tsx
    components/
      Layout.tsx              ← Nav + layout shell (built)
      ClaimCard.tsx           ← Claim card component (built)
      VoiceIndicator.tsx      ← Voice state indicator (built)
      StatusBadge.tsx         ← Status badges (built)
      ui/                     ← shadcn/ui components
    hooks/
      use-mobile.tsx
      use-toast.ts
    lib/
      queryClient.ts
      utils.ts
    App.tsx                   ← Routing (built)
    index.css                 ← Claims IQ brand tokens (built)
    main.tsx
server/
  index.ts                    ← Server entry
  routes.ts                   ← API routes (EMPTY — needs implementation)
  storage.ts                  ← Storage interface (EMPTY — needs implementation)
  static.ts
  vite.ts
shared/
  schema.ts                   ← DB schema (MINIMAL — needs expansion)
```

### What This Prompt Does

1. Set up Supabase project with database and Storage bucket
2. Expand the Drizzle schema and push it to Supabase's PostgreSQL
3. Implement the storage layer (Drizzle for DB, Supabase client for files)
4. Build all API routes for the Act 1 flow
5. Integrate OpenAI gpt-4o for document parsing and briefing generation
6. Wire existing frontend pages to the new API
7. Seed the Gold Standard sample claim

After this prompt, Screens 1–4 should be fully functional with real document upload to Supabase Storage, AI extraction, human review, and briefing generation.

---

## Step 0: Supabase Project Setup

### Create the Supabase Project
1. Go to [supabase.com](https://supabase.com) and create a new project
2. Name it `claims-iq-voice-inspector`
3. Set a strong database password (save it)
4. Choose the closest region to your users

### Collect Credentials
From **Project Settings → API**, grab:
- `Project URL` → this becomes `SUPABASE_URL`
- `anon public` key → this becomes `SUPABASE_ANON_KEY`
- `service_role` key → this becomes `SUPABASE_SERVICE_ROLE_KEY`

From **Project Settings → Database → Connection string → URI**, grab:
- The PostgreSQL connection string → this becomes `DATABASE_URL`
- Format: `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`
- Use the **Transaction mode** (port 6543) pooler connection for Drizzle

### Create the Storage Bucket
In **Supabase Dashboard → Storage**:
1. Create a new bucket named `claim-documents`
2. Set it to **Private** (files accessed via signed URLs only)
3. Set max file size to 50MB
4. Allowed MIME types: `application/pdf`

### Set Environment Variables in Replit
```env
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
OPENAI_API_KEY=sk-...
```

### Install New Packages
```bash
npm install @supabase/supabase-js openai pdf-parse
npm install -D @types/pdf-parse
```

Note: We do NOT need `multer` anymore — file uploads go directly to Supabase Storage via the Supabase client, not through Express middleware.

---

## Step 1: Expand the Database Schema

**File: `shared/schema.ts`**

Replace the current minimal schema with the full Act 1 data model. Keep any existing table definitions but ADD these tables:

```typescript
import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Claims ───────────────────────────────────────────
export const claims = pgTable("claims", {
  id: serial("id").primaryKey(),
  claimNumber: varchar("claim_number", { length: 50 }).notNull(),
  insuredName: text("insured_name"),
  propertyAddress: text("property_address"),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 2 }),
  zip: varchar("zip", { length: 10 }),
  dateOfLoss: varchar("date_of_loss", { length: 20 }),
  perilType: varchar("peril_type", { length: 20 }),
  // hail, wind, water, fire, freeze, multi
  status: varchar("status", { length: 30 }).notNull().default("draft"),
  // Status flow: draft → documents_uploaded → extractions_confirmed → briefing_ready → inspecting → review → complete
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ── Documents (uploaded PDFs) ────────────────────────
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => claims.id),
  documentType: varchar("document_type", { length: 20 }).notNull(),
  // fnol, policy, endorsements
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  storagePath: text("storage_path"),      // Supabase Storage path: claims/{claimId}/{documentType}/{fileName}
  rawText: text("raw_text"),              // extracted PDF text (from pdf-parse)
  status: varchar("status", { length: 20 }).notNull().default("empty"),
  // Status flow: empty → uploading → uploaded → processing → parsed → error
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Extractions (AI-parsed structured data) ──────────
export const extractions = pgTable("extractions", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => claims.id),
  documentType: varchar("document_type", { length: 20 }).notNull(),
  // fnol, policy, endorsements
  extractedData: jsonb("extracted_data").notNull(),   // the full structured extraction JSON
  confidence: jsonb("confidence"),                     // per-field confidence scores
  confirmedByUser: boolean("confirmed_by_user").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ── Briefings (synthesized from all 3 confirmed extractions) ───
export const briefings = pgTable("briefings", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => claims.id),
  propertyProfile: jsonb("property_profile"),
  coverageSnapshot: jsonb("coverage_snapshot"),
  perilAnalysis: jsonb("peril_analysis"),
  endorsementImpacts: jsonb("endorsement_impacts"),
  inspectionChecklist: jsonb("inspection_checklist"),
  dutiesAfterLoss: jsonb("duties_after_loss"),
  redFlags: jsonb("red_flags"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Insert schemas for validation ────────────────────
export const insertClaimSchema = createInsertSchema(claims);
export const insertDocumentSchema = createInsertSchema(documents);
export const insertExtractionSchema = createInsertSchema(extractions);
export const insertBriefingSchema = createInsertSchema(briefings);
```

After updating the schema, push to Supabase's PostgreSQL:
```bash
npm run db:push
```

Verify tables exist in **Supabase Dashboard → Table Editor**.

---

## Step 2: Supabase Client Setup

Create a new file: **`server/supabase.ts`**

```typescript
import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
}

// Server-side client uses the service_role key to bypass RLS
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Storage bucket name
export const DOCUMENTS_BUCKET = "claim-documents";
```

---

## Step 3: Implement Storage Layer

**File: `server/storage.ts`**

Replace the current minimal storage with a full implementation. Use Drizzle for all database operations. Use the Supabase client for file storage operations.

```typescript
// ── Database operations (Drizzle ORM) ─────────────────

// Claims
createClaim(data) → claim
getClaims() → claim[]
getClaim(id) → claim
updateClaimStatus(id, status) → claim

// Documents
createDocument(claimId, documentType, fileName, storagePath, fileSize) → document
getDocuments(claimId) → document[]
getDocument(claimId, documentType) → document
updateDocumentStatus(id, status, rawText?) → document
updateDocumentError(id, errorMessage) → document

// Extractions
createExtraction(claimId, documentType, extractedData, confidence) → extraction
getExtractions(claimId) → extraction[]
getExtraction(claimId, documentType) → extraction
updateExtraction(id, extractedData) → extraction
confirmExtraction(id) → extraction

// Briefings
createBriefing(claimId, briefingData) → briefing
getBriefing(claimId) → briefing


// ── File operations (Supabase Storage) ─────────────────

// Upload a PDF to Supabase Storage
uploadDocument(claimId, documentType, fileBuffer, fileName) → { storagePath, publicUrl }
  // Path convention: claims/{claimId}/{documentType}/{fileName}
  // Uses supabase.storage.from(DOCUMENTS_BUCKET).upload(path, buffer, { contentType: 'application/pdf' })

// Download a PDF from Supabase Storage (for parsing)
downloadDocument(storagePath) → Buffer
  // Uses supabase.storage.from(DOCUMENTS_BUCKET).download(path)

// Get a signed URL for document viewing (optional, for frontend)
getDocumentUrl(storagePath, expiresIn = 3600) → signedUrl
  // Uses supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, expiresIn)
```

---

## Step 4: Implement API Routes

**File: `server/routes.ts`**

Add these REST endpoints to the existing Express router.

### Claims CRUD
```
GET    /api/claims              → List all claims
POST   /api/claims              → Create new claim { claimNumber, insuredName?, propertyAddress? }
GET    /api/claims/:id          → Get single claim with documents, extractions
PATCH  /api/claims/:id          → Update claim fields
```

### Document Upload & Parsing
```
POST   /api/claims/:id/documents/upload
  - Content-Type: multipart/form-data
  - Fields: file (PDF), documentType (fnol | policy | endorsements)
  - Action:
    1. Read the file buffer from the request (use express.raw() or a simple body parser for multipart)
       NOTE: Since we're NOT using multer, you have two options:
       Option A: Use a lightweight multipart parser like `busboy` or `formidable`
       Option B: Accept the file as base64 in a JSON body from the frontend
       Option B is simpler for a POC:
         - Frontend reads file as base64: FileReader.readAsDataURL()
         - Send as JSON: { fileName, fileBase64, documentType }
         - Server decodes: Buffer.from(base64, 'base64')
    2. Upload to Supabase Storage: claims/{claimId}/{documentType}/{fileName}
    3. Create document record with status "uploaded" and the storagePath
    4. Return { documentId, storagePath, status: "uploaded" }

POST   /api/claims/:id/documents/:type/parse
  - Action:
    1. Look up the document record for this claim + type
    2. Download the PDF from Supabase Storage using the storagePath
    3. Extract text from the PDF buffer using pdf-parse
    4. Send extracted text to OpenAI gpt-4o with the appropriate extraction prompt (see Step 5)
    5. Parse the JSON response
    6. Create extraction record with extracted data + confidence scores
    7. Update document status to "parsed" and save rawText
    8. If all 3 documents are parsed, update claim status to "documents_uploaded"
    9. Return { extraction, confidence }

GET    /api/claims/:id/documents
  - Returns all documents for this claim with their status
  - Optionally include signed URLs for viewing: getDocumentUrl(storagePath)
```

### Extractions Review
```
GET    /api/claims/:id/extractions
  - Returns all extractions for this claim (fnol, policy, endorsements)

GET    /api/claims/:id/extractions/:type
  - Returns single extraction (fnol | policy | endorsements)

PUT    /api/claims/:id/extractions/:type
  - Body: { extractedData: { ...corrected fields } }
  - Updates the extraction with adjuster's corrections
  - Sets confirmedByUser = true

POST   /api/claims/:id/extractions/confirm-all
  - Marks all 3 extractions as confirmed
  - Updates claim status to "extractions_confirmed"
```

### Briefing Generation
```
POST   /api/claims/:id/briefing/generate
  - Action:
    1. Load all 3 confirmed extractions for this claim
    2. Send to OpenAI gpt-4o with the briefing synthesis prompt (see Step 5)
    3. Parse the structured briefing JSON response
    4. Create briefing record
    5. Update claim status to "briefing_ready"
    6. Return the full briefing object

GET    /api/claims/:id/briefing
  - Returns the generated briefing for this claim
```

---

## Step 5: OpenAI Integration

Create a new file: **`server/openai.ts`**

This module handles all OpenAI API calls for document parsing and briefing generation.

```typescript
import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY env var");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

### FNOL Extraction Function
Call `gpt-4o` with this system prompt:
```
You are a claims document parser for an insurance inspection platform.
Extract structured data from this First Notice of Loss (FNOL) document.

Return a JSON object with these fields:
{
  "claimNumber": string,
  "insuredName": string,
  "propertyAddress": { "street": string, "city": string, "state": string, "zip": string },
  "dateOfLoss": string (ISO date),
  "perilType": "hail" | "wind" | "water" | "fire" | "freeze" | "multi",
  "reportedDamage": string,
  "propertyType": "single_family" | "townhouse" | "condo" | "multi_family",
  "yearBuilt": number | null,
  "stories": number | null,
  "squareFootage": number | null,
  "confidence": {
    [field]: "high" | "medium" | "low"  // for each field above
  }
}
If a field cannot be determined, set to null with confidence "low".
Return ONLY valid JSON.
```

### Policy Extraction Function (HO 80 03)
Call `gpt-4o` with this system prompt:
```
You are a claims document parser for an insurance inspection platform.
Extract structured data from this Homeowner Insurance Policy (HO 80 03 or similar).

Return a JSON object with these fields:
{
  "policyNumber": string,
  "policyType": string,
  "coverageA": number,
  "coverageB": number,
  "coverageC": number,
  "coverageD": number,
  "coverageE": number | null,
  "coverageF": number | null,
  "deductible": { "amount": number, "type": "flat" | "percentage" | "wind_hail_specific", "windHailDeductible": number | null },
  "lossSettlement": "replacement_cost" | "actual_cash_value" | "functional_replacement",
  "constructionType": string,
  "roofType": string | null,
  "yearBuilt": number | null,
  "specialConditions": string[] | null,
  "confidence": { [field]: "high" | "medium" | "low" }
}
Return ONLY valid JSON.
```

### Endorsements Extraction Function
Call `gpt-4o` with this system prompt:
```
You are a claims document parser for an insurance inspection platform.
Extract all endorsements from this insurance policy endorsements document.

Return a JSON object:
{
  "endorsements": [
    {
      "endorsementId": string (e.g., "HO 88 02"),
      "title": string,
      "whatItModifies": string,
      "effectiveDate": string | null,
      "keyProvisions": string[],
      "sublimits": [{ "description": string, "amount": number }] | null,
      "claimImpact": string
    }
  ],
  "totalEndorsements": number,
  "confidence": "high" | "medium" | "low"
}

Common endorsements: HO 88 02 (Roof Surfaces), HO 81 17 (Water Back-Up), HO 86 05 (Ordinance/Law), HO 82 33 (Mine Subsidence), HO 84 19 (Personal Property RCV).
Return ONLY valid JSON.
```

### Briefing Generation Function
Call `gpt-4o` with all 3 confirmed extractions as context:
```
You are an expert insurance claims analyst preparing an inspection briefing for a field adjuster.
Synthesize the FNOL, Policy, and Endorsements data into a comprehensive pre-inspection briefing.

Return a JSON object:
{
  "propertyProfile": {
    "address": string, "propertyType": string, "yearBuilt": number,
    "stories": number, "constructionType": string, "roofType": string,
    "squareFootage": number | null, "summary": string
  },
  "coverageSnapshot": {
    "coverageA": { "label": "Dwelling", "limit": number },
    "coverageB": { "label": "Other Structures", "limit": number },
    "coverageC": { "label": "Personal Property", "limit": number },
    "coverageD": { "label": "Loss of Use", "limit": number },
    "deductible": number, "deductibleType": string,
    "lossSettlement": string, "summary": string
  },
  "perilAnalysis": {
    "perilType": string,
    "whatToLookFor": string[],
    "inspectionPriorities": string[],
    "typicalDamagePatterns": string,
    "commonMistakes": string[]
  },
  "endorsementImpacts": [
    { "endorsementId": string, "title": string, "adjusterGuidance": string }
  ],
  "inspectionChecklist": {
    "exterior": string[], "roof": string[],
    "interior": string[], "systems": string[],
    "documentation": string[]
  },
  "dutiesAfterLoss": string[],
  "redFlags": string[]
}
Return ONLY valid JSON.
```

User message format for briefing:
```
Generate an inspection briefing from this claim data:

FNOL: {fnolExtraction JSON}
Policy: {policyExtraction JSON}
Endorsements: {endorsementsExtraction JSON}
```

---

## Step 6: Wire Frontend to Backend

The page components already exist. They need to be connected to the new API endpoints using TanStack React Query (already installed).

### ClaimsList.tsx
- `useQuery` to fetch `GET /api/claims`
- Replace any hardcoded sample data with query results
- "New Claim" button calls `useMutation` on `POST /api/claims`
- Clicking a claim navigates to its current step (document upload, extraction review, etc.)

### DocumentUpload.tsx
- File input or drag-drop reads the file as base64 via `FileReader.readAsDataURL()`
- Sends `POST /api/claims/:id/documents/upload` with `{ fileName, fileBase64, documentType }` via `useMutation`
- After upload succeeds, auto-call `POST /api/claims/:id/documents/:type/parse`
- Poll or use the mutation response to update card states (uploading → processing → parsed)
- Show extraction preview when parsing completes
- "Continue to Review" navigates to ExtractionReview when all 3 are parsed

### ExtractionReview.tsx
- `useQuery` to fetch `GET /api/claims/:id/extractions`
- Populate the three tabs (FNOL, Policy, Endorsements) with real extraction data
- Editable fields call `PUT /api/claims/:id/extractions/:type` on save via `useMutation`
- Confidence indicators (green = high, amber = medium, red = low) driven by the confidence field
- "Confirm & Generate Briefing" calls `POST /api/claims/:id/extractions/confirm-all` then `POST /api/claims/:id/briefing/generate`, then navigates to InspectionBriefing

### InspectionBriefing.tsx
- `useQuery` to fetch `GET /api/claims/:id/briefing`
- Populate all sections: Property Profile, Coverage Snapshot, Peril Analysis, Endorsement Impacts, Inspection Checklist, Duties After Loss, Red Flags
- "START INSPECTION" button navigates to ActiveInspection

### ActiveInspection.tsx
- No changes needed for this prompt — voice integration comes in PROMPT-03
- Can show a placeholder state: "Voice agent will be connected in the next update"

---

## Step 7: Seed Data

Create a seed script or add to the server startup to create the Gold Standard sample claim if no claims exist:

```
Claim Number: CLM-2024-00847
Insured: Robert & Sarah Penson
Property: 1847 Maple Ridge Drive, Sullivan, IN 47882
Date of Loss: March 14, 2024
Peril: Hail
Status: draft
```

This gives the adjuster something to click on immediately when they open the app.

---

## Drizzle Configuration

**File: `drizzle.config.ts`**

Make sure the Drizzle config points to the `DATABASE_URL` environment variable (which now points to Supabase):

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./shared/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

This should already be configured. Just verify it uses `process.env.DATABASE_URL`.

---

## Environment Variables Summary

```env
# Supabase
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# OpenAI
OPENAI_API_KEY=sk-...
```

The `DATABASE_URL` replaces Replit's built-in PostgreSQL connection. All other env vars are new.

---

## Test Flow After Implementation

1. Open app → see Claims List with seeded Penson claim
2. Click claim → navigate to Document Upload
3. Upload a FNOL PDF → file goes to Supabase Storage → card transitions through uploading → processing → parsed with extraction preview
4. Upload Policy PDF → same flow
5. Upload Endorsements PDF → same flow, "Continue to Review" enables
6. Click through to Extraction Review → see AI-parsed fields in editable forms
7. Amber highlights on low-confidence fields → edit a field
8. Confirm all extractions
9. Briefing generates → see Property Profile, Coverage Snapshot, Peril Analysis, Endorsement Impacts, Checklist, Red Flags
10. Click "START INSPECTION" → lands on the voice HUD (no voice yet — that's PROMPT-03)

---

## Architecture Decisions

### Why Drizzle + Supabase (Hybrid)?
- **Drizzle ORM** stays for database queries because it provides full TypeScript type safety from schema to query results. The `createInsertSchema` + Zod integration gives you validated inputs.
- **Supabase PostgreSQL** replaces Replit's ephemeral database with a managed, persistent instance. Same PostgreSQL, just hosted.
- **Supabase Storage** replaces local disk (`/tmp`) for PDF uploads. Files persist, you get signed URLs, and there's no disk cleanup to worry about.
- **Supabase Realtime** (not used yet) will be valuable in PROMPT-03 for live inspection session state — when the adjuster is on-site and the voice agent is updating room progress in real time.

### Why NOT full Supabase client for everything?
- Drizzle's typed query builder is more ergonomic than Supabase's JS client for complex queries (joins, aggregations)
- Keeping Express as the API layer lets us run OpenAI calls server-side without exposing keys
- The hybrid approach means we only swap the parts that benefit from Supabase (hosting, storage) without rewriting what already works

---

## What NOT to Change

- Do NOT alter any existing page layouts, components, or styling
- Do NOT change the routing in App.tsx
- Do NOT remove or restructure existing client code
- Do NOT add authentication (POC — can layer in Supabase Auth later)
- Do NOT replace Drizzle with the Supabase JS client for database queries
- ONLY add backend logic and connect it to the existing frontend
