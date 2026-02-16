# PROMPT-22 — Production Hardening: Monitoring, Security & Deployment

## Context

The application is functionally complete through PROMPT-21 but runs exclusively on Replit with minimal production infrastructure. The current state:

- **Logging**: Custom `log()` function (server/index.ts, lines 60–69) that writes timestamped strings to stdout. No structured logging, no log levels, no correlation IDs, no error context.
- **Health checks**: None. No `/health` or `/readiness` endpoints.
- **Security**: Rate limiting exists (lines 29–51) but no Helmet, no explicit CORS, no request sanitization beyond Zod schemas.
- **Database**: Schema pushed directly via `drizzle-kit push` (package.json line 12). No versioned migrations, no `./migrations` directory. Only three unique indexes defined (claims.claimNumber at schema.ts line 47, documents compound at line 66, extractions compound at line 83). No indexes on `sessionId`, `assignedTo`, `status`, or other frequently queried columns.
- **Environment**: No `.env.example`. Variables scattered across `server/db.ts` (lines 5–10), `server/supabase.ts` (lines 3–4), `server/openai.ts` (line 4), and `server/index.ts` (line 117).
- **Deployment**: Replit-only (`.replit` file with autoscale target). No Dockerfile, no CI/CD, no cloud-agnostic deployment.

This prompt makes the system production-ready by adding structured logging, health monitoring, security hardening, proper database migrations, environment documentation, and Docker-based deployment.

**Depends on**: PROMPT-21 (testing), all prior prompts

---

## Part A — Structured Logging with Pino

### A.1 — Install Pino

```bash
npm install pino pino-http
npm install --save-dev pino-pretty
```

**Why Pino**: 30x faster than Winston at structured JSON output, native to the Node.js ecosystem, minimal overhead. `pino-http` provides Express middleware for automatic request/response logging with correlation IDs.

### A.2 — Create Logger Module

Create `server/logger.ts`:

```ts
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  // Redact sensitive fields from logs
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "body.password",
      "body.fileBase64",
      "body.token",
    ],
    censor: "[REDACTED]",
  },
  // Structured serializers
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  // Pretty-print in development
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
});

// Child loggers for specific subsystems
export const dbLogger = logger.child({ subsystem: "database" });
export const authLogger = logger.child({ subsystem: "auth" });
export const aiLogger = logger.child({ subsystem: "ai" });
export const voiceLogger = logger.child({ subsystem: "voice" });
export const storageLogger = logger.child({ subsystem: "storage" });

export default logger;
```

### A.3 — HTTP Request Logging Middleware

Replace the custom request logging middleware in `server/index.ts` (lines 71–84) with pino-http.

Remove the existing middleware:

```ts
// DELETE lines 71-84 in server/index.ts (the custom request logging middleware)
```

Also remove the custom `log()` function (lines 60–69), replacing it:

```ts
// REPLACE lines 60-68 with:
import pinoHttp from "pino-http";
import { logger } from "./logger";

// Re-export for backward compatibility with any code calling log()
export function log(message: string, source = "express") {
  logger.info({ source }, message);
}
```

Add pino-http middleware **after** the JSON body parser (after line 27):

```ts
// INSERT after app.use(express.urlencoded({ extended: false }));

app.use(
  pinoHttp({
    logger,
    // Generate unique request IDs for correlation
    genReqId: (req) => {
      return req.headers["x-request-id"] as string || crypto.randomUUID();
    },
    // Don't log health check requests (noisy in production)
    autoLogging: {
      ignore: (req) => req.url === "/health" || req.url === "/readiness",
    },
    // Custom log level by status code
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    // Customize what gets logged per request
    customSuccessMessage: (req, res) => {
      return `${req.method} ${req.url} ${res.statusCode}`;
    },
    customErrorMessage: (req, res) => {
      return `${req.method} ${req.url} ${res.statusCode} FAILED`;
    },
  })
);
```

### A.4 — Update Error Handler

Replace the global error handler in `server/index.ts` (lines 90–101):

