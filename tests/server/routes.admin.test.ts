import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createMockStorage } from "../mocks/mockStorage";
import { mockAuthMiddleware, adminTestUser, defaultTestUser } from "../mocks/mockAuth";
import { buildClaim, buildSession } from "../fixtures/factories";
import type { IStorage } from "../../server/storage";

let app: express.Express;
let mockStorage: IStorage;

function createTestApp(user = adminTestUser) {
  const app = express();
  app.use(express.json());
  app.use(mockAuthMiddleware(user));
  return app;
}

function requireRole(..._roles: string[]) {
  return (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
}

beforeEach(() => {
  mockStorage = createMockStorage();
  app = createTestApp();

  app.get("/api/admin/users", async (_req, res) => {
    try {
      const allUsers = await mockStorage.getAllUsers();
      const allClaims = await mockStorage.getClaims();
      const activeClaimCounts = new Map<string, number>();
      for (const claim of allClaims) {
        if (claim.assignedTo && claim.status !== "completed" && claim.status !== "closed") {
          activeClaimCounts.set(claim.assignedTo, (activeClaimCounts.get(claim.assignedTo) || 0) + 1);
        }
      }
      const teamMembers = allUsers
        .filter((u) => u.role === "adjuster" || u.role === "supervisor")
        .map((u) => ({
          id: u.id,
          fullName: u.fullName || u.username,
          email: u.email,
          role: u.role,
          activeClaims: activeClaimCounts.get(u.id) || 0,
        }));
      res.json(teamMembers);
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/admin/claims/assign", async (req, res) => {
    try {
      const { claimId, userId } = req.body;
      if (!claimId || !userId) {
        return res.status(400).json({ message: "claimId and userId required" });
      }
      const claim = await mockStorage.updateClaimFields(claimId, { assignedTo: userId });
      res.json(claim);
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/dashboard", async (_req, res) => {
    try {
      const allClaims = await mockStorage.getClaims();
      const sessions = await Promise.all(allClaims.map((c) => mockStorage.getActiveSessionForClaim(c.id)));
      const activeSessions = sessions.filter((s) => s !== undefined).length;
      let totalEstimateValue = 0;
      const completedSessions = sessions.filter(Boolean);
      for (const session of completedSessions) {
        if (session) {
          const summary = await mockStorage.getEstimateSummary(session.id);
          totalEstimateValue += summary.totalRCV;
        }
      }
      res.json({
        totalClaims: allClaims.length,
        activeSessions,
        totalEstimateValue,
      });
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/active-sessions", async (_req, res) => {
    try {
      const allClaims = await mockStorage.getClaims();
      const allSessions = [];
      for (const claim of allClaims) {
        const session = await mockStorage.getActiveSessionForClaim(claim.id);
        if (session) {
          allSessions.push({
            id: session.id,
            claimNumber: claim.claimNumber,
            claimId: claim.id,
          });
        }
      }
      res.json(allSessions);
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });
});

describe("GET /api/admin/users", () => {
  it("returns team members with active claim counts", async () => {
    const users = [
      { id: "u1", fullName: "Alice", email: "a@test.com", role: "adjuster", username: "alice" },
      { id: "u2", fullName: "Bob", email: "b@test.com", role: "supervisor", username: "bob" },
    ];
    const claims = [
      buildClaim({ id: 1, assignedTo: "u1", status: "in_progress" }),
      buildClaim({ id: 2, assignedTo: "u1", status: "draft" }),
    ];
    (mockStorage.getAllUsers as any).mockResolvedValue(users);
    (mockStorage.getClaims as any).mockResolvedValue(claims);

    const res = await request(app).get("/api/admin/users");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].activeClaims).toBe(2);
  });

  it("returns empty array when no users", async () => {
    (mockStorage.getAllUsers as any).mockResolvedValue([]);
    (mockStorage.getClaims as any).mockResolvedValue([]);

    const res = await request(app).get("/api/admin/users");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("POST /api/admin/claims/assign", () => {
  it("assigns claim to user", async () => {
    const claim = buildClaim({ id: 1, assignedTo: "user-2" });
    (mockStorage.updateClaimFields as any).mockResolvedValue(claim);

    const res = await request(app)
      .post("/api/admin/claims/assign")
      .send({ claimId: 1, userId: "user-2" });

    expect(res.status).toBe(200);
    expect(res.body.assignedTo).toBe("user-2");
    expect(mockStorage.updateClaimFields).toHaveBeenCalledWith(1, { assignedTo: "user-2" });
  });

  it("returns 400 when claimId missing", async () => {
    const res = await request(app)
      .post("/api/admin/claims/assign")
      .send({ userId: "user-2" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("claimId and userId required");
  });

  it("returns 400 when userId missing", async () => {
    const res = await request(app)
      .post("/api/admin/claims/assign")
      .send({ claimId: 1 });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/dashboard", () => {
  it("returns dashboard stats", async () => {
    const claims = [buildClaim({ id: 1 }), buildClaim({ id: 2 })];
    const session = buildSession({ id: 1, claimId: 1 });
    (mockStorage.getClaims as any).mockResolvedValue(claims);
    (mockStorage.getActiveSessionForClaim as any)
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(undefined);
    (mockStorage.getEstimateSummary as any).mockResolvedValue({ totalRCV: 5000 });

    const res = await request(app).get("/api/admin/dashboard");

    expect(res.status).toBe(200);
    expect(res.body.totalClaims).toBe(2);
    expect(res.body.activeSessions).toBe(1);
    expect(res.body.totalEstimateValue).toBe(5000);
  });
});

describe("GET /api/admin/active-sessions", () => {
  it("returns list of active sessions", async () => {
    const claims = [buildClaim({ id: 1, claimNumber: "CLM-001" })];
    const session = buildSession({ id: 1, claimId: 1 });
    (mockStorage.getClaims as any).mockResolvedValue(claims);
    (mockStorage.getActiveSessionForClaim as any).mockResolvedValue(session);

    const res = await request(app).get("/api/admin/active-sessions");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].claimNumber).toBe("CLM-001");
    expect(res.body[0].claimId).toBe(1);
  });
});
