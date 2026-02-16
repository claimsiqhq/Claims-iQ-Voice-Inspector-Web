# Codebase Audit 002

## Executive Summary
- **Total issues by severity:** Critical: 0 | High: 4 | Medium: 9 | Low: 6
- **Top 3 risks requiring immediate attention**
  1. Missing authentication/authorization on all API routes.
  2. Plaintext password storage in the `users` table.
  3. Weak request validation for core write paths (claims, sessions, rooms).
- **Overall production-readiness:** Not production-ready.

---

## Findings by Category

### 1) Data Layer Integrity
1. **Missing uniqueness constraints for primary business keys**
   - **Location:** `shared/schema.ts` (claims, documents, extractions)
   - **Severity:** Medium
   - **Description:** `claim_number` is not unique, and documents/extractions do not enforce `(claim_id, document_type)` uniqueness.
   - **Recommendation:** Add unique indexes for `claim_number` and composite unique indexes for `(claim_id, document_type)`.

2. **Referential integrity without delete cascades**
   - **Location:** `shared/schema.ts`
   - **Severity:** Low
   - **Description:** Foreign keys do not define `onDelete`, which can leave orphans if deletions are introduced.
   - **Recommendation:** Add explicit `onDelete: "cascade"` or `restrict` depending on policy.

3. **Migration tracking not visible in repo**
   - **Location:** `drizzle.config.ts`
   - **Severity:** Low
   - **Description:** Migrations directory is configured but not present in repo.
   - **Recommendation:** Check in migrations and enforce reversible migrations in CI.

---

### 2) API Surface Audit
1. **Missing authentication/authorization**
   - **Location:** `server/index.ts`, `server/routes.ts`
   - **Severity:** High
   - **Description:** All API routes are open with no auth or role checks.
   - **Recommendation:** Add authentication middleware and authorization policies for all `/api/*` routes.

2. **Weak request validation for core writes**
   - **Location:** `server/routes.ts` (claims creation, session update, room create)
   - **Severity:** High
   - **Description:** Write endpoints accept arbitrary body payloads without schema validation.
   - **Recommendation:** Apply Zod schemas to validate inputs and enforce required fields.

3. **Status lifecycle mismatch for inspection sessions**
   - **Location:** `server/storage.ts`, `server/routes.ts`
   - **Severity:** Medium
   - **Description:** `completeSession` sets status `"completed"` while status endpoint disallows it.
   - **Recommendation:** Align status validation with all possible status values.

4. **File upload failure not surfaced to clients**
   - **Location:** `server/routes.ts` (photo upload)
   - **Severity:** Medium
   - **Description:** Errors from Supabase are logged but still return `201` and create DB records.
   - **Recommendation:** Return error responses and avoid creating DB records when uploads fail.

5. **Inconsistent response envelopes**
   - **Location:** `server/routes.ts`
   - **Severity:** Low
   - **Description:** Mix of raw arrays and enveloped objects.
   - **Recommendation:** Standardize response format (`{ data, meta, error }`).

---

### 3) UI ↔ API Contract
1. **Per-type extraction endpoints appear unused**
   - **Location:** `server/routes.ts`, `client/src/pages/ExtractionReview.tsx`
   - **Severity:** Low
   - **Description:** UI uses bulk extraction endpoints only; per-type endpoints are unused.
   - **Recommendation:** Remove unused endpoints or add UI flows to use them.

2. **Missing UI error states for data fetch failures**
   - **Location:** `client/src/pages/ClaimsList.tsx`, `client/src/pages/DocumentUpload.tsx`
   - **Severity:** Medium
   - **Description:** Many screens lack `isError` handling and display no error UI.
   - **Recommendation:** Add error banners/toasts and retry actions for failed queries.

---

### 4) Feature Completeness
1. **Hardcoded depreciation logic**
   - **Location:** `server/storage.ts`
   - **Severity:** Medium
   - **Description:** Depreciation hardcoded to 15%.
   - **Recommendation:** Make configurable or policy-driven.

2. **Hardcoded AI model selection**
   - **Location:** `server/openai.ts`, `server/routes.ts`
   - **Severity:** Low
   - **Description:** AI models are fixed in code.
   - **Recommendation:** Move model names to environment variables.

3. **~~Unwired Replit integration routes~~** *(Resolved)*
   - **Location:** `server/replit_integrations/*` (removed)
   - **Severity:** Low
   - **Description:** Integration routes were removed as they were never registered.

---

### 5) State & Data Flow
1. **Infinite staleness in React Query cache**
   - **Location:** `client/src/lib/queryClient.ts`
   - **Severity:** Medium
   - **Description:** `staleTime: Infinity` prevents refetch unless manually invalidated.
   - **Recommendation:** Use finite `staleTime` (e.g., 30–120s).

2. **Potential reconnect loop without cleanup**
   - **Location:** `client/src/pages/ActiveInspection.tsx`
   - **Severity:** Low
   - **Description:** Reconnect `setTimeout` is not cleared on unmount.
   - **Recommendation:** Track timeout ID and clear on cleanup.

---

### 6) Security Surface
1. **Plaintext password storage**
   - **Location:** `shared/schema.ts`
   - **Severity:** High
   - **Description:** Passwords stored in plaintext.
   - **Recommendation:** Hash with Argon2/Bcrypt and migrate safely.

2. **Full response body logging (PII exposure)**
   - **Location:** `server/index.ts`
   - **Severity:** Medium
   - **Description:** Logs entire JSON response body for all API calls.
   - **Recommendation:** Redact sensitive fields or log metadata only.

3. **File uploads lack server-side content validation**
   - **Location:** `server/routes.ts` (document and photo uploads)
   - **Severity:** High
   - **Description:** Only presence of strings is validated; no size/type checks.
   - **Recommendation:** Enforce size, MIME/type, and signature validation server-side.

4. **No rate limiting or abuse protection**
   - **Location:** `server/index.ts`
   - **Severity:** Medium
   - **Description:** No rate limiting for expensive routes.
   - **Recommendation:** Add rate limiting and quotas.

---

### 7) Cross-Cutting Concerns
1. **Missing React error boundaries**
   - **Location:** `client/src/main.tsx`
   - **Severity:** Low
   - **Description:** No global error boundary.
   - **Recommendation:** Wrap `<App />` with an error boundary.

2. **Accessibility gaps in navigation**
   - **Location:** `client/src/components/Layout.tsx`
   - **Severity:** Low
   - **Description:** Search input and icon buttons lack `aria-label`.
   - **Recommendation:** Add `aria-label` attributes.

---

## Prioritized Remediation Checklist
**Immediate (High)**
1. Add authentication + authorization middleware for all `/api` routes.
2. Hash passwords and migrate existing credentials safely.
3. Validate all write endpoints with Zod schemas.
4. Enforce server-side upload validation (size/type/signature).

**Near-term (Medium)**
5. Add unique constraints for `claim_number` and `(claim_id, document_type)`.
6. Align inspection session status lifecycle.
7. Surface upload failures to clients and avoid partial DB writes.
8. Reduce log sensitivity by removing full JSON bodies.
9. Adjust React Query `staleTime` and add error UI states.

**Later (Low)**
10. Add error boundaries and accessibility improvements.
11. Track migrations in-repo and require reversibility.
12. Register or remove unused integration routes.