```ts
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const status = err.status || err.statusCode || 500;

  // Structured error logging with request context
  req.log?.error(
    {
      err,
      statusCode: status,
      path: req.path,
      method: req.method,
    },
    `Unhandled error: ${err.message}`
  );

  if (res.headersSent) {
    return next(err);
  }

  const clientMessage =
    status >= 500 ? "Internal server error" : err.message || "An error occurred";
  return res.status(status).json({ message: clientMessage });
});
```

### A.5 — Replace Console Logging in Routes

Throughout `server/routes.ts`, replace the ~30 instances of:

```ts
console.error("Server error:", error);
```

With:

```ts
req.log.error({ err: error }, "Server error");
```

This ensures every error is logged with its request context (request ID, path, method, user) automatically attached by pino-http.

---

## Part B — Health Check Endpoints

### File: `server/routes.ts` — Add Health Endpoints

Insert these routes at the **top** of the `registerRoutes` function (after line 127, before any authenticated routes), so they are accessible without authentication:

```ts
// ─── Health Check Endpoints (no auth required) ───

app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || "unknown",
  });
});

app.get("/readiness", async (_req, res) => {
  const checks: Record<string, { status: string; latencyMs?: number }> = {};

  // Database connectivity check
  try {
    const dbStart = Date.now();
    await storage.getClaims(); // Lightweight query
    checks.database = {
      status: "ready",
      latencyMs: Date.now() - dbStart,
    };
  } catch (e: any) {
    checks.database = { status: "not_ready" };
  }

  // Supabase storage check
  try {
    const storageStart = Date.now();
    const { error } = await supabase.storage.listBuckets();
    checks.storage = {
      status: error ? "not_ready" : "ready",
      latencyMs: Date.now() - storageStart,
    };
  } catch (e: any) {
    checks.storage = { status: "not_ready" };
  }

  // OpenAI connectivity check (lightweight)
  checks.openai = {
    status: process.env.OPENAI_API_KEY ? "configured" : "not_configured",
  };

  const allReady = Object.values(checks).every(
    (c) => c.status === "ready" || c.status === "configured"
  );

  res.status(allReady ? 200 : 503).json({
    status: allReady ? "ready" : "not_ready",
    timestamp: new Date().toISOString(),
    checks,
  });
});
```

**Important**: These endpoints MUST be registered before the rate limiters to avoid counting health checks against the rate limit. Move the health routes above the `app.use("/api/", generalLimiter)` line, or ensure the health paths don't start with `/api/`.

---

## Part C — Security Hardening

### C.1 — Install Security Dependencies

```bash
npm install helmet cors
npm install --save-dev @types/cors
```

### C.2 — Add Helmet Middleware

In `server/index.ts`, add Helmet **before** all other middleware (after the imports, before the JSON parser):

```ts
import helmet from "helmet";
import cors from "cors";

// Security headers
app.use(
  helmet({
    // Allow inline styles for Vite dev server
    contentSecurityPolicy: process.env.NODE_ENV === "production"
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:", "*.supabase.co"],
            connectSrc: [
              "'self'",
              "*.supabase.co",
              "api.openai.com",
              "wss://*.openai.com",
            ],
            mediaSrc: ["'self'", "blob:"],
          },
        }
      : false, // Disable CSP in development (Vite needs inline scripts)
    crossOriginEmbedderPolicy: false, // Required for Supabase storage
  })
);
```

### C.3 — Add CORS Configuration

Add after Helmet:

```ts
app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",")
      : process.env.NODE_ENV === "production"
        ? false // Same-origin only in production by default
        : true, // Allow all origins in development
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    maxAge: 86400, // Cache preflight for 24 hours
  })
);
```

### C.4 — Input Sanitization Utility

Create `server/sanitize.ts`:

```ts
/**
 * Lightweight input sanitization for string fields.
 * Zod handles type validation; this handles content safety.
 */

// Strip null bytes (can break PostgreSQL)
export function sanitizeString(input: string): string {
  return input.replace(/\0/g, "");
}

// Sanitize all string fields in an object (shallow)
export function sanitizeBody<T extends Record<string, any>>(body: T): T {
  const sanitized = { ...body };
  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === "string") {
      (sanitized as any)[key] = sanitizeString(value);
    }
  }
  return sanitized;
}

// Validate and sanitize integer IDs from URL params
export function parseId(param: string): number | null {
  const id = parseInt(param, 10);
  if (isNaN(id) || id <= 0 || id > 2_147_483_647) return null;
  return id;
}
```

Then use `parseId` in routes. Currently (routes.ts line 167), IDs are parsed as:

```ts
const id = parseInt(req.params.id);
```

Replace with:

```ts
import { parseId, sanitizeBody } from "./sanitize";

// In each route that parses an ID:
const id = parseId(req.params.id);
if (id === null) return res.status(400).json({ message: "Invalid ID" });
```

This prevents NaN IDs, negative IDs, and integer overflow attacks.

---

## Part D — Database Migrations & Indexes

### D.1 — Generate Initial Migration

```bash
npx drizzle-kit generate
```

This reads `drizzle.config.ts` (which points to `shared/schema.ts`) and generates SQL migration files in `./migrations/`. The initial migration captures the complete current schema.

Add a migration script to `package.json`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

### D.2 — Add Performance Indexes

Create a new migration file or add to `shared/schema.ts` table definitions. These indexes target the most common query patterns identified in `server/storage.ts` and `server/routes.ts`:

```ts
// ─── Add to shared/schema.ts table definitions ───

// Claims: frequently filtered by assignedTo and status
export const claims = pgTable(
  "claims",
  {
    // ... existing columns ...
  },
  (table) => ({
    claimNumberUnique: uniqueIndex("claims_claim_number_unique").on(table.claimNumber),
    // NEW indexes:
    claimAssignedToIdx: index("claims_assigned_to_idx").on(table.assignedTo),
    claimStatusIdx: index("claims_status_idx").on(table.status),
    claimPerilTypeIdx: index("claims_peril_type_idx").on(table.perilType),
  }),
);

// Inspection Sessions: always queried by claimId
export const inspectionSessions = pgTable(
  "inspection_sessions",
  {
    // ... existing columns ...
  },
  (table) => ({
    sessionClaimIdIdx: index("sessions_claim_id_idx").on(table.claimId),
    sessionStatusIdx: index("sessions_status_idx").on(table.status),
  }),
);

// Rooms: queried by sessionId
export const inspectionRooms = pgTable(
  "inspection_rooms",
  {
    // ... existing columns ...
  },
  (table) => ({
    roomSessionIdIdx: index("rooms_session_id_idx").on(table.sessionId),
  }),
);

// Line Items: queried by sessionId and roomId
export const lineItems = pgTable(
  "line_items",
  {
    // ... existing columns ...
  },
  (table) => ({
    lineItemSessionIdx: index("line_items_session_id_idx").on(table.sessionId),
    lineItemRoomIdx: index("line_items_room_id_idx").on(table.roomId),
    lineItemDamageIdx: index("line_items_damage_id_idx").on(table.damageId),
  }),
);

// Photos: queried by sessionId and roomId
export const inspectionPhotos = pgTable(
  "inspection_photos",
  {
    // ... existing columns ...
  },
  (table) => ({
    photoSessionIdx: index("photos_session_id_idx").on(table.sessionId),
    photoRoomIdx: index("photos_room_id_idx").on(table.roomId),
  }),
);

// Damage Observations: queried by sessionId and roomId
export const damageObservations = pgTable(
  "damage_observations",
  {
    // ... existing columns ...
  },
  (table) => ({
    damageSessionIdx: index("damages_session_id_idx").on(table.sessionId),
    damageRoomIdx: index("damages_room_id_idx").on(table.roomId),
  }),
);
```

**Import required**: Add `index` to the Drizzle imports in `shared/schema.ts` line 2:

```ts
import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar, real, uniqueIndex, index } from "drizzle-orm/pg-core";
```

After adding indexes, generate a new migration:

```bash
npx drizzle-kit generate
```

Then apply:

```bash
npx drizzle-kit migrate
```

### D.3 — Migration Safety Script

Create `scripts/migrate.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Safe migration runner with pre-checks and dry-run support.
 * Usage:
 *   tsx scripts/migrate.ts          # Run migrations
 *   tsx scripts/migrate.ts --dry    # Show pending migrations without applying
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const isDryRun = process.argv.includes("--dry");

async function runMigrations() {
  const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("ERROR: SUPABASE_DATABASE_URL or DATABASE_URL required");
    process.exit(1);
  }

  console.log(`Migration mode: ${isDryRun ? "DRY RUN" : "APPLY"}`);
  console.log(`Database: ${connectionString.split("@")[1]?.split("/")[0] || "configured"}`);

  if (isDryRun) {
    console.log("\nPending migrations would be applied from ./migrations/");
    // List migration files
    const fs = await import("fs");
    const files = fs.readdirSync("./migrations").filter((f: string) => f.endsWith(".sql"));
    if (files.length === 0) {
      console.log("No migration files found.");
    } else {
      files.forEach((f: string) => console.log(`  - ${f}`));
    }
    process.exit(0);
  }

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  try {
    console.log("Running migrations...");
    await migrate(db, { migrationsFolder: "./migrations" });
    console.log("Migrations complete.");
  } catch (error: any) {
    console.error("Migration failed:", error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
```

Add to `package.json` scripts:

```json
"db:migrate:safe": "tsx scripts/migrate.ts",
"db:migrate:dry": "tsx scripts/migrate.ts --dry"
```

---

## Part E — Environment Configuration

### E.1 — Create `.env.example`

Create `.env.example` in the project root:

```env
# ─── Required ───

# Supabase (database + storage)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres

# OpenAI (voice agent + AI analysis)
OPENAI_API_KEY=sk-...

# ─── Optional ───

# Server
PORT=5000                        # HTTP port (default: 5000)
NODE_ENV=development             # development | production
LOG_LEVEL=info                   # trace | debug | info | warn | error | fatal

# Security
CORS_ORIGIN=                     # Comma-separated allowed origins (empty = same-origin in production)

# Database (alternative to SUPABASE_DATABASE_URL)
DATABASE_URL=                    # Direct PostgreSQL connection string
```

### E.2 — Startup Environment Validation

Create `server/env.ts`:

```ts
import { logger } from "./logger";

interface EnvConfig {
  // Required
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DATABASE_URL: string;
  OPENAI_API_KEY: string;
  // Optional with defaults
  PORT: number;
  NODE_ENV: string;
  LOG_LEVEL: string;
  CORS_ORIGIN: string | undefined;
}

export function validateEnvironment(): EnvConfig {
  const errors: string[] = [];

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const databaseUrl = (process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL)?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  if (!supabaseUrl) errors.push("SUPABASE_URL is required");
  if (!supabaseKey) errors.push("SUPABASE_SERVICE_ROLE_KEY is required");
  if (!databaseUrl) errors.push("SUPABASE_DATABASE_URL or DATABASE_URL is required");
  if (!openaiKey) errors.push("OPENAI_API_KEY is required");

  if (errors.length > 0) {
    logger.fatal({ errors }, "Missing required environment variables");
    console.error("\n❌ Missing required environment variables:");
    errors.forEach((e) => console.error(`   - ${e}`));
    console.error("\nSee .env.example for required configuration.\n");
    process.exit(1);
  }

  const config: EnvConfig = {
    SUPABASE_URL: supabaseUrl!,
    SUPABASE_SERVICE_ROLE_KEY: supabaseKey!,
    DATABASE_URL: databaseUrl!,
    OPENAI_API_KEY: openaiKey!,
    PORT: parseInt(process.env.PORT || "5000", 10),
    NODE_ENV: process.env.NODE_ENV || "development",
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    CORS_ORIGIN: process.env.CORS_ORIGIN || undefined,
  };

  logger.info(
    {
      port: config.PORT,
      env: config.NODE_ENV,
      logLevel: config.LOG_LEVEL,
      supabaseProject: config.SUPABASE_URL.split("//")[1]?.split(".")[0] || "unknown",
    },
    "Environment validated"
  );

  return config;
}
```

