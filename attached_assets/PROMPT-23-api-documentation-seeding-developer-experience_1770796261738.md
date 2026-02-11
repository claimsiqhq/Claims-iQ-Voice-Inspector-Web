# PROMPT-23 — API Documentation, Data Seeding & Developer Experience

## Context

The application has 51 API endpoints across 2,068 lines of `server/routes.ts`, a Workbox-powered PWA with offline caching, and WebRTC voice session management with auto-reconnection. However:

- **API Documentation**: None. No OpenAPI spec, no Swagger UI, no endpoint reference beyond comments in code.
- **Data Seeding**: Only a single admin-only `/api/pricing/seed` endpoint exists. No scripts to generate demo claims, sessions, or inspection data for development or testing.
- **Session Resilience**: WebRTC auto-reconnects after 3 seconds (`ActiveInspection.tsx` lines 581–586), and errors auto-clear after 5 seconds (lines 525–528). But if the browser tab reloads or closes mid-inspection, the `sessionId` in React state is lost with no way to resume.
- **Developer Onboarding**: `Replit.md` (145 lines) gives a system overview but lists only ~40 of the 51 endpoints, contains no setup instructions, and has no quick-start guide.

This prompt adds production-quality API documentation, demo data generation, session recovery mechanics, and a developer quick-start guide.

**Depends on**: PROMPT-22 (production hardening), all prior prompts

---

## Part A — OpenAPI 3.0 Specification

### A.1 — Install Swagger UI

```bash
npm install swagger-ui-express
npm install --save-dev @types/swagger-ui-express
```

### A.2 — Create OpenAPI Specification File

Create `docs/openapi.yaml` in the project root:

```yaml
openapi: 3.0.3
info:
  title: Claims IQ Voice Inspector API
  description: |
    RESTful API for the Claims IQ Voice Inspector — a voice-driven property
    inspection platform for insurance adjusters. Supports claim management,
    document extraction, real-time voice inspections via OpenAI Realtime API,
    estimate generation with Xactimate-compatible pricing, and ESX/PDF export.
  version: 1.0.0
  contact:
    name: Claims IQ Engineering
    email: engineering@claimsiq.com
  license:
    name: Proprietary

servers:
  - url: http://localhost:5000
    description: Local development
  - url: https://{replit-slug}.replit.app
    description: Replit deployment

tags:
  - name: Claims
    description: Claim lifecycle management
  - name: Documents
    description: Document upload, parsing, and extraction
  - name: Inspection
    description: Inspection session lifecycle
  - name: Rooms
    description: Room management within inspections
  - name: Damages
    description: Damage observation recording
  - name: LineItems
    description: Estimate line items and pricing
  - name: Photos
    description: Inspection photo capture and annotation
  - name: Realtime
    description: OpenAI Realtime API voice session management
  - name: Export
    description: ESX and PDF report generation
  - name: Pricing
    description: Xactimate-compatible pricing catalog
  - name: Auth
    description: Authentication and user profile
  - name: Admin
    description: Supervisor and admin operations
  - name: Supplemental
    description: Supplemental claim management
  - name: Health
    description: Health and readiness checks

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: Supabase JWT token

  schemas:
    Error:
      type: object
      properties:
        message:
          type: string
      required: [message]

    Claim:
      type: object
      properties:
        id:
          type: integer
        claimNumber:
          type: string
        insuredName:
          type: string
        propertyAddress:
          type: string
        city:
          type: string
        state:
          type: string
        zip:
          type: string
        dateOfLoss:
          type: string
          format: date
        perilType:
          type: string
          enum: [fire, water, wind, hail, theft, vandalism, other]
        status:
          type: string
          enum: [new, documents_uploaded, briefing_ready, inspection_in_progress, inspection_complete, estimate_ready, exported]
        assignedTo:
          type: integer
          nullable: true
        createdAt:
          type: string
          format: date-time

    CreateClaimRequest:
      type: object
      required: [claimNumber]
      properties:
        claimNumber:
          type: string
          minLength: 1
        insuredName:
          type: string
        propertyAddress:
          type: string
        city:
          type: string
        state:
          type: string
        zip:
          type: string
        dateOfLoss:
          type: string
        perilType:
          type: string
        status:
          type: string

    InspectionSession:
      type: object
      properties:
        id:
          type: integer
        claimId:
          type: integer
        status:
          type: string
          enum: [active, paused, completed]
        currentPhase:
          type: string
        currentRoomId:
          type: integer
          nullable: true
        currentStructure:
          type: string
          nullable: true
        startedAt:
          type: string
          format: date-time
        completedAt:
          type: string
          format: date-time
          nullable: true

    Room:
      type: object
      properties:
        id:
          type: integer
        sessionId:
          type: integer
        name:
          type: string
        roomType:
          type: string
        structure:
          type: string
          nullable: true
        dimensions:
          type: string
          nullable: true
        status:
          type: string
          enum: [active, complete]
        phase:
          type: string
          nullable: true

    CreateRoomRequest:
      type: object
      required: [name]
      properties:
        name:
          type: string
          minLength: 1
        roomType:
          type: string
        structure:
          type: string
        dimensions:
          type: string
        phase:
          type: string

    DamageObservation:
      type: object
      properties:
        id:
          type: integer
        sessionId:
          type: integer
        roomId:
          type: integer
        description:
          type: string
        severity:
          type: string
        damageType:
          type: string
        location:
          type: string
          nullable: true

    LineItem:
      type: object
      properties:
        id:
          type: integer
        sessionId:
          type: integer
        roomId:
          type: integer
          nullable: true
        damageId:
          type: integer
          nullable: true
        category:
          type: string
        action:
          type: string
          nullable: true
        description:
          type: string
        xactCode:
          type: string
          nullable: true
        quantity:
          type: number
        unit:
          type: string
        unitPrice:
          type: number
        totalPrice:
          type: number
        depreciationType:
          type: string
          nullable: true
        wasteFactor:
          type: number
          nullable: true
        provenance:
          type: string
          enum: [voice, manual, ai-suggested]

    CreateLineItemRequest:
      type: object
      required: [category, description]
      properties:
        roomId:
          type: integer
        damageId:
          type: integer
        category:
          type: string
          minLength: 1
        action:
          type: string
        description:
          type: string
          minLength: 1
        xactCode:
          type: string
        quantity:
          type: number
        unit:
          type: string
        unitPrice:
          type: number
        depreciationType:
          type: string
        wasteFactor:
          type: number

    EstimateSummary:
      type: object
      properties:
        totalRCV:
          type: number
        totalDepreciation:
          type: number
        totalACV:
          type: number
        itemCount:
          type: integer

    UploadDocumentRequest:
      type: object
      required: [fileName, fileBase64, documentType]
      properties:
        fileName:
          type: string
        fileBase64:
          type: string
          format: byte
        documentType:
          type: string
          enum: [fnol, policy, endorsements]

    ExportValidation:
      type: object
      properties:
        ready:
          type: boolean
        blockers:
          type: array
          items:
            type: string
        warnings:
          type: array
          items:
            type: string
        summary:
          type: object

    HealthResponse:
      type: object
      properties:
        status:
          type: string
        timestamp:
          type: string
          format: date-time
        uptime:
          type: number

    ReadinessResponse:
      type: object
      properties:
        status:
          type: string
          enum: [ready, not_ready]
        timestamp:
          type: string
          format: date-time
        checks:
          type: object

security:
  - bearerAuth: []

paths:
  # ─── Health (no auth) ───
  /health:
    get:
      tags: [Health]
      summary: Liveness check
      security: []
      responses:
        "200":
          description: Service is running
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/HealthResponse"

  /readiness:
    get:
      tags: [Health]
      summary: Readiness check (DB, storage, OpenAI)
      security: []
      responses:
        "200":
          description: All subsystems ready
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ReadinessResponse"
        "503":
          description: One or more subsystems not ready

  # ─── Claims ───
  /api/claims:
    get:
      tags: [Claims]
      summary: List all claims
      responses:
        "200":
          description: Array of claims
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Claim"
    post:
      tags: [Claims]
      summary: Create a new claim
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateClaimRequest"
      responses:
        "201":
          description: Claim created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Claim"
        "400":
          description: Validation error

  /api/claims/my-claims:
    get:
      tags: [Claims]
      summary: Get claims assigned to current user
      description: Returns claims assigned to the authenticated user, or all claims if no auth provided.
      security:
        - bearerAuth: []
        - {}
      responses:
        "200":
          description: Array of assigned claims

  /api/claims/{id}:
    get:
      tags: [Claims]
      summary: Get claim with documents, extractions, and briefing
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Claim with related data
        "404":
          description: Claim not found
    patch:
      tags: [Claims]
      summary: Update claim status
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                status:
                  type: string
      responses:
        "200":
          description: Updated claim
    delete:
      tags: [Claims]
      summary: Delete claim and all related data
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Claim deleted

  # ─── Documents ───
  /api/claims/{id}/documents/upload:
    post:
      tags: [Documents]
      summary: Upload a single PDF document
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/UploadDocumentRequest"
      responses:
        "200":
          description: Document uploaded and stored
        "400":
          description: Invalid file type or missing fields

  /api/claims/{id}/documents/upload-batch:
    post:
      tags: [Documents]
      summary: Batch upload PDFs (max 20 files, 25MB each)
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [files, documentType]
              properties:
                files:
                  type: array
                  maxItems: 20
                  items:
                    type: object
                    properties:
                      fileName:
                        type: string
                      fileBase64:
                        type: string
                documentType:
                  type: string
                  enum: [endorsements]
      responses:
        "200":
          description: Batch upload results

  /api/claims/{id}/documents/{type}/parse:
    post:
      tags: [Documents]
      summary: Parse PDF and extract structured data
      description: Triggers AI extraction of FNOL, policy, or endorsement data from uploaded PDF.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
        - name: type
          in: path
          required: true
          schema:
            type: string
            enum: [fnol, policy, endorsements]
      responses:
        "200":
          description: Extracted data
        "404":
          description: Document not found

  # ─── Inspection Sessions ───
  /api/claims/{id}/inspection/start:
    post:
      tags: [Inspection]
      summary: Start or resume an inspection session
      description: Creates a new active session or returns the existing active session for this claim.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Session (existing or new)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/InspectionSession"

  /api/inspection/{sessionId}:
    get:
      tags: [Inspection]
      summary: Get session with all related data
      description: Returns session with rooms, line items, photos, damages, and estimate summary.
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Full session data
    patch:
      tags: [Inspection]
      summary: Update session phase, room, structure, or status
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                currentPhase:
                  type: string
                currentRoomId:
                  type: integer
                currentStructure:
                  type: string
                status:
                  type: string
      responses:
        "200":
          description: Updated session

  /api/inspection/{sessionId}/complete:
    post:
      tags: [Inspection]
      summary: Complete the inspection session
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Session completed, claim status updated

  # ─── Rooms ───
  /api/inspection/{sessionId}/rooms:
    post:
      tags: [Rooms]
      summary: Create a room in the inspection session
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateRoomRequest"
      responses:
        "201":
          description: Room created
    get:
      tags: [Rooms]
      summary: List all rooms in session
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Array of rooms

  /api/inspection/{sessionId}/rooms/{roomId}/complete:
    post:
      tags: [Rooms]
      summary: Mark room as complete
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
        - name: roomId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Room completed

  # ─── Damages ───
  /api/inspection/{sessionId}/damages:
    post:
      tags: [Damages]
      summary: Record a damage observation
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [roomId, description]
              properties:
                roomId:
                  type: integer
                description:
                  type: string
                severity:
                  type: string
                damageType:
                  type: string
                location:
                  type: string
      responses:
        "201":
          description: Damage recorded
    get:
      tags: [Damages]
      summary: Get damages for session or specific room
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
        - name: roomId
          in: query
          schema:
            type: integer
      responses:
        "200":
          description: Array of damage observations

  # ─── Line Items ───
  /api/inspection/{sessionId}/line-items:
    post:
      tags: [LineItems]
      summary: Add estimate line item
      description: Creates a line item with automatic price calculation from the pricing catalog.
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateLineItemRequest"
      responses:
        "201":
          description: Line item created with calculated pricing
    get:
      tags: [LineItems]
      summary: Get all line items in session
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Array of line items

  /api/inspection/{sessionId}/line-items/{id}:
    patch:
      tags: [LineItems]
      summary: Update a line item
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Updated line item
    delete:
      tags: [LineItems]
      summary: Delete a line item
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Line item deleted

  /api/inspection/{sessionId}/estimate-summary:
    get:
      tags: [LineItems]
      summary: Get estimate totals (RCV, depreciation, ACV)
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Estimate summary
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/EstimateSummary"

  # ─── Realtime Voice ───
  /api/realtime/session:
    post:
      tags: [Realtime]
      summary: Create OpenAI Realtime API session
      description: |
        Generates an ephemeral token for the OpenAI Realtime API (gpt-4o-realtime-preview).
        The client uses this token to establish a WebRTC connection directly to OpenAI.
        System instructions are built from the claim's briefing and configuration.
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [claimId, sessionId]
              properties:
                claimId:
                  type: integer
                sessionId:
                  type: integer
      responses:
        "200":
          description: Ephemeral client secret for WebRTC connection
          content:
            application/json:
              schema:
                type: object
                properties:
                  clientSecret:
                    type: string
                  model:
                    type: string

  /api/inspection/{sessionId}/completeness:
    get:
      tags: [Realtime]
      summary: AI-driven scope completeness check
      description: Analyzes the inspection session for scope gaps, missing rooms, or undocumented damages.
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Completeness assessment with risk scoring

  # ─── Export ───
  /api/inspection/{sessionId}/export/validate:
    post:
      tags: [Export]
      summary: Validate export readiness
      description: Returns blockers, warnings, and summary of what will be exported.
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Export validation result
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ExportValidation"

  /api/inspection/{sessionId}/export/esx:
    post:
      tags: [Export]
      summary: Generate Xactimate ESX file
      description: Produces a ZIP file containing the Xactimate-compatible ESX XML and supporting data.
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: ESX ZIP file
          content:
            application/zip:
              schema:
                type: string
                format: binary

  /api/inspection/{sessionId}/export/pdf:
    post:
      tags: [Export]
      summary: Generate inspection report PDF
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: PDF report
          content:
            application/pdf:
              schema:
                type: string
                format: binary

  /api/inspection/{sessionId}/review/ai:
    post:
      tags: [Export]
      summary: AI review of estimate completeness
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: AI review with recommendations

  # ─── Pricing ───
  /api/pricing/catalog:
    get:
      tags: [Pricing]
      summary: Get full pricing catalog
      responses:
        "200":
          description: Array of catalog items

  /api/pricing/catalog/search:
    get:
      tags: [Pricing]
      summary: Search catalog by code or description
      parameters:
        - name: q
          in: query
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Matching catalog items

  /api/pricing/scope:
    post:
      tags: [Pricing]
      summary: Calculate priced estimate from line items
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [items]
              properties:
                items:
                  type: array
                  items:
                    type: object
                regionId:
                  type: string
                taxRate:
                  type: number
      responses:
        "200":
          description: Priced items with totals

  /api/pricing/seed:
    post:
      tags: [Pricing]
      summary: Seed pricing catalog (admin only)
      security:
        - bearerAuth: []
      responses:
        "200":
          description: Catalog seeded

  # ─── Auth ───
  /api/auth/sync:
    post:
      tags: [Auth]
      summary: Sync Supabase user to local database
      description: Called after Supabase authentication to create or update the local user record.
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                supabaseId:
                  type: string
                email:
                  type: string
                fullName:
                  type: string
      responses:
        "200":
          description: User synced

  /api/auth/me:
    get:
      tags: [Auth]
      summary: Get current user profile
      responses:
        "200":
          description: User profile (id, email, fullName, role)

  /api/settings:
    get:
      tags: [Auth]
      summary: Get user settings
      responses:
        "200":
          description: Settings object
    put:
      tags: [Auth]
      summary: Update user settings
      requestBody:
        content:
          application/json:
            schema:
              type: object
              description: 24 optional settings fields (voiceModel, voiceSpeed, theme, etc.)
      responses:
        "200":
          description: Updated settings

  # ─── Admin ───
  /api/admin/users:
    get:
      tags: [Admin]
      summary: List team members with active claims
      description: Requires supervisor or admin role.
      responses:
        "200":
          description: Array of users with claim counts

  /api/admin/claims/assign:
    post:
      tags: [Admin]
      summary: Assign claim to user
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [claimId, userId]
              properties:
                claimId:
                  type: integer
                userId:
                  type: integer
      responses:
        "200":
          description: Claim assigned

  /api/admin/dashboard:
    get:
      tags: [Admin]
      summary: Get dashboard statistics
      description: Total claims, active sessions, average inspection time, total estimate value.
      responses:
        "200":
          description: Dashboard stats

  /api/admin/active-sessions:
    get:
      tags: [Admin]
      summary: List all active inspection sessions
      responses:
        "200":
          description: Array of active sessions with user info

  # ─── Supplemental ───
  /api/inspection/{sessionId}/supplemental:
    post:
      tags: [Supplemental]
      summary: Create supplemental claim
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                reason:
                  type: string
                newLineItems:
                  type: array
                  items:
                    type: object
                removedLineItemIds:
                  type: array
                  items:
                    type: integer
                modifiedLineItems:
                  type: array
                  items:
                    type: object
      responses:
        "201":
          description: Supplemental created

  /api/inspection/{sessionId}/supplementals:
    get:
      tags: [Supplemental]
      summary: Get all supplementals for session
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Array of supplemental claims

  /api/supplemental/{id}/submit:
    post:
      tags: [Supplemental]
      summary: Submit supplemental claim for review
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Supplemental submitted

  /api/supplemental/{id}/export/esx:
    post:
      tags: [Supplemental]
      summary: Export supplemental as ESX
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: ESX ZIP file
          content:
            application/zip:
              schema:
                type: string
                format: binary
```

