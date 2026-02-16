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
| `npm run seed:demo` | Seed demo data |
| `npm run seed:demo:clean` | Reset and re-seed demo data |
| `npm run seed:all` | Seed demo data (run pricing seed separately) |

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
│   ├── routes.ts           # API endpoints
│   ├── auth.ts             # Auth middleware
│   ├── storage.ts          # DatabaseStorage (IStorage implementation)
│   ├── realtime.ts         # OpenAI Realtime API integration
│   ├── estimateEngine.ts   # Pricing calculation engine
│   ├── esxGenerator.ts     # Xactimate ESX export
│   ├── aiReview.ts         # AI estimate review
│   ├── supabase.ts         # Supabase client + bucket config
│   ├── openai.ts           # OpenAI client + extraction
│   ├── logger.ts           # Pino structured logging
│   └── sanitize.ts         # Input sanitization utilities
├── shared/
│   └── schema.ts           # Drizzle ORM schema
├── script/
│   ├── seed-demo.ts        # Demo data generator
│   └── seed-catalog.ts     # Pricing catalog seed
├── docs/
│   └── openapi.yaml        # OpenAPI 3.0 specification
├── tests/                  # Vitest test suites
├── migrations/             # Drizzle migration files
└── .env.example            # Environment variable template
```

### API Documentation

Interactive API docs are available at `/docs` (redirects to `/api-docs/`) when the server is running.

The OpenAPI 3.0 specification is at `docs/openapi.yaml`.

### Authentication

All API endpoints (except `/health`, `/readiness`, and `/api-docs`) require a Supabase JWT token in the `Authorization: Bearer <token>` header.

Auth middleware chain:
1. `authenticateRequest` — Validates JWT, attaches user to `req.user`
2. `authenticateSupabaseToken` — Direct Supabase token validation (used by `/api/auth/sync`)
3. `requireRole("role")` — Role gate (adjuster, supervisor, admin)
4. `optionalAuth` — Proceeds with or without auth

### Voice Inspection Flow

1. Start or resume inspection from claim detail
2. WebRTC connects to OpenAI Realtime API
3. Voice agent guides through phases (Pre-Inspection → Setup → Exterior → Interior → Moisture → Evidence → Estimate → Finalize)
4. Tools: add rooms, record damages, capture photos, add line items
5. Session persists to localStorage; resume after tab reload (within 24h)

### Testing

```bash
npm test                 # Run all tests
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage report
```

Tests are in `tests/` (Vitest). Use `test/mocks/` for shared mocks.
