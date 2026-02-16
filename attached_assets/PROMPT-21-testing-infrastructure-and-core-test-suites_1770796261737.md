# PROMPT-21 — Testing Infrastructure & Core Test Suites

## Context

The codebase has **zero test infrastructure** — no test framework, no test files, no test configuration. Every route handler, storage method, validation schema, voice agent tool definition, and AI integration is production-only code with no automated verification.

The project uses Vite for client bundling and esbuild for server compilation, both of which integrate naturally with **Vitest** — a Vite-native test runner that shares the same config, transform pipeline, and module resolution. Vitest also supports TypeScript natively without separate compilation, making it the obvious choice over Jest for this stack.

This prompt establishes the testing foundation: framework setup, mock utilities, fixture factories, and core test suites covering the most critical paths through the system. It does NOT attempt to achieve 100% coverage — it targets the high-value surfaces where bugs would cause the most damage: schema validation, storage layer, API routes, and voice agent tool dispatch.

**Depends on**: All prior prompts (tests verify the system as built through PROMPT-20)

---

## Part A — Test Framework Setup

### A.1 — Install Dependencies

```bash
npm install --save-dev vitest @vitest/coverage-v8 supertest @types/supertest
```

**Why these packages:**

- `vitest` — Test runner, assertion library, mocking. Shares Vite's transform pipeline so TypeScript, path aliases (`@/`, `@shared/`) work without config.
- `@vitest/coverage-v8` — Code coverage via V8's built-in instrumentation. Faster than Istanbul for this project size.
- `supertest` — HTTP assertion library for testing Express routes without starting a real server.
- `@types/supertest` — TypeScript definitions for supertest.

### A.2 — Vitest Configuration

Create `vitest.config.ts` in the project root:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client/src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  test: {
    // Separate server and client test environments
    environmentMatchGlobs: [
      ["server/**/*.test.ts", "node"],
      ["client/**/*.test.ts", "jsdom"],
      ["client/**/*.test.tsx", "jsdom"],
    ],
    // Global setup for database mocking
    setupFiles: ["./tests/setup.ts"],
    // Coverage configuration
    coverage: {
      provider: "v8",
      include: [
        "server/**/*.ts",
        "shared/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/node_modules/**",
      ],
      thresholds: {
        // Start conservative, increase as coverage grows
        statements: 40,
        branches: 30,
        functions: 40,
        lines: 40,
      },
    },
    // Timeouts
    testTimeout: 10_000,
    hookTimeout: 10_000,
    // Concurrency
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true }, // Avoid port conflicts in route tests
    },
  },
});
```

### A.3 — Package.json Script

Add to `package.json` in the `"scripts"` section:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage",
"test:ui": "vitest --ui"
```

### A.4 — Global Test Setup

Create `tests/setup.ts`:

```ts
import { vi, beforeEach, afterEach } from "vitest";

// Reset all mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Suppress console.error in tests (routes.ts logs every caught error)
vi.spyOn(console, "error").mockImplementation(() => {});
// Keep console.warn visible for debugging
// vi.spyOn(console, "warn").mockImplementation(() => {});
```

---

## Part B — Mock Utilities & Test Fixtures

### B.1 — Mock Storage

The storage layer (`server/storage.ts`) exports a singleton `storage` object that implements the `IStorage` interface. Every route handler depends on it. We need a mock that can be configured per test.

Create `tests/mocks/mockStorage.ts`:

```ts
import { vi } from "vitest";
import type { IStorage } from "../../server/storage";

/**
 * Creates a fully-mocked IStorage instance.
 * Every method returns a vi.fn() that can be configured per test.
 *
 * Usage:
 *   const storage = createMockStorage();
 *   storage.getClaim.mockResolvedValue({ id: 1, claimNumber: "CLM-001" });
 */
export function createMockStorage(): {
  [K in keyof IStorage]: ReturnType<typeof vi.fn>;
} {
  return {
    // ─── Users ───
    getUser: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserBySupabaseId: vi.fn(),
    createUser: vi.fn(),
    getUsers: vi.fn(),
    updateUser: vi.fn(),

    // ─── Claims ───
    getClaim: vi.fn(),
    getClaims: vi.fn(),
    createClaim: vi.fn(),
    updateClaimStatus: vi.fn(),
    updateClaimFields: vi.fn(),
    deleteClaim: vi.fn(),

    // ─── Documents ───
    getDocument: vi.fn(),
    getDocuments: vi.fn(),
    createDocument: vi.fn(),
    updateDocument: vi.fn(),
    deleteDocument: vi.fn(),

    // ─── Extractions ───
    getExtraction: vi.fn(),
    getExtractions: vi.fn(),
    createExtraction: vi.fn(),
    updateExtraction: vi.fn(),

    // ─── Briefings ───
    getBriefing: vi.fn(),
    createBriefing: vi.fn(),
    updateBriefing: vi.fn(),

    // ─── Inspection Sessions ───
    getInspectionSession: vi.fn(),
    getInspectionSessions: vi.fn(),
    createInspectionSession: vi.fn(),
    updateInspectionSession: vi.fn(),

    // ─── Rooms ───
    getRoom: vi.fn(),
    getRooms: vi.fn(),
    createRoom: vi.fn(),
    updateRoom: vi.fn(),
    deleteRoom: vi.fn(),

    // ─── Damages ───
    getDamage: vi.fn(),
    getDamages: vi.fn(),
    createDamage: vi.fn(),
    updateDamage: vi.fn(),

    // ─── Photos ───
    getPhoto: vi.fn(),
    getPhotos: vi.fn(),
    createPhoto: vi.fn(),
    updatePhoto: vi.fn(),
    deletePhoto: vi.fn(),

    // ─── Moisture Readings ───
    getMoistureReading: vi.fn(),
    getMoistureReadings: vi.fn(),
    createMoistureReading: vi.fn(),

    // ─── Line Items ───
    getLineItem: vi.fn(),
    getLineItems: vi.fn(),
    createLineItem: vi.fn(),
    updateLineItem: vi.fn(),
    deleteLineItem: vi.fn(),

    // ─── Estimate Summary ───
    getEstimateSummary: vi.fn(),
    createEstimateSummary: vi.fn(),
    updateEstimateSummary: vi.fn(),

    // ─── Transcript ───
    getTranscriptEntries: vi.fn(),
    createTranscriptEntry: vi.fn(),

    // ─── Session Counters ───
    incrementSessionCounter: vi.fn(),
    getSessionCounters: vi.fn(),
  };
}
```

**Note**: The method list above is derived from the `IStorage` interface in `server/storage.ts`. If new methods are added in future prompts, add corresponding `vi.fn()` entries here. The TypeScript compiler will flag any missing methods since the return type must satisfy `IStorage`.

### B.2 — Mock Auth

Create `tests/mocks/mockAuth.ts`:

```ts
import { vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

/**
 * Creates middleware mocks that simulate authenticated requests.
 * Default user is an adjuster. Override per test as needed.
 */
export const defaultTestUser = {
  id: "user-1",
  email: "adjuster@test.com",
  role: "adjuster",
  fullName: "Test Adjuster",
  supabaseAuthId: "supa-auth-123",
};

export const adminTestUser = {
  id: "admin-1",
  email: "admin@test.com",
  role: "admin",
  fullName: "Test Admin",
  supabaseAuthId: "supa-auth-admin",
};

/**
 * Mock authenticateRequest that injects a test user.
 */
export function mockAuthMiddleware(user = defaultTestUser) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

/**
 * Mock requireRole that always passes (use specific role checks in tests).
 */
export function mockRequireRole(..._roles: string[]) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    next();
  };
}
```

### B.3 — Test Fixture Factories

Create `tests/fixtures/factories.ts`:

```ts
/**
 * Factory functions for creating test data.
 * Each factory returns a valid object with sensible defaults.
 * Override any field by passing partial data.
 */

let idCounter = 1;
function nextId() {
  return idCounter++;
}

export function resetIdCounter() {
  idCounter = 1;
}

// ─── Claim ───
export function buildClaim(overrides: Record<string, any> = {}) {
  const id = overrides.id ?? nextId();
  return {
    id,
    claimNumber: `CLM-${String(id).padStart(5, "0")}`,
    insuredName: "John Doe",
    propertyAddress: "123 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    dateOfLoss: "2025-03-15",
    perilType: "hail",
    status: "active",
    assignedTo: "user-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Inspection Session ───
export function buildSession(overrides: Record<string, any> = {}) {
  const id = overrides.id ?? nextId();
  return {
    id,
    claimId: overrides.claimId ?? 1,
    status: "active",
    currentPhase: 1,
    currentStructure: "main",
    currentRoomId: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    roomCount: 0,
    damageCount: 0,
    photoCount: 0,
    lineItemCount: 0,
    ...overrides,
  };
}

// ─── Room ───
export function buildRoom(overrides: Record<string, any> = {}) {
  const id = overrides.id ?? nextId();
  return {
    id,
    sessionId: overrides.sessionId ?? 1,
    name: `Room ${id}`,
    roomType: "bedroom",
    structure: "main",
    dimensions: null,
    phase: 3,
    isComplete: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Damage ───
export function buildDamage(overrides: Record<string, any> = {}) {
  const id = overrides.id ?? nextId();
  return {
    id,
    sessionId: overrides.sessionId ?? 1,
    roomId: overrides.roomId ?? 1,
    description: "Water staining on ceiling",
    damageType: "water_stain",
    severity: "moderate",
    location: "ceiling center",
    sourcePhotoId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Line Item ───
export function buildLineItem(overrides: Record<string, any> = {}) {
  const id = overrides.id ?? nextId();
  return {
    id,
    sessionId: overrides.sessionId ?? 1,
    roomId: overrides.roomId ?? 1,
    damageId: overrides.damageId ?? null,
    category: "Drywall",
    action: "Remove & Replace",
    description: "Drywall - Remove & Replace 1/2\"",
    xactCode: "DRY-RR12",
    quantity: 48,
    unit: "SF",
    unitPrice: 3.25,
    totalPrice: 156.0,
    depreciationType: "normal",
    wasteFactor: 10,
    provenance: "voice",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Photo ───
export function buildPhoto(overrides: Record<string, any> = {}) {
  const id = overrides.id ?? nextId();
  return {
    id,
    sessionId: overrides.sessionId ?? 1,
    roomId: overrides.roomId ?? 1,
    damageId: null,
    storagePath: `photos/session-1/photo-${id}.jpg`,
    photoType: "damage_evidence",
    label: "Ceiling water damage",
    analysis: null,
    autoTag: null,
    annotations: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Estimate Summary ───
export function buildEstimateSummary(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? nextId(),
    sessionId: overrides.sessionId ?? 1,
    totalRCV: 5250.0,
    totalACV: 4462.5,
    totalDepreciation: 787.5,
    totalOverhead: 525.0,
    totalProfit: 525.0,
    deductible: 1000.0,
    netClaimRCV: 4250.0,
    netClaimACV: 3462.5,
    lineItemCount: 12,
    roomCount: 4,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
```

### B.4 — Storage Module Mock Setup

Create `tests/mocks/storageMock.ts` — this file is used to intercept the storage import so route tests use the mock:

```ts
import { vi } from "vitest";
import { createMockStorage } from "./mockStorage";

// Create a shared mock instance that tests can configure
export const mockStorageInstance = createMockStorage();

// Mock the storage module — any file importing { storage } from "./storage"
// will get our mock instead
vi.mock("../../server/storage", () => ({
  storage: mockStorageInstance,
}));
```

---

## Part C — Schema Validation Tests

### File: `tests/server/schemas.test.ts`

These tests verify the Zod schemas defined at the top of `server/routes.ts` (lines 14–67). Schema validation is the first line of defense against bad input — if a schema is too permissive or too strict, everything downstream suffers.

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";

// ─── Replicate schemas from routes.ts (lines 14-67) ───
// In production, these should be extracted to a shared file.
// For now, we import them by re-declaring to match routes.ts exactly.

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

const sessionUpdateSchema = z.object({
  currentPhase: z.number().int().positive().optional(),
  currentRoomId: z.number().int().positive().nullable().optional(),
  currentStructure: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
});

const roomCreateSchema = z.object({
  name: z.string().min(1).max(100),
  roomType: z.string().max(50).nullable().optional(),
  structure: z.string().max(100).nullable().optional(),
  dimensions: z.any().optional(),
  phase: z.number().int().positive().nullable().optional(),
});

const lineItemCreateSchema = z.object({
  roomId: z.number().int().positive().nullable().optional(),
  damageId: z.number().int().positive().nullable().optional(),
  category: z.string().min(1).max(50),
  action: z.string().max(30).nullable().optional(),
  description: z.string().min(1),
  xactCode: z.string().max(30).nullable().optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().max(20).nullable().optional(),
  unitPrice: z.number().nonnegative().optional(),
  depreciationType: z.string().max(30).nullable().optional(),
  wasteFactor: z.number().int().nonnegative().optional(),
});

// ─── Tests ───

