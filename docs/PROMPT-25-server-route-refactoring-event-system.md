# PROMPT-25 — Server Route Refactoring & Event System

## Context

The API surface lives in a single monolithic file — `server/routes.ts` — that has grown to **2,068 lines** (81,867 bytes) containing all 51 endpoints, 8 Zod validation schemas, 4 helper functions, and inline business logic. Every domain (claims, documents, extractions, inspections, rooms, damages, line items, photos, moisture, transcripts, realtime, completeness, data grouping, exports, pricing, auth, profile, settings, admin, supplementals) sits in one function body, making navigation painful and merge conflicts frequent.

Current state of the server directory (`server/`):

- `index.ts` (128 lines): Express setup, rate limiters (lines 29–51), `log()` function (lines 60–69), request logging middleware (lines 71–84), error handler (lines 90–101), calls `registerRoutes(httpServer, app)` at line 88
- `routes.ts` (2,068 lines): Single `registerRoutes(httpServer: Server, app: Express): Promise<Server>` function (line 123) containing ALL API handlers, returns `httpServer` at line 2067
- `storage.ts` (25,342 bytes): `IStorage` interface + `DatabaseStorage` class with 60+ methods, exported as singleton `storage`
- `auth.ts` (3,505 bytes): 4 middleware functions — `authenticateRequest`, `authenticateSupabaseToken`, `requireRole(...roles)`, `optionalAuth`
- `openai.ts` (12,872 bytes): `extractFNOL`, `extractPolicy`, `extractEndorsements`, `generateBriefing`
- `realtime.ts` (13,978 bytes): `buildSystemInstructions`, `realtimeTools` array (10 tool definitions)
- `estimateEngine.ts` (7,395 bytes): `lookupCatalogItem`, `getRegionalPrice`, `calculateLineItemPrice`, `calculateEstimateTotals`, `validateEstimate`, `getCompanionSuggestions`
- `esxGenerator.ts` (6,888 bytes): `generateESXFile`
- `db.ts` (436 bytes): Drizzle database connection
- `supabase.ts` (1,258 bytes): Supabase client + bucket constants
- No `server/routes/` directory exists yet

The 22 route groups in `routes.ts` with their line ranges:

| Domain | Lines | Routes | Endpoints |
|--------|-------|--------|-----------|
| Claims | 128–247 | 7 | GET/POST/DELETE claims |
| Documents | 249–520 | 11 | Upload, parse, batch, status |
| Extractions | 521–608 | 6 | GET/PUT/confirm extractions |
| Briefing | 610–662 | 2 | Generate + GET briefing |
| Inspection Sessions | 664–737 | 8 | Active/start/complete sessions |
| Rooms | 738–793 | 4 | Create/list/complete rooms |
| Damages | 794–831 | 2 | Create/list damages |
| Line Items | 832–925 | 6 | CRUD line items |
| Photos | 926–1116 | 3 | Upload/list/analyze photos |
| Moisture | 1117–1152 | 2 | Create/list readings |
| Transcripts | 1153–1177 | 2 | Add/get transcripts |
| Realtime | 1179–1242 | 1 | Create realtime session |
| Completeness | 1243–1380 | 1 | Session completeness check |
| Estimate Grouped | 1381–1420 | 1 | Grouped estimate view |
| Photos Grouped | 1422–1449 | 1 | Photos by room view |
| Export Validation | 1451–1632 | 6 | Validate/generate ESX/PDF/zip |
| Pricing | 1633–1745 | 6 | Catalog lookup, pricing, seed |
| Auth | 1746–1785 | 2 | Sync + me |
| Profile | 1786–1817 | 1 | PATCH profile |
| Settings | 1818–1879 | 2 | GET/PUT settings |
| Admin | 1880–1978 | 4 | Users, claims, role update, overview |
| Supplementals | 1979–2065 | 5 | CRUD + submit + export |

This prompt decomposes the monolith into domain-scoped router modules and adds a lightweight event emitter for cross-cutting concerns like audit logging and real-time notifications.

**Depends on**: PROMPT-22 (structured logging), all prior prompts

---

## Part A — Router Module Architecture

### A.1 — Create the Routes Directory Structure

Create the `server/routes/` directory with one file per domain group. Some smaller related domains are combined into a single module to avoid proliferation of tiny files:

```
server/routes/
├── index.ts              # Re-exports registerRoutes, wires all routers
├── claims.ts             # Claims CRUD (lines 128–247)
├── documents.ts          # Document upload/parse/status (lines 249–520)
├── extractions.ts        # Extraction CRUD + confirm (lines 521–608)
├── briefing.ts           # Briefing generate + get (lines 610–662)
├── inspection.ts         # Session management (lines 664–737)
├── rooms.ts              # Room CRUD (lines 738–793)
├── damages.ts            # Damage observations (lines 794–831)
├── lineItems.ts          # Line item CRUD (lines 832–925)
├── photos.ts             # Photo upload/list/analyze (lines 926–1116)
├── moisture.ts           # Moisture readings (lines 1117–1152)
├── transcripts.ts        # Voice transcripts (lines 1153–1177)
├── realtime.ts           # OpenAI realtime session (lines 1179–1242)
├── completeness.ts       # Completeness check (lines 1243–1380)
├── dataViews.ts          # Grouped estimate + grouped photos (lines 1381–1449)
├── exports.ts            # Export validation + ESX/PDF/zip (lines 1451–1632)
├── pricing.ts            # Catalog lookup, regional pricing, seed (lines 1633–1745)
├── auth.ts               # Auth sync + me (lines 1746–1785)
├── profile.ts            # Profile update (lines 1786–1817)
├── settings.ts           # User settings GET/PUT (lines 1818–1879)
├── admin.ts              # Supervisor/admin routes (lines 1880–1978)
└── supplementals.ts      # Supplemental claims (lines 1979–2065)
```

### A.2 — Router Module Pattern

Each domain file exports a factory function that receives Express `Router` from the caller (rather than the full `app`), keeping modules decoupled from the server instance. Here is the canonical pattern every module should follow:

```ts
// server/routes/claims.ts
import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authenticateRequest } from "../auth";

// Move domain-specific Zod schemas into the module that uses them.
// createClaimSchema was at routes.ts lines 28–38:
const createClaimSchema = z.object({
  claimNumber: z.string().min(1).max(50),
  insuredName: z.string().nullable().optional(),
  propertyAddress: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  dateOfLoss: z.string().nullable().optional(),
  perilType: z.string().nullable().optional(),
  status: z.string().optional(),
});

export function claimsRouter(): Router {
  const router = Router();

  // GET /api/claims
  router.get("/", authenticateRequest, async (req, res) => {
    try {
      const claims = await storage.getClaims();
      res.json(claims);
    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/claims/:id
  router.get("/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const claim = await storage.getClaim(id);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      res.json(claim);
    } catch (error: any) {
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/claims
  router.post("/", authenticateRequest, async (req, res) => {
    try {
      const parsed = createClaimSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid claim data",
          errors: parsed.error.flatten().fieldErrors,
        });
      }
      const claim = await storage.createClaim(parsed.data);
      res.status(201).json(claim);
    } catch (error: any) {
      if (error.message?.includes("duplicate")) {
        return res.status(409).json({ message: "Claim number already exists" });
      }
      console.error("Server error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ... remaining claim routes (DELETE /:id, DELETE /all, etc.)
  // Copy directly from routes.ts lines 128–247, adjusting paths:
  //   app.get("/api/claims", ...)  →  router.get("/", ...)
  //   app.get("/api/claims/:id", ...)  →  router.get("/:id", ...)

  return router;
}
```

**Key rules for every module**:

1. **Paths become relative**: `app.get("/api/claims/:id", ...)` becomes `router.get("/:id", ...)` because the base path is set when mounting.
2. **Schemas move with their routes**: Each module defines its own Zod schemas at the top of the file. The 8 schemas currently at routes.ts lines 14–67 distribute as follows:
   - `uploadBodySchema` (lines 14–18) → `documents.ts`
   - `batchUploadBodySchema` (lines 20–26) → `documents.ts`
   - `createClaimSchema` (lines 28–38) → `claims.ts`
   - `sessionUpdateSchema` (lines 40–45) → `inspection.ts`
   - `roomCreateSchema` (lines 47–53) → `rooms.ts`
   - `lineItemCreateSchema` (lines 55–67) → `lineItems.ts`
   - `profileUpdateSchema` (routes.ts lines 1788–1790) → `profile.ts`
   - `settingsBodySchema` (routes.ts lines 1831–1863) → `settings.ts`
   - Inline `allowedFields` schema in PATCH supplemental (lines 2018–2024) → `supplementals.ts`
3. **Helper functions move to shared utilities**: The 4 helper functions in routes.ts move as follows:
   - `claimFieldsFromFnol` (lines 73–89) → `documents.ts` (only used there)
   - `decodeBase64Payload` (lines 91–95) → `server/utils.ts` (new file, used by documents + photos)
   - `uploadToSupabase` (lines 97–112) → `server/utils.ts` (used by documents + photos)
   - `downloadFromSupabase` (lines 114–121) → `server/utils.ts` (used by documents + exports)
4. **Constants move to shared utilities**:
   - `MAX_DOCUMENT_BYTES` (line 69) → `server/utils.ts`
   - `MAX_PHOTO_BYTES` (line 70) → `server/utils.ts`

