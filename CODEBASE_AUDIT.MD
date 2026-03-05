# Claims IQ — Production-Readiness, Security & Operability Audit

**Audit Date:** 2026-03-05
**Auditor:** Senior Staff Engineer (automated code audit)
**Branch:** `cursor/codebase-audit-79c0`
**Repo Snapshot:** Current HEAD on audit branch

---

## Audit Method — Commands & Searches Performed

| Search / Inspection | Purpose |
|---|---|
| `find` all `.ts`, `.tsx`, `.sql`, `.json`, `.env*`, `.yml` files | Map repo structure |
| Read `server/auth.ts`, `localAuth.ts`, `authorization.ts` | Auth model |
| Read all 18 route files under `server/routes/` | Endpoint inventory |
| Read `shared/schema.ts`, `database_dump.sql`, `migrations/` | Data model + schema drift |
| `grep TODO/FIXME/HACK/XXX` across `*.ts`, `*.tsx` | Stubbed/incomplete code |
| `grep eval\|Function\|child_process\|exec` | Injection risks |
| `grep dangerouslySetInnerHTML` across client | XSS risks |
| `grep password\|secret\|apiKey\|token` in route files | Credential exposure |
| `grep \.limit\|\.offset\|pagination\|page` in server | Pagination enforcement |
| `grep transaction\|BEGIN\|COMMIT` in server | Transaction boundaries |
| `grep csrf\|xsrf` across codebase | CSRF protection |
| `npm audit --production` | Known CVEs |
| Read `Dockerfile`, `docker-compose.yml`, `.replit`, `.env.example` | Deploy/env config |
| Read all test files (`tests/`, `test/`, `e2e/`) | Test coverage map |
| Read `client/src/contexts/AuthContext.tsx`, `queryClient.ts` | Client auth/state |
| Read `server/supabase.ts`, `db.ts`, `storage.ts` | DB/storage patterns |
| Counted `any` type usage per file | Type safety assessment |
| Read `server/index.ts` | Middleware stack, rate limiting, CSP, CORS |
| Read `server/sanitize.ts`, `server/utils.ts` | Input sanitization |

---

# Phase 0 — System Map

## Repository Structure

```
/workspace
├── client/src/           # React 19 SPA (Vite, wouter router, TanStack Query)
│   ├── components/       # 29 feature components + 55 UI primitives (Radix/shadcn)
│   ├── pages/            # 20 page components (lazy-loaded)
│   ├── hooks/            # 5 custom hooks (toast, settings, online, mobile, offline-sync)
│   ├── contexts/         # AuthContext
│   └── lib/              # queryClient, offlineQueue, supabaseClient, logger, etc.
├── server/               # Express 5 API server (TypeScript, tsx runner)
│   ├── routes/           # 18 route modules
│   ├── workflow/          # Workflow orchestrator + types
│   ├── subscribers/       # Event-driven audit log
│   └── (30+ service files)
├── shared/               # Shared schema (Drizzle ORM) + contracts
│   ├── schema.ts         # 50+ Drizzle table definitions
│   ├── contracts/        # workflow, tools, errors
│   └── models/           # chat model
├── migrations/           # SQL migration files (Drizzle Kit)
├── supabase/             # Supabase config, seed data
├── tests/                # Vitest test suites (server, client, e2e)
├── test/                 # Additional Vitest test suites (engines, services)
├── e2e/                  # Playwright smoke tests
├── script/               # Build, seed, migration scripts
└── docs/                 # Developer guides, OpenAPI spec, PRDs
```

## Runtime Architecture

```
┌─────────────┐         ┌──────────────────────┐         ┌──────────────┐
│  React SPA  │◄──────►│   Express 5 API       │◄──────►│  PostgreSQL  │
│  (Vite PWA) │  HTTP   │   (Node 20, tsx)      │ Drizzle │  (Supabase)  │
│  Port 5000  │         │   Port 5000           │   ORM   │              │
└─────────────┘         ├──────────────────────┤         └──────────────┘
                        │ External Services:    │
                        │ • Supabase Auth       │         ┌──────────────┐
                        │ • Supabase Storage    │◄──────►│  OpenAI API  │
                        │ • OpenAI (GPT-4.1)    │         │  (Chat+Vision│
                        │ • OpenAI Realtime     │         │   +Realtime) │
                        │ • Visual Crossing     │         └──────────────┘
                        │ • Nominatim Geocoding │
                        │ • Microsoft 365 Graph │
                        └──────────────────────┘
```

## Auth Model

- **Dual auth**: Local JWT (bcrypt + jsonwebtoken) OR Supabase Auth
- **Token**: Bearer token in `Authorization` header
- **Middleware**: `authenticateRequest` (all protected routes), `requireRole(...)` for RBAC
- **Roles**: `adjuster`, `supervisor`, `admin`
- **Session**: Stateless JWT (7-day expiry), stored in localStorage/sessionStorage
- **Authorization**: Object-level via `canAccessClaim()`, `requireSessionAccess()`, etc.

## Data Model Overview

**Core entities**: `users` → `claims` → `inspection_sessions` → `rooms` → `line_items` / `damages` / `photos` / `scope_items`

**Supporting**: `documents`, `extractions`, `briefings`, `policy_rules`, `tax_rules`, `supplemental_claims`, `standalone_photos`, `moisture_readings`, `test_squares`, `voice_transcripts`, `sketch_annotations`, `room_adjacencies`, `room_openings`, `structures`

**Pricing catalog**: `scope_line_items`, `scope_trades`, `regional_price_sets` + 21 Xactimate tables

**Tenancy**: Single-tenant application with per-user claim assignment (no org/company entity)

## Request Lifecycle

1. Client calls API via `fetch` / TanStack Query with Bearer token
2. Express receives request → helmet → CORS → JSON parse → pino-http → rate limiter
3. Route handler → `authenticateRequest` middleware validates JWT
4. Authorization check (claim/session ownership or privileged role)
5. Zod schema validation on request body
6. Drizzle ORM query → PostgreSQL
7. Optional: Supabase Storage operations, OpenAI calls
8. JSON response → client → React Query cache

