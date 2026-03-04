# PRD: My Day — Daily Workflow Optimization Platform

**Product**: Claims IQ Voice Inspector
**Feature**: My Day Hub, Route Optimization, SLA Engine, MS365 Calendar Integration
**Version**: 1.0
**Date**: March 4, 2026
**Target Platform**: React Native (iOS/Android)

---

## 1. Executive Summary

Transform the insurance adjuster's daily experience from a static claims list into a dynamic, optimized daily workflow hub called **"My Day."** This feature suite adds intelligent route optimization, SLA tracking with urgency scoring, scheduling with calendar integration, and a map-based route view — turning the app into a full end-to-end daily operations platform.

This document describes the reference implementation built in our React web application. The sister React Native app should replicate the same backend services and API contracts, adapting the frontend to native components and navigation patterns.

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
Bottom Tab Bar:  [My Day]  [Claims]  [🎤 Inspect]  [Capture]  [Review]
```

### 3.2 Tab Mapping

| Tab | Screen | Notes |
|-----|--------|-------|
| My Day | `MyDayScreen` | New home screen, replaces old Claims list |
| Claims | `ClaimsListScreen` | Full claims list, title "All Claims" |
| Inspect | `BriefingScreen` or `InspectionScreen` | Prominent center button (mic icon) |
| Capture | `PhotoLabScreen` | Photo capture/analysis |
| Review | `ReviewScreen` | Estimate review/export |

### 3.3 React Native Navigation Notes

- Use **React Navigation** bottom tab navigator (`@react-navigation/bottom-tabs`)
- The center "Inspect" tab should use a **custom tab button** — elevated circular button floating above the tab bar (use `tabBarButton` prop with a custom component)
- Settings is accessed from the top header (gear icon), not from tabs — add it as a stack screen or modal, triggered by a `headerRight` button
- My Day screen contains an internal **top tab navigator** (`@react-navigation/material-top-tabs`) or a custom segmented control for the 3 sub-tabs: Itinerary | Route Map | Schedule

### 3.4 Settings Relocation

Move Settings out of bottom tabs into the top header as a gear icon. Render via the navigation header's `headerRight` prop. Settings screen remains a stack/modal screen.

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

**Purpose**: Converts property addresses to latitude/longitude coordinates using the free OpenStreetMap Nominatim API.

**Key behaviors**:
- Rate-limited to 1 request per 1.1 seconds (Nominatim usage policy)
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

**Nominatim endpoint**: `https://nominatim.openstreetmap.org/search?q={query}&format=json&limit=1&countrycodes=us`

### 5.2 SLA Engine

**Purpose**: Computes urgency scores (0–100) and assigns priority levels and SLA deadlines to claims.

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

**Purpose**: Solves the Traveling Salesman Problem (TSP) using a priority-weighted nearest-neighbor heuristic.

**Algorithm**:
1. Filter claims to only those with valid lat/lng coordinates
2. Sort by priority weight (critical=4, high=3, normal=2, low=1)
3. Start from provided location or highest-priority claim
4. Greedy nearest-neighbor: at each step, pick the unvisited claim that minimizes `distance / priorityWeight`
5. Calculate total distance (Haversine formula, Earth radius = 6,371 km) and estimated drive times

**Haversine formula** (for reference):
```
dLat = toRad(lat2 - lat1)
dLon = toRad(lon2 - lon1)
a = sin(dLat/2)^2 + cos(lat1) * cos(lat2) * sin(dLon/2)^2
distance = R * 2 * atan2(sqrt(a), sqrt(1-a))    // R = 6371 km
```

**Drive time estimation**: `distance_km / 50 km/h * 60` (assumes 50 km/h average speed)

**Output**:
```typescript
interface OptimizedRoute {
  stops: RouteStop[];        // Ordered stops with claimId, lat/lng, duration, priority, order
  totalDistanceKm: number;
  totalDriveTimeMin: number;
  totalDurationMin: number;  // Drive time + sum of inspection durations
}

interface RouteStop {
  claimId: number;
  latitude: number;
  longitude: number;
  estimatedDurationMin: number;
  priority: string;
  order: number;             // 1-based position in route
}
```