### A.3 — Create the Shared Utilities File

Create `server/utils.ts` to house the extracted helper functions and constants:

```ts
// server/utils.ts
import { supabase, DOCUMENTS_BUCKET } from "./supabase";

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;    // 10 MB

/**
 * Decode a base64 payload (optionally with data-URI prefix).
 * Returns the raw buffer and whether it exceeds the byte limit.
 */
export function decodeBase64Payload(
  base64Input: string,
  maxBytes: number
): { buffer: Buffer; wasTruncated: boolean } {
  const base64Data = base64Input.includes(",")
    ? base64Input.split(",")[1]
    : base64Input;
  const buffer = Buffer.from(base64Data, "base64");
  return { buffer, wasTruncated: buffer.length > maxBytes };
}

/**
 * Upload a file buffer to Supabase storage under the documents bucket.
 * Returns the storage path on success.
 */
export async function uploadToSupabase(
  claimId: number,
  documentType: string,
  fileBuffer: Buffer,
  fileName: string
): Promise<string> {
  const storagePath = `claims/${claimId}/${documentType}/${fileName}`;
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return storagePath;
}

/**
 * Download a file from Supabase storage and return it as a Buffer.
 */
export async function downloadFromSupabase(
  storagePath: string
): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(storagePath);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
```

### A.4 — Modules with External Dependencies

Some route modules import from other server files. Document exactly which imports each module needs beyond the standard `Router`, `storage`, and `auth`:

| Module | Additional Imports |
|--------|-------------------|
| `documents.ts` | `pdfParse` from `"pdf-parse"`, `extractFNOL`/`extractPolicy`/`extractEndorsements` from `"../openai"`, `uploadToSupabase`/`downloadFromSupabase`/`decodeBase64Payload`/`MAX_DOCUMENT_BYTES` from `"../utils"`, `supabase`/`DOCUMENTS_BUCKET` from `"../supabase"` |
| `briefing.ts` | `generateBriefing` from `"../openai"` |
| `photos.ts` | `supabase`/`PHOTOS_BUCKET` from `"../supabase"`, `decodeBase64Payload`/`MAX_PHOTO_BYTES` from `"../utils"` |
| `realtime.ts` | `buildSystemInstructions`/`realtimeTools` from the existing `"../realtime"` module |
| `exports.ts` | `generateESXFile` from `"../esxGenerator"`, `reviewEstimate` from `"../aiReview"`, `downloadFromSupabase` from `"../utils"` |
| `pricing.ts` | `lookupCatalogItem`/`getRegionalPrice`/`calculateLineItemPrice`/`calculateEstimateTotals`/`validateEstimate`/`getCompanionSuggestions` from `"../estimateEngine"` |
| `admin.ts` | `requireRole` from `"../auth"` (in addition to `authenticateRequest`) |
| `lineItems.ts` | `lookupCatalogItem`/`getRegionalPrice`/`calculateLineItemPrice` from `"../estimateEngine"` |
| All others | Only `Router`, `storage`, `authenticateRequest` (and `z` if they have schemas) |

### A.5 — Wire Everything in the Index Router

Create `server/routes/index.ts` to mount all domain routers under their base paths:

```ts
// server/routes/index.ts
import type { Express } from "express";
import type { Server } from "http";

import { claimsRouter } from "./claims";
import { documentsRouter } from "./documents";
import { extractionsRouter } from "./extractions";
import { briefingRouter } from "./briefing";
import { inspectionRouter } from "./inspection";
import { roomsRouter } from "./rooms";
import { damagesRouter } from "./damages";
import { lineItemsRouter } from "./lineItems";
import { photosRouter } from "./photos";
import { moistureRouter } from "./moisture";
import { transcriptsRouter } from "./transcripts";
import { realtimeRouter } from "./realtime";
import { completenessRouter } from "./completeness";
import { dataViewsRouter } from "./dataViews";
import { exportsRouter } from "./exports";
import { pricingRouter } from "./pricing";
import { authRouter } from "./auth";
import { profileRouter } from "./profile";
import { settingsRouter } from "./settings";
import { adminRouter } from "./admin";
import { supplementalsRouter } from "./supplementals";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ── Core domain ───────────────────────────────
  app.use("/api/claims", claimsRouter());
  app.use("/api/documents", documentsRouter());
  // Note: extractions are nested under /api/claims/:id/extractions
  // but since they use req.params.id, mount them on claims path:
  app.use("/api/claims", extractionsRouter());
  app.use("/api/claims", briefingRouter());

  // ── Inspection domain ─────────────────────────
  // Session routes split between /api/claims/:id/inspection and /api/inspection/:sessionId
  app.use("/api", inspectionRouter());
  app.use("/api/inspection", roomsRouter());
  app.use("/api/inspection", damagesRouter());
  app.use("/api/inspection", lineItemsRouter());
  app.use("/api/inspection", photosRouter());
  app.use("/api/inspection", moistureRouter());
  app.use("/api/inspection", transcriptsRouter());

  // ── Realtime & analysis ───────────────────────
  app.use("/api/realtime", realtimeRouter());
  app.use("/api/inspection", completenessRouter());
  app.use("/api/inspection", dataViewsRouter());
  app.use("/api/inspection", exportsRouter());

  // ── Pricing & catalog ─────────────────────────
  app.use("/api/pricing", pricingRouter());

  // ── User & auth ───────────────────────────────
  app.use("/api/auth", authRouter());
  app.use("/api", profileRouter());
  app.use("/api", settingsRouter());

  // ── Admin ─────────────────────────────────────
  app.use("/api/admin", adminRouter());

  // ── Supplementals ─────────────────────────────
  app.use("/api", supplementalsRouter());

  return httpServer;
}
```