## Environments & Deploy Target

- **Primary**: Replit Autoscale (Cloud Run equivalent)
- **Database**: Supabase-hosted PostgreSQL
- **Storage**: Supabase Storage buckets
- **Dev**: `npm run dev` with tsx + Vite HMR
- **Prod**: `npm run build` → `node dist/index.cjs`
- **Docker**: Dockerfile present for containerized deployment

## Critical Flows (Top 10)

1. **User Registration & Login** — `/api/auth/register`, `/api/auth/login`, `/api/auth/sync`
2. **Claim Creation** — POST `/api/claims` → auto-geocode → SLA assignment
3. **Document Upload & Extraction** — Upload PDF → OpenAI extraction → confirmation
4. **Briefing Generation** — POST `/api/claims/:id/briefing/generate` → OpenAI summarization
5. **Inspection Session Start** — POST `/api/claims/:id/inspection/start` → workflow init
6. **Voice-Guided Inspection** — POST `/api/realtime/session` → OpenAI Realtime → tool calls
7. **Photo Upload & AI Analysis** — Upload photo → GPT-4 Vision → damage detection
8. **Scope Assembly & Estimation** — Auto-scope rooms → pricing → depreciation
9. **ESX/PDF Export** — POST `/api/inspection/:sessionId/export/esx` or `pdf`
10. **Supplemental Claim** — POST `/api/inspection/:sessionId/supplemental`

---

# Phase 1 — Systematic Audit Findings

---

## A) Executive Summary

### Total Issues by Severity

| Severity | Count |
|----------|-------|
| **Critical** | 3 |
| **High** | 9 |
| **Medium** | 14 |
| **Low** | 8 |
| **Total** | **34** |

### Top 5 Production Risks

1. **Hardcoded JWT secret in `.replit` committed to source control** — Any attacker with repo access can forge auth tokens for any user, including admin (Critical)
2. **Open user registration with no invite/approval flow** — Anyone can create an account and access the system as an `adjuster` (Critical)
3. **No pagination/limit enforcement on list endpoints** — `GET /api/claims`, `GET /api/documents/all`, admin dashboard queries fetch entire tables, causing OOM/timeout at scale (High)
4. **No RLS policies on PostgreSQL** — All data access relies solely on application-layer authorization; a single bypass (e.g., direct DB access via service-role key leak) exposes all data (High)
5. **Notification TOCTOU race** — `markNotificationRead` updates before ownership check, allowing any authenticated user to mark any notification as read (High)

### Production Readiness Assessment

**NO-GO** — The hardcoded JWT secret, open registration, and missing pagination represent immediate risks. The application has solid bones (structured auth, Zod validation, rate limiting, CSP, audit logging) but requires remediation of Critical and High items before production deployment.

---

## B) Audit Coverage Matrix

| # | Category | Status | Evidence |
|---|----------|--------|----------|
| 1 | Data Layer Integrity | Issues Found | Inspected `shared/schema.ts`, `database_dump.sql`, `migrations/`, `storage.ts`, `db.ts`. Found schema drift, missing transactions, no pagination. |
| 2 | API Surface | Issues Found | Enumerated all 18 route files, ~120 endpoints. Found unvalidated PATCH bodies, dead/redundant routes. |
| 3 | UI ↔ API Contract | Issues Found | Cross-referenced client pages/hooks with server routes. Found minor drift and missing error states. |
| 4 | Feature Completeness | Confirmed Clean | Searched `TODO`, `FIXME`, `HACK`, `XXX` — zero matches in TS/TSX files. All routes have handlers. |
| 5 | State & Data Flow | Issues Found | Inspected `queryClient.ts`, `offlineQueue.ts`, `useOfflineSync.ts`, `AuthContext.tsx`. Found stale token in offline queue. |
| 6 | Security Surface | Issues Found | Checked auth, CORS, CSP, rate limiting, sanitization, file uploads, secrets, injection vectors. Multiple findings. |
| 7 | Cross-Cutting Concerns | Issues Found | Checked logging (`logger.ts`, `pino-http`), error boundaries, a11y patterns, documentation. Console.log proliferation. |
| 8 | Reliability & Resilience | Issues Found | Checked timeouts, graceful shutdown, connection pooling, process error handlers. Missing HTTP client timeouts on some paths. |
| 9 | Observability & Operations | Issues Found | Checked structured logging, correlation IDs, health/readiness, audit log. Missing metrics and alerting. |
| 10 | Testing & Quality Gates | Issues Found | Enumerated all test files in `tests/`, `test/`, `e2e/`. Good unit coverage on engines, weak on route handlers. |
| 11 | Build/Release/Env Config | Issues Found | Checked `Dockerfile`, `.replit`, `drizzle.config.ts`, `vite.config.ts`. Missing env var validation at startup. |
| 12 | Dependencies & Supply Chain | Issues Found | Ran `npm audit`. 4 high-severity CVEs (serialize-javascript). |
| 13 | Privacy/Compliance/Data Lifecycle | Issues Found | Checked PII fields, logging patterns, auth logs. PII in console.log, no retention policies. |
| 14 | Multi-Tenancy Isolation | Issues Found | No org/company entity. Claims assigned per-user. No RLS. Admin sees all data by design. |
| 15 | Performance & Scale | Issues Found | Checked query patterns, N+1 in admin dashboard, no pagination, 3700-line inspection.ts file. |

---

## C) Endpoint Inventory

### Auth Routes (`server/routes/auth.ts`)

| Method | Route | Auth | Consumer(s) | Schema | Known Issues |
|--------|-------|------|-------------|--------|--------------|
| POST | `/api/auth/login` | None | `AuthContext.tsx` | `{emailOrUsername, password}` | - |
| POST | `/api/auth/register` | None | `AuthContext.tsx` | `{username, email?, password, fullName?}` | **C-01**: Open registration |
| POST | `/api/auth/sync` | `authenticateSupabaseToken` | `AuthContext.tsx` | `{supabaseId, email, fullName?}` | - |
| GET | `/api/auth/me` | `authenticateRequest` | `AuthContext.tsx` | - | - |

