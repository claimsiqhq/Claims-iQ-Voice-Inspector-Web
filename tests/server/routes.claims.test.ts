import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createMockStorage } from "../mocks/mockStorage";
import { mockAuthMiddleware, defaultTestUser } from "../mocks/mockAuth";
import { buildClaim } from "../fixtures/factories";
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

  app.get("/api/claims", async (_req, res) => {
    try {
      const claims = await mockStorage.getClaims();
      res.json(claims);
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

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
      const user = (req as any).user;
      const claimData = { ...parsed.data, assignedTo: user?.id ?? null };
      const claim = await mockStorage.createClaim(claimData as any);
      res.status(201).json(claim);
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const claim = await mockStorage.getClaim(id);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      const docs = await mockStorage.getDocuments(id);
      const exts = await mockStorage.getExtractions(id);
      const briefing = await mockStorage.getBriefing(id);
      res.json({ ...claim, documents: docs, extractions: exts, briefing });
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });
});

describe("GET /api/claims", () => {
  it("returns all claims", async () => {
    const claims = [buildClaim({ id: 1 }), buildClaim({ id: 2 })];
    (mockStorage.getClaims as any).mockResolvedValue(claims);

    const res = await request(app).get("/api/claims");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].claimNumber).toBe("CLM-00001");
  });

  it("returns empty array when no claims exist", async () => {
    (mockStorage.getClaims as any).mockResolvedValue([]);

    const res = await request(app).get("/api/claims");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 500 on storage failure", async () => {
    (mockStorage.getClaims as any).mockRejectedValue(new Error("DB connection lost"));

    const res = await request(app).get("/api/claims");

    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Internal server error");
  });
});

describe("POST /api/claims", () => {
  it("creates a claim with valid data", async () => {
    const newClaim = buildClaim({ id: 1 });
    (mockStorage.createClaim as any).mockResolvedValue(newClaim);

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
    (mockStorage.createClaim as any).mockResolvedValue(buildClaim(fullData));

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
    (mockStorage.getClaim as any).mockResolvedValue(claim);
    (mockStorage.getDocuments as any).mockResolvedValue([{ id: 1, fileName: "fnol.pdf" }]);
    (mockStorage.getExtractions as any).mockResolvedValue([]);
    (mockStorage.getBriefing as any).mockResolvedValue({ id: 1, content: "Summary..." });

    const res = await request(app).get("/api/claims/5");

    expect(res.status).toBe(200);
    expect(res.body.claimNumber).toBe(claim.claimNumber);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.briefing.content).toBe("Summary...");
  });

  it("returns 404 for non-existent claim", async () => {
    (mockStorage.getClaim as any).mockResolvedValue(undefined);

    const res = await request(app).get("/api/claims/999");

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Claim not found");
  });

  it("parses string ID parameter correctly", async () => {
    (mockStorage.getClaim as any).mockResolvedValue(buildClaim({ id: 42 }));
    (mockStorage.getDocuments as any).mockResolvedValue([]);
    (mockStorage.getExtractions as any).mockResolvedValue([]);
    (mockStorage.getBriefing as any).mockResolvedValue(undefined);

    await request(app).get("/api/claims/42");

    expect(mockStorage.getClaim).toHaveBeenCalledWith(42);
  });
});
