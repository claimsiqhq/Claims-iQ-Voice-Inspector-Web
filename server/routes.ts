import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import path from "path";
import fs from "fs";
import * as pdfParseModule from "pdf-parse";
const pdfParse = (pdfParseModule as any).default || pdfParseModule;
import { extractFNOL, extractPolicy, extractEndorsements, generateBriefing } from "./openai";

const upload = multer({
  dest: "/tmp/claims-uploads",
  limits: { fileSize: 20 * 1024 * 1024 },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/claims", async (_req, res) => {
    try {
      const claims = await storage.getClaims();
      res.json(claims);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/claims", async (req, res) => {
    try {
      const claim = await storage.createClaim(req.body);
      res.status(201).json(claim);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/claims/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const claim = await storage.getClaim(id);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      const docs = await storage.getDocuments(id);
      const exts = await storage.getExtractions(id);
      const briefing = await storage.getBriefing(id);
      res.json({ ...claim, documents: docs, extractions: exts, briefing });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/claims/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      if (status) {
        const claim = await storage.updateClaimStatus(id, status);
        return res.json(claim);
      }
      res.status(400).json({ message: "No valid update fields" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/claims/:id/documents", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const docs = await storage.getDocuments(claimId);
      res.json(docs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/claims/:id/documents/upload", upload.single("file"), async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const documentType = req.body.documentType as string;
      const file = req.file;

      if (!file || !documentType) {
        return res.status(400).json({ message: "file and documentType are required" });
      }

      const existing = await storage.getDocument(claimId, documentType);
      if (existing) {
        await storage.updateDocumentFilePath(existing.id, file.path, file.originalname, file.size);
        await storage.updateDocumentStatus(existing.id, "uploaded");
        res.json({ documentId: existing.id, status: "uploaded" });
        return;
      }

      const doc = await storage.createDocument({
        claimId,
        documentType,
        fileName: file.originalname,
        fileSize: file.size,
        filePath: file.path,
        status: "uploaded",
      });

      res.status(201).json({ documentId: doc.id, status: "uploaded" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/claims/:id/documents/:type/parse", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const documentType = req.params.type;

      const doc = await storage.getDocument(claimId, documentType);
      if (!doc) {
        return res.status(404).json({ message: "Document not found. Upload first." });
      }

      await storage.updateDocumentStatus(doc.id, "processing");

      let rawText = "";
      try {
        const dataBuffer = fs.readFileSync(doc.filePath!);
        const pdfData = await pdfParse(dataBuffer);
        rawText = pdfData.text;
      } catch (pdfError: any) {
        await storage.updateDocumentError(doc.id, "Failed to parse PDF: " + pdfError.message);
        return res.status(422).json({ message: "Failed to parse PDF text" });
      }

      await storage.updateDocumentStatus(doc.id, "processing", rawText);

      let extractResult: { extractedData: any; confidence: any };
      try {
        if (documentType === "fnol") {
          extractResult = await extractFNOL(rawText);
        } else if (documentType === "policy") {
          extractResult = await extractPolicy(rawText);
        } else if (documentType === "endorsements") {
          extractResult = await extractEndorsements(rawText);
        } else {
          return res.status(400).json({ message: "Invalid document type" });
        }
      } catch (aiError: any) {
        await storage.updateDocumentError(doc.id, "AI extraction failed: " + aiError.message);
        return res.status(500).json({ message: "AI extraction failed" });
      }

      const existing = await storage.getExtraction(claimId, documentType);
      let extraction;
      if (existing) {
        extraction = await storage.updateExtraction(existing.id, extractResult.extractedData);
      } else {
        extraction = await storage.createExtraction({
          claimId,
          documentType,
          extractedData: extractResult.extractedData,
          confidence: extractResult.confidence,
        });
      }

      await storage.updateDocumentStatus(doc.id, "parsed");

      if (documentType === "fnol") {
        const data = extractResult.extractedData;
        if (data.insuredName || data.propertyAddress || data.dateOfLoss || data.perilType) {
          const claim = await storage.getClaim(claimId);
          if (claim) {
            const addr = data.propertyAddress;
            const addressStr = addr ? `${addr.street || ""}, ${addr.city || ""}, ${addr.state || ""} ${addr.zip || ""}` : undefined;
          }
        }
      }

      const allDocs = await storage.getDocuments(claimId);
      const allParsed = allDocs.length >= 3 && allDocs.every(d => d.status === "parsed");
      if (allParsed) {
        await storage.updateClaimStatus(claimId, "documents_uploaded");
      }

      res.json({ extraction, confidence: extractResult.confidence });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/claims/:id/extractions", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const exts = await storage.getExtractions(claimId);
      res.json(exts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/claims/:id/extractions/:type", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const ext = await storage.getExtraction(claimId, req.params.type);
      if (!ext) return res.status(404).json({ message: "Extraction not found" });
      res.json(ext);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/claims/:id/extractions/:type", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const ext = await storage.getExtraction(claimId, req.params.type);
      if (!ext) return res.status(404).json({ message: "Extraction not found" });

      const updated = await storage.updateExtraction(ext.id, req.body.extractedData);
      await storage.confirmExtraction(ext.id);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/claims/:id/extractions/confirm-all", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const exts = await storage.getExtractions(claimId);
      for (const ext of exts) {
        await storage.confirmExtraction(ext.id);
      }
      await storage.updateClaimStatus(claimId, "extractions_confirmed");
      res.json({ confirmed: exts.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/claims/:id/briefing/generate", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const exts = await storage.getExtractions(claimId);

      const fnolExt = exts.find(e => e.documentType === "fnol");
      const policyExt = exts.find(e => e.documentType === "policy");
      const endorsementsExt = exts.find(e => e.documentType === "endorsements");

      if (!fnolExt || !policyExt || !endorsementsExt) {
        return res.status(400).json({ message: "All 3 extractions required before generating briefing" });
      }

      const briefingData = await generateBriefing(
        fnolExt.extractedData,
        policyExt.extractedData,
        endorsementsExt.extractedData
      );

      const existing = await storage.getBriefing(claimId);
      let briefing;
      if (existing) {
        briefing = existing;
      } else {
        briefing = await storage.createBriefing({
          claimId,
          propertyProfile: briefingData.propertyProfile,
          coverageSnapshot: briefingData.coverageSnapshot,
          perilAnalysis: briefingData.perilAnalysis,
          endorsementImpacts: briefingData.endorsementImpacts,
          inspectionChecklist: briefingData.inspectionChecklist,
          dutiesAfterLoss: briefingData.dutiesAfterLoss,
          redFlags: briefingData.redFlags,
        });
      }

      await storage.updateClaimStatus(claimId, "briefing_ready");
      res.json(briefing);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/claims/:id/briefing", async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const briefing = await storage.getBriefing(claimId);
      if (!briefing) return res.status(404).json({ message: "Briefing not found" });
      res.json(briefing);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  return httpServer;
}
