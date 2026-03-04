# PRD: My Day — Daily Workflow Optimization Platform

**Product**: Claims IQ Voice Inspector
**Feature**: My Day Hub, Route Optimization, SLA Engine, MS365 Calendar Integration
**Version**: 1.0
**Date**: March 4, 2026

---

## 1. Executive Summary

Transform the insurance adjuster's daily experience from a static claims list into a dynamic, optimized daily workflow hub called **"My Day."** This feature suite adds intelligent route optimization, SLA tracking with urgency scoring, scheduling with calendar integration, and a map-based route view — turning the app into a full end-to-end daily operations platform.

---

## 2. Goals & Success Metrics

| Goal | Metric |
|------|--------|
| Reduce daily planning time | < 2 min to see full day plan vs. manual lookup |
| Improve route efficiency | Optimized route reduces total drive distance |
| Prevent SLA breaches | Proactive warnings at 24h, 8h, 1h thresholds |
| Calendar unification | Inspections appear in Outlook automatically |

---

## 3. Navigation Redesign

### 3.1 New Layout

```
Top Header:  [Logo]  [Search]           [🔔 Bell] [⚙ Settings] [Avatar]
Bottom Nav:  [My Day]  [Claims]  [🎤 Inspect]  [Capture]  [Review]
```

### 3.2 Route Mapping

| Tab | Route | Page | Notes |
|-----|-------|------|-------|
| My Day | `/` | `MyDay.tsx` | New home screen, replaces old Claims list |
| Claims | `/claims` | `ClaimsList.tsx` | Full claims list, title "All Claims" |
| Inspect | `/briefing/:id` or `/inspection/:id` | Context-dependent | Prominent center button (mic icon) |
| Capture | `/capture` | `PhotoLab.tsx` | Photo capture/analysis |
| Review | `/inspection/:id/review` | Review page | Estimate review/export |

### 3.3 Settings Relocation

Move Settings out of bottom nav and into the top header as a gear icon (⚙). Settings page remains at `/settings` but is accessed from the header, not the bottom nav.

---

## 4. Data Model Changes

### 4.1 New Fields on `claims` Table

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `priority` | `varchar(20)` | `'normal'` | `critical`, `high`, `normal`, `low` |
| `scheduled_date` | `varchar(20)` | null | ISO date string `YYYY-MM-DD` |
| `scheduled_time_slot` | `varchar(20)` | null | Time string e.g. `09:00`, `14:30` |
| `sla_deadline` | `timestamp` | null | Calculated SLA expiration datetime |
| `latitude` | `real` | null | Geocoded latitude |
| `longitude` | `real` | null | Geocoded longitude |
| `estimated_duration_min` | `integer` | `60` | Expected inspection duration in minutes |
| `route_order` | `integer` | null | Position in optimized daily route (1-based) |
| `calendar_event_id` | `varchar(255)` | null | MS365 Outlook calendar event ID |

### 4.2 New Table: `daily_itineraries`

Stores the optimized route plan per adjuster per day.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | `serial` | PK | |
| `user_id` | `varchar` | FK → users, NOT NULL | Adjuster |
| `date` | `varchar(20)` | NOT NULL | ISO date `YYYY-MM-DD` |
| `claim_ids` | `jsonb` | NOT NULL, default `[]` | Ordered array of claim IDs |
| `route_data` | `jsonb` | nullable | Full optimized route object (stops, distances, times) |
| `optimized_at` | `timestamp` | nullable | When route was last optimized |
| `created_at` | `timestamp` | default now | |

**Unique constraint**: `(user_id, date)` — one itinerary per adjuster per day.

### 4.3 New Table: `adjuster_notifications`

Persistent notification storage for SLA warnings, schedule changes, etc.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | `serial` | PK | |
| `user_id` | `varchar` | FK → users, NOT NULL | Recipient |
| `type` | `varchar(30)` | NOT NULL | `sla_critical`, `sla_warning`, `sla_approaching`, `schedule`, etc. |
| `title` | `text` | NOT NULL | Short title |
| `message` | `text` | NOT NULL | Full message body |
| `claim_id` | `integer` | FK → claims, nullable | Related claim |
| `read` | `boolean` | default `false` | |
| `created_at` | `timestamp` | default now | |