### Config & Health (`server/routes/index.ts`)

| Method | Route | Auth | Consumer(s) | Known Issues |
|--------|-------|------|-------------|--------------|
| GET | `/health` | None | Healthcheck | Registered twice (index.ts:47 + routes/index.ts:27) |
| GET | `/readiness` | None | Readiness probe | Fetches all claims for DB check — heavy |
| GET | `/api/config` | None | `supabaseClient.ts` | Exposes `SUPABASE_URL` and `SUPABASE_ANON_KEY` to unauthenticated users |

### Settings (`server/routes/settings.ts`)

| Method | Route | Auth | Consumer(s) | Schema | Known Issues |
|--------|-------|------|-------------|--------|--------------|
| GET | `/api/settings/` | `authenticateRequest` | `use-settings.ts` | - | - |
| PUT | `/api/settings/` | `authenticateRequest` | `use-settings.ts` | Zod strict schema | - |

### Profile (`server/routes/profile.ts`)

| Method | Route | Auth | Consumer(s) | Known Issues |
|--------|-------|------|-------------|--------------|
| PATCH | `/api/profile` | `authenticateRequest` | `ProfilePage.tsx` | - |
| POST | `/api/profile/avatar` | `authenticateRequest` | `ProfilePage.tsx` | Base64 upload, 5MB limit |

### Admin (`server/routes/admin.ts`)

| Method | Route | Auth | Consumer(s) | Known Issues |
|--------|-------|------|-------------|--------------|
| GET | `/api/admin/users` | `requireRole("supervisor","admin")` | `SupervisorDashboard.tsx` | - |
| POST | `/api/admin/claims/assign` | `requireRole("supervisor","admin")` | `SupervisorDashboard.tsx` | **H-04**: No validation on claimId/userId types |
| GET | `/api/admin/dashboard` | `requireRole("supervisor","admin")` | `SupervisorDashboard.tsx` | **H-05**: N+1 queries, fetches all claims |
| GET | `/api/admin/active-sessions` | `requireRole("supervisor","admin")` | `SupervisorDashboard.tsx` | **H-05**: Same N+1 pattern |

### Claims (`server/routes/claims.ts`) — 28 endpoints

| Method | Route | Auth | Known Issues |
|--------|-------|------|--------------|
| GET | `/api/claims/` | `authenticateRequest` | **H-06**: No pagination |
| GET | `/api/claims/my-claims` | `authenticateRequest` | No pagination |
| POST | `/api/claims/` | `authenticateRequest` | - |
| GET | `/api/claims/:id` | `authenticateRequest` + claim access | - |
| PATCH | `/api/claims/:id` | `authenticateRequest` + claim access | **M-01**: Body not Zod-validated |
| DELETE | `/api/claims/purge-all` | `requireRole("admin")` | **M-02**: No confirmation, deletes ALL data |
| DELETE | `/api/claims/:id` | `authenticateRequest` + claim access | - |
| POST | `/api/claims/:claimId/policy-rules` | `authenticateRequest` + claim access | - |
| GET | `/api/claims/:claimId/policy-rules` | `authenticateRequest` + claim access | - |
| PATCH | `/api/claims/:claimId/policy-rules/:ruleId` | `authenticateRequest` + claim access | - |
| POST | `/api/claims/:claimId/tax-rules` | `authenticateRequest` + claim access | - |
| GET | `/api/claims/:claimId/tax-rules` | `authenticateRequest` + claim access | - |
| DELETE | `/api/claims/:claimId/tax-rules/:ruleId` | `authenticateRequest` + claim access | - |
| GET | `/api/claims/:id/documents` | `authenticateRequest` + claim access | - |
| POST | `/api/claims/:id/documents/upload` | `authenticateRequest` + claim access | - |
| POST | `/api/claims/:id/documents/upload-batch` | `authenticateRequest` + claim access | - |
| POST | `/api/claims/:id/documents/:type/parse` | `authenticateRequest` + claim access | - |
| GET | `/api/claims/:id/extractions` | `authenticateRequest` + claim access | - |
| GET | `/api/claims/:id/extractions/:type` | `authenticateRequest` + claim access | - |
| PUT | `/api/claims/:id/extractions/:type` | `authenticateRequest` + claim access | - |
| POST | `/api/claims/:id/extractions/:type/confirm` | `authenticateRequest` + claim access | - |
| POST | `/api/claims/:id/extractions/confirm-all` | `authenticateRequest` + claim access | - |
| POST | `/api/claims/:id/briefing/generate` | `authenticateRequest` + claim access | - |
| GET | `/api/claims/:id/briefing` | `authenticateRequest` + claim access | - |
| GET | `/api/claims/:id/inspection/active` | `authenticateRequest` + claim access | - |
| POST | `/api/claims/:id/inspection/start` | `authenticateRequest` + claim access | - |
| GET | `/api/claims/:id/weather-correlation` | `authenticateRequest` + claim access | - |
| POST | `/api/claims/:id/geocode` | `authenticateRequest` + claim access | - |
| POST | `/api/claims/geocode/backfill` | `requireRole("admin")` | - |

### Documents (`server/routes/documents.ts`)

| Method | Route | Auth | Known Issues |
|--------|-------|------|--------------|
| GET | `/api/documents/all` | `authenticateRequest` | **H-06**: Fetches ALL docs then filters client-side |
| GET | `/api/documents/status-summary` | `authenticateRequest` | Same pattern |
| GET | `/api/documents/:id/signed-url` | `authenticateRequest` + claim access | - |

### Inspection (`server/routes/inspection.ts`) — ~80 endpoints

All inspection routes use `authenticateRequest` + session/resource-level authorization middleware. Key groups:

- Session CRUD + workflow/gates/timeline
- Structure CRUD
- Room CRUD + geometry + openings
- Adjacency CRUD
- Damage observations CRUD
- Line items CRUD + smart-macro
- Test squares CRUD
- Scope assembly + validation + auto-scope
- Photos CRUD + AI analysis
- Moisture readings CRUD
- Transcript
- Completeness check
- Estimate-by-room + grouped views
- Export (ESX, PDF, photo report)
- AI review
- Supplemental claims

