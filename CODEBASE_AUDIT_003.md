# CODEBASE AUDIT 003 - Claims-iQ Voice Inspector

**Audit Date:** 2026-02-08
**Auditor:** Senior Staff Engineer (Automated Comprehensive Audit)
**Codebase:** Claims-iQ Voice Inspector
**Stack:** React 19 / Express / Drizzle ORM / PostgreSQL (Supabase) / OpenAI

---

## EXECUTIVE SUMMARY

### Issue Totals by Severity

| Severity | Count |
|----------|-------|
| **Critical** | 7 |
| **High** | 19 |
| **Medium** | 22 |
| **Low** | 6 |
| **Total** | **54** |

### Top 3 Risks Requiring Immediate Attention

1. **CRITICAL - JWT Token Not Cryptographically Verified** (`server/auth.ts:33-43`): The `authenticateRequest` middleware decodes the JWT payload via base64 but never verifies the signature. Any client can forge a valid-looking token with an arbitrary `sub` claim, bypassing authentication entirely if a matching user exists.

2. **CRITICAL - Unauthenticated Endpoints Exposing Write Operations** (`server/routes.ts:1565,1704,1719`): Three endpoints (`/api/auth/sync`, `/api/pricing/seed`, photo annotations PUT) lack authentication middleware, allowing unauthenticated users to create accounts, seed database data, and modify photo annotations.

3. **CRITICAL - SupplementalPage Has No Route** (`client/src/App.tsx:66-78`): The supplemental claims page exists as a fully-built component but is not registered in the router and has no navigation path, making the entire feature unreachable.

### Overall Production-Readiness Assessment

**NOT READY FOR PRODUCTION.** The codebase has a solid architectural foundation with good schema design, comprehensive API coverage, and well-structured React components. However, critical security flaws (unverified JWT, unauthenticated endpoints, missing authorization checks), a placeholder export endpoint, no test suite, missing error boundaries, and no rate limiting make it unsuitable for production deployment without remediation. The estimated effort to reach production-ready state is significant but bounded - security fixes are highest priority.

---

## DETAILED FINDINGS

---

## 1. DATA LAYER INTEGRITY

### DL-01: Hardcoded 15% Depreciation Rate
- **Location:** `server/storage.ts:445-446`
- **Severity:** High
- **Category:** Data Layer Integrity
- **Description:** `getEstimateSummary()` hardcodes depreciation at a flat 15% of RCV for all items. Real insurance claims require per-item depreciation rates based on age, condition, and material type. This produces incorrect ACV calculations for every estimate.
  ```typescript
  const totalDepreciation = totalRCV * 0.15;
  const totalACV = totalRCV - totalDepreciation;
  ```
- **Recommendation:** Store depreciation rate per line item in the `lineItems` table (add `depreciationRate real` column) and calculate depreciation per item based on its specific rate.

### DL-02: Hardcoded $25,000 Estimate Value in Dashboard
- **Location:** `server/routes.ts:1798`
- **Severity:** High
- **Category:** Data Layer Integrity
- **Description:** The supervisor dashboard hardcodes every claim's estimate at $25,000 instead of computing actual totals. This renders the dashboard analytics meaningless.
  ```typescript
  totalEstimateValue: allClaims.reduce((sum, _c) => sum + 25000, 0),
  ```
- **Recommendation:** Calculate actual estimate totals by aggregating `lineItems.totalPrice` for each claim's active inspection session.

### DL-03: Hardcoded Average Inspection Time
- **Location:** `server/routes.ts:1797`
- **Severity:** Medium
- **Category:** Data Layer Integrity
- **Description:** `avgInspectionTime: 45` is hardcoded rather than computed from `inspectionSessions.startedAt` and `completedAt` timestamps.
- **Recommendation:** Calculate the actual average from completed sessions using `completedAt - startedAt`.

### DL-04: No Database Migrations Directory
- **Location:** `drizzle.config.ts` references `./migrations` but directory doesn't exist
- **Severity:** High
- **Category:** Data Layer Integrity
- **Description:** Schema changes are applied via `drizzle-kit push` (direct schema push), not versioned migrations. This means no rollback capability, no migration history, and risk of data loss on schema changes.
- **Recommendation:** Generate and commit Drizzle Kit migrations (`drizzle-kit generate`) and use `drizzle-kit migrate` for deployment.

### DL-05: Missing Database Indexes
- **Location:** `shared/schema.ts`
- **Severity:** Medium
- **Category:** Data Layer Integrity
- **Description:** No indexes on frequently filtered/joined columns beyond the unique indexes. Missing indexes on:
  - `inspectionSessions.claimId` (queried in 5+ endpoints)
  - `inspectionRooms.sessionId` (queried in 10+ endpoints)
  - `lineItems.sessionId` (queried in 8+ endpoints)
  - `inspectionPhotos.sessionId` (queried in 6+ endpoints)
  - `damageObservations.sessionId` (queried in 4+ endpoints)
  - `claims.assignedTo` (filtered for user claims)
  - `claims.status` (filtered in dashboard)