### A.3 — Serve Swagger UI

In `server/index.ts`, after the pino-http middleware (added in PROMPT-22), add:

```ts
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import fs from "fs";
import path from "path";

// Load OpenAPI spec
const openApiSpec = YAML.parse(
  fs.readFileSync(path.resolve("docs/openapi.yaml"), "utf-8")
);

// Serve Swagger UI at /docs (no auth required)
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, {
  customSiteTitle: "Claims IQ API Docs",
  customCss: ".swagger-ui .topbar { display: none }",
}));
```

**Install YAML parser**:

```bash
npm install yaml
```

The API documentation will be accessible at `http://localhost:5000/docs` in development and at the deployed URL in production.

---

## Part B — Data Seeding Scripts

### B.1 — Create Script Directory

```bash
mkdir -p scripts
```

### B.2 — Demo Data Seed Script

Create `scripts/seed-demo.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Seed the database with realistic demo data for development and testing.
 *
 * Usage:
 *   tsx scripts/seed-demo.ts          # Seed all demo data
 *   tsx scripts/seed-demo.ts --clean  # Delete demo data first, then seed
 *
 * Creates:
 *   - 3 users (adjuster, supervisor, admin)
 *   - 8 claims across various statuses and peril types
 *   - 2 complete inspection sessions with rooms, damages, line items, photos
 *   - Pricing catalog (via existing seed endpoint)
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../shared/schema";
import { eq } from "drizzle-orm";

const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("ERROR: SUPABASE_DATABASE_URL or DATABASE_URL required");
  process.exit(1);
}

const client = postgres(connectionString, { prepare: false });
const db = drizzle(client, { schema });

const isClean = process.argv.includes("--clean");

// ─── Demo Users ───
const DEMO_USERS = [
  {
    email: "adjuster@demo.claimsiq.com",
    fullName: "Alex Rivera",
    role: "adjuster",
    supabaseAuthId: "demo-adjuster-001",
  },
  {
    email: "supervisor@demo.claimsiq.com",
    fullName: "Jordan Chen",
    role: "supervisor",
    supabaseAuthId: "demo-supervisor-001",
  },
  {
    email: "admin@demo.claimsiq.com",
    fullName: "Sam Martinez",
    role: "admin",
    supabaseAuthId: "demo-admin-001",
  },
];

// ─── Demo Claims ───
const DEMO_CLAIMS = [
  {
    claimNumber: "DEMO-2025-001",
    insuredName: "Patricia Thompson",
    propertyAddress: "142 Oak Street",
    city: "Austin",
    state: "TX",
    zip: "78701",
    dateOfLoss: "2025-01-15",
    perilType: "water",
    status: "inspection_complete",
  },
  {
    claimNumber: "DEMO-2025-002",
    insuredName: "Robert Kim",
    propertyAddress: "8821 Maple Drive",
    city: "Denver",
    state: "CO",
    zip: "80202",
    dateOfLoss: "2025-02-01",
    perilType: "hail",
    status: "briefing_ready",
  },
  {
    claimNumber: "DEMO-2025-003",
    insuredName: "Maria Santos",
    propertyAddress: "55 Elm Avenue",
    city: "Miami",
    state: "FL",
    zip: "33101",
    dateOfLoss: "2025-01-28",
    perilType: "wind",
    status: "new",
  },
  {
    claimNumber: "DEMO-2025-004",
    insuredName: "James O'Brien",
    propertyAddress: "203 Pine Court",
    city: "Seattle",
    state: "WA",
    zip: "98101",
    dateOfLoss: "2025-02-05",
    perilType: "fire",
    status: "documents_uploaded",
  },
  {
    claimNumber: "DEMO-2025-005",
    insuredName: "Linda Washington",
    propertyAddress: "77 Birch Lane",
    city: "Nashville",
    state: "TN",
    zip: "37201",
    dateOfLoss: "2024-12-20",
    perilType: "water",
    status: "estimate_ready",
  },
  {
    claimNumber: "DEMO-2025-006",
    insuredName: "David Nakamura",
    propertyAddress: "510 Willow Way",
    city: "Portland",
    state: "OR",
    zip: "97201",
    dateOfLoss: "2025-01-10",
    perilType: "wind",
    status: "inspection_in_progress",
  },
  {
    claimNumber: "DEMO-2025-007",
    insuredName: "Sarah Mitchell",
    propertyAddress: "1200 Cedar Blvd",
    city: "Chicago",
    state: "IL",
    zip: "60601",
    dateOfLoss: "2025-02-08",
    perilType: "hail",
    status: "exported",
  },
  {
    claimNumber: "DEMO-2025-008",
    insuredName: "Michael Patel",
    propertyAddress: "340 Spruce Street",
    city: "Phoenix",
    state: "AZ",
    zip: "85001",
    dateOfLoss: "2025-01-22",
    perilType: "fire",
    status: "new",
  },
];

// ─── Demo Rooms (for completed inspection sessions) ───
const DEMO_ROOMS = [
  { name: "Living Room", roomType: "living", structure: "Main Dwelling", phase: "Interior" },
  { name: "Master Bedroom", roomType: "bedroom", structure: "Main Dwelling", phase: "Interior" },
  { name: "Kitchen", roomType: "kitchen", structure: "Main Dwelling", phase: "Interior" },
  { name: "Bathroom 1", roomType: "bathroom", structure: "Main Dwelling", phase: "Interior" },
  { name: "Roof - North Slope", roomType: "exterior", structure: "Main Dwelling", phase: "Exterior" },
];

// ─── Demo Damages ───
const DEMO_DAMAGES = [
  { description: "Water staining on ceiling drywall, approximately 4x3 feet", severity: "moderate", damageType: "water" },
  { description: "Warped hardwood flooring near baseboard, 6 linear feet", severity: "severe", damageType: "water" },
  { description: "Mold growth behind wallpaper near window frame", severity: "severe", damageType: "mold" },
  { description: "Cracked ceiling tiles from water saturation", severity: "moderate", damageType: "water" },
  { description: "Missing shingles on north slope, 3 tab style", severity: "severe", damageType: "wind" },
];

// ─── Demo Line Items ───
const DEMO_LINE_ITEMS = [
  { category: "Drywall", action: "Remove & Replace", description: "Remove and replace water-damaged drywall ceiling", xactCode: "DRY-REM-AR", quantity: 12, unit: "SF", unitPrice: 4.25, totalPrice: 51.00 },
  { category: "Flooring", action: "Remove & Replace", description: "Remove and replace warped hardwood flooring", xactCode: "FLR-HWD-AR", quantity: 6, unit: "LF", unitPrice: 12.50, totalPrice: 75.00 },
  { category: "Painting", action: "Repaint", description: "Prime and paint ceiling after drywall replacement", xactCode: "PNT-CLG-AR", quantity: 12, unit: "SF", unitPrice: 2.75, totalPrice: 33.00 },
  { category: "Roofing", action: "Replace", description: "Replace missing 3-tab asphalt shingles", xactCode: "RFG-SHIN-AR", quantity: 30, unit: "SF", unitPrice: 8.50, totalPrice: 255.00 },
  { category: "Remediation", action: "Treat", description: "Mold remediation treatment behind wallpaper", xactCode: "REM-MOLD-AR", quantity: 25, unit: "SF", unitPrice: 15.00, totalPrice: 375.00 },
];

async function seedDemoData() {
  console.log("🌱 Seeding demo data...\n");

  if (isClean) {
    console.log("🧹 Cleaning existing demo data...");
    // Delete in reverse dependency order
    for (const claim of DEMO_CLAIMS) {
      const existing = await db.query.claims.findFirst({
        where: eq(schema.claims.claimNumber, claim.claimNumber),
      });
      if (existing) {
        // Delete related data (sessions will cascade)
        await db.delete(schema.claims).where(eq(schema.claims.id, existing.id));
        console.log(`  Deleted claim ${claim.claimNumber}`);
      }
    }
    for (const user of DEMO_USERS) {
      await db.delete(schema.users).where(eq(schema.users.email, user.email));
      console.log(`  Deleted user ${user.email}`);
    }
    console.log("");
  }

  // ─── Create Users ───
  console.log("👤 Creating demo users...");
  const createdUsers: Record<string, number> = {};
  for (const user of DEMO_USERS) {
    const existing = await db.query.users.findFirst({
      where: eq(schema.users.email, user.email),
    });
    if (existing) {
      createdUsers[user.role] = existing.id;
      console.log(`  Exists: ${user.fullName} (${user.role})`);
    } else {
      const [created] = await db.insert(schema.users).values(user).returning();
      createdUsers[user.role] = created.id;
      console.log(`  Created: ${user.fullName} (${user.role})`);
    }
  }

  // ─── Create Claims ───
  console.log("\n📋 Creating demo claims...");
  const createdClaims: Array<{ id: number; claimNumber: string; status: string }> = [];
  for (const claim of DEMO_CLAIMS) {
    const existing = await db.query.claims.findFirst({
      where: eq(schema.claims.claimNumber, claim.claimNumber),
    });
    if (existing) {
      createdClaims.push({ id: existing.id, claimNumber: claim.claimNumber, status: claim.status });
      console.log(`  Exists: ${claim.claimNumber} (${claim.status})`);
    } else {
      const [created] = await db.insert(schema.claims).values({
        ...claim,
        assignedTo: createdUsers.adjuster,
      }).returning();
      createdClaims.push({ id: created.id, claimNumber: claim.claimNumber, status: claim.status });
      console.log(`  Created: ${claim.claimNumber} (${claim.status})`);
    }
  }

  // ─── Create Inspection Sessions for completed claims ───
  const inspectionClaims = createdClaims.filter(
    (c) => ["inspection_complete", "estimate_ready", "exported"].includes(c.status)
  );

  for (const claim of inspectionClaims) {
    console.log(`\n🔍 Creating inspection data for ${claim.claimNumber}...`);

    // Check for existing session
    const existingSession = await db.query.inspectionSessions.findFirst({
      where: eq(schema.inspectionSessions.claimId, claim.id),
    });
    if (existingSession) {
      console.log(`  Session already exists (id: ${existingSession.id})`);
      continue;
    }

    // Create session
    const [session] = await db.insert(schema.inspectionSessions).values({
      claimId: claim.id,
      status: "completed",
      currentPhase: "Interior",
      startedAt: new Date(Date.now() - 3600000), // 1 hour ago
      completedAt: new Date(),
    }).returning();
    console.log(`  Session: id=${session.id}`);

    // Create rooms
    const roomIds: number[] = [];
    for (const room of DEMO_ROOMS) {
      const [created] = await db.insert(schema.inspectionRooms).values({
        sessionId: session.id,
        ...room,
        status: "complete",
      }).returning();
      roomIds.push(created.id);
      console.log(`  Room: ${room.name} (id=${created.id})`);
    }

    // Create damages (spread across rooms)
    const damageIds: number[] = [];
    for (let i = 0; i < DEMO_DAMAGES.length; i++) {
      const [created] = await db.insert(schema.damageObservations).values({
        sessionId: session.id,
        roomId: roomIds[i % roomIds.length],
        ...DEMO_DAMAGES[i],
      }).returning();
      damageIds.push(created.id);
      console.log(`  Damage: ${DEMO_DAMAGES[i].description.substring(0, 50)}...`);
    }

    // Create line items
    for (let i = 0; i < DEMO_LINE_ITEMS.length; i++) {
      await db.insert(schema.lineItems).values({
        sessionId: session.id,
        roomId: roomIds[i % roomIds.length],
        damageId: damageIds[i % damageIds.length],
        ...DEMO_LINE_ITEMS[i],
        provenance: "manual",
      });
      console.log(`  Line item: ${DEMO_LINE_ITEMS[i].description.substring(0, 50)}...`);
    }
  }

  console.log("\n✅ Demo data seeding complete!");
  console.log(`   Users: ${DEMO_USERS.length}`);
  console.log(`   Claims: ${DEMO_CLAIMS.length}`);
  console.log(`   Inspections: ${inspectionClaims.length}`);
  console.log(`   Rooms per inspection: ${DEMO_ROOMS.length}`);
  console.log(`   Damages per inspection: ${DEMO_DAMAGES.length}`);
  console.log(`   Line items per inspection: ${DEMO_LINE_ITEMS.length}`);

  await client.end();
}

seedDemoData().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
```