**Known Issues**: 3696-line single file, 141 `any` casts, no pagination on list endpoints.

### Other Route Modules

| Module | Endpoints | Auth | Known Issues |
|--------|-----------|------|--------------|
| `flows.ts` | 7 (CRUD + clone + seed) | `authenticateRequest` + admin for seed | - |
| `pricing.ts` | 7 (catalog + scope + validate) | `authenticateRequest` + admin for seed | - |
| `supplemental.ts` | 3 (patch + submit + esx export) | `authenticateRequest` | - |
| `notifications.ts` | 5 (transient + persistent CRUD) | `authenticateRequest` | **H-03**: TOCTOU on markRead |
| `realtime.ts` | 1 (session creation) | `authenticateRequest` | - |
| `logs.ts` | 1 (voice-tool log) | `authenticateRequest` | - |
| `gallery.ts` | 2 (photos + sketches) | `authenticateRequest` | Fetches all claims then filters |
| `photolab.ts` | 7 (standalone photo CRUD) | `authenticateRequest` | userId filter on all queries |
| `ms365.ts` | 11 (OAuth + calendar CRUD) | `authenticateRequest` (except callback) | State stored in memory Map |
| `myday.ts` | 4 (today + stats + date + week) | `authenticateRequest` | - |
| `itinerary.ts` | 5 (today + date + optimize + schedule) | `authenticateRequest` | - |

---

## D) Detailed Findings

### CRITICAL

#### C-01: Hardcoded JWT Secret in Version Control

- **Location**: `.replit:67`
- **Severity**: Critical
- **Category**: Security Surface
- **Description**: The JWT signing secret is hardcoded in `.replit` under `[userenv.shared]`:
  ```
  JWT_SECRET = "fdfb593010ac91a8ad85cfd55b053fb510fdb767fbde1d..."
  ```
  This file is committed to the repository. Anyone with repo access can forge valid JWTs for any user (including admin), achieving full account takeover.
- **Recommendation**: Remove the secret from `.replit` immediately. Use a secrets manager (Replit Secrets UI, environment variables, or a vault). Rotate the secret and invalidate all existing tokens.
- **Risk scenario**: An attacker clones the repo, signs a JWT with `userId` of an admin user, and gains full admin access to the production system — including the purge-all endpoint that deletes all data.

#### C-02: Open User Registration — No Access Control

- **Location**: `server/routes/auth.ts:47-94`
- **Severity**: Critical
- **Category**: Security Surface
- **Description**: The `POST /api/auth/register` endpoint allows anyone to create a new account with the default role of `adjuster`. There is no invite code, email verification, approval workflow, or admin authorization required. An attacker can create unlimited accounts and access all adjuster-level functionality.
- **Recommendation**: Implement one or more of:
  - Require an invite code or admin-generated registration link
  - Add email verification before account activation
  - Require admin approval for new accounts (`isActive: false` by default)
  - Rate-limit registration more aggressively (currently 30/15min shared with all auth endpoints)
- **Risk scenario**: An attacker creates an account, gets assigned claims via the open claim creation endpoint, uploads malicious documents, and accesses other users' data if any authorization gaps exist.

#### C-03: Supabase Service-Role Key Used Server-Side Without RLS Guardrails

- **Location**: `server/supabase.ts:4-5`, `database_dump.sql` (no RLS policies)
- **Severity**: Critical
- **Category**: Multi-Tenancy / Security
- **Description**: The server uses `SUPABASE_SERVICE_ROLE_KEY` to create the Supabase client. This key bypasses all RLS policies. However, there are **no RLS policies defined at all** in the database. This means:
  1. If the service-role key leaks (e.g., via error logs, client bundle, or `.env` exposure), there is zero database-level protection.
  2. Any bug in application-layer authorization results in unrestricted data access.
- **Recommendation**:
  - Define RLS policies on all tables as defense-in-depth
  - Use per-request JWT claims with anon key for storage operations where possible
  - Ensure service-role key is never logged or exposed in error messages
- **Risk scenario**: A server-side error serializes the Supabase client config into an error response. The service-role key is exposed. An attacker uses it to read/write any data in the database.

---

### HIGH

#### H-01: Auth Middleware Logs Tokens to Console

- **Location**: `server/auth.ts:42`
- **Severity**: High
- **Category**: Security / Privacy
- **Description**: The `authenticateRequest` middleware logs the presence and length of the auth header on every request:
  ```typescript
  console.log(`[auth] ${req.method} ${req.originalUrl} hasAuth=${!!authHeader} authLen=${authHeader?.length || 0}`);
  ```
  While token content isn't logged directly, the auth sync endpoint at `server/routes/auth.ts:104,109,114` logs `supabaseId` and `email` via `console.log`. These console.log calls bypass structured logging and may end up in plain-text log files without PII redaction.
- **Recommendation**: Replace all `console.log` in auth paths with structured `logger.info`/`logger.debug`. Remove PII (email, supabaseId) from log messages or redact them.
- **Risk scenario**: Log aggregation tools capture PII, violating data protection requirements. Token metadata enables correlation attacks.

#### H-02: MS365 OAuth State Stored In-Memory

- **Location**: `server/routes/ms365.ts:21`
- **Severity**: High
- **Category**: Reliability / Security
- **Description**: OAuth CSRF state tokens are stored in a `Map<string, { userId, expiresAt }>` in process memory:
  ```typescript
  const pendingStates = new Map<string, { userId: string; expiresAt: number }>();
  ```
  This means:
  - Server restart loses all pending OAuth flows
  - In a multi-instance deployment, the callback may hit a different instance than the one that created the state, causing all OAuth flows to fail
  - Old entries are never cleaned up (no TTL sweep), creating a memory leak
- **Recommendation**: Store OAuth state in the database or Redis with TTL-based expiration. Add a periodic cleanup for expired entries.
- **Risk scenario**: In Replit autoscale with multiple instances, MS365 OAuth never succeeds because the callback arrives at a different instance. Memory grows unbounded with abandoned OAuth flows.