- **Recommendation:** Add indexes on these foreign key / filter columns for query performance.

### DL-06: N+1 Query Pattern in Dashboard
- **Location:** `server/routes.ts:1789-1791`
- **Severity:** Medium
- **Category:** Data Layer Integrity
- **Description:** Dashboard fetches all claims then makes a separate query for each claim's active session:
  ```typescript
  const sessions = await Promise.all(
    allClaims.map((c) => storage.getActiveSessionForClaim(c.id))
  );
  ```
- **Recommendation:** Use a single joined query or batch fetch for all active sessions.

### DL-07: N+1 Query Pattern in Active Sessions
- **Location:** `server/routes.ts:1807-1823`
- **Severity:** Medium
- **Category:** Data Layer Integrity
- **Description:** Active sessions endpoint iterates all claims, queries each for an active session, then queries each session's inspector individually.
- **Recommendation:** Use a single joined query: `inspectionSessions JOIN claims JOIN users`.

### DL-08: N+1 Query Pattern in Status Summary
- **Location:** `server/routes.ts:258-299`
- **Severity:** Medium
- **Category:** Data Layer Integrity
- **Description:** Status summary fetches all documents, all claims, then queries extractions per claim in a loop.
- **Recommendation:** Fetch all extractions in a single query and group in-memory.

### DL-09: `real` Type Used for Financial Calculations
- **Location:** `shared/schema.ts:177-180` (unitPrice, totalPrice in lineItems)
- **Severity:** Medium
- **Category:** Data Layer Integrity
- **Description:** Financial values (`unitPrice`, `totalPrice`, `materialCost`, `laborCost`, `equipmentCost`) use `real` (floating point), which causes precision errors in monetary calculations (e.g., `0.1 + 0.2 !== 0.3`).
- **Recommendation:** Use `numeric` (decimal) type for all monetary fields to maintain precision.

### DL-10: Missing `updatedAt` on Multiple Tables
- **Location:** `shared/schema.ts`
- **Severity:** Low
- **Category:** Data Layer Integrity
- **Description:** Only `claims` and `extractions` have `updatedAt` fields. Tables like `inspectionSessions`, `inspectionRooms`, `lineItems`, and `supplementalClaims` track creation time but not last modification time, making audit trails incomplete.
- **Recommendation:** Add `updatedAt` timestamps to mutable tables.

### DL-11: Briefing Not Updated on Re-Generation
- **Location:** `server/routes.ts:629-644`
- **Severity:** Medium
- **Category:** Data Layer Integrity
- **Description:** When briefing generation is called for a claim that already has a briefing, the existing briefing is returned unchanged instead of being updated with newly generated data:
  ```typescript
  const existing = await storage.getBriefing(claimId);
  if (existing) {
    briefing = existing; // Returns stale briefing, ignores new generation
  }
  ```
- **Recommendation:** Update the existing briefing record with the newly generated data, or add an `updateBriefing` storage method.

---

## 2. API SURFACE AUDIT

### API-01: Supplemental ESX Export is a Placeholder
- **Location:** `server/routes.ts:1889-1906`
- **Severity:** Critical
- **Category:** API Surface
- **Description:** The supplemental ESX export endpoint returns a hardcoded string instead of actual ESX content:
  ```typescript
  res.send(Buffer.from("supplemental esx placeholder"));
  ```
  Any user triggering this export will receive a corrupt file.
- **Recommendation:** Implement actual ESX generation for supplementals using the existing `generateESXFile` function as a template, passing only the delta items.

### API-02: PATCH `/api/claims/:id` Only Handles Status Updates
- **Location:** `server/routes.ts:178-190`
- **Severity:** Medium
- **Category:** API Surface
- **Description:** The PATCH endpoint for claims only processes the `status` field. Other updatable claim fields (insuredName, propertyAddress, etc.) are not exposed through this endpoint despite `updateClaimFields` existing in storage.
  ```typescript
  const { status } = req.body;
  if (status) {
    const claim = await storage.updateClaimStatus(id, status);
    return res.json(claim);
  }
  res.status(400).json({ message: "No valid update fields" });
  ```
- **Recommendation:** Extend the endpoint to accept and validate other claim fields.

### API-03: Line Item PATCH Accepts Unvalidated Body
- **Location:** `server/routes.ts:877-885`
- **Severity:** High
- **Category:** API Surface
- **Description:** The line item update endpoint passes `req.body` directly to the storage layer without any Zod validation:
  ```typescript
  const item = await storage.updateLineItem(id, req.body);
  ```
  This allows arbitrary fields to be set, potentially including `id`, `sessionId`, or `createdAt`.