**Additional utility**: `getDriveTimes(claims, startLocation?)` returns per-stop drive time and distance without reordering.

### 5.4 MS365 Service

**Purpose**: Full Microsoft 365 Outlook Calendar integration via OAuth 2.0 and Microsoft Graph API.

**Required Environment Variables**:
| Variable | Description |
|----------|-------------|
| `MS365_CLIENT_ID` | Azure AD application (client) ID |
| `MS365_CLIENT_SECRET` | Azure AD client secret |
| `MS365_TENANT_ID` | Azure AD tenant ID (optional, uses `/common` by default) |
| `MS365_REDIRECT_URI` | OAuth callback URL (auto-detected if not set) |

**OAuth Flow**:
1. Client calls `GET /api/ms365/connect` → receives `authUrl`
2. User redirected to Microsoft login (in-app browser or system browser)
3. Callback at `GET /api/ms365/callback` exchanges authorization code for tokens
4. Tokens stored in `ms365_tokens` table
5. Auto-refresh: tokens refreshed automatically if < 5 minutes from expiration

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
- `syncClaimToCalendar(userId, claimId, subject, start, end, location?)` → creates or updates Outlook event, stores `calendarEventId` on the claim record
- `removeClaimFromCalendar(userId, claimId)` → deletes Outlook event, clears `calendarEventId`
- Events are tagged with category `"Claims IQ"` for easy filtering in Outlook

**React Native OAuth Note**: On mobile, use `react-native-app-auth` or open the authorization URL in a `WebBrowser` (Expo) / `InAppBrowser` and intercept the callback redirect URI using deep linking. The redirect URI should be a custom scheme (e.g., `claimsiq://ms365/callback`) registered in the app, rather than an HTTP callback. The backend should support both HTTP and custom-scheme redirects.

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
  "itinerary": {
    "id": 1,
    "claimIds": [8, 23, 30, 25, 28],
    "routeData": {
      "stops": [...],
      "totalDistanceKm": 320,
      "totalDriveTimeMin": 185,
      "totalDurationMin": 515
    }
  },
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

**`GET /week/:startDate` Response Shape**:
```json
{
  "startDate": "2026-03-02",
  "days": [
    {
      "date": "2026-03-02",
      "claims": [
        {
          "id": 23,
          "claimNumber": "CLM-2026-56580",
          "insuredName": "JIMMY DON JEAN",
          "scheduledTimeSlot": "10:30",
          "priority": "urgent",
          "status": "inspecting",
          "estimatedDurationMin": 90,
          "propertyAddress": "4019 S BANNANA Dr",
          "city": "Ozark"
        }
      ]
    },
    { "date": "2026-03-03", "claims": [] },
    ...
  ]
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
  "startLatitude": 39.0,
  "startLongitude": -104.0
}
```
The `startLatitude`/`startLongitude` are optional — pass the adjuster's current GPS location from the device for best results.

**`POST /optimize` Response**:
```json
{
  "route": {
    "stops": [
      {
        "claimId": 8,
        "latitude": 42.9603,
        "longitude": -90.1301,
        "estimatedDurationMin": 60,
        "priority": "high",
        "order": 1
      },
      ...
    ],
    "totalDistanceKm": 320.5,
    "totalDriveTimeMin": 185,
    "totalDurationMin": 515
  }
}
```

**`POST /schedule` Request**:
```json
{
  "claimId": 23,
  "date": "2026-03-04",
  "timeSlot": "10:30",
  "priority": "high",
  "estimatedDurationMin": 90
}
```
All fields except `claimId` and `date` are optional.

**Authorization**: Schedule/unschedule checks ownership — only the assigned adjuster, admins, or supervisors can modify scheduling.

### 6.3 MS365 API (`/api/ms365`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/status` | Required | Connection status + configured flag |
| `GET` | `/connect` | Required | Get OAuth authorization URL |
| `GET` | `/callback` | None | OAuth callback (handles code exchange) |
| `POST` | `/disconnect` | Required | Remove MS365 tokens |
| `GET` | `/calendar/events?startDate&endDate` | Required | List calendar events |
| `POST` | `/calendar/events` | Required | Create calendar event |
| `PATCH` | `/calendar/events/:eventId` | Required | Update calendar event |
| `DELETE` | `/calendar/events/:eventId` | Required | Delete calendar event |
| `GET` | `/calendar/freebusy?startDate&endDate` | Required | Get busy time slots |
| `POST` | `/calendar/sync-claim` | Required | Sync claim → Outlook event |
| `POST` | `/calendar/unsync-claim` | Required | Remove claim from Outlook |

