import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createMockStorage } from "../mocks/mockStorage";
import { mockAuthMiddleware, defaultTestUser } from "../mocks/mockAuth";
import { buildClaim, buildSession, buildRoom } from "../fixtures/factories";
import type { IStorage } from "../../server/storage";

let app: express.Express;
let mockStorage: IStorage;

function createTestApp(user = defaultTestUser) {
  const app = express();
  app.use(express.json());
  app.use(mockAuthMiddleware(user));
  return app;
}

beforeEach(() => {
  mockStorage = createMockStorage();
  app = createTestApp();

  app.get("/api/claims/:id/inspection/active", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const session = await mockStorage.getActiveSessionForClaim(claimId);
      if (!session) return res.json({ session: null });
      res.json({ session });
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims/:id/inspection/start", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const existing = await mockStorage.getActiveSessionForClaim(claimId);
      if (existing) {
        return res.json({ sessionId: existing.id, session: existing });
      }
      const session = await mockStorage.createInspectionSession(claimId);
      res.status(201).json({ sessionId: session.id, session });
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const session = await mockStorage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const rooms = await mockStorage.getRooms(sessionId);
      const lineItems = await mockStorage.getLineItems(sessionId);
      const photos = await mockStorage.getPhotos(sessionId);
      const estimate = await mockStorage.getEstimateSummary(sessionId);
      res.json({ session, rooms, lineItemCount: lineItems.length, photoCount: photos.length, estimate });
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/inspection/:sessionId/rooms", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const { name } = req.body;
      if (!name) return res.status(400).json({ message: "name required" });
      const session = await mockStorage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const room = await mockStorage.createRoom({
        sessionId,
        name,
        status: "in_progress",
      } as any);
      res.status(201).json(room);
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });
});

describe("GET /api/claims/:id/inspection/active", () => {
  it("returns null when no active session", async () => {
    (mockStorage.getActiveSessionForClaim as any).mockResolvedValue(undefined);

    const res = await request(app).get("/api/claims/1/inspection/active");

    expect(res.status).toBe(200);
    expect(res.body.session).toBeNull();
  });

  it("returns active session when exists", async () => {
    const session = buildSession({ id: 10, claimId: 1 });
    (mockStorage.getActiveSessionForClaim as any).mockResolvedValue(session);

    const res = await request(app).get("/api/claims/1/inspection/active");

    expect(res.status).toBe(200);
    expect(res.body.session.id).toBe(10);
    expect(res.body.session.claimId).toBe(1);
  });
});

describe("POST /api/claims/:id/inspection/start", () => {
  it("creates new session when none exists", async () => {
    const session = buildSession({ id: 5, claimId: 1 });
    (mockStorage.getActiveSessionForClaim as any).mockResolvedValue(undefined);
    (mockStorage.createInspectionSession as any).mockResolvedValue(session);

    const res = await request(app).post("/api/claims/1/inspection/start");

    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBe(5);
    expect(mockStorage.createInspectionSession).toHaveBeenCalledWith(1);
  });

  it("returns existing session when one already active", async () => {
    const existing = buildSession({ id: 3, claimId: 1 });
    (mockStorage.getActiveSessionForClaim as any).mockResolvedValue(existing);

    const res = await request(app).post("/api/claims/1/inspection/start");

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(3);
    expect(mockStorage.createInspectionSession).not.toHaveBeenCalled();
  });
});

describe("GET /api/inspection/:sessionId", () => {
  it("returns 404 for non-existent session", async () => {
    (mockStorage.getInspectionSession as any).mockResolvedValue(undefined);

    const res = await request(app).get("/api/inspection/999");

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Session not found");
  });

  it("returns session with rooms and counts", async () => {
    const session = buildSession({ id: 1, claimId: 1 });
    const rooms = [buildRoom({ id: 1, sessionId: 1 })];
    (mockStorage.getInspectionSession as any).mockResolvedValue(session);
    (mockStorage.getRooms as any).mockResolvedValue(rooms);
    (mockStorage.getLineItems as any).mockResolvedValue([]);
    (mockStorage.getPhotos as any).mockResolvedValue([]);
    (mockStorage.getEstimateSummary as any).mockResolvedValue({ totalRCV: 0 });

    const res = await request(app).get("/api/inspection/1");

    expect(res.status).toBe(200);
    expect(res.body.session.id).toBe(1);
    expect(res.body.rooms).toHaveLength(1);
    expect(res.body.lineItemCount).toBe(0);
  });
});

describe("POST /api/inspection/:sessionId/rooms", () => {
  it("creates room with name", async () => {
    const session = buildSession({ id: 1 });
    const room = buildRoom({ id: 1, sessionId: 1, name: "Kitchen" });
    (mockStorage.getInspectionSession as any).mockResolvedValue(session);
    (mockStorage.createRoom as any).mockResolvedValue(room);

    const res = await request(app)
      .post("/api/inspection/1/rooms")
      .send({ name: "Kitchen" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Kitchen");
  });

  it("returns 400 when name missing", async () => {
    const res = await request(app)
      .post("/api/inspection/1/rooms")
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent session", async () => {
    (mockStorage.getInspectionSession as any).mockResolvedValue(undefined);

    const res = await request(app)
      .post("/api/inspection/999/rooms")
      .send({ name: "Kitchen" });

    expect(res.status).toBe(404);
  });
});
