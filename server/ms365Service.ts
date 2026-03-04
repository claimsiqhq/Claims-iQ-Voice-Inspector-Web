import { storage } from "./storage";
import { logger } from "./logger";

const MS365_AUTHORITY = "https://login.microsoftonline.com/common";
const MS365_GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SCOPES = ["Calendars.ReadWrite", "User.Read", "offline_access"];

function getClientId(): string {
  return process.env.MS365_CLIENT_ID || "";
}

function getClientSecret(): string {
  return process.env.MS365_CLIENT_SECRET || "";
}

function getRedirectUri(): string {
  if (process.env.MS365_REDIRECT_URI) return process.env.MS365_REDIRECT_URI;
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0] || "localhost:5000";
  const protocol = domain.includes("localhost") ? "http" : "https";
  return `${protocol}://${domain}/api/ms365/callback`;
}

export function isMs365Configured(): boolean {
  return !!(getClientId() && getClientSecret());
}

export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    response_type: "code",
    redirect_uri: getRedirectUri(),
    scope: SCOPES.join(" "),
    response_mode: "query",
    state,
  });
  return `${MS365_AUTHORITY}/oauth2/v2.0/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

async function requestToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(`${MS365_AUTHORITY}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`MS365 token request failed: ${res.status} ${errText}`);
  }
  return res.json() as Promise<TokenResponse>;
}

export async function exchangeCodeForTokens(code: string, userId: string): Promise<void> {
  const body = new URLSearchParams({
    client_id: getClientId(),
    client_secret: getClientSecret(),
    code,
    redirect_uri: getRedirectUri(),
    grant_type: "authorization_code",
    scope: SCOPES.join(" "),
  });

  const tokenData = await requestToken(body);
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  await storage.saveMs365Token(userId, {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt,
    scope: tokenData.scope,
  });
  logger.info("ms365", `Tokens saved for user ${userId}`);
}

async function refreshAccessToken(userId: string): Promise<string> {
  const token = await storage.getMs365Token(userId);
  if (!token) throw new Error("No MS365 token found for user");

  if (token.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
    return token.accessToken;
  }

  const body = new URLSearchParams({
    client_id: getClientId(),
    client_secret: getClientSecret(),
    refresh_token: token.refreshToken,
    grant_type: "refresh_token",
    scope: SCOPES.join(" "),
  });

  const tokenData = await requestToken(body);
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  await storage.saveMs365Token(userId, {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || token.refreshToken,
    expiresAt,
    scope: tokenData.scope,
  });

  return tokenData.access_token;
}

async function graphRequest(userId: string, path: string, options: RequestInit = {}): Promise<any> {
  const accessToken = await refreshAccessToken(userId);
  const url = path.startsWith("http") ? path : `${MS365_GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (res.status === 204) return null;

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Graph API error ${res.status}: ${errText}`);
  }

  return res.json();
}

export interface CalendarEvent {
  id?: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName: string };
  body?: { contentType: string; content: string };
  categories?: string[];
}

export async function getCalendarEvents(
  userId: string,
  startDate: string,
  endDate: string
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    startDateTime: startDate,
    endDateTime: endDate,
    $orderby: "start/dateTime",
    $top: "50",
  });
  const data = await graphRequest(userId, `/me/calendarView?${params.toString()}`);
  return data?.value || [];
}

export async function createCalendarEvent(
  userId: string,
  event: CalendarEvent
): Promise<CalendarEvent> {
  return graphRequest(userId, "/me/events", {
    method: "POST",
    body: JSON.stringify(event),
  });
}

export async function updateCalendarEvent(
  userId: string,
  eventId: string,
  updates: Partial<CalendarEvent>
): Promise<CalendarEvent> {
  return graphRequest(userId, `/me/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function deleteCalendarEvent(
  userId: string,
  eventId: string
): Promise<void> {
  await graphRequest(userId, `/me/events/${eventId}`, {
    method: "DELETE",
  });
}

export interface FreeBusySlot {
  status: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

export async function getFreeBusy(
  userId: string,
  startDate: string,
  endDate: string
): Promise<FreeBusySlot[]> {
  const events = await getCalendarEvents(userId, startDate, endDate);
  return events.map((e) => ({
    status: "busy",
    start: e.start,
    end: e.end,
  }));
}

export async function getUserProfile(userId: string): Promise<{ displayName: string; mail: string }> {
  return graphRequest(userId, "/me?$select=displayName,mail");
}

export async function syncClaimToCalendar(
  userId: string,
  claimId: number,
  subject: string,
  startDateTime: string,
  endDateTime: string,
  location?: string
): Promise<string> {
  const claim = await storage.getClaim(claimId);
  const existingEventId = claim?.calendarEventId;

  const event: CalendarEvent = {
    subject,
    start: { dateTime: startDateTime, timeZone: "UTC" },
    end: { dateTime: endDateTime, timeZone: "UTC" },
    location: location ? { displayName: location } : undefined,
    body: {
      contentType: "text",
      content: `Claims IQ Inspection - Claim #${claim?.claimNumber || claimId}`,
    },
    categories: ["Claims IQ"],
  };

  let eventId: string;
  if (existingEventId) {
    const updated = await updateCalendarEvent(userId, existingEventId, event);
    eventId = updated.id || existingEventId;
  } else {
    const created = await createCalendarEvent(userId, event);
    eventId = created.id || "";
  }

  await storage.updateClaimScheduling(claimId, { calendarEventId: eventId });
  return eventId;
}

export async function removeClaimFromCalendar(
  userId: string,
  claimId: number
): Promise<void> {
  const claim = await storage.getClaim(claimId);
  if (claim?.calendarEventId) {
    try {
      await deleteCalendarEvent(userId, claim.calendarEventId);
    } catch (err) {
      logger.warn("ms365", `Failed to delete calendar event: ${err}`);
    }
    await storage.updateClaimScheduling(claimId, { calendarEventId: undefined });
  }
}

export async function getConnectionStatus(userId: string): Promise<{
  connected: boolean;
  email?: string;
  displayName?: string;
  expiresAt?: string;
}> {
  const token = await storage.getMs365Token(userId);
  if (!token) return { connected: false };

  try {
    const profile = await getUserProfile(userId);
    return {
      connected: true,
      email: profile.mail,
      displayName: profile.displayName,
      expiresAt: token.expiresAt.toISOString(),
    };
  } catch {
    return {
      connected: true,
      expiresAt: token.expiresAt.toISOString(),
    };
  }
}