**Indexes**: `(user_id)`, `(user_id, read)` for fast unread queries.

### 4.4 New Table: `ms365_tokens`

Stores OAuth 2.0 tokens for Microsoft 365 Outlook calendar integration.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | `serial` | PK | |
| `user_id` | `varchar` | FK → users, UNIQUE | One token per user |
| `access_token` | `text` | NOT NULL | OAuth access token |
| `refresh_token` | `text` | NOT NULL | OAuth refresh token |
| `expires_at` | `timestamp` | NOT NULL | Token expiration |
| `scope` | `text` | nullable | Granted scopes |
| `created_at` | `timestamp` | default now | |
| `updated_at` | `timestamp` | default now | |

---

## 5. Backend Services

### 5.1 Geocoding Service

**File**: `server/geocodingService.ts`

Converts property addresses to latitude/longitude coordinates using the free OpenStreetMap Nominatim API.

**Key behaviors**:
- Rate-limited to 1 request per 1.1 seconds (Nominatim policy)
- User-Agent header required (e.g., `ClaimsIQ/1.0`)
- Constructs query from `propertyAddress + city + state + zip`
- Restricted to US addresses (`countrycodes=us`)
- Returns `{ latitude, longitude, displayName }` or `null`

**Integration points**:
- Auto-geocode when a claim is created (if address is present)
- Backfill endpoint for existing claims without coordinates

**API**:
```
geocodeAddress(address, city?, state?, zip?) → { latitude, longitude, displayName } | null
geocodeClaimAddress(claim) → { latitude, longitude } | null
```

### 5.2 SLA Engine

**File**: `server/slaEngine.ts`

Computes urgency scores (0–100) and assigns priority levels and SLA deadlines to claims.

**Urgency Score Calculation**:
- Base score from peril type (50% weight):
  ```
  water: 90, fire: 85, flood: 80, tornado: 75, hurricane: 75,
  collapse: 70, vandalism: 50, hail: 40, wind: 40, lightning: 35,
  theft: 30, other: 20
  ```
- Time-since-loss bonus:
  - < 24 hours: +30
  - < 3 days: +20
  - < 7 days: +10
  - > 14 days: +5 (aging penalty)
- Mitigation urgency: water/flood perils get +10
- Score capped at 0–100

**Priority Mapping**:
| Score Range | Priority | SLA Hours |
|-------------|----------|-----------|
| 80–100 | `critical` | 24 hours |
| 60–79 | `high` | 48 hours |
| 30–59 | `normal` | 72 hours |
| 0–29 | `low` | 120 hours |

**Auto-SLA Assignment**: `applySlaToClaimData()` is called during claim creation to auto-assign `priority` and `slaDeadline` if not already set.

**Notification Generation**: `generateSlaNotifications(userId)` scans active claims and creates persistent notifications at these thresholds:
| Threshold | Type | Title |
|-----------|------|-------|
| < 1 hour | `sla_critical` | "SLA Critical" |
| < 8 hours | `sla_warning` | "SLA Warning" |
| < 24 hours | `sla_approaching` | "SLA Approaching" |

Deduplication: Checks existing notifications by `claimId:type` key before creating.

### 5.3 Route Optimizer

**File**: `server/routeOptimizer.ts`

Solves the Traveling Salesman Problem (TSP) using a priority-weighted nearest-neighbor heuristic.

**Algorithm**:
1. Filter claims to only those with valid lat/lng coordinates
2. Sort by priority weight (critical=4, high=3, normal=2, low=1)
3. Start from provided location or highest-priority claim
4. Greedy nearest-neighbor: at each step, pick the unvisited claim that minimizes `distance / priorityWeight`
5. Calculate total distance (Haversine formula, Earth radius = 6,371 km) and estimated drive times