**`POST /calendar/sync-claim` Request**:
```json
{
  "claimId": 23,
  "subject": "Inspection: CLM-2026-56580 - JIMMY DON JEAN",
  "startDateTime": "2026-03-04T10:30:00",
  "endDateTime": "2026-03-04T12:00:00",
  "location": "4019 S BANNANA Dr, Ozark, MO"
}
```

**OAuth Callback Flow**:
```
GET /api/ms365/connect → { authUrl }
  ↓ (open in browser / WebBrowser.openAuthSessionAsync)
Microsoft Login → authorization code
  ↓
GET /api/ms365/callback?code=xxx&state=yyy
  ↓ (exchange code for tokens, store in DB)
Redirect → /settings?ms365_connected=true  (or deep link back to app)
```

**State security**: Random 16-byte hex token with 10-minute expiration, stored server-side in a Map keyed by state value. Deleted after single use.

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

## 8. Frontend Screens (React Native)

### 8.1 My Day Screen

The primary hub replacing the old home screen. This is a single screen with an internal tab/segment control.

**Context Bar** (always visible at top, above the sub-tabs):
- Greeting with time-of-day logic:
  - Before 12pm → "Good morning"
  - 12pm–5pm → "Good afternoon"
  - After 5pm → "Good evening"
- Current date formatted as "Wednesday, March 4, 2026"
- Weather placeholder (icon + temp) — right-aligned
- MS365 connection status chip (green "Connected" / gray "Disconnected")

**Stats Row** (3 equal-width cards in a horizontal `FlatList` or `View` with `flexDirection: 'row'`):
- Claims Today (blue calendar icon + count)
- Completed (green check icon + count)
- SLA Warnings (amber alert icon + count of warnings + overdue combined)

**Sub-Tab Selector**: Custom segmented control or `@react-navigation/material-top-tabs`:
- **Itinerary** (default)
- **Route Map**
- **Schedule**

**Data source**: `GET /api/myday/today` — fetch on mount and pull-to-refresh

### 8.2 Itinerary Tab

Timeline-style ordered list of today's claims, rendered as a `FlatList` or `ScrollView`.

**Visual design**:
- Vertical timeline line on the left (absolute positioned `View` with 2px width)
- Colored circle per claim aligned to the timeline:
  - Red = critical, Orange = high, Blue = normal, Gray = low
- Each card (pressable) shows:
  - **Left column**: Claim number + priority badge (colored pill)
  - **Below**: Insured name
  - **Below**: Address with map pin icon (truncated)
  - **Right column**: Scheduled time slot, estimated duration, SLA countdown
- SLA countdown display:
  - If overdue → red text "OVERDUE"
  - Otherwise → gray text "{N}h remaining"

**Actions**:
- "Optimize Route" button at top → `POST /api/itinerary/optimize` (pass device GPS from `expo-location` or `react-native-geolocation`)
- Press card → navigate to Briefing screen for that claim
- Pull-to-refresh → re-fetch `/api/myday/today`

**States**:
- Loading: 3 skeleton placeholder rectangles with shimmer animation
- Empty: Centered calendar icon + "No claims scheduled" + "You have no inspections scheduled for today."
- Error: "Failed to load today's schedule." with error message

### 8.3 Route Map Tab

Interactive native map showing the day's route.

**React Native Map Libraries** (choose one):
- `react-native-maps` (recommended) — uses native Apple Maps / Google Maps
- `react-native-mapbox-gl` — if Mapbox is preferred
- **Do NOT use Leaflet** — it is a web library and does not work in React Native