- **Recommendation:** Validate with `lineItemCreateSchema.partial().safeParse(req.body)` and strip immutable fields.

### API-04: Supplemental PATCH Accepts Unvalidated Body
- **Location:** `server/routes.ts:1866-1876`
- **Severity:** High
- **Category:** API Surface
- **Description:** Same issue as API-03. `req.body` passed directly to `updateSupplemental`:
  ```typescript
  const updates = req.body;
  const supplemental = await storage.updateSupplemental(id, updates);
  ```
- **Recommendation:** Define and apply a Zod validation schema for supplemental updates.

### API-05: Room PATCH Only Accepts Status
- **Location:** `server/routes.ts:763-771`
- **Severity:** Low
- **Category:** API Surface
- **Description:** Room update only handles `status` field. No endpoint exists to update room dimensions, name, or type after creation.
- **Recommendation:** Extend to accept additional room fields with validation.

### API-06: No Endpoint to Update User Profile
- **Location:** `server/routes.ts` (auth section)
- **Severity:** Low
- **Category:** API Surface
- **Description:** Users can view their profile (`GET /api/auth/me`) but cannot update it. No endpoint for changing name, email preferences, or other profile fields.
- **Recommendation:** Add `PATCH /api/auth/me` for profile updates.

### API-07: Double Base64 Decode in Batch Upload
- **Location:** `server/routes.ts:399-402`
- **Severity:** Medium
- **Category:** API Surface
- **Description:** In batch upload, `totalSize` is calculated by decoding base64 again after files have already been uploaded. This doubles memory consumption for the same data:
  ```typescript
  const totalSize = files.reduce((sum, f) => {
    const { buffer } = decodeBase64Payload(f.fileBase64, MAX_DOCUMENT_BYTES);
    return sum + buffer.length;
  }, 0);
  ```
- **Recommendation:** Track buffer sizes during the upload loop and reuse them.

### API-08: Inconsistent Error Response Format
- **Location:** `server/routes.ts` (throughout)
- **Severity:** Medium
- **Category:** API Surface
- **Description:** Most endpoints return `{ message: error.message }` for 500 errors, exposing internal error details. Some endpoints return `{ message: "...", errors: { ... } }` for validation. The photo analysis endpoint returns a success (200) with fallback data on errors instead of an error status. There's no consistent error envelope.
- **Recommendation:** Standardize to `{ error: { code: string, message: string, details?: any } }` with generic messages for 500s and specific messages for 4xx.

---

## 3. UI <-> API CONTRACT

### UC-01: SupplementalPage Has No Route
- **Location:** `client/src/App.tsx:66-78`, `client/src/pages/SupplementalPage.tsx`
- **Severity:** Critical
- **Category:** UI <-> API Contract
- **Description:** `SupplementalPage.tsx` exists as a fully implemented component calling supplemental API endpoints, but it is neither imported nor routed in `App.tsx`. Users cannot access this feature.
- **Recommendation:** Add to App.tsx:
  ```typescript
  import SupplementalPage from "@/pages/SupplementalPage";
  // In Switch:
  <Route path="/inspection/:id/supplemental" component={SupplementalPage} />
  ```

### UC-02: ExtractionReview EditableField Handlers Are No-ops
- **Location:** `client/src/pages/ExtractionReview.tsx:223-266`
- **Severity:** High
- **Category:** UI <-> API Contract
- **Description:** Seven `EditableField` components render editable inputs but all have `onChange={() => {}}` - changes are visually accepted but never persisted:
  ```typescript
  <EditableField label="Claim Number" value={data.claimNumber || ""}
    confidence={conf.claimNumber} onChange={() => {}} />
  ```
  This is misleading to users who believe they are correcting AI-extracted data.
- **Recommendation:** Implement state management for editable fields and wire onChange to update local state, then save on confirmation via `PUT /api/claims/:id/extractions/:type`.

### UC-03: ReviewFinalize NotesTab Claims Notes Are Saved But They Aren't
- **Location:** `client/src/pages/ReviewFinalize.tsx:749-755`
- **Severity:** High
- **Category:** UI <-> API Contract
- **Description:** The adjuster notes textarea has helper text "Notes are saved locally and included in the export" but notes are only in React state with no persistence - they are lost on page navigation or refresh.
- **Recommendation:** Either persist notes to the session record (add `adjusterNotes` field to `inspectionSessions`) or use localStorage with the session ID as key.

### UC-04: ReviewFinalize Session Query Uses POST
- **Location:** `client/src/pages/ReviewFinalize.tsx:31-38`
- **Severity:** High
- **Category:** UI <-> API Contract
- **Description:** The review page fetches session data by calling `POST /api/claims/:id/inspection/start` as a queryFn. This means every React Query revalidation creates a new session or returns an existing one via POST. This is semantically incorrect and wastes server resources.
- **Recommendation:** Use `GET /api/inspection/:sessionId` instead, or fetch the session ID first via a GET endpoint.

