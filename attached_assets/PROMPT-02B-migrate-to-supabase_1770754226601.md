# Claims IQ Voice Inspector — PROMPT 02B: Migrate to Supabase

## Context

Act 1 backend is already built and working against Replit's built-in PostgreSQL with local disk file storage. This prompt migrates the data layer to Supabase without changing any business logic, UI, or API contracts.

### What We're Changing
1. **Database host** → Supabase PostgreSQL (swap `DATABASE_URL`)
2. **File storage** → Supabase Storage bucket (replace multer + local disk)
3. **Add Supabase client** → `@supabase/supabase-js` for Storage operations only

### What We're NOT Changing
- Schema definitions (same Drizzle tables)
- API route signatures (same endpoints, same request/response shapes)
- OpenAI integration (untouched)
- Frontend code (untouched)
- Drizzle ORM for database queries (keep it — type safety matters)

---

## Step 1: Manual Setup (Do This Before Running the Prompt)

### Create Supabase Project
1. Go to [supabase.com](https://supabase.com) → New Project
2. Name: `claims-iq-voice-inspector`
3. Set a strong database password (save it)
4. Region: closest to your users

### Collect These 4 Values
From **Project Settings → API**:
- `Project URL` → `SUPABASE_URL`
- `anon public` key → `SUPABASE_ANON_KEY`
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

From **Project Settings → Database → Connection string → URI**:
- PostgreSQL connection string → `DATABASE_URL`
- Use the **Transaction mode** pooler (port 6543)
- Format: `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`

### Create Storage Bucket
In **Supabase Dashboard → Storage**:
1. Create bucket: `claim-documents`
2. Private (not public)
3. Max file size: 50MB
4. Allowed MIME types: `application/pdf`

### Set Environment Variables in Replit
Replace the existing `DATABASE_URL` and add 3 new vars:
```env
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Keep `OPENAI_API_KEY` as-is.

---

## Step 2: Install Supabase Client

```bash
npm install @supabase/supabase-js
```

If `multer` and `@types/multer` are installed, remove them:
```bash
npm uninstall multer @types/multer
```

---

## Step 3: Push Schema to Supabase

The Drizzle schema (`shared/schema.ts`) is unchanged. Just push it to the new database:

```bash
npm run db:push
```

Verify all 4 tables exist in **Supabase Dashboard → Table Editor**: `claims`, `documents`, `extractions`, `briefings`.

If the schema has a `filePath` column on the `documents` table, rename it to `storagePath` (or add `storagePath` alongside it). The column should store the Supabase Storage path, e.g. `claims/1/fnol/document.pdf`. If the column is called `file_path` in the database, update the Drizzle schema to:

```typescript
storagePath: text("storage_path"),  // was filePath / file_path
```

Then run `npm run db:push` again.

---

## Step 4: Create Supabase Client Module

Create a new file: **`server/supabase.ts`**

```typescript
import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
}

// Server-side client uses service_role key to bypass Row Level Security
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const DOCUMENTS_BUCKET = "claim-documents";
```

---

## Step 5: Replace File Storage Operations

In **`server/storage.ts`**, find wherever files are saved to local disk and read from local disk. Replace those operations with Supabase Storage calls.

### Upload: Replace multer/local disk with Supabase Storage

Find the function that saves uploaded files (likely uses `fs.writeFile`, `multer`, or writes to `/tmp/`). Replace it with:

```typescript
import { supabase, DOCUMENTS_BUCKET } from "./supabase";