**Drive time estimation**: `distance_km / 50 km/h * 60` (assumes 50 km/h average speed)

**Output**:
```typescript
interface OptimizedRoute {
  stops: RouteStop[];        // Ordered stops with claimId, lat/lng, duration, priority, order
  totalDistanceKm: number;
  totalDriveTimeMin: number;
  totalDurationMin: number;  // Drive time + sum of inspection durations
}
```

**Additional utility**: `getDriveTimes(claims, startLocation?)` returns per-stop drive time and distance without reordering.

### 5.4 MS365 Service

**File**: `server/ms365Service.ts`

Full Microsoft 365 Outlook Calendar integration via OAuth 2.0 and Microsoft Graph API.

**Required Environment Variables**:
| Variable | Description |
|----------|-------------|
| `MS365_CLIENT_ID` | Azure AD application (client) ID |
| `MS365_CLIENT_SECRET` | Azure AD client secret |
| `MS365_TENANT_ID` | Azure AD tenant ID (optional, uses `/common` by default) |
| `MS365_REDIRECT_URI` | OAuth callback URL (auto-detected from REPLIT_DOMAINS if not set) |

**OAuth Flow**:
1. Frontend calls `GET /api/ms365/connect` → receives `authUrl`
2. User redirected to Microsoft login
3. Callback at `GET /api/ms365/callback` exchanges code for tokens
4. Tokens stored in `ms365_tokens` table
5. Auto-refresh: tokens refreshed if < 5 minutes from expiration

**Required Scopes**: `Calendars.ReadWrite`, `User.Read`, `offline_access`

**Calendar Operations**:
| Function | Graph API Endpoint | Description |
|----------|-------------------|-------------|
| `getCalendarEvents` | `GET /me/calendarView` | List events in date range |
| `createCalendarEvent` | `POST /me/events` | Create new event |
| `updateCalendarEvent` | `PATCH /me/events/{id}` | Update event |
| `deleteCalendarEvent` | `DELETE /me/events/{id}` | Delete event |
| `getFreeBusy` | Derived from events | Get busy time slots |
| `getUserProfile` | `GET /me` | Get user display name and email |

**Claim-Calendar Sync**:
- `syncClaimToCalendar(userId, claimId, subject, start, end, location?)` → creates or updates Outlook event, stores `calendarEventId` on claim
- `removeClaimFromCalendar(userId, claimId)` → deletes Outlook event, clears `calendarEventId`
- Events are tagged with category `"Claims IQ"` for easy filtering

---

## 6. API Endpoints

### 6.1 My Day API (`/api/myday`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/today` | Required | Full daily dashboard: claims with urgency, itinerary, stats, notification count, MS365 status |
| `GET` | `/stats` | Required | Quick stats: today/week/overall counts |
| `GET` | `/claims-for-date/:date` | Required | Claims scheduled for a specific date with urgency |
| `GET` | `/week/:startDate` | Required | 7-day view: array of `{ date, claims[] }` for each day |

**`GET /today` Response Shape**:
```json
{
  "date": "2026-03-04",
  "claims": [
    {
      "id": 23,
      "claimNumber": "CLM-2026-56580",
      "insuredName": "JIMMY DON JEAN",
      "propertyAddress": "4019 S BANNANA Dr",
      "city": "Ozark",
      "state": "MO",
      "priority": "urgent",
      "scheduledTimeSlot": "10:30",
      "estimatedDurationMin": 90,
      "slaDeadline": "2026-03-05T19:55:07.605Z",
      "latitude": 37.0209,
      "longitude": -93.206,
      "status": "inspecting",
      "urgency": {
        "score": 45,
        "priority": "normal",
        "hoursRemaining": 23.5,
        "isOverdue": false
      }
    }
  ],
  "itinerary": { "id": 1, "claimIds": [8, 23, 30, 25, 28], "routeData": {...} },
  "stats": {
    "totalScheduled": 5,
    "completed": 0,
    "remaining": 5,
    "totalActive": 5,
    "slaWarnings": 1,
    "overdue": 0
  },
  "unreadNotifications": 2,
  "ms365": { "connected": false, "email": null }
}
```