#### H-03: Notification Read — TOCTOU Authorization Bypass

- **Location**: `server/routes/notifications.ts:108-125`
- **Severity**: High
- **Category**: Security / Authorization
- **Description**: The `PATCH /api/notifications/persistent/:id/read` endpoint marks the notification as read **before** checking ownership:
  ```typescript
  const updated = await storage.markNotificationRead(id);  // Mutation happens first
  if (!updated) return res.status(404)...;
  if (updated.userId !== req.user!.id) return res.status(403)...;  // Too late
  ```
  By the time the ownership check runs, the notification is already marked as read. Any authenticated user can mark any other user's notifications as read.
- **Recommendation**: Check ownership before mutation:
  ```typescript
  const notification = await storage.getNotification(id);
  if (!notification) return res.status(404)...;
  if (notification.userId !== req.user!.id) return res.status(403)...;
  const updated = await storage.markNotificationRead(id);
  ```
- **Risk scenario**: An attacker silently marks another user's notifications as read, suppressing critical alerts about claim activity.

#### H-04: Admin Claim Assignment — Missing Input Validation

- **Location**: `server/routes/admin.ts:38-49`
- **Severity**: High
- **Category**: API Surface / Security
- **Description**: The `POST /api/admin/claims/assign` endpoint accepts `claimId` and `userId` from the request body with only truthiness checks:
  ```typescript
  const { claimId, userId } = req.body;
  if (!claimId || !userId) { ... }
  const claim = await storage.updateClaimFields(claimId, { assignedTo: userId });
  ```
  There is no validation that:
  - `claimId` is a valid integer
  - `userId` is a valid UUID that corresponds to an existing user
  - The target user exists and is active
  This could assign claims to non-existent users, effectively orphaning them.
- **Recommendation**: Add Zod validation and verify the target user exists:
  ```typescript
  const schema = z.object({ claimId: z.number().int().positive(), userId: z.string().uuid() });
  ```