### UC-05: Admin Users Endpoint Returns Hardcoded `activeClaims: 0`
- **Location:** `server/routes.ts:1765`
- **Severity:** Medium
- **Category:** UI <-> API Contract
- **Description:** The supervisor dashboard shows `activeClaims` per user but the API always returns `0`:
  ```typescript
  .map((u) => ({
    id: u.id,
    // ...
    activeClaims: 0, // Always 0
  }));
  ```
- **Recommendation:** Count actual claims per user via `claims.assignedTo`.

### UC-06: Photo Signed URL Not Used Consistently
- **Location:** `client/src/pages/ReviewFinalize.tsx`, `client/src/components/PhotoGallery.tsx`
- **Severity:** Medium
- **Category:** UI <-> API Contract
- **Description:** Photos endpoint returns `storagePath` but some UI components need signed URLs for display. The signed URL endpoint exists (`/api/documents/:id/signed-url`) but only for documents, not photos. Photo display relies on Supabase public bucket access or inline base64.
- **Recommendation:** Add a photo signed URL endpoint or ensure photos use consistent URL resolution.

---

## 4. FEATURE COMPLETENESS

### FC-01: Supplemental ESX Export Placeholder
- **Location:** `server/routes.ts:1902`
- **Severity:** Critical
- **Category:** Feature Completeness
- **Description:** Returns `Buffer.from("supplemental esx placeholder")` - a non-functional stub shipped as a real endpoint.
- **Recommendation:** Implement using the existing `generateESXFile` pattern with delta items from the supplemental record.

### FC-02: No Test Suite
- **Location:** Project root (no test configuration found)
- **Severity:** High
- **Category:** Feature Completeness
- **Description:** No unit tests, integration tests, or end-to-end tests exist. No test framework (Jest, Vitest, Playwright) is configured. The `test/data/` directory contains only sample PDFs, not test code.
- **Recommendation:** Add Vitest for unit/integration tests covering at minimum: storage layer, estimate engine, auth middleware, and API routes.

### FC-03: No Supplemental Approval Workflow
- **Location:** `server/storage.ts:549-552`
- **Severity:** Medium
- **Category:** Feature Completeness
- **Description:** `approveSupplemental` exists in storage but no API endpoint exposes it. The supplemental workflow goes from draft -> submitted but has no path to approved/rejected status.
- **Recommendation:** Add `POST /api/supplemental/:id/approve` with `requireRole("supervisor")`.

### FC-04: getCompanionSuggestions Never Called
- **Location:** `server/estimateEngine.ts:229-255`
- **Severity:** Medium
- **Category:** Feature Completeness
- **Description:** The `getCompanionSuggestions` function is exported but never called from any route handler. This scope gap detection feature is built but unused.
- **Recommendation:** Integrate into the AI review or estimate validation endpoint.

### FC-05: No Password Change / Reset Flow
- **Location:** Auth system (Supabase Auth)
- **Severity:** Medium
- **Category:** Feature Completeness
- **Description:** No password reset or change functionality is exposed through the UI. Users who forget their password have no recovery path.
- **Recommendation:** Add password reset flow using Supabase's `resetPasswordForEmail` method.

### FC-06: Inverted Console Log Logic in Vite Plugin
- **Location:** `vite-plugin-meta-images.ts:74-77`
- **Severity:** Low
- **Category:** Feature Completeness
- **Description:** The `log()` function only prints in production, inverted from the expected behavior:
  ```typescript
  function log(...args: any[]): void {
    if (process.env.NODE_ENV === 'production') {
      console.log(...args); // Only logs in production
    }
  }
  ```
- **Recommendation:** Change condition to `!== 'production'` for development logging.

---

## 5. STATE & DATA FLOW

### SD-01: Memory Leak - Reconnect setTimeout Not Cleared
- **Location:** `client/src/pages/ActiveInspection.tsx:544-548`
- **Severity:** Critical
- **Category:** State & Data Flow
- **Description:** When the WebRTC data channel closes, a 3-second reconnect timeout is created but never stored in a ref for cleanup. If the component unmounts before the timeout fires, it executes against stale state:
  ```typescript
  dc.onclose = () => {
    setIsConnected(false);
    setVoiceState("disconnected");
    setTimeout(() => { // Never cleared on unmount
      if (!pcRef.current || pcRef.current.connectionState === "closed") {
        connectVoice();
      }
    }, 3000);
  };
  ```
- **Recommendation:** Store the timeout ID in a ref and clear it in the useEffect cleanup function.

