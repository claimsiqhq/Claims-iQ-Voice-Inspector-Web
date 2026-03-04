import { Router } from "express";
import { z } from "zod";
import { authenticateRequest } from "../auth";
import { storage } from "../storage";
import { handleRouteError } from "../utils";
import {
  isMs365Configured,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getFreeBusy,
  getConnectionStatus,
  syncClaimToCalendar,
  removeClaimFromCalendar,
} from "../ms365Service";
import crypto from "crypto";

const pendingStates = new Map<string, { userId: string; expiresAt: number }>();

export function ms365Router(): Router {
  const router = Router();

  router.get("/status", authenticateRequest, async (req, res) => {
    try {
      if (!isMs365Configured()) {
        return res.json({ configured: false, connected: false });
      }
      const status = await getConnectionStatus(req.user!.id);
      res.json({ configured: true, ...status });
    } catch (error: unknown) {
      handleRouteError(res, error, "ms365.status");
    }
  });

  router.get("/connect", authenticateRequest, async (req, res) => {
    try {
      if (!isMs365Configured()) {
        return res.status(400).json({ message: "MS365 integration not configured" });
      }
      const state = crypto.randomBytes(16).toString("hex");
      pendingStates.set(state, {
        userId: req.user!.id,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      const authUrl = getAuthorizationUrl(state);
      res.json({ authUrl });
    } catch (error: unknown) {
      handleRouteError(res, error, "ms365.connect");
    }
  });

  router.get("/callback", async (req, res) => {
    try {
      const { code, state, error: oauthError } = req.query;

      if (oauthError) {
        return res.redirect(`/settings?ms365_error=${encodeURIComponent(String(oauthError))}`);
      }

      if (!code || !state) {
        return res.redirect("/settings?ms365_error=missing_params");
      }

      const stateStr = String(state);
      const pending = pendingStates.get(stateStr);

      if (!pending || pending.expiresAt < Date.now()) {
        pendingStates.delete(stateStr);
        return res.redirect("/settings?ms365_error=invalid_state");
      }

      pendingStates.delete(stateStr);
      await exchangeCodeForTokens(String(code), pending.userId);
      res.redirect("/settings?ms365_connected=true");
    } catch (error: unknown) {
      console.error("[ms365.callback] Error:", error);
      res.redirect("/settings?ms365_error=token_exchange_failed");
    }
  });

  router.post("/disconnect", authenticateRequest, async (req, res) => {
    try {
      await storage.deleteMs365Token(req.user!.id);
      res.json({ disconnected: true });
    } catch (error: unknown) {
      handleRouteError(res, error, "ms365.disconnect");
    }
  });

  const calendarQuerySchema = z.object({
    startDate: z.string(),
    endDate: z.string(),
  });

  router.get("/calendar/events", authenticateRequest, async (req, res) => {
    try {
      const parsed = calendarQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ message: "startDate and endDate required" });
      }
      const events = await getCalendarEvents(req.user!.id, parsed.data.startDate, parsed.data.endDate);
      res.json(events);
    } catch (error: unknown) {
      handleRouteError(res, error, "ms365.calendar.events");
    }
  });

  const createEventSchema = z.object({
    subject: z.string(),
    startDateTime: z.string(),
    endDateTime: z.string(),
    timeZone: z.string().default("UTC"),
    location: z.string().optional(),
    body: z.string().optional(),
  });

  router.post("/calendar/events", authenticateRequest, async (req, res) => {
    try {
      const parsed = createEventSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid event data", errors: parsed.error.flatten().fieldErrors });
      }
      const { subject, startDateTime, endDateTime, timeZone, location, body } = parsed.data;
      const event = await createCalendarEvent(req.user!.id, {
        subject,
        start: { dateTime: startDateTime, timeZone },
        end: { dateTime: endDateTime, timeZone },
        location: location ? { displayName: location } : undefined,
        body: body ? { contentType: "text", content: body } : undefined,
      });
      res.status(201).json(event);
    } catch (error: unknown) {
      handleRouteError(res, error, "ms365.calendar.create");
    }
  });

  const updateEventSchema = z.object({
    subject: z.string().optional(),
    startDateTime: z.string().optional(),
    endDateTime: z.string().optional(),
    timeZone: z.string().default("UTC"),
    location: z.string().optional(),
  });

  router.patch("/calendar/events/:eventId", authenticateRequest, async (req, res) => {
    try {
      const parsed = updateEventSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten().fieldErrors });
      }
      const { subject, startDateTime, endDateTime, timeZone, location } = parsed.data;
      const updates: any = {};
      if (subject) updates.subject = subject;
      if (startDateTime) updates.start = { dateTime: startDateTime, timeZone };
      if (endDateTime) updates.end = { dateTime: endDateTime, timeZone };
      if (location) updates.location = { displayName: location };

      const eventId = Array.isArray(req.params.eventId) ? req.params.eventId[0] : req.params.eventId;
      const event = await updateCalendarEvent(req.user!.id, eventId, updates);
      res.json(event);
    } catch (error: unknown) {
      handleRouteError(res, error, "ms365.calendar.update");
    }
  });

  router.delete("/calendar/events/:eventId", authenticateRequest, async (req, res) => {
    try {
      const eventId = Array.isArray(req.params.eventId) ? req.params.eventId[0] : req.params.eventId;
      await deleteCalendarEvent(req.user!.id, eventId);
      res.json({ deleted: true });
    } catch (error: unknown) {
      handleRouteError(res, error, "ms365.calendar.delete");
    }
  });

  router.get("/calendar/freebusy", authenticateRequest, async (req, res) => {
    try {
      const parsed = calendarQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ message: "startDate and endDate required" });
      }
      const slots = await getFreeBusy(req.user!.id, parsed.data.startDate, parsed.data.endDate);
      res.json(slots);
    } catch (error: unknown) {
      handleRouteError(res, error, "ms365.calendar.freebusy");
    }
  });

  const syncClaimSchema = z.object({
    claimId: z.number(),
    subject: z.string(),
    startDateTime: z.string(),
    endDateTime: z.string(),
    location: z.string().optional(),
  });

  router.post("/calendar/sync-claim", authenticateRequest, async (req, res) => {
    try {
      const parsed = syncClaimSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid sync data", errors: parsed.error.flatten().fieldErrors });
      }
      const { claimId, subject, startDateTime, endDateTime, location } = parsed.data;
      const eventId = await syncClaimToCalendar(req.user!.id, claimId, subject, startDateTime, endDateTime, location);
      res.json({ eventId });
    } catch (error: unknown) {
      handleRouteError(res, error, "ms365.calendar.syncClaim");
    }
  });

  router.post("/calendar/unsync-claim", authenticateRequest, async (req, res) => {
    try {
      const { claimId } = req.body;
      if (!claimId || typeof claimId !== "number") {
        return res.status(400).json({ message: "claimId required" });
      }
      await removeClaimFromCalendar(req.user!.id, claimId);
      res.json({ removed: true });
    } catch (error: unknown) {
      handleRouteError(res, error, "ms365.calendar.unsyncClaim");
    }
  });

  return router;
}