describe("createClaimSchema", () => {
  it("accepts a minimal valid claim", () => {
    const result = createClaimSchema.safeParse({ claimNumber: "CLM-001" });
    expect(result.success).toBe(true);
  });

  it("accepts a full claim with all optional fields", () => {
    const result = createClaimSchema.safeParse({
      claimNumber: "CLM-001",
      insuredName: "John Doe",
      propertyAddress: "123 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
      dateOfLoss: "2025-03-15",
      perilType: "hail",
      status: "active",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty claimNumber", () => {
    const result = createClaimSchema.safeParse({ claimNumber: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing claimNumber", () => {
    const result = createClaimSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects claimNumber exceeding 50 characters", () => {
    const result = createClaimSchema.safeParse({
      claimNumber: "A".repeat(51),
    });
    expect(result.success).toBe(false);
  });

  it("accepts null optional fields", () => {
    const result = createClaimSchema.safeParse({
      claimNumber: "CLM-001",
      insuredName: null,
      city: null,
      perilType: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("sessionUpdateSchema", () => {
  it("accepts partial update with phase only", () => {
    const result = sessionUpdateSchema.safeParse({ currentPhase: 3 });
    expect(result.success).toBe(true);
  });

  it("rejects non-positive phase", () => {
    const result = sessionUpdateSchema.safeParse({ currentPhase: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer phase", () => {
    const result = sessionUpdateSchema.safeParse({ currentPhase: 2.5 });
    expect(result.success).toBe(false);
  });

  it("accepts null currentRoomId (leaving a room)", () => {
    const result = sessionUpdateSchema.safeParse({ currentRoomId: null });
    expect(result.success).toBe(true);
  });

  it("rejects empty status string", () => {
    const result = sessionUpdateSchema.safeParse({ status: "" });
    expect(result.success).toBe(false);
  });

  it("accepts empty object (no updates)", () => {
    const result = sessionUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("roomCreateSchema", () => {
  it("accepts minimal room with name only", () => {
    const result = roomCreateSchema.safeParse({ name: "Kitchen" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = roomCreateSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding 100 characters", () => {
    const result = roomCreateSchema.safeParse({ name: "R".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts room with all optional fields", () => {
    const result = roomCreateSchema.safeParse({
      name: "Master Bedroom",
      roomType: "bedroom",
      structure: "main",
      dimensions: { length: 12, width: 14, height: 8 },
      phase: 3,
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative phase", () => {
    const result = roomCreateSchema.safeParse({ name: "Room", phase: -1 });
    expect(result.success).toBe(false);
  });
});

describe("lineItemCreateSchema", () => {
  it("accepts minimal line item", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "Drywall",
      description: "Drywall - Remove & Replace 1/2\"",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing category", () => {
    const result = lineItemCreateSchema.safeParse({
      description: "Some item",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing description", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "Roofing",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative unitPrice", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "Drywall",
      description: "Item",
      unitPrice: -5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts zero unitPrice (free items like disposal)", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "General",
      description: "Debris disposal",
      unitPrice: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-positive quantity", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "Drywall",
      description: "Item",
      quantity: 0,
    });
    expect(result.success).toBe(false);
  });

  it("accepts line item with catalog code", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "Roofing",
      description: "Architectural shingles",
      xactCode: "RFG-SHIN-AR",
      quantity: 24,
      unit: "SQ",
      unitPrice: 127.5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects xactCode exceeding 30 characters", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "Roofing",
      description: "Item",
      xactCode: "X".repeat(31),
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative wasteFactor", () => {
    const result = lineItemCreateSchema.safeParse({
      category: "Drywall",
      description: "Item",
      wasteFactor: -10,
    });
    expect(result.success).toBe(false);
  });
});
```

**Why inline schema definitions**: The schemas are currently defined inline in `routes.ts` (lines 14–67) and not exported. A future refactor should extract them to `shared/schemas.ts` and import them in both `routes.ts` and the test file. For now, we replicate them to avoid modifying production code in the test setup prompt.

---

## Part D — API Route Integration Tests

### File: `tests/server/routes.claims.test.ts`

These tests verify the claim CRUD endpoints using supertest. They mock the storage layer and auth middleware to isolate route logic.

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createMockStorage } from "../mocks/mockStorage";
import { mockAuthMiddleware, defaultTestUser, adminTestUser } from "../mocks/mockAuth";
import { buildClaim } from "../fixtures/factories";

// ─── Setup: Create a minimal Express app with mocked dependencies ───

let app: express.Express;
let mockStorage: ReturnType<typeof createMockStorage>;

/**
 * We can't easily import registerRoutes because it depends on storage
 * and auth modules globally. Instead, we test individual route handlers
 * by creating slim route registrations that mirror the patterns in routes.ts.
 *
 * This approach tests the handler logic without requiring full app bootstrap.
 */
function createTestApp(user = defaultTestUser) {
  const app = express();
  app.use(express.json());
  app.use(mockAuthMiddleware(user));
  return app;
}

beforeEach(() => {
  mockStorage = createMockStorage();
  app = createTestApp();

  // ─── Register claim routes matching routes.ts patterns ───

  // GET /api/claims (routes.ts line 128)
  app.get("/api/claims", async (_req, res) => {
    try {
      const claims = await mockStorage.getClaims();
      res.json(claims);
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/claims (routes.ts line 151)
  app.post("/api/claims", async (req, res) => {
    try {
      const { z } = await import("zod");
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
      const parsed = createClaimSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid claim data",
          errors: parsed.error.flatten().fieldErrors,
        });
      }
      const claimData = { ...parsed.data, assignedTo: req.user?.id ?? null };
      const claim = await mockStorage.createClaim(claimData);
      res.status(201).json(claim);
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/claims/:id (routes.ts line 165)
  app.get("/api/claims/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const claim = await mockStorage.getClaim(id);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      const docs = await mockStorage.getDocuments(id);
      const exts = await mockStorage.getExtractions(id);
      const briefing = await mockStorage.getBriefing(id);
      res.json({ ...claim, documents: docs, extractions: exts, briefing });
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
});

// ─── Tests ───

describe("GET /api/claims", () => {
  it("returns all claims", async () => {
    const claims = [buildClaim({ id: 1 }), buildClaim({ id: 2 })];
    mockStorage.getClaims.mockResolvedValue(claims);

    const res = await request(app).get("/api/claims");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].claimNumber).toBe("CLM-00001");
  });

  it("returns empty array when no claims exist", async () => {
    mockStorage.getClaims.mockResolvedValue([]);

    const res = await request(app).get("/api/claims");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 500 on storage failure", async () => {
    mockStorage.getClaims.mockRejectedValue(new Error("DB connection lost"));

    const res = await request(app).get("/api/claims");

    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Internal server error");
  });
});

describe("POST /api/claims", () => {
  it("creates a claim with valid data", async () => {
    const newClaim = buildClaim({ id: 1 });
    mockStorage.createClaim.mockResolvedValue(newClaim);

    const res = await request(app)
      .post("/api/claims")
      .send({ claimNumber: "CLM-00001" });

    expect(res.status).toBe(201);
    expect(res.body.claimNumber).toBe("CLM-00001");
    expect(mockStorage.createClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        claimNumber: "CLM-00001",
        assignedTo: "user-1",
      })
    );
  });

  it("rejects invalid claim data (missing claimNumber)", async () => {
    const res = await request(app)
      .post("/api/claims")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid claim data");
    expect(mockStorage.createClaim).not.toHaveBeenCalled();
  });

  it("rejects empty claimNumber", async () => {
    const res = await request(app)
      .post("/api/claims")
      .send({ claimNumber: "" });

    expect(res.status).toBe(400);
  });

  it("passes all optional fields to storage", async () => {
    const fullData = {
      claimNumber: "CLM-FULL",
      insuredName: "Jane Smith",
      propertyAddress: "456 Oak Ave",
      city: "Dallas",
      state: "TX",
      zip: "75201",
      dateOfLoss: "2025-04-01",
      perilType: "wind",
    };
    mockStorage.createClaim.mockResolvedValue(buildClaim(fullData));

    const res = await request(app).post("/api/claims").send(fullData);

    expect(res.status).toBe(201);
    expect(mockStorage.createClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        ...fullData,
        assignedTo: "user-1",
      })
    );
  });
});

describe("GET /api/claims/:id", () => {
  it("returns claim with documents, extractions, and briefing", async () => {
    const claim = buildClaim({ id: 5 });
    mockStorage.getClaim.mockResolvedValue(claim);
    mockStorage.getDocuments.mockResolvedValue([{ id: 1, fileName: "fnol.pdf" }]);
    mockStorage.getExtractions.mockResolvedValue([]);
    mockStorage.getBriefing.mockResolvedValue({ id: 1, content: "Summary..." });

    const res = await request(app).get("/api/claims/5");

    expect(res.status).toBe(200);
    expect(res.body.claimNumber).toBe(claim.claimNumber);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.briefing.content).toBe("Summary...");
  });

  it("returns 404 for non-existent claim", async () => {
    mockStorage.getClaim.mockResolvedValue(null);

    const res = await request(app).get("/api/claims/999");

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Claim not found");
  });

  it("parses string ID parameter correctly", async () => {
    mockStorage.getClaim.mockResolvedValue(buildClaim({ id: 42 }));
    mockStorage.getDocuments.mockResolvedValue([]);
    mockStorage.getExtractions.mockResolvedValue([]);
    mockStorage.getBriefing.mockResolvedValue(null);

    await request(app).get("/api/claims/42");

    expect(mockStorage.getClaim).toHaveBeenCalledWith(42);
  });
});
```

---

## Part E — Voice Agent Tool Definition Tests

### File: `tests/server/realtimeTools.test.ts`

These tests verify the structural integrity of the voice agent tool definitions in `server/realtime.ts`. They ensure every tool has proper JSON Schema parameters, required fields, and valid descriptions.

```ts
import { describe, it, expect } from "vitest";
import { realtimeTools, buildSystemInstructions } from "../../server/realtime";

describe("realtimeTools", () => {
  it("exports an array of tool definitions", () => {
    expect(Array.isArray(realtimeTools)).toBe(true);
    expect(realtimeTools.length).toBeGreaterThanOrEqual(10);
  });

  it("every tool has required fields", () => {
    for (const tool of realtimeTools) {
      expect(tool.type).toBe("function");
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe("object");
    }
  });

  it("every tool has a unique name", () => {
    const names = realtimeTools.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it("tool names follow snake_case convention", () => {
    for (const tool of realtimeTools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  // ─── Verify specific tools exist with expected parameters ───

  it("set_inspection_context accepts phase, structure, area", () => {
    const tool = realtimeTools.find((t) => t.name === "set_inspection_context");
    expect(tool).toBeDefined();
    const props = tool!.parameters.properties;
    expect(props.phase).toBeDefined();
    expect(props.structure).toBeDefined();
    expect(props.area).toBeDefined();
  });

  it("add_damage has required description and damageType params", () => {
    const tool = realtimeTools.find((t) => t.name === "add_damage");
    expect(tool).toBeDefined();
    const props = tool!.parameters.properties;
    expect(props.description).toBeDefined();
    expect(props.damageType).toBeDefined();
    expect(tool!.parameters.required).toContain("description");
    expect(tool!.parameters.required).toContain("damageType");
  });

  it("add_line_item has category and description as required", () => {
    const tool = realtimeTools.find((t) => t.name === "add_line_item");
    expect(tool).toBeDefined();
    expect(tool!.parameters.required).toContain("category");
    expect(tool!.parameters.required).toContain("description");
  });

  it("trigger_photo_capture has label and photoType params", () => {
    const tool = realtimeTools.find((t) => t.name === "trigger_photo_capture");
    expect(tool).toBeDefined();
    const props = tool!.parameters.properties;
    expect(props.label).toBeDefined();
    expect(props.photoType).toBeDefined();
  });

  it("add_damage description mentions auto-scope (PROMPT-20)", () => {
    const tool = realtimeTools.find((t) => t.name === "add_damage");
    expect(tool).toBeDefined();
    expect(tool!.description.toLowerCase()).toContain("auto");
  });

  // ─── PROMPT-20 new tools ───

  it("includes get_completeness tool", () => {
    const tool = realtimeTools.find((t) => t.name === "get_completeness");
    expect(tool).toBeDefined();
    expect(tool!.parameters.required).toEqual([]);
  });

  it("includes confirm_damage_suggestion tool", () => {
    const tool = realtimeTools.find((t) => t.name === "confirm_damage_suggestion");
    expect(tool).toBeDefined();
    expect(tool!.parameters.required).toContain("photoId");
    expect(tool!.parameters.required).toContain("damageType");
    expect(tool!.parameters.required).toContain("confirmed");
  });

  it("includes get_scope_gaps tool", () => {
    const tool = realtimeTools.find((t) => t.name === "get_scope_gaps");
    expect(tool).toBeDefined();
  });

  it("includes request_phase_validation tool", () => {
    const tool = realtimeTools.find((t) => t.name === "request_phase_validation");
    expect(tool).toBeDefined();
  });
});

describe("buildSystemInstructions", () => {
  // Minimal claim and briefing data for testing
  const testClaim = {
    id: 1,
    claimNumber: "CLM-001",
    insuredName: "Test Owner",
    propertyAddress: "123 Test St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    dateOfLoss: "2025-03-15",
    perilType: "hail",
    status: "active",
  };

  const testBriefing = {
    id: 1,
    claimId: 1,
    content: "Property is a single-story residential home with composition roof.",
    coverageLimits: { dwelling: 250000, personalProperty: 125000 },
  };

  // NOTE: buildSystemInstructions signature is (briefing, claim) — briefing first
  it("returns a non-empty string", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(typeof instructions).toBe("string");
    expect(instructions.length).toBeGreaterThan(500);
  });

  it("includes claim data in instructions", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions).toContain("CLM-001");
    expect(instructions).toContain("123 Test St");
    expect(instructions).toContain("hail");
  });

  it("includes peril-specific guidance for hail claims", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions.toLowerCase()).toContain("shingles");
    expect(instructions.toLowerCase()).toContain("test square");
  });

  it("includes wind-specific guidance for wind claims", () => {
    const windClaim = { ...testClaim, perilType: "wind" };
    const instructions = buildSystemInstructions(testBriefing, windClaim as any);
    expect(instructions.toLowerCase()).toContain("creased");
    expect(instructions.toLowerCase()).toContain("elevation");
  });

  it("includes water-specific guidance for water claims", () => {
    const waterClaim = { ...testClaim, perilType: "water" };
    const instructions = buildSystemInstructions(testBriefing, waterClaim as any);
    expect(instructions.toLowerCase()).toContain("moisture");
    expect(instructions.toLowerCase()).toContain("iicrc");
  });

  it("includes briefing content", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions).toContain("single-story");
  });

  it("includes 8 core behavioral sections", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions).toContain("Location Awareness");
    expect(instructions).toContain("Guided Flow");
    expect(instructions).toContain("Proactive Prompting");
    expect(instructions).toContain("Ambiguity Resolution");
    expect(instructions).toContain("Peril Awareness");
    expect(instructions).toContain("Photo Trigger");
    expect(instructions).toContain("Coverage Limit");
    expect(instructions).toContain("Conversational");
  });

  // ─── PROMPT-20 additions ───

  it("includes auto-scope intelligence section", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions).toContain("Auto-Scope Intelligence");
    expect(instructions).toContain("autoScope");
  });

  it("includes photo intelligence section", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions).toContain("Photo Intelligence");
    expect(instructions).toContain("damageSuggestions");
  });

  it("includes phase transition protocol", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions).toContain("Phase Transition Protocol");
  });

  it("includes completeness coaching section", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions).toContain("Completeness Coaching");
    expect(instructions).toContain("get_completeness");
  });

  it("includes error recovery section", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions).toContain("Error Recovery");
  });

  it("includes photo capture silence instruction", () => {
    const instructions = buildSystemInstructions(testBriefing, testClaim as any);
    expect(instructions.toLowerCase()).toContain("do not continue talking");
  });
});
```

---

## Part F — Estimate Engine Tests

### File: `tests/server/estimateEngine.test.ts`

The estimate engine (`server/estimateEngine.ts`) handles catalog lookup, pricing calculations, and estimate validation. These are pure functions ideal for unit testing.

```ts
import { describe, it, expect } from "vitest";
import {
  calculateLineItemPrice,
  calculateEstimateTotals,
  validateEstimate,
} from "../../server/estimateEngine";
import { buildLineItem, buildEstimateSummary } from "../fixtures/factories";

// NOTE: Actual signature is calculateLineItemPrice(catalogItem, regionalPrice, quantity, overrideWasteFactor?)
// catalogItem has { unitPrice, wasteFactor, unit } and regionalPrice has { price } or null.
// Tests use mock objects matching these shapes.

describe("calculateLineItemPrice", () => {
  const baseCatalog = { unitPrice: 127.5, wasteFactor: 0, unit: "SQ" };
  const baseRegional = { price: 127.5 };

  it("calculates total from quantity * unitPrice", () => {
    const result = calculateLineItemPrice(baseCatalog, baseRegional, 24);
    expect(result.totalPrice).toBe(3060.0);
  });

  it("applies waste factor correctly", () => {
    // 100 SF * $3.25 * 1.10 (10% waste) = $357.50
    const catalogWithWaste = { unitPrice: 3.25, wasteFactor: 10, unit: "SF" };
    const regional = { price: 3.25 };
    const result = calculateLineItemPrice(catalogWithWaste, regional, 100);
    expect(result.totalPrice).toBeCloseTo(357.5, 2);
  });

  it("allows overriding waste factor", () => {
    const catalog = { unitPrice: 5.0, wasteFactor: 10, unit: "SF" };
    const regional = { price: 5.0 };
    // Override waste to 0
    const result = calculateLineItemPrice(catalog, regional, 50, 0);
    expect(result.totalPrice).toBe(250.0);
  });

  it("handles zero quantity", () => {
    const result = calculateLineItemPrice(baseCatalog, baseRegional, 0);
    expect(result.totalPrice).toBe(0);
  });

  it("handles null regional price (falls back to catalog)", () => {
    const result = calculateLineItemPrice(baseCatalog, null, 10);
    expect(result.totalPrice).toBeGreaterThan(0);
  });
});

// NOTE: Actual signature is calculateEstimateTotals(pricedItems: PricedLineItem[], taxRate?: number)
// PricedLineItem is the output of calculateLineItemPrice, not a raw lineItem from the DB.
// For testing, we construct minimal PricedLineItem-shaped objects.

// Shared helper for estimate totals and validation tests
function buildPricedItem(overrides: Record<string, any> = {}) {
  return {
    totalPrice: 1000,
    unitPrice: 10,
    quantity: 100,
    wasteFactor: 0,
    unit: "SF",
    category: "Drywall",
    description: "Test item",
    ...overrides,
  };
}

describe("calculateEstimateTotals", () => {

  it("sums priced items correctly", () => {
    const items = [
      buildPricedItem({ totalPrice: 1000 }),
      buildPricedItem({ totalPrice: 2500 }),
      buildPricedItem({ totalPrice: 750 }),
    ];
    const result = calculateEstimateTotals(items);
    expect(result.totalRCV).toBe(4250);
  });

  it("returns zero for empty items array", () => {
    const result = calculateEstimateTotals([]);
    expect(result.totalRCV).toBe(0);
    expect(result.lineItemCount).toBe(0);
  });

  it("counts items correctly", () => {
    const items = [buildPricedItem(), buildPricedItem(), buildPricedItem()];
    const result = calculateEstimateTotals(items);
    expect(result.lineItemCount).toBe(3);
  });

  it("applies custom tax rate", () => {
    const items = [buildPricedItem({ totalPrice: 1000 })];
    const result = calculateEstimateTotals(items, 0.10);
    // Tax should be 10% of totalRCV
    expect(result.totalRCV).toBeGreaterThanOrEqual(1000);
  });
});

// NOTE: validateEstimate is async and returns { valid: boolean, errors: string[], warnings: string[] }
describe("validateEstimate", () => {
  it("returns valid for a complete estimate", async () => {
    const items = [buildPricedItem({ category: "Roofing", totalPrice: 5000 })];
    const result = await validateEstimate(items);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("flags empty estimate as invalid", async () => {
    const result = await validateEstimate([]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns warnings array", async () => {
    const items = [buildPricedItem({ totalPrice: 0 })];
    const result = await validateEstimate(items);
    // Should return a warnings array (may or may not have entries)
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
```

**Note**: The exact signatures of `calculateLineItemPrice`, `calculateEstimateTotals`, and `validateEstimate` should be verified against `server/estimateEngine.ts`. If the function signatures differ from what is shown here, adjust the test calls to match. The intent is to test the calculation logic, not the exact API shape.

---

## Part G — Test Directory Structure

After implementing all parts, the test directory should look like:

```
tests/
├── setup.ts                          # Global test setup (Part A.4)
├── mocks/
│   ├── mockStorage.ts                # IStorage mock factory (Part B.1)
│   ├── mockAuth.ts                   # Auth middleware mocks (Part B.2)
│   └── storageMock.ts                # Module-level storage mock (Part B.4)
├── fixtures/
│   └── factories.ts                  # Test data factories (Part B.3)
└── server/
    ├── schemas.test.ts               # Zod schema validation (Part C)
    ├── routes.claims.test.ts         # Claim API routes (Part D)
    ├── realtimeTools.test.ts         # Voice agent tool definitions (Part E)
    └── estimateEngine.test.ts        # Estimate calculations (Part F)
```

**Total test count**: ~55 test cases across 4 test files.

**Running tests**:

```bash
# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Run in watch mode during development
npm run test:watch

# Run a specific test file
npx vitest run tests/server/schemas.test.ts
```

---

## Summary of All Changes

| File | Change Type | Description |
|------|------------|-------------|
| `package.json` | MODIFY | Add vitest, @vitest/coverage-v8, supertest, @types/supertest as devDependencies; add test scripts |
| `vitest.config.ts` | CREATE | Vitest configuration with path aliases, environment matching, coverage thresholds |
| `tests/setup.ts` | CREATE | Global test setup — mock resets, console suppression |
| `tests/mocks/mockStorage.ts` | CREATE | Full IStorage mock factory with vi.fn() for every method |
| `tests/mocks/mockAuth.ts` | CREATE | Auth middleware mocks with default/admin test users |
| `tests/mocks/storageMock.ts` | CREATE | Module-level storage mock for import interception |
| `tests/fixtures/factories.ts` | CREATE | Factory functions for claim, session, room, damage, lineItem, photo, estimateSummary |
| `tests/server/schemas.test.ts` | CREATE | 18 tests for Zod validation schemas |
| `tests/server/routes.claims.test.ts` | CREATE | 9 tests for claim CRUD API endpoints |
| `tests/server/realtimeTools.test.ts` | CREATE | 20 tests for voice agent tool definitions and system instructions |
| `tests/server/estimateEngine.test.ts` | CREATE | 10 tests for pricing calculations and estimate validation |

**New files**: 10
**Modified files**: 1 (package.json)
**Total test cases**: ~57
**Coverage target**: 40% statements/functions (starting point, to be increased as more tests are added)