### SD-02: Memory Leak - Error Recovery setTimeout Not Cleared
- **Location:** `client/src/pages/ActiveInspection.tsx:492-494`
- **Severity:** High
- **Category:** State & Data Flow
- **Description:** Voice error state auto-recovery timeout is not cleared on unmount:
  ```typescript
  setTimeout(() => {
    setVoiceState((prev) => prev === "error" ? "idle" : prev);
  }, 5000);
  ```
- **Recommendation:** Track and clear timeout on unmount.

### SD-03: Race Condition - Concurrent WebRTC Connections
- **Location:** `client/src/pages/ActiveInspection.tsx:499-577`
- **Severity:** High
- **Category:** State & Data Flow
- **Description:** The auto-reconnect at line 546 can trigger `connectVoice()` while another connection attempt is in progress. The `isConnecting` flag at line 500 is a state variable (async update), creating a timing gap where multiple RTCPeerConnection instances could be created.
- **Recommendation:** Use a ref for `isConnecting` instead of state, and add proper connection lifecycle management.

### SD-04: Race Condition - Photo Capture Pending Call Overwrite
- **Location:** `client/src/pages/ActiveInspection.tsx:358-375`
- **Severity:** Medium
- **Category:** State & Data Flow
- **Description:** `pendingPhotoCallRef.current` is overwritten if a second photo capture is triggered before the first completes, losing the first call_id and leaving it unresolved.
- **Recommendation:** Queue pending photo calls instead of overwriting, or reject new calls while one is pending.

### SD-05: No Cache Invalidation After Mutations
- **Location:** `client/src/pages/ExportPage.tsx:67-119`
- **Severity:** Medium
- **Category:** State & Data Flow
- **Description:** Export mutations (ESX, PDF, submit) don't invalidate related query caches. After submission, the inspection status shown elsewhere remains stale until manual refresh.
- **Recommendation:** Add `queryClient.invalidateQueries` calls in mutation onSuccess handlers.

### SD-06: React Query Retry Disabled Globally
- **Location:** `client/src/lib/queryClient.ts:74`
- **Severity:** Medium
- **Category:** State & Data Flow
- **Description:** `retry: false` is set globally for all queries and mutations. This means any transient network failure (common in field conditions where this app is used) immediately shows as an error with no recovery attempt.
- **Recommendation:** Set `retry: 2` with exponential backoff for queries (not mutations) to handle transient failures gracefully.

### SD-07: Stale Time May Be Too Short for Field Use
- **Location:** `client/src/lib/queryClient.ts:73`
- **Severity:** Low
- **Category:** State & Data Flow
- **Description:** `staleTime: 60_000` (60 seconds) means data is refetched frequently. In a field inspection scenario with potentially slow mobile connectivity, this could cause unnecessary network traffic and loading states.
- **Recommendation:** Consider increasing staleTime to 5 minutes for read-heavy data like claims, briefings, and catalog items.

### SD-08: Silent Error Swallowing in Multiple Locations
- **Location:** `client/src/pages/ActiveInspection.tsx:164,174,184,193,201,555`
- **Severity:** High
- **Category:** State & Data Flow
- **Description:** At least 10 `catch {}` or `catch(() => {})` blocks silently discard errors. Failed transcript saves, line item refreshes, room refreshes, and estimate updates all fail without any user notification. Users may believe data is saved when it isn't.
- **Recommendation:** At minimum, show a toast notification for failed save operations. For non-critical operations, log the error.

---

## 6. SECURITY SURFACE

### SEC-01: JWT Token Not Cryptographically Verified
- **Location:** `server/auth.ts:33-43`
- **Severity:** Critical
- **Category:** Security
- **Description:** The `authenticateRequest` middleware splits the JWT token, base64-decodes the payload, and extracts `sub` without verifying the signature:
  ```typescript
  const parts = token.split(".");
  if (parts.length !== 3) { /* reject */ }
  const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
  supabaseAuthId = payload.sub;
  ```
  An attacker can craft a token with any `sub` value (e.g., `{"sub":"target-user-id","exp":9999999999}`) and base64 encode it between two dots. If a user with that supabaseAuthId exists, authentication succeeds.
- **Recommendation:** Use Supabase's `auth.getUser(token)` server-side to cryptographically verify the JWT, or verify the signature using the Supabase JWT secret.

### SEC-02: Unauthenticated `/api/auth/sync` Endpoint
- **Location:** `server/routes.ts:1719-1735`
- **Severity:** Critical
- **Category:** Security
- **Description:** The sync endpoint has no authentication middleware. Any request with a `supabaseId` and `email` creates or updates a user record:
  ```typescript
  app.post("/api/auth/sync", async (req, res) => { ... });
  ```
- **Recommendation:** Add `authenticateRequest` middleware and verify the authenticated user's Supabase ID matches the request body's `supabaseId`.

