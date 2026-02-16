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

  app.get("/api/claims/:id/documents", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const claim = await mockStorage.getClaim(claimId);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      const docs = await mockStorage.getDocuments(claimId);
      res.json(docs);
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims/:id/documents/upload", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const { fileName, fileBase64, documentType } = req.body;
      if (!fileName || !fileBase64 || !documentType) {
        return res.status(400).json({ message: "Invalid upload data" });
      }
      const validTypes = ["fnol", "policy", "endorsements"];
      if (!validTypes.includes(documentType)) {
        return res.status(400).json({ message: "Invalid documentType" });
      }
      const claim = await mockStorage.getClaim(claimId);
      if (!claim) return res.status(404).json({ message: "Claim not found" });

      const existing = await mockStorage.getDocument(claimId, documentType);
      if (existing) {
        await mockStorage.updateDocumentStoragePath(existing.id, "path/updated", fileName, 1000);
        await mockStorage.updateDocumentStatus(existing.id, "uploaded");
        return res.json({ documentId: existing.id, status: "uploaded" });
      }

      const doc = await mockStorage.createDocument({
        claimId,
        documentType,
        fileName,
        fileSize: 1000,
        storagePath: "path/new",
        status: "uploaded",
      });
      res.status(201).json({ documentId: doc.id, status: "uploaded" });
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });
});

describe("GET /api/claims/:id/documents", () => {
  it("returns 404 for non-existent claim", async () => {
    (mockStorage.getClaim as any).mockResolvedValue(undefined);

    const res = await request(app).get("/api/claims/999/documents");

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Claim not found");
  });

  it("returns documents for claim", async () => {
    const claim = buildClaim({ id: 5 });
    const docs = [
      { id: 1, fileName: "fnol.pdf", documentType: "fnol", status: "uploaded" },
      { id: 2, fileName: "policy.pdf", documentType: "policy", status: "parsed" },
    ];
    (mockStorage.getClaim as any).mockResolvedValue(claim);
    (mockStorage.getDocuments as any).mockResolvedValue(docs);

    const res = await request(app).get("/api/claims/5/documents");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].fileName).toBe("fnol.pdf");
  });
});

describe("POST /api/claims/:id/documents/upload", () => {
  it("creates document with valid data", async () => {
    const claim = buildClaim({ id: 3 });
    (mockStorage.getClaim as any).mockResolvedValue(claim);
    (mockStorage.getDocument as any).mockResolvedValue(undefined);
    (mockStorage.createDocument as any).mockResolvedValue({ id: 10 });

    const res = await request(app)
      .post("/api/claims/3/documents/upload")
      .send({
        fileName: "fnol.pdf",
        fileBase64: "data:application/pdf;base64,JVBERi0xLjQK",
        documentType: "fnol",
      });

    expect(res.status).toBe(201);
    expect(res.body.documentId).toBe(10);
    expect(res.body.status).toBe("uploaded");
  });

  it("returns 400 when required fields missing", async () => {
    const res = await request(app)
      .post("/api/claims/1/documents/upload")
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid documentType", async () => {
    const res = await request(app)
      .post("/api/claims/1/documents/upload")
      .send({
        fileName: "x.pdf",
        fileBase64: "data:application/pdf;base64,xxx",
        documentType: "invalid_type",
      });

    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent claim", async () => {
    (mockStorage.getClaim as any).mockResolvedValue(undefined);

    const res = await request(app)
      .post("/api/claims/999/documents/upload")
      .send({
        fileName: "fnol.pdf",
        fileBase64: "data:application/pdf;base64,xxx",
        documentType: "fnol",
      });

    expect(res.status).toBe(404);
  });
});