**Critical**: The export signature — `registerRoutes(httpServer: Server, app: Express): Promise<Server>` — must match exactly what `server/index.ts` calls at line 88: `await registerRoutes(httpServer, app)`. The function receives `httpServer` only so it can return it; no WebSocket or HTTP-server-level work happens inside `registerRoutes` currently.

### A.6 — Path Mapping Reference

Since some domains have routes under multiple path prefixes, here is the exact mapping for each module's internal routes. The key insight: Express sub-routers receive the **remainder** of the path after the mount point.

**`inspection.ts`** (mounted on `/api`):
```ts
// Routes that start with /api/claims/:id/inspection/...
router.get("/claims/:id/inspection/active", ...);
router.post("/claims/:id/inspection/start", ...);

// Routes that start with /api/inspection/:sessionId
router.get("/inspection/:sessionId", ...);
router.patch("/inspection/:sessionId", ...);
router.post("/inspection/:sessionId/complete", ...);
```

**`rooms.ts`** (mounted on `/api/inspection`):
```ts
// /api/inspection/:sessionId/rooms → router.get("/:sessionId/rooms", ...)
router.get("/:sessionId/rooms", ...);
router.post("/:sessionId/rooms", ...);
router.patch("/:sessionId/rooms/:roomId/complete", ...);
router.get("/:sessionId/rooms/:roomId/damages", ...);
```

**`supplementals.ts`** (mounted on `/api`):
```ts
// /api/inspection/:sessionId/supplemental → router.post("/inspection/:sessionId/supplemental", ...)
router.post("/inspection/:sessionId/supplemental", ...);
router.get("/inspection/:sessionId/supplementals", ...);
// /api/supplemental/:id → router.patch("/supplemental/:id", ...)
router.patch("/supplemental/:id", ...);
router.post("/supplemental/:id/submit", ...);
router.post("/supplemental/:id/export/esx", ...);
```

For modules where all routes share a clean base path (claims, documents, auth, admin, pricing, settings), the mapping is straightforward — strip the base path and use relative paths on the router.

### A.7 — Update server/index.ts Import

In `server/index.ts`, update the import at line 3:

```ts
// BEFORE (line 3):
import { registerRoutes } from "./routes";

// AFTER:
import { registerRoutes } from "./routes/index";
```

No other changes to `server/index.ts` are needed — the rate limiters, `log()` function, middleware, and error handler all remain in `index.ts` since they are cross-cutting concerns that apply before route handling.

### A.8 — Delete the Monolith

After all modules are created, tested (see PROMPT-21 test suites), and confirmed working:

1. Delete `server/routes.ts` (the original 2,068-line file)
2. The new `server/routes/index.ts` now serves as the route registration entry point
3. Run the full test suite from PROMPT-21 to verify no regressions

---

## Part B — Event Emitter Foundation

### B.1 — Why an Event System

Several cross-cutting concerns in Claims IQ benefit from a pub/sub pattern rather than direct function calls:

- **Audit logging**: When a claim status changes, a line item is added, or a session completes, an audit trail should be written without cluttering route handlers
- **Real-time notifications**: Supervisors watching the dashboard should receive updates when inspections progress
- **Webhook delivery** (future): External systems may subscribe to claim lifecycle events
- **Cache invalidation**: When data changes, stale query caches could be proactively busted

Node.js has a built-in `EventEmitter` that handles this perfectly for a single-process server. If the application later scales horizontally, the emitter can be swapped for Redis pub/sub without changing the emission sites.

### B.2 — Create the Event Bus

Create `server/events.ts`:

```ts
// server/events.ts
import { EventEmitter } from "events";

// Increase max listeners since multiple subsystems subscribe
const bus = new EventEmitter();
bus.setMaxListeners(30);

// ── Event type definitions ──────────────────────

export interface ClaimEvent {
  type: "claim.created" | "claim.statusChanged" | "claim.deleted";
  claimId: number;
  userId?: string;
  meta?: Record<string, any>;
}

export interface InspectionEvent {
  type:
    | "inspection.started"
    | "inspection.completed"
    | "inspection.roomCreated"
    | "inspection.roomCompleted"
    | "inspection.damageAdded"
    | "inspection.lineItemAdded"
    | "inspection.lineItemUpdated"
    | "inspection.lineItemDeleted"
    | "inspection.photoUploaded";
  sessionId: number;
  claimId?: number;
  userId?: string;
  meta?: Record<string, any>;
}

export interface DocumentEvent {
  type: "document.uploaded" | "document.parsed" | "document.extractionConfirmed";
  documentId?: number;
  claimId: number;
  userId?: string;
  meta?: Record<string, any>;
}

export interface SupplementalEvent {
  type: "supplemental.created" | "supplemental.submitted" | "supplemental.approved";
  supplementalId: number;
  sessionId: number;
  userId?: string;
  meta?: Record<string, any>;
}

export type AppEvent = ClaimEvent | InspectionEvent | DocumentEvent | SupplementalEvent;

// ── Typed emission helper ───────────────────────

export function emit(event: AppEvent): void {
  bus.emit(event.type, event);
  // Also emit on a wildcard channel for catch-all subscribers (audit log)
  bus.emit("*", event);
}

// ── Typed subscription helpers ──────────────────

export function on(
  eventType: AppEvent["type"] | "*",
  handler: (event: AppEvent) => void
): void {
  bus.on(eventType, handler);
}

export function once(
  eventType: AppEvent["type"] | "*",
  handler: (event: AppEvent) => void
): void {
  bus.once(eventType, handler);
}

export function off(
  eventType: AppEvent["type"] | "*",
  handler: (event: AppEvent) => void
): void {
  bus.off(eventType, handler);
}
```

### B.3 — Add Event Emissions to Route Handlers

After extracting routes into modules (Part A), add `emit()` calls at mutation points. These are **additive** — they don't change existing behavior, just broadcast that something happened.

**In `server/routes/claims.ts`** — after successful create:
```ts
import { emit } from "../events";

// Inside POST / handler, after storage.createClaim succeeds:
const claim = await storage.createClaim(parsed.data);
emit({
  type: "claim.created",
  claimId: claim.id,
  userId: req.user?.id,
  meta: { claimNumber: claim.claimNumber },
});
res.status(201).json(claim);
```

**In `server/routes/inspection.ts`** — after session start:
```ts
import { emit } from "../events";

// Inside POST /claims/:id/inspection/start, after session creation:
const session = await storage.createInspectionSession(claimId);
emit({
  type: "inspection.started",
  sessionId: session.id,
  claimId,
  userId: req.user?.id,
});
```

**In `server/routes/inspection.ts`** — after session complete:
```ts
// Inside POST /inspection/:sessionId/complete:
const session = await storage.completeSession(sessionId);
if (session) {
  await storage.updateClaimStatus(session.claimId, "inspection_complete");
  emit({
    type: "inspection.completed",
    sessionId,
    claimId: session.claimId,
    userId: req.user?.id,
  });
}
```

**In `server/routes/rooms.ts`** — after room creation:
```ts
import { emit } from "../events";

// Inside POST /:sessionId/rooms:
const room = await storage.createRoom({ ...parsed.data, sessionId });
emit({
  type: "inspection.roomCreated",
  sessionId,
  userId: req.user?.id,
  meta: { roomId: room.id, roomName: room.name },
});
```

**In `server/routes/lineItems.ts`** — after line item creation:
```ts
import { emit } from "../events";

// Inside POST /:sessionId/line-items:
const item = await storage.createLineItem(data);
emit({
  type: "inspection.lineItemAdded",
  sessionId,
  userId: req.user?.id,
  meta: { lineItemId: item.id, category: item.category },
});
```

**In `server/routes/documents.ts`** — after successful parse:
```ts
import { emit } from "../events";

// After document parsing completes successfully:
emit({
  type: "document.parsed",
  claimId,
  documentId: doc.id,
  userId: req.user?.id,
  meta: { documentType: doc.documentType },
});
```