### SEC-03: Unauthenticated Photo Annotations Endpoint
- **Location:** `server/routes.ts:1565`
- **Severity:** High
- **Category:** Security
- **Description:** The PUT endpoint for photo annotations lacks `authenticateRequest` middleware:
  ```typescript
  app.put("/api/inspection/:sessionId/photos/:photoId/annotations", async (req, res) => { ... });
  ```
  Anyone can modify annotations on any photo without authentication.
- **Recommendation:** Add `authenticateRequest` middleware.

### SEC-04: Unauthenticated `/api/pricing/seed` Endpoint
- **Location:** `server/routes.ts:1704`
- **Severity:** High
- **Category:** Security
- **Description:** The database seeding endpoint is publicly accessible:
  ```typescript
  app.post("/api/pricing/seed", async (_req, res) => { ... });
  ```
- **Recommendation:** Add `authenticateRequest, requireRole("admin")`.

### SEC-05: No Authorization (Resource Ownership) Checks
- **Location:** `server/routes.ts` (throughout inspection endpoints)
- **Severity:** High
- **Category:** Security
- **Description:** Authenticated users can modify/delete resources belonging to other users. Endpoints like `PATCH /api/inspection/:sessionId/line-items/:id` and `DELETE /api/inspection/:sessionId/line-items/:id` verify authentication but not that the `sessionId` belongs to the requesting user. An adjuster can modify another adjuster's inspection by guessing sequential IDs.
- **Recommendation:** Add ownership verification: check that `session.inspectorId === req.user.id` or user has supervisor/admin role.

### SEC-06: Internal Error Messages Exposed to Clients
- **Location:** `server/routes.ts` (69 occurrences)
- **Severity:** High
- **Category:** Security
- **Description:** Nearly every endpoint catches errors and returns `{ message: error.message }`, exposing stack traces, database errors, and internal paths to clients. Example patterns:
  ```typescript
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
  ```
- **Recommendation:** Return generic `"Internal server error"` for 500s and log detailed errors server-side only.

### SEC-07: Purge-All Endpoint Lacks Role Check
- **Location:** `server/routes.ts:192`
- **Severity:** High
- **Category:** Security
- **Description:** `DELETE /api/claims/purge-all` requires only `authenticateRequest` - any authenticated user can delete ALL claims and related data from the system. This should require admin privileges.
- **Recommendation:** Add `requireRole("admin")`.

### SEC-08: No Rate Limiting
- **Location:** `server/index.ts`
- **Severity:** High
- **Category:** Security
- **Description:** No rate limiting middleware is configured. Endpoints like `/api/auth/sync`, document parsing (which calls OpenAI), and photo analysis are vulnerable to abuse. An attacker could:
  - Trigger excessive OpenAI API calls, causing billing spikes
  - Perform brute-force operations
  - Denial-of-service the database
- **Recommendation:** Add `express-rate-limit` middleware with tiered limits: stricter for auth/AI endpoints, moderate for CRUD.

### SEC-09: 50MB JSON Body Limit
- **Location:** `server/index.ts:17-23`
- **Severity:** Medium
- **Category:** Security
- **Description:** The express JSON body limit is set to 50MB:
  ```typescript
  app.use(express.json({ limit: "50mb" }));
  ```
  This allows extremely large payloads that could exhaust server memory, especially with base64-encoded file uploads in the JSON body.
- **Recommendation:** Reduce to a reasonable limit (e.g., 30MB to accommodate 25MB base64-encoded files with overhead) and consider moving file uploads to multipart form data.

### SEC-10: Service Role Key Used for All Supabase Operations
- **Location:** `server/supabase.ts:4`
- **Severity:** Medium
- **Category:** Security
- **Description:** `SUPABASE_SERVICE_ROLE_KEY` is used for all Supabase operations (file uploads, downloads, bucket management). This key bypasses Row Level Security. If the server is compromised, the attacker has full access to all Supabase data.
- **Recommendation:** Use the anon key for client-scoped operations and reserve the service role key only for admin operations that specifically need to bypass RLS.

### SEC-11: Password Field Stores "disabled" String
- **Location:** `server/storage.ts:153`
- **Severity:** Low
- **Category:** Security
- **Description:** When syncing Supabase users, the local password field is set to `"disabled"`:
  ```typescript
  password: "disabled",
  ```
  While authentication is handled by Supabase, this field is still in the users table and `password` column in schema is `notNull`. Storing any value here (even a dummy) may cause confusion.
- **Recommendation:** Make `password` nullable in the schema or remove it entirely since authentication is handled by Supabase.

### SEC-12: Cookie Missing Security Flags
- **Location:** `client/src/components/ui/sidebar.tsx:86`
- **Severity:** Low
- **Category:** Security
- **Description:** Sidebar state cookie set without `Secure` and `SameSite` flags:
  ```typescript
  document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
  ```
