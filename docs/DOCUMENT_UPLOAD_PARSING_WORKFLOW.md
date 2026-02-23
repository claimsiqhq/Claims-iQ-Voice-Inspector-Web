# Document Upload, Parsing, Storage & Display — Developer Guide

> **Purpose**: This document describes the complete workflow for uploading, AI-parsing, storing, and displaying FNOL (First Notice of Loss), Policy, and Endorsement documents. Use this as a reference when porting these features to another application.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Tech Stack](#2-tech-stack)
3. [Database Schema (Drizzle + PostgreSQL)](#3-database-schema-drizzle--postgresql)
4. [Supabase Configuration](#4-supabase-configuration)
5. [Document Upload Flow](#5-document-upload-flow)
6. [PDF Parsing & AI Extraction Flow](#6-pdf-parsing--ai-extraction-flow)
7. [AI Prompt Engineering — Full Extraction Schemas](#7-ai-prompt-engineering--full-extraction-schemas)
8. [Extraction Review & Confirmation UX](#8-extraction-review--confirmation-ux)
9. [Briefing Generation (Post-Extraction)](#9-briefing-generation-post-extraction)
10. [Documents Hub — Display & Status Tracking](#10-documents-hub--display--status-tracking)
11. [PDF Viewer Component](#11-pdf-viewer-component)
12. [API Reference](#12-api-reference)
13. [Environment Variables](#13-environment-variables)
14. [File Map](#14-file-map)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND (React + Vite)                                            │
│                                                                     │
│  DocumentUpload.tsx ──► apiRequest("POST", /upload) ──────┐         │
│      │                                                     │        │
│      ▼                                                     │        │
│  apiRequest("POST", /parse) ──────────────────────────┐    │        │
│      │                                                 │    │        │
│  ExtractionReview.tsx ◄── GET /extractions             │    │        │
│      │                                                 │    │        │
│  DocumentsHub.tsx ◄── GET /documents/all               │    │        │
│      │                                                 │    │        │
│  PdfViewer.tsx ◄── GET /documents/:id/signed-url       │    │        │
└───────────────────────────────────────────────────────────────────────┘
         │                                               │    │
         ▼                                               ▼    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  BACKEND (Express + Node.js)                                        │
│                                                                     │
│  routes/claims.ts                                                   │
│    POST /:id/documents/upload       → Supabase Storage upload       │
│    POST /:id/documents/upload-batch → Multi-file Supabase upload    │
│    POST /:id/documents/:type/parse  → pdf-parse → OpenAI → DB      │
│    GET  /:id/extractions            → Read from PostgreSQL          │
│    PUT  /:id/extractions/:type      → Update + confirm extraction   │
│    POST /:id/extractions/confirm-all → Confirm all + gen briefing   │
│                                                                     │
│  routes/documents.ts                                                │
│    GET /all                         → All docs (role-scoped)        │
│    GET /status-summary              → Claim-grouped status view     │
│    GET /:id/signed-url              → Supabase signed URL(s)       │
└─────────────────────────────────────────────────────────────────────┘
         │                    │                     │
         ▼                    ▼                     ▼
┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  Supabase    │   │  PostgreSQL      │   │  OpenAI API      │
│  Storage     │   │  (via Drizzle)   │   │  (gpt-4.1)       │
│  (PDF blobs) │   │  docs/extracts   │   │  JSON extraction │
└──────────────┘   └──────────────────┘   └──────────────────┘
```

### Lifecycle of a Document

```
UPLOAD → STORE IN SUPABASE → CREATE/UPDATE DB RECORD (status: "uploaded")
   → DOWNLOAD PDF FROM SUPABASE → pdf-parse TEXT EXTRACTION
   → UPDATE DB (status: "processing", rawText stored)
   → OPENAI STRUCTURED EXTRACTION → SAVE EXTRACTION TO DB
   → UPDATE DB (status: "parsed")
   → [If FNOL] SYNC FIELDS TO CLAIM RECORD
   → [If all 3 parsed] AUTO-GENERATE BRIEFING
```

---

## 2. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 18 + TypeScript | UI framework |
| Routing | wouter | Client-side routing |
| Data fetching | @tanstack/react-query | Caching, invalidation |
| HTTP client | Native fetch via `apiRequest()` helper | API calls with auth |
| UI library | shadcn/ui (Radix + Tailwind) | Component library |
| Animations | framer-motion | Upload card transitions |
| PDF rendering | pdfjs-dist | In-browser PDF viewer |
| Backend | Express.js + TypeScript | REST API |
| ORM | Drizzle ORM | Type-safe DB queries |
| Database | PostgreSQL (Supabase-hosted) | Relational storage |
| File storage | Supabase Storage | PDF blob storage |
| PDF parsing | pdf-parse (npm) | Server-side text extraction |
| AI extraction | OpenAI API (gpt-4.1) | Structured data extraction |
| Validation | Zod | Request body validation |
| Auth | JWT (local) + Supabase Auth | Bearer token auth |

---

## 3. Database Schema (Drizzle + PostgreSQL)

> Source: `shared/schema.ts`

### 3.1 `documents` Table

```typescript
export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    claimId: integer("claim_id").notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    documentType: varchar("document_type", { length: 20 }).notNull(),
      // Values: "fnol" | "policy" | "endorsements"
    fileName: text("file_name"),
      // For endorsements batch: comma-separated names e.g. "HO_88_02.pdf, HO_81_06.pdf"
    fileSize: integer("file_size"),
    storagePath: text("storage_path"),
      // Single file: "claims/5/fnol/report.pdf"
      // Batch files: "claims/5/endorsements/ho_88_02.pdf|claims/5/endorsements/ho_81_06.pdf"
      //              (pipe-delimited for multi-file endorsements)
    rawText: text("raw_text"),
      // Populated during parsing — full extracted text from pdf-parse
    status: varchar("status", { length: 20 }).notNull().default("empty"),
      // Lifecycle: "empty" → "uploaded" → "processing" → "parsed"
      // Error state: "error" (with errorMessage populated)
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    // Enforces ONE document per type per claim
    claimDocumentUnique: uniqueIndex("documents_claim_document_unique")
      .on(table.claimId, table.documentType),
  }),
);
```

**Key design decisions:**
- **One document per type per claim**: The unique index on `(claimId, documentType)` means re-uploading replaces the existing record (via `updateDocumentStoragePath`).
- **Pipe-delimited `storagePath`**: Endorsements support multi-file upload. Multiple Supabase paths are joined with `|`.
- **`rawText` persistence**: The full PDF text is stored so re-extraction doesn't require re-downloading from Supabase.

### 3.2 `extractions` Table

```typescript
export const extractions = pgTable(
  "extractions",
  {
    id: serial("id").primaryKey(),
    claimId: integer("claim_id").notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    documentType: varchar("document_type", { length: 20 }).notNull(),
      // Values: "fnol" | "policy" | "endorsements"
    extractedData: jsonb("extracted_data").notNull(),
      // The full AI-extracted JSON (structure varies by document type — see Section 7)
    confidence: jsonb("confidence"),
      // Per-field confidence map, e.g. { "insuredName": "high", "perilType": "medium" }
    confirmedByUser: boolean("confirmed_by_user").default(false),
      // Set to true when user reviews and confirms the extraction
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    claimExtractionUnique: uniqueIndex("extractions_claim_document_unique")
      .on(table.claimId, table.documentType),
  }),
);
```

**Key design decisions:**
- **JSONB for `extractedData`**: The schema-less JSONB column stores different structures for FNOL, Policy, and Endorsements. This avoids needing separate tables per document type.
- **Separate `confidence` column**: Confidence metadata is stored alongside but separate from the extracted data, making it easy to render confidence badges in the UI without mixing it into the data object.
- **`confirmedByUser` flag**: Tracks whether a human has reviewed the AI extraction. The pipeline won't auto-generate briefings until all three extractions exist.

### 3.3 `briefings` Table

```typescript
export const briefings = pgTable("briefings", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull()
    .references(() => claims.id, { onDelete: "cascade" }),
  propertyProfile: jsonb("property_profile"),
  coverageSnapshot: jsonb("coverage_snapshot"),
  perilAnalysis: jsonb("peril_analysis"),
  endorsementImpacts: jsonb("endorsement_impacts"),
  inspectionChecklist: jsonb("inspection_checklist"),
  dutiesAfterLoss: jsonb("duties_after_loss"),
  redFlags: jsonb("red_flags"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### 3.4 `claims` Table (relevant fields)

```typescript
export const claims = pgTable("claims", {
  id: serial("id").primaryKey(),
  claimNumber: varchar("claim_number", { length: 50 }).notNull(),
  insuredName: text("insured_name"),        // ← auto-synced from FNOL extraction
  propertyAddress: text("property_address"), // ← auto-synced from FNOL extraction
  city: varchar("city", { length: 100 }),    // ← auto-synced from FNOL extraction
  state: varchar("state", { length: 2 }),    // ← auto-synced from FNOL extraction
  zip: varchar("zip", { length: 10 }),       // ← auto-synced from FNOL extraction
  dateOfLoss: varchar("date_of_loss"),       // ← auto-synced from FNOL extraction
  perilType: varchar("peril_type"),          // ← auto-synced from FNOL extraction
  status: varchar("status", { length: 30 }).notNull().default("draft"),
    // Lifecycle: "draft" → "documents_uploaded" → "extractions_confirmed"
    //         → "briefing_ready" → "inspecting" → ...
  assignedTo: varchar("assigned_to").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

---

## 4. Supabase Configuration

> Source: `server/supabase.ts`, `server/utils.ts`

### 4.1 Server-Side Client

```typescript
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: {
    fetch: (input, init) => fetchWithTimeout(input, init), // 15s timeout
  },
  auth: {
    persistSession: false,      // Server-side: no session persistence
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

export const DOCUMENTS_BUCKET = "claim-documents";
```

### 4.2 Storage Bucket Auto-Creation

```typescript
export async function ensureStorageBuckets() {
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketNames = buckets?.map((b) => b.name) || [];

  if (!bucketNames.includes(DOCUMENTS_BUCKET)) {
    await supabase.storage.createBucket(DOCUMENTS_BUCKET, {
      public: false,                              // Private bucket
      fileSizeLimit: 50 * 1024 * 1024,           // 50MB max per file
      allowedMimeTypes: ["application/pdf"],       // PDFs only
    });
  }
}
```

### 4.3 Storage Path Convention

```
claims/{claimId}/{documentType}/{sanitized_filename}.pdf
```

Examples:
```
claims/42/fnol/claim_information_report.pdf
claims/42/policy/ho_80_03_policy_form.pdf
claims/42/endorsements/ho_88_02.pdf
claims/42/endorsements/ho_81_06.pdf
```

### 4.4 File Upload Helper

```typescript
// server/utils.ts
export async function uploadToSupabase(
  claimId: number,
  documentType: string,
  fileBuffer: Buffer,
  fileName: string
): Promise<string> {
  const safeFileName = sanitizeStorageFileName(fileName);
  const storagePath = `claims/${claimId}/${documentType}/${safeFileName}`;
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: "application/pdf",
      upsert: true,   // Overwrite if exists
    });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return storagePath;
}
```

### 4.5 File Download Helper

```typescript
export async function downloadFromSupabase(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(storagePath);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
```

### 4.6 Signed URL Generation (for frontend PDF viewing)

```typescript
// server/routes/documents.ts
const paths = doc.storagePath.split("|");  // Handle multi-file endorsements
const urls: string[] = [];
for (const p of paths) {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(p.trim(), 3600);  // 1-hour expiry
  if (error) throw new Error(`Signed URL failed: ${error.message}`);
  urls.push(data.signedUrl);
}
```

### 4.7 Client-Side Supabase (Auth Only)

```typescript
// client/src/lib/supabaseClient.ts
// The client-side Supabase client is initialized lazily from /api/config
// It is used ONLY for authentication (Supabase Auth), not for storage.
// All storage operations go through the server API.
```

---

## 5. Document Upload Flow

### 5.1 Frontend Upload (Single File — FNOL & Policy)

> Source: `client/src/pages/DocumentUpload.tsx`

```
User clicks DocCard → <input type="file" accept=".pdf"> triggers
  → readFileAsBase64(file)  // FileReader → data:application/pdf;base64,...
  → POST /api/claims/{claimId}/documents/upload
      body: { fileName, fileBase64, documentType: "fnol"|"policy" }
  → On success: POST /api/claims/{claimId}/documents/{type}/parse
  → On success: invalidate queries, show "complete" state
```

#### Frontend State Machine per DocCard:

```
"empty" → "uploading" → "processing" → "complete"
                ↓              ↓
             "error"        "error"
```

#### Key Frontend Code Pattern:

```typescript
const handleUpload = useCallback(async (index: number, file: File) => {
  const docType = DOC_TYPES[index]; // "fnol" | "policy" | "endorsements"
  updateState(index, "uploading");

  const fileBase64 = await readFileAsBase64(file);

  // Step 1: Upload to Supabase via server
  const uploadRes = await apiRequest("POST",
    `/api/claims/${claimId}/documents/upload`,
    { fileName: file.name, fileBase64, documentType: docType }
  );

  updateState(index, "processing");

  // Step 2: Trigger AI parsing
  const parseRes = await apiRequest("POST",
    `/api/claims/${claimId}/documents/${docType}/parse`
  );

  updateState(index, "complete");

  // Step 3: Invalidate caches
  queryClient.invalidateQueries({ queryKey: [`/api/claims/${claimId}/documents`] });
  queryClient.invalidateQueries({ queryKey: [`/api/claims/${claimId}/extractions`] });
}, [claimId]);
```

### 5.2 Frontend Upload (Batch — Endorsements)

Endorsements support multi-file selection (`<input multiple>`):

```typescript
const handleEndorsementBatch = useCallback(async (files: File[]) => {
  // Read all files as base64 in parallel
  const filesData = await Promise.all(
    files.map(async (file) => ({
      fileName: file.name,
      fileBase64: await readFileAsBase64(file),
    }))
  );

  // Batch upload
  await apiRequest("POST",
    `/api/claims/${claimId}/documents/upload-batch`,
    { files: filesData, documentType: "endorsements" }
  );

  // Trigger single parse for all endorsements combined
  await apiRequest("POST",
    `/api/claims/${claimId}/documents/endorsements/parse`
  );
}, [claimId]);
```

### 5.3 Backend Upload Endpoint (Single File)

> Source: `server/routes/claims.ts` — `POST /:id/documents/upload`

```
1. Authenticate request (JWT Bearer token)
2. Authorize user access to claim
3. Validate body with Zod:
     { fileName: string, fileBase64: string, documentType: "fnol"|"policy"|"endorsements" }
4. Verify PDF: fileName ends with .pdf OR base64 starts with data:application/pdf
5. Decode base64 → Buffer (strip data URI prefix if present)
6. Check size ≤ 25MB
7. Upload to Supabase Storage → get storagePath
8. Upsert document record:
     - If existing doc for (claimId, documentType): update storagePath, fileName, fileSize, reset status to "uploaded"
     - If new: create document record with status "uploaded"
9. Emit "document.uploaded" event
10. Return { documentId, storagePath, status: "uploaded" }
```

### 5.4 Backend Upload Endpoint (Batch — Endorsements Only)

> Source: `server/routes/claims.ts` — `POST /:id/documents/upload-batch`

```
1-3. Same auth/validation (Zod schema: files[].fileName + files[].fileBase64, max 20 files)
4. For each file:
     - Validate PDF
     - Decode base64 → Buffer
     - Check ≤ 25MB per file
     - Upload to Supabase → collect storagePath
5. Combine: storagePaths.join("|"), fileNames joined with ", "
6. Upsert single document record with combined storagePath
7. Return { documentId, storagePaths, fileCount, status: "uploaded" }
```

### 5.5 Zod Validation Schemas

```typescript
const uploadBodySchema = z.object({
  fileName: z.string().min(1),
  fileBase64: z.string().min(1),
  documentType: z.enum(["fnol", "policy", "endorsements"]),
});

const batchUploadBodySchema = z.object({
  files: z.array(z.object({
    fileName: z.string().min(1),
    fileBase64: z.string().min(1),
  })).min(1).max(20),
  documentType: z.literal("endorsements"),
});
```

---

## 6. PDF Parsing & AI Extraction Flow

> Source: `server/routes/claims.ts` — `POST /:id/documents/:type/parse`

### 6.1 Complete Parse Endpoint Logic

```
1. Authenticate + authorize claim access
2. Look up document record by (claimId, documentType)
3. Verify document exists and has storagePath
4. Set document status → "processing"

5. TEXT EXTRACTION:
   - If endorsements with pipe-delimited storagePath:
       For each path:
         downloadFromSupabase(path) → Buffer
         pdfParse(buffer) → { text }
       Join all texts with "\n\n--- NEXT DOCUMENT ---\n\n"
   - Otherwise (single file):
       downloadFromSupabase(storagePath) → Buffer
       pdfParse(buffer) → { text }

6. Save rawText to document record (status still "processing")

7. AI EXTRACTION (based on documentType):
   - "fnol"         → extractFNOL(rawText)
   - "policy"       → extractPolicy(rawText)
   - "endorsements" → extractEndorsements(rawText)
   Each returns: { extractedData: object, confidence: object }

8. Upsert extraction record:
   - If existing extraction: update extractedData
   - If new: create extraction with extractedData + confidence

9. Set document status → "parsed"

10. POST-PARSE SIDE EFFECTS:
    - If FNOL: sync fields (insuredName, perilType, dateOfLoss, address)
      to the parent claim record via claimFieldsFromFnol()
    - If all 3 document types are "parsed":
        → Update claim status to "documents_uploaded"
        → Auto-generate briefing (if user setting autoGenerateBriefing !== false)
```

### 6.2 PDF Text Extraction (pdf-parse)

```typescript
import pdfParse from "pdf-parse";

// Single file
const dataBuffer = await downloadFromSupabase(doc.storagePath);
const pdfData = await pdfParse(dataBuffer);
const rawText = pdfData.text;

// Multi-file endorsements
const storagePaths = doc.storagePath.split("|");
const textParts: string[] = [];
for (const sp of storagePaths) {
  const dataBuffer = await downloadFromSupabase(sp);
  const pdfData = await pdfParse(dataBuffer);
  textParts.push(pdfData.text);
}
const rawText = textParts.join("\n\n--- NEXT DOCUMENT ---\n\n");
```

### 6.3 FNOL → Claim Field Sync

When FNOL is parsed, extracted fields are automatically synced to the `claims` table:

```typescript
function claimFieldsFromFnol(data: any): Record<string, any> {
  const fields: Record<string, any> = {};
  if (data.insuredName) fields.insuredName = data.insuredName;
  if (data.perilType) fields.perilType = data.perilType;
  if (data.dateOfLoss) fields.dateOfLoss = data.dateOfLoss;
  if (data.propertyAddress) {
    if (typeof data.propertyAddress === "object") {
      if (data.propertyAddress.street) fields.propertyAddress = data.propertyAddress.street;
      if (data.propertyAddress.city) fields.city = data.propertyAddress.city;
      if (data.propertyAddress.state) fields.state = data.propertyAddress.state;
      if (data.propertyAddress.zip) fields.zip = data.propertyAddress.zip;
    } else if (typeof data.propertyAddress === "string") {
      fields.propertyAddress = data.propertyAddress;
    }
  }
  return fields;
}
```

---

## 7. AI Prompt Engineering — Full Extraction Schemas

> Source: `server/openai.ts`

All three extraction functions use `gpt-4.1` with `temperature: 0.1` and `max_tokens: 32000`.

### 7.1 FNOL Extraction — `extractFNOL(rawText)`

**System prompt instructs the model to return:**

```jsonc
{
  "claimNumber": "string (include CAT code if present)",
  "catCode": "string | null",
  "claimStatus": "string | null",
  "operatingCompany": "string | null",
  "dateOfLoss": "string (ISO date)",
  "timeOfLoss": "string | null",
  "policyNumber": "string",
  "insuredName": "string",
  "insuredName2": "string | null",
  "propertyAddress": {
    "street": "string",
    "city": "string",
    "state": "string",
    "zip": "string"
  },
  "contactInfo": {
    "homePhone": "string | null",
    "mobilePhone": "string | null",
    "primaryPhone": "string | null",
    "email": "string | null"
  },
  "perilType": "hail | wind | water | fire | freeze | multi",
  "reportedDamage": "string (detailed summary)",
  "damageAreas": "string | null",
  "roofDamage": "boolean | null",
  "propertyType": "single_family | townhouse | condo | multi_family",
  "yearBuilt": "number | null",
  "yearRoofInstalled": "number | null",
  "woodRoof": "boolean | null",
  "stories": "number | null",
  "squareFootage": "number | null",
  "thirdPartyInterest": "string | null (mortgagee name)",
  "producer": {
    "name": "string | null",
    "address": "string | null",
    "phone": "string | null",
    "email": "string | null"
  },
  "policyInfo": {
    "type": "string | null",
    "status": "string | null",
    "inceptionDate": "string | null"
  },
  "deductibles": {
    "policyDeductible": "number | null",
    "windHailDeductible": "number | null",
    "windHailDeductibleType": "flat | percentage | null",
    "windHailDeductiblePercentage": "number | null"
  },
  "coverages": {
    "coverageA": { "label": "Dwelling", "limit": "number | null", "valuationMethod": "string | null" },
    "coverageB": { "label": "Other Structures", "limit": "number | null" },
    "coverageC": { "label": "Personal Property", "limit": "number | null", "limitPercentage": "number | null" },
    "coverageD": { "label": "Loss of Use", "limit": "number | null" },
    "coverageE": { "label": "Personal Liability", "limit": "number | null" },
    "coverageF": { "label": "Medical Expense", "limit": "number | null" }
  },
  "additionalCoverages": [
    { "name": "string", "limit": "number | null", "deductible": "number | null", "details": "string | null" }
  ],
  "endorsementList": [
    { "formNumber": "string", "title": "string" }
  ],
  "endorsementAlerts": ["string"],
  "reportedBy": "string | null",
  "reportedDate": "string | null",
  "confidence": {
    "[field]": "high | medium | low"
  }
}
```

**Post-processing:**
```typescript
const parsed = parseJsonResponse(response.choices[0].message.content);
const confidence = parsed.confidence || {};
delete parsed.confidence;  // Separate confidence from data
return { extractedData: parsed, confidence };
```

### 7.2 Policy Extraction — `extractPolicy(rawText)`

**System prompt instructs the model to return:**

```jsonc
{
  "policyFormNumber": "string (e.g. 'HO 80 03 01 14')",
  "policyNumber": "string | null",
  "policyType": "string (e.g. 'HO-3 Special Form')",
  "coverageA": "number | null (Dwelling limit)",
  "coverageB": "number | null (Other Structures)",
  "coverageC": "number | null (Personal Property)",
  "coverageD": "number | null (Loss of Use)",
  "coverageE": "number | null (Personal Liability)",
  "coverageF": "number | null (Medical Expense)",
  "deductible": {
    "amount": "number | null",
    "type": "flat | percentage | wind_hail_specific | null",
    "windHailDeductible": "number | null"
  },
  "lossSettlement": "replacement_cost | actual_cash_value | functional_replacement | null",
  "constructionType": "string | null",
  "roofType": "string | null",
  "yearBuilt": "number | null",
  "namedPerils": ["string (list of covered perils)"],
  "keyExclusions": ["string (important exclusions, summarized)"],
  "lossSettlementTerms": {
    "dwellingSettlement": "string",
    "personalPropertySettlement": "string",
    "roofSettlement": "string | null"
  },
  "dutiesAfterLoss": ["string"],
  "specialConditions": ["string"],
  "confidence": { "[field]": "high | medium | low" }
}
```

**Note**: The prompt handles both Declarations pages (with dollar amounts) AND policy form documents (terms only, no dollar amounts). The UI adapts accordingly with a "Policy Form (Terms Only)" badge.

### 7.3 Endorsements Extraction — `extractEndorsements(rawText)`

**System prompt instructs the model to return:**

```jsonc
{
  "endorsements": [
    {
      "endorsementId": "string (e.g. 'HO 88 02 10 22')",
      "title": "string",
      "formEdition": "string | null (e.g. '10 22')",
      "whatItModifies": "string",
      "keyProvisions": ["string (detailed list)"],
      "modifiedDefinitions": [{ "term": "string", "change": "string" }],
      "modifiedExclusions": [{ "exclusion": "string", "change": "string" }],
      "modifiedSettlement": "string | null",
      "sublimits": [{ "description": "string", "amount": "number" }],
      "roofPaymentSchedule": {
        "hasSchedule": "boolean",
        "materialTypes": ["string"],
        "maxAge": "number",
        "summary": "string"
      },
      "claimImpact": "string (plain language adjuster guidance)"
    }
  ],
  "totalEndorsements": "number",
  "confidence": "high | medium | low"
}
```

**Note**: The confidence for endorsements is a single overall value, not per-field.

### 7.4 JSON Response Parsing

The `parseJsonResponse` helper handles OpenAI responses that may include markdown code fences:

```typescript
function parseJsonResponse(text: string): any {
  try {
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error("Failed to parse AI response as JSON");
  }
}
```

---

## 8. Extraction Review & Confirmation UX

> Source: `client/src/pages/ExtractionReview.tsx`

### 8.1 Page Structure

The ExtractionReview page (`/review/:claimId`) displays a tabbed interface with three tabs: **FNOL**, **Policy**, **Endorsements**.

```
GET /api/claims/{claimId}/extractions → Extraction[]
  → Find fnolExt, policyExt, endorsementsExt by documentType
  → Render in Tabs component
```

### 8.2 Confidence Display System

Each extracted field shows an AI confidence indicator:

| Level | Score | Color | Icon |
|-------|-------|-------|------|
| `high` | 95% | Green | ShieldCheck |
| `medium` | 70% | Amber | ShieldAlert |
| `low` | 35% | Red | ShieldX |

Fields with `low` confidence get a red-tinted input background. Medium gets amber.

An **Overall Confidence Summary** bar aggregates all field confidences into a weighted score.

### 8.3 Editable Fields (FNOL)

FNOL fields are editable inline. Changed fields are tracked in local state:

```typescript
const [edits, setEdits] = useState<Record<string, string>>({});
// On save:
await apiRequest("PUT", `/api/claims/${claimId}/extractions/fnol`, {
  extractedData: { ...originalData, ...edits },
});
```

### 8.4 Per-Document Confirmation

Each tab has a "Confirm {type}" button:

```
POST /api/claims/{claimId}/extractions/{type}/confirm
  → Sets confirmedByUser = true
  → If FNOL: syncs fields to claim
```

### 8.5 Confirm All & Generate Briefing

The main CTA "Confirm & Generate Briefing" does:

```
POST /api/claims/{claimId}/extractions/confirm-all
  → Confirms all 3 extractions
  → Syncs FNOL fields to claim
  → Sets claim status to "extractions_confirmed"
POST /api/claims/{claimId}/briefing/generate
  → Generates briefing from all 3 extractions
  → Navigates to /briefing/{claimId}
```

---

## 9. Briefing Generation (Post-Extraction)

> Source: `server/openai.ts` — `generateBriefing()`

Once all three extractions exist, the system can generate an inspection briefing. This happens either:
- **Automatically** after the third document is parsed (if `autoGenerateBriefing` user setting is enabled)
- **Manually** via the "Confirm & Generate Briefing" button

The briefing synthesizes FNOL + Policy + Endorsements into:

```jsonc
{
  "propertyProfile": { "address", "propertyType", "yearBuilt", "summary", ... },
  "coverageSnapshot": { "coverageA", "coverageB", ..., "deductible", "lossSettlement", "summary" },
  "perilAnalysis": { "perilType", "whatToLookFor", "inspectionPriorities", "typicalDamagePatterns", "commonMistakes" },
  "endorsementImpacts": [{ "endorsementId", "title", "adjusterGuidance" }],
  "inspectionChecklist": { "exterior", "roof", "interior", "systems", "documentation" },
  "dutiesAfterLoss": ["string"],
  "redFlags": ["string"]
}
```

---

## 10. Documents Hub — Display & Status Tracking

> Source: `client/src/pages/DocumentsHub.tsx`

### 10.1 Data Fetching

```typescript
// Fetch claims (role-scoped)
const claimsEndpoint = role === "supervisor" ? "/api/claims" : "/api/claims/my-claims";
const { data: claims } = useQuery<Claim[]>({ queryKey: [claimsEndpoint] });

// Fetch all documents
const { data: allDocs } = useQuery<DocRecord[]>({
  queryKey: ["/api/documents/all"],
  enabled: claims.length > 0,
});

// Group documents by claim
const docsByClaim = claims.reduce((acc, claim) => {
  acc[claim.id] = allDocs.filter(d => d.claimId === claim.id);
  return acc;
}, {});
```

### 10.2 Document Status Pipeline

> Source: `client/src/components/DocumentStatusTracker.tsx`

Documents progress through a 4-stage pipeline displayed as connected dots:

```
[Uploaded] ──── [Processing] ──── [Extracted] ──── [Reviewed]
```

Mapping from DB status to display stage:

```typescript
export function getDocStage(status: string, confirmedByUser?: boolean): DocStage {
  if (!status || status === "empty") return "empty";
  if (status === "uploaded") return "uploaded";
  if (status === "processing") return "processing";
  if ((status === "parsed" || status === "complete") && confirmedByUser) return "reviewed";
  if (status === "parsed" || status === "complete") return "extracted";
  return "uploaded";
}
```

### 10.3 Status Pills

Each document shows a colored status pill:

| Status | Color | Icon |
|--------|-------|------|
| Missing | Gray | Upload |
| Uploaded | Blue | Clock |
| Processing | Amber | Loader2 (spinning) |
| Parsed | Green | CheckCircle2 |
| Error | Red | AlertCircle |

### 10.4 Claim Card Overall Status

```typescript
function getOverallStatus(docs: DocRecord[]) {
  if (docs.length === 0) return "No Documents";
  if (docs.some(d => d.status === "error")) return "Needs Attention";
  if (docs.every(d => d.status === "parsed") && docs.length === 3) return "All Parsed";
  if (docs.some(d => d.status === "uploaded" || d.status === "processing")) return "In Progress";
  if (docs.some(d => d.status === "parsed")) return "Partially Parsed";
  return "Uploaded";
}
```

### 10.5 Claim Card Actions

Each expanded claim card shows per-document actions:
- **View PDF**: Opens inline PdfViewer (requires signed URL)
- **View Extraction**: Navigates to `/review/{claimId}`
- **Upload**: Navigates to `/upload/{claimId}` (if no file)
- **Manage All Documents**: Navigates to `/upload/{claimId}`

---

## 11. PDF Viewer Component

> Source: `client/src/components/PdfViewer.tsx`

A canvas-based PDF renderer using `pdfjs-dist`:

```typescript
interface PdfViewerProps {
  urls: string[];       // Signed URLs (supports multiple for endorsements)
  fileName?: string;
  onClose: () => void;
}
```

**Key behaviors:**
- **Multi-document support**: Loads all PDFs, flattens pages into a single navigable sequence
- **Canvas rendering**: Uses `page.render({ canvasContext, viewport })` for each page
- **Zoom**: 0.5x to 3x, in 0.3 increments
- **Lazy loaded**: Wrapped in `React.lazy()` and `Suspense`

---

## 12. API Reference

### Upload & Parse

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/api/claims/:id/documents/upload` | `{ fileName, fileBase64, documentType }` | `{ documentId, storagePath, status }` |
| `POST` | `/api/claims/:id/documents/upload-batch` | `{ files: [{ fileName, fileBase64 }], documentType: "endorsements" }` | `{ documentId, storagePaths, fileCount, status }` |
| `POST` | `/api/claims/:id/documents/:type/parse` | (none) | `{ extraction, confidence }` |

### Documents

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/claims/:id/documents` | `Document[]` |
| `GET` | `/api/documents/all` | `Document[]` (role-scoped) |
| `GET` | `/api/documents/status-summary` | `[{ claimId, claimNumber, documents: [{ documentType, stage }] }]` |
| `GET` | `/api/documents/:id/signed-url` | `{ urls: string[], fileName, documentType }` |

### Extractions

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/api/claims/:id/extractions` | — | `Extraction[]` |
| `GET` | `/api/claims/:id/extractions/:type` | — | `Extraction` |
| `PUT` | `/api/claims/:id/extractions/:type` | `{ extractedData }` | `Extraction` (updated + confirmed) |
| `POST` | `/api/claims/:id/extractions/:type/confirm` | — | `{ confirmed: true, documentType }` |
| `POST` | `/api/claims/:id/extractions/confirm-all` | — | `{ confirmed: count }` |

### Briefing

| Method | Path | Response |
|--------|------|----------|
| `POST` | `/api/claims/:id/briefing/generate` | `Briefing` |
| `GET` | `/api/claims/:id/briefing` | `Briefing` |

### Authentication

All endpoints require `Authorization: Bearer <token>` header.

---

## 13. Environment Variables

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # Server-side (full access)
SUPABASE_ANON_KEY=eyJ...                  # Client-side (auth only)
SUPABASE_DATABASE_URL=postgresql://...     # Direct DB connection for Drizzle

# OpenAI
OPENAI_API_KEY=sk-...                     # For document extraction & briefing generation

# Optional
SUPABASE_FETCH_TIMEOUT_MS=15000           # Supabase HTTP timeout (default: 15s)
```

---

## 14. File Map

```
├── shared/
│   └── schema.ts                        # Drizzle schema: documents, extractions, briefings, claims tables
│
├── server/
│   ├── db.ts                            # Drizzle + postgres.js connection setup
│   ├── supabase.ts                      # Supabase client, bucket constants, ensureStorageBuckets()
│   ├── openai.ts                        # extractFNOL(), extractPolicy(), extractEndorsements(), generateBriefing()
│   ├── utils.ts                         # uploadToSupabase(), downloadFromSupabase(), decodeBase64Payload(), sanitizeStorageFileName()
│   ├── storage.ts                       # IStorage interface + DatabaseStorage class (all DB CRUD)
│   └── routes/
│       ├── index.ts                     # Route registration (claimsRouter, documentsRouter, etc.)
│       ├── claims.ts                    # Upload, parse, extractions, briefing, policy rules endpoints
│       └── documents.ts                 # /documents/all, /status-summary, /:id/signed-url
│
├── client/src/
│   ├── App.tsx                          # Route definitions: /upload/:id, /review/:id, /documents, etc.
│   ├── lib/
│   │   ├── queryClient.ts              # apiRequest(), getAuthHeaders(), QueryClient config
│   │   └── supabaseClient.ts           # Client-side Supabase (auth only, lazy-init from /api/config)
│   ├── pages/
│   │   ├── DocumentUpload.tsx           # Upload UI: 3 DocCards (FNOL, Policy, Endorsements)
│   │   ├── ExtractionReview.tsx         # Tabbed extraction review: editable fields, confidence scores, confirm
│   │   └── DocumentsHub.tsx             # All-claims document overview: status pills, PDF viewer, actions
│   └── components/
│       ├── DocumentStatusTracker.tsx     # StageIndicator pipeline (uploaded→processing→extracted→reviewed)
│       └── PdfViewer.tsx                # Canvas-based PDF viewer (pdfjs-dist), multi-doc support
│
├── migrations/                          # DB migration files (Drizzle Kit)
└── drizzle.config.ts                    # Drizzle Kit configuration
```

---

## Porting Checklist

When implementing this in another application:

1. **Set up Supabase project** with a private storage bucket for PDFs
2. **Create database tables**: `documents`, `extractions`, `briefings` (and your parent entity table equivalent to `claims`)
3. **Implement upload endpoints**: Accept base64-encoded PDFs, upload to Supabase Storage, create DB records
4. **Implement parse endpoint**: Download from Supabase, extract text with `pdf-parse`, send to OpenAI, store extraction
5. **Implement signed URL endpoint**: Generate time-limited URLs for frontend PDF viewing
6. **Build upload UI**: File input cards with state machine (empty → uploading → processing → complete → error)
7. **Build extraction review UI**: Tabbed display of extracted JSON, with confidence indicators and inline editing
8. **Build documents hub**: Overview page showing all documents grouped by parent entity with status indicators
9. **Add PDF viewer**: Use `pdfjs-dist` with canvas rendering and multi-document page flattening
10. **Wire up auth**: All API calls need bearer token auth; document access should be scoped to authorized users