### B.3 — Add Seed Scripts to `package.json`

```json
"seed:demo": "tsx scripts/seed-demo.ts",
"seed:demo:clean": "tsx scripts/seed-demo.ts --clean",
"seed:all": "npm run seed:demo && echo 'Note: run POST /api/pricing/seed as admin to seed pricing catalog'"
```

---

## Part C — Session Resilience & Recovery

### C.1 — Persist Active Session ID

Currently, `ActiveInspection.tsx` stores `sessionId` in React state (line 81), which is lost on page reload. Add localStorage persistence so inspections can be resumed.

In `ActiveInspection.tsx`, modify the session initialization:

```tsx
// REPLACE the sessionId state declaration (line 81) with:
const [sessionId, setSessionId] = useState<number | null>(() => {
  // Attempt to restore session from localStorage on mount
  const saved = localStorage.getItem(`inspection-session-${claimId}`);
  if (saved) {
    const parsed = JSON.parse(saved);
    // Only restore if less than 24 hours old
    if (Date.now() - parsed.timestamp < 86400000) {
      return parsed.sessionId;
    }
    localStorage.removeItem(`inspection-session-${claimId}`);
  }
  return null;
});
```

Then, after the `startSessionMutation` succeeds, persist the session ID:

```tsx
// In the startSessionMutation onSuccess callback (line 132), ADD after setSessionId(data.sessionId):
localStorage.setItem(
  `inspection-session-${claimId}`,
  JSON.stringify({ sessionId: data.sessionId, timestamp: Date.now() })
);
```