- **Risk scenario**: An admin typos a userId, claims get assigned to a non-existent user, and no one can access them anymore (since the assigned user doesn't exist and non-privileged users can only see their own claims).

#### H-05: N+1 Query Patterns in Admin Dashboard

- **Location**: `server/routes/admin.ts:52-136` (dashboard), `server/routes/admin.ts:139-180` (active-sessions)
- **Severity**: High
- **Category**: Performance / Reliability
- **Description**: The admin dashboard endpoint fetches ALL claims, then for each claim:
  1. Fetches the active session (N queries)
  2. For each active session, fetches estimate summary, rooms, line items, photos, damages (up to 5N more queries)

  With 100 claims, this is 600+ database queries per dashboard load. With 1000 claims, the endpoint will timeout.
- **Recommendation**: Use SQL JOINs or batch queries. Pre-aggregate metrics in a materialized view or summary table.
- **Risk scenario**: As claim count grows, the admin dashboard becomes unusable, and each request ties up a database connection for seconds, contributing to connection pool exhaustion.

#### H-06: No Pagination on List Endpoints

- **Location**: `server/routes/claims.ts:290-296` (GET /api/claims), `server/routes/documents.ts:12-24` (GET /api/documents/all), `server/storage.ts:440-441` (getClaims), and ~20 more list endpoints
- **Severity**: High
- **Category**: Performance / Reliability
- **Description**: List endpoints return all records with no `LIMIT`, `OFFSET`, or cursor-based pagination:
  ```typescript
  async getClaims(): Promise<Claim[]> {
    return db.select().from(claims).orderBy(desc(claims.createdAt));
  }
  ```
  This applies to claims, documents, rooms, line items, photos, damages, moisture readings, and more.
- **Recommendation**: Add pagination parameters (`page`/`limit` or cursor) with server-side max enforcement (e.g., `limit = Math.min(requestedLimit, 100)`). Add database indexes to support paginated queries efficiently.
- **Risk scenario**: A production system with 10,000 claims returns multi-megabyte JSON responses, causing OOM on both server and client, and saturating the database connection pool.

#### H-07: `PATCH /api/claims/:id` Body Not Validated with Zod

- **Location**: `server/routes/claims.ts:361-391`
- **Severity**: High
- **Category**: API Surface / Security
- **Description**: The `PATCH /api/claims/:id` endpoint destructures `req.body` directly and manually whitelists fields, bypassing the Zod validation used elsewhere:
  ```typescript
  const { status, ...otherFields } = req.body;
  if (status) { ... }
  for (const key of ['insuredName', ...]) {
    if (otherFields[key] !== undefined) editableFields[key] = otherFields[key];
  }
  ```
  While the field whitelist prevents mass-assignment of unexpected fields, there is no type or length validation on the values. A user could set `insuredName` to a 10MB string or a non-string value.
- **Recommendation**: Create a `updateClaimSchema` Zod validator and use `safeParse` like all other endpoints.
- **Risk scenario**: An attacker sends `{ "insuredName": "<very long string>" }` causing database insertion failures or denial of service.

#### H-08: `POST /api/inspection/:sessionId/supplemental` Body Not Validated

- **Location**: `server/routes/inspection.ts:3660-3683`
- **Severity**: High
- **Category**: API Surface / Security
- **Description**: The supplemental claim creation endpoint accepts `reason`, `newLineItems`, `removedLineItemIds`, `modifiedLineItems` from `req.body` with zero validation:
  ```typescript
  const { reason, newLineItems, removedLineItemIds, modifiedLineItems } = req.body;
  ```
  This can store arbitrary JSON in the database and could be exploited for stored XSS if the data is rendered unescaped, or could corrupt the supplemental claims workflow.
- **Recommendation**: Define a Zod schema for supplemental claim creation with typed arrays and string constraints.
- **Risk scenario**: Malformed `newLineItems` array crashes the supplemental export flow, or injected HTML in `reason` gets rendered in a review UI.

#### H-09: Photo Upload — No Content-Type Server-Side Verification

- **Location**: `server/routes/inspection.ts:2314-2391`, `server/routes/photolab.ts:58-96`
- **Severity**: High
- **Category**: Security / File Upload
- **Description**: Photo uploads accept base64-encoded images and check only the data URI prefix (`data:image/...`). The server trusts the client-declared MIME type and doesn't validate the actual file content (magic bytes). An attacker could upload a file with an `image/jpeg` prefix but non-image content.
- **Recommendation**: Validate file magic bytes server-side (e.g., check JPEG SOI marker `0xFFD8`, PNG header `0x89504E47`) before uploading to storage.
- **Risk scenario**: An attacker uploads a malicious file disguised as an image, which could exploit vulnerabilities in downstream image processing or be served to other users.

---

### MEDIUM

#### M-01: Schema Drift Between Drizzle Schema and Database Dump

- **Location**: `shared/schema.ts` vs `database_dump.sql`
- **Severity**: Medium
- **Category**: Data Layer Integrity
- **Description**: Multiple tables exist in `schema.ts` but not in `database_dump.sql`:
  - `inspection_session_events`, `daily_itineraries`, `adjuster_notifications`, `ms365_tokens`
  - 21 Xactimate tables (`xact_pl_info`, `xact_category`, etc.)
  - Several columns on `claims` (`priority`, `scheduled_date`, `sla_deadline`, `latitude`, `longitude`)

  Conversely, `xact_price_lists` exists in the dump but not in the schema.
- **Recommendation**: Run `drizzle-kit push` against the production database and verify the schema matches. Add a CI check that compares the schema with a fresh database.
- **Risk scenario**: A deploy runs against a database missing expected tables/columns, causing runtime errors on first use of affected features.

#### M-02: `purge-all` Endpoint Deletes All Data Without Confirmation

- **Location**: `server/routes/claims.ts:393-421`
- **Severity**: Medium
- **Category**: Data Layer / Reliability
- **Description**: `DELETE /api/claims/purge-all` deletes all claims and all related data (documents, photos, sessions, etc.) with a single API call. There is no confirmation token, no "are you sure" safeguard, and no soft-delete.
- **Recommendation**: Add a confirmation token pattern (e.g., client must first POST to get a deletion token, then pass it back) or require the request body to contain a confirmation phrase. Consider soft-delete with a grace period.
- **Risk scenario**: An accidental or malicious API call deletes all production data irreversibly.

#### M-03: No Database Transactions for Multi-Step Operations

- **Location**: Multiple routes in `server/routes/claims.ts`, `server/routes/inspection.ts`
- **Severity**: Medium
- **Category**: Data Layer Integrity
- **Description**: Only one `db.transaction()` exists in the entire codebase (`storage.ts:591`). Multi-step operations like claim deletion (delete docs, photos, then claim) or scope assembly (create multiple scope items + summary) run as individual queries. If the server crashes mid-operation, data is left in an inconsistent state.
- **Recommendation**: Wrap multi-step mutations in `db.transaction()` blocks. Priority targets:
  - Claim deletion with storage cleanup
  - Scope assembly
  - ESX export data gathering + session status update
- **Risk scenario**: Server crashes after deleting a claim's storage files but before the DB delete, leaving orphaned database records. Or the reverse: DB records deleted but storage files remain.

#### M-04: Console.log Statements in Production Code

- **Location**: `server/auth.ts:42,56,72,80`, `server/routes/auth.ts:104,109,114`, `server/index.ts:196,216,221,223,260`, `client/src/pages/ActiveInspection.tsx:285,288,292`
- **Severity**: Medium
- **Category**: Observability / Security
- **Description**: 30+ `console.log` statements exist in production server code, bypassing the structured Pino logger. These produce unstructured text that is harder to parse, filter, and redact. The auth module logs user identifiers (email, supabaseId) via console.log.
- **Recommendation**: Replace all `console.log`/`console.error` with the appropriate `logger.*` call. In the client, gate behind `import.meta.env.DEV` or the client logger.
- **Risk scenario**: Production log analysis is hampered by mixed structured/unstructured output. PII leaks into unredacted log streams.

#### M-05: Massive Inspection Route File

- **Location**: `server/routes/inspection.ts` (3696 lines)
- **Severity**: Medium
- **Category**: Maintainability / Reliability
- **Description**: A single file contains ~80 endpoints, all authorization middleware, and complex business logic. This makes code review difficult, increases merge conflict risk, and makes it easy to miss security or correctness issues.
- **Recommendation**: Split into sub-modules: `inspection-sessions.ts`, `inspection-rooms.ts`, `inspection-photos.ts`, `inspection-scope.ts`, `inspection-export.ts`, etc.
- **Risk scenario**: A developer modifying the photo upload handler accidentally introduces a bug in the scope assembly handler 1000 lines below due to shared variable scope.

#### M-06: Excessive `any` Type Usage

- **Location**: `server/routes/inspection.ts` (141 instances), `client/src/pages/ActiveInspection.tsx` (71), `client/src/pages/ReviewFinalize.tsx` (32), plus 20+ more files
- **Severity**: Medium
- **Category**: Type Safety / Maintainability
- **Description**: Pervasive use of `any` type, especially in route handlers (`req: any, res: any`) and data processing. This defeats TypeScript's type checking and allows runtime type errors.
- **Recommendation**: Replace `any` with proper types. For Express handlers, use the typed `Request`/`Response` generics. For data processing, define interfaces for OpenAI responses, analysis results, etc.
- **Risk scenario**: A refactoring changes a field name in the schema but `any`-typed code still references the old name, causing silent `undefined` values in production.

#### M-07: Password Policy Too Weak

- **Location**: `server/routes/auth.ts:58-59`
- **Severity**: Medium
- **Category**: Security
- **Description**: Minimum password length is 6 characters with no complexity requirements:
  ```typescript
  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }
  ```
- **Recommendation**: Require at least 8 characters with mixed case, numbers, or special characters. Consider using a password strength library like `zxcvbn`.
- **Risk scenario**: Users set weak passwords like `123456` or `password`, leading to credential stuffing attacks.

#### M-08: Readiness Endpoint — Heavy Database Query

- **Location**: `server/routes/index.ts:36-61`
- **Severity**: Medium
- **Category**: Reliability / Performance
- **Description**: The `/readiness` endpoint calls `storage.getClaims()` which fetches ALL claims just to check database connectivity:
  ```typescript
  await storage.getClaims();
  ```
- **Recommendation**: Use a lightweight query like `SELECT 1` or `SELECT count(*) FROM claims LIMIT 1`.
- **Risk scenario**: The readiness probe adds unnecessary load. Under high traffic, the readiness check itself causes the database to become slow, creating a feedback loop.

#### M-09: `scriptSrc` Includes `'unsafe-inline'` in CSP

- **Location**: `server/index.ts:67`
- **Severity**: Medium
- **Category**: Security
- **Description**: The Content Security Policy allows `'unsafe-inline'` for both `scriptSrc` and `styleSrc`. While `styleSrc: 'unsafe-inline'` is common for CSS-in-JS, `scriptSrc: 'unsafe-inline'` significantly weakens XSS protection.
- **Recommendation**: Use nonce-based CSP for scripts. Vite can generate nonces at build time.
- **Risk scenario**: If an XSS vulnerability exists (e.g., via the `dangerouslySetInnerHTML` in chart.tsx), the CSP won't block injected inline scripts.

#### M-10: Offline Queue Stores Auth Token — Token Expiry Risk

- **Location**: `client/src/lib/queryClient.ts:102-107`
- **Severity**: Medium
- **Category**: State & Data Flow / Security
- **Description**: When a mutation is queued offline, the current auth headers (including the Bearer token) are captured and stored in IndexedDB:
  ```typescript
  const authHeaders = await getAuthHeaders();
  await enqueueMutation({ method, url, body: data, headers: authHeaders, ... });
  ```
  The JWT has a 7-day expiry. If the user is offline for days and then comes online, the stored token may have expired, causing all queued mutations to fail with 401.
- **Recommendation**: Re-fetch auth headers at sync time instead of storing them at enqueue time.
- **Risk scenario**: A field adjuster works offline for 8 days. When they reconnect, all their queued mutations are dropped because the stored token expired.

#### M-11: CSP `connectSrc` Allows Broad HTTPS for Images

- **Location**: `server/index.ts:64`
- **Severity**: Medium
- **Category**: Security
- **Description**: `imgSrc: ["'self'", "data:", "blob:", "https:"]` allows loading images from any HTTPS origin. While this may be intentional for Supabase signed URLs, it's overly permissive.
- **Recommendation**: Restrict to specific origins (e.g., `https://*.supabase.co`).

#### M-12: Gallery Routes Fetch All Claims Then Filter In-Memory

- **Location**: `server/routes/gallery.ts:13-70`, `server/routes/documents.ts:12-24`
- **Severity**: Medium
- **Category**: Performance
- **Description**: Gallery and document list endpoints fetch all claims from the database, then filter by the current user's access in JavaScript. This is O(all claims) on every request.
- **Recommendation**: Push the user filter into the database query using a WHERE clause.

#### M-13: No CSRF Protection for Cookie-Based Auth

- **Location**: Entire codebase (searched for `csrf`/`xsrf` — 0 matches)
- **Severity**: Medium
- **Category**: Security
- **Description**: The application uses `credentials: "include"` on API requests, meaning cookies are sent with cross-origin requests. While the primary auth mechanism is Bearer tokens (not cookies), the CORS configuration with `credentials: true` could enable CSRF if session cookies are ever introduced.
- **Recommendation**: Since Bearer tokens are the primary auth mechanism and aren't auto-attached by the browser, this is lower risk. However, ensure no cookie-based session middleware is added without CSRF protection.

#### M-14: No Server-Side Max Enforcement on Photo Signed URL Generation

- **Location**: `server/routes/inspection.ts:2393-2410`
- **Severity**: Medium
- **Category**: Performance
- **Description**: When listing photos for a session, the server generates a signed URL for EVERY photo via sequential Supabase API calls:
  ```typescript
  const photosWithUrls = await Promise.all(photos.map(async (photo) => {
    const { data } = await supabase.storage.from(PHOTOS_BUCKET).createSignedUrl(photo.storagePath, 3600);
    return { ...photo, signedUrl: data?.signedUrl };
  }));
  ```
  A session with 200 photos causes 200 sequential API calls to Supabase Storage.
- **Recommendation**: Generate signed URLs on-demand (lazy) rather than eagerly. Or batch sign URLs if the Supabase SDK supports it.
- **Risk scenario**: Photo-heavy inspections cause multi-second API response times.

---

### LOW

#### L-01: `/health` Endpoint Registered Twice

- **Location**: `server/index.ts:48`, `server/routes/index.ts:27`
- **Severity**: Low
- **Category**: API Surface
- **Description**: The health endpoint is registered both before middleware (index.ts:48) and again in route registration (routes/index.ts:27). The first one wins, so the second registration returns a slightly different response shape but is never reached.
- **Recommendation**: Remove the duplicate in `routes/index.ts`.

#### L-02: Migration Journal is Empty

- **Location**: `migrations/meta/_journal.json` — `entries: []`
- **Severity**: Low
- **Category**: Data Layer
- **Description**: The Drizzle migration journal has no entries, suggesting migrations are managed via `drizzle-kit push` rather than versioned migrations. This means there's no rollback capability.
- **Recommendation**: Use `drizzle-kit generate` + `drizzle-kit migrate` for versioned, reversible migrations in production.

#### L-03: Demo Passwords in Seed Scripts

- **Location**: `script/seed-demo.ts:37,45,53`
- **Severity**: Low
- **Category**: Security
- **Description**: Demo seed scripts use weak passwords (`"demo123"`). If seed scripts are accidentally run against production, these accounts become easy targets.
- **Recommendation**: Use strong random passwords in seed scripts, or add a safety check that prevents seed scripts from running against production databases.

#### L-04: `database_dump.sql` in Repository Root

- **Location**: `/workspace/database_dump.sql` (4.2 MB)
- **Severity**: Low
- **Category**: Security / Privacy
- **Description**: A full database dump with seed data (including bcrypt hashes and user emails) is committed to the repository. While bcrypt hashes are computationally expensive to crack, this still represents unnecessary exposure.
- **Recommendation**: Add `database_dump.sql` to `.gitignore`. Store seed data in migration scripts or separate seed files without sensitive data.

#### L-05: No Health Check Liveness Probe Separate from Readiness

- **Location**: `server/index.ts:48`, `server/routes/index.ts:36`
- **Severity**: Low
- **Category**: Reliability
- **Description**: The `/health` endpoint is lightweight (returns uptime) but `/readiness` is heavy (checks DB + storage). In Kubernetes/Cloud Run, you typically want a cheap liveness probe and a heavier readiness probe. Currently both exist, but the readiness probe could be simplified.

#### L-06: Error Messages May Leak Internal Details in Development

- **Location**: `server/index.ts:246`
- **Severity**: Low
- **Category**: Security
- **Description**: The error handler correctly hides 5xx messages but passes through 4xx `err.message` directly. If a library throws a 4xx error with internal details, those could leak.
- **Recommendation**: Whitelist known safe error messages rather than passing through all non-5xx messages.

#### L-07: Service Worker for Offline Sync Not Fully Implemented

- **Location**: `client/public/sw-offline-sync.js`
- **Severity**: Low
- **Category**: Feature Completeness
- **Description**: The service worker file exists for offline sync background processing, but the implementation in `offlineQueue.ts:108-118` notes that background sync may not be supported and falls back to polling.
- **Recommendation**: Document the offline sync limitations. Ensure the polling fallback handles all edge cases.

#### L-08: `npm_package_version` May Be Undefined in Production

- **Location**: `server/routes/index.ts:32`
- **Severity**: Low
- **Category**: Observability
- **Description**: The health endpoint uses `process.env.npm_package_version` which is only set when the server is started via `npm run`. When started directly with `node dist/index.cjs`, this will be `undefined`, falling back to "unknown".
- **Recommendation**: Inject the version at build time from `package.json`.

---

## E) Prioritized Remediation Checklist

### Immediate (Before Any Production Deployment)

| # | Finding | Effort | Action |
|---|---------|--------|--------|
| 1 | **C-01** Hardcoded JWT secret | Small | Remove from `.replit`, rotate secret, use env-only |
| 2 | **C-02** Open registration | Medium | Add invite-code or admin-approval flow |
| 3 | **C-03** No RLS policies | Large | Define RLS on critical tables (users, claims, sessions) |
| 4 | **H-03** Notification TOCTOU | Small | Swap check-before-mutate order |
| 5 | **H-07** Claim PATCH not validated | Small | Add Zod schema to PATCH /api/claims/:id |
| 6 | **H-08** Supplemental body not validated | Small | Add Zod schema |
| 7 | **H-04** Admin assign not validated | Small | Add Zod + user existence check |

### Before Scale (Required for >100 Users/Claims)

| # | Finding | Effort | Action |
|---|---------|--------|--------|
| 8 | **H-06** No pagination | Medium | Add limit/offset to all list endpoints + storage methods |
| 9 | **H-05** Admin N+1 queries | Medium | Rewrite with JOINs or batch queries |
| 10 | **M-08** Heavy readiness probe | Small | Use `SELECT 1` instead of `getClaims()` |
| 11 | **M-12** Gallery in-memory filtering | Small | Push WHERE clause to DB |
| 12 | **M-14** Eager signed URL generation | Medium | Lazy-load signed URLs |
| 13 | **H-09** Photo content-type verification | Small | Add magic byte validation |

### Structural Improvements (Sprint-Level Work)

| # | Finding | Effort | Action |
|---|---------|--------|--------|
| 14 | **M-03** Missing transactions | Medium | Wrap multi-step mutations in transactions |
| 15 | **M-05** 3696-line inspection.ts | Large | Split into sub-modules |
| 16 | **M-06** 141 `any` casts in inspection.ts | Large | Type route handlers properly |
| 17 | **M-04** Console.log proliferation | Small | Replace with structured logger |
| 18 | **H-01** Auth logs PII | Small | Remove PII from log output |
| 19 | **H-02** MS365 OAuth in-memory state | Medium | Move to DB/Redis |
| 20 | **M-01** Schema drift | Medium | Reconcile schema.ts vs actual DB |

### Quality & Hardening

| # | Finding | Effort | Action |
|---|---------|--------|--------|
| 21 | **M-07** Weak password policy | Small | Increase to 8 chars + complexity |
| 22 | **M-09** CSP unsafe-inline | Medium | Implement nonce-based CSP |
| 23 | **M-10** Stale token in offline queue | Small | Re-fetch headers at sync time |
| 24 | **M-02** purge-all no confirmation | Small | Add confirmation token |
| 25 | Supply chain CVEs | Small | `npm audit fix --force` or pin vite-plugin-pwa |
| 26 | **L-02** Empty migration journal | Medium | Switch to versioned migrations |
| 27 | **L-04** DB dump in repo | Small | Add to .gitignore |

### Unknown / Cannot Verify From Repo Alone

| Item | What's Needed |
|------|---------------|
| Supabase bucket policies (storage ACLs) | Inspect Supabase dashboard — are buckets truly private? |
| Supabase Auth email verification settings | Check Supabase project settings for email confirmation requirement |
| CI/CD pipeline | No `.github/workflows` or CI config found — verify CI exists externally |
| Backup & restore strategy | Supabase plan level determines backup frequency — verify |
| Production CORS_ORIGIN setting | Verify the deployed value isn't `*` or overly permissive |
| Rate limit effectiveness behind proxy | Verify `trust proxy` setting matches actual infrastructure |
| Encryption at rest | Depends on Supabase plan and PostgreSQL configuration |
| OpenAI API key rotation | Verify key has appropriate scope and rotation schedule |

---

*End of audit. All findings include file paths and line numbers for verification. For questions about specific findings or remediation guidance, reference the finding ID (e.g., C-01, H-03, M-05).*
