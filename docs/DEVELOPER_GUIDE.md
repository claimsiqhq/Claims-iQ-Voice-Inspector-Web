# Claims IQ Voice Inspector — Complete Developer Guide

This document is the authoritative reference for replicating the Claims IQ Voice Inspector application from scratch. It covers every layer of the system: architecture, database schema, API routes, voice agent tools, backend engines, frontend components, authentication, build pipeline, and deployment.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Stack](#3-technology-stack)
4. [Environment Variables](#4-environment-variables)
5. [Project File Structure](#5-project-file-structure)
6. [Database Schema](#6-database-schema)
7. [Authentication System](#7-authentication-system)
8. [API Routes Reference](#8-api-routes-reference)
9. [Voice Inspection System](#9-voice-inspection-system)
10. [Backend Services & Engines](#10-backend-services--engines)
11. [Workflow Orchestration](#11-workflow-orchestration)
12. [Sketch & Floor Plan System](#12-sketch--floor-plan-system)
13. [Frontend Pages & Components](#13-frontend-pages--components)
14. [Build & Deployment](#14-build--deployment)
15. [External Services Integration](#15-external-services-integration)
16. [Key Design Decisions](#16-key-design-decisions)
17. [Setup Instructions](#17-setup-instructions)

---

## 1. Project Overview

Claims IQ Voice Inspector is an AI-powered, voice-driven field inspection assistant for insurance adjusters. It automates the end-to-end insurance claims workflow:

1. **Document Upload & AI Parsing** — Upload FNOL, Policy, and Endorsement PDFs; GPT-4.1 extracts structured data.
2. **Pre-Inspection Briefing** — AI synthesizes extractions into a field adjuster's guide with peril analysis, checklists, and red flags.
3. **Voice-Guided Field Inspection** — Real-time voice AI (OpenAI Realtime API via WebRTC) guides the adjuster through creating floor plans, documenting damage, and capturing photos.
4. **Photo Capture with AI Analysis** — GPT-4o Vision detects damage, identifies materials/finishes, and suggests Xactimate line items.
5. **Weather Correlation** — Visual Crossing API validates date-of-loss claims against historical weather data for fraud detection.
6. **Automated Scope Assembly** — Damage observations are automatically mapped to Xactimate-compatible line items with proper quantities, depreciation, and trade codes.
7. **ACV/RCV Settlement Calculations** — Full Xactimate-order-of-operations financial engine with O&P, tax, and depreciation.
8. **Multi-Format Export** — ESX (Xactimate import), PDF Property Estimate, PDF Photo Report, and DOCX Photo Report.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        BROWSER (React SPA)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  wouter   │  │ TanStack │  │ Tailwind  │  │  WebRTC + Data  │ │
│  │ (Routing) │  │  Query   │  │   CSS v4  │  │    Channel      │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┬─────────┘ │
│                                                      │ Audio/Events
└──────────────────────────────────────┬───────────────┼───────────┘
                                       │ REST API      │
                                       ▼               ▼
┌──────────────────────────────┐  ┌────────────────────────────────┐
│      EXPRESS 5 SERVER        │  │   OPENAI REALTIME API          │
│  ┌────────────────────────┐  │  │   (gpt-4o-realtime-preview)    │
│  │  Authentication        │  │  │                                │
│  │  (JWT + Supabase Auth) │  │  │   Browser ←──WebRTC──→ OpenAI  │
│  ├────────────────────────┤  │  │   Server provides ephemeral    │
│  │  Route Handlers        │  │  │   token + system instructions  │
│  │  (Claims, Inspection,  │  │  └────────────────────────────────┘
│  │   Photos, Export, etc.)│  │
│  ├────────────────────────┤  │  ┌────────────────────────────────┐
│  │  Core Engines          │  │  │   OPENAI GPT-4.1 / GPT-4o     │
│  │  (Estimate, Deprec,    │◄─┼──│   - Document extraction        │
│  │   Scope, ESX, PDF)     │  │  │   - Briefing generation        │
│  ├────────────────────────┤  │  │   - Photo damage analysis      │
│  │  Drizzle ORM           │  │  │   - Estimate review            │
│  └─────────┬──────────────┘  │  └────────────────────────────────┘
│            │                 │
└────────────┼─────────────────┘
             │
             ▼
┌────────────────────────┐    ┌────────────────────────┐
│  SUPABASE POSTGRESQL   │    │  SUPABASE STORAGE      │
│  (31 tables via        │    │  - documents bucket    │
│   Drizzle ORM)         │    │  - inspection-photos   │
│                        │    │  - avatars             │
└────────────────────────┘    └────────────────────────┘
```

### Core Design Principles

- **Voice-first**: The inspection is designed to be driven entirely by voice, with UI providing visual feedback and manual fallbacks.
- **Tool-gated phases**: Each workflow phase restricts available AI tools to prevent premature actions.
- **Xactimate compatibility**: Settlement calculations, ESX export format, and line item structure all match Xactimate's order of operations.
- **Dual authentication**: Local JWT for speed, Supabase Auth for OAuth/managed flows, unified by a single middleware.
- **BFS layout engine**: Room positioning uses a graph-based layout rather than manual coordinate placement.
- **Photo analysis bridge**: Normalizes GPT-4o Vision output to standardized damage types for consistent scoping.

---

## 3. Technology Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| React | 19 | UI framework |
| Vite | 7 | Build tool & dev server |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | v4 | Styling |
| shadcn/ui | Latest | Component library (Radix-based) |
| TanStack React Query | 5 | Server state management |
| wouter | 3 | Client-side routing |
| Framer Motion | 12 | Animations |
| pdfjs-dist | 4 | Client-side PDF viewing |
| Recharts | 2 | Data visualization / charts |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Express | 5 | HTTP server |
| Node.js | 20 | Runtime |
| Drizzle ORM | 0.38 | Database ORM |
| postgres.js | 3.4 | PostgreSQL driver |
| PDFKit | 0.15 | PDF generation |
| pdf-parse | 1.1.1 | PDF text extraction (must stay v1.1.1) |
| archiver | 7 | ZIP/ESX file creation |
| docx | 9 | Word document generation |
| bcrypt | 5 | Password hashing |
| jsonwebtoken | 9 | JWT signing/verification |
| pino | 9 | Structured logging |

### External Services
| Service | Purpose |
|---|---|
| Supabase PostgreSQL | Primary database |
| Supabase Storage | File storage (PDFs, photos, avatars) |
| Supabase Auth | OAuth / managed authentication |
| OpenAI GPT-4.1 | Document extraction, briefing generation, estimate review |
| OpenAI GPT-4o | Photo damage analysis (Vision) |
| OpenAI Realtime API | Voice-guided inspection (WebRTC) |
| Visual Crossing API | Historical weather data for fraud detection |

---

## 4. Environment Variables

### Required Secrets
| Variable | Purpose |
|---|---|
| `SUPABASE_DATABASE_URL` | PostgreSQL connection string (Supabase) |
| `SUPABASE_URL` | Supabase project API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase key (bypasses RLS) |
| `SUPABASE_ANON_KEY` | Public Supabase key (passed to client via `/api/config`) |
| `OPENAI_API_KEY` | OpenAI API key for all AI features |
| `JWT_SECRET` | Secret for signing local JWT tokens |
| `VISUAL_CROSSING_API_KEY` | Weather API key for fraud detection |

### Optional Configuration
| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | Toggles dev/prod behavior |
| `PORT` | `5000` | Server port |
| `LOG_LEVEL` | `info` | Pino log level |
| `CORS_ORIGIN` | (auto) | Comma-separated allowed origins |
| `SUPABASE_FETCH_TIMEOUT_MS` | `15000` | Supabase request timeout |
| `VITE_CLIENT_LOGS` | `false` | Enable verbose browser logging |

---

## 5. Project File Structure

```
├── client/                          # Frontend React application
│   ├── src/
│   │   ├── App.tsx                  # Route definitions (wouter)
│   │   ├── main.tsx                 # Entry point
│   │   ├── index.css                # Tailwind CSS entry
│   │   ├── pages/                   # Route-level page components
│   │   │   ├── ActiveInspection.tsx # Main voice inspection UI (4300+ lines)
│   │   │   ├── ClaimsList.tsx       # Claims dashboard
│   │   │   ├── DocumentUpload.tsx   # PDF upload interface
│   │   │   ├── ExtractionReview.tsx # AI extraction review/edit
│   │   │   ├── InspectionBriefing.tsx # Pre-inspection briefing
│   │   │   ├── ScopePage.tsx        # Line item editor
│   │   │   ├── ReviewFinalize.tsx   # Final QA review
│   │   │   ├── ExportPage.tsx       # Report generation
│   │   │   ├── SupervisorDashboard.tsx # Admin dashboard
│   │   │   ├── PhotoLab.tsx         # Standalone photo analysis
│   │   │   ├── PhotoGallery.tsx     # Cross-claim photo browser
│   │   │   ├── SketchGallery.tsx    # Floor plan browser
│   │   │   ├── WorkflowBuilder.tsx  # Inspection flow editor
│   │   │   ├── SettingsPage.tsx     # User settings
│   │   │   ├── ProfilePage.tsx      # User profile
│   │   │   ├── SupplementalPage.tsx # Post-inspection supplements
│   │   │   ├── DocumentsHub.tsx     # Document repository
│   │   │   └── LoginPage.tsx        # Authentication
│   │   ├── components/              # Reusable components
│   │   │   ├── PropertySketch.tsx   # Multi-section property layout
│   │   │   ├── SketchRenderer.tsx   # SVG primitive renderer
│   │   │   ├── SketchEditor.tsx     # Interactive floor plan editor
│   │   │   ├── FloorPlanSketch.tsx  # Simplified floor plan view
│   │   │   ├── ClaimCard.tsx        # Claim summary card
│   │   │   ├── PhotoAnnotator.tsx   # Canvas-based photo markup
│   │   │   ├── PhotoGallery.tsx     # Photo grid with filtering
│   │   │   ├── WeatherCorrelation.tsx # Weather/fraud visualization
│   │   │   ├── MoistureMap.tsx      # Moisture reading visualizer
│   │   │   ├── VoiceIndicator.tsx   # Voice agent status display
│   │   │   ├── AIReviewPanel.tsx    # AI compliance review
│   │   │   ├── XactimateEstimateView.tsx # Estimate preview
│   │   │   ├── RoomEditorPanel.tsx  # Room dimension editor
│   │   │   ├── BottomNav.tsx        # Mobile tab navigation
│   │   │   ├── Layout.tsx           # Page wrapper
│   │   │   ├── OfflineBanner.tsx    # Offline indicator
│   │   │   ├── OnboardingWizard.tsx # First-time setup
│   │   │   ├── PdfViewer.tsx        # Document previewer
│   │   │   ├── ProgressMap.tsx      # Inspection progress modal
│   │   │   ├── StatusBadge.tsx      # Status chip
│   │   │   ├── SettingsProvider.tsx  # Settings context
│   │   │   ├── ErrorBoundary.tsx    # Error boundary
│   │   │   └── ui/                  # shadcn/ui primitives
│   │   ├── contexts/
│   │   │   └── AuthContext.tsx      # Authentication state
│   │   ├── hooks/
│   │   │   ├── use-toast.ts         # Toast notifications
│   │   │   ├── use-settings.ts      # User settings hook
│   │   │   ├── useOfflineSync.ts    # Offline queue sync
│   │   │   └── useOnlineStatus.ts   # Network status
│   │   └── lib/
│   │       ├── queryClient.ts       # TanStack Query config
│   │       ├── supabaseClient.ts    # Supabase browser client
│   │       ├── sketchLayout.ts      # BFS layout engine
│   │       ├── realtimeTooling.ts   # Voice tool execution
│   │       ├── offlineQueue.ts      # Offline operation queue
│   │       ├── fetchWithTimeout.ts  # Fetch wrapper
│   │       ├── logger.ts            # Client-side logger
│   │       └── utils.ts             # Utility functions
│   └── index.html                   # HTML entry with meta tags
│
├── server/                          # Backend Express application
│   ├── index.ts                     # Server entry point
│   ├── db.ts                        # Database connection (postgres.js + Drizzle)
│   ├── storage.ts                   # IStorage interface + Drizzle implementation
│   ├── supabase.ts                  # Supabase admin client
│   ├── auth.ts                      # Auth middleware (authenticateRequest, requireRole)
│   ├── localAuth.ts                 # JWT signing/verification
│   ├── authorization.ts             # Resource-level access control
│   ├── logger.ts                    # Pino logger configuration
│   ├── vite.ts                      # Dev server Vite middleware
│   ├── static.ts                    # Production static file serving
│   ├── routes/
│   │   ├── index.ts                 # Route registry + health/config endpoints
│   │   ├── auth.ts                  # Login, register, sync
│   │   ├── claims.ts                # Claims CRUD, document upload, extraction, briefing
│   │   ├── inspection.ts            # Inspection sessions, rooms, damages, scope, photos, export
│   │   ├── realtime.ts              # OpenAI Realtime session creation
│   │   ├── photolab.ts              # Standalone photo analysis
│   │   ├── settings.ts              # User settings CRUD
│   │   ├── admin.ts                 # Supervisor/admin dashboard
│   │   ├── gallery.ts               # Cross-claim photo/sketch browser
│   │   ├── supplemental.ts          # Supplemental claims
│   │   ├── flows.ts                 # Inspection flow CRUD
│   │   ├── pricing.ts               # Catalog search, regional pricing
│   │   ├── documents.ts             # Document status tracking
│   │   ├── notifications.ts         # User notifications
│   │   ├── profile.ts               # Profile management
│   │   └── logs.ts                  # Voice tool logging
│   ├── realtime.ts                  # Voice agent system instructions + tool definitions
│   ├── openai.ts                    # OpenAI API wrapper (extraction, briefing, photo analysis)
│   ├── aiReview.ts                  # AI estimate review service
│   ├── estimateEngine.ts            # RCV/ACV settlement calculations
│   ├── depreciationEngine.ts        # Depreciation based on life expectancy
│   ├── esxGenerator.ts              # Xactimate ESX/XML export
│   ├── pdfGenerator.ts              # PDF Property Estimate report
│   ├── photoReportGenerator.ts      # Photo report (PDF + DOCX)
│   ├── weatherService.ts            # Visual Crossing weather correlation
│   ├── scopeAssemblyService.ts      # Damage-to-line-item mapping
│   ├── scopeQuantityEngine.ts       # Formula-based quantity calculation
│   ├── companionEngine.ts           # Companion item auto-add rules
│   ├── openingDeductionService.ts   # Window/door wall deductions
│   ├── photoScopeBridge.ts          # Vision AI to damage type normalization
│   ├── tradeCodeMapping.ts          # Trade alias to Xactimate category
│   ├── mleSplitService.ts           # Multi-line-entry splitting
│   ├── seed-flows.ts                # System inspection flow seeder
│   └── workflow/
│       ├── orchestrator.ts          # Workflow state machine
│       └── validators/
│           ├── sketchGate.ts        # Geometry validation
│           ├── photoDamageGate.ts    # Photo evidence validation
│           ├── scopeGate.ts         # Scope completeness validation
│           └── exportGate.ts        # Export readiness validation
│
├── shared/                          # Code shared between client & server
│   ├── schema.ts                    # Drizzle ORM table definitions (31 tables)
│   ├── contracts/
│   │   ├── workflow.ts              # Phase definitions, tool permissions
│   │   └── tools.ts                 # ToolResult interface, error envelopes
│   └── models/
│       └── chat.ts                  # Chat/transcript types
│
├── migrations/                      # Drizzle migration files
├── supabase/                        # Supabase config and seed scripts
├── script/
│   ├── build.ts                     # Unified build script (Vite + esbuild)
│   └── seed-demo.ts                 # Demo data seeder
├── docs/                            # Documentation
├── drizzle.config.ts                # Drizzle ORM configuration
├── vite.config.ts                   # Vite build configuration
├── tsconfig.json                    # TypeScript configuration
├── package.json                     # Dependencies and scripts
└── .replit                          # Replit deployment configuration
```

---

## 6. Database Schema

The application uses 31 PostgreSQL tables managed by Drizzle ORM. All schema definitions are in `shared/schema.ts`.

### 6.1 User Management

#### `users`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `varchar` | PK, UUID default | User identifier |
| `username` | `text` | NOT NULL, UNIQUE | Login username |
| `password` | `text` | NOT NULL | bcrypt-hashed password |
| `email` | `text` | UNIQUE | Email address |
| `fullName` | `text` | | Display name |
| `role` | `varchar(20)` | Default: `'adjuster'` | One of: `admin`, `supervisor`, `adjuster` |
| `title` | `text` | | Job title |
| `avatarUrl` | `text` | | Profile image URL |
| `supabaseAuthId` | `varchar(100)` | UNIQUE | Links to Supabase Auth user |
| `lastLoginAt` | `timestamp` | | Last login timestamp |
| `isActive` | `boolean` | Default: `true` | Account status |

#### `user_settings`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `userId` | `varchar` | FK → `users.id` | Owner |
| `settings` | `jsonb` | | Voice preferences, financial defaults, assistant config |
| `updatedAt` | `timestamp` | | |

### 6.2 Claims & Documents

#### `claims`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `claimNumber` | `varchar(50)` | NOT NULL, UNIQUE | Insurance claim number |
| `insuredName` | `text` | | Policyholder name |
| `propertyAddress` | `text` | | Full street address |
| `city` | `varchar(100)` | | |
| `state` | `varchar(2)` | | US state code |
| `zip` | `varchar(10)` | | ZIP code |
| `dateOfLoss` | `varchar(20)` | | ISO date string |
| `perilType` | `varchar(20)` | | hail, wind, water, fire, general |
| `status` | `varchar(30)` | NOT NULL, Default: `'draft'` | draft, documents_uploaded, briefing_ready, in_progress, review, complete |
| `assignedTo` | `varchar` | FK → `users.id` | Assigned adjuster |
| `createdAt` | `timestamp` | | |
| `updatedAt` | `timestamp` | | |

#### `documents`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `claimId` | `integer` | FK → `claims.id` CASCADE | |
| `documentType` | `varchar(20)` | NOT NULL | `fnol`, `policy`, `endorsements` |
| `fileName` | `text` | | Original filename |
| `fileSize` | `integer` | | Bytes |
| `storagePath` | `text` | | Supabase Storage path |
| `rawText` | `text` | | Extracted plain text |
| `status` | `varchar(20)` | Default: `'empty'` | empty, uploaded, parsed, error |
| `errorMessage` | `text` | | Parse error details |
| `createdAt` | `timestamp` | | |

#### `extractions`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `claimId` | `integer` | FK → `claims.id` CASCADE | |
| `documentType` | `varchar(20)` | NOT NULL | Same as documents |
| `extractedData` | `jsonb` | NOT NULL | Structured extraction result |
| `confidence` | `jsonb` | | Per-field confidence scores |
| `confirmedByUser` | `boolean` | Default: `false` | Manual confirmation flag |
| `createdAt` | `timestamp` | | |
| `updatedAt` | `timestamp` | | |

#### `briefings`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `claimId` | `integer` | FK → `claims.id` CASCADE | |
| `propertyProfile` | `jsonb` | | Property details |
| `coverageSnapshot` | `jsonb` | | Coverage limits and deductibles |
| `perilAnalysis` | `jsonb` | | What damage to look for |
| `endorsementImpacts` | `jsonb` | | How endorsements affect coverage |
| `inspectionChecklist` | `jsonb` | | Room-by-room checklist |
| `dutiesAfterLoss` | `jsonb` | | Policyholder obligations |
| `redFlags` | `jsonb` | | Fraud/concern indicators |
| `createdAt` | `timestamp` | | |

### 6.3 Inspection Engine

#### `inspection_sessions`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `claimId` | `integer` | FK → `claims.id` CASCADE | |
| `inspectorId` | `varchar` | FK → `users.id` | |
| `status` | `varchar(20)` | Default: `'active'` | active, paused, completed |
| `currentPhase` | `integer` | | Legacy numeric phase (1-8) |
| `activeFlowId` | `integer` | | Active inspection flow template |
| `currentStepIndex` | `integer` | | Current step within flow |
| `currentRoomId` | `integer` | | Currently active room |
| `completedPhases` | `integer[]` | | Array of completed phase numbers |
| `currentStructure` | `varchar(100)` | | Active structure name |
| `voiceSessionId` | `text` | | OpenAI Realtime session ID |
| `adjusterNotes` | `text` | | Free-form notes |
| `workflowStateJson` | `jsonb` | | Orchestrator state (phase, stepId, context) |
| `gateResultsJson` | `jsonb` | | Validation gate results |
| `waterClassification` | `jsonb` | | IICRC water class/category |
| `startedAt` | `timestamp` | | |
| `completedAt` | `timestamp` | | |

#### `inspection_flows`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `userId` | `varchar` | FK → `users.id` | Creator (null for system) |
| `name` | `varchar(200)` | NOT NULL | Flow name |
| `perilType` | `varchar(20)` | | hail, wind, water, fire, general |
| `description` | `text` | | |
| `isDefault` | `boolean` | Default: `false` | User's default for this peril |
| `isSystemDefault` | `boolean` | Default: `false` | System-provided template |
| `steps` | `jsonb` | | Array of step definitions |
| `createdAt` | `timestamp` | | |
| `updatedAt` | `timestamp` | | |

### 6.4 Structural Hierarchy

The inspection data model follows a 5-level hierarchy:

```
L1: Structure (Main Dwelling, Detached Garage, Fence)
  L2: Room / Area (Master Bedroom, Roof Facet F1, Front Elevation)
    L3: Sub-Area (Walk-in Closet, Dormer, Bay Window)
      L4: Opening (Door, Window, Missing Wall)
        L5: Annotation (Hail Count, Pitch, Material Note)
```

#### `structures` (L1)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `sessionId` | `integer` | FK → `inspection_sessions.id` CASCADE | |
| `name` | `varchar(100)` | NOT NULL | e.g., "Main Dwelling" |
| `structureType` | `varchar(30)` | Default: `'dwelling'` | dwelling, garage, shed, fence, pool, other |
| `outline` | `jsonb` | | Shape outline data |
| `position` | `jsonb` | | Layout position |
| `sortOrder` | `integer` | | Display order |
| `createdAt` | `timestamp` | | |

#### `inspection_rooms` (L2/L3)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `sessionId` | `integer` | FK → `inspection_sessions.id` | |
| `name` | `varchar(100)` | NOT NULL | Room name |
| `roomType` | `varchar(50)` | | interior_bedroom, roof_facet, elevation_front, etc. |
| `structureId` | `integer` | FK → `structures.id` | Parent structure |
| `viewType` | `varchar` | | interior, roof_plan, elevation, exterior_other |
| `shapeType` | `varchar` | | rectangle, gable, hip, l_shape, custom |
| `status` | `varchar` | | pending, in_progress, complete |
| `pitch` | `varchar` | | Roof pitch (e.g., "6/12") |
| `parentRoomId` | `integer` | FK → `inspection_rooms.id` | For L3 sub-areas |
| `attachmentType` | `varchar(30)` | | extension, closet, dormer, bay_window, alcove, etc. |
| `dimensions` | `jsonb` | | `{ length, width, height, ceilingType }` |
| `polygon` | `jsonb` | | Custom shape vertices |
| `dimensionProvenance` | `jsonb` | | Source of each dimension (voice, manual, template) |
| `position` | `jsonb` | | Layout coordinates |
| `floor` | `integer` | | Floor level |
| `damageCount` | `integer` | | Cached damage count |
| `photoCount` | `integer` | | Cached photo count |
| `phase` | `integer` | | Phase when room was created |
| `createdAt` | `timestamp` | | |
| `completedAt` | `timestamp` | | |

#### `room_openings` (L4)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `sessionId` | `integer` | FK → `inspection_sessions.id` | |
| `roomId` | `integer` | FK → `inspection_rooms.id` | Parent room |
| `openingType` | `varchar(30)` | Default: `'door'` | window, standard_door, overhead_door, missing_wall, archway, etc. |
| `wallIndex` | `integer` | | Which wall (0-3 for rectangle) |
| `wallDirection` | `varchar` | | north, south, east, west |
| `quantity` | `integer` | | Number of identical openings |
| `label` | `varchar` | | Display label |
| `opensInto` | `varchar` | | Adjacent room name |
| `positionOnWall` | `real` | | 0.0–1.0 position along wall |
| `widthFt` | `real` | | Width in feet |
| `heightFt` | `real` | | Height in feet |
| `goesToFloor` | `boolean` | | Opening extends to floor |
| `goesToCeiling` | `boolean` | | Opening extends to ceiling |
| `notes` | `text` | | |

#### `room_adjacencies`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `sessionId` | `integer` | FK → `inspection_sessions.id` | |
| `roomIdA` | `integer` | FK → `inspection_rooms.id` | First room |
| `roomIdB` | `integer` | FK → `inspection_rooms.id` | Second room |
| `wallDirectionA` | `varchar(20)` | | Direction from A to B |
| `wallDirectionB` | `varchar(20)` | | Direction from B to A |
| `sharedWallLengthFt` | `real` | | Length of shared wall |
| `openingId` | `integer` | | Associated opening |

#### `sketch_annotations` (L5)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `roomId` | `integer` | FK → `inspection_rooms.id` | |
| `annotationType` | `varchar(30)` | | hail_count, pitch, storm_direction, material_note, measurement, general_note |
| `label` | `text` | | Display label |
| `value` | `text` | | Annotation value |
| `location` | `text` | | Where on the room |
| `position` | `jsonb` | | SVG coordinates |
| `createdAt` | `timestamp` | | |

#### `sketch_templates`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `name` | `varchar(100)` | NOT NULL | Template name |
| `category` | `varchar(30)` | | interior, roof, elevation |
| `description` | `text` | | |
| `polygon` | `jsonb` | | Predefined shape vertices |
| `defaultDimensions` | `jsonb` | | Default length/width/height |
| `openings` | `jsonb` | | Predefined openings |
| `roomType` | `varchar(50)` | | Suggested room type |
| `thumbnailSvg` | `text` | | Preview SVG |
| `isActive` | `boolean` | Default: `true` | |
| `sortOrder` | `integer` | | Display order |
| `createdAt` | `timestamp` | | |

### 6.5 Observations & Estimating

#### `damage_observations`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `sessionId` | `integer` | FK → `inspection_sessions.id` | |
| `roomId` | `integer` | FK → `inspection_rooms.id` | |
| `description` | `text` | | Free-text damage description |
| `damageType` | `varchar(30)` | | hail_impact, wind_damage, water_intrusion, fire_damage, etc. |
| `severity` | `varchar(20)` | | minor, moderate, severe |
| `location` | `text` | | Where in the room |
| `measurements` | `jsonb` | | Damage measurements |
| `createdAt` | `timestamp` | | |

#### `line_items`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `sessionId` | `integer` | FK → `inspection_sessions.id` | |
| `roomId` | `integer` | FK → `inspection_rooms.id` | |
| `damageId` | `integer` | FK → `damage_observations.id` | Source damage |
| `category` | `text` | | Roofing, Siding, Painting, Drywall, etc. |
| `action` | `text` | | R&R, Repair, Remove, Clean, etc. |
| `description` | `text` | | Line item description |
| `xactCode` | `text` | | Xactimate catalog code |
| `quantity` | `real` | | Calculated quantity |
| `unit` | `text` | | SF, SY, LF, EA, HR, etc. |
| `unitPrice` | `real` | | Price per unit |
| `totalPrice` | `real` | | quantity × unitPrice |
| `depreciationType` | `text` | | recoverable, non_recoverable |
| `depreciationRate` | `real` | | Annual depreciation % |
| `wasteFactor` | `integer` | | Waste % (default 10 for flooring, 5 for roofing) |
| `tradeCode` | `text` | | RFG, SDG, PNT, DRY, FLR, PLM, ELE, etc. |
| `coverageType` | `text` | | dwelling, other_structures, contents |
| `provenance` | `text` | | voice, manual, auto_scope, photo_ai |
| `taxAmount` | `real` | | Calculated tax |
| `age` | `real` | | Asset age in years |
| `lifeExpectancy` | `real` | | Expected useful life |
| `depreciationPercentage` | `real` | | Calculated depreciation % |
| `depreciationAmount` | `real` | | Calculated depreciation $ |
| `coverageBucket` | `text` | | Coverage A, B, C classification |
| `qualityGrade` | `text` | | standard, premium, builder |
| `applyOAndP` | `boolean` | | Include Overhead & Profit |
| `macroSource` | `text` | | Smart macro that created this |
| `createdAt` | `timestamp` | | |

#### `scope_items`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `serial` | PK | |
| `sessionId` | `integer` | FK → `inspection_sessions.id` | |
| `roomId` | `integer` | FK → `inspection_rooms.id` | |
| `damageId` | `integer` | FK → `damage_observations.id` | |
| `catalogCode` | `text` | | Xactimate code |
| `description` | `text` | | Item description |
| `tradeCode` | `text` | | Trade category |
| `quantity` | `real` | | Quantity |
| `unit` | `text` | | Unit of measure |
| `quantityFormula` | `text` | | WALL_SF_NET, FLOOR_SF, CEILING_SF, etc. |
| `provenance` | `text` | | How item was created |
| `coverageType` | `text` | | Coverage classification |
| `activityType` | `text` | | repair, remove, replace, clean, mitigate |
| `wasteFactor` | `real` | | Waste percentage |
| `status` | `text` | | pending, confirmed, rejected |
| `parentScopeItemId` | `integer` | | Parent companion item |
| `quantityIsPlaceholder` | `boolean` | | Needs recalculation |
| `lastQuantityRecalcAt` | `timestamp` | | |
| `createdAt` | `timestamp` | | |
| `updatedAt` | `timestamp` | | |

#### `scope_line_items` (Catalog)
| Column | Type | Description |
|---|---|---|
| `id` | `serial` | PK |
| `code` | `varchar(30)` | Unique catalog code |
| `description` | `text` | Item description |
| `unit` | `varchar(10)` | SF, LF, EA, etc. |
| `tradeCode` | `varchar(10)` | Trade category |
| `quantityFormula` | `varchar(30)` | Formula for auto-quantity |
| `defaultWasteFactor` | `real` | Default waste % |
| `activityType` | `varchar(20)` | repair, remove, replace, etc. |
| `coverageType` | `varchar(20)` | dwelling, contents |
| `scopeConditions` | `jsonb` | When this item applies |
| `companionRules` | `jsonb` | Auto-add companion items |
| `xactCategoryCode` | `varchar(10)` | Xactimate category |
| `xactSelector` | `varchar(10)` | Xactimate selector |
| `xactItemId` | `varchar(20)` | Xactimate item ID |
| `xactDescription` | `text` | Xactimate-standard description |
| `xactIncludes` | `text` | What's included in this item |
| `xactExcludes` | `text` | What's excluded |
| `xactQualitySpec` | `text` | Quality specifications |
| `xactNotes` | `text` | Additional notes |
| `isTaxable` | `boolean` | Subject to sales tax |
| `taxRate` | `real` | Tax rate override |
| `xactPhase` | `text` | Xactimate phase |
| `xactMinimumId` | `text` | Minimum charge reference |
| `notes` | `text` | Internal notes |
| `sortOrder` | `integer` | Display order |
| `opEligibleDefault` | `boolean` | O&P eligible by default |
| `isCodeUpgrade` | `boolean` | Code compliance upgrade |
| `isActive` | `boolean` | Currently active |

### 6.6 Financial Tables

#### `policy_rules`
| Column | Type | Description |
|---|---|---|
| `id` | `serial` | PK |
| `claimId` | `integer` | FK → `claims.id` |
| `coverageType` | `text` | dwelling, other_structures, contents |
| `policyLimit` | `real` | Coverage limit |
| `deductible` | `real` | Deductible amount |
| `applyRoofSchedule` | `boolean` | Apply roof depreciation schedule |
| `roofScheduleAge` | `real` | Roof age for schedule |
| `overheadPct` | `real` | O&P overhead percentage |
| `profitPct` | `real` | O&P profit percentage |
| `taxRate` | `real` | Sales tax rate |
| `opExcludedTrades` | `text[]` | Trades excluded from O&P |
| `createdAt` | `timestamp` | |

#### `tax_rules`
| Column | Type | Description |
|---|---|---|
| `id` | `serial` | PK |
| `claimId` | `integer` | FK → `claims.id` |
| `taxLabel` | `text` | Tax name |
| `taxRate` | `real` | Rate |
| `appliesToCategories` | `text[]` | Which categories |
| `appliesToCostType` | `text` | material, labor, all |
| `isDefault` | `boolean` | Default tax rule |
| `createdAt` | `timestamp` | |

#### `scope_trades`
| Column | Type | Description |
|---|---|---|
| `id` | `serial` | PK |
| `code` | `varchar(10)` | Trade code (RFG, PNT, etc.) |
| `name` | `varchar(100)` | Trade name |
| `xactCategoryPrefix` | `varchar(10)` | Xactimate XML category |
| `opEligible` | `boolean` | O&P eligible |
| `sortOrder` | `integer` | Display order |
| `isActive` | `boolean` | Active |

#### `scope_summary`
| Column | Type | Description |
|---|---|---|
| `id` | `serial` | PK |
| `sessionId` | `integer` | FK → `inspection_sessions.id` |
| `tradeCode` | `varchar(10)` | Trade |
| `tradeName` | `text` | Trade display name |
| `itemCount` | `integer` | Number of items |
| `quantitiesByUnit` | `jsonb` | `{ SF: 150, LF: 30 }` |
| `totalMaterial` | `real` | Material cost |
| `totalLabor` | `real` | Labor cost |
| `totalEquipment` | `real` | Equipment cost |
| `totalTax` | `real` | Tax amount |
| `totalRCV` | `real` | Replacement Cost Value |
| `totalDepreciation` | `real` | Total depreciation |
| `totalACV` | `real` | Actual Cash Value |
| `opEligible` | `boolean` | O&P eligible |
| `updatedAt` | `timestamp` | |

#### `regional_price_sets`
| Column | Type | Description |
|---|---|---|
| `id` | `serial` | PK |
| `regionId` | `varchar(20)` | Region identifier |
| `regionName` | `text` | Region display name |
| `lineItemCode` | `varchar(30)` | Catalog code |
| `materialCost` | `real` | Material component |
| `laborCost` | `real` | Labor component |
| `equipmentCost` | `real` | Equipment component |
| `effectiveDate` | `varchar(20)` | Date prices took effect |
| `priceListVersion` | `varchar(20)` | Price list version |
| `activityType` | `varchar(20)` | Activity classification |
| `laborFormula` | `text` | Labor calculation formula |
| `materialFormula` | `text` | Material calculation formula |
| `equipmentFormula` | `text` | Equipment calculation formula |

#### `xact_price_lists`
| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | PK |
| `xactName` | `text` | Price list name |
| `regionDescription` | `text` | Region description |
| `effectiveDate` | `varchar(20)` | Effective date |
| `xactVersion` | `varchar(20)` | Xactimate version |
| `itemCount` | `integer` | Number of items |
| `createdAt` | `timestamp` | |

### 6.7 Media & Support

#### `inspection_photos`
| Column | Type | Description |
|---|---|---|
| `id` | `serial` | PK |
| `sessionId` | `integer` | FK → `inspection_sessions.id` |
| `roomId` | `integer` | FK → `inspection_rooms.id` |
| `damageId` | `integer` | FK → `damage_observations.id` |
| `storagePath` | `text` | Supabase Storage path |
| `autoTag` | `text` | AI-generated tag |
| `caption` | `text` | User/AI caption |
| `photoType` | `varchar` | overview, damage_detail, test_square, moisture, address_verification, pre_existing |
| `annotations` | `jsonb` | Drawing annotations (shapes, text) |
| `analysis` | `jsonb` | GPT-4o Vision analysis result |
| `matchesRequest` | `boolean` | Photo matches expected capture |
| `createdAt` | `timestamp` | |

#### `standalone_photos`
| Column | Type | Description |
|---|---|---|
| `id` | `serial` | PK |
| `userId` | `varchar` | FK → `users.id` |
| `claimId` | `integer` | FK → `claims.id` |
| `storagePath` | `text` | Supabase Storage path |
| `fileName` | `text` | Original filename |
| `fileSize` | `integer` | File size |
| `source` | `text` | upload, camera |
| `analysisStatus` | `text` | pending, analyzing, complete, error |
| `analysis` | `jsonb` | Vision AI result |
| `annotations` | `jsonb` | User annotations |
| `severityScore` | `real` | AI severity (0-10) |
| `damageTypes` | `text[]` | Detected damage types |
| `suggestedRepairs` | `text[]` | AI-suggested repairs |
| `notes` | `text` | User notes |
| `createdAt` | `timestamp` | |

#### `moisture_readings`
| Column | Type | Description |
|---|---|---|
| `id` | `serial` | PK |
| `sessionId` | `integer` | FK |
| `roomId` | `integer` | FK |
| `location` | `text` | Where reading was taken |
| `reading` | `real` | Moisture percentage |
| `materialType` | `text` | Drywall, wood, concrete |
| `dryStandard` | `real` | Expected dry reading |
| `createdAt` | `timestamp` | |

#### `test_squares`
| Column | Type | Description |
|---|---|---|
| `id` | `serial` | PK |
| `sessionId` | `integer` | FK |
| `roomId` | `integer` | FK (roof facet) |
| `hailHits` | `integer` | Number of hail impacts |
| `windCreases` | `integer` | Number of wind creases |
| `pitch` | `text` | Roof pitch |
| `result` | `text` | pass, fail |
| `notes` | `text` | |
| `createdAt` | `timestamp` | |

#### `voice_transcripts`
| Column | Type | Description |
|---|---|---|
| `id` | `serial` | PK |
| `sessionId` | `integer` | FK |
| `speaker` | `text` | user, assistant |
| `content` | `text` | Transcript text |
| `timestamp` | `timestamp` | |

#### `inspection_session_events`
| Column | Type | Description |
|---|---|---|
| `id` | `serial` | PK |
| `sessionId` | `integer` | FK |
| `ts` | `timestamp` | Event timestamp |
| `type` | `text` | Event type |
| `payloadJson` | `jsonb` | Event data |

#### `supplemental_claims`
| Column | Type | Description |
|---|---|---|
| `id` | `serial` | PK |
| `originalSessionId` | `integer` | FK → `inspection_sessions.id` |
| `claimId` | `integer` | FK → `claims.id` |
| `reason` | `text` | Reason for supplement |
| `status` | `text` | draft, submitted, approved |
| `newLineItems` | `jsonb` | New items to add |
| `removedLineItemIds` | `jsonb` | Items to remove |
| `modifiedLineItems` | `jsonb` | Items to modify |
| `reviewNotes` | `text` | Reviewer notes |
| `createdAt` | `timestamp` | |
| `submittedAt` | `timestamp` | |
| `approvedAt` | `timestamp` | |

### 6.8 Insert Schemas & Types

Every table has corresponding Drizzle-Zod types:

```typescript
// Pattern for every table:
export const insertClaimSchema = createInsertSchema(claims).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClaim = z.infer<typeof insertClaimSchema>;
export type Claim = typeof claims.$inferSelect;
```

---

## 7. Authentication System

### 7.1 Dual Auth Architecture

The system supports two authentication providers unified by a single middleware:

**Local JWT Auth:**
1. User calls `POST /api/auth/login` with `{ emailOrUsername, password }`
2. Server verifies password via `bcrypt.compare()`
3. Server signs JWT: `{ type: "local", userId }` using `JWT_SECRET`
4. Client stores token in localStorage
5. All subsequent requests include `Authorization: Bearer <token>`

**Supabase Auth:**
1. Client authenticates via Supabase SDK (OAuth or email/password)
2. Client calls `POST /api/auth/sync` with Supabase token
3. Server verifies with Supabase API, creates/links local user record
4. Server issues a local JWT for subsequent requests

### 7.2 Middleware Chain

```typescript
// server/auth.ts
authenticateRequest(req, res, next) {
  1. Extract Bearer token from Authorization header
  2. Try verifyLocalToken(token) → get userId → fetch user from DB
  3. If local fails, try supabase.auth.getUser(token) → lookup by supabaseAuthId
  4. Attach user to req.user
  5. Reject with 401 if neither works
  6. Reject with 403 if user.isActive === false
}
```

### 7.3 Role-Based Access Control

**Route-level** via `requireRole` middleware:
```typescript
router.get("/users", authenticateRequest, requireRole("admin"), handler);
```

**Resource-level** via `server/authorization.ts`:
- `isPrivilegedRole(role)` → true for `admin` or `supervisor`
- `canAccessClaim(user, claim)` → privileged OR `claim.assignedTo === user.id`
- `requireClaimAccess(req, claimId)` → throws 403 if unauthorized
- `requireSessionAccess(req, sessionId)` → resolves session → checks claim access

### 7.4 Client-Side (`AuthContext.tsx`)

The `AuthProvider` wraps the entire app:
- On mount: checks localStorage for token, calls `GET /api/auth/me` to validate
- `signIn()`: tries local login first, falls back to Supabase if identifier is email
- Provides: `user`, `isAuthenticated`, `role`, `signIn()`, `signOut()`

---

## 8. API Routes Reference

### 8.1 Health & Configuration

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Server health: `{ status, timestamp, uptime, version }` |
| `GET` | `/readiness` | None | Readiness check: DB, Storage, OpenAI status |
| `GET` | `/api/config` | None | Client config: `{ supabaseUrl, supabaseAnonKey }` |

### 8.2 Authentication (`/api/auth`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| `POST` | `/api/auth/login` | None | `{ emailOrUsername, password }` | `{ token, user }` |
| `POST` | `/api/auth/register` | None | `{ username, email, password, fullName }` | `{ token, user }` (201) |
| `POST` | `/api/auth/sync` | Supabase | `{ supabaseId, email, fullName }` | `{ token, user }` |
| `GET` | `/api/auth/me` | JWT | — | Current user profile |

### 8.3 Claims (`/api/claims`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/claims` | JWT | Create new claim |
| `GET` | `/api/claims` | JWT | List claims (filtered by role) |
| `GET` | `/api/claims/:id` | JWT + Access | Full claim with documents, extractions |
| `PATCH` | `/api/claims/:id` | JWT + Access | Update claim fields/status |
| `POST` | `/api/claims/:id/documents/upload` | JWT + Access | Upload PDF (fnol, policy, endorsements) |
| `POST` | `/api/claims/:id/documents/upload-batch` | JWT + Access | Batch upload endorsements |
| `POST` | `/api/claims/:id/documents/:type/parse` | JWT + Access | Trigger AI extraction |
| `POST` | `/api/claims/:id/extractions/:type/confirm` | JWT + Access | Confirm extraction |
| `POST` | `/api/claims/:id/extractions/confirm-all` | JWT + Access | Confirm all extractions |
| `PUT` | `/api/claims/:id/extractions/:type` | JWT + Access | Edit extraction data |
| `POST` | `/api/claims/:id/briefing/generate` | JWT + Access | Generate AI briefing |
| `GET` | `/api/claims/:id/briefing` | JWT + Access | Get existing briefing |

### 8.4 Inspection (`/api/inspection`)

#### Session Management
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/inspection/:sessionId` | JWT + Access | Session with rooms, counts, estimate |
| `PATCH` | `/api/inspection/:sessionId` | JWT + Access | Update session (phase, status, notes) |
| `POST` | `/api/inspection/:sessionId/complete` | JWT + Access | Complete inspection |

#### Workflow
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/inspection/:sessionId/workflow` | JWT + Access | Get workflow state + allowed tools |
| `POST` | `/api/inspection/:sessionId/gates/run` | JWT + Access | Run validation gates |

#### Rooms & Geometry
| Method | Path | Auth | Description |
|---|---|---|---|
| `PATCH` | `/api/rooms/:roomId/dimensions` | JWT + Access | Update room dimensions → triggers rescope |
| `GET` | `/api/rooms/:roomId/adjacencies` | JWT + Access | Get adjacencies for a room |
| `POST` | `/api/sessions/:sessionId/adjacencies` | JWT + Access | Create room adjacency |
| `PATCH` | `/api/adjacencies/:id` | JWT + Access | Update adjacency |
| `DELETE` | `/api/adjacencies/:id` | JWT + Access | Delete adjacency |

#### Annotations
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/inspection/:sessionId/rooms/:roomId/annotations` | JWT + Access | Add sketch annotation |
| `PATCH` | `/api/inspection/:sessionId/annotations/:annotationId` | JWT + Access | Update annotation |
| `DELETE` | `/api/inspection/:sessionId/annotations/:annotationId` | JWT + Access | Delete annotation |

#### Sketch Templates
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/sketch-templates` | JWT | List templates (filter by category) |

#### Damage Observations
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/inspection/:sessionId/damages` | JWT + Access | Add damage → returns auto-scoped items |
| `GET` | `/api/inspection/:sessionId/damages` | JWT + Access | List damages (filter by roomId) |
| `PATCH` | `/api/inspection/:sessionId/damages/:damageId` | JWT + Access | Update damage |
| `DELETE` | `/api/inspection/:sessionId/damages/:damageId` | JWT + Access | Delete damage |

#### Water Classification
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/inspection/:sessionId/water-classification` | JWT + Access | Record IICRC water classification |

#### Line Items
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/inspection/:sessionId/line-items` | JWT + Access | Add line item (auto-resolves Xactimate code) |
| `GET` | `/api/inspection/:sessionId/line-items/by-room` | JWT + Access | Items grouped by room with grand total |

#### Scope Items
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/inspection/:sessionId/scope/items` | JWT + Access | List scope items |
| `PATCH` | `/api/inspection/:sessionId/scope/items/:id` | JWT + Access | Update scope item |
| `DELETE` | `/api/inspection/:sessionId/scope/items/:id` | JWT + Access | Delete scope item |
| `POST` | `/api/inspection/:sessionId/scope/auto-scope-room` | JWT + Access | Auto-scope all damage in a room |
| `POST` | `/api/inspection/:sessionId/scope/rescope` | JWT + Access | Rescope all items (recalculate quantities) |

#### Photos
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/inspection/:sessionId/photos` | JWT + Access | Upload photo (base64) |
| `GET` | `/api/inspection/:sessionId/photos` | JWT + Access | List photos with signed URLs |
| `DELETE` | `/api/inspection/:sessionId/photos/:photoId` | JWT + Access | Delete photo |
| `POST` | `/api/inspection/:sessionId/photos/:photoId/analyze` | JWT + Access | Run AI analysis on photo |
| `PUT` | `/api/inspection/:sessionId/photos/:photoId/annotations` | JWT + Access | Save photo annotations |

#### Estimates
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/inspection/:sessionId/estimate-by-room` | JWT + Access | Room-by-room financial summary |
| `GET` | `/api/inspection/:sessionId/estimate-grouped` | JWT + Access | Estimate grouped by category |
| `GET` | `/api/inspection/:sessionId/photos-grouped` | JWT + Access | Photos grouped by room |

#### Export
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/inspection/:sessionId/export/validate` | JWT + Access | Check export readiness (blockers/warnings) |
| `POST` | `/api/inspection/:sessionId/export/esx` | JWT + Access | Download `.esx` file |
| `POST` | `/api/inspection/:sessionId/export/pdf` | JWT + Access | Download PDF Property Estimate |
| `POST` | `/api/inspection/:sessionId/export/photo-report/pdf` | JWT + Access | Download Photo Report PDF |
| `POST` | `/api/inspection/:sessionId/export/photo-report/docx` | JWT + Access | Download Photo Report DOCX |

#### AI Review
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/inspection/:sessionId/review/ai` | JWT + Access | AI estimate review |

### 8.5 Realtime Voice (`/api/realtime`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| `POST` | `/api/realtime/session` | JWT + Access | `{ claimId, sessionId, flowId }` | `{ clientSecret, sessionId, transcriptSummary, hierarchySummary, sessionPhase, completedPhases, workflow, activeFlow }` |

### 8.6 PhotoLab (`/api/photolab`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/photolab/photos` | JWT | List standalone photos |
| `POST` | `/api/photolab/upload` | JWT | Upload + trigger async analysis |
| `POST` | `/api/photolab/photos/:id/analyze` | JWT | Re-run AI analysis |
| `PATCH` | `/api/photolab/photos/:id/attach` | JWT | Attach to claim |
| `PATCH` | `/api/photolab/photos/:id/detach` | JWT | Detach from claim |
| `PATCH` | `/api/photolab/photos/:id/notes` | JWT | Update notes |
| `DELETE` | `/api/photolab/photos/:id` | JWT | Delete photo |

### 8.7 Admin (`/api/admin`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/admin/users` | Supervisor/Admin | List team members with claim counts |
| `POST` | `/api/admin/claims/assign` | Supervisor/Admin | Assign claim to user |
| `GET` | `/api/admin/dashboard` | Supervisor/Admin | Dashboard stats |
| `GET` | `/api/admin/active-sessions` | Supervisor/Admin | Active inspection sessions |

### 8.8 Settings (`/api/settings`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/settings` | JWT | Get user settings |
| `PUT` | `/api/settings` | JWT | Update user settings |

### 8.9 Additional Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/gallery/photos` | JWT | Cross-claim photo browser |
| `GET` | `/api/gallery/sketches` | JWT | Cross-claim sketch browser |
| `GET` | `/api/documents/all` | JWT | All documents for user |
| `GET` | `/api/documents/status-summary` | JWT | Document processing progress |
| `GET` | `/api/documents/:id/signed-url` | JWT | Supabase signed URL |
| `PATCH` | `/api/supplemental/:id` | JWT + Access | Update supplemental claim |
| `POST` | `/api/supplemental/:id/submit` | JWT + Access | Submit supplemental |
| `POST` | `/api/supplemental/:id/export/esx` | JWT + Access | Export supplemental ESX |
| `GET` | `/api/flows` | JWT | List inspection flows |
| `POST` | `/api/flows` | JWT | Create custom flow |
| `PUT` | `/api/flows/:id` | JWT | Update flow |
| `DELETE` | `/api/flows/:id` | JWT | Delete flow |
| `POST` | `/api/flows/:id/clone` | JWT | Clone flow |
| `POST` | `/api/flows/seed` | Admin | Re-seed system flows |
| `GET` | `/api/pricing/catalog` | JWT | Full line item catalog |
| `GET` | `/api/pricing/catalog/search?q=` | JWT | Search catalog |
| `GET` | `/api/pricing/catalog/:tradeCode` | JWT | Catalog by trade |
| `POST` | `/api/pricing/scope` | JWT | Calculate regional pricing |
| `POST` | `/api/pricing/validate` | JWT | Validate line items |
| `GET` | `/api/pricing/regions` | JWT | Available pricing regions |
| `GET` | `/api/notifications` | JWT | User notifications |
| `PATCH` | `/api/profile` | JWT | Update profile |
| `POST` | `/api/profile/avatar` | JWT | Upload avatar |
| `POST` | `/api/logs/voice-tool` | JWT | Log voice tool interaction |

---

## 9. Voice Inspection System

### 9.1 Architecture Overview

The voice system uses a **browser-to-OpenAI direct WebRTC connection**:

```
Browser ──── WebRTC (audio + data channel) ──── OpenAI Realtime API
   │                                                    │
   │ Tool calls via data channel                        │
   │◄──────────────────────────────────────────────────►│
   │                                                    │
   │ REST API for tool execution                        │
   ▼                                                    │
Express Server (tool handlers)                          │
   │                                                    │
   │ Ephemeral token + system instructions              │
   └────────────────────────────────────────────────────►│
```

### 9.2 Connection Flow

1. **Token Request**: Client calls `POST /api/realtime/session` with `{ claimId, sessionId, flowId }`
2. **Server Setup**:
   - Fetches claim context, briefing, rooms, damages, flow steps
   - Builds system instructions via `buildSystemInstructions()`
   - Reads user's voice preferences (voice model, VAD sensitivity)
   - Calls OpenAI REST API to create ephemeral session → gets `client_secret`
3. **WebRTC Handshake**:
   - Client creates `RTCPeerConnection`
   - Creates data channel `oai-events`
   - Calls `getUserMedia` for microphone
   - Standard SDP Offer/Answer with `api.openai.com/v1/realtime`
4. **Voice Session Active**:
   - Audio flows directly browser ↔ OpenAI
   - Tool calls come via data channel as `response.function_call_arguments.done` events
   - Client executes tools via REST API calls to Express server
   - Results sent back via data channel as `function_call_output` events

### 9.3 System Instructions Structure

Built dynamically in `server/realtime.ts` → `buildSystemInstructions()`:

```
1. PERSONA: Senior claims adjuster, professional, concise
2. CLAIM CONTEXT: Claim number, peril type, address, date of loss
3. BRIEFING SUMMARY: Key findings from AI extraction
4. 5-LEVEL HIERARCHY: Rules for Structure → Room → SubArea → Opening → Annotation
5. OPERATIONAL DIRECTIVES:
   - "ACT, DON'T ASK" — execute tools immediately
   - Unit conversion rules (inches → feet)
   - Standard defaults for missing dimensions
6. PHASE INSTRUCTIONS: Current flow step guidance
7. PHOTO INTELLIGENCE: Material/finish detection handling
8. NAVIGATION: How to advance phases
```

### 9.4 VAD Configuration

Three sensitivity levels sent to OpenAI:
| Level | Threshold | Silence Duration | Prefix Padding |
|---|---|---|---|
| Low | 0.80 | 1500ms | 500ms |
| Medium | 0.90 | 1000ms | 300ms |
| High | 0.95 | 600ms | 200ms |

### 9.5 Voice Agent Tools (Complete List)

#### Hierarchy & Structure Tools
| Tool | Required Params | Description |
|---|---|---|
| `create_structure` | `name`, `structureType` | Create L1 structure |
| `update_structure` | `structureName` or `structureId` | Update structure |
| `delete_structure` | `confirm=true` | Delete structure (optionally cascade) |
| `create_room` | `name`, `structure`, `viewType` | Create L2 room/area |
| `create_sub_area` | `name`, `parentRoomName`, `attachmentType` | Create L3 sub-area |
| `rename_room` | `roomId`, `newName` | Rename room |
| `delete_room` | `confirm=true`, `roomName` or `roomId` | Delete room |
| `update_room_dimensions` | `roomName` | Update length/width/height/ceilingType |

#### Navigation & Context
| Tool | Required Params | Description |
|---|---|---|
| `set_inspection_context` | `area` | Set current location (structure, area, phase) |
| `get_inspection_state` | — | Return full hierarchy tree |
| `get_room_details` | `roomId` or `roomName` | Room details with openings/annotations |
| `list_rooms` | — | List all rooms |
| `find_room` | `roomNameQuery` | Fuzzy search for room |
| `complete_room` | `roomName` | Mark room complete |

#### Openings (L4)
| Tool | Required Params | Description |
|---|---|---|
| `add_opening` | `roomName`, `openingType`, `widthFt`, `heightFt` | Add door/window/missing wall |
| `update_opening` | `openingId` | Update opening properties |
| `delete_opening` | `openingId` | Delete opening |
| `set_room_adjacency` | `roomNameA`, `roomNameB` | Record shared wall between rooms |

#### Annotations (L5)
| Tool | Required Params | Description |
|---|---|---|
| `add_sketch_annotation` | `roomName`, `annotationType`, `label`, `value` | Add metadata annotation |

#### Damage & Scoping
| Tool | Required Params | Description |
|---|---|---|
| `add_damage` | `description`, `damageType` | Record damage observation |
| `update_damage` | `damageId` | Update damage |
| `delete_damage` | `damageId` | Delete damage |
| `add_line_item` | `category`, `action`, `description` | Add Xactimate line item |
| `generate_scope` | `damageId`, `roomId` | Auto-generate scope from damage |
| `validate_scope` | `sessionId` | Validate scope completeness |
| `apply_peril_template` | `roomId` | Apply peril-specific template |
| `apply_smart_macro` | `macro_type` | Apply bundle of standard line items |

#### Photo Capture
| Tool | Required Params | Description |
|---|---|---|
| `trigger_photo_capture` | `label`, `photoType` | Opens camera on device (deferred result) |
| `confirm_damage_suggestion` | `photoId`, `damageType`, `confirmed` | Confirm/reject AI-detected damage |

#### Forensics
| Tool | Required Params | Description |
|---|---|---|
| `add_water_classification` | `waterSource`, `visibleContamination` | IICRC water classification |
| `log_moisture_reading` | `location`, `reading` | Record moisture reading |
| `log_test_square` | `roomName`, `hailHits` | Record 10×10 test square |
| `update_test_square` | `testSquareId` | Update test square |
| `delete_test_square` | `testSquareId` | Delete test square |

#### Status & Summary
| Tool | Required Params | Description |
|---|---|---|
| `get_progress` | — | Overall inspection progress |
| `get_estimate_summary` | — | Financial totals |
| `get_completeness` | — | Completeness by category |
| `get_scope_gaps` | — | Missing scope items |

#### Workflow & Navigation
| Tool | Required Params | Description |
|---|---|---|
| `get_workflow_state` | — | Current phase + step info |
| `set_phase` | `phase` | Advance to phase |
| `set_context` | — | Update workflow context |
| `skip_step` | `stepDescription`, `passwordConfirmed` | Skip step (password: "123") |
| `complete_inspection` | — | Finalize inspection |

### 9.6 Deferred Photo Capture Pattern

The `trigger_photo_capture` tool uses an asynchronous deferred-result pattern:

```
1. Agent calls trigger_photo_capture({ label, photoType })
2. Client does NOT return a result immediately
3. Client saves call_id in pendingPhotoCallRef
4. Client activates camera UI (cameraMode.active = true)
5. User takes photo
6. Client uploads to Supabase Storage
7. Client calls POST /api/inspection/:sessionId/photos/:photoId/analyze
8. GPT-4o Vision analyzes for damage + materials → returns:
   - damageSuggestions[] (damage types with severity)
   - lineItemSuggestions[] (material-based Xactimate codes)
9. Client sends function_call_output with analysis result using saved call_id
10. Agent receives result and narrates findings
```

### 9.7 Photo Intelligence Pipeline

When a photo is analyzed:

1. **GPT-4o Vision** detects:
   - Damage: type, severity, location, description
   - Materials: paint colors, crown molding, baseboard type, flooring, cabinets, countertops, ceiling textures, wallpaper, fixtures
   - Quality match to expected capture type

2. **`photoScopeBridge.ts`** normalizes:
   - `processPhotoAnalysis()` → standardized `PhotoDamageSuggestion[]`
   - `resolveLineItemSuggestions()` → maps 60+ material keywords to Xactimate codes via `MATERIAL_XACT_CODES`

3. **Material Code Mapping** (examples):
   | Material Keyword | Xactimate Code | Category |
   |---|---|---|
   | crown molding | TRIM>CRWN | Trim |
   | baseboard | TRIM>BASE | Trim |
   | laminate flooring | FLR>LMNT | Flooring |
   | granite countertop | CNTOP>GRNT | Countertop |
   | purple paint | PNT>CSTM | Painting |
   | pendant light | ELE>PEND | Electrical |

---

## 10. Backend Services & Engines

### 10.1 Estimate Engine (`estimateEngine.ts`)

The central financial calculator following Xactimate's order of operations.

**Key Functions:**
- `calculateDimVars(room)` → Computes 14 Xactimate dimension variables:
  - `F` (Floor SF), `W` (Wall SF), `PC` (Ceiling Perimeter), `C` (Ceiling SF)
  - `PF` (Floor Perimeter), `P` (Total Perimeter), `WH` (Wall Height)
  - Plus "after MW" variants for missing wall deductions
- `calculateSettlement(lineItems, policyRules)` → Groups by trade, applies O&P, calculates tax, generates RCV/ACV summary

**Order of Operations:**
1. Sum line items by trade
2. Apply waste factor
3. Calculate tax (material × rate)
4. Calculate O&P (overhead% + profit% on eligible trades)
5. Sum to RCV
6. Apply depreciation → ACV = RCV - depreciation
7. Apply deductible

### 10.2 Depreciation Engine (`depreciationEngine.ts`)

Calculates value loss based on age and life expectancy.

**Key Functions:**
- `lookupLifeExpectancy(description, tradeCode)` → Uses keyword matching:
  - 3-tab shingles: 20 years
  - Laminate shingles: 30 years
  - Interior paint: 5 years
  - Carpet: 10 years
  - etc.
- `calculateDepreciation(item)` → `depreciationPct = min(age / lifeExpectancy, 1.0)`
  - Special handling: water damage items use IICRC overrides
  - Roofing: uses policy schedule when `applyRoofSchedule` is true

### 10.3 ESX Generator (`esxGenerator.ts`)

Generates Xactimate-importable `.ESX` files (ZIP archives containing XML).

**Structure:**
```
claim_XXXX.esx (ZIP)
├── XACTDOC.XML          # Document metadata
└── GENERIC_ROUGHDRAFT.XML  # Room tree + line items
```

**Key Functions:**
- `generateESXFile(sessionId)` → Orchestrates data fetch + XML generation
- `generateRoughDraft(session, rooms, items)` → Builds room tree and line item lists matching Xactimate's Rough Draft import format
- Uses `tradeCodeMapping.ts` to resolve trade aliases to valid Xactimate category codes

### 10.4 PDF Generator (`pdfGenerator.ts`)

Creates professional Property Estimate reports using PDFKit.

**Sections:**
1. Header with claim info and company branding
2. Coverage Summary (RCV, ACV, Deductible)
3. Estimate Recap by trade
4. Line Items grouped by room
5. Depreciation schedule
6. Footer with page numbers

### 10.5 Photo Report Generator (`photoReportGenerator.ts`)

Generates photo documentation in PDF and DOCX formats.

**Key Functions:**
- `generatePhotoReportPDF(sessionId)` → PDFKit-based photo report
- `generatePhotoReportDOCX(sessionId)` → Word document using `docx` library

Photos are fetched from Supabase Storage with signed URLs, grouped by room, and include AI damage analysis captions.

### 10.6 Weather Service (`weatherService.ts`)

Validates date-of-loss claims using Visual Crossing Timeline API.

**Key Functions:**
- `getWeatherCorrelation(address, dateOfLoss, perilType)`:
  1. Fetches weather for DOL ± 3 days
  2. `analyzePerilMatch()` → checks if weather supports claimed peril:
     - Hail: looks for precipitation + low temps
     - Wind: checks for gusts > 50mph
     - Water: checks for heavy rainfall
  3. `calculateOverallRiskScore()` → 0-100 fraud risk assessment
  4. Returns weather data, correlation strength, risk flags

### 10.7 Scope Assembly Service (`scopeAssemblyService.ts`)

The automated scope builder. Maps damage observations to line items.

**Key Function:**
- `assembleScope(damage, room, session)`:
  1. Identifies damage type (hail, water, wind, fire)
  2. Maps to trade-specific line items
  3. Calls `scopeQuantityEngine` for quantities
  4. Calls `companionEngine` for companion items
  5. Calls `openingDeductionService` for wall deductions
  6. Returns `{ created: ScopeItem[], warnings: string[] }`

**Example mapping:** "Water Damage" in "Master Bedroom" generates:
- Remove damaged drywall (DRY trade)
- Install new drywall (DRY trade)
- Paint (PNT trade)
- Set up dehumidifier (WTR trade)

### 10.8 Scope Quantity Engine (`scopeQuantityEngine.ts`)

Deterministic quantity calculator using room dimension variables.

**Key Function:**
- `deriveQuantity(formula, dimVars)` → Maps formula codes to calculated values:

| Formula | Calculation |
|---|---|
| `FLOOR_SF` | length × width |
| `FLOOR_SY` | floor SF ÷ 9 |
| `WALL_SF_NET` | wall SF - opening deductions |
| `CEILING_SF` | length × width (adjusted for ceiling type) |
| `PERIMETER_LF` | 2 × (length + width) |
| `EACH` | 1.0 |

### 10.9 Companion Engine (`companionEngine.ts`)

Auto-adds secondary items when a primary item is added.

**Key Function:**
- `autoAddCompanions(primaryItem, existingItems)` → Evaluates 22+ rules:
  - Flooring install → Add floor removal
  - Drywall install → Add taping & finishing
  - Painting → Add primer if damage
  - Drying equipment → Add demolition
  - etc.

Initialized with rules loaded from `scope_line_items.companionRules`.

### 10.10 Opening Deduction Service (`openingDeductionService.ts`)

Calculates net wall area by subtracting openings.

**Key Function:**
- `calculateOpeningDeductions(roomId)`:
  1. Fetches all openings for the room
  2. Sums: `totalDeduction = Σ(opening.widthFt × opening.heightFt × opening.quantity)`
  3. Returns `netWallDeduction` value
  4. Used to avoid overpaying for painting/drywall where large windows exist

### 10.11 Photo-Scope Bridge (`photoScopeBridge.ts`)

Translates GPT-4o Vision output to internal data model.

**Key Functions:**
- `processPhotoAnalysis(analysis)` → Normalizes damage descriptions to standardized types
- `resolveLineItemSuggestions(suggestions)` → Maps detected materials to Xactimate codes using `MATERIAL_XACT_CODES` (60+ mappings covering TRIM, PNT, FLR, DRY, CAB, CNTOP, WC, ELE, WIN categories)

### 10.12 Trade Code Mapping (`tradeCodeMapping.ts`)

Maps trade aliases to official Xactimate category codes.

**Key Function:**
- `resolveCategory(trade, perilType?)` → e.g., "PAINT" → "PNT", "Mitigation" + water → "WTR"

### 10.13 AI Review Service (`aiReview.ts`)

Uses GPT-4.1 to review completed estimates for compliance issues.

**Key Function:**
- `reviewEstimate(session, lineItems, rooms)` → Returns compliance warnings, missing items, pricing anomalies

---

## 11. Workflow Orchestration

### 11.1 Phases

The inspection follows 11 sequential phases defined in `shared/contracts/workflow.ts`:

| Phase | Name | Key Activities |
|---|---|---|
| 1 | `briefing` | Review claim context and AI briefing |
| 2 | `inspection_setup` | Bootstrap session, select structure |
| 3 | `interior_rooms` | Create rooms, set dimensions |
| 4 | `openings` | Add doors, windows, missing walls |
| 5 | `elevations` | Document exterior elevations |
| 6 | `roof` | Roof facets, pitch, test squares |
| 7 | `photos_damage` | Photo capture, damage documentation |
| 8 | `scope_build` | Line items, auto-scope, macros |
| 9 | `review` | QA review, AI compliance check |
| 10 | `finalize` | Final approval |
| 11 | `export` | Generate ESX, PDF, Photo Reports |

### 11.2 Orchestrator (`server/workflow/orchestrator.ts`)

Manages inspection state machine:

- **State**: Stored in `inspection_sessions.workflowStateJson` as `{ phase, stepId, context }`
- **Phase Advancement**: `advance()` checks `canAdvance()` (no blockers from gates)
- **Tool Validation**: `validateToolForWorkflow(toolName, phase)` checks `PHASE_ALLOWED_TOOLS` map
- **Enforcement**: "Warn-only" — agent is instructed but not hard-blocked from using tools out of phase

### 11.3 Validation Gates

Four validators run before phase advancement:

#### Sketch Gate (`sketchGate.ts`)
- Rooms with too few vertices
- Invalid coordinates (NaN)
- Openings wider than their walls
- Missing dimensions

#### Photo-Damage Gate (`photoDamageGate.ts`)
- Photos without analysis
- Unassociated photos (no room link)
- AI-detected damage without corresponding observation

#### Scope Gate (`scopeGate.ts`)
- Damage observations without line items (`SCOPE_DAMAGE_UNCOVERED`)
- Duplicate line items
- Missing mandatory companion items

#### Export Gate (`exportGate.ts`)
- Runs all previous gates
- Checks for missing claim data (claim number, address)
- Returns `{ canExport, blockers[], warnings[] }`

### 11.4 Inspection Flows

Customizable step-by-step guides stored in `inspection_flows` table:
- System defaults: Standard Hail, Wind, Water, Fire, General
- User customs: Clone and modify system flows
- Each flow has `steps[]` array with step name, description, and validation requirements

---

## 12. Sketch & Floor Plan System

### 12.1 Architecture

The sketch system uses a **coordinate-free adjacency graph** resolved to 2D SVG at runtime:

```
Room Data + Adjacency Graph  →  BFS Layout Engine  →  SVG Rendering
     (Database)                 (sketchLayout.ts)      (SketchRenderer.tsx)
```

### 12.2 BFS Layout Engine (`client/src/lib/sketchLayout.ts`)

Converts room graph to absolute SVG coordinates:

1. **Seed**: First room placed at `(0, 0)`
2. **BFS Traversal**: For each adjacency:
   - Calculate new room position based on direction (north/south/east/west)
   - Check for collision with already-placed rooms
   - Skip if collision detected
3. **Fallback Grid**: Unreachable rooms placed in grid below main layout
4. **Normalize**: Shift all coordinates so min X/Y = 0

**Key Functions:**
- `computeLayout(rooms, adjacencies, scale)` → `LayoutRoom[]`
- `hitTestWall(point, room)` → Determine which wall the user clicked on

### 12.3 Rendering Components

**`SketchRenderer.tsx`** — Pure SVG renderer:
- Rooms as filled rectangles with dimension labels
- Openings via `ArchOpeningSymbol`:
  - Doors: arc paths
  - Windows: triple-line symbols
  - Missing walls: dashed gaps
- Selection handles for interactive editing
- Room name labels, damage count badges

**`PropertySketch.tsx`** — Multi-section display:
- Separates interior, roof, and elevation views
- Auto-layout for each section
- Used in reports and inspection overview

**`SketchEditor.tsx`** — Interactive editor:
- Tool modes: Select, Add Room, Add Door, Add Window
- Drag-to-resize with dimension snapping
- Ghost preview for new room placement
- Undo/redo history stack
- Touch-first design for iPad usage

**`FloorPlanSketch.tsx`** — Lightweight read-only view:
- Used in sidebar and mobile views
- Simplified BFS layout

---

## 13. Frontend Pages & Components

### 13.1 Routing (`client/src/App.tsx`)

| Path | Component | Description |
|---|---|---|
| `/` | `ClaimsList` | Main dashboard |
| `/dashboard` | `SupervisorDashboard` | Admin metrics |
| `/documents` | `DocumentsHub` | Document repository |
| `/settings` | `SettingsPage` | User settings |
| `/settings/workflows` | `WorkflowBuilder` | Inspection flow editor |
| `/profile` | `ProfilePage` | User profile |
| `/gallery/photos` | `PhotoGallery` | Cross-claim photos |
| `/gallery/sketches` | `SketchGallery` | Cross-claim sketches |
| `/photo-lab` | `PhotoLab` | Standalone photo analysis |
| `/upload/:id` | `DocumentUpload` | Upload PDFs |
| `/review/:id` | `ExtractionReview` | Review extractions |
| `/briefing/:id` | `InspectionBriefing` | Pre-inspection briefing |
| `/inspection/:id/scope` | `ScopePage` | Line item editor |
| `/inspection/:id/review` | `ReviewFinalize` | Final QA |
| `/inspection/:id/export` | `ExportPage` | Report generation |
| `/inspection/:id/supplemental` | `SupplementalPage` | Supplements |
| `/inspection/:id` | `ActiveInspection` | Main inspection (voice/camera) |

### 13.2 Key Pages

#### `ActiveInspection.tsx` (4300+ lines)
The main inspection interface. Manages:
- WebRTC connection to OpenAI Realtime API
- Voice agent tool execution (35+ tools)
- Camera capture with deferred photo pattern
- Real-time sketch display (PropertySketch)
- Transcript display (minimal bar on mobile, overlay for full view)
- Progress strip showing inspection phases
- Responsive: desktop has collapsible sketch panel, mobile shows sketch as primary view

#### `ClaimsList.tsx`
Dashboard showing all claims with:
- Status badges (draft, in_progress, review, complete)
- Dual-action ClaimCard buttons (Upload Docs / Start Inspection)
- Filtering by status and peril type
- Role-based visibility

#### `DocumentUpload.tsx`
Drag-and-drop PDF upload for FNOL, Policy, Endorsements. Shows upload progress and document status tracking.

#### `ExtractionReview.tsx`
Side-by-side view: original PDF (pdfjs-dist viewer) + AI extraction results. Editable fields with confidence indicators. Confirm/reject workflow.

#### `InspectionBriefing.tsx`
Displays AI-generated briefing with collapsible sections: Property Profile, Coverage Snapshot, Peril Analysis, Inspection Checklist, Red Flags.

#### `ScopePage.tsx`
Line item editor with room grouping. Trade-specific columns. Quantity recalculation on dimension changes. Companion item indicators.

#### `ExportPage.tsx`
Export validation (blockers/warnings) + download buttons for ESX, PDF Estimate, PDF Photo Report, DOCX Photo Report.

#### `SupervisorDashboard.tsx`
Admin metrics: total claims, active sessions, average inspection time, automation rate. Active session list with completeness scores.

### 13.3 Key Components

| Component | Purpose |
|---|---|
| `ClaimCard` | Summary card with status badge, peril icon, dual-action buttons |
| `PropertySketch` | Multi-section SVG property layout (interior + roof + elevation) |
| `SketchRenderer` | Pure SVG renderer for rooms, openings, annotations |
| `SketchEditor` | Interactive floor plan editor with tools |
| `FloorPlanSketch` | Lightweight read-only sketch view |
| `PhotoAnnotator` | Canvas-based photo markup (arrows, boxes, text) |
| `PhotoGallery` | Photo grid with room filtering and grouping |
| `WeatherCorrelation` | Date-of-loss vs weather data visualization |
| `MoistureMap` | Moisture reading visualizer on floor plan |
| `VoiceIndicator` | Visual feedback for voice agent status (idle, listening, speaking) |
| `AIReviewPanel` | AI compliance warnings display |
| `XactimateEstimateView` | Formatted estimate preview |
| `RoomEditorPanel` | Room dimension editing form |
| `PdfViewer` | Full-screen PDF viewer |
| `ProgressMap` | Inspection progress modal |
| `BottomNav` | Mobile tab navigation |
| `OnboardingWizard` | First-time user setup |
| `OfflineBanner` | Network status indicator |
| `StatusBadge` | Color-coded status chip |

### 13.4 Contexts & Hooks

| Name | File | Purpose |
|---|---|---|
| `AuthContext` | `contexts/AuthContext.tsx` | Authentication state, user, role |
| `SettingsProvider` | `components/SettingsProvider.tsx` | User settings context |
| `useOfflineSync` | `hooks/useOfflineSync.ts` | Sync offline queue when online |
| `useOnlineStatus` | `hooks/useOnlineStatus.ts` | Network connectivity detection |
| `use-toast` | `hooks/use-toast.ts` | Toast notification system |
| `use-settings` | `hooks/use-settings.ts` | Settings access hook |

### 13.5 Client Libraries

| File | Purpose |
|---|---|
| `queryClient.ts` | TanStack Query configuration (stale time, retry, error handling) |
| `supabaseClient.ts` | Supabase browser client initialization (gets config from `/api/config`) |
| `sketchLayout.ts` | BFS layout engine + wall hit testing |
| `realtimeTooling.ts` | Voice tool execution mapping (tool name → API call) |
| `offlineQueue.ts` | Queue operations when offline, replay when online |
| `fetchWithTimeout.ts` | Fetch wrapper with configurable timeout |
| `logger.ts` | Client-side structured logging |

---

## 14. Build & Deployment

### 14.1 Development

```bash
npm run dev
# Sets NODE_ENV=development
# Runs server/index.ts via tsx
# Vite dev server in middleware mode (HMR, hot reload)
# Server on port 5000
```

In development:
- Express boots → calls `setupVite()` (server/vite.ts)
- Vite creates dev server in `middlewareMode`
- Client assets served from `client/` directory with HMR
- API routes registered under `/api/*`

### 14.2 Production Build

```bash
npm run build
# Executes script/build.ts
```

Build pipeline (`script/build.ts`):
1. **Client**: `vite build` → compiled React app → `dist/public/`
2. **Server**: `esbuild` bundles Express server → `dist/index.cjs`
   - Format: CommonJS (for Node.js compatibility)
   - Platform: node
   - Target: node20
   - Some deps bundled (via allowlist) to reduce cold start `openat(2)` syscalls
   - Others marked as external

```bash
npm start
# NODE_ENV=production node dist/index.cjs
```

In production:
- Express boots → calls `serveStatic()` (server/static.ts)
- Pre-built static assets served from `dist/public/` via `express.static`
- SPA fallback: all non-API routes serve `dist/public/index.html`
- Server binds port immediately with "Loading" HTML for health checks
- Full initialization (routes, DB) happens asynchronously

### 14.3 CJS/ESM Strategy

| Context | Module Format |
|---|---|
| Source code | ESM (`import`/`export`) |
| `package.json` | `"type": "module"` |
| `tsconfig.json` | `module: "ESNext"` |
| Dev runtime | ESM via `tsx` |
| Production bundle | CJS (`dist/index.cjs`) via esbuild |

The `tsconfig.json` uses `esModuleInterop: true` and `moduleResolution: "bundler"`.

### 14.4 Replit Deployment

Configured in `.replit`:
- **Target**: `autoscale`
- **Build**: `["npm", "run", "build"]`
- **Run**: `["sh", "-c", "NODE_ENV=production node ./dist/index.cjs"]`
- **Environment**: Node.js 20, PostgreSQL 16

### 14.5 Database Migrations

```bash
npm run db:push      # Push schema to database (development)
npm run db:generate  # Generate migration files
npm run db:migrate   # Run migrations
```

Drizzle config (`drizzle.config.ts`):
- Schema: `shared/schema.ts`
- Output: `./migrations`
- Connection: `SUPABASE_DATABASE_URL` or `DATABASE_URL`

---

## 15. External Services Integration

### 15.1 Supabase

**PostgreSQL Database:**
- 31 tables via Drizzle ORM
- Connected via `postgres.js` driver
- Connection string: `SUPABASE_DATABASE_URL`

**Storage Buckets:**
| Bucket | Purpose |
|---|---|
| `documents` | FNOL, Policy, Endorsement PDFs |
| `inspection-photos` | Inspection and standalone photos |
| `avatars` | User profile images |

Server uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS for storage operations.

**Authentication:**
- Optional OAuth/email auth via Supabase Auth SDK
- Synced to local users via `/api/auth/sync`

### 15.2 OpenAI

**GPT-4.1 (Text):**
- FNOL extraction (`extractFNOL`)
- Policy extraction (`extractPolicy`)
- Endorsement extraction (`extractEndorsements`)
- Briefing generation (`generateBriefing`)
- Estimate review (`reviewEstimate`)

**GPT-4o (Vision):**
- Photo damage detection
- Material/finish identification
- Address verification
- Bounding box damage localization

**Realtime API (Voice):**
- Model: `gpt-4o-realtime-preview`
- Transport: WebRTC
- Audio: bi-directional via `getUserMedia`
- Tools: 35+ function tools
- Transcription: Whisper-1

### 15.3 Visual Crossing

- **API**: Timeline Weather API
- **Purpose**: Historical weather data for date-of-loss validation
- **Key**: `VISUAL_CROSSING_API_KEY`
- **Data**: Temperature, wind speed, precipitation, hail indicators

---

## 16. Key Design Decisions

### 16.1 Voice Password for Skip
The password to skip inspection steps is "123" (spoken as "one-two-three"). This prevents accidental skips during voice interaction.

### 16.2 Microphone Gating Disabled
`ENABLE_MIC_GATING = false` in ActiveInspection.tsx. Prevents AI from treating natural pauses as new sessions.

### 16.3 Claims Never Auto-Complete
Claims must remain "in progress" until the user explicitly marks them complete. Neither finishing inspection nor the voice agent's `complete_inspection` tool changes claim status to "complete."

### 16.4 pdf-parse Version Lock
Must stay at v1.1.1. Version 2 has an incompatible API that breaks PDF text extraction.

### 16.5 Supabase Only (No Local PostgreSQL)
All database operations go through Supabase PostgreSQL. Never use local Replit PostgreSQL or `execute_sql_tool`.

### 16.6 Session Selection Logic
When multiple active inspection sessions exist for a claim, pick the one with the highest `currentPhase`.

### 16.7 Privileged Role Check Pattern
Always use `role === "supervisor" || role === "admin"` for privileged access checks.

### 16.8 Color Scheme
Professional insurance styling with purple and gold color scheme. Clean, minimal aesthetic.

---

## 17. Setup Instructions

### 17.1 Prerequisites

- Node.js 20+
- Supabase project with PostgreSQL database
- OpenAI API key with access to GPT-4.1, GPT-4o, and Realtime API
- Visual Crossing API key (for weather features)

### 17.2 Environment Setup

Create these environment variables:

```bash
SUPABASE_DATABASE_URL=postgresql://postgres:[password]@[host]:5432/postgres
SUPABASE_URL=https://[project-id].supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...
OPENAI_API_KEY=sk-...
JWT_SECRET=your-random-secret-string
VISUAL_CROSSING_API_KEY=your-key
```

### 17.3 Installation

```bash
npm install
```

### 17.4 Database Setup

```bash
# Push schema to Supabase
npm run db:push

# Create Supabase Storage buckets (via Supabase dashboard or CLI):
# - documents (public: false)
# - inspection-photos (public: false)
# - avatars (public: true)
```

### 17.5 Seed Data

```bash
# Seed inspection flow templates
# (Happens automatically on server start via seed-flows.ts)
```

### 17.6 Run Development Server

```bash
npm run dev
# Server starts on http://localhost:5000
```

### 17.7 Production Build & Deploy

```bash
npm run build
npm start
```

### 17.8 First User

1. Navigate to the login page
2. Register a new account
3. First registered user can be manually promoted to admin via database:
   ```sql
   UPDATE users SET role = 'admin' WHERE username = 'your-username';
   ```

---

## Appendix A: Data Flow Diagrams

### A.1 Document Upload → Extraction → Briefing

```
User uploads PDF
  → POST /api/claims/:id/documents/upload
  → Stored in Supabase Storage (documents bucket)
  → Document record created (status: uploaded)

User triggers parse
  → POST /api/claims/:id/documents/:type/parse
  → pdf-parse extracts raw text
  → Raw text stored in documents.rawText
  → GPT-4.1 extracts structured data
  → Extraction record created
  → FNOL: auto-syncs claim fields (name, address, DOL, peril)

User confirms extractions
  → POST /api/claims/:id/extractions/confirm-all

User generates briefing
  → POST /api/claims/:id/briefing/generate
  → GPT-4.1 synthesizes all 3 extractions
  → Briefing record created with 7 sections
  → Claim status → "briefing_ready"
```

### A.2 Voice Inspection Flow

```
User clicks "Start Inspection"
  → POST /api/realtime/session
  → Server builds system instructions with claim context
  → OpenAI returns ephemeral client_secret
  → Client establishes WebRTC connection
  → Voice session active

Agent says "Let's start by creating the main dwelling"
  → Agent calls create_structure({ name: "Main Dwelling", structureType: "dwelling" })
  → Client hits POST /api/inspection/:sessionId (structure creation via inspection routes)
  → Result sent back to agent via data channel
  → Agent narrates confirmation

Agent says "Take a photo of the front of the property"
  → Agent calls trigger_photo_capture({ label: "Front Exterior", photoType: "overview" })
  → Client opens camera (deferred result)
  → User snaps photo
  → Upload to Supabase Storage
  → POST /api/inspection/:sessionId/photos/:photoId/analyze
  → GPT-4o Vision returns damage + materials
  → photoScopeBridge normalizes results
  → function_call_output sent to agent
  → Agent narrates "I can see hail damage on the siding..."
```

### A.3 Estimate Calculation → Export

```
Scope assembly triggered
  → scopeAssemblyService.assembleScope(damage, room)
  → scopeQuantityEngine.deriveQuantity(formula, dimVars)
  → companionEngine.autoAddCompanions(primary)
  → openingDeductionService.calculateOpeningDeductions(roomId)
  → Line items created with quantities

Export triggered
  → POST /api/inspection/:sessionId/export/validate
  → exportGate runs all gates
  → If canExport:
    → POST /api/inspection/:sessionId/export/esx
    → estimateEngine.calculateSettlement()
    → depreciationEngine.calculateDepreciation()
    → esxGenerator.generateESXFile()
    → Returns .esx ZIP file
```