And when the inspection completes, clean up:

```tsx
// In the completeInspection handler, ADD:
localStorage.removeItem(`inspection-session-${claimId}`);
```

### C.2 — Session Resume Detection

Add a resume detection banner that shows when a session was recovered from localStorage rather than freshly started:

```tsx
// ADD new state variable alongside sessionId:
const [isResumedSession, setIsResumedSession] = useState(false);

// In the session initialization logic, when restoring from localStorage:
if (saved && parsed.sessionId) {
  setIsResumedSession(true);
}

// Render a brief notification (dismissible) at the top of the inspection view:
{isResumedSession && (
  <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mb-4 flex items-center justify-between">
    <span className="text-sm text-blue-700">
      Resumed previous inspection session. Voice connection will re-establish automatically.
    </span>
    <button
      onClick={() => setIsResumedSession(false)}
      className="text-blue-500 hover:text-blue-700 text-sm font-medium"
    >
      Dismiss
    </button>
  </div>
)}
```

### C.3 — Elapsed Time Persistence

The inspection timer (`elapsedRef`) also resets on page reload. Persist elapsed time alongside the session ID:

```tsx
// When saving session state to localStorage, include elapsed time:
localStorage.setItem(
  `inspection-session-${claimId}`,
  JSON.stringify({
    sessionId: data.id,
    timestamp: Date.now(),
    elapsedSeconds: elapsedRef.current,
  })
);

// When restoring, initialize the elapsed timer:
if (saved && parsed.sessionId) {
  elapsedRef.current = parsed.elapsedSeconds || 0;
}
```