**In `server/routes/supplementals.ts`** — after supplemental creation and submission:
```ts
import { emit } from "../events";

// After createSupplementalClaim:
emit({
  type: "supplemental.created",
  supplementalId: supplemental.id,
  sessionId,
  userId: req.user?.id,
});

// After submitSupplemental:
emit({
  type: "supplemental.submitted",
  supplementalId: id,
  sessionId: supplemental.originalSessionId,
  userId: req.user?.id,
});
```

Apply the same pattern for all mutation endpoints. The `emit()` call should always come **after** the database operation succeeds but **before** `res.json()` — this ensures we only broadcast events for operations that actually committed.

### B.4 — Audit Log Subscriber

Create `server/subscribers/auditLog.ts` as the first event consumer:

```ts
// server/subscribers/auditLog.ts
import { on, type AppEvent } from "../events";

/**
 * Subscribes to all application events and logs them for audit purposes.
 * In production, this would write to a dedicated audit_logs table or
 * ship to an external logging service. For now, it uses structured console output
 * compatible with the Pino logger from PROMPT-22.
 */
export function registerAuditLogSubscriber(): void {
  on("*", (event: AppEvent) => {
    // Structured log entry for audit trail
    console.log(
      JSON.stringify({
        level: "info",
        msg: "audit_event",
        event: event.type,
        ...("claimId" in event && { claimId: event.claimId }),
        ...("sessionId" in event && { sessionId: event.sessionId }),
        ...("documentId" in event && { documentId: event.documentId }),
        ...("supplementalId" in event && { supplementalId: event.supplementalId }),
        userId: event.userId || "system",
        meta: event.meta || {},
        timestamp: new Date().toISOString(),
      })
    );
  });
}
```

**Note**: Once PROMPT-22's Pino logger is integrated, replace `console.log(JSON.stringify(...))` with a `logger.child({ subsystem: "audit" }).info(...)` call.

### B.5 — Register Subscribers at Startup

In `server/index.ts`, register all event subscribers before routes are mounted. Add after the rate limiter section (after line 58) and before the IIFE at line 86:

```ts
// Add this import at the top of server/index.ts:
import { registerAuditLogSubscriber } from "./subscribers/auditLog";

// Inside the async IIFE, before registerRoutes (before current line 88):
registerAuditLogSubscriber();
await registerRoutes(httpServer, app);
```

Create the directory `server/subscribers/` to hold event subscriber modules. Future subscribers (webhook delivery, real-time push to supervisor dashboard, cache invalidation) follow the same pattern: export a `register*Subscriber()` function that calls `on()` with event handlers.

---

## Part C — Type-Safe Request Augmentation

### C.1 — Fix the req.user Type

Currently, `authenticateRequest` in `server/auth.ts` sets `req.user` but TypeScript doesn't know about it. The Express `Request` type needs augmentation. Create or update `server/types.ts`:

```ts
// server/types.ts
import type { User } from "@shared/schema";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      supabaseUser?: {
        id: string;
        email: string;
        [key: string]: any;
      };
    }
  }
}
```

This file must be referenced by `tsconfig.json`. Ensure `server/types.ts` is included in the TypeScript compilation (it likely already is if `include` covers `server/**/*.ts`). The `declare global` augmentation works as a side effect — simply importing or including the file is enough.

If auth.ts currently uses `(req as any).user` or `(req as any).supabaseUser`, those casts can now be removed:

```ts
// BEFORE (in route handlers):
const userId = (req as any).user?.id;

// AFTER (with proper augmentation):
const userId = req.user?.id;
```

Search all route modules for `(req as any).supabaseUser` and `(req as any).user` patterns and replace them with the typed versions.

### C.2 — Shared Error Handler

Multiple route handlers repeat the same error-handling pattern: `console.error("Server error:", error); res.status(500).json(...)`. Extract this into a utility:

```ts
// Add to server/utils.ts:
import type { Response } from "express";

/**
 * Standard error response handler for route handlers.
 * Logs the error and sends a 500 response.
 */
export function handleRouteError(res: Response, error: any, context?: string): void {
  const prefix = context ? `[${context}] ` : "";
  console.error(`${prefix}Server error:`, error);
  if (!res.headersSent) {
    res.status(500).json({ message: "Internal server error" });
  }
}
```

Then in each route handler, replace:
```ts
// BEFORE:
} catch (error: any) {
  console.error("Server error:", error);
  res.status(500).json({ message: "Internal server error" });
}

// AFTER:
} catch (error: any) {
  handleRouteError(res, error, "claims.create");
}
```

The `context` string aids debugging by identifying which handler threw. This is optional but recommended — it's especially useful once Pino structured logging (PROMPT-22) replaces console.error, as the context becomes a searchable field.

---

## Part D — Migration Checklist

### D.1 — Step-by-Step Extraction Order

Extract routes in this order to minimize risk. After each step, run the test suite from PROMPT-21 and verify the affected endpoints:

1. **Create `server/utils.ts`** with helper functions (decodeBase64Payload, uploadToSupabase, downloadFromSupabase, constants). No routes change yet — this is purely additive.

2. **Create `server/events.ts`** and `server/subscribers/auditLog.ts`. Register the audit subscriber in index.ts. No routes change yet.

3. **Create `server/types.ts`** for Request augmentation. No routes change yet.

4. **Extract `server/routes/auth.ts`** (2 routes, no complex dependencies). Mount in new `server/routes/index.ts`. Update import in `server/index.ts`. Keep old `routes.ts` temporarily — comment out the auth routes there.

5. **Extract `server/routes/settings.ts`** (2 routes, self-contained schema).

6. **Extract `server/routes/profile.ts`** (1 route, self-contained schema).

7. **Extract `server/routes/admin.ts`** (4 routes, uses `requireRole`).

8. **Extract `server/routes/claims.ts`** (7 routes, one schema).

9. **Extract `server/routes/documents.ts`** (11 routes, most complex — has PDF parse, Supabase upload, OpenAI extraction, batch upload). This is the highest-risk extraction; test thoroughly.

10. **Extract `server/routes/extractions.ts`** (6 routes).

11. **Extract `server/routes/briefing.ts`** (2 routes).

12. **Extract `server/routes/inspection.ts`** (8 routes spanning two path prefixes).

13. **Extract `server/routes/rooms.ts`**, `damages.ts`, `lineItems.ts`, `moisture.ts`, `transcripts.ts` (small, similar pattern).

14. **Extract `server/routes/photos.ts`** (3 routes, Supabase photo upload + AI analysis).

15. **Extract `server/routes/realtime.ts`** (1 route, OpenAI Realtime API).

16. **Extract `server/routes/completeness.ts`** (1 route, long handler with business logic).

17. **Extract `server/routes/dataViews.ts`** (2 routes: grouped estimate + grouped photos).

18. **Extract `server/routes/exports.ts`** (6 routes: validate, ESX, PDF, zip, summary, AI review).

19. **Extract `server/routes/pricing.ts`** (6 routes: catalog lookup, regional, calculate, totals, validate, seed).

20. **Extract `server/routes/supplementals.ts`** (5 routes).

21. **Add `emit()` calls** to all mutation endpoints (Part B.3).

22. **Delete `server/routes.ts`** (the original monolith).

23. **Full regression test**: Run PROMPT-21 test suites, verify all 51 endpoints respond correctly, check audit log output.

### D.2 — Verification Commands

After completing the refactor, verify completeness:

```bash
# Count total route registrations across all modules (should be 51):
grep -r "router\.\(get\|post\|put\|patch\|delete\)" server/routes/*.ts | wc -l

# Ensure no routes remain in the old file (should not exist):
ls server/routes.ts 2>&1

# Verify the index mounts all routers:
grep "app.use" server/routes/index.ts | wc -l

# Check that all event emissions are in place:
grep -r "emit({" server/routes/*.ts | wc -l

# Run the full test suite:
npx vitest run
```

---

## Part E — Final Integration Checklist (All 25 Prompts)

This section provides a checklist tying together all 25 prompts in implementation order. Each prompt builds on the previous ones — check off each item as you complete it.

### Phase 1: Foundation (PROMPTs 1–5)
- [ ] **PROMPT-01**: Supabase auth integration, JWT middleware, role-based access
- [ ] **PROMPT-02**: Document upload pipeline (PDF parse, Supabase storage, status tracking)
- [ ] **PROMPT-03**: AI extraction engine (FNOL, policy, endorsements via GPT-4o)
- [ ] **PROMPT-04**: Inspection briefing generation (synthesize extractions into actionable briefing)
- [ ] **PROMPT-05**: Voice inspection session management (8-phase workflow, room/damage tracking)

### Phase 2: Inspection Core (PROMPTs 6–10)
- [ ] **PROMPT-06**: Real-time voice agent (OpenAI Realtime API, WebRTC, tool execution)
- [ ] **PROMPT-07**: Damage observation pipeline (categorization, severity, affected areas)
- [ ] **PROMPT-08**: Line item estimation (catalog lookup, regional pricing, O&P calculation)
- [ ] **PROMPT-09**: Photo capture and AI analysis (Supabase photo storage, damage classification)
- [ ] **PROMPT-10**: Moisture reading subsystem (readings, thresholds, room correlation)

