import { Router } from "express";
import { storage } from "../storage";
import { authenticateRequest } from "../auth";
import { extractFNOL, extractPolicy, extractEndorsements, generateBriefing } from "../documentParser";
import pdfParse from "pdf-parse";
import { supabase, DOCUMENTS_BUCKET } from "../supabase";

export function claimsRouter() {
  const router = Router();

  router.get("/", authenticateRequest, async (req, res) => {
    try {
      const claims = await storage.getClaims();
      res.json(claims);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  router.get("/my-claims", authenticateRequest, async (req, res) => {
    try {
      const claims = await storage.getClaims();
      const userId = req.user!.id;
      const role = req.user!.role;
      const filtered = role === "supervisor" || role === "admin"
        ? claims
        : claims.filter(c => c.assignedTo === userId || !c.assignedTo);
      res.json(filtered);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  router.post("/", authenticateRequest, async (req, res) => {
    try {
      const claim = await storage.createClaim({ ...req.body, assignedTo: req.user!.id });
      res.status(201).json(claim);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  router.get("/:id", authenticateRequest, async (req, res) => {
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

  router.delete("/:id", authenticateRequest, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.updateClaimStatus(id, "deleted");
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Documents
  router.get("/:id/documents", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const docs = await storage.getDocuments(claimId);
      res.json(docs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Upload document (base64 from mobile)
  router.post("/:id/documents/upload", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const { fileData, fileName, documentType } = req.body;

      if (!fileData || !documentType) {
        return res.status(400).json({ message: "fileData and documentType are required" });
      }

      // Decode base64
      const base64Match = fileData.match(/^data:(.+);base64,(.+)$/);
      if (!base64Match) return res.status(400).json({ message: "Invalid file data format" });
      const buffer = Buffer.from(base64Match[2], "base64");

      // Upload to Supabase Storage if available
      let storagePath: string | null = null;
      if (supabase) {
        const ext = fileName?.split(".").pop() || "pdf";
        storagePath = `claims/${claimId}/${documentType}/${Date.now()}.${ext}`;
        await supabase.storage.from(DOCUMENTS_BUCKET).upload(storagePath, buffer, {
          contentType: "application/pdf",
          upsert: false,
        });
      }

      // Check for existing document of this type
      const existing = await storage.getDocument(claimId, documentType);
      let doc;
      if (existing) {
        await storage.updateDocumentStatus(existing.id, "uploaded");
        doc = existing;
      } else {
        doc = await storage.createDocument({
          claimId,
          documentType,
          fileName: fileName || `${documentType}.pdf`,
          fileSize: buffer.length,
          storagePath,
          status: "uploaded",
        });
      }

      // Auto-parse in background for fnol, policy, endorsements
      if (["fnol", "policy", "endorsements"].includes(documentType)) {
        (async () => {
          try {
            await storage.updateDocumentStatus(doc.id, "processing");

            const pdfData = await pdfParse(buffer);
            const rawText = pdfData.text;
            await storage.updateDocumentStatus(doc.id, "processing", rawText);

            let extractResult: { extractedData: any; confidence: any };
            if (documentType === "fnol") {
              extractResult = await extractFNOL(rawText);
            } else if (documentType === "policy") {
              extractResult = await extractPolicy(rawText);
            } else {
              extractResult = await extractEndorsements(rawText);
            }

            const existingExt = await storage.getExtraction(claimId, documentType);
            if (existingExt) {
              await storage.updateExtraction(existingExt.id, extractResult.extractedData);
            } else {
              await storage.createExtraction({
                claimId,
                documentType,
                extractedData: extractResult.extractedData,
                confidence: extractResult.confidence,
              });
            }

            await storage.updateDocumentStatus(doc.id, "parsed");

            // Update claim status
            const allDocs = await storage.getDocuments(claimId);
            if (allDocs.some(d => d.status === "parsed")) {
              await storage.updateClaimStatus(claimId, "documents_uploaded");
            }

            console.log(`Parsed ${documentType} for claim ${claimId}`);
          } catch (err) {
            console.error(`Parse error for ${documentType}:`, err);
            await storage.updateDocumentError(doc.id, String(err));
          }
        })();
      }

      res.status(201).json({ documentId: doc.id, status: "uploaded" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Parse document (manual trigger)
  router.post("/:id/documents/:type/parse", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const documentType = req.params.type;

      const doc = await storage.getDocument(claimId, documentType);
      if (!doc) return res.status(404).json({ message: "Document not found. Upload first." });
      if (!doc.rawText) return res.status(400).json({ message: "Document has no text. Re-upload." });

      await storage.updateDocumentStatus(doc.id, "processing");

      let extractResult: { extractedData: any; confidence: any };
      if (documentType === "fnol") {
        extractResult = await extractFNOL(doc.rawText);
      } else if (documentType === "policy") {
        extractResult = await extractPolicy(doc.rawText);
      } else if (documentType === "endorsements") {
        extractResult = await extractEndorsements(doc.rawText);
      } else {
        return res.status(400).json({ message: "Invalid document type" });
      }

      const existingExt = await storage.getExtraction(claimId, documentType);
      let extraction;
      if (existingExt) {
        extraction = await storage.updateExtraction(existingExt.id, extractResult.extractedData);
      } else {
        extraction = await storage.createExtraction({
          claimId,
          documentType,
          extractedData: extractResult.extractedData,
          confidence: extractResult.confidence,
        });
      }

      await storage.updateDocumentStatus(doc.id, "parsed");
      res.json({ extraction, confidence: extractResult.confidence });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Extractions
  router.get("/:id/extractions", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      res.json(await storage.getExtractions(claimId));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  router.put("/:id/extractions/:type", authenticateRequest, async (req, res) => {
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

  router.post("/:id/extractions/confirm-all", authenticateRequest, async (req, res) => {
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

  // Briefing
  router.post("/:id/briefing/generate", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const exts = await storage.getExtractions(claimId);

      const fnolExt = exts.find(e => e.documentType === "fnol");
      const policyExt = exts.find(e => e.documentType === "policy");
      const endorsementsExt = exts.find(e => e.documentType === "endorsements");

      if (!fnolExt) {
        return res.status(400).json({ message: "FNOL extraction required before generating briefing" });
      }

      const briefingData = await generateBriefing(
        fnolExt.extractedData,
        policyExt?.extractedData || {},
        endorsementsExt?.extractedData || {}
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

  router.get("/:id/briefing", authenticateRequest, async (req, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const briefing = await storage.getBriefing(claimId);
      if (!briefing) return res.status(404).json({ message: "Briefing not found" });
      res.json(briefing);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  return router;
}