### 6.2 Itinerary API (`/api/itinerary`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/today` | Required | Today's stops with drive times |
| `GET` | `/:date` | Required | Stops for specific date with drive times |
| `POST` | `/optimize` | Required | Run route optimization, persist results |
| `POST` | `/schedule` | Required | Schedule a claim to a date/time |
| `POST` | `/unschedule/:claimId` | Required | Remove scheduling from a claim |

**`POST /optimize` Request**:
```json
{
  "date": "2026-03-04",
  "startLatitude": 39.0,    // optional: adjuster's current location
  "startLongitude": -104.0   // optional
}
```

**`POST /schedule` Request**:
```json
{
  "claimId": 23,
  "date": "2026-03-04",
  "timeSlot": "10:30",           // optional
  "priority": "high",            // optional: critical|high|normal|low
  "estimatedDurationMin": 90     // optional
}
```

**Authorization**: Schedule/unschedule check ownership — only the assigned adjuster, admins, or supervisors can modify scheduling.

### 6.3 MS365 API (`/api/ms365`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/status` | Required | Connection status + configured flag |
| `GET` | `/connect` | Required | Get OAuth authorization URL |
| `GET` | `/callback` | None | OAuth callback (redirects to /settings) |
| `POST` | `/disconnect` | Required | Remove MS365 tokens |
| `GET` | `/calendar/events?startDate&endDate` | Required | List calendar events |
| `POST` | `/calendar/events` | Required | Create calendar event |
| `PATCH` | `/calendar/events/:eventId` | Required | Update calendar event |
| `DELETE` | `/calendar/events/:eventId` | Required | Delete calendar event |
| `GET` | `/calendar/freebusy?startDate&endDate` | Required | Get busy time slots |
| `POST` | `/calendar/sync-claim` | Required | Sync claim → Outlook event |
| `POST` | `/calendar/unsync-claim` | Required | Remove claim from Outlook |

**OAuth Callback Flow**:
```
GET /api/ms365/connect → { authUrl }
  ↓ (redirect user)
Microsoft Login → authorization code
  ↓
GET /api/ms365/callback?code=xxx&state=yyy
  ↓ (exchange code for tokens, store in DB)
Redirect → /settings?ms365_connected=true
```

**State security**: Random 16-byte hex token with 10-minute expiration, stored server-side in a Map keyed by state value.

### 6.4 Notifications API (`/api/notifications`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | Required | Get all notifications (includes transient + persistent) |
| `POST` | `/persistent` | Required | Create a persistent notification |
| `GET` | `/persistent` | Required | Get persistent notifications (from DB) |
| `PATCH` | `/persistent/:id/read` | Required | Mark one notification as read |
| `POST` | `/persistent/mark-all-read` | Required | Mark all notifications as read |

---

## 7. Storage Interface Methods

These are the new CRUD methods required on the storage layer:

```typescript
interface IStorage {
  // Claims scheduling
  getClaimsForUser(userId: string): Promise<Claim[]>;
  getClaimsForDate(userId: string, date: string): Promise<Claim[]>;
  updateClaimScheduling(id: number, fields: Partial<Pick<Claim,
    'scheduledDate' | 'scheduledTimeSlot' | 'priority' | 'slaDeadline' |
    'estimatedDurationMin' | 'calendarEventId'
  >>): Promise<Claim | undefined>;
  updateClaimRouteOrder(id: number, routeOrder: number): Promise<Claim | undefined>;

  // Daily itineraries
  createItinerary(data: InsertDailyItinerary): Promise<DailyItinerary>;
  getItinerary(userId: string, date: string): Promise<DailyItinerary | undefined>;
  updateItinerary(id: number, data: Partial<InsertDailyItinerary>): Promise<DailyItinerary | undefined>;

  // Notifications
  createNotification(data: InsertAdjusterNotification): Promise<AdjusterNotification>;
  getNotifications(userId: string, unreadOnly?: boolean): Promise<AdjusterNotification[]>;
  markNotificationRead(id: number): Promise<AdjusterNotification | undefined>;

  // MS365 tokens
  saveMs365Token(userId: string, tokenData: {...}): Promise<Ms365Token>;
  getMs365Token(userId: string): Promise<Ms365Token | undefined>;
  deleteMs365Token(userId: string): Promise<void>;
}
```