**Map features**:
- **Custom numbered markers**: Circular markers color-coded by priority with the stop number (1, 2, 3...) in the center. Use `Marker` with a custom `View` as the child or `calloutView`
- **Route polyline**: Dashed blue line connecting stops in route order (`Polyline` component with `lineDashPattern`)
- **User location**: Enable `showsUserLocation` prop on `MapView`
- **Auto-fit**: Call `mapRef.fitToCoordinates(coordinates, { edgePadding, animated: true })` on data load

**Marker press behavior**:
- Show a `Callout` or custom bottom sheet with:
  - Claim number, insured name, address, scheduled time
  - "Navigate" button → opens native maps app via `Linking.openURL()`:
    - iOS: `maps://app?daddr={lat},{lng}`
    - Android: `google.navigation:q={lat},{lng}`
    - Cross-platform: `https://www.google.com/maps/dir/?api=1&destination={lat},{lng}`
  - "View Details" button → navigate to Briefing screen

**"Optimize" button**: Floating action button (absolute positioned, top-right) triggering `POST /api/itinerary/optimize`

**Priority marker colors**:
```
critical: #ef4444 (red)
high:     #f97316 (orange)
normal:   #3b82f6 (blue)
low:      #9ca3af (gray)
```

### 8.4 Schedule Tab

Week-at-a-glance calendar view.

**Layout options** (React Native):
- **Option A**: Horizontal `ScrollView` with 7 day columns (works well on tablets, tight on phones)
- **Option B**: Single-day view with left/right swipe navigation (better for phone screens)
- **Option C (recommended for phone)**: Horizontal `FlatList` with day columns, each ~100px wide, scrollable. Show 3-4 days visible at once.

**Navigation**: Previous/Next week buttons (chevron icons) + "Today" button
**Data source**: `GET /api/myday/week/:startDate` (pass Monday of selected week as `YYYY-MM-DD`)

**Week range calculation** (Monday-based):
```javascript
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}
```

**Each day column**:
- Header: Day label (Mon, Tue, etc.) + short date (Mar 4)
- Today's column highlighted with blue background / blue border
- Claim cards stacked vertically:
  - Priority color dot (small circle View)
  - Time slot text
  - Claim number (truncated)
  - Insured name (truncated at 15 chars)
- Empty days show "No inspections" text in muted color
- Press card → navigate to Briefing screen

### 8.5 Bottom Tab Bar

5-tab bottom navigation using `@react-navigation/bottom-tabs`.

| Position | Icon | Label | Screen | Notes |
|----------|------|-------|--------|-------|
| 1 | `calendar-check` | My Day | MyDayScreen | Default tab |
| 2 | `list` | Claims | ClaimsListScreen | |
| 3 (center) | `microphone` | Inspect | BriefingScreen or InspectionScreen | Custom elevated button |
| 4 | `camera` | Capture | PhotoLabScreen | |
| 5 | `clipboard-check` | Review | ReviewScreen | |

**Center "Inspect" button implementation**:
```jsx
<Tab.Screen
  name="Inspect"
  options={{
    tabBarButton: (props) => (
      <CustomInspectButton {...props} />
    ),
  }}
/>
```
The custom button should be:
- Elevated above the tab bar (~20px offset with negative `marginTop`)
- Circular, 56px diameter
- Filled background (primary brand color, or dark when inactive)
- Drop shadow for depth
- Mic icon, white, 24px

**Active state**: Primary color fill for icon + text. Active indicator dot or underline beneath label.

**Icon library**: Use `@expo/vector-icons` (Ionicons, MaterialCommunityIcons, Feather) or `react-native-vector-icons`.

### 8.6 MS365 Settings UI

In the Settings screen, add an "Outlook Calendar" card/section:

**When disconnected**:
- Status text: "Not connected"
- "Connect to Outlook" button
- Button action:
  1. Call `GET /api/ms365/connect` to get the `authUrl`
  2. Open in system browser: `WebBrowser.openAuthSessionAsync(authUrl, callbackUrl)` (Expo) or `InAppBrowser.open(authUrl)` (bare)
  3. Handle the redirect callback — extract success/error from the deep link params
  4. Re-fetch status

**When connected**:
- Status text: "Connected" (green)
- Connected email displayed
- "Disconnect" button → calls `POST /api/ms365/disconnect`, re-fetches status