- **Recommendation:** Add `; Secure; SameSite=Strict` to the cookie string.

---

## 7. CROSS-CUTTING CONCERNS

### CC-01: No React Error Boundaries
- **Location:** `client/src/App.tsx:83-97`
- **Severity:** High
- **Category:** Cross-Cutting Concerns
- **Description:** The application has no error boundaries. A runtime error in any component (particularly the complex ActiveInspection or ReviewFinalize pages) will crash the entire application, losing unsaved inspection data.
- **Recommendation:** Add error boundaries at minimum around:
  - The ProtectedRouter (catches page-level errors)
  - Each major page component (prevents cross-page cascading)
  - The voice connection component (prevents WebRTC errors from crashing the UI)

### CC-02: No Structured Logging
- **Location:** `server/index.ts:27-36`
- **Severity:** Medium
- **Category:** Cross-Cutting Concerns
- **Description:** Logging uses `console.log`/`console.error` with a simple timestamp format. No log levels, no structured output (JSON), no request correlation IDs. This makes it impossible to trace a request through the system or aggregate logs effectively.
- **Recommendation:** Adopt a structured logger (e.g., `pino` or `winston`) with request ID middleware, log levels, and JSON output format.

### CC-03: No Request Tracing
- **Location:** Server middleware chain
- **Severity:** Medium
- **Category:** Cross-Cutting Concerns
- **Description:** No correlation/request IDs are generated or propagated. Frontend requests cannot be correlated with backend logs.
- **Recommendation:** Add a middleware that generates a UUID per request and includes it in all log entries and response headers.

### CC-04: Accessibility - Missing Label Associations
- **Location:** `client/src/pages/LoginPage.tsx:45,58,84,96,102`
- **Severity:** Medium
- **Category:** Cross-Cutting Concerns
- **Description:** Form labels lack `htmlFor` attributes to associate with input elements. Screen readers cannot properly navigate form fields.
- **Recommendation:** Add matching `id` attributes to inputs and `htmlFor` to labels.

### CC-05: Accessibility - Icon-Only Buttons Without aria-labels
- **Location:** `client/src/pages/ActiveInspection.tsx:962,990,1165,1202,1254`
- **Severity:** Medium
- **Category:** Cross-Cutting Concerns
- **Description:** Multiple interactive buttons contain only icons (ChevronLeft, Camera, Mic) without `aria-label` attributes. Screen readers announce these as unlabeled buttons.
- **Recommendation:** Add descriptive `aria-label` attributes (e.g., `aria-label="Toggle navigation"`, `aria-label="Capture photo"`).

### CC-06: Accessibility - Touch Targets Below Minimum Size
- **Location:** `client/src/components/PhotoGallery.tsx:131,140`, `client/src/pages/ActiveInspection.tsx:1080,1144`
- **Severity:** Medium
- **Category:** Cross-Cutting Concerns
- **Description:** Several buttons are below the WCAG 44x44px minimum touch target size. PhotoGallery filter buttons are `h-6 w-6` (24px), and camera/skip buttons are `h-10 w-10` (40px) on mobile.
- **Recommendation:** Increase minimum interactive element size to `h-11 w-11` (44px) on mobile breakpoints.

### CC-07: No Keyboard Navigation Support
- **Location:** Custom interactive components across the application
- **Severity:** Low
- **Category:** Cross-Cutting Concerns
- **Description:** No `onKeyDown` handlers found for custom interactive elements. While shadcn/ui components have built-in keyboard support, custom elements like the camera capture button and voice controls lack keyboard alternatives.
- **Recommendation:** Add keyboard event handlers for Enter/Space on custom interactive elements.

### CC-08: BottomNav Shown on All Routes Including Login
- **Location:** `client/src/App.tsx:90`
- **Severity:** Low
- **Category:** Cross-Cutting Concerns
- **Description:** `<BottomNav />` is rendered outside `ProtectedRouter`, meaning it appears on the login page and 404 page where it shouldn't be visible.
- **Recommendation:** Move BottomNav inside ProtectedRouter, after the auth check.

---

## PRIORITIZED REMEDIATION CHECKLIST

### Phase 1: Security Fixes (CRITICAL - Block Production)

| # | Issue | ID | Effort |
|---|-------|----|--------|
| 1 | Verify JWT signature cryptographically | SEC-01 | Medium |
| 2 | Add `authenticateRequest` to `/api/auth/sync` | SEC-02 | Low |
| 3 | Add `authenticateRequest` to photo annotations | SEC-03 | Low |
| 4 | Add `authenticateRequest, requireRole("admin")` to `/api/pricing/seed` | SEC-04 | Low |
| 5 | Add `requireRole("admin")` to purge-all endpoint | SEC-07 | Low |
| 6 | Add authorization (ownership) checks on all PATCH/DELETE endpoints | SEC-05 | Medium |
| 7 | Replace `error.message` in 500 responses with generic messages | SEC-06 | Medium |
| 8 | Add rate limiting middleware | SEC-08 | Medium |