Update the elapsed time in localStorage periodically (every 30 seconds) to avoid data loss:

```tsx
// ADD a new useEffect for periodic persistence:
useEffect(() => {
  if (!sessionId || !isConnected) return;

  const persistInterval = setInterval(() => {
    localStorage.setItem(
      `inspection-session-${claimId}`,
      JSON.stringify({
        sessionId,
        timestamp: Date.now(),
        elapsedSeconds: elapsedRef.current,
      })
    );
  }, 30000); // Every 30 seconds

  return () => clearInterval(persistInterval);
}, [sessionId, isConnected, claimId]);
```

### C.4 — Stale Session Recovery

When an inspection page loads with a restored `sessionId`, verify the session is still valid before reconnecting the voice agent:

```tsx
// ADD validation before voice connection:
useEffect(() => {
  if (!sessionId) return;

  // Validate the session still exists and is active
  apiRequest("GET", `/api/inspection/${sessionId}`)
    .then((res: Response) => res.json())
    .then((session: any) => {
      if (session.status === "completed") {
        // Session already completed — don't reconnect
        localStorage.removeItem(`inspection-session-${claimId}`);
        setSessionId(null);
        // Navigate to export page or show completion message
      }
      // Session valid — proceed with voice connection
    })
    .catch(() => {
      // Session not found — clear stale data
      localStorage.removeItem(`inspection-session-${claimId}`);
      setSessionId(null);
    });
}, [sessionId]);
```