**Key query patterns**:
- `getClaimsForDate`: `WHERE assigned_to = $userId AND scheduled_date = $date ORDER BY route_order`
- `getItinerary`: `WHERE user_id = $userId AND date = $date LIMIT 1`
- `getNotifications(unreadOnly=true)`: `WHERE user_id = $userId AND read = false ORDER BY created_at DESC`
- `saveMs365Token`: Upsert — update if exists for user, insert if not

---

## 8. Frontend Components

### 8.1 My Day Page (`client/src/pages/MyDay.tsx`)

The primary hub replacing the old home screen. Contains:

**Context Bar** (always visible at top):
- Greeting with time-of-day logic (morning/afternoon/evening)
- Current date formatted as "Wednesday, March 4, 2026"
- Weather placeholder (icon + temp)
- MS365 connection status badge (green "Connected" / gray "Disconnected")

**Stats Row** (3 equal-width cards):
- Claims Today (blue calendar icon + count)
- Completed (green check icon + count)
- SLA Warnings (amber alert icon + count of warnings + overdue)

**Sub-Tab Bar**: Three tabs managed by local React state:
- **Itinerary** (default) — `ListChecks` icon
- **Route Map** — `Map` icon
- **Schedule** — `CalendarDays` icon

**Data source**: `GET /api/myday/today` via React Query, key `["/api/myday/today"]`

### 8.2 Itinerary Tab (inline in MyDay.tsx)

Timeline-style ordered list of today's claims:

- Vertical timeline line on the left
- Colored dot per claim (red=critical, orange=high, blue=normal, gray=low)
- Each card shows:
  - Claim number + priority badge
  - Insured name
  - Address with map pin icon
  - Scheduled time slot (right side)
  - Estimated duration
  - SLA countdown ("23h remaining" or "OVERDUE" in red)
- "Optimize Route" button at top triggers `POST /api/itinerary/optimize`
- Empty state: centered illustration with "No claims scheduled" message
- Loading state: 3 pulsing skeleton rectangles
- Click card → navigates to `/briefing/:claimId`

### 8.3 Route Map (`client/src/components/RouteMap.tsx`)

Interactive map using **Leaflet + react-leaflet** with **OpenStreetMap** tiles (free, no API key needed).

**Map features**:
- Numbered circle markers color-coded by priority
- Dashed blue polyline connecting stops in route order
- User's current location (pulsing blue dot) via browser Geolocation API
- Auto-fit bounds to show all markers + user location
- Click marker → popup with:
  - Claim number, insured name, address, scheduled time
  - "Navigate" link → opens Google Maps directions in new tab
- "Optimize" button overlaid top-right

**Leaflet icon fix**: Must override default icon URLs for Webpack/Vite compatibility:
```javascript
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/.../marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/.../marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/.../marker-shadow.png",
});
```

**Dependencies**: `leaflet`, `react-leaflet`, `@types/leaflet`

### 8.4 Schedule View (`client/src/components/ScheduleView.tsx`)

Week-at-a-glance calendar grid.

**Layout**: 7 equal columns (Mon–Sun), each column is a day
**Navigation**: Previous/Next week buttons + "Today" button
**Data source**: `GET /api/myday/week/:startDate` (Monday of selected week)

Each day column:
- Header: Day label (Mon, Tue, etc.) + short date (Mar 4)
- Today's column highlighted with blue background
- Claim cards stacked vertically showing:
  - Priority color dot
  - Time slot
  - Claim number (truncated)
  - Insured name (truncated at 15 chars)