**React Native OAuth considerations**:
- Register a deep link scheme (e.g., `claimsiq://`) in your app config
- Set `MS365_REDIRECT_URI` to `claimsiq://ms365/callback` for the mobile app (or use a separate Azure AD redirect URI for mobile)
- Alternatively, use a web redirect that your backend handles, then deep-links back to the app after token exchange

### 8.7 Notification Bell (Header)

The bell icon in the top header should show an unread badge count from `unreadNotifications` in the My Day response.

**Implementation**:
- `headerRight` renders a bell `TouchableOpacity` with an absolute-positioned red badge `View` showing the count
- Press → navigates to a Notifications screen or opens a bottom sheet listing `GET /api/notifications/persistent`
- Each notification item: title, message, timestamp, unread indicator dot
- Swipe or tap to mark read → `PATCH /api/notifications/persistent/:id/read`
- "Mark all read" action → `POST /api/notifications/persistent/mark-all-read`

---

## 9. Security Considerations

### 9.1 Authentication

All new API routes require a valid auth token in the `Authorization: Bearer <token>` header.

### 9.2 Authorization (IDOR Prevention)

- **Schedule/Unschedule**: Verify `claim.assignedTo === currentUserId` OR user role is `admin`/`supervisor`
- **Notifications mark-read**: Verify notification belongs to the current user
- **MS365 operations**: All scoped to the current user via token lookup

### 9.3 OAuth State

MS365 OAuth state tokens:
- 16 random bytes (hex encoded)
- 10-minute expiration
- Server-side Map storage (in-memory) — delete after single use
- Validate state matches before exchanging code for tokens

### 9.4 Token Storage (React Native)

- Store auth tokens in secure storage (`expo-secure-store` or `react-native-keychain`), never in AsyncStorage
- MS365 tokens are stored server-side (not on device) — only the app's own auth token is stored on the device

---

## 10. Third-Party Dependencies

### Backend (shared with web app):
| Dependency | Purpose | License | Cost |
|------------|---------|---------|------|
| Nominatim (OpenStreetMap) | Geocoding | ODbL | Free (1 req/sec limit) |
| Microsoft Graph API | Calendar CRUD | Commercial | Free with M365 license |
| Haversine formula | Distance calc | N/A (math) | Free |

### React Native (mobile-specific):
| Dependency | Purpose | Notes |
|------------|---------|-------|
| `react-native-maps` | Map rendering | Uses native Apple Maps / Google Maps |
| `@react-navigation/bottom-tabs` | Bottom tab bar | Standard RN navigation |
| `@react-navigation/material-top-tabs` | Sub-tab navigation in My Day | Or use custom segmented control |
| `expo-location` | Device GPS for route optimization | Requires location permission |
| `expo-web-browser` | OAuth login flow | Opens system browser for MS365 auth |
| `expo-secure-store` | Secure token storage | Auth token persistence |
| `expo-linking` | Deep link handling for OAuth callback | |
| `react-native-reanimated` | Smooth animations | Skeleton loading, transitions |

**No paid API keys required** for geocoding. Maps use the platform's built-in map SDK (Apple Maps on iOS, Google Maps on Android — Google Maps requires an API key for Android). MS365 requires an Azure AD app registration.

---

## 11. Azure AD App Registration Setup

To enable MS365 calendar integration:

1. Go to [Azure Portal](https://portal.azure.com) → Azure Active Directory → App registrations
2. New registration:
   - Name: "Claims IQ Calendar"
   - Supported account types: "Accounts in any organizational directory"
   - Redirect URIs — add both:
     - Web: `https://your-api-domain.com/api/ms365/callback`
     - Mobile: `claimsiq://ms365/callback` (custom scheme for RN app)
3. Under "Certificates & secrets" → New client secret → copy value
4. Under "API permissions" → Add:
   - `Calendars.ReadWrite` (Delegated)
   - `User.Read` (Delegated)
   - `offline_access` (Delegated)
5. Set environment variables on your backend:
   ```
   MS365_CLIENT_ID=<Application (client) ID>
   MS365_CLIENT_SECRET=<Client secret value>
   MS365_REDIRECT_URI=https://your-api-domain.com/api/ms365/callback
   ```

---

## 12. Implementation Order (Recommended)

```
Wave 1 (Parallel):
  ├── T001: Schema changes (new columns + 3 tables)
  └── T002: Navigation reorganization (bottom tabs, header, routing)

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
  ├── T009: My Day screen with Itinerary tab
  ├── T012: Notification system expansion
  └── T013: MS365 Settings UI

Wave 6 (Parallel, after T009):
  ├── T010: Schedule sub-tab
  └── T011: Route Map sub-tab
```

**Notes for React Native team**:
- Waves 1–4 are identical to the web app if you share the same backend
- If you share the same backend API, you only need to implement Waves 2, 5, and 6 on the RN side (T002, T009–T013)
- Wave 2 (navigation) should be done first on RN since it's structurally different from web (React Navigation vs wouter)

---

## 13. Data Seeding / Migration Notes

After deploying schema changes, existing claims will have null values for all new fields. Required steps:

1. **Geocode existing claims**: Hit the backfill endpoint or run geocoding in batch for all claims with addresses but no coordinates
2. **Compute SLA for existing claims**: Run `applySlaToClaimData` across active claims to set initial `priority` and `slaDeadline`
3. **Schedule claims**: Claims must be explicitly scheduled (set `scheduled_date` and `scheduled_time_slot`) to appear in My Day — they don't auto-populate
4. **Create initial itineraries**: Run route optimization for each adjuster's first scheduled day

---

## 14. Platform-Specific Considerations

### 14.1 Location Permissions (React Native)

The Route Map and Optimize features need the device's GPS location.

**iOS**: Add to `Info.plist`:
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Claims IQ uses your location to optimize inspection routes and show your position on the map.</string>
```

**Android**: Add to `AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

Request permission at runtime before accessing location. Gracefully degrade if denied (hide "Your Location" marker, skip `startLatitude`/`startLongitude` in optimize requests).

### 14.2 Push Notifications (Future Enhancement)

The current implementation uses pull-based notifications (fetched on screen load). A future enhancement could add push notifications for SLA warnings:
- Use Firebase Cloud Messaging (FCM) for Android
- Use Apple Push Notification Service (APNs) for iOS
- Backend triggers push when `generateSlaNotifications` creates a new notification

### 14.3 Offline Support

The web app caches data via React Query. For React Native:
- Use `@tanstack/react-query` with `persistQueryClient` + `AsyncStorage` adapter for offline caching
- Show stale data with "Last updated X minutes ago" indicator when offline
- Queue schedule/unschedule mutations for replay when connectivity returns

### 14.4 Navigation Deep Linking

For "Navigate" functionality on the Route Map, open native maps:
```javascript
import { Linking, Platform } from 'react-native';

function openNavigation(lat, lng) {
  const url = Platform.select({
    ios: `maps://app?daddr=${lat},${lng}`,
    android: `google.navigation:q=${lat},${lng}`,
  });
  Linking.openURL(url);
}
```

---

## 15. Wire Protocol Summary

For quick reference, here are all new API endpoints:

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

---

## 16. Design Tokens / Color Reference

For consistent styling across web and React Native:

| Token | Hex | Usage |
|-------|-----|-------|
| Priority Critical | `#ef4444` | Red badges, dots, markers |
| Priority High | `#f97316` | Orange badges, dots, markers |
| Priority Normal | `#3b82f6` | Blue badges, dots, markers |
| Priority Low | `#9ca3af` | Gray badges, dots, markers |
| SLA Overdue | `#dc2626` | Red text for overdue labels |
| Stats Blue BG | `#eff6ff` | Claims Today stat card bg |
| Stats Green BG | `#f0fdf4` | Completed stat card bg |
| Stats Amber BG | `#fffbeb` | SLA Warning stat card bg |
| Today Highlight | `#eff6ff` (bg) / `#bfdbfe` (border) | Schedule view today column |
| MS365 Connected | `#f0fdf4` (bg) / `#15803d` (text) | Green status chip |
| MS365 Disconnected | `#f3f4f6` (bg) / `#6b7280` (text) | Gray status chip |
| Route Polyline | `#3b82f6` | Blue dashed line on map |