Call `validateEnvironment()` at the top of `server/index.ts` (before any other initialization):

```ts
// INSERT at top of server/index.ts, after imports:
import { validateEnvironment } from "./env";
const env = validateEnvironment();
```

---

## Part F — Docker & Deployment

### F.1 — Dockerfile

Create `Dockerfile` in the project root:

```dockerfile
# ─── Build Stage ───
FROM node:20-slim AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build client (Vite) and server (esbuild)
RUN npm run build

# ─── Production Stage ───
FROM node:20-slim AS production

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy built output from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations

# Non-root user for security
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-5000}/health || exit 1

# Expose port
EXPOSE ${PORT:-5000}

# Start the server
CMD ["node", "./dist/index.cjs"]
```

### F.2 — Docker Compose

Create `docker-compose.yml`:

```yaml
version: "3.8"

services:
  app:
    build: .
    ports:
      - "${PORT:-5000}:${PORT:-5000}"
    environment:
      - NODE_ENV=production
      - PORT=${PORT:-5000}
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
      - SUPABASE_DATABASE_URL=${SUPABASE_DATABASE_URL}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - LOG_LEVEL=${LOG_LEVEL:-info}
      - CORS_ORIGIN=${CORS_ORIGIN:-}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:${PORT:-5000}/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

### F.3 — Docker Ignore

Create `.dockerignore`:

```
node_modules
.git
.replit
replit.nix
.env
.env.local
*.log
dist
migrations/*.sql.bak
tests
coverage
.vscode
.idea
```

### F.4 — GitHub Actions CI

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"

      - run: npm ci

      - name: Type check
        run: npm run check

      - name: Run tests
        run: npm test

      - name: Run tests with coverage
        run: npm run test:coverage

      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/

  build:
    runs-on: ubuntu-latest
    needs: test

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"

      - run: npm ci
      - run: npm run build

      - name: Build Docker image
        run: docker build -t claims-iq-voice-inspector .
```

---

## Summary of All Changes

| File | Change Type | Description |
|------|------------|-------------|
| `server/logger.ts` | CREATE | Pino logger with subsystem children, redaction, dev pretty-printing |
| `server/index.ts` | MODIFY | Replace custom logging with pino-http, add Helmet, add CORS, add env validation |
| `server/routes.ts` | MODIFY | Add `/health` and `/readiness` endpoints; replace `console.error` with `req.log.error` (~30 instances) |
| `server/sanitize.ts` | CREATE | `sanitizeString`, `sanitizeBody`, `parseId` utilities |
| `server/env.ts` | CREATE | Startup environment variable validation |
| `shared/schema.ts` | MODIFY | Add `index` import; add 11 new database indexes on frequently-queried columns |
| `scripts/migrate.ts` | CREATE | Safe migration runner with dry-run support |
| `.env.example` | CREATE | Documented environment variable template |
| `Dockerfile` | CREATE | Multi-stage build (builder → production), health check, non-root user |
| `docker-compose.yml` | CREATE | Single-service compose with env vars and health check |
| `.dockerignore` | CREATE | Exclude dev files from Docker context |
| `.github/workflows/ci.yml` | CREATE | GitHub Actions: type check → test → build → Docker image |
| `package.json` | MODIFY | Add pino, pino-http, helmet, cors deps; add db:generate, db:migrate, db:migrate:safe, db:migrate:dry scripts |

**New files**: 9
**Modified files**: 4
**New dependencies**: 4 runtime (pino, pino-http, helmet, cors) + 2 dev (pino-pretty, @types/cors)
**New database indexes**: 11