---

## Part D — Developer Quick-Start Guide

### D.1 — Create `CONTRIBUTING.md`

Create `CONTRIBUTING.md` in the project root:

```markdown
# Claims IQ Voice Inspector — Developer Guide

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 16+ (via Supabase or local)
- Supabase project with Storage enabled
- OpenAI API key with Realtime API access

### Setup

1. **Clone and install**:
   ```bash
   git clone https://github.com/claimsiqhq/Claims-iQ-Voice-Inspector.git
   cd Claims-iQ-Voice-Inspector
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Initialize database**:
   ```bash
   npm run db:push          # Push schema to database
   npm run seed:demo        # Load demo data
   ```

4. **Seed pricing catalog** (requires running server):
   ```bash
   npm run dev &
   curl -X POST http://localhost:5000/api/pricing/seed \
     -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
   ```

5. **Start development server**:
   ```bash
   npm run dev
   ```

   Open http://localhost:5000

### Key Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (hot reload) |
| `npm run build` | Build for production |
| `npm start` | Run production build |
| `npm run check` | TypeScript type check |
| `npm test` | Run test suite |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run db:push` | Push schema changes to database |
| `npm run db:generate` | Generate migration files |
| `npm run db:migrate` | Apply migrations |
| `npm run db:migrate:safe` | Run migrations with safety checks |
| `npm run db:migrate:dry` | Preview pending migrations |
| `npm run seed:demo` | Seed demo data |
| `npm run seed:demo:clean` | Reset and re-seed demo data |

### Project Structure

```
├── client/                 # React frontend (Vite + Tailwind)
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Route pages
│   │   ├── hooks/          # Custom React hooks
│   │   └── lib/            # Utilities (queryClient, supabase)
│   └── index.html
├── server/                 # Express backend
│   ├── index.ts            # Server entry, middleware, rate limiting
│   ├── routes.ts           # All 51 API endpoints
│   ├── auth.ts             # 4 auth middleware exports
│   ├── storage.ts          # DatabaseStorage (IStorage implementation)
│   ├── realtime.ts         # OpenAI Realtime API integration
│   ├── estimateEngine.ts   # Pricing calculation engine
│   ├── esxGenerator.ts     # Xactimate ESX export
│   ├── aiReview.ts         # AI estimate review
│   ├── supabase.ts         # Supabase client + bucket config
│   ├── openai.ts           # OpenAI client + extraction
│   ├── logger.ts           # Pino structured logging
│   ├── sanitize.ts         # Input sanitization utilities
│   └── env.ts              # Environment validation
├── shared/
│   └── schema.ts           # Drizzle ORM schema (12 tables)
├── scripts/
│   ├── seed-demo.ts        # Demo data generator
│   └── migrate.ts          # Safe migration runner
├── docs/
│   └── openapi.yaml        # OpenAPI 3.0 specification
├── tests/                  # Vitest test suites
├── migrations/             # Drizzle migration files
└── .env.example            # Environment variable template
```

### API Documentation

Interactive API docs are available at `/docs` when the server is running.

The OpenAPI 3.0 specification is at `docs/openapi.yaml`.

### Authentication

All API endpoints (except `/health`, `/readiness`, and `/docs`) require a Supabase JWT token in the `Authorization: Bearer <token>` header.

Auth middleware chain:
1. `authenticateRequest` — Validates JWT, attaches user to `req.user`
2. `authenticateSupabaseToken` — Direct Supabase token validation (used by `/api/auth/sync`)
3. `requireRole("role")` — Role gate (adjuster, supervisor, admin)
4. `optionalAuth` — Proceeds with or without auth

### Voice Inspection Flow

1. Client calls `POST /api/claims/{id}/inspection/start` → gets `sessionId`
2. Client calls `POST /api/realtime/session` with `{ claimId, sessionId }` → gets `clientSecret`
3. Client establishes WebRTC connection to OpenAI using `clientSecret`
4. Voice agent tools (defined in `server/realtime.ts`) call back to API endpoints
5. Client calls `POST /api/inspection/{sessionId}/complete` when done
6. Client calls `POST /api/inspection/{sessionId}/export/esx` or `/pdf` for output

### Testing

```bash
npm test                    # Run all tests
npm run test:coverage       # With coverage report
npx vitest --reporter=verbose  # Verbose output
npx vitest tests/schema.test.ts  # Run specific file
```

Test files are in `tests/` and use Vitest with mock storage.

### Docker

```bash
docker build -t claims-iq .
docker compose up
```

See `Dockerfile` and `docker-compose.yml` for configuration.

### Demo Accounts

After running `npm run seed:demo`:

| Role | Email | Name |
|------|-------|------|
| Adjuster | adjuster@demo.claimsiq.com | Alex Rivera |
| Supervisor | supervisor@demo.claimsiq.com | Jordan Chen |
| Admin | admin@demo.claimsiq.com | Sam Martinez |

Note: These are local database records. You still need Supabase Auth credentials to authenticate. For development, create matching accounts in your Supabase project's Auth dashboard.
```

---

## Summary of All Changes

| File | Change Type | Description |
|------|------------|-------------|
| `docs/openapi.yaml` | CREATE | OpenAPI 3.0 specification documenting all 51 endpoints with schemas |
| `server/index.ts` | MODIFY | Add Swagger UI middleware at `/docs` route |
| `scripts/seed-demo.ts` | CREATE | Demo data generator (3 users, 8 claims, 2 inspections with rooms/damages/items) |
| `client/src/pages/ActiveInspection.tsx` | MODIFY | Add localStorage session persistence, resume detection, elapsed time persistence, stale session validation |
| `CONTRIBUTING.md` | CREATE | Developer quick-start guide with setup, commands, project structure, flow docs |
| `package.json` | MODIFY | Add swagger-ui-express, yaml deps; add seed:demo, seed:demo:clean, seed:all scripts |

**New files**: 4
**Modified files**: 3
**New dependencies**: 2 runtime (swagger-ui-express, yaml) + 1 dev (@types/swagger-ui-express)