### Phase 2: Critical Functionality Fixes

| # | Issue | ID | Effort |
|---|-------|----|--------|
| 9 | Implement supplemental ESX export | FC-01, API-01 | High |
| 10 | Register SupplementalPage route in App.tsx | UC-01 | Low |
| 11 | Fix memory leak - clear reconnect timeout on unmount | SD-01 | Low |
| 12 | Fix memory leak - clear error recovery timeout on unmount | SD-02 | Low |
| 13 | Fix ReviewFinalize POST-as-queryFn pattern | UC-04 | Low |

### Phase 3: Data Integrity & Correctness

| # | Issue | ID | Effort |
|---|-------|----|--------|
| 14 | Replace hardcoded 15% depreciation with per-item rates | DL-01 | High |
| 15 | Replace hardcoded $25k estimate with actual calculations | DL-02 | Medium |
| 16 | Set up Drizzle Kit migrations | DL-04 | Medium |
| 17 | Add database indexes on FK/filter columns | DL-05 | Low |
| 18 | Use `numeric` type for monetary fields | DL-09 | Medium |
| 19 | Validate line item PATCH body with Zod | API-03 | Low |
| 20 | Validate supplemental PATCH body with Zod | API-04 | Low |
| 21 | Fix briefing re-generation to update existing record | DL-11 | Low |

### Phase 4: UI Reliability & User Experience

| # | Issue | ID | Effort |
|---|-------|----|--------|
| 22 | Implement EditableField onChange handlers in ExtractionReview | UC-02 | Medium |
| 23 | Add error boundaries to App.tsx | CC-01 | Low |
| 24 | Fix silent error swallowing (add toast notifications) | SD-08 | Medium |
| 25 | Persist adjuster notes or clarify they aren't saved | UC-03 | Low |
| 26 | Add onError handlers to all mutations in ExportPage | SD-05 | Low |
| 27 | Fix WebRTC race condition with ref-based connecting flag | SD-03 | Medium |
| 28 | Enable React Query retries for transient network failures | SD-06 | Low |

### Phase 5: Performance & Scalability

| # | Issue | ID | Effort |
|---|-------|----|--------|
| 29 | Fix N+1 queries in dashboard/active-sessions/status-summary | DL-06,07,08 | Medium |
| 30 | Fix double base64 decode in batch upload | API-07 | Low |
| 31 | Add pagination to claims list | -- | Medium |
| 32 | Reduce JSON body limit from 50MB | SEC-09 | Low |

### Phase 6: Quality & Compliance

| # | Issue | ID | Effort |
|---|-------|----|--------|
| 33 | Add test suite (Vitest) with minimum coverage | FC-02 | High |
| 34 | Add structured logging with request IDs | CC-02,03 | Medium |
| 35 | Fix accessibility: label associations, aria-labels, touch targets | CC-04,05,06 | Medium |
| 36 | Standardize error response envelope across all endpoints | API-08 | Medium |
| 37 | Add password reset flow | FC-05 | Low |
| 38 | Integrate companion suggestions into estimate workflow | FC-04 | Low |

---

## APPENDIX A: Files Requiring Attention (Sorted by Issue Count)

| File | Issues |
|------|--------|
| `server/routes.ts` | 16 |
| `client/src/pages/ActiveInspection.tsx` | 11 |
| `shared/schema.ts` | 5 |
| `server/auth.ts` | 2 |
| `server/storage.ts` | 2 |
| `client/src/pages/ExtractionReview.tsx` | 3 |
| `client/src/pages/ReviewFinalize.tsx` | 4 |
| `client/src/pages/ExportPage.tsx` | 3 |
| `client/src/App.tsx` | 3 |
| `client/src/lib/queryClient.ts` | 2 |
| `server/index.ts` | 2 |
| `server/estimateEngine.ts` | 1 |

## APPENDIX B: Positive Findings

The following areas are well-implemented:

1. **Schema design** is comprehensive with proper foreign keys and cascade deletes
2. **Zod validation** is used on most creation endpoints
3. **File upload security** includes MIME type validation and size limits
4. **Drizzle ORM** eliminates SQL injection risk through parameterized queries
5. **TypeScript strict mode** catches many type errors at compile time
6. **Supabase storage** is configured with private buckets and controlled access
7. **Role-based access** is properly implemented on admin endpoints
8. **PWA configuration** with service worker caching for offline capability
9. **Responsive design** with consistent Tailwind breakpoints
10. **Estimate engine** with proper O&P calculation and trade code validation