### Phase 3: Review & Export (PROMPTs 11–15)
- [ ] **PROMPT-11**: Session completeness engine (gap detection, coverage verification)
- [ ] **PROMPT-12**: Estimate review and finalization (grouped views, AI review, adjustments)
- [ ] **PROMPT-13**: ESX/Xactimate export generation (XML structure, ZIP packaging)
- [ ] **PROMPT-14**: PDF report generation (inspection summary, photo evidence, estimate detail)
- [ ] **PROMPT-15**: Supplemental claims workflow (delta tracking, submit/approve/export)

### Phase 4: Management & UX (PROMPTs 16–20)
- [ ] **PROMPT-16**: Supervisor dashboard (team overview, claim pipeline, workload metrics)
- [ ] **PROMPT-17**: User settings and preferences (voice model, pricing defaults, export options)
- [ ] **PROMPT-18**: Admin panel (user management, role assignment, system overview)
- [ ] **PROMPT-19**: Document hub and extraction review UI (multi-document management, confirm/edit)
- [ ] **PROMPT-20**: Onboarding and inspection briefing UI (step-through briefing, claim context)

### Phase 5: Production Readiness (PROMPTs 21–25)
- [ ] **PROMPT-21**: Testing infrastructure (Vitest config, API route tests, component tests, E2E)
- [ ] **PROMPT-22**: Production hardening (Pino logging, Helmet/CORS, health checks, Docker, CI)
- [ ] **PROMPT-23**: API documentation (OpenAPI 3.0 spec, Swagger UI, data seeding, CONTRIBUTING.md)
- [ ] **PROMPT-24**: Offline resilience (code splitting, offline queue, Background Sync, online/offline awareness)
- [ ] **PROMPT-25**: Server route refactoring (domain modules, event bus, shared utilities, type safety)

### Implementation Notes

- **PROMPTs 1–20** build features incrementally. Each prompt's code should be committed and tested before proceeding.
- **PROMPTs 21–25** are infrastructure/quality prompts that can be applied in any order after the feature prompts, though the recommended order is 21 → 22 → 23 → 24 → 25 since testing (21) validates everything, logging (22) aids debugging, docs (23) help onboarding, offline (24) enhances UX, and refactoring (25) cleans up the codebase.
- **PROMPT-25 (this prompt)** should be the **last** prompt applied, since it restructures the file that every other prompt touches. Applying it last avoids merge conflicts during feature development.
- The event system (Part B) is designed to be extended. Future work could add: WebSocket push to supervisor dashboard, webhook delivery to external systems, or Redis pub/sub for horizontal scaling.

---

## Summary of Files Created/Modified

### New Files
| File | Purpose |
|------|---------|
| `server/routes/index.ts` | Route registration entry point (replaces monolithic routes.ts) |
| `server/routes/claims.ts` | Claims CRUD (7 routes) |
| `server/routes/documents.ts` | Document upload/parse/status (11 routes) |
| `server/routes/extractions.ts` | Extraction CRUD + confirm (6 routes) |
| `server/routes/briefing.ts` | Briefing generation + retrieval (2 routes) |
| `server/routes/inspection.ts` | Session management (8 routes) |
| `server/routes/rooms.ts` | Room CRUD (4 routes) |
| `server/routes/damages.ts` | Damage observations (2 routes) |
| `server/routes/lineItems.ts` | Line item CRUD (6 routes) |
| `server/routes/photos.ts` | Photo upload/analyze (3 routes) |
| `server/routes/moisture.ts` | Moisture readings (2 routes) |
| `server/routes/transcripts.ts` | Voice transcripts (2 routes) |
| `server/routes/realtime.ts` | OpenAI Realtime session (1 route) |
| `server/routes/completeness.ts` | Completeness check (1 route) |
| `server/routes/dataViews.ts` | Grouped estimate + photos (2 routes) |
| `server/routes/exports.ts` | Export validation + generation (6 routes) |
| `server/routes/pricing.ts` | Catalog/pricing/seed (6 routes) |
| `server/routes/auth.ts` | Auth sync + me (2 routes) |
| `server/routes/profile.ts` | Profile update (1 route) |
| `server/routes/settings.ts` | Settings GET/PUT (2 routes) |
| `server/routes/admin.ts` | Admin/supervisor routes (4 routes) |
| `server/routes/supplementals.ts` | Supplemental claims (5 routes) |
| `server/utils.ts` | Shared helpers (decode, upload, download, constants, error handler) |
| `server/events.ts` | Event bus with typed events |
| `server/types.ts` | Express Request augmentation |
| `server/subscribers/auditLog.ts` | Audit log event subscriber |

### Modified Files
| File | Change |
|------|--------|
| `server/index.ts` | Import path: `"./routes"` → `"./routes/index"`, add audit subscriber registration |

### Deleted Files
| File | Reason |
|------|--------|
| `server/routes.ts` | Replaced by `server/routes/` directory (21 domain modules + index) |