async function uploadDocument(
  claimId: number,
  documentType: string,
  fileBuffer: Buffer,
  fileName: string
): Promise<{ storagePath: string }> {
  const storagePath = `claims/${claimId}/${documentType}/${fileName}`;

  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: "application/pdf",
      upsert: true,  // overwrite if re-uploading same document type
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  return { storagePath };
}
```

### Download: Replace local disk read with Supabase Storage

Find the function that reads uploaded files for parsing (likely uses `fs.readFile`). Replace it with:

```typescript
async function downloadDocument(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(storagePath);

  if (error) throw new Error(`Storage download failed: ${error.message}`);

  // Convert Blob to Buffer
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
```

### Signed URL: Add for frontend document viewing (optional)

```typescript
async function getDocumentUrl(storagePath: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  if (error) throw new Error(`Signed URL failed: ${error.message}`);

  return data.signedUrl;
}
```

---

## Step 6: Update the Upload Route

In **`server/routes.ts`**, find the document upload endpoint (`POST /api/claims/:id/documents/upload`).

### If it currently uses multer middleware:

Remove the multer middleware from the route. Change the route to accept a JSON body with base64-encoded file data instead:

```typescript
// BEFORE (multer):
// router.post("/api/claims/:id/documents/upload", upload.single("file"), async (req, res) => {
//   const file = req.file;
//   ...
// });

// AFTER (base64 JSON body):
router.post("/api/claims/:id/documents/upload", async (req, res) => {
  const { fileName, fileBase64, documentType } = req.body;
  const claimId = parseInt(req.params.id);

  // Decode base64 to buffer
  // Strip data URL prefix if present: "data:application/pdf;base64,..."
  const base64Data = fileBase64.includes(",") ? fileBase64.split(",")[1] : fileBase64;
  const fileBuffer = Buffer.from(base64Data, "base64");

  // Upload to Supabase Storage
  const { storagePath } = await uploadDocument(claimId, documentType, fileBuffer, fileName);

  // Create document record in database
  const document = await createDocument(claimId, documentType, fileName, storagePath, fileBuffer.length);

  res.json({ documentId: document.id, storagePath, status: "uploaded" });
});
```

### Update the frontend upload call

In **`client/src/pages/DocumentUpload.tsx`**, find where files are sent to the server.

If it currently uses `FormData` with a file field, change it to read the file as base64 and send JSON:

```typescript
// Read file as base64
const reader = new FileReader();
reader.onload = async () => {
  const fileBase64 = reader.result as string;
  await uploadMutation.mutateAsync({
    fileName: file.name,
    fileBase64,
    documentType,
  });
};
reader.readAsDataURL(file);
```

Make sure the fetch call sends `Content-Type: application/json` (not `multipart/form-data`).

---

## Step 7: Update the Parse Route

In **`server/routes.ts`**, find the document parse endpoint (`POST /api/claims/:id/documents/:type/parse`).

Find where it reads the PDF file. It likely does something like:
```typescript
// BEFORE: reading from local disk
const fileBuffer = fs.readFileSync(document.filePath);
```

Replace with:
```typescript
// AFTER: download from Supabase Storage
const fileBuffer = await downloadDocument(document.storagePath);
```

The rest of the parse logic (pdf-parse → OpenAI → create extraction) stays exactly the same.

---

## Step 8: Clean Up Local File References

Search the codebase for any remaining references to:
- `multer`
- `fs.writeFile` or `fs.readFile` related to uploaded documents
- `/tmp/` paths for file storage
- `filePath` (should be `storagePath` now)

Remove or replace all of them. The only file I/O should now go through the Supabase Storage client.

---

## Step 9: Re-Seed Data

The old seed data was in Replit's PostgreSQL which is now disconnected. Run the seed again to create the Gold Standard claim in Supabase:

```
Claim Number: CLM-2024-00847
Insured: Robert & Sarah Penson
Property: 1847 Maple Ridge Drive, Sullivan, IN 47882
Date of Loss: March 14, 2024
Peril: Hail
Status: draft
```

If the seed runs on server startup when no claims exist, just restart the server. Otherwise trigger it manually.

---

## Verification Checklist

After migration, test the full flow:

- [ ] App loads → Claims List shows seeded Penson claim (data from Supabase PostgreSQL)
- [ ] Upload a FNOL PDF → check Supabase Dashboard → Storage → `claim-documents` bucket → file appears at `claims/1/fnol/...`
- [ ] Parse triggers → extraction appears in Supabase Dashboard → Table Editor → `extractions` table
- [ ] Upload + parse Policy and Endorsements
- [ ] Extraction Review shows real data with confidence indicators
- [ ] Confirm extractions → generate briefing → briefing appears in `briefings` table
- [ ] Inspection Briefing screen populates from Supabase data
- [ ] No references to local file paths remain in the codebase
- [ ] No `multer` in `package.json`

---

## What This Sets Up for PROMPT-03

With Supabase in place, the voice inspection phase (PROMPT-03) gets:
- **Supabase Realtime** — subscribe to inspection session state changes so the frontend updates live as the voice agent processes rooms
- **Supabase Storage** — photo uploads during inspection go to the same bucket infrastructure
- **Persistent data** — inspection results survive beyond Replit session lifetimes
- **Supabase Auth** (future) — adjuster authentication when moving from POC to production