- Empty days show "No inspections" text
- Click card → navigates to `/briefing/:claimId`

### 8.5 Bottom Navigation (`client/src/components/BottomNav.tsx`)

5-tab bottom navigation bar:

| Position | Icon | Label | Route Logic |
|----------|------|-------|-------------|
| 1 | `CalendarDays` | My Day | Always `/` |
| 2 | `List` | Claims | Always `/claims` |
| 3 (center, prominent) | `Mic` | Inspect | Context-aware: `/inspection/:id` if inspecting, `/briefing/:id` otherwise |
| 4 | `Camera` | Capture | Always `/capture` |
| 5 | `ClipboardCheck` | Review | `/inspection/:id/review` |

**Inspect button**: Elevated circular button (-mt-5 offset), filled background, larger icon. Active claim detected from current URL path or falls back to first claim.

**Active state**: Primary color icon + text + small underline indicator bar.

### 8.6 MS365 Settings UI

In the Settings page (`/settings`):
- MS365 connection card showing:
  - Status (Connected/Disconnected)
  - Connected email if available
  - "Connect to Outlook" button → calls `GET /api/ms365/connect`, redirects to auth URL
  - "Disconnect" button → calls `POST /api/ms365/disconnect`
- Query param handling: `?ms365_connected=true` shows success toast, `?ms365_error=...` shows error

---

## 9. Security Considerations

### 9.1 Authentication

All new API routes use the `authenticateRequest` middleware. Access the user via `req.user!.id` (never `(req as any).userId`).

### 9.2 Authorization (IDOR Prevention)

- **Schedule/Unschedule**: Verify `claim.assignedTo === req.user.id` OR user role is `admin`/`supervisor`
- **Notifications mark-read**: Verify notification belongs to `req.user.id`
- **MS365 operations**: All scoped to `req.user.id` automatically via token lookup

### 9.3 OAuth State

MS365 OAuth state tokens:
- 16 random bytes (hex encoded)
- 10-minute expiration
- Server-side Map storage (in-memory) — delete after use

---

## 10. Third-Party Dependencies

| Dependency | Purpose | License | Cost |
|------------|---------|---------|------|
| Nominatim (OpenStreetMap) | Geocoding | ODbL | Free (1 req/sec limit) |
| OpenStreetMap tiles | Map rendering | ODbL | Free |
| Leaflet + react-leaflet | Map library | BSD-2-Clause | Free |
| Microsoft Graph API | Calendar CRUD | Commercial | Free with M365 license |
| Haversine formula | Distance calc | N/A (math) | Free |

**No paid API keys required** for geocoding or maps. MS365 requires an Azure AD app registration (free tier available).

---

## 11. Azure AD App Registration Setup

To enable MS365 calendar integration:

1. Go to [Azure Portal](https://portal.azure.com) → Azure Active Directory → App registrations
2. New registration:
   - Name: "Claims IQ Calendar"
   - Supported account types: "Accounts in any organizational directory"
   - Redirect URI: `https://your-domain.com/api/ms365/callback`
3. Under "Certificates & secrets" → New client secret → copy value
4. Under "API permissions" → Add:
   - `Calendars.ReadWrite` (Delegated)
   - `User.Read` (Delegated)
   - `offline_access` (Delegated)
5. Set environment variables:
   ```
   MS365_CLIENT_ID=<Application (client) ID>
   MS365_CLIENT_SECRET=<Client secret value>
   MS365_REDIRECT_URI=https://your-domain.com/api/ms365/callback
   ```

---

## 12. Implementation Order (Recommended)

```
Wave 1 (Parallel):
  ├── T001: Schema changes (new columns + 3 tables)
  └── T002: Navigation reorganization (BottomNav, Layout, routing)

Wave 2 (Parallel, after T001):
  ├── T003: Geocoding service
  ├── T005: SLA engine
  ├── T006: Storage interface (all new CRUD methods)
  └── T007: MS365 OAuth + Calendar service

Wave 3 (after T003):
  └── T004: Route optimization engine

Wave 4 (after T004, T005, T006, T007):
  └── T008: My Day API endpoints

Wave 5 (Parallel, after T002 + T008):
  ├── T009: My Day UI with Itinerary tab
  ├── T012: Notification system expansion
  └── T013: MS365 Settings UI

Wave 6 (Parallel, after T009):
  ├── T010: Schedule sub-tab
  └── T011: Route Map sub-tab
```

---

## 13. Data Seeding / Migration Notes

After deploying schema changes, existing claims will have null values for all new fields. Required steps:

1. **Geocode existing claims**: Hit the backfill endpoint or run geocoding in batch for all claims with addresses but no coordinates
2. **Compute SLA for existing claims**: Run `applySlaToClaimData` across active claims to set initial `priority` and `slaDeadline`
3. **Schedule claims**: Claims must be explicitly scheduled (set `scheduled_date` and `scheduled_time_slot`) to appear in My Day — they don't auto-populate
4. **Create initial itineraries**: Run route optimization for each adjuster's first scheduled day

---

## 14. Wire Protocol Summary

For quick reference, here are all new API endpoints in one table:

| Method | Endpoint | Request Body / Query | Response |
|--------|----------|---------------------|----------|
| `GET` | `/api/myday/today` | — | `{ date, claims[], itinerary, stats, unreadNotifications, ms365 }` |
| `GET` | `/api/myday/stats` | — | `{ today, week, overall }` |
| `GET` | `/api/myday/claims-for-date/:date` | — | `Claim[]` with urgency |
| `GET` | `/api/myday/week/:startDate` | — | `{ startDate, days[] }` |
| `GET` | `/api/itinerary/today` | — | `{ date, stops[], itinerary, totalClaims }` |
| `GET` | `/api/itinerary/:date` | — | `{ date, stops[], itinerary, totalClaims }` |
| `POST` | `/api/itinerary/optimize` | `{ date, startLatitude?, startLongitude? }` | `{ route }` |
| `POST` | `/api/itinerary/schedule` | `{ claimId, date, timeSlot?, priority?, estimatedDurationMin? }` | Updated claim |
| `POST` | `/api/itinerary/unschedule/:claimId` | — | Updated claim |
| `GET` | `/api/ms365/status` | — | `{ configured, connected, email?, displayName? }` |
| `GET` | `/api/ms365/connect` | — | `{ authUrl }` |
| `GET` | `/api/ms365/callback` | `?code&state` | Redirect |
| `POST` | `/api/ms365/disconnect` | — | `{ disconnected: true }` |
| `GET` | `/api/ms365/calendar/events` | `?startDate&endDate` | `CalendarEvent[]` |
| `POST` | `/api/ms365/calendar/events` | `{ subject, startDateTime, endDateTime, timeZone?, location?, body? }` | Created event |
| `PATCH` | `/api/ms365/calendar/events/:eventId` | `{ subject?, startDateTime?, endDateTime?, location? }` | Updated event |
| `DELETE` | `/api/ms365/calendar/events/:eventId` | — | `{ deleted: true }` |
| `GET` | `/api/ms365/calendar/freebusy` | `?startDate&endDate` | `FreeBusySlot[]` |
| `POST` | `/api/ms365/calendar/sync-claim` | `{ claimId, subject, startDateTime, endDateTime, location? }` | `{ eventId }` |
| `POST` | `/api/ms365/calendar/unsync-claim` | `{ claimId }` | `{ removed: true }` |
| `GET` | `/api/notifications/persistent` | — | `AdjusterNotification[]` |
| `POST` | `/api/notifications/persistent` | `{ type, title, message, claimId? }` | Created notification |
| `PATCH` | `/api/notifications/persistent/:id/read` | — | Updated notification |
| `POST` | `/api/notifications/persistent/mark-all-read` | — | `{ updated: n }` |
