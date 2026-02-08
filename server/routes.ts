import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { generateESXFile } from "./esxGenerator";
import { reviewEstimate } from "./aiReview";
import { supabase, DOCUMENTS_BUCKET, PHOTOS_BUCKET } from "./supabase";
import { authenticateRequest, authenticateSupabaseToken, requireRole, optionalAuth } from "./auth";
import pdfParse from "pdf-parse";
import { extractFNOL, extractPolicy, extractEndorsements, generateBriefing } from "./openai";
import { buildSystemInstructions, realtimeTools } from "./realtime";
import { lookupCatalogItem, getRegionalPrice, calculateLineItemPrice, calculateEstimateTotals, validateEstimate } from "./estimateEngine";
import { z } from "zod";

const uploadBodySchema = z.object({
  fileName: z.string().min(1),
  fileBase64: z.string().min(1),
  documentType: z.enum(["fnol", "policy", "endorsements"]),
});

const batchUploadBodySchema = z.object({
  files: z.array(z.object({
    fileName: z.string().min(1),
    fileBase64: z.string().min(1),
  })).min(1).max(20),
  documentType: z.literal("endorsements"),
});

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

const sessionUpdateSchema = z.object({
  currentPhase: z.number().int().positive().optional(),
  currentRoomId: z.number().int().positive().nullable().optional(),
  currentStructure: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
});

const roomCreateSchema = z.object({
  name: z.string().min(1).max(100),
  roomType: z.string().max(50).nullable().optional(),
  structure: z.string().max(100).nullable().optional(),
  dimensions: z.any().optional(),
  phase: z.number().int().positive().nullable().optional(),
});

const lineItemCreateSchema = z.object({
  roomId: z.number().int().positive().nullable().optional(),
  damageId: z.number().int().positive().nullable().optional(),
  category: z.string().min(1).max(50),
  action: z.string().max(30).nullable().optional(),
  description: z.string().min(1),
  xactCode: z.string().max(30).nullable().optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().max(20).nullable().optional(),
  unitPrice: z.number().nonnegative().optional(),
  depreciationType: z.string().max(30).nullable().optional(),
  wasteFactor: z.number().int().nonnegative().optional(),
});

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Extracts top-level claim fields from a parsed FNOL extraction so they can be synced to the claims table. */
function claimFieldsFromFnol(data: any): Record<string, any> {
  const fields: Record<string, any> = {};
  if (data.insuredName) fields.insuredName = data.insuredName;
  if (data.perilType) fields.perilType = data.perilType;
  if (data.dateOfLoss) fields.dateOfLoss = data.dateOfLoss;
  if (data.propertyAddress) {
    if (typeof data.propertyAddress === "object") {
      if (data.propertyAddress.street) fields.propertyAddress = data.propertyAddress.street;
      if (data.propertyAddress.city) fields.city = data.propertyAddress.city;
      if (data.propertyAddress.state) fields.state = data.propertyAddress.state;
      if (data.propertyAddress.zip) fields.zip = data.propertyAddress.zip;
    } else if (typeof data.propertyAddress === "string") {
      fields.propertyAddress = data.propertyAddress;
    }
  }
  return fields;
}

function decodeBase64Payload(base64Input: string, maxBytes: number): { buffer: Buffer; wasTruncated: boolean } {
  const base64Data = base64Input.includes(",") ? base64Input.split(",")[1] : base64Input;
  const buffer = Buffer.from(base64Data, "base64");
  return { buffer, wasTruncated: buffer.length > maxBytes };
}

async function uploadToSupabase(
  claimId: number,
  documentType: string,
  fileBuffer: Buffer,
  fileName: string
): Promise<string> {
  const storagePath = `claims/${claimId}/${documentType}/${fileName}`;
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return storagePath;
}

async function downloadFromSupabase(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(storagePath);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/claims", authenticateRequest, async (req, res) => {
    try {
      const claims = await storage.getClaims();
      res.json(claims);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/my-claims", optionalAuth, async (req: any, res) => {
    try {
      const claims = await storage.getClaims();
      if (req.user) {
        const userClaims = claims.filter((c: any) => c.assignedTo === req.user.id);
        if (userClaims.length > 0) return res.json(userClaims);
      }
      res.json(claims);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims", authenticateRequest, async (req, res) => {
    try {
      const parsed = createClaimSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid claim data", errors: parsed.error.flatten().fieldErrors });
      }
      const claimData = { ...parsed.data, assignedTo: req.user?.id ?? null };
      const claim = await storage.createClaim(claimData);
      res.status(201).json(claim);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const claim = await storage.getClaim(id);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      const docs = await storage.getDocuments(id);
      const exts = await storage.getExtractions(id);
      const briefing = await storage.getBriefing(id);
      res.json({ ...claim, documents: docs, extractions: exts, briefing });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/claims/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      if (status) {
        const claim = await storage.updateClaimStatus(id, status);
        return res.json(claim);
      }
      res.status(400).json({ message: "No valid update fields" });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/claims/purge-all", authenticateRequest, requireRole("admin"), async (req, res) => {
    try {
      const allClaims = await storage.getClaims();
      for (const claim of allClaims) {
        const docs = await storage.getDocuments(claim.id);
        for (const doc of docs) {
          if (doc.storagePath) {
            const paths = doc.storagePath.split("|").map(p => p.trim()).filter(Boolean);
            if (paths.length > 0) {
              await supabase.storage.from(DOCUMENTS_BUCKET).remove(paths);
            }
          }
        }
        const sessions = await storage.getInspectionSessionsForClaim(claim.id);
        for (const session of sessions) {
          const photos = await storage.getPhotos(session.id);
          const photoPaths = photos.map((p: any) => p.storagePath).filter(Boolean) as string[];
          if (photoPaths.length > 0) {
            await supabase.storage.from(PHOTOS_BUCKET).remove(photoPaths);
          }
        }
      }
      const count = await storage.deleteAllClaims();
      res.json({ message: `Purged ${count} claims and all related data` });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/claims/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const docs = await storage.getDocuments(id);
      for (const doc of docs) {
        if (doc.storagePath) {
          const paths = doc.storagePath.split("|").map(p => p.trim()).filter(Boolean);
          if (paths.length > 0) {
            await supabase.storage.from(DOCUMENTS_BUCKET).remove(paths);
          }
        }
      }
      const sessions = await storage.getInspectionSessionsForClaim(id);
      for (const session of sessions) {
        const photos = await storage.getPhotos(session.id);
        const photoPaths = photos.map((p: any) => p.storagePath).filter(Boolean) as string[];
        if (photoPaths.length > 0) {
          await supabase.storage.from(PHOTOS_BUCKET).remove(photoPaths);
        }
      }
      const deleted = await storage.deleteClaim(id);
      if (!deleted) return res.status(404).json({ message: "Claim not found" });
      res.json({ message: "Claim and all related data deleted" });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/documents/all", authenticateRequest, async (req, res) => {
    try {
      const docs = await storage.getAllDocuments();
      res.json(docs);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/documents/status-summary", authenticateRequest, async (req, res) => {
    try {
      const docs = await storage.getAllDocuments();
      const allClaims = await storage.getClaims();
      const summaries = [];
      for (const claim of allClaims) {
        const claimDocs = docs.filter(d => d.claimId === claim.id);
        if (claimDocs.length === 0) continue;
        const claimExtractions = await storage.getExtractions(claim.id);
        const docStatuses = claimDocs.map(doc => {
          const extraction = claimExtractions.find(e => e.documentType === doc.documentType);
          let stage: string;
          if (extraction?.confirmedByUser) {
            stage = "reviewed";
          } else if (doc.status === "parsed") {
            stage = "extracted";
          } else if (doc.status === "processing") {
            stage = "processing";
          } else if (doc.status === "uploaded") {
            stage = "uploaded";
          } else {
            stage = "empty";
          }
          return {
            documentId: doc.id,
            documentType: doc.documentType,
            fileName: doc.fileName,
            stage,
          };
        });
        summaries.push({
          claimId: claim.id,
          claimNumber: claim.claimNumber,
          insuredName: claim.insuredName,
          documents: docStatuses,
        });
      }
      res.json(summaries);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/:id/documents", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const docs = await storage.getDocuments(claimId);
      res.json(docs);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/documents/:id/signed-url", authenticateRequest, async (req, res) => {
    try {
      const docId = parseInt(req.params.id);
      const doc = await storage.getDocumentById(docId);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      if (!doc.storagePath) return res.status(404).json({ message: "No file uploaded for this document" });

      const paths = doc.storagePath.split("|");
      const urls: string[] = [];
      for (const p of paths) {
        const { data, error } = await supabase.storage
          .from(DOCUMENTS_BUCKET)
          .createSignedUrl(p.trim(), 3600);
        if (error) throw new Error(`Signed URL failed: ${error.message}`);
        urls.push(data.signedUrl);
      }
      res.json({ urls, fileName: doc.fileName, documentType: doc.documentType });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims/:id/documents/upload", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const parsed = uploadBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid upload data", errors: parsed.error.flatten().fieldErrors });
      }
      const { fileName, fileBase64, documentType } = parsed.data;

      if (!fileName.toLowerCase().endsWith(".pdf") && !fileBase64.startsWith("data:application/pdf")) {
        return res.status(400).json({ message: "Only PDF uploads are supported" });
      }

      const { buffer: fileBuffer, wasTruncated } = decodeBase64Payload(fileBase64, MAX_DOCUMENT_BYTES);
      if (wasTruncated) {
        return res.status(413).json({ message: "File exceeds max upload size (25MB)" });
      }

      const storagePath = await uploadToSupabase(claimId, documentType, fileBuffer, fileName);

      const existing = await storage.getDocument(claimId, documentType);
      if (existing) {
        await storage.updateDocumentStoragePath(existing.id, storagePath, fileName, fileBuffer.length);
        await storage.updateDocumentStatus(existing.id, "uploaded");
        res.json({ documentId: existing.id, storagePath, status: "uploaded" });
        return;
      }

      const doc = await storage.createDocument({
        claimId,
        documentType,
        fileName,
        fileSize: fileBuffer.length,
        storagePath,
        status: "uploaded",
      });

      res.status(201).json({ documentId: doc.id, storagePath, status: "uploaded" });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims/:id/documents/upload-batch", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const parsed = batchUploadBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid batch upload data", errors: parsed.error.flatten().fieldErrors });
      }
      const { files, documentType } = parsed.data;

      const storagePaths: string[] = [];
      for (const file of files) {
        if (!file.fileName.toLowerCase().endsWith(".pdf") && !file.fileBase64.startsWith("data:application/pdf")) {
          return res.status(400).json({ message: "Only PDF uploads are supported" });
        }
        const { buffer: fileBuffer, wasTruncated } = decodeBase64Payload(file.fileBase64, MAX_DOCUMENT_BYTES);
        if (wasTruncated) {
          return res.status(413).json({ message: "One or more files exceed the 25MB limit" });
        }
        const storagePath = await uploadToSupabase(claimId, documentType, fileBuffer, file.fileName);
        storagePaths.push(storagePath);
      }

      const combinedFileName = files.map(f => f.fileName).join(", ");
      const totalSize = files.reduce((sum, f) => {
        const { buffer } = decodeBase64Payload(f.fileBase64, MAX_DOCUMENT_BYTES);
        return sum + buffer.length;
      }, 0);

      const existing = await storage.getDocument(claimId, documentType);
      if (existing) {
        await storage.updateDocumentStoragePath(existing.id, storagePaths.join("|"), combinedFileName, totalSize);
        await storage.updateDocumentStatus(existing.id, "uploaded");
        res.json({ documentId: existing.id, storagePaths, fileCount: files.length, status: "uploaded" });
        return;
      }

      const doc = await storage.createDocument({
        claimId,
        documentType,
        fileName: combinedFileName,
        fileSize: totalSize,
        storagePath: storagePaths.join("|"),
        status: "uploaded",
      });

      res.status(201).json({ documentId: doc.id, storagePaths, fileCount: files.length, status: "uploaded" });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims/:id/documents/:type/parse", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const documentType = req.params.type;

      const doc = await storage.getDocument(claimId, documentType);
      if (!doc) {
        return res.status(404).json({ message: "Document not found. Upload first." });
      }

      if (!doc.storagePath) {
        return res.status(400).json({ message: "Document has no uploaded file. Upload first." });
      }

      await storage.updateDocumentStatus(doc.id, "processing");

      let rawText = "";
      try {
        if (documentType === "endorsements" && doc.storagePath!.includes("|")) {
          const storagePaths = doc.storagePath!.split("|");
          const textParts: string[] = [];
          for (const sp of storagePaths) {
            const dataBuffer = await downloadFromSupabase(sp);
            const pdfData = await pdfParse(dataBuffer);
            textParts.push(pdfData.text);
          }
          rawText = textParts.join("\n\n--- NEXT DOCUMENT ---\n\n");
        } else {
          const dataBuffer = await downloadFromSupabase(doc.storagePath!);
          const pdfData = await pdfParse(dataBuffer);
          rawText = pdfData.text;
        }
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

      // Always sync FNOL extracted fields to the claims table (both on create and re-parse)
      if (documentType === "fnol") {
        try {
          const fnolFields = claimFieldsFromFnol(extractResult.extractedData);
          if (Object.keys(fnolFields).length > 0) {
            await storage.updateClaimFields(claimId, fnolFields);
          }
        } catch (syncError: any) {
          console.error("Failed to sync FNOL fields to claim:", syncError.message);
        }
      }

      const allDocs = await storage.getDocuments(claimId);
      const allParsed = allDocs.length >= 3 && allDocs.every(d => d.status === "parsed");
      if (allParsed) {
        await storage.updateClaimStatus(claimId, "documents_uploaded");
      }

      res.json({ extraction, confidence: extractResult.confidence });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/:id/extractions", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const exts = await storage.getExtractions(claimId);
      res.json(exts);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/:id/extractions/:type", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const ext = await storage.getExtraction(claimId, req.params.type);
      if (!ext) return res.status(404).json({ message: "Extraction not found" });
      res.json(ext);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/claims/:id/extractions/:type", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const ext = await storage.getExtraction(claimId, req.params.type);
      if (!ext) return res.status(404).json({ message: "Extraction not found" });

      const updated = await storage.updateExtraction(ext.id, req.body.extractedData);
      await storage.confirmExtraction(ext.id);

      // Re-sync edited FNOL fields to the claims table
      if (req.params.type === "fnol") {
        const fnolFields = claimFieldsFromFnol(req.body.extractedData);
        if (Object.keys(fnolFields).length > 0) {
          await storage.updateClaimFields(claimId, fnolFields);
        }
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims/:id/extractions/:type/confirm", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const ext = await storage.getExtraction(claimId, req.params.type);
      if (!ext) return res.status(404).json({ message: "Extraction not found" });

      await storage.confirmExtraction(ext.id);

      if (req.params.type === "fnol" && ext.extractedData) {
        const fnolFields = claimFieldsFromFnol(ext.extractedData);
        if (Object.keys(fnolFields).length > 0) {
          await storage.updateClaimFields(claimId, fnolFields);
        }
      }

      res.json({ confirmed: true, documentType: req.params.type });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims/:id/extractions/confirm-all", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const exts = await storage.getExtractions(claimId);
      for (const ext of exts) {
        await storage.confirmExtraction(ext.id);
      }

      // Ensure the latest FNOL data is synced to the claims table on confirmation
      const fnolExt = exts.find(e => e.documentType === "fnol");
      if (fnolExt?.extractedData) {
        const fnolFields = claimFieldsFromFnol(fnolExt.extractedData);
        if (Object.keys(fnolFields).length > 0) {
          await storage.updateClaimFields(claimId, fnolFields);
        }
      }

      await storage.updateClaimStatus(claimId, "extractions_confirmed");
      res.json({ confirmed: exts.length });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/claims/:id/briefing/generate", authenticateRequest, async (req, res) => {
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
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/claims/:id/briefing", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const briefing = await storage.getBriefing(claimId);
      if (!briefing) return res.status(404).json({ message: "Briefing not found" });
      res.json(briefing);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Inspection Session Management ──────────────────

  app.post("/api/claims/:id/inspection/start", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const existing = await storage.getActiveSessionForClaim(claimId);
      if (existing) {
        return res.json({ sessionId: existing.id, session: existing });
      }
      const session = await storage.createInspectionSession(claimId);
      if (req.user?.id) {
        await storage.updateSession(session.id, { inspectorId: req.user.id });
      }
      await storage.updateClaimStatus(claimId, "inspecting");
      res.status(201).json({ sessionId: session.id, session });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const rooms = await storage.getRooms(sessionId);
      const allLineItems = await storage.getLineItems(sessionId);
      const photos = await storage.getPhotos(sessionId);
      const estimate = await storage.getEstimateSummary(sessionId);
      res.json({ session, rooms, lineItemCount: allLineItems.length, photoCount: photos.length, estimate });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const parsed = sessionUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid session update", errors: parsed.error.flatten().fieldErrors });
      }
      const updates = parsed.data;
      const session = await storage.updateSession(sessionId, updates);
      res.json(session);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/inspection/:sessionId/complete", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const session = await storage.completeSession(sessionId);
      if (session) {
        await storage.updateClaimStatus(session.claimId, "inspection_complete");
      }
      res.json(session);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Rooms ─────────────────────────────────────────

  app.post("/api/inspection/:sessionId/rooms", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const parsed = roomCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid room data", errors: parsed.error.flatten().fieldErrors });
      }
      const { name, roomType, structure, dimensions, phase } = parsed.data;
      const room = await storage.createRoom({
        sessionId,
        name,
        roomType: roomType || null,
        structure: structure || "Main Dwelling",
        dimensions: dimensions || null,
        status: "in_progress",
        phase: phase || null,
      });
      await storage.updateSessionRoom(sessionId, room.id);
      res.status(201).json(room);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/rooms", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const rooms = await storage.getRooms(sessionId);
      res.json(rooms);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/rooms/:roomId", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const room = await storage.updateRoomStatus(roomId, req.body.status);
      res.json(room);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/inspection/:sessionId/rooms/:roomId/complete", authenticateRequest, async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const room = await storage.completeRoom(roomId);
      res.json(room);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Damage Observations ──────────────────────────

  app.post("/api/inspection/:sessionId/damages", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const { roomId, description, damageType, severity, location, measurements } = req.body;
      if (!roomId || !description) {
        return res.status(400).json({ message: "roomId and description are required" });
      }
      const damage = await storage.createDamage({
        sessionId,
        roomId,
        description,
        damageType: damageType || null,
        severity: severity || null,
        location: location || null,
        measurements: measurements || null,
      });
      await storage.incrementRoomDamageCount(roomId);
      res.status(201).json(damage);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/damages", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const roomId = req.query.roomId ? parseInt(req.query.roomId as string) : undefined;
      const damages = roomId
        ? await storage.getDamages(roomId)
        : await storage.getDamagesForSession(sessionId);
      res.json(damages);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Line Items ───────────────────────────────────

  app.post("/api/inspection/:sessionId/line-items", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const parsed = lineItemCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid line item data", errors: parsed.error.flatten().fieldErrors });
      }
      const { roomId, damageId, category, action, description, xactCode, quantity, unit, unitPrice, depreciationType, wasteFactor } = parsed.data;
      const wf = wasteFactor || 0;
      const qty = quantity || 1;
      const up = unitPrice || 0;
      const totalPrice = qty * up * (1 + wf / 100);

      const item = await storage.createLineItem({
        sessionId,
        roomId: roomId || null,
        damageId: damageId || null,
        category,
        action: action || null,
        description,
        xactCode: xactCode || null,
        quantity: qty,
        unit: unit || null,
        unitPrice: up,
        totalPrice,
        depreciationType: depreciationType || "Recoverable",
        wasteFactor: wf,
      });
      res.status(201).json(item);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/line-items", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const items = await storage.getLineItems(sessionId);
      res.json(items);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/estimate-summary", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const summary = await storage.getEstimateSummary(sessionId);
      res.json(summary);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/inspection/:sessionId/line-items/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const item = await storage.updateLineItem(id, req.body);
      res.json(item);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/inspection/:sessionId/line-items/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLineItem(id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Photos ───────────────────────────────────────

  app.post("/api/inspection/:sessionId/photos", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const { roomId, damageId, imageBase64, autoTag, caption, photoType } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ message: "imageBase64 is required" });
      }
      if (!imageBase64.startsWith("data:image/")) {
        return res.status(400).json({ message: "Only image uploads are supported" });
      }

      const { buffer: fileBuffer, wasTruncated } = decodeBase64Payload(imageBase64, MAX_PHOTO_BYTES);
      if (wasTruncated) {
        return res.status(413).json({ message: "Image exceeds max upload size (10MB)" });
      }
      const rawTag = autoTag || `photo_${Date.now()}`;
      const tag = rawTag
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "_")
        .replace(/-+/g, "-")
        .substring(0, 60) || `photo_${Date.now()}`;
      const storagePath = `inspections/${sessionId}/${tag}.jpg`;

      const { error } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (error) {
        console.error("Photo upload error:", error);
        return res.status(502).json({ message: "Photo upload failed" });
      }

      const photo = await storage.createPhoto({
        sessionId,
        roomId: roomId || null,
        damageId: damageId || null,
        storagePath: error ? null : storagePath,
        autoTag: tag,
        caption: caption || null,
        photoType: photoType || null,
      });

      if (roomId) {
        await storage.incrementRoomPhotoCount(roomId);
      }

      res.status(201).json({ photoId: photo.id, storagePath: photo.storagePath });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/photos", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const photos = await storage.getPhotos(sessionId);
      res.json(photos);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/inspection/:sessionId/photos/:photoId/analyze
  app.post("/api/inspection/:sessionId/photos/:photoId/analyze", authenticateRequest, async (req, res) => {
    try {
      const photoId = parseInt(req.params.photoId);
      if (isNaN(photoId)) {
        return res.status(400).json({ message: "Invalid photoId" });
      }
      const { imageBase64, expectedLabel, expectedPhotoType } = req.body;

      if (!imageBase64) {
        return res.status(400).json({ message: "imageBase64 is required" });
      }

      // Call GPT-4o Vision to analyze the photo
      const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `You are an insurance property inspection photo analyst. Analyze this photo and provide:
1. A brief description of what you see (1-2 sentences)
2. Any visible damage (type, severity, location in frame)
3. Whether this photo matches the expected capture: "${expectedLabel}" (type: ${expectedPhotoType})
4. Photo quality assessment (lighting, focus, framing)
Respond in JSON format:
{
  "description": "string",
  "damageVisible": [{ "type": "string", "severity": "string", "notes": "string" }],
  "matchesExpected": true/false,
  "matchConfidence": 0.0-1.0,
  "matchExplanation": "string",
  "qualityScore": 1-5,
  "qualityNotes": "string"
}`
            },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: imageBase64,
                    detail: "high"
                  }
                },
                {
                  type: "text",
                  text: `This photo was requested as: "${expectedLabel}" (type: ${expectedPhotoType}). Analyze it.`
                }
              ]
            }
          ],
          max_tokens: 500,
          response_format: { type: "json_object" },
        }),
      });

      if (!openaiRes.ok) {
        const errBody = await openaiRes.text();
        console.error("Vision API error:", errBody);
        // Return a graceful fallback — don't block the workflow
        const fallbackAnalysis = {
          description: "Photo captured successfully. AI analysis unavailable.",
          damageVisible: [],
          matchesExpected: true,
          matchConfidence: 0.5,
          matchExplanation: "Analysis unavailable — assuming match.",
          qualityScore: 3,
          qualityNotes: "Unable to assess",
        };
        // Still save the fallback analysis
        await storage.updatePhoto(photoId, {
          analysis: fallbackAnalysis,
          matchesRequest: true,
        });
        return res.json(fallbackAnalysis);
      }

      const visionData = await openaiRes.json();
      const analysisText = visionData.choices?.[0]?.message?.content || "{}";

      let analysis: any;
      try {
        analysis = JSON.parse(analysisText);
      } catch {
        analysis = {
          description: analysisText,
          damageVisible: [],
          matchesExpected: true,
          matchConfidence: 0.5,
          matchExplanation: "Parse error — raw response stored.",
          qualityScore: 3,
          qualityNotes: "",
        };
      }

      // Update the photo record with analysis
      await storage.updatePhoto(photoId, {
        analysis,
        matchesRequest: analysis.matchesExpected ?? true,
      });

      res.json(analysis);
    } catch (error: any) {
      console.error("Photo analysis error:", error);
      // Don't block the workflow on analysis failure
      res.json({
        description: "Photo captured. Analysis failed.",
        damageVisible: [],
        matchesExpected: true,
        matchConfidence: 0.5,
        matchExplanation: "Analysis error — photo saved without analysis.",
        qualityScore: 3,
        qualityNotes: error.message,
      });
    }
  });

  // ── Moisture Readings ─────────────────────────────

  app.post("/api/inspection/:sessionId/moisture", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const { roomId, location, reading, materialType, dryStandard } = req.body;
      if (!roomId || reading === undefined) {
        return res.status(400).json({ message: "roomId and reading are required" });
      }
      const entry = await storage.createMoistureReading({
        sessionId,
        roomId,
        location: location || null,
        reading,
        materialType: materialType || null,
        dryStandard: dryStandard || null,
      });
      res.status(201).json(entry);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/moisture", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const roomId = req.query.roomId ? parseInt(req.query.roomId as string) : undefined;
      const readings = roomId
        ? await storage.getMoistureReadings(roomId)
        : await storage.getMoistureReadingsForSession(sessionId);
      res.json(readings);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Transcript ────────────────────────────────────

  app.post("/api/inspection/:sessionId/transcript", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const { speaker, content } = req.body;
      if (!speaker || !content) {
        return res.status(400).json({ message: "speaker and content are required" });
      }
      const entry = await storage.addTranscript({ sessionId, speaker, content });
      res.status(201).json(entry);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/transcript", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const transcript = await storage.getTranscript(sessionId);
      res.json(transcript);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── OpenAI Realtime Session ───────────────────────

  app.post("/api/realtime/session", authenticateRequest, async (req, res) => {
    try {
      const { claimId, sessionId } = req.body;
      if (!claimId) {
        return res.status(400).json({ message: "claimId is required" });
      }

      const claim = await storage.getClaim(claimId);
      const briefing = await storage.getBriefing(claimId);
      if (!claim || !briefing) {
        return res.status(400).json({ message: "Claim or briefing not found" });
      }

      const instructions = buildSystemInstructions(briefing, claim);

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ message: "OpenAI API key not configured" });
      }

      const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview",
          voice: "alloy",
          instructions,
          tools: realtimeTools,
          input_audio_transcription: { model: "whisper-1" },
          modalities: ["audio", "text"],
          turn_detection: {
            type: "server_vad",
            threshold: 0.75,
            prefix_padding_ms: 400,
            silence_duration_ms: 800,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("Realtime session error:", data);
        return res.status(500).json({ message: "Failed to create Realtime session", details: data });
      }

      if (sessionId) {
        await storage.updateSession(sessionId, { voiceSessionId: data.id });
      }

      res.json({
        clientSecret: data.client_secret.value,
        sessionId,
      });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Completeness Check ────────────────────────────

  app.get("/api/inspection/:sessionId/completeness", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const claim = await storage.getClaim(session.claimId);
      const rooms = await storage.getRooms(sessionId);
      const allLineItems = await storage.getLineItems(sessionId);
      const allPhotos = await storage.getPhotos(sessionId);
      const allDamages = await storage.getDamagesForSession(sessionId);
      const moistureReadings = await storage.getMoistureReadingsForSession(sessionId);

      const perilType = claim?.perilType || "unknown";
      const checklist: Array<{ item: string; satisfied: boolean; evidence?: string }> = [];

      // Universal items
      checklist.push({
        item: "Property overview photos (4 corners)",
        satisfied: allPhotos.filter(p => p.photoType === "overview").length >= 4,
        evidence: `${allPhotos.filter(p => p.photoType === "overview").length} overview photos`,
      });
      checklist.push({
        item: "At least one room/area documented",
        satisfied: rooms.length > 0,
        evidence: `${rooms.length} rooms created`,
      });
      checklist.push({
        item: "At least one damage observation recorded",
        satisfied: allDamages.length > 0,
        evidence: `${allDamages.length} damage observations`,
      });
      checklist.push({
        item: "At least one line item in estimate",
        satisfied: allLineItems.length > 0,
        evidence: `${allLineItems.length} line items`,
      });

      // Peril-specific items
      if (perilType === "hail") {
        const testSquarePhotos = allPhotos.filter(p => p.photoType === "test_square");
        checklist.push({
          item: "Roof test square photos",
          satisfied: testSquarePhotos.length >= 2,
          evidence: `${testSquarePhotos.length} test square photos`,
        });
        checklist.push({
          item: "Soft metal inspection documented (gutters, AC, vents)",
          satisfied: allDamages.some(d => d.damageType === "dent" || d.damageType === "hail_impact"),
          evidence: allDamages.filter(d => d.damageType === "dent" || d.damageType === "hail_impact").length > 0
            ? "Hail/dent damage recorded" : undefined,
        });
      }

      if (perilType === "wind" || perilType === "hail") {
        const elevationRooms = rooms.filter(r => r.roomType?.startsWith("exterior_elevation_"));
        checklist.push({
          item: "All four elevations documented",
          satisfied: elevationRooms.length >= 4,
          evidence: elevationRooms.length > 0
            ? `${elevationRooms.length} elevations: ${elevationRooms.map(r => r.name).join(", ")}`
            : undefined,
        });
        const roofRooms = rooms.filter(r => r.roomType === "exterior_roof_slope");
        checklist.push({
          item: "Roof slopes documented",
          satisfied: roofRooms.length >= 2,
          evidence: roofRooms.length > 0
            ? `${roofRooms.length} slopes: ${roofRooms.map(r => r.name).join(", ")}`
            : undefined,
        });
      }

      if (perilType === "water") {
        checklist.push({
          item: "Moisture readings recorded",
          satisfied: moistureReadings.length >= 3,
          evidence: `${moistureReadings.length} moisture readings`,
        });
        checklist.push({
          item: "Water entry point documented",
          satisfied: allDamages.some(d => d.damageType === "water_intrusion"),
          evidence: allDamages.some(d => d.damageType === "water_intrusion")
            ? "Water intrusion recorded" : undefined,
        });
      }

      // Scope gap detection
      const scopeGaps: Array<{ room: string; issue: string }> = [];
      for (const room of rooms) {
        const roomDamages = allDamages.filter(d => d.roomId === room.id);
        const roomItems = allLineItems.filter(li => li.roomId === room.id);
        if (roomDamages.length > 0 && roomItems.length === 0) {
          scopeGaps.push({
            room: room.name,
            issue: `${roomDamages.length} damage observation(s) but no line items`,
          });
        }
      }

      // Missing photo alerts
      const missingPhotos: Array<{ room: string; issue: string }> = [];
      for (const room of rooms) {
        const roomDamages = allDamages.filter(d => d.roomId === room.id);
        const roomPhotos = allPhotos.filter(p => p.roomId === room.id);
        if (roomDamages.length > 0 && roomPhotos.length === 0) {
          missingPhotos.push({
            room: room.name,
            issue: `${roomDamages.length} damage(s) documented but no photos`,
          });
        }
      }

      const satisfiedCount = checklist.filter(c => c.satisfied).length;
      const completenessScore = checklist.length > 0
        ? Math.round((satisfiedCount / checklist.length) * 100) : 0;

      res.json({
        completenessScore,
        checklist,
        scopeGaps,
        missingPhotos,
        summary: {
          totalRooms: rooms.length,
          completedRooms: rooms.filter(r => r.status === "complete").length,
          totalDamages: allDamages.length,
          totalLineItems: allLineItems.length,
          totalPhotos: allPhotos.length,
          totalMoistureReadings: moistureReadings.length,
        },
      });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Grouped Estimate ────────────────────────────────

  app.get("/api/inspection/:sessionId/estimate-grouped", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const items = await storage.getLineItems(sessionId);
      const rooms = await storage.getRooms(sessionId);

      const hierarchy: Record<string, Record<string, any[]>> = {};

      for (const item of items) {
        const category = item.category || "General";
        const room = rooms.find(r => r.id === item.roomId);
        const roomName = room ? room.name : "Unassigned";

        if (!hierarchy[category]) hierarchy[category] = {};
        if (!hierarchy[category][roomName]) hierarchy[category][roomName] = [];
        hierarchy[category][roomName].push(item);
      }

      const categories = Object.entries(hierarchy).map(([category, roomGroups]) => {
        const roomEntries = Object.entries(roomGroups).map(([roomName, roomItems]) => ({
          roomName,
          items: roomItems,
          subtotal: roomItems.reduce((s: number, i: any) => s + (i.totalPrice || 0), 0),
        }));
        return {
          category,
          rooms: roomEntries,
          subtotal: roomEntries.reduce((s, r) => s + r.subtotal, 0),
        };
      });

      const estimateSummary = await storage.getEstimateSummary(sessionId);

      res.json({ categories, ...estimateSummary });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Photos Grouped by Room ──────────────────────────

  app.get("/api/inspection/:sessionId/photos-grouped", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const photos = await storage.getPhotos(sessionId);
      const rooms = await storage.getRooms(sessionId);

      const grouped: Record<string, any[]> = {};
      for (const photo of photos) {
        const room = rooms.find(r => r.id === photo.roomId);
        const roomName = room ? room.name : "General";
        if (!grouped[roomName]) grouped[roomName] = [];
        grouped[roomName].push(photo);
      }

      res.json({
        groups: Object.entries(grouped).map(([roomName, roomPhotos]) => ({
          roomName,
          photos: roomPhotos,
          count: roomPhotos.length,
        })),
        totalPhotos: photos.length,
      });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Export Validation ───────────────────────────────

  app.post("/api/inspection/:sessionId/export/validate", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const rooms = await storage.getRooms(sessionId);
      const items = await storage.getLineItems(sessionId);
      const photos = await storage.getPhotos(sessionId);

      const warnings: string[] = [];
      const blockers: string[] = [];

      if (items.length === 0) blockers.push("No line items in estimate");
      if (photos.length === 0) warnings.push("No photos captured");
      if (rooms.filter(r => r.status === "complete").length === 0) {
        warnings.push("No rooms marked as complete");
      }

      const missingQty = items.filter(i => !i.quantity || i.quantity <= 0);
      if (missingQty.length > 0) {
        warnings.push(`${missingQty.length} line item(s) missing quantity`);
      }

      res.json({
        canExport: blockers.length === 0,
        blockers,
        warnings,
        summary: {
          lineItemCount: items.length,
          photoCount: photos.length,
          roomCount: rooms.length,
          completedRooms: rooms.filter(r => r.status === "complete").length,
        },
      });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── ESX Export (Xactimate-compatible ZIP) ────────────

  app.post("/api/inspection/:sessionId/export/esx", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const claim = await storage.getClaim(session.claimId);
      const esxBuffer = await generateESXFile(sessionId, storage);

      const fileName = `${claim?.claimNumber || "estimate"}_export.esx`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(esxBuffer);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── AI Estimate Review ──────────────────────────────

  app.post("/api/inspection/:sessionId/review/ai", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const review = await reviewEstimate(sessionId, storage);
      res.json(review);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── PDF Export Data ─────────────────────────────────

  app.post("/api/inspection/:sessionId/export/pdf", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const claim = await storage.getClaim(session.claimId);
      const rooms = await storage.getRooms(sessionId);
      const items = await storage.getLineItems(sessionId);
      const photos = await storage.getPhotos(sessionId);
      const damages = await storage.getDamagesForSession(sessionId);
      const moisture = await storage.getMoistureReadingsForSession(sessionId);
      const estimate = await storage.getEstimateSummary(sessionId);

      // Import the PDF generator
      const { generateInspectionPDF } = await import("./pdfGenerator");

      // Build categories from line items
      const categoryMap = new Map<string, typeof items>();
      for (const item of items) {
        const cat = item.category || "General";
        if (!categoryMap.has(cat)) categoryMap.set(cat, []);
        categoryMap.get(cat)!.push(item);
      }
      const categories = Array.from(categoryMap.entries()).map(([category, catItems]) => ({
        category,
        subtotal: catItems.reduce((sum, i) => sum + (i.totalPrice || 0), 0),
        items: catItems,
      }));

      // Build the data object for PDF generation
      const pdfData = {
        claim: claim || null,
        session,
        rooms,
        damages,
        lineItems: items,
        photos,
        moistureReadings: moisture,
        estimate: {
          totalRCV: estimate?.totalRCV || 0,
          totalDepreciation: estimate?.totalDepreciation || 0,
          totalACV: estimate?.totalACV || 0,
          itemCount: items.length,
          categories,
        },
        inspectorName: "Claims IQ Agent",
      };

      // Generate the PDF buffer
      const pdfBuffer = await generateInspectionPDF(pdfData);

      // Send as attachment
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${claim?.claimNumber || "inspection"}_report.pdf"`
      );
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("PDF generation error:", error);
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Photo Annotations Endpoint ──────────────────────

  app.put("/api/inspection/:sessionId/photos/:photoId/annotations", authenticateRequest, async (req, res) => {
    try {
      const photoId = parseInt(req.params.photoId);
      const { shapes, annotatedImageBase64 } = req.body;

      if (!shapes || !Array.isArray(shapes)) {
        return res.status(400).json({ message: "shapes array is required" });
      }

      // Save annotation data to the photo record
      const updatedPhoto = await storage.updatePhoto(photoId, {
        annotations: shapes,
      });

      res.json({ success: true, photo: updatedPhoto });
    } catch (error: any) {
      console.error("Photo annotation save error:", error);
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Session Status Update ───────────────────────────

  app.patch("/api/inspection/:sessionId/status", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const { status } = req.body;
      const validStatuses = ["active", "review", "exported", "submitted", "approved", "completed"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      }
      const session = await storage.updateSessionStatus(sessionId, status);
      if (!session) return res.status(404).json({ message: "Session not found" });
      res.json(session);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Pricing Catalog Endpoints ──────────────────────────────

  app.get("/api/pricing/catalog", authenticateRequest, async (req, res) => {
    try {
      const items = await storage.getScopeLineItems();
      res.json(items);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/pricing/catalog/search", authenticateRequest, async (req, res) => {
    try {
      const q = (req.query.q as string || "").toLowerCase();
      if (!q) {
        return res.status(400).json({ message: "q parameter required" });
      }
      const allItems = await storage.getScopeLineItems();
      const filtered = allItems.filter(item =>
        item.code.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
      );
      res.json(filtered);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/pricing/catalog/:tradeCode", authenticateRequest, async (req, res) => {
    try {
      const tradeCode = req.params.tradeCode;
      const items = await storage.getScopeLineItemsByTrade(tradeCode);
      res.json(items);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/pricing/scope", authenticateRequest, async (req, res) => {
    try {
      const { items, regionId, taxRate } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ message: "items array required" });
      }
      if (!regionId) {
        return res.status(400).json({ message: "regionId required" });
      }

      const pricedItems = [];

      for (const item of items) {
        const catalogItem = await storage.getScopeLineItemByCode(item.code);
        if (!catalogItem) {
          return res.status(404).json({ message: `Catalog item ${item.code} not found` });
        }
        const regionalPrice = await storage.getRegionalPrice(item.code, regionId);
        if (!regionalPrice) {
          return res.status(404).json({ message: `Regional price for ${item.code} in region ${regionId} not found` });
        }
        const priced = calculateLineItemPrice(catalogItem, regionalPrice, item.quantity, item.wasteFactor);
        pricedItems.push(priced);
      }

      const totals = calculateEstimateTotals(pricedItems, taxRate || 0.08);

      res.json({ items: pricedItems, totals });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/pricing/validate", authenticateRequest, async (req, res) => {
    try {
      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ message: "items array required" });
      }

      const validation = await validateEstimate(items);

      res.json(validation);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/pricing/regions", authenticateRequest, async (req, res) => {
    try {
      const allPrices = await storage.getRegionalPricesForRegion("US_NATIONAL");
      const regions = new Set(allPrices.map(p => p.regionId));
      res.json({
        regions: Array.from(regions).sort(),
        available: Array.from(regions).length > 0,
      });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // Pricing Catalog Seed
  app.post("/api/pricing/seed", authenticateRequest, requireRole("admin"), async (req, res) => {
    try {
      const { seedCatalog } = require("./seed-catalog");
      await seedCatalog();
      res.json({ message: "Catalog seeded successfully" });
    } catch (error: any) {
      if (error.message.includes("unique constraint") || error.message.includes("duplicate key")) {
        return res.json({ message: "Catalog already seeded" });
      }
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Authentication Routes ──────────────────────────

  app.post("/api/auth/sync", authenticateSupabaseToken, async (req, res) => {
    try {
      const supabaseUser = (req as any).supabaseUser;
      const { supabaseId, email, fullName } = req.body;
      if (!supabaseId || !email) {
        return res.status(400).json({ message: "supabaseId and email required" });
      }
      if (supabaseUser.id !== supabaseId) {
        return res.status(403).json({ message: "Token does not match provided supabaseId" });
      }
      const user = await storage.syncSupabaseUser(supabaseId, email, fullName || "");
      res.json({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/auth/me", authenticateRequest, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      res.json({
        id: req.user.id,
        email: req.user.email,
        fullName: req.user.fullName,
        role: req.user.role,
      });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Admin / Supervisor Routes ──────────────────────

  app.get("/api/admin/users", authenticateRequest, requireRole("supervisor", "admin"), async (_req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const teamMembers = allUsers
        .filter((u) => u.role === "adjuster" || u.role === "supervisor")
        .map((u) => ({
          id: u.id,
          fullName: u.fullName || u.username,
          email: u.email,
          role: u.role,
          activeClaims: 0,
        }));
      res.json(teamMembers);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/admin/claims/assign", authenticateRequest, requireRole("supervisor", "admin"), async (req, res) => {
    try {
      const { claimId, userId } = req.body;
      if (!claimId || !userId) {
        return res.status(400).json({ message: "claimId and userId required" });
      }
      const claim = await storage.updateClaimFields(claimId, { assignedTo: userId });
      res.json(claim);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/dashboard", authenticateRequest, requireRole("supervisor", "admin"), async (_req, res) => {
    try {
      const allClaims = await storage.getClaims();
      const sessions = await Promise.all(
        allClaims.map((c) => storage.getActiveSessionForClaim(c.id))
      );
      const activeSessions = sessions.filter((s) => s !== undefined).length;

      res.json({
        totalClaims: allClaims.length,
        activeSessions,
        avgInspectionTime: 45,
        totalEstimateValue: allClaims.reduce((sum, _c) => sum + 25000, 0),
      });
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/active-sessions", authenticateRequest, requireRole("supervisor", "admin"), async (_req, res) => {
    try {
      const allSessions = [];
      const allClaims = await storage.getClaims();
      for (const claim of allClaims) {
        const session = await storage.getActiveSessionForClaim(claim.id);
        if (session) {
          const inspector = session.inspectorId ? await storage.getUser(session.inspectorId) : null;
          allSessions.push({
            id: session.id,
            claimNumber: claim.claimNumber,
            claimId: claim.id,
            adjusterName: inspector?.fullName || "Unknown",
            currentPhase: session.currentPhase,
            status: session.status,
            startedAt: session.startedAt,
          });
        }
      }
      res.json(allSessions);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Supplemental Claims ─────────────────────────────

  app.post("/api/inspection/:sessionId/supplemental", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const { reason, newLineItems, removedLineItemIds, modifiedLineItems } = req.body;

      const session = await storage.getInspectionSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const supplemental = await storage.createSupplementalClaim({
        originalSessionId: sessionId,
        claimId: session.claimId,
        reason,
        newLineItems,
        removedLineItemIds,
        modifiedLineItems,
        status: "draft",
      });

      res.json(supplemental);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/inspection/:sessionId/supplementals", authenticateRequest, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const supplementals = await storage.getSupplementalsForSession(sessionId);
      res.json(supplementals);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/supplemental/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      const supplemental = await storage.updateSupplemental(id, updates);
      if (!supplemental) return res.status(404).json({ message: "Supplemental not found" });
      res.json(supplemental);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/supplemental/:id/submit", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const supplemental = await storage.submitSupplemental(id);
      if (!supplemental) return res.status(404).json({ message: "Supplemental not found" });
      res.json(supplemental);
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/supplemental/:id/export/esx", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const supplemental = await storage.getSupplemental(id);
      if (!supplemental) return res.status(404).json({ message: "Supplemental not found" });

      const claim = await storage.getClaim(supplemental.claimId);
      // For now, export the supplemental as ESX showing only new/modified items
      // In production, generate a delta ESX
      const fileName = `${claim?.claimNumber || "supplemental"}_supplemental.esx`;

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(Buffer.from("supplemental esx placeholder"));
    } catch (error: any) {
      console.error("Server error:", error); res.status(500).json({ message: "Internal server error" });
    }
  });

  return httpServer;
}
